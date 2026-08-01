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
	// member_units, valid_from_year and valid_to_year back sync.AliasResolver,
	// which recheckIllegalMerges uses to re-judge an open illegal_merge row.
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

// newContainerUnit adds a building/grouping unit. JudgeMerge only accepts a
// merge that is the COMPLETE child set of a container, so any merge fixture
// needs one of these as the shared parent.
func newContainerUnit(t *testing.T, app core.App, code, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find lodging_units: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("code", code)
	r.Set("name", name)
	r.Set("is_active", true)
	r.Set("is_container", true)
	if err := app.Save(r); err != nil {
		t.Fatalf("save container %q: %v", code, err)
	}
	return r
}

// newUnitWithParent is newUnit plus the parent_unit link a merge fixture needs.
func newUnitWithParent(t *testing.T, app core.App, code, name, parentID string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find lodging_units: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("code", code)
	r.Set("name", name)
	r.Set("is_active", true)
	r.Set("parent_unit", parentID)
	if err := app.Save(r); err != nil {
		t.Fatalf("save unit %q: %v", code, err)
	}
	return r
}

// newAliasForUnits seeds an alias whose member_units the merge-legality rule
// can resolve and judge -- unlike newAlias, which leaves member_units empty.
func newAliasForUnits(t *testing.T, app core.App, aliasString string, unitIDs []string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_unit_aliases")
	if err != nil {
		t.Fatalf("find lodging_unit_aliases: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("alias_string", aliasString)
	r.Set("member_units", unitIDs)
	if err := app.Save(r); err != nil {
		t.Fatalf("save alias %q: %v", aliasString, err)
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
// and 1500000130 widened who can make one. A cycle hangs both the descendant
// walk and the merge-legality rule, which each follow parent links.
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

// #1899 / spec §3.5: fixing the registry -- not just overriding a single row --
// must drain the queue. Overriding a row writes is_resolved directly; adding a
// missing child to a container writes nothing to lodging_ingest_issues at all,
// so without recheckIllegalMerges this row would stay open forever even after
// the registry is repaired.
func TestRecheckIllegalMergesResolvesARepairedMerge(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	building := newContainerUnit(t, app, "wing", "Wing")
	roomA := newUnitWithParent(t, app, "wing-a", "Wing A", building.Id)
	roomB := newUnitWithParent(t, app, "wing-b", "Wing B", building.Id)
	// roomC is a real, already-registered unit, but not yet a child of the
	// container -- the registry gap the repair below closes.
	roomC := newUnit(t, app, "wing-c", "Wing C")
	newAliasForUnits(t, app, "wing-suite", []string{roomA.Id, roomB.Id, roomC.Id})
	issue := newIssue(t, app, "illegal_merge", "wing-suite", 2026, 2000001, 0)

	wireHooks(app)

	roomC.Set("parent_unit", building.Id)
	if err = app.Save(roomC); err != nil {
		t.Fatalf("repairing the registry: %v", err)
	}

	got, err := app.FindRecordById("lodging_ingest_issues", issue.Id)
	if err != nil {
		t.Fatalf("reloading the issue: %v", err)
	}
	if !got.GetBool("is_resolved") {
		t.Fatal("expected the repaired merge to auto-resolve the queue row")
	}
	if got.GetString("resolution_note") == "" {
		t.Fatal("expected a resolution note explaining the auto-resolve")
	}
}

// The negative case: a merge spanning two containers is not repairable by any
// unit edit, so an unrelated unit save must leave the row exactly alone --
// not resolved, and without a resolution note that would tell staff otherwise.
func TestRecheckIllegalMergesLeavesAStillBrokenMergeAlone(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	buildingOne := newContainerUnit(t, app, "north", "North")
	buildingTwo := newContainerUnit(t, app, "south", "South")
	roomD := newUnitWithParent(t, app, "north-1", "North 1", buildingOne.Id)
	roomE := newUnitWithParent(t, app, "south-1", "South 1", buildingTwo.Id)
	newAliasForUnits(t, app, "cross-campus", []string{roomD.Id, roomE.Id})
	issue := newIssue(t, app, "illegal_merge", "cross-campus", 2026, 2000002, 0)

	wireHooks(app)

	// Touching an unrelated unit must not resolve this row: the merge really
	// is still illegal.
	newUnit(t, app, "unrelated", "Unrelated")

	got, err := app.FindRecordById("lodging_ingest_issues", issue.Id)
	if err != nil {
		t.Fatalf("reloading the issue: %v", err)
	}
	if got.GetBool("is_resolved") {
		t.Fatal("expected the still-broken merge to stay open")
	}
	if got.GetString("resolution_note") != "" {
		t.Fatalf("expected no resolution note, got %q", got.GetString("resolution_note"))
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

// #1899 Important: recheckIllegalMerges pays a filtered issues query plus
// BuildUnitTree plus NewAliasResolver -- three scans -- on every unit write.
// Confirming, renaming, and activating/deactivating a unit cannot change any
// merge's legality: BuildUnitTree reads only parent_unit and is_container.
// confirmLodgingUnits bulk-confirms via Promise.allSettled, so a 93-unit
// confirm is 93 CONCURRENT PATCHes; without this early-out every one of them
// pays the full cost, and if a row has become legal, all 93 race to resolve
// it.
//
// This only binds to the UPDATE path. A create's Original() is blank on every
// field, so the same diff would wrongly skip a create that really does add a
// child to a container -- recheckIllegalMerges stays the unconditional create
// binding.
func TestRecheckIllegalMergesOnUpdateSkipsIrrelevantFields(t *testing.T) {
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{
		EncryptionEnv: "pb_test_env",
		IsDev:         true,
	})
	if err != nil {
		t.Fatalf("NewTestAppWithConfig: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	unit := newUnit(t, app, "ridge-a", "Ridge A")

	wireHooks(app)

	const marker = "Unit tree changed; re-checking illegal merges"

	output := captureStdout(t, func() {
		unit.Set("name", "Ridge A (confirmed)")
		if err := app.Save(unit); err != nil {
			t.Fatalf("renaming the unit: %v", err)
		}
	})
	if strings.Contains(output, marker) {
		t.Fatalf("renaming a unit triggered the expensive recheck: %q", output)
	}

	output = captureStdout(t, func() {
		unit.Set("is_container", true)
		if err := app.Save(unit); err != nil {
			t.Fatalf("marking the unit a container: %v", err)
		}
	})
	if !strings.Contains(output, marker) {
		t.Fatalf("expected changing is_container to trigger the recheck, got: %q", output)
	}
}

// #1899 Important: JudgeMerge alone calls a single-unit set illegal ("a merge
// needs at least two member units") -- correct for JudgeMerge's own job, but
// recheckIllegalMerges called it directly as the FULL legality test, which is
// a second, narrower predicate than the one the sync actually places by.
// placementFor treats a single-unit resolution as automatically legal
// (!res.IsMerge() short-circuits before JudgeMerge is ever called), because a
// resolution to one unit is not a merge at all -- it is a direct placement.
//
// So a legitimate repair -- narrowing an illegal_merge alias down to the one
// unit that actually belongs to it, by editing the alias's member_units
// rather than any unit's parent_unit -- would sync clean but leave the queue
// row open forever, because the old check asked JudgeMerge a question it was
// never designed to answer for this case. sync.PlacementIsLegal is the one
// predicate both callers now share.
func TestRecheckIllegalMergesAcceptsANarrowedSingleUnitRepair(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	building := newContainerUnit(t, app, "wing", "Wing")
	roomA := newUnitWithParent(t, app, "wing-a", "Wing A", building.Id)
	// The repair: the alias used to name a second unit that turned out not to
	// belong to this string at all, so staff narrowed member_units down to
	// roomA alone -- not a merge, a plain single-room resolution.
	newAliasForUnits(t, app, "wing-suite", []string{roomA.Id})
	issue := newIssue(t, app, "illegal_merge", "wing-suite", 2026, 2000003, 0)

	wireHooks(app)

	// The alias edit itself has no unit write to hang the recheck hook off,
	// so trigger it the way any other unrelated unit create would (the create
	// binding always runs the full recheck; see the doc comment above).
	newUnit(t, app, "trigger", "Trigger")

	got, err := app.FindRecordById("lodging_ingest_issues", issue.Id)
	if err != nil {
		t.Fatalf("reloading the issue: %v", err)
	}
	if !got.GetBool("is_resolved") {
		t.Fatal("expected a repair narrowed to a single legal unit to resolve the row")
	}
}
