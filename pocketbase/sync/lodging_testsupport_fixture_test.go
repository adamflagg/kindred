package sync

import (
	"encoding/json"
	"fmt"
	"os"
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

// productionField / productionCollection mirror the shape PocketBase's
// /api/collections endpoint returns -- the same shape
// scripts/ci/validate_migrations.py already parses in
// .github/workflows/ci.yml's "Migration Smoke Test" job. Only the field name
// is read here; type/options agreement is a different, narrower problem than
// kindred#1921 (field-name agreement).
type productionField struct {
	Name string `json:"name"`
}

type productionCollection struct {
	Name   string            `json:"name"`
	Fields []productionField `json:"fields"`
}

// loadProductionSchema reads a dump of PocketBase's /api/collections response
// -- booted from the real pocketbase/pb_migrations, no Go fixtures involved
// -- and returns collection name -> set of field names actually present in
// that schema. Tolerates both response shapes load_collections() in
// scripts/ci/validate_migrations.py already tolerates: a bare array, or the
// paginated {"items": [...]} envelope.
func loadProductionSchema(path string) (map[string]map[string]bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	var cols []productionCollection
	if err := json.Unmarshal(raw, &cols); err != nil {
		var envelope struct {
			Items []productionCollection `json:"items"`
		}
		if err2 := json.Unmarshal(raw, &envelope); err2 != nil {
			return nil, fmt.Errorf("%s is neither a bare collections array (%w) "+
				"nor a paginated {items:[...]} envelope (%w)", path, err, err2)
		}
		cols = envelope.Items
	}

	out := make(map[string]map[string]bool, len(cols))
	for _, c := range cols {
		fields := make(map[string]bool, len(c.Fields))
		for _, f := range c.Fields {
			fields[f.Name] = true
		}
		out[c.Name] = fields
	}
	return out, nil
}

// TestLodgingTestsupportFixtureFieldsExistInProductionSchema is kindred#1921's
// guard against the bug class migration 1500000132 hit once already: this
// package's fixtures (newLodgingTestApp, lodging_testsupport_test.go) build
// every collection by hand, so a column a migration drops or renames stays
// present in the fixture -- every filter naming it keeps resolving here while
// production starts rejecting the write with "unknown field ...". Nothing
// else notices, because nothing else compares what the fixture declares
// against the schema the real pb_migrations produce.
//
// Drop/rename direction ONLY: this fails on a field the fixture declares that
// production's real schema does not have. The reverse -- production has a
// field the fixture lacks -- is deliberately out of scope. newLodgingTestApp's
// own doc comment says the fixtures are minimal on purpose, carrying only the
// fields the code under test touches, not a full mirror of every production
// column.
//
// Needs KINDRED_PROD_SCHEMA_JSON: a dump of a real PocketBase's
// /api/collections, booted from pocketbase/pb_migrations with no Go fixture
// involved. Only .github/workflows/ci.yml's "Migration Smoke Test" job
// produces that today, so this test SKIPS everywhere else -- including a
// plain `go test ./...` -- rather than reimplementing the boot a second time.
func TestLodgingTestsupportFixtureFieldsExistInProductionSchema(t *testing.T) {
	schemaPath := os.Getenv("KINDRED_PROD_SCHEMA_JSON")
	if schemaPath == "" {
		t.Skip("KINDRED_PROD_SCHEMA_JSON not set -- this check runs in CI's " +
			"Migration Smoke Test job only (.github/workflows/ci.yml); see kindred#1921")
	}

	prod, err := loadProductionSchema(schemaPath)
	if err != nil {
		t.Fatalf("load production schema from %s: %v", schemaPath, err)
	}
	if len(prod) == 0 {
		t.Fatalf("production schema at %s has no collections -- boot step likely broken", schemaPath)
	}

	app := newLodgingTestApp(t)

	// The exact set newLodgingTestApp builds -- NOT app.FindAllCollections(),
	// which also returns tests.NewTestApp()'s own bundled testdata (a demo
	// "users" collection with username/file/rel, unrelated to production's
	// staff-auth "users" collection). Iterating everything the test app
	// happens to contain would flag that coincidental name collision as a
	// fixture bug it is not.
	fixtureCollections := []string{
		"custom_field_defs", "camp_sessions", "households", "persons", "attendees",
		"family_camp_adults", "household_custom_values", "person_custom_values",
		"lodging_units", "lodging_unit_aliases", "lodging_assignments",
		"lodging_assignment_history", "lodging_ingest_issues", "lodging_field_mappings",
	}

	checked := 0
	for _, name := range fixtureCollections {
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Errorf("newLodgingTestApp no longer builds collection %q -- update fixtureCollections above", name)
			continue
		}
		prodFields, ok := prod[name]
		if !ok {
			t.Errorf("collection %q: fixture builds it, but the production schema has no collection by that name", name)
			continue
		}
		checked++
		for _, f := range col.Fields {
			fieldName := f.GetName()
			if prodFields[fieldName] {
				continue
			}
			t.Errorf("collection %q: fixture declares field %q, which the real "+
				"pb_migrations schema does not have -- dropped or renamed? "+
				"update newLodgingTestApp in lodging_testsupport_test.go",
				name, fieldName)
		}
	}

	if checked != len(fixtureCollections) {
		t.Fatalf("checked %d/%d fixture collections against %s", checked, len(fixtureCollections), schemaPath)
	}
}
