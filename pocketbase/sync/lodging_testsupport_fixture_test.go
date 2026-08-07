package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// TestLodgingUnitsFixtureRejectsDuplicateCodeYear guards the sync package's
// own lodging_units fixture against a shape production migration 1500000141
// makes impossible: two rows sharing (code, year). Without a composite unique
// index a test can seed a collision the real database would refuse -- this
// already bit once during the branch that added year scoping, and it only
// surfaced because lodging/registry_test.go's twin fixture carries the index;
// this package's did not.
func TestLodgingUnitsFixtureRejectsDuplicateCodeYear(t *testing.T) {
	app := newLodgingTestApp(t)
	addUnit(t, app, "dup-code", 2026)

	col, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find collection lodging_units: %v", err)
	}
	dup := core.NewRecord(col)
	dup.Set("code", "dup-code")
	dup.Set("name", "dup-code")
	dup.Set("is_active", true)
	dup.Set("is_container", false)
	dup.Set("year", 2026)
	if err := app.Save(dup); err == nil {
		t.Fatal("saved a second lodging_units row sharing (code, year) 2026; " +
			"want the unique index to refuse it like production does")
	}
}

// TestLodgingUnitsFixtureRejectsYearOutsideProductionRange guards the year
// field's Min/Max/OnlyInt against production (migration 1500000141: min 2010,
// max 2100, onlyInt true). The fixture already marks year Required; without
// the range too, a test can store year: 1 or year: 2025.5 and pass on data
// the real database would reject.
func TestLodgingUnitsFixtureRejectsYearOutsideProductionRange(t *testing.T) {
	app := newLodgingTestApp(t)
	col, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("find collection lodging_units: %v", err)
	}

	cases := []struct {
		label string
		year  any
	}{
		{"below min (2010)", 2009},
		{"above max (2100)", 2101},
		{"non-integer", 2025.5},
	}
	for _, c := range cases {
		rec := core.NewRecord(col)
		rec.Set("code", "range-check")
		rec.Set("name", "range-check")
		rec.Set("is_active", true)
		rec.Set("is_container", false)
		rec.Set("year", c.year)
		if err := app.Save(rec); err == nil {
			t.Errorf("%s: saved year=%v; want the fixture to refuse it like production does", c.label, c.year)
		}
	}
}
