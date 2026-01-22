package sync

import (
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
