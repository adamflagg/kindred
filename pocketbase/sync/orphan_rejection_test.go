package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// The tests in this file pin kindred#2295: rejecting a record must stop deleting
// its row.
//
// The mechanism is an ordering, and it is the same in every service that
// rejects. From financial_lookups.go:
//
//	pbData, err := s.transformFinancialCategoryToPB(data)
//	if err != nil {
//	    s.Stats.Rejected++
//	    continue                  // <-- jumps past the tracking below
//	}
//	...
//	s.TrackProcessedKey(cmID, 0)  // only reached by records that survived
//	...
//	s.DeleteOrphans("financial_categories", ...)   // deletes everything untracked
//
// The `continue` skips TrackProcessedKey, so the rejected record's key is absent
// from the processed set, so the sweep reads its existing row as an orphan and
// removes it. A record that fails to transform this run costs the good value
// stored by the last one.
//
// Every test here therefore asserts about ROWS ON DISK, not about what the guard
// returned. "The guard refused" is not the property that matters; "the row is
// still there" is.

// widgetKey mirrors the CompositeKey shape the real getIDFuncs build.
func widgetKey(n int) string { return fmt.Sprintf("%d|2026", n) }

// seedWidgets writes n rows named widget-001..widget-00n.
func seedWidgets(t *testing.T, app core.App, n int) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}
	for i := 1; i <= n; i++ {
		rec := core.NewRecord(col)
		rec.Id = orphanTestID(i)
		rec.Set("name", fmt.Sprintf("widget-%03d", i))
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed widget %d: %v", i, saveErr)
		}
	}
}

// widgetIDFunc keys a seeded widget row the way a real service's getIDFunc does.
func widgetIDFunc(record *core.Record) (string, bool) {
	var n int
	if _, err := fmt.Sscanf(record.GetString("name"), "widget-%d", &n); err != nil {
		return "", false
	}
	return widgetKey(n), true
}

// rejectingSweepFixture builds the exact situation a rejecting run leaves behind:
// `seeded` rows on disk, every key tracked except the rejected record's (30) and
// a genuine orphan (40) that CampMinder really did delete.
const (
	rejectedWidget = 30
	orphanWidget   = 40
	seededWidgets  = 50
)

func rejectingSweepFixture(t *testing.T, rejected int) (core.App, BaseSyncService) {
	t.Helper()

	app := newOrphanSweepTestApp(t, "widgets", "name")
	seedWidgets(t, app, seededWidgets)

	b := BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
		Stats:          Stats{Rejected: rejected},
	}
	for i := 1; i <= seededWidgets; i++ {
		if i == rejectedWidget || i == orphanWidget {
			continue
		}
		b.ProcessedKeys[widgetKey(i)] = true
	}

	return app, b
}

// TestBaseDeleteOrphansKeepsTheRejectedRecordsRow is the headline. This is the
// path 11 of the 13 rejecting services sweep through.
func TestBaseDeleteOrphansKeepsTheRejectedRecordsRow(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 1)

	if err := b.DeleteOrphans("widgets", widgetIDFunc, "widget", "year = 2026"); err != nil {
		t.Fatalf("DeleteOrphans returned %v -- a rejection is warn-only (kindred#2284) "+
			"and must skip the sweep without failing the run", err)
	}

	if _, err := app.FindRecordById("widgets", orphanTestID(rejectedWidget)); err != nil {
		t.Fatalf("the rejected record's existing row was deleted: %v -- one bad record "+
			"this run destroyed the good value stored by the last one", err)
	}
	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seededWidgets {
		t.Fatalf("%d rows survived, want %d -- the sweep ran against a set it knows is incomplete",
			remaining, seededWidgets)
	}
}

// TestBaseDeleteOrphansSweepsWhenNothingWasRejected is the negative control.
// Without it, a guard that skipped every sweep would pass every test above.
func TestBaseDeleteOrphansSweepsWhenNothingWasRejected(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 0)

	if err := b.DeleteOrphans("widgets", widgetIDFunc, "widget", "year = 2026"); err != nil {
		t.Fatalf("DeleteOrphans: %v", err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seededWidgets-2 {
		t.Fatalf("%d rows survived, want %d -- a clean run must still collect its orphans",
			remaining, seededWidgets-2)
	}
}

// TestBaseDeleteOrphansRejectionLeavesGenuineOrphansBehind pins the KNOWN COST of
// skipping, so that nobody later reads it as a bug and "fixes" it.
//
// Skipping the whole collection was chosen over tracking the rejected record's
// key: the `Invalid ... cm_id` branch fires precisely because there is no usable
// key, so key-tracking can only ever cover half the cases, and half a fix that
// looks whole is worse than a blunt honest one. The price is that a genuine
// orphan waits for a run in which nothing was rejected. A service sitting at
// rejected > 0 run after run is the signal to go fix the upstream data.
func TestBaseDeleteOrphansRejectionLeavesGenuineOrphansBehind(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 1)

	if err := b.DeleteOrphans("widgets", widgetIDFunc, "widget", "year = 2026"); err != nil {
		t.Fatalf("DeleteOrphans: %v", err)
	}

	if _, err := app.FindRecordById("widgets", orphanTestID(orphanWidget)); err != nil {
		t.Fatalf("a genuine orphan was collected on a run that rejected a record: %v -- "+
			"this is INTENDED behavior, not a bug: the computed set is known-incomplete, "+
			"so nothing in this collection may be swept against it", err)
	}
}

// TestBaseDeleteOrphansGuardedKeepsTheRejectedRecordsRow covers the opted-in
// entry point -- persons, person_custom_field_values, household_custom_field_values,
// attendees, bunk_plans and bunk_assignments all sweep through it. The collapse
// guard and the rejection skip are independent verdicts and both have to hold.
func TestBaseDeleteOrphansGuardedKeepsTheRejectedRecordsRow(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 1)

	err := b.DeleteOrphansGuarded("widgets", widgetIDFunc, "widget", "year = 2026",
		OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: len(b.ProcessedKeys)})
	if err != nil {
		t.Fatalf("DeleteOrphansGuarded returned %v, want nil -- a rejection skips, it does not fail", err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seededWidgets {
		t.Fatalf("%d rows survived, want %d", remaining, seededWidgets)
	}
}

// TestDeleteOrphansFromPreloadedKeepsTheRejectedRecordsRow covers the third
// entry point. financial_transactions is the only rejecting service that sweeps
// this way, and it has two reject sites.
func TestDeleteOrphansFromPreloadedKeepsTheRejectedRecordsRow(t *testing.T) {
	t.Parallel()

	app, b := rejectingSweepFixture(t, 1)

	preloaded := map[any]*core.Record{}
	for i := 1; i <= seededWidgets; i++ {
		rec, err := app.FindRecordById("widgets", orphanTestID(i))
		if err != nil {
			t.Fatalf("reload widget %d: %v", i, err)
		}
		preloaded[widgetKey(i)] = rec
	}

	if err := b.DeleteOrphansFromPreloaded(preloaded, "widget"); err != nil {
		t.Fatalf("DeleteOrphansFromPreloaded: %v", err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seededWidgets {
		t.Fatalf("%d rows survived, want %d -- the preloaded sweep deleted the rejected "+
			"record's row", remaining, seededWidgets)
	}
}

// TestPersonCustomFieldValuesSweepKeepsRowsWhenARecordWasRejected runs a real
// production sweep, not a fixture-shaped one: the same deleteOrphans that
// kindred#2266 rewrote, with the service's own key format.
func TestPersonCustomFieldValuesSweepKeepsRowsWhenARecordWasRejected(t *testing.T) {
	t.Parallel()
	const seeded = 40

	app := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, app, "person_custom_values", "person", "pers_0000000001", 2026, seeded)

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
		Stats:          Stats{Rejected: 1},
	}}
	// One value came back from CampMinder with no usable field id, so it was
	// rejected before TrackProcessedCompositeKey ran. Its row is row 1.
	for i := 2; i <= seeded; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	if err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	if remaining := countRows(t, app, "person_custom_values", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- the rejected value's stored row was deleted",
			remaining, seeded)
	}
}

// ---------------------------------------------------------------------------
// persons -- the combined sync, and the one service whose rejections land in a
// sub-entity's Stats rather than its own
// ---------------------------------------------------------------------------

func newHouseholdsTestApp(t *testing.T) core.App {
	t.Helper()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("households")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	for _, f := range []string{
		"greeting", "mailing_title", "alternate_mailing_title", "billing_mailing_title",
		"household_phone", "billing_address1", "billing_address2", "billing_city",
		"billing_state", "billing_postal_code", "billing_country",
	} {
		col.Fields.Add(&core.TextField{Name: f})
	}
	col.Fields.Add(&core.NumberField{Name: "year"})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save households: %v", saveErr)
	}

	return app
}

func seedHousehold(t *testing.T, app core.App, cmID, year int) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("households")
	if err != nil {
		t.Fatalf("find households: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("cm_id", cmID)
	rec.Set("year", year)
	rec.Set("greeting", "stored last run")
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("seed household %d: %v", cmID, saveErr)
	}
}

func householdCMIDs(t *testing.T, app core.App, year int) map[int]bool {
	t.Helper()
	records, err := app.FindRecordsByFilter("households", fmt.Sprintf("year = %d", year), "", 0, 0)
	if err != nil {
		t.Fatalf("re-query households: %v", err)
	}
	found := map[int]bool{}
	for _, rec := range records {
		cmID, ok := rec.Get("cm_id").(float64)
		if !ok {
			t.Fatalf("household %s has no numeric cm_id", rec.Id)
		}
		found[int(cmID)] = true
	}
	return found
}

// TestPersonsHouseholdRejectionIsNotAnInfrastructureError is the behavioral half
// of the reclassification. A household that will not transform is upstream data
// quality, and counting it as an infrastructure Errors fails the whole persons
// run under the kindred#2284 escalation.
func TestPersonsHouseholdRejectionIsNotAnInfrastructureError(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t)
	s := &PersonsSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		FieldDiffStats: map[string]int{},
	}}

	stats := s.processHouseholds(map[int]map[string]any{
		100: {"ID": float64(100), "Greeting": "good"},
		200: {"Greeting": "no ID at all"}, // rejected by transformHouseholdToPB
	}, map[int]*core.Record{}, 2026)

	if stats.Rejected != 1 {
		t.Errorf("householdStats.Rejected = %d, want 1", stats.Rejected)
	}
	if stats.Errors != 0 {
		t.Errorf("householdStats.Errors = %d, want 0 -- a household that will not transform is "+
			"upstream data quality, and counting it as infrastructure fails the persons run",
			stats.Errors)
	}
	if stats.Created != 1 {
		t.Errorf("householdStats.Created = %d, want 1 -- the good household must still land", stats.Created)
	}
}

// TestPersonsHouseholdSweepSkippedWhenAHouseholdWasRejected covers the fourth and
// last sweep a rejecting service reaches: deleteHouseholdOrphans, which is
// hand-rolled and does not go through BaseSyncService at all.
//
// One detail is worth stating because it is genuinely different here. The
// rejected household's OWN row is protected twice over: Sync builds
// processedHouseholdIDs in processPersonBatches, upstream of the transform, so it
// contains the rejected id already. What this test pins is the sweep as a whole
// -- with a rejection present, the collection is not swept, so the genuine orphan
// survives too. That is the same known cost as everywhere else.
func TestPersonsHouseholdSweepSkippedWhenAHouseholdWasRejected(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t)
	seedHousehold(t, app, 100, 2026) // still upstream
	seedHousehold(t, app, 200, 2026) // this run rejected it
	seedHousehold(t, app, 900, 2026) // a genuine orphan

	s := &PersonsSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		FieldDiffStats: map[string]int{},
	}}

	stats := s.processHouseholds(map[int]map[string]any{
		100: {"ID": float64(100), "Greeting": "good"},
		200: {"Greeting": "no ID at all"},
	}, map[int]*core.Record{}, 2026)
	if stats.Rejected != 1 {
		t.Fatalf("fixture did not reject: Rejected = %d", stats.Rejected)
	}

	// processedIDs the production shape: built before the transform, so it holds
	// both extracted households and not the orphan.
	processedIDs := map[int]bool{100: true, 200: true}

	if err := s.deleteHouseholdOrphans(2026, processedIDs, stats.Rejected); err != nil {
		t.Fatalf("deleteHouseholdOrphans: %v", err)
	}

	survivors := householdCMIDs(t, app, 2026)
	for _, cmID := range []int{100, 200, 900} {
		if !survivors[cmID] {
			t.Errorf("household %d was deleted on a run that rejected a record -- "+
				"the computed set is known-incomplete, so this collection may not be swept", cmID)
		}
	}
}

// TestPersonsHouseholdSweepStillCollectsOrphansOnACleanRun is the negative
// control for the hand-rolled sweep.
func TestPersonsHouseholdSweepStillCollectsOrphansOnACleanRun(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t)
	seedHousehold(t, app, 100, 2026)
	seedHousehold(t, app, 900, 2026)

	s := &PersonsSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		FieldDiffStats: map[string]int{},
	}}

	if err := s.deleteHouseholdOrphans(2026, map[int]bool{100: true}, 0); err != nil {
		t.Fatalf("deleteHouseholdOrphans: %v", err)
	}

	survivors := householdCMIDs(t, app, 2026)
	if survivors[900] {
		t.Error("household 900 survived a clean run -- a genuine orphan must still be collected")
	}
	if !survivors[100] {
		t.Error("household 100 was deleted -- it is still upstream")
	}
}
