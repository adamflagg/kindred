package lodging

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupCollections creates minimal lodging_units and lodging_assignments
// collections (plus the draft twin) in the test app — only the fields the
// guards read. The production schema has many more.
//
// `units` is declared exactly as 1500000134 declares it on BOTH placement
// tables: multi-valued (MaxSelect 20), OPTIONAL, and cascadeDelete false.
// All three matter to what the guards have to do. Optional is why a placement
// can end up naming no cabin at all; cascadeDelete false is why deleting a
// unit shrinks a placement's set rather than removing the row.
//
// Keeping this fixture level with the migration is not housekeeping, it is the
// difference between a suite that tests something and one that does not
// (kindred#1921). While it still declared the single-valued `unit`/`merge`
// columns 1500000134 had already dropped, every test below passed green
// against a guardAssignmentGrain that rejected 100% of writes to a real
// database, and against a guardUnitDelete that could not see a placement at
// all.
func setupCollections(t *testing.T, app core.App) {
	t.Helper()

	units := core.NewBaseCollection("lodging_units")
	units.Fields.Add(&core.TextField{Name: "code", Required: true})
	units.Fields.Add(&core.TextField{Name: "name", Required: true})
	units.Fields.Add(&core.BoolField{Name: "is_active"})
	units.Fields.Add(&core.BoolField{Name: "is_container"})
	// Self-relation. CollectionId is set after the first Save, below, because
	// the collection has no id until it exists.
	if err := app.Save(units); err != nil {
		t.Fatalf("save lodging_units: %v", err)
	}

	// Distinct name rather than reusing `err`: it would otherwise stay live
	// (via this `:=`) all the way to the placement blocks' own `if err :=`
	// below and turn those pre-existing lines into govet shadow reports.
	unitsSelf, selfErr := app.FindCollectionByNameOrId("lodging_units")
	if selfErr != nil {
		t.Fatalf("find lodging_units: %v", selfErr)
	}
	unitsSelf.Fields.Add(&core.RelationField{
		Name: "parent_unit", CollectionId: unitsSelf.Id, MaxSelect: 1,
	})
	if err := app.Save(unitsSelf); err != nil {
		t.Fatalf("add parent_unit: %v", err)
	}

	unitsCol, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find lodging_units: %v", err)
	}

	// The confirmed board and the draft grain (1500000132) carry the SAME
	// placement shape after 1500000134. Staff hold bunking.manage on the draft,
	// so a write can arrive straight at the PocketBase REST API without passing
	// through the FastAPI schemas that enforce the grain rule.
	for _, name := range []string{"lodging_assignments", "lodging_assignments_draft"} {
		placements := core.NewBaseCollection(name)
		placements.Fields.Add(&core.RelationField{
			Name: "units", CollectionId: unitsCol.Id, MaxSelect: 20,
		})
		placements.Fields.Add(&core.NumberField{Name: "household_cm_id"})
		placements.Fields.Add(&core.NumberField{Name: "person_cm_id"})
		placements.Fields.Add(&core.NumberField{Name: "year"})
		if err := app.Save(placements); err != nil {
			t.Fatalf("save %s: %v", name, err)
		}
	}

	aliases := core.NewBaseCollection("lodging_unit_aliases")
	aliases.Fields.Add(&core.TextField{Name: "alias_string", Required: true})
	// member_units, valid_from_year and valid_to_year back sync.AliasResolver.
	aliases.Fields.Add(&core.RelationField{
		Name: "member_units", CollectionId: unitsCol.Id, MaxSelect: 20,
	})
	aliases.Fields.Add(&core.NumberField{Name: "valid_from_year"})
	aliases.Fields.Add(&core.NumberField{Name: "valid_to_year"})
	if err := app.Save(aliases); err != nil {
		t.Fatalf("save lodging_unit_aliases: %v", err)
	}
	// Distinct name rather than reusing `err`: a second `:=` on it would keep
	// the outer binding live past the `if err := app.Save(...)` blocks above
	// and turn each of them into a govet shadow report.
	aliasesCol, aliasErr := app.FindCollectionByNameOrId("lodging_unit_aliases")
	if aliasErr != nil {
		t.Fatalf("find lodging_unit_aliases: %v", aliasErr)
	}

	issues := core.NewBaseCollection("lodging_ingest_issues")
	issues.Fields.Add(&core.TextField{Name: "kind"})
	issues.Fields.Add(&core.TextField{Name: "raw_value"})
	issues.Fields.Add(&core.NumberField{Name: "year"})
	issues.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	issues.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	issues.Fields.Add(&core.BoolField{Name: "is_resolved"})
	issues.Fields.Add(&core.TextField{Name: "resolution_note"})
	issues.Fields.Add(&core.RelationField{
		Name: "resolved_alias", CollectionId: aliasesCol.Id, MaxSelect: 1,
	})
	if err := app.Save(issues); err != nil {
		t.Fatalf("save lodging_ingest_issues: %v", err)
	}
}

func newAlias(t *testing.T, app core.App, aliasString string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_unit_aliases")
	if err != nil {
		t.Fatalf("find lodging_unit_aliases: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("alias_string", aliasString)
	if err := app.Save(r); err != nil {
		t.Fatalf("save alias %q: %v", aliasString, err)
	}
	return r
}

func newResolvedIssue(t *testing.T, app core.App, rawValue, aliasID string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_ingest_issues")
	if err != nil {
		t.Fatalf("find lodging_ingest_issues: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("kind", "unresolved_alias")
	r.Set("raw_value", rawValue)
	r.Set("is_resolved", true)
	r.Set("resolved_alias", aliasID)
	if err := app.Save(r); err != nil {
		t.Fatalf("save issue %q: %v", rawValue, err)
	}
	return r
}

func newUnit(t *testing.T, app core.App, code, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find lodging_units: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("code", code)
	r.Set("name", name)
	r.Set("is_active", true)
	if err := app.Save(r); err != nil {
		t.Fatalf("save unit %q: %v", code, err)
	}
	return r
}

// newIssue seeds an OPEN work-queue row of the given kind -- unlike
// newResolvedIssue, which hardcodes unresolved_alias and is_resolved=true.
func newIssue(
	t *testing.T, app core.App, kind, rawValue string, year, householdCMID, personCMID int,
) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_ingest_issues")
	if err != nil {
		t.Fatalf("find lodging_ingest_issues: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("kind", kind)
	r.Set("raw_value", rawValue)
	r.Set("year", year)
	r.Set("household_cm_id", householdCMID)
	r.Set("person_cm_id", personCMID)
	if err := app.Save(r); err != nil {
		t.Fatalf("save issue %q: %v", rawValue, err)
	}
	return r
}

// captureStdout runs fn with os.Stdout redirected and returns everything
// written to it.
//
// This is the only way to observe app.Logger() output from outside the
// pocketbase core package: the batch handler behind it writes to a private
// DB-backed queue that a test cannot inspect directly. But with
// core.BaseAppConfig.IsDev set, the handler's BeforeAddFunc prints every log
// synchronously (on the calling goroutine, via fmt.Print) before it ever
// reaches that queue -- see core/log_printer.go -- so redirecting the
// process's stdout for the duration of fn captures it.
func captureStdout(t *testing.T, fn func()) (out string) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	original := os.Stdout
	os.Stdout = w
	captured := make(chan string, 1)
	go func() {
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, r)
		captured <- buf.String()
	}()

	// Deferred, not inline after fn(): a t.Fatalf inside fn runs via
	// runtime.Goexit, which skips everything after the call that is not
	// deferred. Without this, that path never restores os.Stdout -- every
	// later test in the process keeps writing into a closed pipe, which
	// swallows the very failure message a Fatalf inside fn was trying to
	// report. out is a named return so this can set it after fn returns
	// (normally or via Goexit) but before the reader goroutine can be
	// unblocked, which only happens once w is closed.
	defer func() {
		os.Stdout = original
		if closeErr := w.Close(); closeErr != nil {
			t.Errorf("close pipe writer: %v", closeErr)
		}
		out = <-captured
		// Reader goroutine has drained and exited by now, so closing r here
		// cannot truncate the capture. One fd per call otherwise.
		if closeErr := r.Close(); closeErr != nil {
			t.Errorf("close pipe reader: %v", closeErr)
		}
	}()

	fn()
	return ""
}

// newPlacement saves a row on one of the two placement tables WITHOUT the
// guards attached, so tests can stage the state a guard is supposed to protect.
func newPlacement(
	t *testing.T, app core.App, collection string, unitIDs []string, householdCmID, personCmID int,
) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find %s: %v", collection, err)
	}
	r := core.NewRecord(col)
	r.Set("units", unitIDs)
	r.Set("household_cm_id", householdCmID)
	r.Set("person_cm_id", personCmID)
	r.Set("year", 2026)
	if err := app.Save(r); err != nil {
		t.Fatalf("save %s: %v", collection, err)
	}
	return r
}

// newAssignment stages a placement on the CONFIRMED board.
func newAssignment(t *testing.T, app core.App, unitIDs []string, householdCmID, personCmID int) *core.Record {
	t.Helper()
	return newPlacement(t, app, "lodging_assignments", unitIDs, householdCmID, personCmID)
}

// newDraftAssignment stages a placement inside a saved SCENARIO. It is a
// separate helper from newAssignment because the difference between the two
// tables is the entire subject of kindred#1923(a).
func newDraftAssignment(t *testing.T, app core.App, unitIDs []string, householdCmID, personCmID int) *core.Record {
	t.Helper()
	return newPlacement(t, app, "lodging_assignments_draft", unitIDs, householdCmID, personCmID)
}

// assertUnitDeleteRefused fails unless the delete was refused BY guardUnitDelete
// having COUNTED wantCount placements.
//
// A bare `err != nil` would not have caught the bug this task exists to fix, and
// worse, would have looked like proof it was absent. While countAssignments
// still filtered on the `unit` column 1500000134 dropped, FindRecordsByFilter
// errored on the unknown field and guardUnitDelete returned THAT error — so
// against a real database the delete was refused for a reason with nothing to
// do with whether anything is placed, including for units nothing references.
// Matching the staff-facing sentence tells a refusal from the guard apart from
// a refusal from a broken query, and matching the count tells a guard that
// found the placement apart from one that found some other row.
//
// The count is matched on a DIGIT BOUNDARY, not as a bare substring.
// `strings.Contains(msg, "1 lodging placement")` is also satisfied by "11
// lodging placement(s)", so a guard that double-counted a unit's references
// into a two-digit number would still pass a wantCount of 1 or 2. This helper
// is the only correctness check on a destructive-delete guard, which makes a
// false pass here worse than no assertion at all: it reads as proof.
var placementCountRe = regexp.MustCompile(`(?:^|\D)(\d+) lodging placement`)

func assertUnitDeleteRefused(t *testing.T, err error, wantCount int) {
	t.Helper()
	if err == nil {
		t.Fatal("expected the delete to be refused, got nil error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "Set it inactive instead") {
		t.Fatalf("the delete was refused, but not by guardUnitDelete: %v", err)
	}
	m := placementCountRe.FindStringSubmatch(msg)
	if m == nil {
		t.Fatalf("guardUnitDelete reported no placement count at all: %q", msg)
	}
	if m[1] != strconv.Itoa(wantCount) {
		t.Fatalf("guardUnitDelete counted %s placement(s), want %d: %q", m[1], wantCount, msg)
	}
}

func TestDeletingAUnitWithAnAssignmentIsBlocked(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	unit := newUnit(t, app, "ridge-a", "Ridge A")
	newAssignment(t, app, []string{unit.Id}, 2000001, 0)

	wireHooks(app)

	assertUnitDeleteRefused(t, app.Delete(unit), 1)
	if _, err := app.FindRecordById("lodging_units", unit.Id); err != nil {
		t.Fatalf("unit should still exist after a blocked delete: %v", err)
	}
}

// TestGuardUnitDeleteSeesDraftPlacements closes kindred#1923(a). Until this,
// countAssignments looked at the confirmed board only, so a unit that nothing
// had been confirmed into deleted cleanly however many scenarios had parties
// in it.
//
// It is a user-facing tightening, and deliberate: lodging_units is deletable
// from /manage/lodging by anyone holding bunking.manage, typically a different
// person from whoever built the scenario the delete would empty. `units` is
// cascadeDelete:false, so the draft rows are not removed — PocketBase's own
// cleanup strips this id out of each one and re-saves it unvalidated, leaving
// parties sitting in a scenario with no cabin and nothing to say why.
func TestGuardUnitDeleteSeesDraftPlacements(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	// Nothing on the confirmed board at all — the whole point.
	unit := newUnit(t, app, "ridge-a", "Ridge A")
	newDraftAssignment(t, app, []string{unit.Id}, 2000001, 0)

	wireHooks(app)

	assertUnitDeleteRefused(t, app.Delete(unit), 1)
	if _, err := app.FindRecordById("lodging_units", unit.Id); err != nil {
		t.Fatalf("unit should still exist after a blocked delete: %v", err)
	}
}

// The two grains are SUMMED, not short-circuited. A guard that returned on the
// first non-empty table would still refuse this delete, so only the count in
// the message distinguishes it — and staff acting on "1 placement" when there
// are two would go looking in the wrong place.
func TestDeletingAUnitCountsBothGrainsTogether(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	unit := newUnit(t, app, "ridge-a", "Ridge A")
	newAssignment(t, app, []string{unit.Id}, 2000001, 0)
	newDraftAssignment(t, app, []string{unit.Id}, 2000002, 0)

	wireHooks(app)

	assertUnitDeleteRefused(t, app.Delete(unit), 2)
}

// A unit sitting SECOND in a placement's set — what a merged slot became when
// 1500000134 collapsed lodging_merges into `units`. This is the case the old
// guardMergeDelete covered and the one a filter that only inspects the first
// member of the set would silently drop, releasing a room out from under an
// occupied two-room slot (spec §3.4).
func TestDeletingAUnitHeldAsALaterMemberIsBlocked(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	first := newUnit(t, app, "ridge-a", "Ridge A")
	second := newUnit(t, app, "ridge-b", "Ridge B")
	newAssignment(t, app, []string{first.Id, second.Id}, 2000001, 0)

	wireHooks(app)

	assertUnitDeleteRefused(t, app.Delete(second), 1)
}

// The guard has to RELEASE units too, or nothing is ever deletable and §3.8's
// "deactivate, don't delete" becomes "you cannot delete."
//
// The staged siblings are what give this test teeth. Both placement tables hold
// rows here, just not rows naming this unit, so it fails against a filter that
// matches every row once any set is non-empty, and it fails against a filter
// that errors — the exact state guardUnitDelete was in against a real database
// before this change, where every unit was undeletable for the wrong reason.
func TestDeletingAnUnusedUnitIsAllowed(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	occupied := newUnit(t, app, "ridge-a", "Ridge A")
	newAssignment(t, app, []string{occupied.Id}, 2000001, 0)
	newDraftAssignment(t, app, []string{occupied.Id}, 2000002, 0)

	free := newUnit(t, app, "ridge-b", "Ridge B")

	wireHooks(app)

	if err := app.Delete(free); err != nil {
		t.Fatalf("expected an unreferenced unit to delete cleanly, got: %v", err)
	}
}

// newUnits stages n units and returns their ids, so a grain case can ask for a
// set of a given SIZE without caring which rooms are in it.
func newUnits(t *testing.T, app core.App, n int) []string {
	t.Helper()
	ids := make([]string, 0, n)
	for i := range n {
		code := fmt.Sprintf("ridge-%d", i)
		ids = append(ids, newUnit(t, app, code, "Ridge "+code).Id)
	}
	return ids
}

// TestAssignmentGrainXor pins the CONFIRMED board's truth table after
// 1500000134 collapsed unit/merge into `units`.
//
// The target half of the rule changed shape, not intent. "Exactly one of unit
// or merge" is now "at least one unit": a merged slot is a set of two or more,
// which used to be the `merge` branch and is now indistinguishable from any
// other placement, so the only target state left to reject is a set holding
// NOTHING. That mirrors sync.ValidateAssignmentGrain's ErrGrainNoPlacement for
// the writes that never pass through the sync package — a POST straight at the
// PocketBase REST API, and 1500000134's own backfill.
func TestAssignmentGrainXor(t *testing.T) {
	cases := []struct {
		name          string
		unitCount     int
		householdCmID int
		personCmID    int
		wantErr       bool
	}{
		{"household in one room", 1, 2000001, 0, false},
		{"person in one room", 1, 0, 1000001, false},
		// What used to be the `merge` branch. Legal, and no longer special.
		{"household across two rooms", 2, 2000001, 0, false},
		{"no units at all", 0, 2000001, 0, true},
		{"both household and person", 1, 2000001, 1000001, true},
		{"neither household nor person", 1, 0, 0, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatalf("NewTestApp: %v", err)
			}
			defer app.Cleanup()

			setupCollections(t, app)
			unitIDs := newUnits(t, app, tc.unitCount)

			wireHooks(app)

			col, err := app.FindCollectionByNameOrId("lodging_assignments")
			if err != nil {
				t.Fatalf("find lodging_assignments: %v", err)
			}
			r := core.NewRecord(col)
			r.Set("units", unitIDs)
			r.Set("household_cm_id", tc.householdCmID)
			r.Set("person_cm_id", tc.personCmID)
			r.Set("year", 2026)

			saveErr := app.Save(r)
			if tc.wantErr && saveErr == nil {
				t.Fatal("expected the illegal grain combination to be rejected")
			}
			if !tc.wantErr && saveErr != nil {
				t.Fatalf("expected a legal grain combination to save, got: %v", saveErr)
			}
		})
	}
}

// A PRODUCTION-BOOT constraint, not a redundant restatement of the case above.
//
// On the deploy that ships this branch, migration 1500000134 runs against an
// image already carrying the guard below it. Its backfill writes exactly one
// shape — a non-empty `units` on a row whose party grain the database already
// held — and it writes it with app.saveNoValidate(). That does NOT bypass this
// hook: withValidations skips FIELD validation only, and Save and
// SaveNoValidate both reach BaseApp.save, which fires OnRecordUpdate either
// way. So if guardAssignmentGrain ever stops accepting this shape, the
// migration throws, every pending migration rolls back with it (they share one
// transaction), and the container crash-loops.
//
// It reproduces the backfill's own write ORDER: the row exists first with the
// party grain and no units, exactly as the pre-134 rows did, and `units` is
// added by a second save. The table-driven case above only ever creates.
func TestABackfillShapedRowPassesTheGrainGuard(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	unit := newUnit(t, app, "ridge-a", "Ridge A")
	// Staged before wiring, standing in for a row written under the old schema.
	row := newAssignment(t, app, nil, 2000001, 0)

	wireHooks(app)

	row.Set("units", []string{unit.Id})
	if err := app.SaveNoValidate(row); err != nil {
		t.Fatalf(
			"1500000134's backfill write must pass guardAssignmentGrain or the "+
				"deploy crash-loops on boot, got: %v", err)
	}
}

// The DRAFT mirror of TestABackfillShapedRowPassesTheGrainGuard, above.
//
// 1500000134 backfills BOTH placement tables through the same
// app.saveNoValidate() loop (PLACEMENT_TABLES in the migration), and that
// save fires guardDraftAssignmentGrain on lodging_assignments_draft exactly as
// it fires guardAssignmentGrain on lodging_assignments. Only the confirmed
// side had a pin; a change to guardDraftAssignmentGrain that started
// rejecting the backfill's own shape would crash-loop the boot with nothing
// here to catch it first.
//
// guardDraftAssignmentGrain does not gate on `units` at all -- an empty set is
// a row that places nobody, not an error -- so this is really pinning that the
// party grain staged before wireHooks survives the units-only second save
// unharmed. This two-step save is now the main reason the guard must keep
// tolerating an empty set: kindred#1974 retired the tombstone that used to be
// the other one. The genuinely dangerous backfill shape is a row whose party grain
// is NEITHER household nor person: guardDraftAssignmentGrain rejects that
// regardless of units (TestDraftAssignmentGrainXor's "neither household nor
// person" case), so if the migration ever saveNoValidate'd such a row it would
// throw, roll back every pending migration, and crash-loop the boot. Nothing
// here manufactures that row: placementUnits in 1500000134 only calls
// app.saveNoValidate() for a row whose unit/merge/merge_draft target resolved
// to something, and the dev DB holds zero rows with a resolvable target and no
// party grain. Production state is not known (kindred#1917), which is the
// premise the migration's backfill is written around, not something this test
// can close.
func TestABackfillShapedDraftRowPassesTheGrainGuard(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	unit := newUnit(t, app, "ridge-a", "Ridge A")
	// Staged before wiring, standing in for a row written under the old schema.
	row := newDraftAssignment(t, app, nil, 2000001, 0)

	wireHooks(app)

	row.Set("units", []string{unit.Id})
	if err := app.SaveNoValidate(row); err != nil {
		t.Fatalf(
			"1500000134's backfill write must pass guardDraftAssignmentGrain or "+
				"the deploy crash-loops on boot, got: %v", err)
	}
}

// TestDraftAssignmentGrainXor is the backstop for a DIRECT write to the draft
// table, which 1500000132 widened who can make: staff hold bunking.manage on
// lodging_assignments_draft, so a POST straight to the PocketBase REST API
// never passes through PartyGrainRequest._exactly_one_grain in the FastAPI
// schemas. Same reasoning as guardUnitParentCycle, which exists because
// 1500000130 widened who can write lodging_units.
//
// The TARGET rule is deliberately NOT the truth table's, and neither
// 1500000134 nor kindred#1974 changed that. An EMPTY `units` set on a draft row
// is tolerated, which is why guardAssignmentGrain -- which rejects exactly that
// -- cannot simply be re-bound here. It no longer MEANS anything (it was the
// tombstone until #1974 removed the mirror from under a scenario; the API now
// refuses to create one), but 1500000134's two-step backfill and
// deleteRefRecords both produce the shape, so rejecting it would break paths
// this guard does not own. Only the party grain is enforced.
func TestDraftAssignmentGrainXor(t *testing.T) {
	cases := []struct {
		name          string
		unitCount     int
		householdCmID int
		personCmID    int
		wantErr       bool
	}{
		{"household in one room", 1, 2000001, 0, false},
		{"person in one room", 1, 0, 1000001, false},
		{"household across two rooms", 2, 2000001, 0, false},
		// Illegal on the truth table, tolerated here -- see the comment above.
		{"no units at all is tolerated", 0, 2000001, 0, false},
		{"both household and person", 1, 2000001, 1000001, true},
		{"neither household nor person", 1, 0, 0, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatalf("NewTestApp: %v", err)
			}
			defer app.Cleanup()

			setupCollections(t, app)
			unitIDs := newUnits(t, app, tc.unitCount)

			wireHooks(app)

			col, err := app.FindCollectionByNameOrId("lodging_assignments_draft")
			if err != nil {
				t.Fatalf("find lodging_assignments_draft: %v", err)
			}
			r := core.NewRecord(col)
			r.Set("units", unitIDs)
			r.Set("household_cm_id", tc.householdCmID)
			r.Set("person_cm_id", tc.personCmID)
			r.Set("year", 2026)

			saveErr := app.Save(r)
			if tc.wantErr && saveErr == nil {
				t.Fatal("expected the illegal grain combination to be rejected")
			}
			if !tc.wantErr && saveErr != nil {
				t.Fatalf("expected a legal draft row to save, got: %v", saveErr)
			}
		})
	}
}

// Deleting an alias that a resolved queue item points at is the one path that
// SILENCES the work queue permanently. IssueRecorder.Flush writes is_resolved
// only on create (lodging_issues.go), so a re-encountered cabin string updates
// the existing row without reopening it — the string never returns to the
// queue, and the placement never resolves again.
func TestDeletingAnAliasBehindAResolvedIssueIsBlocked(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	alias := newAlias(t, app, "legacy label")
	newResolvedIssue(t, app, "legacy label", alias.Id)

	wireHooks(app)

	if err := app.Delete(alias); err == nil {
		t.Fatal("expected the delete to be blocked, got nil error")
	}
	if _, err := app.FindRecordById("lodging_unit_aliases", alias.Id); err != nil {
		t.Fatalf("alias should still exist after a blocked delete: %v", err)
	}
}

func TestDeletingAnAliasNoIssuePointsAtIsAllowed(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	alias := newAlias(t, app, "unreferenced label")

	wireHooks(app)

	if err := app.Delete(alias); err != nil {
		t.Fatalf("expected an unreferenced alias to delete cleanly, got: %v", err)
	}
}

// The admin UI reopens the queue row before deleting, which both restores the
// work item and clears the reference. That sequence must be permitted, or the
// UI's own delete path is unreachable.
func TestDeletingAnAliasIsAllowedOnceItsIssueIsReopened(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	alias := newAlias(t, app, "legacy label")
	issue := newResolvedIssue(t, app, "legacy label", alias.Id)

	wireHooks(app)

	issue.Set("is_resolved", false)
	issue.Set("resolved_alias", "")
	if err := app.Save(issue); err != nil {
		t.Fatalf("reopen issue: %v", err)
	}

	if err := app.Delete(alias); err != nil {
		t.Fatalf("expected the delete to be allowed once reopened, got: %v", err)
	}
}

// #1899: unitTree.ts filters the picker, but nothing stopped a direct write,
// and 1500000130 widened who can make one. A cycle would hang a descendant
// walk, and the only two walks that exist -- HasParentCycle here and
// descendantIds in unitTree.ts -- both carry visited guards.
func TestSelfParentingAUnitIsBlocked(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	unit := newUnit(t, app, "ridge-a", "Ridge A")

	wireHooks(app)

	unit.Set("parent_unit", unit.Id)
	if err := app.Save(unit); err == nil {
		t.Fatal("expected self-parenting to be blocked, got nil error")
	}
}

func TestAdoptingADescendantAsParentIsBlocked(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	building := newUnit(t, app, "bldg", "Building")
	room := newUnit(t, app, "bldg-1", "Building Room 1")
	room.Set("parent_unit", building.Id)
	if err := app.Save(room); err != nil {
		t.Fatalf("seeding the child link: %v", err)
	}

	wireHooks(app)

	// Building adopting its own child closes a two-node loop.
	building.Set("parent_unit", room.Id)
	if err := app.Save(building); err == nil {
		t.Fatal("expected adopting a descendant to be blocked, got nil error")
	}
}

func TestALegalReparentStillSaves(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	upstairs := newUnit(t, app, "up", "Upstairs")
	downstairs := newUnit(t, app, "down", "Downstairs")
	room := newUnit(t, app, "r1", "Room 1")
	room.Set("parent_unit", upstairs.Id)
	if err := app.Save(room); err != nil {
		t.Fatalf("seeding the child link: %v", err)
	}

	wireHooks(app)

	room.Set("parent_unit", downstairs.Id)
	if err := app.Save(room); err != nil {
		t.Fatalf("moving a leaf between containers must be allowed, got: %v", err)
	}
}

// The guard must judge the WRITE, not the stored state. A unit already sitting
// on a cycle -- data that predates the guard, which it cannot un-write -- still
// has to accept edits that leave parent_unit alone.
//
// Without the diff gate, Confirm and Deactivate both send parent_unit back
// unchanged, HasParentCycle walks the loop that was already there, and the
// PATCH fails with "That parent would create a loop in the unit tree." Bulk
// confirm then reports "Confirmed N of M" with no way to see why, and the only
// escape is clearing parent_unit by hand.
func TestAnEditThatLeavesParentUnitAloneSurvivesAPreExistingCycle(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	a := newUnit(t, app, "loop-a", "Loop A")
	b := newUnit(t, app, "loop-b", "Loop B")

	// Seed the cycle BEFORE wiring, standing in for rows written when no guard
	// existed. a -> b -> a.
	a.Set("parent_unit", b.Id)
	if seedErr := app.Save(a); seedErr != nil {
		t.Fatalf("seeding a->b: %v", seedErr)
	}
	b.Set("parent_unit", a.Id)
	if seedErr := app.Save(b); seedErr != nil {
		t.Fatalf("seeding b->a: %v", seedErr)
	}

	wireHooks(app)

	// Re-read before editing, because that is what the request path does:
	// apis.recordUpdate fetches a fresh record and loads the body onto it, and
	// PocketBase never refreshes originalData after a save. Reusing the record
	// saved above would leave Original() holding its creation-time parent ("")
	// and test a state no HTTP write can produce.
	stored, err := app.FindRecordById(collectionUnits, a.Id)
	if err != nil {
		t.Fatalf("reloading the unit: %v", err)
	}

	// Exactly what the Confirm button sends: one unrelated field, parent_unit
	// untouched.
	stored.Set("is_confirmed", true)
	if err := app.Save(stored); err != nil {
		t.Fatalf("confirming a unit on a pre-existing cycle must be allowed, got: %v", err)
	}

	// The guard still has to bite when the write actually moves parent_unit.
	free := newUnit(t, app, "loop-c", "Loop C")
	free.Set("parent_unit", free.Id)
	if err := app.Save(free); err == nil {
		t.Fatal("expected self-parenting to still be blocked, got nil error")
	}
}

// Routing is not total: a field_zero_values row is party-less and refused by
// BOTH replay entry points (its raw_value names a FIELD, not a cabin string).
// There is a real open one in production today. Ticking it must still
// succeed -- staff corrected something real, regardless of whether a replay
// follows -- and the hook must surface the refusal rather than silently
// dropping it.
func TestReplayRefusalDoesNotBlockTheTick(t *testing.T) {
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{
		EncryptionEnv: "pb_test_env",
		// So app.Logger() prints synchronously (captureStdout's premise) --
		// see its doc comment.
		IsDev: true,
	})
	if err != nil {
		t.Fatalf("NewTestAppWithConfig: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	issue := newIssue(t, app, "field_zero_values", "family_cabin", 2026, 0, 0)

	wireHooks(app)

	output := captureStdout(t, func() {
		issue.Set("is_resolved", true)
		if err := app.Save(issue); err != nil {
			t.Fatalf("expected the tick to succeed despite the replay refusal, got: %v", err)
		}
	})

	if !strings.Contains(output, "Replaying a resolved lodging issue") {
		t.Fatalf("expected the hook to log the replay refusal, got: %q", output)
	}
}

// #1899 CRITICAL: replayOnResolve gated on is_resolved being true, not on the
// TRANSITION to true. Flush (sync/lodging_issues.go:196-198) re-saves an
// already-resolved row every time a replay re-hits the SAME blocker --
// occurrences and last_seen move, is_resolved does not, by design ("once
// staff tick an item, a later sync must not un-tick it"). That re-save is
// itself an update on lodging_ingest_issues, so a hook gated on the current
// value alone fires on its own re-save, replays again, re-saves again,
// forever -- reopenRecorded would break the cycle, but it runs after Flush
// returns, and Flush never returns because it is blocked inside the nested
// Save.
//
// This reproduces the exact write shape of that second half directly, rather
// than waiting for a real fan-out to arrive at it: this schema has none of
// ReplayIssue's supporting collections (persons, attendees, ...), so every
// real invocation of the replay attempt fails at newReplayScope and logs the
// same line deterministically -- which is what makes counting that line a
// reliable stand-in for counting invocations without needing the full sync
// schema or risking an actually-unbounded loop inside a test process.
func TestReplayOnResolveFiresOnceNotOnItsOwnResave(t *testing.T) {
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{
		EncryptionEnv: "pb_test_env",
		IsDev:         true, // so app.Logger() prints synchronously; see captureStdout.
	})
	if err != nil {
		t.Fatalf("NewTestAppWithConfig: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	// Party-scoped, so replayOnResolve routes to sync.ReplayIssue.
	issue := newIssue(t, app, "no_session", "Ridge A 7", 2026, 2000001, 0)

	wireHooks(app)

	const marker = "Replaying a resolved lodging issue"

	output := captureStdout(t, func() {
		// The nightly sync's ROUTINE case, and the one the wasResolved half of
		// the gate alone does not cover: Flush bumping occurrences/last_seen on
		// a row that is still OPEN. False -> false must not replay-attempt at
		// all -- a gate written as "skip only when it WAS already resolved"
		// lets this one through, since wasResolved is false here too, and every
		// re-hit open row would then pay a full ~1-2s newReplayScope on every
		// sync.
		issue.Set("raw_value", "Ridge A 7") // no-op write: same value, still false
		if err := app.Save(issue); err != nil {
			t.Fatalf("touching the still-open issue: %v", err)
		}

		// The staff tick: a real false -> true transition. Every version of
		// the hook, buggy or fixed, must replay-attempt exactly once for this.
		issue.Set("is_resolved", true)
		if err := app.Save(issue); err != nil {
			t.Fatalf("resolving the issue: %v", err)
		}

		// What Flush does to a row a replay re-hits: reload it and save it
		// again with is_resolved UNCHANGED. A gate on the current value alone
		// cannot tell this apart from the first save and replay-attempts again.
		reloaded, err := app.FindRecordById("lodging_ingest_issues", issue.Id)
		if err != nil {
			t.Fatalf("reloading the issue: %v", err)
		}
		reloaded.Set("is_resolved", true) // no-op write: already true
		if err := app.Save(reloaded); err != nil {
			t.Fatalf("re-saving the already-resolved issue: %v", err)
		}
	})

	if got := strings.Count(output, marker); got != 1 {
		t.Fatalf(
			"replayOnResolve replay-attempted %d time(s) across an open-row "+
				"touch, one resolve, and one same-value resave, want 1 (log: %q)",
			got, output)
	}
}

// #1899 CRITICAL, found in the final review: ignoreIngestIssue
// (frontend/src/services/lodgingCrud.ts) resolves a party-less row with
// resolved_alias deliberately left empty -- that emptiness is the marker
// distinguishing an ignore from a mapping. Before this fix, replayOnResolve
// had no check for it: the PATCH is a genuine false -> true transition, so it
// routed straight to ReplayPartylessIssue, which accepts unresolved_alias
// unconditionally. In production that fans out over every party who wrote the
// string, re-fails identically for all of them since no alias exists,
// Flush writes the re-observation onto the row staff just ticked, and
// reopenRecorded flips is_resolved back to false -- staff see a success toast
// and the row is still there.
//
// This schema has none of ReplayPartylessIssue's supporting collections
// (persons, attendees, ...), so a replay attempt that reaches it fails
// deterministically before ever reaching that far -- which is exactly what
// makes counting the replay-attempt log line a reliable stand-in for "was a
// replay attempted at all," the same technique as
// TestReplayRefusalDoesNotBlockTheTick and
// TestReplayOnResolveFiresOnceNotOnItsOwnResave.
func TestIgnoringAPartylessRowDoesNotAttemptAReplay(t *testing.T) {
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{
		EncryptionEnv: "pb_test_env",
		IsDev:         true, // so app.Logger() prints synchronously; see captureStdout.
	})
	if err != nil {
		t.Fatalf("NewTestAppWithConfig: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	// Party-less kind, no resolved_alias -- the exact shape ignoreIngestIssue
	// writes for "not a cabin name."
	issue := newIssue(t, app, "unresolved_alias", "Not A Cabin", 2026, 0, 0)

	wireHooks(app)

	const marker = "Replaying a resolved lodging issue"

	output := captureStdout(t, func() {
		// The ignore: is_resolved goes true, resolved_alias stays untouched
		// (empty), same as ignoreIngestIssue's PATCH body.
		issue.Set("is_resolved", true)
		issue.Set("resolution_note", "Not a cabin name")
		if err := app.Save(issue); err != nil {
			t.Fatalf("ignoring the issue: %v", err)
		}
	})

	if got := strings.Count(output, marker); got != 0 {
		t.Fatalf("ignoring a party-less row attempted %d replay(s), want 0 (log: %q)", got, output)
	}
}

// #1899: the positive control for the two tests above, which the review
// caught was missing. Neither TestIgnoringAPartylessRowDoesNotAttemptAReplay
// nor TestReplayOnResolveFiresOnceNotOnItsOwnResave pins the case where a
// party-less row genuinely IS mapped: the former's issue never gets
// resolved_alias set at all, and the latter is party-scoped. Mutating the
// guard to `if !partyScoped && isPartylessAliasKind` -- skipping replay for
// EVERY party-less alias row, mapped or not -- left both Go suites green,
// silently reverting this PR's headline feature (replay on resolve) to "wait
// for the next sync" for the commonest row shape. This pins the guard's
// negative: it must NOT fire when resolved_alias is set.
func TestMappingAPartylessRowStillAttemptsAReplay(t *testing.T) {
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{
		EncryptionEnv: "pb_test_env",
		IsDev:         true, // so app.Logger() prints synchronously; see captureStdout.
	})
	if err != nil {
		t.Fatalf("NewTestAppWithConfig: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	alias := newAlias(t, app, "Mapped Cabin")
	issue := newIssue(t, app, "unresolved_alias", "Mapped Cabin", 2026, 0, 0)

	wireHooks(app)

	const marker = "Replaying a resolved lodging issue"

	output := captureStdout(t, func() {
		// The map: is_resolved goes true AND resolved_alias is set, same as
		// mapUnresolvedAlias's PATCH body -- unlike the ignore tests above.
		issue.Set("is_resolved", true)
		issue.Set("resolved_alias", alias.Id)
		if err := app.Save(issue); err != nil {
			t.Fatalf("mapping the issue: %v", err)
		}
	})

	if got := strings.Count(output, marker); got != 1 {
		t.Fatalf("mapping a party-less row attempted %d replay(s), want 1 (log: %q)", got, output)
	}
}
