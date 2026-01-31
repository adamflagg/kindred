package sync

import (
	"fmt"
	"strings"
	"testing"
)

// TestCamperTransportationSync_Name verifies the service name is correct
func TestCamperTransportationSync_Name(t *testing.T) {
	expectedName := "camper_transportation"
	if serviceNameCamperTransportation != expectedName {
		t.Errorf("expected service name %q, got %q", expectedName, serviceNameCamperTransportation)
	}
}

// TestCamperTransportationYearValidation tests year parameter validation
func TestCamperTransportationYearValidation(t *testing.T) {
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
			valid := isValidTransportationYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidTransportationYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestTransportationMethodParsing tests parsing of transportation method values
func TestTransportationMethodParsing(t *testing.T) {
	tests := []struct {
		name     string
		rawValue string
		expected string
	}{
		{"Bus from San Francisco", "Bus-SF", "Bus-SF"},
		{"Bus from Palo Alto", "Bus-PA", "Bus-PA"},
		{"Bus from Marin", "Bus-Marin", "Bus-Marin"},
		{"Flying", "Flying", "Flying"},
		{"Parent Dropoff", "Parent Dropoff", "Parent Dropoff"},
		{"Other", "Other", "Other"},
		{"Legacy cmFieldBusToCamp", "cmFieldBusToCamp", "cmFieldBusToCamp"},
		{"empty value", "", ""},
		{"whitespace value", "  Bus-SF  ", "Bus-SF"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeTransportMethod(tt.rawValue)
			if result != tt.expected {
				t.Errorf("normalizeTransportMethod(%q) = %q, want %q", tt.rawValue, result, tt.expected)
			}
		})
	}
}

// TestTransportationFieldMapping tests CampMinder field to column mapping
func TestTransportationFieldMapping(t *testing.T) {
	tests := []struct {
		fieldName  string
		wantColumn string
	}{
		// Modern BUS- prefixed fields
		{"BUS-to camp", "to_camp_method"},
		{"BUS-home from camp", "from_camp_method"},
		{"BUS-who is dropping off", "dropoff_name"},
		{"BUS-Phone number of person dropping off-correct", "dropoff_phone"},
		{"BUS-relation to camper drop off", "dropoff_relationship"},
		{"BUS-person picking up", "pickup_name"},
		{"BUS-phone number of person picking up", "pickup_phone"},
		{"BUS-relationship to camper pick up person", "pickup_relationship"},
		{"BUS-alternate person 1 picking up", "alt_pickup_1_name"},
		{"BUS-alternate 1 phone", "alt_pickup_1_phone"},
		{"BUS-alternate person relation to camper", "alt_pickup_1_relationship"},
		{"BUS-alternate person 2", "alt_pickup_2_name"},
		{"BUS-alternate person 2 phone", "alt_pickup_2_phone"},
		// Legacy fields (map to same columns as modern fields)
		{"cmFieldBusToCamp", "to_camp_method"},
		{"Bus From Camp", "from_camp_method"},
		// Unknown field
		{"Unknown-Field", ""},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := MapTransportationFieldToColumn(tt.fieldName)
			if result != tt.wantColumn {
				t.Errorf("MapTransportationFieldToColumn(%q) = %q, want %q", tt.fieldName, result, tt.wantColumn)
			}
		})
	}
}

// TestTransportationCompositeKeyFormat tests composite key generation
func TestTransportationCompositeKeyFormat(t *testing.T) {
	tests := []struct {
		name      string
		personID  int
		sessionID int
		year      int
		expected  string
	}{
		{"standard key", 12345, 1000001, 2025, "12345:1000001|2025"},
		{"different year", 12345, 1000001, 2024, "12345:1000001|2024"},
		{"large IDs", 9999999, 9999999, 2025, "9999999:9999999|2025"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := formatTransportationCompositeKey(tt.personID, tt.sessionID, tt.year)
			if key != tt.expected {
				t.Errorf("formatTransportationCompositeKey = %q, want %q", key, tt.expected)
			}
		})
	}
}

// TestIsTransportationField tests identification of transportation fields
func TestIsTransportationField(t *testing.T) {
	tests := []struct {
		fieldName            string
		wantIsTransportation bool
	}{
		{"BUS-to camp", true},
		{"BUS-home from camp", true},
		{"BUS-who is dropping off", true},
		{"cmFieldBusToCamp", true},   // Legacy
		{"Bus From Camp", true}, // Legacy
		{"Family Camp Adult 1", false},
		{"Bunk Preference", false},
		{"BUS", false},         // No hyphen
		{"bus-to camp", false}, // lowercase
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := isTransportationField(tt.fieldName)
			if result != tt.wantIsTransportation {
				t.Errorf("isTransportationField(%q) = %v, want %v", tt.fieldName, result, tt.wantIsTransportation)
			}
		})
	}
}

// TestLegacyFieldFallback tests that legacy fields are used when modern fields are empty
func TestLegacyFieldFallback(t *testing.T) {
	tests := []struct {
		name           string
		modernValue    string
		legacyValue    string
		expectedValue  string
		expectedLegacy bool
	}{
		{"modern value present", "Bus-SF", "cmFieldBusToCamp", "Bus-SF", false},
		{"only legacy value", "", "cmFieldBusToCamp", "cmFieldBusToCamp", true},
		{"both empty", "", "", "", false},
		{"modern whitespace only", "   ", "cmFieldBusToCamp", "cmFieldBusToCamp", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			value, usedLegacy := resolveTransportValue(tt.modernValue, tt.legacyValue)
			if value != tt.expectedValue {
				t.Errorf("resolveTransportValue value = %q, want %q", value, tt.expectedValue)
			}
			if usedLegacy != tt.expectedLegacy {
				t.Errorf("resolveTransportValue usedLegacy = %v, want %v", usedLegacy, tt.expectedLegacy)
			}
		})
	}
}

// TestTransportationRecordBuilding tests building transportation records from source data
func TestTransportationRecordBuilding(t *testing.T) {
	fieldValues := []testTransportFieldValue{
		{PersonID: 12345, SessionID: 1000001, FieldName: "BUS-to camp", Value: "Bus-SF", Year: 2025},
		{PersonID: 12345, SessionID: 1000001, FieldName: "BUS-home from camp", Value: "Flying", Year: 2025},
		{PersonID: 12345, SessionID: 1000001, FieldName: "BUS-who is dropping off", Value: "Jane Doe", Year: 2025},
		{PersonID: 12346, SessionID: 1000001, FieldName: "BUS-to camp", Value: "Parent Dropoff", Year: 2025},
	}

	records := buildTransportationRecords(fieldValues)

	// Should have 2 records (one per person-session combination)
	if len(records) != 2 {
		t.Errorf("expected 2 records, got %d", len(records))
	}

	// Verify first record aggregation
	r1 := findTransportRecord(records, 12345, 1000001)
	if r1 == nil {
		t.Fatal("record for person 12345, session 1000001 not found")
	}
	if r1.ToCampMethod != "Bus-SF" {
		t.Errorf("expected to_camp_method 'Bus-SF', got %q", r1.ToCampMethod)
	}
	if r1.FromCampMethod != "Flying" {
		t.Errorf("expected from_camp_method 'Flying', got %q", r1.FromCampMethod)
	}
	if r1.DropoffName != "Jane Doe" {
		t.Errorf("expected dropoff_name 'Jane Doe', got %q", r1.DropoffName)
	}
}

// TestTransportationEmptyDataHandling tests graceful handling of empty input
func TestTransportationEmptyDataHandling(t *testing.T) {
	fieldValues := []testTransportFieldValue{}

	records := buildTransportationRecords(fieldValues)

	if len(records) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(records))
	}
}

// ============================================================================
// Test helper types and functions
// ============================================================================

type testTransportFieldValue struct {
	PersonID  int
	SessionID int
	FieldName string
	Value     string
	Year      int
}

type testTransportRecord struct {
	PersonID           int
	SessionID          int
	Year               int
	ToCampMethod       string
	FromCampMethod     string
	DropoffName        string
	DropoffPhone       string
	DropoffRelation    string
	PickupName         string
	PickupPhone        string
	PickupRelation     string
	AltPickup1Name     string
	AltPickup1Phone    string
	AltPickup1Relation string
	AltPickup2Name     string
	AltPickup2Phone    string
	UsedLegacyFields   bool
}

// isValidTransportationYear validates year parameter
func isValidTransportationYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// normalizeTransportMethod normalizes transportation method strings
func normalizeTransportMethod(rawValue string) string {
	return strings.TrimSpace(rawValue)
}

// Note: MapTransportationFieldToColumn is defined in the implementation file

// isTransportationField checks if a field is a transportation field
func isTransportationField(fieldName string) bool {
	// Modern BUS- prefix
	if strings.HasPrefix(fieldName, "BUS-") {
		return true
	}
	// Legacy fields
	if fieldName == "cmFieldBusToCamp" || fieldName == "Bus From Camp" {
		return true
	}
	return false
}

// resolveTransportValue picks modern value or falls back to legacy
func resolveTransportValue(modernValue, legacyValue string) (string, bool) {
	modern := strings.TrimSpace(modernValue)
	if modern != "" {
		return modern, false
	}
	legacy := strings.TrimSpace(legacyValue)
	if legacy != "" {
		return legacy, true
	}
	return "", false
}

// formatTransportationCompositeKey creates composite key
func formatTransportationCompositeKey(personID, sessionID, year int) string {
	return fmt.Sprintf("%d:%d|%d", personID, sessionID, year)
}

// buildTransportationRecords builds records from field values
func buildTransportationRecords(fieldValues []testTransportFieldValue) []*testTransportRecord {
	recordsByKey := make(map[string]*testTransportRecord)

	for _, fv := range fieldValues {
		key := formatTransportationCompositeKey(fv.PersonID, fv.SessionID, fv.Year)

		if _, exists := recordsByKey[key]; !exists {
			recordsByKey[key] = &testTransportRecord{
				PersonID:  fv.PersonID,
				SessionID: fv.SessionID,
				Year:      fv.Year,
			}
		}

		rec := recordsByKey[key]
		column := MapTransportationFieldToColumn(fv.FieldName)
		switch column {
		case "to_camp_method":
			rec.ToCampMethod = fv.Value
		case "from_camp_method":
			rec.FromCampMethod = fv.Value
		case "dropoff_name":
			rec.DropoffName = fv.Value
		case "dropoff_phone":
			rec.DropoffPhone = fv.Value
		case "dropoff_relationship":
			rec.DropoffRelation = fv.Value
		case "pickup_name":
			rec.PickupName = fv.Value
		case "pickup_phone":
			rec.PickupPhone = fv.Value
		case "pickup_relationship":
			rec.PickupRelation = fv.Value
		case "alt_pickup_1_name":
			rec.AltPickup1Name = fv.Value
		case "alt_pickup_1_phone":
			rec.AltPickup1Phone = fv.Value
		case "alt_pickup_1_relationship":
			rec.AltPickup1Relation = fv.Value
		case "alt_pickup_2_name":
			rec.AltPickup2Name = fv.Value
		case "alt_pickup_2_phone":
			rec.AltPickup2Phone = fv.Value
		case "to_camp_method_legacy":
			if rec.ToCampMethod == "" {
				rec.ToCampMethod = fv.Value
				rec.UsedLegacyFields = true
			}
		case "from_camp_method_legacy":
			if rec.FromCampMethod == "" {
				rec.FromCampMethod = fv.Value
				rec.UsedLegacyFields = true
			}
		}
	}

	records := make([]*testTransportRecord, 0, len(recordsByKey))
	for _, r := range recordsByKey {
		records = append(records, r)
	}
	return records
}

// findTransportRecord finds a record by person and session ID
func findTransportRecord(records []*testTransportRecord, personID, sessionID int) *testTransportRecord {
	for _, r := range records {
		if r.PersonID == personID && r.SessionID == sessionID {
			return r
		}
	}
	return nil
}
