package sync

import (
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// newOrphanSweepTestApp returns a test app holding one collection shaped like a
// year-scoped CampMinder table.
func newOrphanSweepTestApp(t *testing.T, collection string, fields ...string) core.App {
	t.Helper()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection(collection)
	for _, f := range fields {
		col.Fields.Add(&core.TextField{Name: f})
	}
	col.Fields.Add(&core.NumberField{Name: "year"})
	// The pre-fix BaseSyncService.DeleteOrphans sorts on "created"; the field has
	// to exist for that path to run at all.
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save %s: %v", collection, saveErr)
	}

	return app
}

// bulkInsertRowsFrom writes rows [from, to] for one owner. Splitting the range
// out lets a fixture hold two owners without their IDs colliding.
func bulkInsertRowsFrom(t *testing.T, app core.App, collection, ownerCol, owner string, year, from, to int) {
	t.Helper()

	var b strings.Builder
	fmt.Fprintf(&b, "INSERT INTO {{%s}} (id, %s, field_definition, value, year) VALUES ", collection, ownerCol)
	for i := from; i <= to; i++ {
		if i > from {
			b.WriteString(",")
		}
		fmt.Fprintf(&b, "('%s', '%s', 'fd%06d', '', %d)", orphanTestID(i), owner, i, year)
	}

	if _, err := app.DB().NewQuery(b.String()).Execute(); err != nil {
		t.Fatalf("bulk insert rows %d-%d into %s: %v", from, to, collection, err)
	}
}

// bulkInsertRows writes n rows straight to SQLite. Going through app.Save() for
// five figures of rows takes minutes; the sweep reads the table, so a raw insert
// is indistinguishable from its point of view. IDs are zero-padded so the row
// order the sweep walks is deterministic.
func bulkInsertRows(t *testing.T, app core.App, collection, ownerCol, owner string, year, n int) {
	t.Helper()
	bulkInsertRowsFrom(t, app, collection, ownerCol, owner, year, 1, n)
}

// orphanTestID builds a 15-character, lexicographically sortable record ID.
func orphanTestID(i int) string {
	return fmt.Sprintf("r%014d", i)
}

func countRows(t *testing.T, app core.App, collection, filter string) int {
	t.Helper()
	recs, err := app.FindRecordsByFilter(collection, filter, "", 0, 0)
	if err != nil {
		t.Fatalf("re-query %s: %v", collection, err)
	}
	return len(recs)
}

// ---------------------------------------------------------------------------
// Part 3 -- BaseSyncService.DeleteOrphans offset pagination skips records
// ---------------------------------------------------------------------------

// TestBaseDeleteOrphansInspectsEveryRecordWhileDeleting pins the offset bug at
// base_sync.go. The loop reads page N at offset (N-1)*perPage and deletes inside
// the loop, so every delete shrinks the result set under the next page's offset
// and slides that many unread records past the cursor forever.
//
// The fixture is deliberately just over one page: 150 rows, of which exactly one
// (the last) was processed and must survive. A correct sweep deletes 149 and
// keeps 1. The offset implementation deletes the first page, then asks for
// offset 100 of a 50-row table, gets nothing back, and stops.
func TestBaseDeleteOrphansInspectsEveryRecordWhileDeleting(t *testing.T) {
	const seeded = 150

	app := newOrphanSweepTestApp(t, "widgets", "name")
	col, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}

	for i := 1; i <= seeded; i++ {
		rec := core.NewRecord(col)
		rec.Id = orphanTestID(i)
		rec.Set("name", fmt.Sprintf("widget-%03d", i))
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed widget %d: %v", i, saveErr)
		}
	}

	b := BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{fmt.Sprintf("%d|2026", seeded): true},
		SyncSuccessful: true,
	}

	err = b.DeleteOrphans(
		"widgets",
		func(record *core.Record) (string, bool) {
			name := record.GetString("name")
			var n int
			if _, scanErr := fmt.Sscanf(name, "widget-%d", &n); scanErr != nil {
				return "", false
			}
			return fmt.Sprintf("%d|2026", n), true
		},
		"widget",
		"year = 2026",
	)
	if err != nil {
		t.Fatalf("DeleteOrphans: %v", err)
	}

	remaining := countRows(t, app, "widgets", "year = 2026")
	if remaining != 1 {
		t.Fatalf("%d rows survived, want 1 -- every record past the first page was "+
			"skipped, so an orphan that CampMinder deleted stays in PocketBase forever", remaining)
	}

	survivor, err := app.FindRecordById("widgets", orphanTestID(seeded))
	if err != nil {
		t.Fatalf("the one processed record was deleted: %v", err)
	}
	if survivor.GetString("name") != fmt.Sprintf("widget-%03d", seeded) {
		t.Errorf("wrong survivor: %q", survivor.GetString("name"))
	}
}

// ---------------------------------------------------------------------------
// Part 1 -- kindred#2266: the 10,000-row hard cap
// ---------------------------------------------------------------------------

// TestPersonCustomFieldValuesDeleteOrphansSweepsPastTheTenThousandCap pins
// kindred#2266. Production years hold 128,606-184,458 rows; the sweep asked for
// 10,000 with no surrounding loop, so 94% of the year was unreachable and a
// value deleted in CampMinder was never removed.
//
// The fixture is 10,050 rows for one person: the first 10,000 are still
// computed, the last 50 are orphans that only a paginated sweep can reach.
func TestPersonCustomFieldValuesDeleteOrphansSweepsPastTheTenThousandCap(t *testing.T) {
	const (
		seeded   = 10050
		computed = 10000
	)

	app := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, app, "person_custom_values", "person", "pers_0000000001", 2026, seeded)

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  make(map[string]bool),
		SyncSuccessful: true,
	}}
	for i := 1; i <= computed; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	if err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	remaining := countRows(t, app, "person_custom_values", "year = 2026")
	if remaining != computed {
		t.Fatalf("%d rows survived, want %d -- the sweep never reached past its 10,000-row cap, "+
			"so %d values deleted in CampMinder stayed in PocketBase",
			remaining, computed, remaining-computed)
	}
}

// TestHouseholdCustomFieldValuesDeleteOrphansSweepsPastTheTenThousandCap is the
// latent twin from kindred#2266: identical statement, identical cap, smaller
// table today.
func TestHouseholdCustomFieldValuesDeleteOrphansSweepsPastTheTenThousandCap(t *testing.T) {
	const (
		seeded   = 10050
		computed = 10000
	)

	app := newOrphanSweepTestApp(t, "household_custom_values", "household", "field_definition", "value")
	bulkInsertRows(t, app, "household_custom_values", "household", "hh_00000000001", 2026, seeded)

	s := &HouseholdCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  make(map[string]bool),
		SyncSuccessful: true,
	}}
	for i := 1; i <= computed; i++ {
		s.ProcessedKeys[fmt.Sprintf("hh_00000000001:fd%06d|2026", i)] = true
	}

	if err := s.deleteOrphans(2026, map[string]bool{"hh_00000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	remaining := countRows(t, app, "household_custom_values", "year = 2026")
	if remaining != computed {
		t.Fatalf("%d rows survived, want %d -- the sweep never reached past its 10,000-row cap",
			remaining, computed)
	}
}
