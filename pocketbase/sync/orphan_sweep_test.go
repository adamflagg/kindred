package sync

import (
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"

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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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

// TestBaseDeleteOrphansDeletesNothingWhenNoRecordCanBeKeyed pins the blind spot
// behind the unkeyable-record warning. Several getIDFuncs build their key from a
// lookup map -- attendees from camp_sessions, bunk_plans from bunks and
// camp_sessions -- so a collapsed lookup makes EVERY row unkeyable rather than
// orphaned. Unkeyable is not orphaned: nothing may be deleted, and the guard
// never sees these rows because they were never deletion candidates.
func TestBaseDeleteOrphansDeletesNothingWhenNoRecordCanBeKeyed(t *testing.T) {
	t.Parallel()
	const seeded = 50

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

	b := BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, SyncSuccessful: true}

	err = b.DeleteOrphansGuarded(
		"widgets",
		// The lookup this key depends on came back empty.
		func(*core.Record) (string, bool) { return "", false },
		"widget",
		"year = 2026",
		OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: 0},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- a record the sweep cannot key is not an orphan "+
			"and must never be deleted", remaining, seeded)
	}
}

// ---------------------------------------------------------------------------
// Observability of a collapsed sweep (kindred#2279 follow-up)
// ---------------------------------------------------------------------------

// captureSweepLogs redirects slog for the duration of one test and returns the
// buffer. The sweep's only operator-facing signal is its log line, so the log IS
// the behavior under test here, not an incidental side effect.
func captureSweepLogs(t *testing.T) *strings.Builder {
	t.Helper()

	buf := &strings.Builder{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	return buf
}

// A sweep whose getIDFunc can key nothing at all is a collapsed upstream, not a
// clean year. It currently logs "No orphaned records found" -- identical to a
// healthy run -- and the guard cannot fire, because the guard's denominator only
// counts rows that WERE keyable and so is zero. Three services' operator hints
// (attendees, bunk_assignments, bunk_plans) tell the reader to look for an
// unkeyable-record warning, so one has to exist.
func TestBaseDeleteOrphansWarnsWhenNothingCanBeKeyed(t *testing.T) {
	t.Parallel()
	const seeded = 30

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

	logs := captureSweepLogs(t)

	b := BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, SyncSuccessful: true}
	err = b.DeleteOrphansGuarded(
		"widgets",
		func(*core.Record) (string, bool) { return "", false },
		"widget",
		"year = 2026",
		OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: 0},
	)
	if err != nil {
		t.Fatalf("sweep returned an error: %v", err)
	}

	got := logs.String()
	if !strings.Contains(got, "unkeyable") {
		t.Errorf("expected an unkeyable-record warning naming the collapse; got:\n%s", got)
	}
	if !strings.Contains(got, "level=WARN") {
		t.Errorf("the unkeyable case must be a WARN, not an Info; got:\n%s", got)
	}
	if strings.Contains(got, "No orphaned records found") {
		t.Errorf("a collapsed sweep must not report the healthy-run message; got:\n%s", got)
	}
}

// orphanCount is what the completion log reports as deleted. A delete that FAILS
// must not be counted: the row is still on disk, and an operator reading
// "Deleted orphaned records count=1" against a row that still exists has been
// told the opposite of the truth. A blocking relation is the cheapest way to
// make App.Delete fail for real rather than mocking it.
func TestBaseDeleteOrphansCountsOnlyCompletedDeletes(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "widgets", "name")
	widgets, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}

	orphan := core.NewRecord(widgets)
	orphan.Id = orphanTestID(1)
	orphan.Set("name", "widget-001")
	orphan.Set("year", 2026)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("seed orphan: %v", saveErr)
	}

	// A non-cascading relation pointing at the orphan blocks its deletion.
	holders := core.NewBaseCollection("holders")
	holders.Fields.Add(&core.RelationField{
		Name: "widget", CollectionId: widgets.Id, CascadeDelete: false, Required: true,
	})
	if saveErr := app.Save(holders); saveErr != nil {
		t.Fatalf("save holders: %v", saveErr)
	}
	holder := core.NewRecord(holders)
	holder.Set("widget", orphan.Id)
	if saveErr := app.Save(holder); saveErr != nil {
		t.Fatalf("seed holder: %v", saveErr)
	}

	logs := captureSweepLogs(t)

	b := BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, SyncSuccessful: true}
	if sweepErr := b.DeleteOrphans(
		"widgets",
		func(r *core.Record) (string, bool) { return r.Id, true },
		"widget",
		"year = 2026",
	); sweepErr != nil {
		t.Fatalf("sweep returned an error: %v", sweepErr)
	}

	// The row must still be there -- otherwise the fixture did not block anything
	// and the assertion below would pass for the wrong reason.
	if _, findErr := app.FindRecordById("widgets", orphan.Id); findErr != nil {
		t.Fatalf("fixture is wrong: the delete was not blocked (%v)", findErr)
	}

	if got := logs.String(); strings.Contains(got, "Deleted orphaned records") {
		t.Errorf("a failed delete was counted as deleted; got:\n%s", got)
	}
}

// orphanCount is what the completion log reports as deleted, same property as
// TestBaseDeleteOrphansCountsOnlyCompletedDeletes above but for the preloaded
// entry point (kindred#2302) -- financial_transactions is the one production
// caller. A delete that FAILS must not be counted: the row is still on disk.
func TestBaseDeleteOrphansFromPreloadedCountsOnlyCompletedDeletes(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "widgets", "name")
	widgets, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}

	orphan := core.NewRecord(widgets)
	orphan.Id = orphanTestID(1)
	orphan.Set("name", "widget-001")
	orphan.Set("year", 2026)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("seed orphan: %v", saveErr)
	}

	// A non-cascading relation pointing at the orphan blocks its deletion.
	holders := core.NewBaseCollection("holders")
	holders.Fields.Add(&core.RelationField{
		Name: "widget", CollectionId: widgets.Id, CascadeDelete: false, Required: true,
	})
	if saveErr := app.Save(holders); saveErr != nil {
		t.Fatalf("save holders: %v", saveErr)
	}
	holder := core.NewRecord(holders)
	holder.Set("widget", orphan.Id)
	if saveErr := app.Save(holder); saveErr != nil {
		t.Fatalf("seed holder: %v", saveErr)
	}

	logs := captureSweepLogs(t)

	b := BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, SyncSuccessful: true}
	preloaded := map[any]*core.Record{orphan.Id: orphan}
	if sweepErr := b.DeleteOrphansFromPreloaded(preloaded, "widget"); sweepErr != nil {
		t.Fatalf("sweep returned an error: %v", sweepErr)
	}

	// The row must still be there -- otherwise the fixture did not block anything
	// and the assertion below would pass for the wrong reason.
	if _, findErr := app.FindRecordById("widgets", orphan.Id); findErr != nil {
		t.Fatalf("fixture is wrong: the delete was not blocked (%v)", findErr)
	}

	if got := logs.String(); strings.Contains(got, "Deleted orphaned records") {
		t.Errorf("a failed delete was counted as deleted; got:\n%s", got)
	}
}

// ---------------------------------------------------------------------------
// The scan must not mint a new filter string per page (kindred#2279 follow-up)
// ---------------------------------------------------------------------------

// filterSpyApp records every filter string the sweep issues. Embedding core.App
// means only the one method is overridden and everything else behaves normally.
type filterSpyApp struct {
	core.App
	filters []string
}

func (a *filterSpyApp) FindRecordsByFilter(
	collectionModelOrIdentifier any,
	filter string,
	sort string,
	limit int,
	offset int,
	params ...dbx.Params,
) ([]*core.Record, error) {
	a.filters = append(a.filters, filter)
	//nolint:wrapcheck // a transparent test double: wrapping would change what the caller sees
	return a.App.FindRecordsByFilter(collectionModelOrIdentifier, filter, sort, limit, offset, params...)
}

// PocketBase substitutes {:params} into the filter string BEFORE parsing it and
// then uses the substituted string as a cache key (tools/search/filter.go:78,82),
// storing it in the package-level parsedFilterData store with a hard cap of 500
// and no eviction (tools/store/store.go:218). So a scan that puts a per-page
// cursor in the filter mints one dead cache entry per page: ~1,553 of them for a
// single year of person_custom_values. Once 500 accumulate, NO filter expression
// anywhere in the process can be cached again for the life of the container --
// every API list request re-parses from scratch.
//
// The paging cursor therefore must not travel in the filter string.
func TestSweepDoesNotMintAFilterStringPerPage(t *testing.T) {
	t.Parallel()
	const seeded = 1200

	base := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, base, "person_custom_values", "person", "pers_0000000001", 2026, seeded)

	spy := &filterSpyApp{App: base}

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            spy,
		ProcessedKeys:  make(map[string]bool),
		SyncSuccessful: true,
	}}
	for i := 1; i <= seeded; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	if err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	distinct := map[string]bool{}
	for _, f := range spy.filters {
		distinct[f] = true
	}

	if len(spy.filters) < 2 {
		t.Fatalf("fixture is wrong: the scan issued %d queries, so it never paged", len(spy.filters))
	}
	if len(distinct) != 1 {
		t.Errorf("the scan issued %d queries using %d DISTINCT filter strings; want 1. "+
			"Filters seen: %v", len(spy.filters), len(distinct), distinct)
	}

	// The stricter half, and the one that actually bites. PocketBase substitutes
	// {:params} into the raw filter BEFORE deriving the cache key, so a filter
	// carrying a per-page placeholder yields a DIFFERENT key on every page even
	// though the string handed to FindRecordsByFilter never changes. A constant
	// filter is only safe if it is also placeholder-free.
	for f := range distinct {
		if strings.Contains(f, "{:") {
			t.Errorf("the scan's filter carries a parameter placeholder (%q). PocketBase "+
				"substitutes it before building the cache key, so each page still mints a "+
				"distinct permanent cache entry -- the cursor must not travel in the filter", f)
		}
	}
}
