package sync

import (
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
