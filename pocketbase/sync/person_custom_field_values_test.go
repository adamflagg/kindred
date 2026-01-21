package sync

import (
	"testing"
)

func TestPersonCustomFieldValuesSync_Name(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	got := s.Name()
	want := "person_custom_field_values"

	if got != want {
		t.Errorf("PersonCustomFieldValuesSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformPersonCustomFieldValueToPB tests transformation to PocketBase format
func TestTransformPersonCustomFieldValueToPB(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Mock CampMinder API response for a custom field value
	data := map[string]interface{}{
		"Id":          float64(100), // Custom field definition ID
		"ClientID":    float64(123),
		"SeasonID":    float64(456),
		"Value":       "Vegetarian",
		"LastUpdated": "2025-01-15T10:30:00Z",
	}

	personID := 12345
	year := 2025

	pbData, err := s.transformPersonCustomFieldValueToPB(data, personID, year)
	if err != nil {
		t.Fatalf("transformPersonCustomFieldValueToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["person_id"].(int), 12345; got != want {
		t.Errorf("person_id = %d, want %d", got, want)
	}
	if got, want := pbData["field_id"].(int), 100; got != want {
		t.Errorf("field_id = %d, want %d", got, want)
	}
	if got, want := pbData["season_id"].(int), 456; got != want {
		t.Errorf("season_id = %d, want %d", got, want)
	}
	if got, want := pbData["value"].(string), "Vegetarian"; got != want {
		t.Errorf("value = %q, want %q", got, want)
	}
	if got, want := pbData["last_updated"].(string), "2025-01-15T10:30:00Z"; got != want {
		t.Errorf("last_updated = %q, want %q", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
}

// TestTransformPersonCustomFieldValueHandlesNilSeasonID tests handling of nil SeasonID
func TestTransformPersonCustomFieldValueHandlesNilSeasonID(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Non-seasonal field (no SeasonID)
	data := map[string]interface{}{
		"Id":          float64(100),
		"ClientID":    float64(123),
		"Value":       "Some value",
		"LastUpdated": "2025-01-15T10:30:00Z",
	}

	pbData, err := s.transformPersonCustomFieldValueToPB(data, 12345, 2025)
	if err != nil {
		t.Fatalf("transformPersonCustomFieldValueToPB returned error: %v", err)
	}

	// season_id should be 0 for non-seasonal fields
	if got, want := pbData["season_id"].(int), 0; got != want {
		t.Errorf("season_id = %d, want %d (0 for non-seasonal)", got, want)
	}
}

// TestTransformPersonCustomFieldValueRequiredFieldIDError tests error on missing field ID
func TestTransformPersonCustomFieldValueRequiredFieldIDError(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Missing Id field
	data := map[string]interface{}{
		"Value": "Some value",
	}

	_, err := s.transformPersonCustomFieldValueToPB(data, 12345, 2025)
	if err == nil {
		t.Error("expected error for missing Id, got nil")
	}
}

// TestTransformPersonCustomFieldValueZeroFieldIDError tests error on field ID = 0
func TestTransformPersonCustomFieldValueZeroFieldIDError(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Id = 0 (invalid)
	data := map[string]interface{}{
		"Id":    float64(0),
		"Value": "Some value",
	}

	_, err := s.transformPersonCustomFieldValueToPB(data, 12345, 2025)
	if err == nil {
		t.Error("expected error for Id=0, got nil")
	}
}

// TestTransformPersonCustomFieldValueEmptyValue tests that empty values are allowed
func TestTransformPersonCustomFieldValueEmptyValue(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Empty value is valid (field might be cleared)
	data := map[string]interface{}{
		"Id":    float64(100),
		"Value": "",
	}

	pbData, err := s.transformPersonCustomFieldValueToPB(data, 12345, 2025)
	if err != nil {
		t.Fatalf("transformPersonCustomFieldValueToPB returned error for empty value: %v", err)
	}

	if got := pbData["value"].(string); got != "" {
		t.Errorf("value = %q, want empty string", got)
	}
}

// TestTransformPersonCustomFieldValueNilValue tests handling of nil Value
func TestTransformPersonCustomFieldValueNilValue(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Nil value (field has no value set)
	data := map[string]interface{}{
		"Id": float64(100),
		// Value is missing/nil
	}

	pbData, err := s.transformPersonCustomFieldValueToPB(data, 12345, 2025)
	if err != nil {
		t.Fatalf("transformPersonCustomFieldValueToPB returned error for nil value: %v", err)
	}

	// Should default to empty string
	if got := pbData["value"].(string); got != "" {
		t.Errorf("value = %q, want empty string for nil", got)
	}
}
