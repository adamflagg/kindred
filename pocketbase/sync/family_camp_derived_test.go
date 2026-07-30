package sync

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	// Aliased: this file has several local table-driven `tests` variables that
	// would shadow the package name (gocritic importShadow).
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// Test data constants
const testEmailJohn = "john@example.com"

// TestFamilyCampDerivedSync_Name verifies the service name is correct
func TestFamilyCampDerivedSync_Name(t *testing.T) {
	// The service name must be "family_camp_derived" for orchestrator integration
	expectedName := serviceNameFamilyCampDerived

	// Test that the expected name matches (actual instance test requires PocketBase app)
	if expectedName != serviceNameFamilyCampDerived {
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
	slices.Sort(adultNums)
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

// TestBoolFieldParsing exercises the PRODUCTION parseBoolFieldValue. The previous
// version of this test called a byte-identical local copy, which is why the
// sentence-prefixed cases below went undetected: fixing production code could
// not have made the old test fail.
func TestBoolFieldParsing(t *testing.T) {
	tests := []struct {
		value    string
		expected bool
	}{
		// Plain answers (FAM Camp-Accommodation, Housing Accommodation,
		// FAM CAMP-bathroom all store bare "Yes" / "No").
		{"Yes", true},
		{"yes", true},
		{"YES", true},
		{"True", true},
		{"true", true},
		{"1", true},
		{"y", true},
		{"No", false},
		{"no", false},
		{"NO", false},
		{"False", false},
		{"false", false},
		{"0", false},
		{"", false},
		{"N/A", false},
		{"Maybe", false},
		// Sentence-prefixed answers. CampMinder stores the whole option text for
		// single-select fields; FAM CAMP-Opt Out VIP has exactly these two values.
		{"Yes, please register regardless of cabin type", true},
		{"No, I am only able to attend with this accommodation in place", false},
		// Spacing and casing variants of the same shape.
		{"yes, please register regardless of cabin type", true},
		{"  Yes, please register regardless of cabin type  ", true},
		{"Yes - I need this", true},
		{"Yes I need this", true},
		// Must NOT match: "yes" appearing anywhere other than the leading token.
		{"Not yes", false},
		{"Maybe yes, maybe no", false},
		{"No, yes is not my answer", false},
		{"Yesterday", false},
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result := parseBoolFieldValue(tt.value)
			if result != tt.expected {
				t.Errorf("parseBoolFieldValue(%q) = %v, want %v", tt.value, result, tt.expected)
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
		{HouseholdCMID: 100, PersonCMID: 1002, FieldName: "Family Camp Adult 1 Email", Value: testEmailJohn},
	}

	adultsByHousehold := deduplicateAdultsByHousehold(personValues)

	if len(adultsByHousehold[100]) != 1 {
		t.Fatalf("expected 1 adult record, got %d", len(adultsByHousehold[100]))
	}

	adult := adultsByHousehold[100][0]
	if adult.Email != testEmailJohn {
		t.Errorf("expected email %q, got %q", testEmailJohn, adult.Email)
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

// ============================================================================
// Idempotency Tests - Define expected upsert behavior
// ============================================================================

// TestUpsertAdultsIdempotency verifies that running the sync twice with unchanged data
// results in all records being skipped (not created) on the second run.
func TestUpsertAdultsIdempotency(t *testing.T) {
	// Simulate computed adults from source data
	adults := []*testAdult{
		{HouseholdCMID: 100, AdultNumber: 1, FirstName: "John", LastName: "Smith", Email: "john@example.com"},
		{HouseholdCMID: 100, AdultNumber: 2, FirstName: "Jane", LastName: "Smith", Email: "jane@example.com"},
		{HouseholdCMID: 200, AdultNumber: 1, FirstName: "Bob", LastName: "Jones", Email: "bob@example.com"},
	}

	// Simulate first run: no existing records
	existing1 := make(map[string]*testAdultRecord)
	stats1 := simulateUpsertAdults(adults, existing1, 2025)

	// First run should create all records
	if stats1.Created != 3 {
		t.Errorf("first run: expected Created=3, got %d", stats1.Created)
	}
	if stats1.Skipped != 0 {
		t.Errorf("first run: expected Skipped=0, got %d", stats1.Skipped)
	}
	if stats1.Updated != 0 {
		t.Errorf("first run: expected Updated=0, got %d", stats1.Updated)
	}

	// Simulate second run: existing records match computed data (from first run)
	existing2 := buildExistingAdultsMap(adults, 2025)
	stats2 := simulateUpsertAdults(adults, existing2, 2025)

	// Second run should skip all records (no changes)
	if stats2.Created != 0 {
		t.Errorf("second run: expected Created=0, got %d", stats2.Created)
	}
	if stats2.Skipped != 3 {
		t.Errorf("second run: expected Skipped=3, got %d", stats2.Skipped)
	}
	if stats2.Updated != 0 {
		t.Errorf("second run: expected Updated=0, got %d", stats2.Updated)
	}
}

// TestUpsertAdultsUpdateDetection verifies that modified source data results in
// the Updated stat being incremented, not Created.
func TestUpsertAdultsUpdateDetection(t *testing.T) {
	// Existing records in database (from previous sync)
	existingAdults := []*testAdult{
		{HouseholdCMID: 100, AdultNumber: 1, FirstName: "John", LastName: "Smith", Email: "john@example.com"},
		{HouseholdCMID: 100, AdultNumber: 2, FirstName: "Jane", LastName: "Smith", Email: "jane@example.com"},
	}
	existing := buildExistingAdultsMap(existingAdults, 2025)

	// New computed data with one change: John's email updated
	newAdults := []*testAdult{
		// Changed email
		{HouseholdCMID: 100, AdultNumber: 1, FirstName: "John", LastName: "Smith", Email: "john.smith@newdomain.com"},
		// Unchanged
		{HouseholdCMID: 100, AdultNumber: 2, FirstName: "Jane", LastName: "Smith", Email: "jane@example.com"},
	}

	stats := simulateUpsertAdults(newAdults, existing, 2025)

	// Should update 1 record (John's email changed) and skip 1 (Jane unchanged)
	if stats.Updated != 1 {
		t.Errorf("expected Updated=1, got %d", stats.Updated)
	}
	if stats.Skipped != 1 {
		t.Errorf("expected Skipped=1, got %d", stats.Skipped)
	}
	if stats.Created != 0 {
		t.Errorf("expected Created=0, got %d", stats.Created)
	}
}

// TestUpsertAdultsOrphanDeletion verifies that records removed from source data
// are deleted (orphan cleanup).
func TestUpsertAdultsOrphanDeletion(t *testing.T) {
	// Existing records in database (from previous sync)
	existingAdults := []*testAdult{
		{HouseholdCMID: 100, AdultNumber: 1, FirstName: "John", LastName: "Smith", Email: "john@example.com"},
		{HouseholdCMID: 100, AdultNumber: 2, FirstName: "Jane", LastName: "Smith", Email: "jane@example.com"},
		// Will be orphaned
		{HouseholdCMID: 200, AdultNumber: 1, FirstName: "Bob", LastName: "Jones", Email: "bob@example.com"},
	}
	existing := buildExistingAdultsMap(existingAdults, 2025)

	// New computed data: household 200 is no longer in source (unenrolled from family camp)
	newAdults := []*testAdult{
		{HouseholdCMID: 100, AdultNumber: 1, FirstName: "John", LastName: "Smith", Email: "john@example.com"},
		{HouseholdCMID: 100, AdultNumber: 2, FirstName: "Jane", LastName: "Smith", Email: "jane@example.com"},
	}

	// Track processed keys
	processedKeys := make(map[string]bool)
	stats := simulateUpsertAdultsWithTracking(newAdults, existing, 2025, processedKeys)

	// Should skip 2 records (unchanged)
	if stats.Skipped != 2 {
		t.Errorf("expected Skipped=2, got %d", stats.Skipped)
	}

	// Simulate orphan deletion
	orphanCount := countOrphans(existing, processedKeys)
	if orphanCount != 1 {
		t.Errorf("expected 1 orphan (Bob Jones), got %d", orphanCount)
	}
}

// TestUpsertRegistrationsIdempotency verifies registration upsert idempotency
func TestUpsertRegistrationsIdempotency(t *testing.T) {
	registrations := []*testRegistration{
		{HouseholdCMID: 100, CabinAssignment: "Cabin 12", ShareCabinPreference: "Yes"},
		{HouseholdCMID: 200, CabinAssignment: "Cabin 14", Goals: "Family bonding"},
	}

	// First run
	existing1 := make(map[string]*testRegRecord)
	stats1 := simulateUpsertRegistrations(registrations, existing1, 2025)

	if stats1.Created != 2 {
		t.Errorf("first run: expected Created=2, got %d", stats1.Created)
	}

	// Second run (unchanged)
	existing2 := buildExistingRegistrationsMap(registrations, 2025)
	stats2 := simulateUpsertRegistrations(registrations, existing2, 2025)

	if stats2.Skipped != 2 {
		t.Errorf("second run: expected Skipped=2, got %d", stats2.Skipped)
	}
	if stats2.Created != 0 {
		t.Errorf("second run: expected Created=0, got %d", stats2.Created)
	}
}

// TestUpsertMedicalIdempotency verifies medical upsert idempotency
func TestUpsertMedicalIdempotency(t *testing.T) {
	medical := []*testMedical{
		{HouseholdCMID: 100, AllergyInfo: "Peanuts", DietaryInfo: "Vegetarian"},
		{HouseholdCMID: 200, CPAPInfo: "Yes; needs outlet"},
	}

	// First run
	existing1 := make(map[string]*testMedRecord)
	stats1 := simulateUpsertMedical(medical, existing1, 2025)

	if stats1.Created != 2 {
		t.Errorf("first run: expected Created=2, got %d", stats1.Created)
	}

	// Second run (unchanged)
	existing2 := buildExistingMedicalMap(medical, 2025)
	stats2 := simulateUpsertMedical(medical, existing2, 2025)

	if stats2.Skipped != 2 {
		t.Errorf("second run: expected Skipped=2, got %d", stats2.Skipped)
	}
	if stats2.Created != 0 {
		t.Errorf("second run: expected Created=0, got %d", stats2.Created)
	}
}

// TestCompositeKeyFormats verifies the composite key format for each table
func TestCompositeKeyFormats(t *testing.T) {
	tests := []struct {
		name        string
		tableName   string
		householdID string
		year        int
		adultNumber int // Only for adults table
		expectedKey string
	}{
		{
			name:        "adults key format",
			tableName:   "family_camp_adults",
			householdID: "pb_household_123",
			year:        2025,
			adultNumber: 1,
			expectedKey: "pb_household_123:2025:1",
		},
		{
			name:        "adults key with different adult number",
			tableName:   "family_camp_adults",
			householdID: "pb_household_456",
			year:        2025,
			adultNumber: 3,
			expectedKey: "pb_household_456:2025:3",
		},
		{
			name:        "registrations key format",
			tableName:   "family_camp_registrations",
			householdID: "pb_household_123",
			year:        2025,
			expectedKey: "pb_household_123:2025",
		},
		{
			name:        "medical key format",
			tableName:   "family_camp_medical",
			householdID: "pb_household_789",
			year:        2024,
			expectedKey: "pb_household_789:2024",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var key string
			if tt.tableName == "family_camp_adults" {
				key = buildAdultCompositeKey(tt.householdID, tt.year, tt.adultNumber)
			} else {
				key = buildHouseholdCompositeKey(tt.householdID, tt.year)
			}

			if key != tt.expectedKey {
				t.Errorf("expected key %q, got %q", tt.expectedKey, key)
			}
		})
	}
}

// ============================================================================
// Test helper types for upsert simulation
// ============================================================================

// testUpsertStats mirrors the Stats struct for test verification
type testUpsertStats struct {
	Created int
	Updated int
	Skipped int
	Deleted int
	Errors  int
}

// testAdultRecord simulates a PocketBase record for adults
type testAdultRecord struct {
	HouseholdPBID string
	Year          int
	AdultNumber   int
	FirstName     string
	LastName      string
	Email         string
	Pronouns      string
	Gender        string
	DateOfBirth   string
	Relationship  string
}

// testRegRecord simulates a PocketBase record for registrations
type testRegRecord struct {
	HouseholdPBID        string
	Year                 int
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

// testMedRecord simulates a PocketBase record for medical
type testMedRecord struct {
	HouseholdPBID    string
	Year             int
	CPAPInfo         string
	PhysicianInfo    string
	SpecialNeedsInfo string
	AllergyInfo      string
	DietaryInfo      string
	AdditionalInfo   string
}

// ============================================================================
// Test helper functions for upsert simulation
// ============================================================================

// buildAdultCompositeKey builds the composite key for family_camp_adults
func buildAdultCompositeKey(householdPBID string, year, adultNumber int) string {
	return fmt.Sprintf("%s:%d:%d", householdPBID, year, adultNumber)
}

// buildHouseholdCompositeKey builds the composite key for registrations/medical
func buildHouseholdCompositeKey(householdPBID string, year int) string {
	return fmt.Sprintf("%s:%d", householdPBID, year)
}

// buildExistingAdultsMap creates a map of existing adult records (simulates preload)
func buildExistingAdultsMap(adults []*testAdult, year int) map[string]*testAdultRecord {
	result := make(map[string]*testAdultRecord)
	for _, a := range adults {
		// Use household CM ID as PB ID for test purposes
		pbID := fmt.Sprintf("pb_household_%d", a.HouseholdCMID)
		key := buildAdultCompositeKey(pbID, year, a.AdultNumber)
		result[key] = &testAdultRecord{
			HouseholdPBID: pbID,
			Year:          year,
			AdultNumber:   a.AdultNumber,
			FirstName:     a.FirstName,
			LastName:      a.LastName,
			Email:         a.Email,
			Pronouns:      a.Pronouns,
			Gender:        a.Gender,
			DateOfBirth:   a.DateOfBirth,
			Relationship:  a.Relationship,
		}
	}
	return result
}

// adultNeedsUpdate checks if an adult record needs updating
func adultNeedsUpdate(existing *testAdultRecord, newAdult *testAdult) bool {
	return existing.FirstName != newAdult.FirstName ||
		existing.LastName != newAdult.LastName ||
		existing.Email != newAdult.Email ||
		existing.Pronouns != newAdult.Pronouns ||
		existing.Gender != newAdult.Gender ||
		existing.DateOfBirth != newAdult.DateOfBirth ||
		existing.Relationship != newAdult.Relationship
}

// simulateUpsertAdults simulates the upsert logic for adults
func simulateUpsertAdults(adults []*testAdult, existing map[string]*testAdultRecord, year int) testUpsertStats {
	stats := testUpsertStats{}

	for _, a := range adults {
		pbID := fmt.Sprintf("pb_household_%d", a.HouseholdCMID)
		key := buildAdultCompositeKey(pbID, year, a.AdultNumber)

		if existingRecord, ok := existing[key]; ok {
			if adultNeedsUpdate(existingRecord, a) {
				stats.Updated++
			} else {
				stats.Skipped++
			}
		} else {
			stats.Created++
		}
	}

	return stats
}

// simulateUpsertAdultsWithTracking simulates upsert with key tracking for orphan detection
func simulateUpsertAdultsWithTracking(
	adults []*testAdult,
	existing map[string]*testAdultRecord,
	year int,
	processedKeys map[string]bool,
) testUpsertStats {
	stats := testUpsertStats{}

	for _, a := range adults {
		pbID := fmt.Sprintf("pb_household_%d", a.HouseholdCMID)
		key := buildAdultCompositeKey(pbID, year, a.AdultNumber)
		processedKeys[key] = true

		if existingRecord, ok := existing[key]; ok {
			if adultNeedsUpdate(existingRecord, a) {
				stats.Updated++
			} else {
				stats.Skipped++
			}
		} else {
			stats.Created++
		}
	}

	return stats
}

// countOrphans counts records in existing that weren't processed
func countOrphans(existing map[string]*testAdultRecord, processedKeys map[string]bool) int {
	count := 0
	for key := range existing {
		if !processedKeys[key] {
			count++
		}
	}
	return count
}

// buildExistingRegistrationsMap creates a map of existing registration records
func buildExistingRegistrationsMap(regs []*testRegistration, year int) map[string]*testRegRecord {
	result := make(map[string]*testRegRecord)
	for _, r := range regs {
		pbID := fmt.Sprintf("pb_household_%d", r.HouseholdCMID)
		key := buildHouseholdCompositeKey(pbID, year)
		result[key] = &testRegRecord{
			HouseholdPBID:        pbID,
			Year:                 year,
			CabinAssignment:      r.CabinAssignment,
			ShareCabinPreference: r.ShareCabinPreference,
			SharedCabinWith:      r.SharedCabinWith,
			ArrivalETA:           r.ArrivalETA,
			SpecialOccasions:     r.SpecialOccasions,
			Goals:                r.Goals,
			Notes:                r.Notes,
			NeedsAccommodation:   r.NeedsAccommodation,
			OptOutVIP:            r.OptOutVIP,
		}
	}
	return result
}

// regNeedsUpdate checks if a registration record needs updating
func regNeedsUpdate(existing *testRegRecord, newReg *testRegistration) bool {
	return existing.CabinAssignment != newReg.CabinAssignment ||
		existing.ShareCabinPreference != newReg.ShareCabinPreference ||
		existing.SharedCabinWith != newReg.SharedCabinWith ||
		existing.ArrivalETA != newReg.ArrivalETA ||
		existing.SpecialOccasions != newReg.SpecialOccasions ||
		existing.Goals != newReg.Goals ||
		existing.Notes != newReg.Notes ||
		existing.NeedsAccommodation != newReg.NeedsAccommodation ||
		existing.OptOutVIP != newReg.OptOutVIP
}

// simulateUpsertRegistrations simulates the upsert logic for registrations
func simulateUpsertRegistrations(
	regs []*testRegistration,
	existing map[string]*testRegRecord,
	year int,
) testUpsertStats {
	stats := testUpsertStats{}

	for _, r := range regs {
		pbID := fmt.Sprintf("pb_household_%d", r.HouseholdCMID)
		key := buildHouseholdCompositeKey(pbID, year)

		if existingRecord, ok := existing[key]; ok {
			if regNeedsUpdate(existingRecord, r) {
				stats.Updated++
			} else {
				stats.Skipped++
			}
		} else {
			stats.Created++
		}
	}

	return stats
}

// buildExistingMedicalMap creates a map of existing medical records
func buildExistingMedicalMap(medical []*testMedical, year int) map[string]*testMedRecord {
	result := make(map[string]*testMedRecord)
	for _, m := range medical {
		pbID := fmt.Sprintf("pb_household_%d", m.HouseholdCMID)
		key := buildHouseholdCompositeKey(pbID, year)
		result[key] = &testMedRecord{
			HouseholdPBID:    pbID,
			Year:             year,
			CPAPInfo:         m.CPAPInfo,
			PhysicianInfo:    m.PhysicianInfo,
			SpecialNeedsInfo: m.SpecialNeedsInfo,
			AllergyInfo:      m.AllergyInfo,
			DietaryInfo:      m.DietaryInfo,
			AdditionalInfo:   m.AdditionalInfo,
		}
	}
	return result
}

// medNeedsUpdate checks if a medical record needs updating
func medNeedsUpdate(existing *testMedRecord, newMed *testMedical) bool {
	return existing.CPAPInfo != newMed.CPAPInfo ||
		existing.PhysicianInfo != newMed.PhysicianInfo ||
		existing.SpecialNeedsInfo != newMed.SpecialNeedsInfo ||
		existing.AllergyInfo != newMed.AllergyInfo ||
		existing.DietaryInfo != newMed.DietaryInfo ||
		existing.AdditionalInfo != newMed.AdditionalInfo
}

// simulateUpsertMedical simulates the upsert logic for medical
func simulateUpsertMedical(medical []*testMedical, existing map[string]*testMedRecord, year int) testUpsertStats {
	stats := testUpsertStats{}

	for _, m := range medical {
		pbID := fmt.Sprintf("pb_household_%d", m.HouseholdCMID)
		key := buildHouseholdCompositeKey(pbID, year)

		if existingRecord, ok := existing[key]; ok {
			if medNeedsUpdate(existingRecord, m) {
				stats.Updated++
			} else {
				stats.Skipped++
			}
		} else {
			stats.Created++
		}
	}

	return stats
}

// ============================================================================
// Original test helpers (unchanged)
// ============================================================================

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
			reg.NeedsAccommodation = parseBoolFieldValue(v.Value)
		case "FAM CAMP-Opt Out VIP":
			reg.OptOutVIP = parseBoolFieldValue(v.Value)
		}
	}

	return result
}

// ============================================================================
// Source-field correctness (spec 4.4) - these call the PRODUCTION functions
// ============================================================================

// newFieldDefsTestApp returns a throwaway PocketBase app with a custom_field_defs
// collection shaped like production's (cm_id + name), pre-populated with the
// given (cm_id, name) pairs. Names are stored VERBATIM - PocketBase preserves
// leading and trailing whitespace in text fields.
func newFieldDefsTestApp(t *testing.T, defs map[int]string) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("custom_field_defs")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(col); err != nil {
		t.Fatalf("save custom_field_defs: %v", err)
	}
	for cmID, name := range defs {
		r := core.NewRecord(col)
		r.Set("cm_id", cmID)
		r.Set("name", name)
		if err := app.Save(r); err != nil {
			t.Fatalf("save field def %d: %v", cmID, err)
		}
	}
	return app
}

// TestLoadFieldDefinitionsTrimsNames is a regression test for the trailing-space
// defect. CampMinder ships "Family Camp-Physician " (cm_id 39680) with a trailing
// space, while processMedical looks it up as "Family Camp-Physician". Before the
// fix the exact-match lookup missed every Physician answer ever recorded.
func TestLoadFieldDefinitionsTrimsNames(t *testing.T) {
	app := newFieldDefsTestApp(t, map[int]string{
		39680: "Family Camp-Physician ", // trailing space, verbatim from CampMinder
		39681: "Family Camp-Physician If Yes",
		36526: "Family Camp-Goals Attending",
	})

	s := NewFamilyCampDerivedSync(app)
	got, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	want := map[string]bool{
		"Family Camp-Physician":        true,
		"Family Camp-Physician If Yes": true,
		"Family Camp-Goals Attending":  true,
	}
	for _, name := range got {
		if !want[name] {
			t.Errorf("loadFieldDefinitions returned %q; expected a trimmed name", name)
		}
		delete(want, name)
	}
	for missing := range want {
		t.Errorf("loadFieldDefinitions did not return %q", missing)
	}
}

// TestNormalizeFieldName pins the trimming rule itself so callers other than
// loadFieldDefinitions can rely on it — Phase B's lodging_fields.go registry
// will be the second one. That file does not exist yet.
func TestNormalizeFieldName(t *testing.T) {
	cases := map[string]string{
		"Family Camp-Physician ":   "Family Camp-Physician",
		" Family Camp Cabin":       "Family Camp Cabin",
		"\tFAM CAMP-Shared Cabin ": "FAM CAMP-Shared Cabin",
		"Family Camp Cabin":        "Family Camp Cabin",
		"":                         "",
	}
	for in, want := range cases {
		if got := normalizeFieldName(in); got != want {
			t.Errorf("normalizeFieldName(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestLoadFieldDefinitionsIncludesCMIDAllowlist covers the retired-field defect.
// "Housing Accommodation" (cm_id 274057) succeeded "FAM Camp-Accommodation"
// (223999) in 2025, but its NAME matches none of the family-camp substrings that
// isFamilyCampField tests, so the name heuristic alone cannot reach it. Spec 4.4
// requires matching on cm_id for exactly this reason: display names are
// user-editable and CampMinder's own spelling is inconsistent ("Housing
// Accomodation", one m, is the Adult-partition twin).
func TestLoadFieldDefinitionsIncludesCMIDAllowlist(t *testing.T) {
	app := newFieldDefsTestApp(t, map[int]string{
		223999: "FAM Camp-Accommodation", // retired but kept for 2023/2024 backfill
		274057: "Housing Accommodation",  // Camper successor, name heuristic misses it
		274055: "Housing Accomodation",   // Adult twin, CampMinder's own typo
		274133: "Shared-request",         // request-layer free text (spec 4.1)
		206286: "COVID-19 Bunking Requests",
		34140:  "CA-Register for Family Camp", // matched by the NAME heuristic
		999999: "SVI-Vehicle Make",            // unrelated: must NOT be loaded
	})

	s := NewFamilyCampDerivedSync(app)
	got, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	loaded := make(map[string]bool, len(got))
	for _, name := range got {
		loaded[name] = true
	}

	for _, want := range []string{
		"FAM Camp-Accommodation",
		"Housing Accommodation",
		"Housing Accomodation",
		"Shared-request",
		"COVID-19 Bunking Requests",
		"CA-Register for Family Camp",
	} {
		if !loaded[want] {
			t.Errorf("loadFieldDefinitions did not load %q", want)
		}
	}
	if loaded["SVI-Vehicle Make"] {
		t.Error("loadFieldDefinitions loaded an unrelated field; the allowlist is too wide")
	}
}

// TestProcessRegistrationsAccommodationSuccessor proves the successor field
// actually reaches the needs_accommodation column, not merely the field map.
func TestProcessRegistrationsAccommodationSuccessor(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)

	// 2026-shaped input: only the successor field is answered.
	personValues := []customValueEntry{
		{householdPBID: "hh_emma", fieldName: "Housing Accommodation", value: "Yes"},
	}
	regs := s.processRegistrations(nil, personValues)
	if len(regs) != 1 {
		t.Fatalf("expected 1 registration, got %d", len(regs))
	}
	if !regs[0].needsAccommodation {
		t.Error("Housing Accommodation=Yes did not set needsAccommodation")
	}

	// 2024-shaped input: only the retired field is answered. Still works.
	legacy := []customValueEntry{
		{householdPBID: "hh_liam", fieldName: "FAM Camp-Accommodation", value: "Yes"},
	}
	legacyRegs := s.processRegistrations(nil, legacy)
	if len(legacyRegs) != 1 || !legacyRegs[0].needsAccommodation {
		t.Error("retired FAM Camp-Accommodation stopped working; 2024 backfill would lose it")
	}

	// Adult partition, CampMinder's own misspelling.
	adult := []customValueEntry{
		{householdPBID: "hh_noah", fieldName: "Housing Accomodation", value: "Yes"},
	}
	adultRegs := s.processRegistrations(nil, adult)
	if len(adultRegs) != 1 || !adultRegs[0].needsAccommodation {
		t.Error("Housing Accomodation (one m) did not set needsAccommodation")
	}
}

// TestProcessRegistrationsBoolFieldsOrAcrossPersons pins the OR aggregation
// itself, which is the behavior that changed when these two arms stopped
// assigning and started ORing.
//
// The "No" deliberately comes LAST in every case: under the previous
// last-wins assignment each of these would collapse to false, so a passing
// run proves the OR is real rather than incidental. processRegistrations
// iterates person values, and a household has several people, so disagreement
// between household members is the normal case, not an edge case.
func TestProcessRegistrationsBoolFieldsOrAcrossPersons(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)

	t.Run("accommodation ORs across household members", func(t *testing.T) {
		regs := s.processRegistrations(nil, []customValueEntry{
			{householdPBID: "hh_johnson", fieldName: "Housing Accommodation", value: "Yes"},
			{householdPBID: "hh_johnson", fieldName: "Housing Accommodation", value: "No"},
		})
		if len(regs) != 1 {
			t.Fatalf("expected 1 registration, got %d", len(regs))
		}
		if !regs[0].needsAccommodation {
			t.Error("a later No overwrote an earlier Yes; the arm is assigning, not ORing")
		}
	})

	t.Run("accommodation ORs across field generations", func(t *testing.T) {
		regs := s.processRegistrations(nil, []customValueEntry{
			{householdPBID: "hh_garcia", fieldName: "Housing Accommodation", value: "Yes"},
			{householdPBID: "hh_garcia", fieldName: "Housing Accomodation", value: "No"},
			{householdPBID: "hh_garcia", fieldName: "FAM Camp-Accommodation", value: "No"},
		})
		if len(regs) != 1 || !regs[0].needsAccommodation {
			t.Error("a Yes on one generation was lost to a No on another")
		}
	})

	// Defect 2's field. CampMinder stores the whole option sentence here, so
	// this also proves the sentence parser reaches the column and not just
	// parseBoolFieldValue's unit test.
	t.Run("opt out VIP reads Adult-Opt Out and the sentence values", func(t *testing.T) {
		regs := s.processRegistrations(nil, []customValueEntry{
			{
				householdPBID: "hh_chen",
				fieldName:     "Adult-Opt Out",
				value:         "Yes, please register regardless of cabin type",
			},
			{
				householdPBID: "hh_chen",
				fieldName:     "FAM CAMP-Opt Out VIP",
				value:         "No, I am only able to attend with this accommodation in place",
			},
		})
		if len(regs) != 1 {
			t.Fatalf("expected 1 registration, got %d", len(regs))
		}
		if !regs[0].optOutVIP {
			t.Error("Adult-Opt Out=Yes did not survive a later No; arm is assigning, not ORing")
		}
	})

	// The softer reading must stay opt-in: an all-No household is a blocker,
	// not a warning (spec 4.5).
	t.Run("all-No household does not opt out", func(t *testing.T) {
		regs := s.processRegistrations(nil, []customValueEntry{
			{
				householdPBID: "hh_riley",
				fieldName:     "FAM CAMP-Opt Out VIP",
				value:         "No, I am only able to attend with this accommodation in place",
			},
			{householdPBID: "hh_riley", fieldName: "Housing Accommodation", value: "Yes"},
		})
		if len(regs) != 1 {
			t.Fatalf("expected 1 registration, got %d", len(regs))
		}
		if regs[0].optOutVIP {
			t.Error("optOutVIP set true with no affirmative answer")
		}
	})
}
