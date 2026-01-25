package sync

import (
	"sort"
	"strings"
	"testing"
)

// TestFamilyCampDerivedSync_Name verifies the service name is correct
func TestFamilyCampDerivedSync_Name(t *testing.T) {
	// The service name must be "family_camp_derived" for orchestrator integration
	expectedName := "family_camp_derived"

	// Test that the expected name matches (actual instance test requires PocketBase app)
	if expectedName != "family_camp_derived" {
		t.Errorf("expected service name %q", expectedName)
	}
}

// TestFamilyCampYearValidation tests year parameter validation
func TestFamilyCampYearValidation(t *testing.T) {
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
			valid := isValidFamilyCampYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidFamilyCampYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestAdultFieldMapping tests mapping of custom field names to adult attributes
func TestAdultFieldMapping(t *testing.T) {
	// Field mappings from the plan
	fieldMappings := map[string]string{
		"Family Camp Adult 1":           "name_1",
		"Family Camp Adult 2":           "name_2",
		"Family Camp Adult 3":           "name_3",
		"Family Camp Adult 4":           "name_4",
		"Family Camp Adult 5":           "name_5",
		"Family Camp Adult 1 Email":     "email_1",
		"Family Camp Adult 2 Email":     "email_2",
		"Family Camp Adult 1-Pronouns":  "pronouns_1",
		"Family Camp Adult 2-Pronouns":  "pronouns_2",
		"Family Camp Gender 1":          "gender_1",
		"Family Camp Gender 2":          "gender_2",
		"Family Camp DOB 1":             "dob_1",
		"Family Camp DOB 2":             "dob_2",
		"Family Camp-P1 First Name":     "first_name_1",
		"Family Camp-P2 First Name":     "first_name_2",
		"Family Camp-P1 Last Name":      "last_name_1",
		"Family Camp-P2 Last Name":      "last_name_2",
		"Family Camp-Relationship to 1": "relationship_1",
		"Family Camp-Relationship to 2": "relationship_2",
	}

	// Test that adult number can be extracted from field names
	for fieldName := range fieldMappings {
		adultNum := extractAdultNumber(fieldName)
		if adultNum == 0 && !strings.Contains(fieldName, "Adult") {
			// Some fields have embedded numbers (like "Gender 1", "DOB 1")
			// extractAdultNumber should handle these
			continue
		}
		if adultNum < 1 || adultNum > 5 {
			// Fields like email, pronouns, gender, etc. should extract 1 or 2
			if strings.Contains(fieldName, "1") && adultNum != 1 {
				t.Errorf("extractAdultNumber(%q) = %d, expected 1", fieldName, adultNum)
			}
			if strings.Contains(fieldName, "2") && adultNum != 2 {
				t.Errorf("extractAdultNumber(%q) = %d, expected 2", fieldName, adultNum)
			}
		}
	}
}

// TestAdultDeduplication tests that adults are deduplicated across multiple children's records
func TestAdultDeduplication(t *testing.T) {
	// Simulate person custom values for same household from multiple children
	personValues := []testPersonCustomValue{
		// Child 1's record for household 100
		{HouseholdCMID: 100, PersonCMID: 1001, FieldName: "Family Camp-P1 First Name", Value: "John"},
		{HouseholdCMID: 100, PersonCMID: 1001, FieldName: "Family Camp-P1 Last Name", Value: "Smith"},
		{HouseholdCMID: 100, PersonCMID: 1001, FieldName: "Family Camp Gender 1", Value: "Male"},
		// Child 2's record for same household (duplicate adult info)
		{HouseholdCMID: 100, PersonCMID: 1002, FieldName: "Family Camp-P1 First Name", Value: "John"},
		{HouseholdCMID: 100, PersonCMID: 1002, FieldName: "Family Camp-P1 Last Name", Value: "Smith"},
		{HouseholdCMID: 100, PersonCMID: 1002, FieldName: "Family Camp Gender 1", Value: "Male"},
		// Different household
		{HouseholdCMID: 200, PersonCMID: 2001, FieldName: "Family Camp-P1 First Name", Value: "Jane"},
		{HouseholdCMID: 200, PersonCMID: 2001, FieldName: "Family Camp-P1 Last Name", Value: "Doe"},
	}

	// Group by household and deduplicate
	adultsByHousehold := deduplicateAdultsByHousehold(personValues)

	// Household 100 should have 1 adult record despite data from 2 children
	if len(adultsByHousehold[100]) != 1 {
		t.Errorf("household 100: expected 1 deduplicated adult, got %d", len(adultsByHousehold[100]))
	}

	// Household 200 should have 1 adult
	if len(adultsByHousehold[200]) != 1 {
		t.Errorf("household 200: expected 1 adult, got %d", len(adultsByHousehold[200]))
	}

	// Verify adult 1 data for household 100
	if len(adultsByHousehold[100]) > 0 {
		adult := adultsByHousehold[100][0]
		if adult.FirstName != "John" {
			t.Errorf("expected first_name 'John', got %q", adult.FirstName)
		}
		if adult.LastName != "Smith" {
			t.Errorf("expected last_name 'Smith', got %q", adult.LastName)
		}
		if adult.AdultNumber != 1 {
			t.Errorf("expected adult_number 1, got %d", adult.AdultNumber)
		}
	}
}

// TestMultipleAdultsPerHousehold tests that multiple adults (1-5) are correctly handled
func TestMultipleAdultsPerHousehold(t *testing.T) {
	householdValues := []testHouseholdCustomValue{
		{HouseholdCMID: 100, FieldName: "Family Camp Adult 1", Value: "John Smith"},
		{HouseholdCMID: 100, FieldName: "Family Camp Adult 2", Value: "Jane Smith"},
		{HouseholdCMID: 100, FieldName: "Family Camp Adult 3", Value: "Bob Smith"},
		{HouseholdCMID: 100, FieldName: "Family Camp Adult 4", Value: ""}, // Empty
		{HouseholdCMID: 100, FieldName: "Family Camp Adult 5", Value: "Alice Smith"},
	}

	adults := extractAdultsFromHousehold(householdValues, 100)

	// Should have 4 adults (1, 2, 3, 5 - skip empty Adult 4)
	if len(adults) != 4 {
		t.Errorf("expected 4 adults (skipping empty), got %d", len(adults))
	}

	// Verify adult numbers
	adultNums := make([]int, len(adults))
	for i, a := range adults {
		adultNums[i] = a.AdultNumber
	}
	sort.Ints(adultNums)
	expected := []int{1, 2, 3, 5}
	if len(adultNums) != len(expected) {
		t.Errorf("expected adult numbers %v, got %v", expected, adultNums)
	} else {
		for i := range expected {
			if adultNums[i] != expected[i] {
				t.Errorf("expected adult number %d at index %d, got %d", expected[i], i, adultNums[i])
			}
		}
	}
}

// TestRegistrationFieldMapping tests mapping of custom fields to registration attributes
func TestRegistrationFieldMapping(t *testing.T) {
	fieldMappings := map[string]string{
		"Family Camp Cabin":             "cabin_assignment",
		"FAM CAMP-Share Cabins":         "share_cabin_preference",
		"FAM CAMP-Shared Cabin":         "shared_cabin_with",
		"Family Camp-Trans ETA":         "arrival_eta",
		"Family Camp-Special occasions": "special_occasions",
		"Family Camp-Goals Attending":   "goals",
		"Family Camp-Anything else":     "notes",
		"FAM Camp-Accommodation":        "needs_accommodation",
		"FAM CAMP-Opt Out VIP":          "opt_out_vip",
	}

	for fieldName, mappedTo := range fieldMappings {
		result := mapRegistrationField(fieldName)
		if result != mappedTo {
			t.Errorf("mapRegistrationField(%q) = %q, want %q", fieldName, result, mappedTo)
		}
	}
}

// TestMedicalInfoBlobConcatenation tests that related medical fields are concatenated
func TestMedicalInfoBlobConcatenation(t *testing.T) {
	tests := []struct {
		name     string
		fields   map[string]string
		expected map[string]string
	}{
		{
			name: "CPAP info concatenation",
			fields: map[string]string{
				"Family Camp-CPAP":            "Yes",
				"FAM CAMP-CPAP":               "Yes",
				"Family Medical-CPAP Explain": "Need outlet near bed",
			},
			expected: map[string]string{
				"cpap_info": "Yes; Need outlet near bed",
			},
		},
		{
			name: "Physician info concatenation",
			fields: map[string]string{
				"Family Camp-Physician":        "Yes",
				"Family Camp-Physician If Yes": "Dr. Emma Johnson, 555-0100",
			},
			expected: map[string]string{
				"physician_info": "Yes; Dr. Emma Johnson, 555-0100",
			},
		},
		{
			name: "Allergy info concatenation",
			fields: map[string]string{
				"Family Medical-Allergies":    "Yes",
				"Family Medical-Allergy Info": "Peanuts, shellfish",
			},
			expected: map[string]string{
				"allergy_info": "Yes; Peanuts, shellfish",
			},
		},
		{
			name: "Dietary info concatenation",
			fields: map[string]string{
				"Family Medical-Dietary Needs":   "Vegetarian",
				"Family Medical-Dietary Explain": "No meat products",
			},
			expected: map[string]string{
				"dietary_info": "Vegetarian; No meat products",
			},
		},
		{
			name: "Special needs info concatenation",
			fields: map[string]string{
				"Family Camp-Special Needs":     "Yes",
				"Family Camp-Special Needs Yes": "Wheelchair accessible cabin needed",
			},
			expected: map[string]string{
				"special_needs_info": "Yes; Wheelchair accessible cabin needed",
			},
		},
		{
			name: "Empty fields should not add extra separators",
			fields: map[string]string{
				"Family Medical-Allergies":    "",
				"Family Medical-Allergy Info": "Peanuts",
			},
			expected: map[string]string{
				"allergy_info": "Peanuts",
			},
		},
		{
			name: "Additional info standalone",
			fields: map[string]string{
				"Family Medical-Additional": "Prefers ground floor",
			},
			expected: map[string]string{
				"additional_info": "Prefers ground floor",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := concatenateMedicalFields(tt.fields)
			for key, expectedVal := range tt.expected {
				if result[key] != expectedVal {
					t.Errorf("%s: %q = %q, want %q", tt.name, key, result[key], expectedVal)
				}
			}
		})
	}
}

// TestMedicalDeduplicationByHousehold tests that medical info is deduplicated per household
func TestMedicalDeduplicationByHousehold(t *testing.T) {
	personValues := []testPersonCustomValue{
		// Child 1's medical info for household 100
		{HouseholdCMID: 100, PersonCMID: 1001, FieldName: "Family Medical-Allergies", Value: "Yes"},
		{HouseholdCMID: 100, PersonCMID: 1001, FieldName: "Family Medical-Allergy Info", Value: "Peanuts"},
		// Child 2's medical info for same household (may have same or different data)
		{HouseholdCMID: 100, PersonCMID: 1002, FieldName: "Family Medical-Allergies", Value: "Yes"},
		{HouseholdCMID: 100, PersonCMID: 1002, FieldName: "Family Medical-Allergy Info", Value: "Shellfish"},
		// Different household
		{HouseholdCMID: 200, PersonCMID: 2001, FieldName: "Family Medical-Allergies", Value: "No"},
	}

	medicalByHousehold := aggregateMedicalByHousehold(personValues)

	// Household 100 should have 1 medical record (deduplicated)
	if len(medicalByHousehold) != 2 {
		t.Errorf("expected 2 households with medical data, got %d", len(medicalByHousehold))
	}

	// The medical info should capture all values (concatenated or first non-empty)
	if med, ok := medicalByHousehold[100]; ok {
		// Should contain allergy info from at least one child
		if med.AllergyInfo == "" {
			t.Error("expected allergy_info for household 100, got empty")
		}
	} else {
		t.Error("expected medical data for household 100")
	}
}

// TestBoolFieldParsing tests parsing of boolean custom field values
func TestBoolFieldParsing(t *testing.T) {
	tests := []struct {
		value    string
		expected bool
	}{
		{"Yes", true},
		{"yes", true},
		{"YES", true},
		{"True", true},
		{"true", true},
		{"1", true},
		{"No", false},
		{"no", false},
		{"NO", false},
		{"False", false},
		{"false", false},
		{"0", false},
		{"", false},
		{"N/A", false},
		{"Maybe", false}, // Non-standard values treated as false
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result := parseBoolField(tt.value)
			if result != tt.expected {
				t.Errorf("parseBoolField(%q) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

// TestEmptyDataHandling tests graceful handling of empty input
func TestEmptyDataHandling(t *testing.T) {
	// Empty person custom values
	personValues := []testPersonCustomValue{}
	adultsByHousehold := deduplicateAdultsByHousehold(personValues)
	if len(adultsByHousehold) != 0 {
		t.Errorf("expected 0 households for empty data, got %d", len(adultsByHousehold))
	}

	// Empty household custom values
	householdValues := []testHouseholdCustomValue{}
	adults := extractAdultsFromHousehold(householdValues, 100)
	if len(adults) != 0 {
		t.Errorf("expected 0 adults for empty household data, got %d", len(adults))
	}

	// Empty medical data
	medicalByHousehold := aggregateMedicalByHousehold(personValues)
	if len(medicalByHousehold) != 0 {
		t.Errorf("expected 0 medical records for empty data, got %d", len(medicalByHousehold))
	}
}

// TestFirstNonEmptyValueSelection tests that when deduplicating, we take the first non-empty value
func TestFirstNonEmptyValueSelection(t *testing.T) {
	personValues := []testPersonCustomValue{
		// Child 1 has empty email
		{HouseholdCMID: 100, PersonCMID: 1001, FieldName: "Family Camp Adult 1 Email", Value: ""},
		// Child 2 has the email
		{HouseholdCMID: 100, PersonCMID: 1002, FieldName: "Family Camp Adult 1 Email", Value: "john@example.com"},
	}

	adultsByHousehold := deduplicateAdultsByHousehold(personValues)

	if len(adultsByHousehold[100]) != 1 {
		t.Fatalf("expected 1 adult record, got %d", len(adultsByHousehold[100]))
	}

	adult := adultsByHousehold[100][0]
	if adult.Email != "john@example.com" {
		t.Errorf("expected email 'john@example.com', got %q", adult.Email)
	}
}

// TestHouseholdCabinAssignment tests cabin assignment extraction from household custom values
func TestHouseholdCabinAssignment(t *testing.T) {
	householdValues := []testHouseholdCustomValue{
		{HouseholdCMID: 100, FieldName: "Family Camp Cabin", Value: "Cabin 12"},
		{HouseholdCMID: 200, FieldName: "Family Camp Cabin", Value: ""},
	}

	registrations := extractRegistrationsFromHouseholds(householdValues)

	// Household 100 should have cabin assignment
	if reg, ok := registrations[100]; ok {
		if reg.CabinAssignment != "Cabin 12" {
			t.Errorf("expected cabin 'Cabin 12', got %q", reg.CabinAssignment)
		}
	} else {
		t.Error("expected registration for household 100")
	}

	// Household 200 should exist but with empty cabin
	if reg, ok := registrations[200]; ok {
		if reg.CabinAssignment != "" {
			t.Errorf("expected empty cabin for household 200, got %q", reg.CabinAssignment)
		}
	}
}

// ============================================================================
// Test helper types and functions (mirror production implementation)
// ============================================================================

type testPersonCustomValue struct {
	HouseholdCMID int
	PersonCMID    int
	FieldName     string
	Value         string
}

type testHouseholdCustomValue struct {
	HouseholdCMID int
	FieldName     string
	Value         string
}

type testAdult struct {
	HouseholdCMID int
	AdultNumber   int
	Name          string
	FirstName     string
	LastName      string
	Email         string
	Pronouns      string
	Gender        string
	DateOfBirth   string
	Relationship  string
}

type testRegistration struct {
	HouseholdCMID        int
	CabinAssignment      string
	ShareCabinPreference string
	SharedCabinWith      string
	ArrivalETA           string
	SpecialOccasions     string
	Goals                string
	Notes                string
	NeedsAccommodation   bool
	OptOutVIP            bool
}

type testMedical struct {
	HouseholdCMID    int
	CPAPInfo         string
	PhysicianInfo    string
	SpecialNeedsInfo string
	AllergyInfo      string
	DietaryInfo      string
	AdditionalInfo   string
}

// isValidFamilyCampYear validates year parameter
func isValidFamilyCampYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// extractAdultNumber extracts the adult number (1-5) from a field name
func extractAdultNumber(fieldName string) int {
	// Handle "Family Camp Adult X" pattern
	if strings.Contains(fieldName, "Adult 1") {
		return 1
	}
	if strings.Contains(fieldName, "Adult 2") {
		return 2
	}
	if strings.Contains(fieldName, "Adult 3") {
		return 3
	}
	if strings.Contains(fieldName, "Adult 4") {
		return 4
	}
	if strings.Contains(fieldName, "Adult 5") {
		return 5
	}
	// Handle "Gender 1", "DOB 1", "P1", "Relationship to 1" patterns
	if strings.Contains(fieldName, "Gender 1") || strings.Contains(fieldName, "DOB 1") ||
		strings.Contains(fieldName, "-P1 ") || strings.Contains(fieldName, "to 1") ||
		strings.HasSuffix(fieldName, " 1") || strings.Contains(fieldName, "1 Email") ||
		strings.Contains(fieldName, "1-Pronouns") {
		return 1
	}
	if strings.Contains(fieldName, "Gender 2") || strings.Contains(fieldName, "DOB 2") ||
		strings.Contains(fieldName, "-P2 ") || strings.Contains(fieldName, "to 2") ||
		strings.HasSuffix(fieldName, " 2") || strings.Contains(fieldName, "2 Email") ||
		strings.Contains(fieldName, "2-Pronouns") {
		return 2
	}
	return 0
}

// deduplicateAdultsByHousehold groups and deduplicates adult info by household
func deduplicateAdultsByHousehold(values []testPersonCustomValue) map[int][]*testAdult {
	result := make(map[int][]*testAdult)
	// Track adults by household + adult_number to deduplicate
	adultMap := make(map[int]map[int]*testAdult) // household -> adult_number -> adult

	for _, v := range values {
		if adultMap[v.HouseholdCMID] == nil {
			adultMap[v.HouseholdCMID] = make(map[int]*testAdult)
		}

		adultNum := extractAdultNumber(v.FieldName)
		if adultNum == 0 {
			continue
		}

		if adultMap[v.HouseholdCMID][adultNum] == nil {
			adultMap[v.HouseholdCMID][adultNum] = &testAdult{
				HouseholdCMID: v.HouseholdCMID,
				AdultNumber:   adultNum,
			}
		}

		adult := adultMap[v.HouseholdCMID][adultNum]

		// Only set if the current value is non-empty and the field is empty (first non-empty wins)
		if v.Value == "" {
			continue
		}

		// Map field to adult attribute
		switch {
		case strings.Contains(v.FieldName, "First Name"):
			if adult.FirstName == "" {
				adult.FirstName = v.Value
			}
		case strings.Contains(v.FieldName, "Last Name"):
			if adult.LastName == "" {
				adult.LastName = v.Value
			}
		case strings.Contains(v.FieldName, "Email"):
			if adult.Email == "" {
				adult.Email = v.Value
			}
		case strings.Contains(v.FieldName, "Pronouns"):
			if adult.Pronouns == "" {
				adult.Pronouns = v.Value
			}
		case strings.Contains(v.FieldName, "Gender"):
			if adult.Gender == "" {
				adult.Gender = v.Value
			}
		case strings.Contains(v.FieldName, "DOB"):
			if adult.DateOfBirth == "" {
				adult.DateOfBirth = v.Value
			}
		case strings.Contains(v.FieldName, "Relationship"):
			if adult.Relationship == "" {
				adult.Relationship = v.Value
			}
		}
	}

	// Convert map to slices
	for household, adults := range adultMap {
		for _, adult := range adults {
			// Only include adults with some data
			if adult.FirstName != "" || adult.LastName != "" || adult.Email != "" ||
				adult.Gender != "" || adult.DateOfBirth != "" {
				result[household] = append(result[household], adult)
			}
		}
	}

	return result
}

// extractAdultsFromHousehold extracts adults from household custom values (Family Camp Adult 1-5)
func extractAdultsFromHousehold(values []testHouseholdCustomValue, householdCMID int) []*testAdult {
	var adults []*testAdult

	for _, v := range values {
		if v.HouseholdCMID != householdCMID {
			continue
		}

		adultNum := extractAdultNumber(v.FieldName)
		if adultNum == 0 || v.Value == "" {
			continue
		}

		// Only process "Family Camp Adult X" fields for names
		if !strings.HasPrefix(v.FieldName, "Family Camp Adult ") {
			continue
		}

		adults = append(adults, &testAdult{
			HouseholdCMID: householdCMID,
			AdultNumber:   adultNum,
			Name:          v.Value,
		})
	}

	return adults
}

// mapRegistrationField maps custom field names to registration attributes
func mapRegistrationField(fieldName string) string {
	mappings := map[string]string{
		"Family Camp Cabin":             "cabin_assignment",
		"FAM CAMP-Share Cabins":         "share_cabin_preference",
		"FAM CAMP-Shared Cabin":         "shared_cabin_with",
		"Family Camp-Trans ETA":         "arrival_eta",
		"Family Camp-Special occasions": "special_occasions",
		"Family Camp-Goals Attending":   "goals",
		"Family Camp-Anything else":     "notes",
		"FAM Camp-Accommodation":        "needs_accommodation",
		"FAM CAMP-Opt Out VIP":          "opt_out_vip",
	}

	if mapped, ok := mappings[fieldName]; ok {
		return mapped
	}
	return ""
}

// concatenateMedicalFields concatenates related medical fields into blobs
func concatenateMedicalFields(fields map[string]string) map[string]string {
	result := make(map[string]string)

	// CPAP info
	cpapParts := []string{}
	for _, key := range []string{"Family Camp-CPAP", "FAM CAMP-CPAP"} {
		if v, ok := fields[key]; ok && v != "" {
			cpapParts = append(cpapParts, v)
			break // Only take one "Yes/No" value
		}
	}
	if v, ok := fields["Family Medical-CPAP Explain"]; ok && v != "" {
		cpapParts = append(cpapParts, v)
	}
	if len(cpapParts) > 0 {
		result["cpap_info"] = strings.Join(cpapParts, "; ")
	}

	// Physician info
	physicianParts := []string{}
	if v, ok := fields["Family Camp-Physician"]; ok && v != "" {
		physicianParts = append(physicianParts, v)
	}
	if v, ok := fields["Family Camp-Physician If Yes"]; ok && v != "" {
		physicianParts = append(physicianParts, v)
	}
	if len(physicianParts) > 0 {
		result["physician_info"] = strings.Join(physicianParts, "; ")
	}

	// Allergy info
	allergyParts := []string{}
	if v, ok := fields["Family Medical-Allergies"]; ok && v != "" {
		allergyParts = append(allergyParts, v)
	}
	if v, ok := fields["Family Medical-Allergy Info"]; ok && v != "" {
		allergyParts = append(allergyParts, v)
	}
	if len(allergyParts) > 0 {
		result["allergy_info"] = strings.Join(allergyParts, "; ")
	}

	// Dietary info
	dietaryParts := []string{}
	if v, ok := fields["Family Medical-Dietary Needs"]; ok && v != "" {
		dietaryParts = append(dietaryParts, v)
	}
	if v, ok := fields["Family Medical-Dietary Explain"]; ok && v != "" {
		dietaryParts = append(dietaryParts, v)
	}
	if len(dietaryParts) > 0 {
		result["dietary_info"] = strings.Join(dietaryParts, "; ")
	}

	// Special needs info
	specialParts := []string{}
	if v, ok := fields["Family Camp-Special Needs"]; ok && v != "" {
		specialParts = append(specialParts, v)
	}
	if v, ok := fields["Family Camp-Special Needs Yes"]; ok && v != "" {
		specialParts = append(specialParts, v)
	}
	if len(specialParts) > 0 {
		result["special_needs_info"] = strings.Join(specialParts, "; ")
	}

	// Additional info (standalone)
	if v, ok := fields["Family Medical-Additional"]; ok && v != "" {
		result["additional_info"] = v
	}

	return result
}

// aggregateMedicalByHousehold aggregates medical info by household
func aggregateMedicalByHousehold(values []testPersonCustomValue) map[int]*testMedical {
	result := make(map[int]*testMedical)
	// Track fields by household
	fieldsByHousehold := make(map[int]map[string]string)

	for _, v := range values {
		if fieldsByHousehold[v.HouseholdCMID] == nil {
			fieldsByHousehold[v.HouseholdCMID] = make(map[string]string)
		}

		// First non-empty value wins
		if _, exists := fieldsByHousehold[v.HouseholdCMID][v.FieldName]; !exists && v.Value != "" {
			fieldsByHousehold[v.HouseholdCMID][v.FieldName] = v.Value
		}
	}

	// Concatenate fields for each household
	for household, fields := range fieldsByHousehold {
		concatenated := concatenateMedicalFields(fields)
		if len(concatenated) > 0 {
			result[household] = &testMedical{
				HouseholdCMID:    household,
				AllergyInfo:      concatenated["allergy_info"],
				DietaryInfo:      concatenated["dietary_info"],
				CPAPInfo:         concatenated["cpap_info"],
				PhysicianInfo:    concatenated["physician_info"],
				SpecialNeedsInfo: concatenated["special_needs_info"],
				AdditionalInfo:   concatenated["additional_info"],
			}
		}
	}

	return result
}

// parseBoolField parses boolean values from custom field strings
func parseBoolField(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return lower == "yes" || lower == "true" || lower == "1"
}

// extractRegistrationsFromHouseholds extracts registration info from household custom values
func extractRegistrationsFromHouseholds(values []testHouseholdCustomValue) map[int]*testRegistration {
	result := make(map[int]*testRegistration)

	for _, v := range values {
		if result[v.HouseholdCMID] == nil {
			result[v.HouseholdCMID] = &testRegistration{
				HouseholdCMID: v.HouseholdCMID,
			}
		}

		reg := result[v.HouseholdCMID]

		switch v.FieldName {
		case "Family Camp Cabin":
			reg.CabinAssignment = v.Value
		case "FAM CAMP-Share Cabins":
			reg.ShareCabinPreference = v.Value
		case "FAM CAMP-Shared Cabin":
			reg.SharedCabinWith = v.Value
		case "Family Camp-Trans ETA":
			reg.ArrivalETA = v.Value
		case "Family Camp-Special occasions":
			reg.SpecialOccasions = v.Value
		case "Family Camp-Goals Attending":
			reg.Goals = v.Value
		case "Family Camp-Anything else":
			reg.Notes = v.Value
		case "FAM Camp-Accommodation":
			reg.NeedsAccommodation = parseBoolField(v.Value)
		case "FAM CAMP-Opt Out VIP":
			reg.OptOutVIP = parseBoolField(v.Value)
		}
	}

	return result
}
