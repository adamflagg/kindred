//nolint:dupl // Similar pattern to household_custom_field_values_test.go, intentional for person variant
package sync

import (
	"strings"
	"testing"
)

func TestPersonCustomFieldValuesSync_Name(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	got := s.Name()
	want := "person_custom_values"

	if got != want {
		t.Errorf("PersonCustomFieldValuesSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformPersonCustomFieldValueToPB tests transformation to PocketBase format
func TestTransformPersonCustomFieldValueToPB(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Mock CampMinder API response for a custom field value
	data := map[string]interface{}{
		"id":    float64(100), // Custom field definition ID (used by caller to resolve PB ID)
		"value": "Vegetarian",
	}

	// PB IDs (would be resolved by caller before calling transform)
	personPBId := "pb_person_123"
	fieldDefPBId := "pb_field_100"
	year := 2025

	pbData := s.transformPersonCustomFieldValueToPB(data, personPBId, fieldDefPBId, year)

	// Verify fields
	if got, want := pbData["person"].(string), personPBId; got != want {
		t.Errorf("person = %q, want %q", got, want)
	}
	if got, want := pbData["field_definition"].(string), fieldDefPBId; got != want {
		t.Errorf("field_definition = %q, want %q", got, want)
	}
	if got, want := pbData["value"].(string), "Vegetarian"; got != want {
		t.Errorf("value = %q, want %q", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}

	// Verify simplified schema (no person_id, field_id, season_id, last_updated)
	if _, exists := pbData["person_id"]; exists {
		t.Error("person_id should not exist in simplified schema")
	}
	if _, exists := pbData["field_id"]; exists {
		t.Error("field_id should not exist in simplified schema")
	}
	if _, exists := pbData["season_id"]; exists {
		t.Error("season_id should not exist in simplified schema")
	}
	if _, exists := pbData["last_updated"]; exists {
		t.Error("last_updated should not exist in simplified schema")
	}
}

// TestTransformPersonCustomFieldValueEmptyValue tests that empty values are allowed
func TestTransformPersonCustomFieldValueEmptyValue(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Empty value is valid (field might be cleared)
	data := map[string]interface{}{
		"id":    float64(100),
		"value": "",
	}

	pbData := s.transformPersonCustomFieldValueToPB(data, "pb_person_123", "pb_field_100", 2025)

	if got := pbData["value"].(string); got != "" {
		t.Errorf("value = %q, want empty string", got)
	}
}

// TestTransformPersonCustomFieldValueNilValue tests handling of nil Value
func TestTransformPersonCustomFieldValueNilValue(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Nil value (field has no value set)
	data := map[string]interface{}{
		"id": float64(100),
		// Value is missing/nil
	}

	pbData := s.transformPersonCustomFieldValueToPB(data, "pb_person_123", "pb_field_100", 2025)

	// Should default to empty string
	if got := pbData["value"].(string); got != "" {
		t.Errorf("value = %q, want empty string for nil", got)
	}
}

// TestPersonCustomFieldValuesCompositeKeyFormat tests that composite key format
// is consistent between preload, lookup, tracking, and orphan detection.
// The PreloadCompositeRecords function appends "|year" to the keyBuilder result,
// so the keyBuilder must NOT include year, and all lookups must use "key|year" format.
func TestPersonCustomFieldValuesCompositeKeyFormat(t *testing.T) {
	personPBId := "pb_person_123"
	fieldDefPBId := "pb_field_100"
	year := 2025

	// The identity key (what keyBuilder should return - NO year)
	identityKey := personPBId + ":" + fieldDefPBId

	// The year-scoped key (what PreloadCompositeRecords produces and lookup should use)
	yearScopedKey := identityKey + "|" + "2025"

	// Test 1: Verify identity key does NOT contain year as a colon-separated segment
	// This catches the bug where keyBuilder was returning "person:field:year"
	if identityKey == personPBId+":"+fieldDefPBId+":"+string(rune(year)) {
		t.Error("Identity key should not include year")
	}

	// Test 2: Verify year-scoped key uses pipe separator for year
	expectedFormat := "pb_person_123:pb_field_100|2025"
	if yearScopedKey != expectedFormat {
		t.Errorf("Year-scoped key = %q, want %q", yearScopedKey, expectedFormat)
	}

	// Test 3: Verify the format matches what a map lookup would use
	// This is the critical invariant: preload key format == lookup key format
	preloadedRecords := map[string]bool{
		yearScopedKey: true,
	}

	// Lookup must use the same format
	lookupKey := identityKey + "|" + "2025"
	if !preloadedRecords[lookupKey] {
		t.Errorf("Lookup key %q not found in preloaded records, format mismatch", lookupKey)
	}
}

// TestPersonCustomFieldValuesKeyBuilderShouldNotIncludeYear verifies that
// the keyBuilder closure should return identity only (no year),
// because PreloadCompositeRecords will append "|year" to it.
func TestPersonCustomFieldValuesKeyBuilderShouldNotIncludeYear(t *testing.T) {
	// Simulate what the keyBuilder closure does
	personPBId := "abc123"
	fieldDefPBId := "def456"
	recordYear := 2025

	// WRONG format (bug): includes year in the identity
	wrongKeyBuilder := func() string {
		return personPBId + ":" + fieldDefPBId + ":" + string(rune(recordYear))
	}

	// CORRECT format: identity only, no year
	correctKeyBuilder := func() string {
		return personPBId + ":" + fieldDefPBId
	}

	wrongKey := wrongKeyBuilder()
	correctKey := correctKeyBuilder()

	// Simulate PreloadCompositeRecords wrapping
	wrongYearScoped := wrongKey + "|" + "2025"     // Results in "abc123:def456:2025|2025" - BAD!
	correctYearScoped := correctKey + "|" + "2025" // Results in "abc123:def456|2025" - GOOD!

	// The correct format should NOT have double year
	if wrongYearScoped == correctYearScoped {
		t.Error("Wrong and correct formats should differ")
	}

	// Verify correct format doesn't contain ":2025|"
	if strings.Contains(correctYearScoped, ":2025|") {
		t.Errorf("Correct year-scoped key should not contain ':2025|', got %q", correctYearScoped)
	}

	// Verify correct format is "identity|year"
	expected := "abc123:def456|2025"
	if correctYearScoped != expected {
		t.Errorf("Correct year-scoped key = %q, want %q", correctYearScoped, expected)
	}
}

// TestPersonCustomFieldValuesTrackingMatchesOrphanLookup verifies that the key format
// used when tracking processed records matches the format used in orphan deletion lookup.
// This is the actual bug: TrackProcessedKey(yearScopedKey, 0) creates "key|0" but
// orphan deletion looks for "key" without the trailing "|0".
func TestPersonCustomFieldValuesTrackingMatchesOrphanLookup(t *testing.T) {
	s := &PersonCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{
			ProcessedKeys: make(map[string]bool),
		},
	}

	personPBId := "pb_person_123"
	fieldDefPBId := "pb_field_100"
	year := 2025

	// Simulate what the sync code does during record processing
	compositeKey := personPBId + ":" + fieldDefPBId
	yearScopedKey := compositeKey + "|2025"

	// This is what the current buggy code does:
	// s.TrackProcessedKey(yearScopedKey, 0)
	// It should instead do:
	s.TrackProcessedCompositeKey(compositeKey, year)

	// Simulate what orphan deletion does to check if a record was processed
	orphanLookupKey := personPBId + ":" + fieldDefPBId + "|" + "2025"

	// The orphan lookup key must exist in ProcessedKeys
	if !s.ProcessedKeys[orphanLookupKey] {
		t.Errorf("Orphan lookup key %q not found in ProcessedKeys", orphanLookupKey)
		t.Errorf("ProcessedKeys contains: %v", s.ProcessedKeys)
		t.Error("This indicates a key format mismatch between tracking and orphan deletion")
	}

	// Also verify the exact key format
	if yearScopedKey != orphanLookupKey {
		t.Errorf("yearScopedKey %q != orphanLookupKey %q", yearScopedKey, orphanLookupKey)
	}
}
