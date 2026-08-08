package sync

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
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

// productionSchemaEnvelope mirrors the paginated shape PocketBase's
// /api/collections endpoint actually returns. Confirmed empirically against
// the pinned v0.39.10 binary (built from this repo's own pb_migrations):
// it is always this envelope, never a bare array. scripts/ci/validate_migrations.py
// also tolerates a bare array, but that's a different, Python caller with its
// own history -- there is no bare-array code path here to keep in sync with.
type productionSchemaEnvelope struct {
	Items      []productionCollection `json:"items"`
	Page       int                    `json:"page"`
	PerPage    int                    `json:"perPage"`
	TotalItems int                    `json:"totalItems"`
	TotalPages int                    `json:"totalPages"`
}

// loadProductionSchema reads a dump of PocketBase's /api/collections response
// -- booted from the real pocketbase/pb_migrations, no Go fixtures involved
// -- and returns collection name -> set of field names actually present in
// that schema.
func loadProductionSchema(path string) (map[string]map[string]bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	var envelope productionSchemaEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("parse %s as a paginated {items:[...]} envelope: %w", path, err)
	}
	// envelope.Items stays nil (not just empty) when the JSON has no "items"
	// key at all -- Go's json package doesn't error on an unrecognized
	// shape, it just leaves unmatched fields at their zero value. Without
	// this check, a genuinely malformed document (e.g. a PocketBase error
	// body: {"code":400,"message":"..."}) would unmarshal "successfully"
	// into an empty envelope, and the caller would see a confusing
	// "no collections" failure instead of the real parse error.
	if envelope.Items == nil {
		return nil, fmt.Errorf("%s has no \"items\" key -- not a valid /api/collections "+
			"response (got a %d-byte body)", path, len(raw))
	}
	// The ci.yml curl call that produces this dump has already truncated it
	// silently once, when the request had no perPage at all and PocketBase's
	// default page size (30) cut off the real ~69 collections (kindred#1921's
	// own history). Bumping perPage to a bigger literal only pushes the same
	// failure mode further out -- it recreates itself the moment collection
	// count grows past whatever number is hardcoded there. totalItems is
	// PocketBase's own count of everything that request could have returned,
	// so comparing it against what was actually read catches truncation
	// structurally, at any perPage, rather than trusting the literal.
	if len(envelope.Items) < envelope.TotalItems {
		return nil, fmt.Errorf("%s is truncated: got %d of %d total collections "+
			"(page=%d perPage=%d totalPages=%d) -- raise perPage in the curl call "+
			"that produced this dump (.github/workflows/ci.yml)",
			path, len(envelope.Items), envelope.TotalItems,
			envelope.Page, envelope.PerPage, envelope.TotalPages)
	}

	out := make(map[string]map[string]bool, len(envelope.Items))
	for _, c := range envelope.Items {
		fields := make(map[string]bool, len(c.Fields))
		for _, f := range c.Fields {
			fields[f.Name] = true
		}
		out[c.Name] = fields
	}
	return out, nil
}

// TestLoadProductionSchema exercises loadProductionSchema directly against
// small in-memory fixtures rather than a real PocketBase boot, so these run
// everywhere (no KINDRED_PROD_SCHEMA_JSON skip) and fail fast on the parsing
// contract itself, separate from TestLodgingTestsupportFixtureFieldsExist...
// below, which needs the full CI boot to exercise the comparison it guards.
func TestLoadProductionSchema(t *testing.T) {
	write := func(t *testing.T, body string) string {
		t.Helper()
		path := filepath.Join(t.TempDir(), "collections.json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
		return path
	}

	t.Run("complete envelope parses", func(t *testing.T) {
		path := write(t, `{"page":1,"perPage":1000,"totalItems":1,"totalPages":1,"items":[
			{"name":"lodging_units","fields":[{"name":"code"},{"name":"year"}]}
		]}`)
		schema, err := loadProductionSchema(path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !schema["lodging_units"]["year"] {
			t.Fatalf("expected lodging_units.year in the parsed schema, got %v", schema)
		}
	})

	// totalItems says 69 collections exist; the dump only carries 1 -- the
	// exact shape a perPage that's too small produces. This is the class of
	// bug this repo already hit once for real: the ci.yml curl call had no
	// perPage at all, silently truncating the dump to PocketBase's default
	// page size (30) of the real ~69 collections (see this file's git
	// history and kindred#1921). A hardcoded perPage, however generous,
	// recreates the same trap the moment collection count grows past it;
	// this test pins the fix -- checking totalItems against what was
	// actually returned -- rather than trusting the number in ci.yml.
	t.Run("truncated envelope is rejected, not silently accepted", func(t *testing.T) {
		path := write(t, `{"page":1,"perPage":1,"totalItems":69,"totalPages":69,"items":[
			{"name":"lodging_units","fields":[{"name":"code"}]}
		]}`)
		_, err := loadProductionSchema(path)
		if err == nil {
			t.Fatal("expected an error for a dump reporting totalItems=69 but carrying only 1 item, got nil")
		}
	})

	t.Run("malformed response body is rejected, not read as zero collections", func(t *testing.T) {
		path := write(t, `{"code":400,"message":"something went wrong"}`)
		_, err := loadProductionSchema(path)
		if err == nil {
			t.Fatal("expected an error for a non-collections response body, got nil")
		}
	})
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

	// A bare, un-fixtured app carries tests.NewTestApp()'s own bundled
	// testdata -- e.g. a demo "users" collection with username/file/rel,
	// unrelated to production's staff-auth "users" collection. Diffing
	// newLodgingTestApp's collections against THIS baseline -- rather than a
	// hardcoded list of names newLodgingTestApp happens to build today -- is
	// what keeps this test honest as that function grows: a collection added
	// there later is picked up automatically, with no allowlist to remember
	// to update. Iterating app.FindAllCollections() without this diff would
	// flag the "users" name collision as fixture drift it is not.
	baseline, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("new baseline test app: %v", err)
	}
	t.Cleanup(baseline.Cleanup)
	baselineCols, err := baseline.FindAllCollections()
	if err != nil {
		t.Fatalf("list baseline collections: %v", err)
	}
	baselineNames := make(map[string]bool, len(baselineCols))
	for _, c := range baselineCols {
		baselineNames[c.Name] = true
	}

	app := newLodgingTestApp(t)
	fixtureCols, err := app.FindAllCollections()
	if err != nil {
		t.Fatalf("list fixture collections: %v", err)
	}

	checked := 0
	for _, col := range fixtureCols {
		if baselineNames[col.Name] {
			continue // part of tests.NewTestApp()'s own bundled testdata, not something newLodgingTestApp added
		}
		prodFields, ok := prod[col.Name]
		if !ok {
			t.Errorf("collection %q: fixture builds it, but the production schema has no collection by that name", col.Name)
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
				col.Name, fieldName)
		}
	}

	if checked == 0 {
		t.Fatalf("compared zero collections against %s -- newLodgingTestApp and the "+
			"baseline test app collection sets came out identical", schemaPath)
	}
}
