package lodging

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupMultiRelationCollections creates a minimal lodging_units and
// lodging_assignments pair for the units-relation filter spike.
//
// Deliberately separate from setupCollections (hooks_test.go): that fixture
// still carries the single-valued unit/merge fields every other test in this
// package exercises today, and keeps them until the guards that read them are
// rewritten onto `units` (kindred#1931 task 6). This schema declares `units`
// WITHOUT unit/merge so it pins the shape those guards will actually query
// once that lands, rather than a hybrid state production will never have --
// the mirror image of the #1921 failure, where a fixture kept a column
// production had already dropped.
func setupMultiRelationCollections(t *testing.T, app core.App) {
	t.Helper()

	units := core.NewBaseCollection("lodging_units")
	units.Fields.Add(&core.TextField{Name: "code", Required: true})
	units.Fields.Add(&core.TextField{Name: "name", Required: true})
	units.Fields.Add(&core.BoolField{Name: "is_active"})
	if err := app.Save(units); err != nil {
		t.Fatalf("save lodging_units: %v", err)
	}

	unitsCol, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find lodging_units: %v", err)
	}

	assignments := core.NewBaseCollection("lodging_assignments")
	assignments.Fields.Add(&core.RelationField{
		Name: "units", CollectionId: unitsCol.Id, MaxSelect: 20,
	})
	assignments.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	assignments.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	assignments.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(assignments); err != nil {
		t.Fatalf("save lodging_assignments: %v", err)
	}
}

// newAssignmentWithUnits saves an assignment against the units-relation
// schema -- the multi-valued twin of newAssignment (hooks_test.go), which
// still targets the single-valued unit/merge fields.
func newAssignmentWithUnits(
	t *testing.T, app core.App, unitIDs []string, householdCmID, personCmID int,
) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_assignments")
	if err != nil {
		t.Fatalf("find lodging_assignments: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("units", unitIDs)
	r.Set("household_cm_id", householdCmID)
	r.Set("person_cm_id", personCmID)
	r.Set("year", 2026)
	if err := app.Save(r); err != nil {
		t.Fatalf("save assignment: %v", err)
	}
	return r
}

// TestMultiRelationAnyMatchFilter proves how a multi-valued relation is
// filtered before countAssignments depends on one (kindred#1931 task 6). A
// filter that silently matches nothing would make guardUnitDelete
// permissive rather than erroring, so this is a characterisation test of
// PocketBase's filter DSL, not a unit test of our own code.
//
// RESULT: the filter is "units.id ?= {:id}" -- both parts matter, and Task 6
// must use this string verbatim:
//
//   - The `.id` sub-field reference is required. A bare "units" compares
//     against the field's raw stored representation without ever joining
//     into the related collection, so both "units = {:id}" and
//     "units ?= {:id}" -- the operator the plan originally assumed --
//     silently match ZERO rows against a real id. That is exactly the
//     silent-failure shape guardUnitDelete cannot afford (see the package
//     doc and #1921): a same-collection id, e.g. an accidental self-compare,
//     would look identical to "not referenced anywhere."
//   - `?=` ("any of") is required over plain `=` once `.id` is in play:
//     `.id` triggers PocketBase's multi-match JOIN against the related rows,
//     and under a join plain `=` demands ALL joined rows equal the operand
//     (meaningless once a unit set has 2+ members), while `?=` requires only
//     one. "units.id = {:id}" matches zero rows for exactly that reason,
//     confirmed below alongside the working form.
//
// (The LIKE operators "~"/"?~" also returned a match, but only by accident:
// they substring-search the field's raw serialized value, so they would
// false-positive on an id that happens to be a substring of another stored
// id. Not used, for that reason.)
func TestMultiRelationAnyMatchFilter(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupMultiRelationCollections(t, app)

	alpha := newUnit(t, app, "ALPHA", "Alpha")
	bravo := newUnit(t, app, "BRAVO", "Bravo")
	charlie := newUnit(t, app, "CHARLIE", "Charlie")
	holdsAlpha := newAssignmentWithUnits(t, app, []string{alpha.Id, bravo.Id}, 2000001, 0)
	// A sibling row that does NOT hold alpha. Without it, a filter that
	// matched every row regardless of id (or errored into an empty result on
	// the other end) would look identical to a correct one at len(got) == 1.
	newAssignmentWithUnits(t, app, []string{charlie.Id}, 2000002, 0)

	byID := func(id string) []*core.Record {
		t.Helper()
		got, err := app.FindRecordsByFilter(
			"lodging_assignments", "units.id ?= {:id}", "", 0, 0,
			map[string]any{"id": id},
		)
		if err != nil {
			t.Fatalf("filter errored for id %q: %v", id, err)
		}
		return got
	}

	// alpha sits FIRST in the set -- the case Step 1's original assertion
	// alone would cover.
	got := byID(alpha.Id)
	if len(got) != 1 || got[0].Id != holdsAlpha.Id {
		t.Fatalf("units.id ?= alpha: got %d row(s), want exactly %q", len(got), holdsAlpha.Id)
	}

	// bravo sits SECOND. A filter that only inspected index 0 of the array
	// (or a hand-rolled Go loop bug of the same shape) would pass the alpha
	// case above and still miss this one.
	got = byID(bravo.Id)
	if len(got) != 1 || got[0].Id != holdsAlpha.Id {
		t.Fatalf("units.id ?= bravo: got %d row(s), want exactly %q", len(got), holdsAlpha.Id)
	}

	// A unit referenced by NEITHER row must match nothing -- the actual
	// production failure mode: guardUnitDelete calling this on a genuinely
	// unreferenced unit must see 0, or the delete guard can never release one.
	unreferenced := newUnit(t, app, "DELTA", "Delta")
	if got := byID(unreferenced.Id); len(got) != 0 {
		t.Fatalf("units.id ?= an unreferenced unit matched %d row(s), want 0", len(got))
	}

	// Confirms the sibling row's own member (charlie) resolves to ITSELF, not
	// to holdsAlpha -- guards against a filter that matches every row once
	// any array is non-empty.
	got = byID(charlie.Id)
	if len(got) != 1 {
		t.Fatalf("units.id ?= charlie: got %d row(s), want 1", len(got))
	}

	// The operator this plan originally guessed. Recorded as a negative
	// control so a future refactor of this test can't silently drop the
	// evidence for why it was rejected: it must keep matching nothing.
	bare, err := app.FindRecordsByFilter(
		"lodging_assignments", "units ?= {:id}", "", 0, 0,
		map[string]any{"id": alpha.Id},
	)
	if err != nil {
		t.Fatalf("bare units ?= filter errored: %v", err)
	}
	if len(bare) != 0 {
		t.Fatalf(
			"bare \"units ?= {:id}\" unexpectedly matched %d row(s); "+
				"if PocketBase now supports this form, update the RESULT doc "+
				"comment and Task 6 to use it instead of \"units.id ?= {:id}\"",
			len(bare),
		)
	}
}
