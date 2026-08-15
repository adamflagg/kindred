package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// newBaseSyncDryRunTestApp returns a test app holding one collection shaped
// like a year-scoped CampMinder table, for exercising BaseSyncService's write
// helpers directly against a real database.
func newBaseSyncDryRunTestApp(t *testing.T, collection string) core.App {
	t.Helper()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection(collection)
	col.Fields.Add(&core.TextField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "name"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save %s: %v", collection, saveErr)
	}

	return app
}

// TestBaseSyncServiceProcessSimpleRecordDryRunWritesNothing proves the actual
// production entry point 12 of the 24 default unified sync jobs share for
// every create/update they perform (kindred#2351): with DryRun set, neither
// branch of ProcessSimpleRecord calls App.Save, so record counts and the
// row's own fields are untouched. ProcessCompositeRecord's identically-shaped
// guards are covered by the sibling test below.
//
// ProcessSimpleRecordGlobal (base_sync.go's other App.Save-guarded write
// helper) is deliberately NOT covered here or below: none of kindred#2351's
// twelve wired services call it -- its only callers (custom_field_definitions,
// divisions, financial_lookups, person_tag_definitions, staff_lookups) declare
// no SetDryRun and stay rejected with a 400, so the guard is currently dead
// code from a coverage standpoint. TestBaseSyncServiceProcessSimpleRecordGlobalDryRunWritesNothing
// pins it anyway, on the same "shared helper, one gap breaks every future
// caller silently" reasoning as the other three helpers in this file.
func TestBaseSyncServiceProcessSimpleRecordDryRunWritesNothing(t *testing.T) {
	t.Parallel()
	app := newBaseSyncDryRunTestApp(t, "dryrun_simple")

	col, findErr := app.FindCollectionByNameOrId("dryrun_simple")
	if findErr != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", findErr)
	}
	existing := core.NewRecord(col)
	existing.Set("cm_id", "1")
	existing.Set("name", "Original")
	existing.Set("year", 2025)
	if saveErr := app.Save(existing); saveErr != nil {
		t.Fatalf("seed existing record: %v", saveErr)
	}

	b := &BaseSyncService{App: app, Stats: Stats{}, DryRun: true, FieldDiffStats: make(map[string]int)}

	existingRecords := map[any]*core.Record{
		CompositeKey(1, 2025): existing,
	}

	// Update branch: field differs, so a real run would call App.Save.
	if updateErr := b.ProcessSimpleRecord("dryrun_simple", 1,
		map[string]any{"cm_id": "1", "name": "Changed", "year": 2025},
		existingRecords, []string{"name"}); updateErr != nil {
		t.Fatalf("ProcessSimpleRecord (update): %v", updateErr)
	}

	// Create branch: key 2 has no existing record, so a real run would call
	// App.Save on a brand new record.
	if createErr := b.ProcessSimpleRecord("dryrun_simple", 2,
		map[string]any{"cm_id": "2", "name": "New", "year": 2025},
		existingRecords, []string{"name"}); createErr != nil {
		t.Fatalf("ProcessSimpleRecord (create): %v", createErr)
	}

	rows, queryErr := app.FindRecordsByFilter("dryrun_simple", "", "", 0, 0)
	if queryErr != nil {
		t.Fatalf("re-query: %v", queryErr)
	}
	if len(rows) != 1 {
		t.Fatalf("dry run wrote %d rows; want 1 (only the seeded one)", len(rows))
	}
	if rows[0].GetString("name") != "Original" {
		t.Fatalf("dry run persisted a name change: got %q, want %q (unchanged)",
			rows[0].GetString("name"), "Original")
	}
}

// TestBaseSyncServiceProcessSimpleRecordGlobalDryRunWritesNothing mirrors
// TestBaseSyncServiceProcessSimpleRecordDryRunWritesNothing above for
// ProcessSimpleRecordGlobal, base_sync.go's write helper for entities that
// are NOT year-scoped (divisions, custom_field_defs, staff_lookups,
// financial_lookups, person_tag_defs). None of those callers are wired to
// DryRunnable today, so this guard is currently unreachable in production --
// pinned regardless, so a future service that wires one of those five
// callers doesn't inherit a silently-broken guard.
func TestBaseSyncServiceProcessSimpleRecordGlobalDryRunWritesNothing(t *testing.T) {
	t.Parallel()
	app := newBaseSyncDryRunTestApp(t, "dryrun_global")

	col, findErr := app.FindCollectionByNameOrId("dryrun_global")
	if findErr != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", findErr)
	}
	existing := core.NewRecord(col)
	existing.Set("cm_id", "1")
	existing.Set("name", "Original")
	if saveErr := app.Save(existing); saveErr != nil {
		t.Fatalf("seed existing record: %v", saveErr)
	}

	b := &BaseSyncService{App: app, Stats: Stats{}, DryRun: true}

	existingRecords := map[any]*core.Record{
		"1": existing,
	}

	// Update branch: field differs, so a real run would call App.Save.
	if updateErr := b.ProcessSimpleRecordGlobal("dryrun_global", "1",
		map[string]any{"cm_id": "1", "name": "Changed"},
		existingRecords, []string{"name"}); updateErr != nil {
		t.Fatalf("ProcessSimpleRecordGlobal (update): %v", updateErr)
	}

	// Create branch: key "2" has no existing record, so a real run would
	// call App.Save on a brand new record.
	if createErr := b.ProcessSimpleRecordGlobal("dryrun_global", "2",
		map[string]any{"cm_id": "2", "name": "New"},
		existingRecords, []string{"name"}); createErr != nil {
		t.Fatalf("ProcessSimpleRecordGlobal (create): %v", createErr)
	}

	rows, queryErr := app.FindRecordsByFilter("dryrun_global", "", "", 0, 0)
	if queryErr != nil {
		t.Fatalf("re-query: %v", queryErr)
	}
	if len(rows) != 1 {
		t.Fatalf("dry run wrote %d rows; want 1 (only the seeded one)", len(rows))
	}
	if rows[0].GetString("name") != "Original" {
		t.Fatalf("dry run persisted a name change: got %q, want %q (unchanged)",
			rows[0].GetString("name"), "Original")
	}
}

// TestBaseSyncServiceDeleteOrphansDryRunDeletesNothing proves DeleteOrphans'
// App.Delete call site is gated: with DryRun set, an unprocessed (orphaned)
// row survives the sweep.
func TestBaseSyncServiceDeleteOrphansDryRunDeletesNothing(t *testing.T) {
	t.Parallel()
	app := newBaseSyncDryRunTestApp(t, "dryrun_orphans")

	col, findErr := app.FindCollectionByNameOrId("dryrun_orphans")
	if findErr != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", findErr)
	}
	orphan := core.NewRecord(col)
	orphan.Set("cm_id", "99")
	orphan.Set("name", "Orphan")
	orphan.Set("year", 2025)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("seed orphan record: %v", saveErr)
	}

	b := &BaseSyncService{
		App:            app,
		Stats:          Stats{},
		DryRun:         true,
		SyncSuccessful: true,
		ProcessedKeys:  map[string]bool{}, // nothing processed -> everything is an orphan
	}

	if sweepErr := b.DeleteOrphans("dryrun_orphans", func(r *core.Record) (string, bool) {
		return r.GetString("cm_id"), true
	}, "dryrun_orphan", ""); sweepErr != nil {
		t.Fatalf("DeleteOrphans: %v", sweepErr)
	}

	rows, queryErr := app.FindRecordsByFilter("dryrun_orphans", "", "", 0, 0)
	if queryErr != nil {
		t.Fatalf("re-query: %v", queryErr)
	}
	if len(rows) != 1 {
		t.Fatalf("dry run deleted %d rows; want 1 (the orphan survives)", len(rows))
	}
}

// TestBaseSyncServiceDeleteOrphansFromPreloadedDryRunDeletesNothing mirrors
// the test above for the preloaded-map sweep entry point used by the
// higher-volume services.
func TestBaseSyncServiceDeleteOrphansFromPreloadedDryRunDeletesNothing(t *testing.T) {
	t.Parallel()
	app := newBaseSyncDryRunTestApp(t, "dryrun_preloaded_orphans")

	col, findErr := app.FindCollectionByNameOrId("dryrun_preloaded_orphans")
	if findErr != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", findErr)
	}
	orphan := core.NewRecord(col)
	orphan.Set("cm_id", "77")
	orphan.Set("year", 2025)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("seed orphan record: %v", saveErr)
	}

	b := &BaseSyncService{
		App:            app,
		Stats:          Stats{},
		DryRun:         true,
		SyncSuccessful: true,
		ProcessedKeys:  map[string]bool{},
	}

	preloaded := map[any]*core.Record{"77|2025": orphan}
	if sweepErr := b.DeleteOrphansFromPreloaded(preloaded, "dryrun_preloaded_orphan"); sweepErr != nil {
		t.Fatalf("DeleteOrphansFromPreloaded: %v", sweepErr)
	}

	rows, queryErr := app.FindRecordsByFilter("dryrun_preloaded_orphans", "", "", 0, 0)
	if queryErr != nil {
		t.Fatalf("re-query: %v", queryErr)
	}
	if len(rows) != 1 {
		t.Fatalf("dry run deleted %d rows; want 1 (the orphan survives)", len(rows))
	}
}

// TestBaseSyncServiceProcessCompositeRecordDryRunWritesNothing proves
// ProcessCompositeRecord's two App.Save call sites (used by attendees,
// bunk_plans, bunk_assignments, and the two custom-field-value services)
// are gated the same way ProcessSimpleRecord's are.
func TestBaseSyncServiceProcessCompositeRecordDryRunWritesNothing(t *testing.T) {
	t.Parallel()
	app := newBaseSyncDryRunTestApp(t, "dryrun_composite")

	col, findErr := app.FindCollectionByNameOrId("dryrun_composite")
	if findErr != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", findErr)
	}
	existing := core.NewRecord(col)
	existing.Set("cm_id", "1:2")
	existing.Set("name", "Original")
	existing.Set("year", 2025)
	if saveErr := app.Save(existing); saveErr != nil {
		t.Fatalf("seed existing record: %v", saveErr)
	}

	b := &BaseSyncService{App: app, Stats: Stats{}, DryRun: true}

	existingRecords := map[string]*core.Record{
		"1:2|2025": existing,
	}

	if updateErr := b.ProcessCompositeRecord("dryrun_composite", "1:2",
		map[string]any{"cm_id": "1:2", "name": "Changed", "year": 2025},
		existingRecords, nil); updateErr != nil {
		t.Fatalf("ProcessCompositeRecord (update): %v", updateErr)
	}

	if createErr := b.ProcessCompositeRecord("dryrun_composite", "3:4",
		map[string]any{"cm_id": "3:4", "name": "New", "year": 2025},
		existingRecords, nil); createErr != nil {
		t.Fatalf("ProcessCompositeRecord (create): %v", createErr)
	}

	rows, queryErr := app.FindRecordsByFilter("dryrun_composite", "", "", 0, 0)
	if queryErr != nil {
		t.Fatalf("re-query: %v", queryErr)
	}
	if len(rows) != 1 {
		t.Fatalf("dry run wrote %d rows; want 1 (only the seeded one)", len(rows))
	}
	if rows[0].GetString("name") != "Original" {
		t.Fatalf("dry run persisted a name change: got %q, want %q (unchanged)",
			rows[0].GetString("name"), "Original")
	}
}
