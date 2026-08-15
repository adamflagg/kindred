package sync

// TestPersonCustomFieldValuesDryRunWritesNothing and its household twin prove
// processPersonCustomFieldValue/processHouseholdCustomFieldValue's own two
// App.Save call sites -- a fast-path upsert that does not go through
// BaseSyncService.ProcessSimpleRecord -- are gated by DryRun (kindred#2351).
// Modeled on TestPersonCustomFieldValuesDuplicateInRunGuard in
// custom_field_values_duplicate_guard_test.go, which established that these
// functions are directly testable against the real implementation.

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// testDietValueVegetarian is reused across the create/seed/update steps below
// (goconst wants a shared name once the same literal appears three times).
const testDietValueVegetarian = "Vegetarian"

func TestPersonCustomFieldValuesDryRunWritesNothing(t *testing.T) {
	t.Parallel()

	app := newOrphanSweepTestApp(t, "person_custom_values",
		"person", "field_definition", "value", "last_updated")

	s := &PersonCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{
			App:           app,
			ProcessedKeys: map[string]bool{},
			Stats:         Stats{},
		},
	}
	s.SetDryRun(true)

	fieldDefMapping := map[int]string{100: testFieldDefPBIDPerson}
	existingRecords := map[string]*core.Record{}

	// Create branch: no existing record for this key.
	if createErr := s.processPersonCustomFieldValue(
		map[string]any{"id": float64(100), "value": testDietValueVegetarian},
		12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); createErr != nil {
		t.Fatalf("processPersonCustomFieldValue (create): %v", createErr)
	}

	rows, err := app.FindRecordsByFilter("person_custom_values", "", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("dry run wrote %d rows to person_custom_values; want 0", len(rows))
	}
	if s.Stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1 (the create that would have happened)", s.Stats.Created)
	}

	// Update branch: fresh service (fresh ProcessedKeys, so the duplicate-in-run guard
	// does not fire) seeds a real row wet, then dry-runs a change to it.
	seed := &PersonCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, Stats: Stats{}},
	}
	seedExisting := map[string]*core.Record{}
	if seedErr := seed.processPersonCustomFieldValue(
		map[string]any{"id": float64(100), "value": testDietValueVegetarian},
		99999, testPersonPBID, 2025, fieldDefMapping, seedExisting); seedErr != nil {
		t.Fatalf("processPersonCustomFieldValue (seed): %v", seedErr)
	}
	seeded, seedQueryErr := app.FindRecordsByFilter("person_custom_values", "", "", 0, 0)
	if seedQueryErr != nil || len(seeded) != 1 {
		t.Fatalf("seed: got %d rows, err=%v", len(seeded), seedQueryErr)
	}

	update := &PersonCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, Stats: Stats{}},
	}
	update.SetDryRun(true)
	updateExisting := map[string]*core.Record{"pb_person_123:pb_field_100|2025": seeded[0]}
	if updateErr := update.processPersonCustomFieldValue(
		map[string]any{"id": float64(100), "value": "Vegan"},
		99999, testPersonPBID, 2025, fieldDefMapping, updateExisting); updateErr != nil {
		t.Fatalf("processPersonCustomFieldValue (update): %v", updateErr)
	}

	reloaded, reloadErr := app.FindRecordById("person_custom_values", seeded[0].Id)
	if reloadErr != nil {
		t.Fatalf("reload: %v", reloadErr)
	}
	if reloaded.GetString("value") != testDietValueVegetarian {
		t.Errorf("dry run persisted a value change: got %q, want unchanged %q",
			reloaded.GetString("value"), testDietValueVegetarian)
	}
	if update.Stats.Updated != 1 {
		t.Errorf("Stats.Updated = %d, want 1 (the update that would have happened)", update.Stats.Updated)
	}
}

func TestHouseholdCustomFieldValuesDryRunWritesNothing(t *testing.T) {
	t.Parallel()

	app := newOrphanSweepTestApp(t, "household_custom_values",
		"household", "field_definition", "value", "last_updated")

	s := &HouseholdCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{
			App:           app,
			ProcessedKeys: map[string]bool{},
			Stats:         Stats{},
		},
	}
	s.SetDryRun(true)

	fieldDefMapping := map[int]string{100: testFieldDefPBID}
	existingRecords := map[string]*core.Record{}

	if createErr := s.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(100), "value": "3-bedroom"},
		54321, testHouseholdPBID, 2025, fieldDefMapping, existingRecords); createErr != nil {
		t.Fatalf("processHouseholdCustomFieldValue (create): %v", createErr)
	}

	rows, err := app.FindRecordsByFilter("household_custom_values", "", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("dry run wrote %d rows to household_custom_values; want 0", len(rows))
	}
	if s.Stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1 (the create that would have happened)", s.Stats.Created)
	}

	// Update branch: fresh service (fresh ProcessedKeys, so the duplicate-in-run guard
	// does not fire) seeds a real row wet, then dry-runs a change to it.
	seed := &HouseholdCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, Stats: Stats{}},
	}
	seedExisting := map[string]*core.Record{}
	if seedErr := seed.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(100), "value": "3-bedroom"},
		99999, testHouseholdPBID, 2025, fieldDefMapping, seedExisting); seedErr != nil {
		t.Fatalf("processHouseholdCustomFieldValue (seed): %v", seedErr)
	}
	seeded, seedQueryErr := app.FindRecordsByFilter("household_custom_values", "", "", 0, 0)
	if seedQueryErr != nil || len(seeded) != 1 {
		t.Fatalf("seed: got %d rows, err=%v", len(seeded), seedQueryErr)
	}

	update := &HouseholdCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, Stats: Stats{}},
	}
	update.SetDryRun(true)
	updateExisting := map[string]*core.Record{"pb_household_123:pb_field_100|2025": seeded[0]}
	if updateErr := update.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(100), "value": "4-bedroom"},
		99999, testHouseholdPBID, 2025, fieldDefMapping, updateExisting); updateErr != nil {
		t.Fatalf("processHouseholdCustomFieldValue (update): %v", updateErr)
	}

	reloaded, reloadErr := app.FindRecordById("household_custom_values", seeded[0].Id)
	if reloadErr != nil {
		t.Fatalf("reload: %v", reloadErr)
	}
	if reloaded.GetString("value") != "3-bedroom" {
		t.Errorf("dry run persisted a value change: got %q, want unchanged %q",
			reloaded.GetString("value"), "3-bedroom")
	}
	if update.Stats.Updated != 1 {
		t.Errorf("Stats.Updated = %d, want 1 (the update that would have happened)", update.Stats.Updated)
	}
}
