package sync

import (
	"fmt"
	"testing"
)

// TestStaffVehicleInfoServiceName verifies the service name constant
func TestStaffVehicleInfoServiceName(t *testing.T) {
	expected := "staff_vehicle_info"
	if serviceNameStaffVehicleInfo != expected {
		t.Errorf("serviceNameStaffVehicleInfo = %q, want %q", serviceNameStaffVehicleInfo, expected)
	}
}

// TestMapSVIFieldToColumn tests the CampMinder field name to column mapping
// for the 8 SVI- fields used in staff vehicle info
func TestMapSVIFieldToColumn(t *testing.T) {
	tests := []struct {
		cmField  string
		expected string
	}{
		// Driving to camp
		{"SVI-are you driving to camp", "driving_to_camp"},
		{"SVI-how are you get to camp", "how_getting_to_camp"},

		// Bringing others
		{"SVI - bring others", "can_bring_others"},
		{"SVI- Who is driving you to camp", "driver_name"},
		{"SVI-which friend", "which_friend"},

		// Vehicle info
		{"SVI-make of vehicle", "vehicle_make"},
		{"SVI-model vehicle", "vehicle_model"},
		{"SVI-licence plate number", "license_plate"},

		// Unknown field should return empty
		{"Unknown-Field", ""},
		{"SVI-Unknown", ""},
	}

	for _, tt := range tests {
		t.Run(tt.cmField, func(t *testing.T) {
			got := MapSVIFieldToColumn(tt.cmField)
			if got != tt.expected {
				t.Errorf("MapSVIFieldToColumn(%q) = %q, want %q", tt.cmField, got, tt.expected)
			}
		})
	}
}

// TestParseSVIBool tests boolean parsing for staff vehicle info fields
func TestParseSVIBool(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"Yes", true},
		{"yes", true},
		{"YES", true},
		{"No", false},
		{"no", false},
		{"NO", false},
		{"", false},
		{"Maybe", false},
		{"1", false}, // Only "Yes" variants are true
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := parseSVIBool(tt.input)
			if got != tt.expected {
				t.Errorf("parseSVIBool(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

// TestStaffVehicleInfoCompositeKey tests the unique key generation
// Key format: personID|year
func TestStaffVehicleInfoCompositeKey(t *testing.T) {
	tests := []struct {
		personID int
		year     int
		expected string
	}{
		{12345, 2025, "12345|2025"},
		{67890, 2026, "67890|2026"},
		{100001, 2024, "100001|2024"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			got := makeStaffVehicleInfoKey(tt.personID, tt.year)
			if got != tt.expected {
				t.Errorf("makeStaffVehicleInfoKey(%d, %d) = %q, want %q",
					tt.personID, tt.year, got, tt.expected)
			}
		})
	}
}

// TestStaffVehicleInfoFieldMapping tests that all expected fields are present
func TestStaffVehicleInfoFieldMapping(t *testing.T) {
	expectedFields := []string{
		"driving_to_camp",
		"how_getting_to_camp",
		"can_bring_others",
		"driver_name",
		"which_friend",
		"vehicle_make",
		"vehicle_model",
		"license_plate",
	}

	// Verify we have all 8 expected columns (excluding staff, person_id, year, created, updated)
	if len(expectedFields) != 8 {
		t.Errorf("Expected 8 custom fields, got %d", len(expectedFields))
	}

	// Test each field has a valid CM field mapping back
	for _, field := range expectedFields {
		cmField := getSVICMFieldForColumn(field)
		if cmField == "" {
			t.Errorf("Column %q has no CampMinder field mapping", field)
		}

		// Verify round-trip
		backToColumn := MapSVIFieldToColumn(cmField)
		if backToColumn != field {
			t.Errorf("Round-trip failed: column %q -> cmField %q -> column %q",
				field, cmField, backToColumn)
		}
	}
}

// TestStaffVehicleInfoBooleanFields tests that we correctly identify boolean fields
func TestStaffVehicleInfoBooleanFields(t *testing.T) {
	boolFields := []string{
		"driving_to_camp",
		"can_bring_others",
	}

	textFields := []string{
		"how_getting_to_camp",
		"driver_name",
		"which_friend",
		"vehicle_make",
		"vehicle_model",
		"license_plate",
	}

	for _, field := range boolFields {
		if !isSVIBoolField(field) {
			t.Errorf("Expected %q to be a boolean field", field)
		}
	}

	for _, field := range textFields {
		if isSVIBoolField(field) {
			t.Errorf("Expected %q to be a text field, not boolean", field)
		}
	}
}

// Helper functions that define expected behavior - implementation must match these

// MapSVIFieldToColumn maps CampMinder custom field names to database column names
func MapSVIFieldToColumn(cmField string) string {
	mapping := map[string]string{
		"SVI-are you driving to camp":     "driving_to_camp",
		"SVI-how are you get to camp":     "how_getting_to_camp",
		"SVI - bring others":              "can_bring_others",
		"SVI- Who is driving you to camp": "driver_name",
		"SVI-which friend":                "which_friend",
		"SVI-make of vehicle":             "vehicle_make",
		"SVI-model vehicle":               "vehicle_model",
		"SVI-licence plate number":        "license_plate",
	}

	return mapping[cmField]
}

// getSVICMFieldForColumn is the reverse mapping
func getSVICMFieldForColumn(column string) string {
	mapping := map[string]string{
		"driving_to_camp":     "SVI-are you driving to camp",
		"how_getting_to_camp": "SVI-how are you get to camp",
		"can_bring_others":    "SVI - bring others",
		"driver_name":         "SVI- Who is driving you to camp",
		"which_friend":        "SVI-which friend",
		"vehicle_make":        "SVI-make of vehicle",
		"vehicle_model":       "SVI-model vehicle",
		"license_plate":       "SVI-licence plate number",
	}

	return mapping[column]
}

// parseSVIBool parses Yes/No values to boolean
func parseSVIBool(value string) bool {
	switch value {
	case "Yes", "yes", "YES":
		return true
	default:
		return false
	}
}

// isSVIBoolField returns true if the column should be parsed as boolean
func isSVIBoolField(column string) bool {
	switch column {
	case "driving_to_camp", "can_bring_others":
		return true
	default:
		return false
	}
}

// makeStaffVehicleInfoKey creates the composite key for upsert logic
func makeStaffVehicleInfoKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}
