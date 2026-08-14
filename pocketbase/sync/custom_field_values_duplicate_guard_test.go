// This file pins kindred#2270: persons/{id}/custom-fields (and its household twin)
// returns a flat list keyed only by field definition. Before this fix, a second API
// entry for a (person, field_definition, year) already seen in this run silently
// collapsed onto the first -- counted as Skipped, Updated, or (only on save failure)
// Errors, with nothing logged and nothing flagged.
//
// The defect is latent: CampMinder packs multi-selects into one delimited string, so
// the two-entries-per-field shape does not occur in production today. The fix is not a
// storage-grain change -- still one row per (person, field_definition, year) -- it is a
// guard so that if the shape ever changes, the loss is attributable (Stats.Rejected +
// a log line) instead of invisible.
//
// processPersonCustomFieldValue / processHouseholdCustomFieldValue are split out of
// their sync* loops (which need a live CampMinder HTTP round trip via s.Client) purely
// so this guard is directly testable against the real implementation, without a mock
// HTTP server. Everything else about the two functions is a verbatim move.
package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// TestPersonCustomFieldValuesDuplicateInRunGuard: the second entry for a field
// definition already tracked this run must be rejected and counted, not silently
// applied on top of the first.
func TestPersonCustomFieldValuesDuplicateInRunGuard(t *testing.T) {
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

	fieldDefMapping := map[int]string{100: testFieldDefPBIDPerson}
	existingRecords := map[string]*core.Record{}

	first := map[string]any{"id": float64(100), "value": "Vegetarian"}
	second := map[string]any{"id": float64(100), "value": "Vegan"}

	if err := s.processPersonCustomFieldValue(
		first, 12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("first entry: %v", err)
	}
	if err := s.processPersonCustomFieldValue(
		second, 12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("second (duplicate) entry: %v", err)
	}

	if s.Stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1 (only the first entry creates a row)", s.Stats.Created)
	}
	if s.Stats.Updated != 0 {
		t.Errorf("Stats.Updated = %d, want 0 (the duplicate must not overwrite the first entry)", s.Stats.Updated)
	}
	if s.Stats.Rejected != 1 {
		t.Errorf("Stats.Rejected = %d, want 1 (the duplicate must be counted, not silently swallowed)", s.Stats.Rejected)
	}

	recs, err := app.FindRecordsByFilter("person_custom_values", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find records: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("found %d person_custom_values rows, want exactly 1", len(recs))
	}
	if got, want := recs[0].GetString("value"), "Vegetarian"; got != want {
		t.Errorf("stored value = %q, want %q (first entry wins; the rejected duplicate must not land)", got, want)
	}
}

// TestPersonCustomFieldValuesDuplicateInRunGuard_ThirdAndLaterEntriesAlsoCounted verifies
// the guard counts every extra entry, not just the second.
func TestPersonCustomFieldValuesDuplicateInRunGuard_ThirdAndLaterEntriesAlsoCounted(t *testing.T) {
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

	fieldDefMapping := map[int]string{100: testFieldDefPBIDPerson}
	existingRecords := map[string]*core.Record{}

	for i, value := range []string{"Vegetarian", "Vegan", "Gluten-Free"} {
		entry := map[string]any{"id": float64(100), "value": value}
		if err := s.processPersonCustomFieldValue(
			entry, 12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); err != nil {
			t.Fatalf("entry %d: %v", i, err)
		}
	}

	if s.Stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1", s.Stats.Created)
	}
	if s.Stats.Rejected != 2 {
		t.Errorf("Stats.Rejected = %d, want 2 (two duplicate entries beyond the first)", s.Stats.Rejected)
	}
}

// TestPersonCustomFieldValuesDuplicateInRunGuard_DifferentFieldsBothSucceed verifies the
// guard is scoped to the composite key -- two different field definitions for the same
// person in the same run are NOT duplicates of each other.
func TestPersonCustomFieldValuesDuplicateInRunGuard_DifferentFieldsBothSucceed(t *testing.T) {
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

	fieldDefMapping := map[int]string{100: testFieldDefPBIDPerson, 200: "pb_field_200"}
	existingRecords := map[string]*core.Record{}

	entryA := map[string]any{"id": float64(100), "value": "Vegetarian"}
	entryB := map[string]any{"id": float64(200), "value": "Loves camp"}

	if err := s.processPersonCustomFieldValue(
		entryA, 12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("entry A: %v", err)
	}
	if err := s.processPersonCustomFieldValue(
		entryB, 12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("entry B: %v", err)
	}

	if s.Stats.Created != 2 {
		t.Errorf("Stats.Created = %d, want 2 (different field definitions are not duplicates)", s.Stats.Created)
	}
	if s.Stats.Rejected != 0 {
		t.Errorf("Stats.Rejected = %d, want 0", s.Stats.Rejected)
	}
}

// TestPersonCustomFieldValuesDuplicateInRunGuard_CrossPageDuplicate is kindred#2270's
// cross-page acceptance case: syncPersonCustomFieldValues's pagination loop calls
// processPersonCustomFieldValue once per value across ALL pages for one person, threading
// the same fieldDefMapping/existingRecords/ProcessedKeys through every page fetch (page is
// not part of any reset). Simulating "page 1's entry" then "page 2's entry" as two
// sequential calls against that same shared state is exactly that call sequence -- there
// is no separate per-page bookkeeping to reset in between, which is precisely what makes a
// same-run duplicate straddling a page boundary indistinguishable to the guard from one
// repeated on a single page.
func TestPersonCustomFieldValuesDuplicateInRunGuard_CrossPageDuplicate(t *testing.T) {
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

	fieldDefMapping := map[int]string{100: testFieldDefPBIDPerson}
	existingRecords := map[string]*core.Record{}

	page1Entry := map[string]any{"id": float64(100), "value": "Vegetarian"}
	page2Entry := map[string]any{"id": float64(100), "value": "Vegan"}

	if err := s.processPersonCustomFieldValue(
		page1Entry, 12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("page 1 entry: %v", err)
	}
	if err := s.processPersonCustomFieldValue(
		page2Entry, 12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("page 2 entry: %v", err)
	}

	if s.Stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1", s.Stats.Created)
	}
	if s.Stats.Rejected != 1 {
		t.Errorf("Stats.Rejected = %d, want 1 (page 2's repeat must be caught too, not just same-page)",
			s.Stats.Rejected)
	}
}

// TestPersonCustomFieldValuesDuplicateInRunGuard_DifferentYearsBothSucceed verifies the
// guard is scoped by year too, not just by field definition: the same person and field
// definition in two different years (e.g. a January re-run touching last season's data
// alongside this season's) are not duplicates of each other, because year is part of the
// composite key both here and in the orphan-sweep key it must stay consistent with.
func TestPersonCustomFieldValuesDuplicateInRunGuard_DifferentYearsBothSucceed(t *testing.T) {
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

	fieldDefMapping := map[int]string{100: testFieldDefPBIDPerson}
	existingRecords := map[string]*core.Record{}

	entry2025 := map[string]any{"id": float64(100), "value": "Vegetarian"}
	entry2026 := map[string]any{"id": float64(100), "value": "Vegan"}

	if err := s.processPersonCustomFieldValue(
		entry2025, 12345, testPersonPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("2025 entry: %v", err)
	}
	if err := s.processPersonCustomFieldValue(
		entry2026, 12345, testPersonPBID, 2026, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("2026 entry: %v", err)
	}

	if s.Stats.Created != 2 {
		t.Errorf("Stats.Created = %d, want 2 (different years are not duplicates)", s.Stats.Created)
	}
	if s.Stats.Rejected != 0 {
		t.Errorf("Stats.Rejected = %d, want 0", s.Stats.Rejected)
	}

	recs, err := app.FindRecordsByFilter("person_custom_values", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find records: %v", err)
	}
	if len(recs) != 2 {
		t.Fatalf("found %d person_custom_values rows, want exactly 2 (one per year)", len(recs))
	}
}

// TestHouseholdCustomFieldValuesDuplicateInRunGuard_DifferentFieldsBothSucceed mirrors
// TestPersonCustomFieldValuesDuplicateInRunGuard_DifferentFieldsBothSucceed for the
// household variant: two different field definitions in one run are not duplicates.
func TestHouseholdCustomFieldValuesDuplicateInRunGuard_DifferentFieldsBothSucceed(t *testing.T) {
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

	fieldDefMapping := map[int]string{100: testFieldDefPBID, 200: "pb_field_200"}
	existingRecords := map[string]*core.Record{}

	entryA := map[string]any{"id": float64(100), "value": "Premium"}
	entryB := map[string]any{"id": float64(200), "value": "Wait-listed"}

	if err := s.processHouseholdCustomFieldValue(
		entryA, 54321, testHouseholdPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("entry A: %v", err)
	}
	if err := s.processHouseholdCustomFieldValue(
		entryB, 54321, testHouseholdPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("entry B: %v", err)
	}

	if s.Stats.Created != 2 {
		t.Errorf("Stats.Created = %d, want 2 (different field definitions are not duplicates)", s.Stats.Created)
	}
	if s.Stats.Rejected != 0 {
		t.Errorf("Stats.Rejected = %d, want 0", s.Stats.Rejected)
	}
}

// TestHouseholdCustomFieldValuesDuplicateInRunGuard_CrossPageDuplicate mirrors
// TestPersonCustomFieldValuesDuplicateInRunGuard_CrossPageDuplicate for the household
// variant: syncHouseholdCustomFieldValues's pagination loop threads the same
// fieldDefMapping/existingRecords/ProcessedKeys across every page for one household, so a
// duplicate straddling a page boundary is indistinguishable to the guard from a same-page
// repeat.
func TestHouseholdCustomFieldValuesDuplicateInRunGuard_CrossPageDuplicate(t *testing.T) {
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

	fieldDefMapping := map[int]string{100: testFieldDefPBID}
	existingRecords := map[string]*core.Record{}

	page1Entry := map[string]any{"id": float64(100), "value": "Premium"}
	page2Entry := map[string]any{"id": float64(100), "value": "Standard"}

	if err := s.processHouseholdCustomFieldValue(
		page1Entry, 54321, testHouseholdPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("page 1 entry: %v", err)
	}
	if err := s.processHouseholdCustomFieldValue(
		page2Entry, 54321, testHouseholdPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("page 2 entry: %v", err)
	}

	if s.Stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1", s.Stats.Created)
	}
	if s.Stats.Rejected != 1 {
		t.Errorf("Stats.Rejected = %d, want 1 (page 2's repeat must be caught too, not just same-page)",
			s.Stats.Rejected)
	}
}

// TestHouseholdCustomFieldValuesDuplicateInRunGuard mirrors the person-variant test above
// for household_custom_field_values.go's identical shape.
func TestHouseholdCustomFieldValuesDuplicateInRunGuard(t *testing.T) {
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

	fieldDefMapping := map[int]string{100: testFieldDefPBID}
	existingRecords := map[string]*core.Record{}

	first := map[string]any{"id": float64(100), "value": "Premium"}
	second := map[string]any{"id": float64(100), "value": "Standard"}

	if err := s.processHouseholdCustomFieldValue(
		first, 54321, testHouseholdPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("first entry: %v", err)
	}
	if err := s.processHouseholdCustomFieldValue(
		second, 54321, testHouseholdPBID, 2025, fieldDefMapping, existingRecords); err != nil {
		t.Fatalf("second (duplicate) entry: %v", err)
	}

	if s.Stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1 (only the first entry creates a row)", s.Stats.Created)
	}
	if s.Stats.Updated != 0 {
		t.Errorf("Stats.Updated = %d, want 0 (the duplicate must not overwrite the first entry)", s.Stats.Updated)
	}
	if s.Stats.Rejected != 1 {
		t.Errorf("Stats.Rejected = %d, want 1 (the duplicate must be counted, not silently swallowed)", s.Stats.Rejected)
	}

	recs, err := app.FindRecordsByFilter("household_custom_values", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find records: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("found %d household_custom_values rows, want exactly 1", len(recs))
	}
	if got, want := recs[0].GetString("value"), "Premium"; got != want {
		t.Errorf("stored value = %q, want %q (first entry wins; the rejected duplicate must not land)", got, want)
	}
}
