package sync

import (
	"testing"
)

// TestTransformPersonCustomFieldValue_CapturesLastUpdated verifies that
// lastUpdated from API response is captured in the transformed data
func TestTransformPersonCustomFieldValue_CapturesLastUpdated(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Mock CampMinder API response with lastUpdated
	data := map[string]interface{}{
		"id":          float64(100),
		"value":       "Vegetarian",
		"lastUpdated": "2025-01-15T10:30:00Z",
	}

	pbData := s.transformPersonCustomFieldValueToPB(data, "pb_person_123", "pb_field_100", 2025)

	// Verify lastUpdated is captured
	if got, exists := pbData["last_updated"]; !exists {
		t.Error("last_updated field should exist in transformed data")
	} else if got != "2025-01-15T10:30:00Z" {
		t.Errorf("last_updated = %q, want %q", got, "2025-01-15T10:30:00Z")
	}
}

// TestTransformPersonCustomFieldValue_MissingLastUpdated verifies that
// transform handles missing lastUpdated gracefully (field not set)
func TestTransformPersonCustomFieldValue_MissingLastUpdated(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Mock CampMinder API response WITHOUT lastUpdated
	data := map[string]interface{}{
		"id":    float64(100),
		"value": "Vegetarian",
		// lastUpdated is missing
	}

	pbData := s.transformPersonCustomFieldValueToPB(data, "pb_person_123", "pb_field_100", 2025)

	// When lastUpdated is missing, field should not be set in pbData
	// (this allows existing records to keep their lastUpdated value)
	if _, exists := pbData["last_updated"]; exists {
		t.Error("last_updated should not be set when missing from API response")
	}
}

// TestTransformPersonCustomFieldValue_EmptyLastUpdated verifies that
// empty lastUpdated strings are handled (treated as missing)
func TestTransformPersonCustomFieldValue_EmptyLastUpdated(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	data := map[string]interface{}{
		"id":          float64(100),
		"value":       "Vegetarian",
		"lastUpdated": "",
	}

	pbData := s.transformPersonCustomFieldValueToPB(data, "pb_person_123", "pb_field_100", 2025)

	// Empty lastUpdated should not be set (treat as missing)
	if _, exists := pbData["last_updated"]; exists {
		t.Error("last_updated should not be set for empty string")
	}
}

// TestTransformHouseholdCustomFieldValue_CapturesLastUpdated verifies that
// lastUpdated from API response is captured for household sync
func TestTransformHouseholdCustomFieldValue_CapturesLastUpdated(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	data := map[string]interface{}{
		"id":          float64(200),
		"value":       "Has dietary restrictions",
		"lastUpdated": "2025-01-20T14:45:00Z",
	}

	pbData := s.transformHouseholdCustomFieldValueToPB(data, "pb_household_456", "pb_field_200", 2025)

	// Verify lastUpdated is captured
	if got, exists := pbData["last_updated"]; !exists {
		t.Error("last_updated field should exist in transformed data")
	} else if got != "2025-01-20T14:45:00Z" {
		t.Errorf("last_updated = %q, want %q", got, "2025-01-20T14:45:00Z")
	}
}

// TestTransformHouseholdCustomFieldValue_MissingLastUpdated verifies that
// transform handles missing lastUpdated gracefully for household sync
func TestTransformHouseholdCustomFieldValue_MissingLastUpdated(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	data := map[string]interface{}{
		"id":    float64(200),
		"value": "Has dietary restrictions",
		// lastUpdated is missing
	}

	pbData := s.transformHouseholdCustomFieldValueToPB(data, "pb_household_456", "pb_field_200", 2025)

	// When lastUpdated is missing, field should not be set
	if _, exists := pbData["last_updated"]; exists {
		t.Error("last_updated should not be set when missing from API response")
	}
}

// Note: Testing the comparison logic (skip when lastUpdated unchanged, update when changed)
// requires mocking PocketBase records, which is complex. The unit tests above verify the
// transform logic. Integration tests or manual testing should verify the comparison behavior.
//
// The expected behavior in syncPersonCustomFieldValues is:
// 1. If both existingRecord.last_updated and newData.last_updated exist and match → skip
// 2. If lastUpdated differs OR value differs → update
// 3. If lastUpdated is missing from API → fall back to value comparison only
