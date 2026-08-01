package lodging

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupCollections creates minimal lodging_units, lodging_merges and
// lodging_assignments collections in the test app — only the fields the
// guards read. The production schema has many more.
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
	// (via this `:=`) all the way to the `merges` block's own `if err :=`
	// below and turn that pre-existing line into a govet shadow report.
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

	merges := core.NewBaseCollection("lodging_merges")
	merges.Fields.Add(&core.TextField{Name: "display_name"})
	if err := app.Save(merges); err != nil {
		t.Fatalf("save lodging_merges: %v", err)
	}

	unitsCol, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find lodging_units: %v", err)
	}
	mergesCol, err := app.FindCollectionByNameOrId("lodging_merges")
	if err != nil {
		t.Fatalf("find lodging_merges: %v", err)
	}

	assignments := core.NewBaseCollection("lodging_assignments")
	assignments.Fields.Add(&core.RelationField{
		Name: "unit", CollectionId: unitsCol.Id, MaxSelect: 1,
	})
	assignments.Fields.Add(&core.RelationField{
		Name: "merge", CollectionId: mergesCol.Id, MaxSelect: 1,
	})
	assignments.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	assignments.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	assignments.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(assignments); err != nil {
		t.Fatalf("save lodging_assignments: %v", err)
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
	}()

	fn()
	return ""
}

func newMerge(t *testing.T, app core.App, displayName string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_merges")
	if err != nil {
		t.Fatalf("find lodging_merges: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("display_name", displayName)
	if err := app.Save(r); err != nil {
		t.Fatalf("save merge %q: %v", displayName, err)
	}
	return r
}

// newAssignment saves an assignment WITHOUT the guards attached, so tests can
// stage the state a guard is supposed to protect.
func newAssignment(t *testing.T, app core.App, unitID, mergeID string, householdCmID, personCmID int) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_assignments")
	if err != nil {
		t.Fatalf("find lodging_assignments: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("unit", unitID)
	r.Set("merge", mergeID)
	r.Set("household_cm_id", householdCmID)
	r.Set("person_cm_id", personCmID)
	r.Set("year", 2026)
	if err := app.Save(r); err != nil {
		t.Fatalf("save assignment: %v", err)
	}
	return r
}

func TestDeletingAUnitWithAnAssignmentIsBlocked(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	unit := newUnit(t, app, "ridge-a", "Ridge A")
	newAssignment(t, app, unit.Id, "", 2000001, 0)

	wireHooks(app)

	if err := app.Delete(unit); err == nil {
		t.Fatal("expected the delete to be blocked, got nil error")
	}
	if _, err := app.FindRecordById("lodging_units", unit.Id); err != nil {
		t.Fatalf("unit should still exist after a blocked delete: %v", err)
	}
}

func TestDeletingAnUnusedUnitIsAllowed(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	unit := newUnit(t, app, "ridge-b", "Ridge B")

	wireHooks(app)

	if err := app.Delete(unit); err != nil {
		t.Fatalf("expected an unreferenced unit to delete cleanly, got: %v", err)
	}
}

func TestDeletingAnOccupiedMergeIsBlocked(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	merge := newMerge(t, app, "Wawona")
	newAssignment(t, app, "", merge.Id, 2000001, 0)

	wireHooks(app)

	if err := app.Delete(merge); err == nil {
		t.Fatal("expected unmerge to be blocked while a party occupies the slot")
	}
}

func TestDeletingAnEmptyMergeIsAllowed(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	merge := newMerge(t, app, "Tenaya 1and2")

	wireHooks(app)

	if err := app.Delete(merge); err != nil {
		t.Fatalf("expected an unoccupied merge to unmerge cleanly, got: %v", err)
	}
}

func TestAssignmentGrainXor(t *testing.T) {
	cases := []struct {
		name          string
		unitSet       bool
		mergeSet      bool
		householdCmID int
		personCmID    int
		wantErr       bool
	}{
		{"household on a unit", true, false, 2000001, 0, false},
		{"person on a unit", true, false, 0, 1000001, false},
		{"household on a merge", false, true, 2000001, 0, false},
		{"neither unit nor merge", false, false, 2000001, 0, true},
		{"both unit and merge", true, true, 2000001, 0, true},
		{"both household and person", true, false, 2000001, 1000001, true},
		{"neither household nor person", true, false, 0, 0, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatalf("NewTestApp: %v", err)
			}
			defer app.Cleanup()

			setupCollections(t, app)
			unitID := ""
			if tc.unitSet {
				unitID = newUnit(t, app, "ridge-a", "Ridge A").Id
			}
			mergeID := ""
			if tc.mergeSet {
				mergeID = newMerge(t, app, "Wawona").Id
			}

			wireHooks(app)

			col, err := app.FindCollectionByNameOrId("lodging_assignments")
			if err != nil {
				t.Fatalf("find lodging_assignments: %v", err)
			}
			r := core.NewRecord(col)
			r.Set("unit", unitID)
			r.Set("merge", mergeID)
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
	issue := newIssue(t, app, "no_session", "Tuolumne 7", 2026, 2000001, 0)

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
		issue.Set("raw_value", "Tuolumne 7") // no-op write: same value, still false
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
