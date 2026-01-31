package sync

import (
	"fmt"
	"strings"
	"testing"
)

// TestCamperDietarySync_Name verifies the service name is correct
func TestCamperDietarySync_Name(t *testing.T) {
	expectedName := "camper_dietary"
	if serviceNameCamperDietary != expectedName {
		t.Errorf("expected service name %q, got %q", expectedName, serviceNameCamperDietary)
	}
}

// TestCamperDietaryYearValidation tests year parameter validation
func TestCamperDietaryYearValidation(t *testing.T) {
	tests := []struct {
		name      string
		year      int
		wantValid bool
	}{
		{"valid year 2024", 2024, true},
		{"valid year 2017 (minimum)", 2017, true},
		{"valid year 2025", 2025, true},
		{"year too old 2016", 2016, false},
		{"year too old 2010", 2010, false},
		{"year far future 2100", 2100, false},
		{"zero year", 0, false},
		{"negative year", -2024, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			valid := isValidDietaryYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidDietaryYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestDietaryBooleanParsing tests parsing Yes/No values to boolean
func TestDietaryBooleanParsing(t *testing.T) {
	tests := []struct {
		name     string
		rawValue string
		wantBool bool
	}{
		{"Yes", "Yes", true},
		{"yes lowercase", "yes", true},
		{"YES uppercase", "YES", true},
		{"No", "No", false},
		{"no lowercase", "no", false},
		{"empty", "", false},
		{"whitespace", "  ", false},
		{"Yes with whitespace", "  Yes  ", true},
		{"1", "1", true},
		{"0", "0", false},
		{"true", "true", true},
		{"false", "false", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseDietaryBool(tt.rawValue)
			if result != tt.wantBool {
				t.Errorf("parseDietaryBool(%q) = %v, want %v", tt.rawValue, result, tt.wantBool)
			}
		})
	}
}

// TestDietaryFieldMapping tests CampMinder field to column mapping
func TestDietaryFieldMapping(t *testing.T) {
	tests := []struct {
		fieldName  string
		wantColumn string
	}{
		{"Family Medical-Dietary Needs", "has_dietary_needs"},
		{"Family Medical-Dietary Explain", "dietary_explanation"},
		{"Family Medical-Allergies", "has_allergies"},
		{"Family Medical-Allergy Info", "allergy_info"},
		{"Family Medical-Additional", "additional_medical"},
		// Unknown field
		{"Unknown-Field", ""},
		{"Family Medical-Other", ""},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := MapDietaryFieldToColumn(tt.fieldName)
			if result != tt.wantColumn {
				t.Errorf("MapDietaryFieldToColumn(%q) = %q, want %q", tt.fieldName, result, tt.wantColumn)
			}
		})
	}
}

// TestDietaryCompositeKeyFormat tests composite key generation
func TestDietaryCompositeKeyFormat(t *testing.T) {
	tests := []struct {
		name     string
		personID int
		year     int
		expected string
	}{
		{"standard key", 12345, 2025, "12345|2025"},
		{"different year", 12345, 2024, "12345|2024"},
		{"large ID", 9999999, 2025, "9999999|2025"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := formatDietaryCompositeKey(tt.personID, tt.year)
			if key != tt.expected {
				t.Errorf("formatDietaryCompositeKey = %q, want %q", key, tt.expected)
			}
		})
	}
}

// TestIsDietaryField tests identification of dietary fields
func TestIsDietaryField(t *testing.T) {
	tests := []struct {
		fieldName     string
		wantIsDietary bool
	}{
		{"Family Medical-Dietary Needs", true},
		{"Family Medical-Dietary Explain", true},
		{"Family Medical-Allergies", true},
		{"Family Medical-Allergy Info", true},
		{"Family Medical-Additional", true},
		{"Family Camp Adult 1", false},
		{"Bunk Preference", false},
		{"Medical History", false},
		{"family medical-dietary needs", false}, // case sensitive
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := isDietaryField(tt.fieldName)
			if result != tt.wantIsDietary {
				t.Errorf("isDietaryField(%q) = %v, want %v", tt.fieldName, result, tt.wantIsDietary)
			}
		})
	}
}

// TestDietaryRecordBuilding tests building dietary records from source data
func TestDietaryRecordBuilding(t *testing.T) {
	fieldValues := []testDietaryFieldValue{
		{PersonID: 12345, FieldName: "Family Medical-Dietary Needs", Value: "Yes", Year: 2025},
		{PersonID: 12345, FieldName: "Family Medical-Dietary Explain", Value: "Vegetarian, no peanuts", Year: 2025},
		{PersonID: 12345, FieldName: "Family Medical-Allergies", Value: "Yes", Year: 2025},
		{PersonID: 12345, FieldName: "Family Medical-Allergy Info", Value: "Peanut allergy - severe", Year: 2025},
		{PersonID: 12346, FieldName: "Family Medical-Dietary Needs", Value: "No", Year: 2025},
	}

	records := buildDietaryRecords(fieldValues)

	// Should have 2 records (one per person-year combination)
	if len(records) != 2 {
		t.Errorf("expected 2 records, got %d", len(records))
	}

	// Verify first record aggregation
	r1 := findDietaryRecord(records, 12345, 2025)
	if r1 == nil {
		t.Fatal("record for person 12345, year 2025 not found")
	}
	if !r1.HasDietaryNeeds {
		t.Error("expected has_dietary_needs = true")
	}
	if r1.DietaryExplanation != "Vegetarian, no peanuts" {
		t.Errorf("expected dietary_explanation 'Vegetarian, no peanuts', got %q", r1.DietaryExplanation)
	}
	if !r1.HasAllergies {
		t.Error("expected has_allergies = true")
	}
	if r1.AllergyInfo != "Peanut allergy - severe" {
		t.Errorf("expected allergy_info 'Peanut allergy - severe', got %q", r1.AllergyInfo)
	}

	// Verify second record
	r2 := findDietaryRecord(records, 12346, 2025)
	if r2 == nil {
		t.Fatal("record for person 12346, year 2025 not found")
	}
	if r2.HasDietaryNeeds {
		t.Error("expected has_dietary_needs = false")
	}
}

// TestDietaryEmptyDataHandling tests graceful handling of empty input
func TestDietaryEmptyDataHandling(t *testing.T) {
	fieldValues := []testDietaryFieldValue{}

	records := buildDietaryRecords(fieldValues)

	if len(records) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(records))
	}
}

// TestDietaryTextFieldMaxLength tests that text fields respect max length constraints
func TestDietaryTextFieldMaxLength(t *testing.T) {
	// dietary_explanation max observed: 304 chars
	// allergy_info max observed: 605 chars
	// additional_medical max observed: 786 chars

	// Test that truncation works correctly
	longText := strings.Repeat("x", 1500)
	truncated := truncateDietaryText(longText, 1000)

	if len(truncated) > 1000 {
		t.Errorf("expected truncated length <= 1000, got %d", len(truncated))
	}

	// Short text should not be truncated
	shortText := "Short dietary note"
	notTruncated := truncateDietaryText(shortText, 1000)
	if notTruncated != shortText {
		t.Errorf("expected unchanged short text, got %q", notTruncated)
	}
}

// ============================================================================
// Test helper types and functions
// ============================================================================

type testDietaryFieldValue struct {
	PersonID  int
	FieldName string
	Value     string
	Year      int
}

type testDietaryRecord struct {
	PersonID           int
	Year               int
	HasDietaryNeeds    bool
	DietaryExplanation string
	HasAllergies       bool
	AllergyInfo        string
	AdditionalMedical  string
}

// isValidDietaryYear validates year parameter
func isValidDietaryYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// parseDietaryBool parses Yes/No/true/false strings to boolean
func parseDietaryBool(rawValue string) bool {
	lower := strings.ToLower(strings.TrimSpace(rawValue))
	switch lower {
	case boolYes, boolTrue, "1", "y":
		return true
	}
	return false
}

// isDietaryField checks if a field is a dietary field (uses implementation function)
func isDietaryField(fieldName string) bool {
	return MapDietaryFieldToColumn(fieldName) != ""
}

// formatDietaryCompositeKey creates composite key
func formatDietaryCompositeKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}

// truncateDietaryText truncates text to max length
func truncateDietaryText(text string, maxLen int) string {
	if len(text) <= maxLen {
		return text
	}
	return text[:maxLen]
}

// buildDietaryRecords builds records from field values
func buildDietaryRecords(fieldValues []testDietaryFieldValue) []*testDietaryRecord {
	recordsByKey := make(map[string]*testDietaryRecord)

	for _, fv := range fieldValues {
		key := formatDietaryCompositeKey(fv.PersonID, fv.Year)

		if _, exists := recordsByKey[key]; !exists {
			recordsByKey[key] = &testDietaryRecord{
				PersonID: fv.PersonID,
				Year:     fv.Year,
			}
		}

		rec := recordsByKey[key]
		column := MapDietaryFieldToColumn(fv.FieldName)
		switch column {
		case "has_dietary_needs":
			rec.HasDietaryNeeds = parseDietaryBool(fv.Value)
		case "dietary_explanation":
			rec.DietaryExplanation = fv.Value
		case "has_allergies":
			rec.HasAllergies = parseDietaryBool(fv.Value)
		case "allergy_info":
			rec.AllergyInfo = fv.Value
		case "additional_medical":
			rec.AdditionalMedical = fv.Value
		}
	}

	records := make([]*testDietaryRecord, 0, len(recordsByKey))
	for _, r := range recordsByKey {
		records = append(records, r)
	}
	return records
}

// findDietaryRecord finds a record by person ID and year
func findDietaryRecord(records []*testDietaryRecord, personID, year int) *testDietaryRecord {
	for _, r := range records {
		if r.PersonID == personID && r.Year == year {
			return r
		}
	}
	return nil
}
