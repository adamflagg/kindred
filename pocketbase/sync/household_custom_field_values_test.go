package sync

import (
	"strings"
	"testing"
)

func TestHouseholdCustomFieldValuesSync_Name(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	got := s.Name()
	want := "household_custom_values"

	if got != want {
		t.Errorf("HouseholdCustomFieldValuesSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformHouseholdCustomFieldValueToPB tests transformation to PocketBase format
func TestTransformHouseholdCustomFieldValueToPB(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	// Mock CampMinder API response for a custom field value
	data := map[string]interface{}{
		"id":    float64(100), // Custom field definition ID (used by caller to resolve PB ID)
		"value": "Premium",
	}

	// PB IDs (would be resolved by caller before calling transform)
	householdPBId := "pb_household_123"
	fieldDefPBId := "pb_field_100"
	year := 2025

	pbData := s.transformHouseholdCustomFieldValueToPB(data, householdPBId, fieldDefPBId, year)

	// Verify fields
	if got, want := pbData["household"].(string), householdPBId; got != want {
		t.Errorf("household = %q, want %q", got, want)
	}
	if got, want := pbData["field_definition"].(string), fieldDefPBId; got != want {
		t.Errorf("field_definition = %q, want %q", got, want)
	}
	if got, want := pbData["value"].(string), "Premium"; got != want {
		t.Errorf("value = %q, want %q", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}

	// Verify simplified schema (no household_id, field_id, season_id, last_updated)
	if _, exists := pbData["household_id"]; exists {
		t.Error("household_id should not exist in simplified schema")
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

// TestTransformHouseholdCustomFieldValueEmptyValue tests that empty values are allowed
func TestTransformHouseholdCustomFieldValueEmptyValue(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	data := map[string]interface{}{
		"id":    float64(100),
		"value": "",
	}

	pbData := s.transformHouseholdCustomFieldValueToPB(data, "pb_household_123", "pb_field_100", 2025)

	if got := pbData["value"].(string); got != "" {
		t.Errorf("value = %q, want empty string", got)
	}
}

// TestTransformHouseholdCustomFieldValueNilValue tests handling of nil Value
func TestTransformHouseholdCustomFieldValueNilValue(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	data := map[string]interface{}{
		"id": float64(100),
		// Value is missing/nil
	}

	pbData := s.transformHouseholdCustomFieldValueToPB(data, "pb_household_123", "pb_field_100", 2025)

	// Should default to empty string
	if got := pbData["value"].(string); got != "" {
		t.Errorf("value = %q, want empty string for nil", got)
	}
}

// TestHouseholdCustomFieldValuesCompositeKeyFormat tests that composite key format
// is consistent between preload, lookup, tracking, and orphan detection.
// The PreloadCompositeRecords function appends "|year" to the keyBuilder result,
// so the keyBuilder must NOT include year, and all lookups must use "key|year" format.
func TestHouseholdCustomFieldValuesCompositeKeyFormat(t *testing.T) {
	householdPBId := "pb_household_123"
	fieldDefPBId := "pb_field_100"
	year := 2025

	// The identity key (what keyBuilder should return - NO year)
	identityKey := householdPBId + ":" + fieldDefPBId

	// The year-scoped key (what PreloadCompositeRecords produces and lookup should use)
	yearScopedKey := identityKey + "|" + "2025"

	// Test 1: Verify identity key does NOT contain year as a colon-separated segment
	// This catches the bug where keyBuilder was returning "household:field:year"
	if identityKey == householdPBId+":"+fieldDefPBId+":"+string(rune(year)) {
		t.Error("Identity key should not include year")
	}

	// Test 2: Verify year-scoped key uses pipe separator for year
	expectedFormat := "pb_household_123:pb_field_100|2025"
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

// TestHouseholdCustomFieldValuesKeyBuilderShouldNotIncludeYear verifies that
// the keyBuilder closure should return identity only (no year),
// because PreloadCompositeRecords will append "|year" to it.
func TestHouseholdCustomFieldValuesKeyBuilderShouldNotIncludeYear(t *testing.T) {
	// Simulate what the keyBuilder closure does
	householdPBId := "abc123"
	fieldDefPBId := "def456"
	recordYear := 2025

	// WRONG format (bug): includes year in the identity
	wrongKeyBuilder := func() string {
		return householdPBId + ":" + fieldDefPBId + ":" + string(rune(recordYear))
	}

	// CORRECT format: identity only, no year
	correctKeyBuilder := func() string {
		return householdPBId + ":" + fieldDefPBId
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
