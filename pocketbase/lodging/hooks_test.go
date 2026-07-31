package lodging

import (
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
	if err := app.Save(units); err != nil {
		t.Fatalf("save lodging_units: %v", err)
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
