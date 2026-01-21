package sync

import (
	"testing"
)

func TestHouseholdCustomFieldValuesSync_Name(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	got := s.Name()
	want := "household_custom_field_values"

	if got != want {
		t.Errorf("HouseholdCustomFieldValuesSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformHouseholdCustomFieldValueToPB tests transformation to PocketBase format
func TestTransformHouseholdCustomFieldValueToPB(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	// Mock CampMinder API response for a custom field value
	data := map[string]interface{}{
		"Id":          float64(100), // Custom field definition ID
		"ClientID":    float64(123),
		"SeasonID":    float64(456),
		"Value":       "Premium",
		"LastUpdated": "2025-01-15T10:30:00Z",
	}

	householdID := 54321
	year := 2025

	pbData, err := s.transformHouseholdCustomFieldValueToPB(data, householdID, year)
	if err != nil {
		t.Fatalf("transformHouseholdCustomFieldValueToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["household_id"].(int), 54321; got != want {
		t.Errorf("household_id = %d, want %d", got, want)
	}
	if got, want := pbData["field_id"].(int), 100; got != want {
		t.Errorf("field_id = %d, want %d", got, want)
	}
	if got, want := pbData["season_id"].(int), 456; got != want {
		t.Errorf("season_id = %d, want %d", got, want)
	}
	if got, want := pbData["value"].(string), "Premium"; got != want {
		t.Errorf("value = %q, want %q", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
}

// TestTransformHouseholdCustomFieldValueRequiredFieldIDError tests error on missing field ID
func TestTransformHouseholdCustomFieldValueRequiredFieldIDError(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	data := map[string]interface{}{
		"Value": "Some value",
	}

	_, err := s.transformHouseholdCustomFieldValueToPB(data, 54321, 2025)
	if err == nil {
		t.Error("expected error for missing Id, got nil")
	}
}
