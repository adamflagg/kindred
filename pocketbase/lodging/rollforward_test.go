package lodging

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// newRollForwardTestApp reuses setupRegistryCollections (registry_test.go) so
// the roll-forward tests run against the same shape production has: (code,
// year) composite unique indexes on both lodging_areas and lodging_units, per
// 1500000140.
func newRollForwardTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupRegistryCollections(t, app)
	return app
}

// seedYear seeds one self-contained season: 2 areas and 3 units, one of which
// (test-unit-a-room-1) has a parent (test-unit-a) — the minimum shape that
// exercises the area-index pass, the parent-relink pass, and a deny-list
// field (is_confirmed) that must copy verbatim.
func seedYear(t *testing.T, app core.App, year int) {
	t.Helper()

	areasCol, err := app.FindCollectionByNameOrId("lodging_areas")
	if err != nil {
		t.Fatalf("lodging_areas collection: %v", err)
	}
	unitsCol, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("lodging_units collection: %v", err)
	}

	areaA := core.NewRecord(areasCol)
	areaA.Set("code", "test-area-a")
	areaA.Set("name", "Test Area A")
	areaA.Set("year", year)
	if err := app.Save(areaA); err != nil {
		t.Fatalf("save area test-area-a: %v", err)
	}

	areaB := core.NewRecord(areasCol)
	areaB.Set("code", "test-area-b")
	areaB.Set("name", "Test Area B")
	areaB.Set("year", year)
	if err := app.Save(areaB); err != nil {
		t.Fatalf("save area test-area-b: %v", err)
	}

	parent := core.NewRecord(unitsCol)
	parent.Set("area", areaA.Id)
	parent.Set("code", "test-unit-a")
	parent.Set("name", "Test Building A")
	parent.Set("is_confirmed", true)
	parent.Set("year", year)
	if err := app.Save(parent); err != nil {
		t.Fatalf("save unit test-unit-a: %v", err)
	}

	child := core.NewRecord(unitsCol)
	child.Set("area", areaA.Id)
	child.Set("code", "test-unit-a-room-1")
	child.Set("name", "Test Building A, Room 1")
	child.Set("parent_unit", parent.Id)
	child.Set("year", year)
	if err := app.Save(child); err != nil {
		t.Fatalf("save unit test-unit-a-room-1: %v", err)
	}

	other := core.NewRecord(unitsCol)
	other.Set("area", areaB.Id)
	other.Set("code", "test-unit-b")
	other.Set("name", "Test Building B")
	other.Set("year", year)
	if err := app.Save(other); err != nil {
		t.Fatalf("save unit test-unit-b: %v", err)
	}
}

func TestApplyRollForwardCopiesEveryUnitAndArea(t *testing.T) {
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026) // 2 areas, 3 units, one with a parent

	plan, err := ApplyRollForward(app, 2026, 2027)
	if err != nil {
		t.Fatalf("ApplyRollForward: %v", err)
	}
	if plan.UnitsToCreate != 3 || plan.AreasToCreate != 2 {
		t.Errorf("plan = %+v, want 3 units and 2 areas", plan)
	}

	rec, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if err != nil || rec == nil {
		t.Fatalf("unit not carried forward: %v", err)
	}
	if !rec.GetBool("is_confirmed") {
		t.Error("is_confirmed did not carry forward")
	}
}

func TestApplyRollForwardIsIdempotent(t *testing.T) {
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	if _, err := ApplyRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	second, err := ApplyRollForward(app, 2026, 2027)
	if err != nil {
		t.Fatalf("second apply: %v", err)
	}
	if second.UnitsToCreate != 0 {
		t.Errorf("second run created %d units; want 0", second.UnitsToCreate)
	}
	if len(second.SkippedCodes) != 3 {
		t.Errorf("SkippedCodes = %v, want all 3 reported", second.SkippedCodes)
	}
}

func TestApplyRollForwardLinksParentsWithinTheNewYear(t *testing.T) {
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	if _, err := ApplyRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("ApplyRollForward: %v", err)
	}
	child, _ := findByCodeAndYear(app, "lodging_units", "test-unit-a-room-1", 2027)
	parent, _ := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if child == nil || parent == nil {
		t.Fatal("rows missing after roll-forward")
	}
	if got := child.GetString("parent_unit"); got != parent.Id {
		t.Errorf("parent_unit = %q, want the 2027 parent %q", got, parent.Id)
	}
}

func TestApplyRollForwardPreservesCodeAcrossARename(t *testing.T) {
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)
	if _, err := ApplyRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("ApplyRollForward: %v", err)
	}

	rec, _ := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	rec.Set("name", "Test Building A (renamed)")
	if err := app.Save(rec); err != nil {
		t.Fatalf("rename: %v", err)
	}

	// The rename must not have moved the code, which is what links the years.
	again, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if err != nil || again == nil {
		t.Fatal("renaming the building severed it from its code")
	}
}

func TestPreviewRollForwardWritesNothing(t *testing.T) {
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	if _, err := PreviewRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("PreviewRollForward: %v", err)
	}
	rec, _ := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if rec != nil {
		t.Error("preview created a row")
	}
}
