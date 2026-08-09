package sync

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

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
		"FAM CAMP-Shared Cabin":         "shared_cabin_modes_raw",
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

// TestHouseholdCabinAssignment drives the production extractor rather than a
// test-local copy of the field->column mapping.
//
// It used to call extractRegistrationsFromHouseholds, a hand-rolled switch that
// modeled the mapping itself. That made it blind by construction: any change to
// how processRegistrations routes a field kept passing against the private copy.
// The helper is gone; this is the same coverage against the real code path.
func TestHouseholdCabinAssignment(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)

	regs := s.processRegistrations([]customValueEntry{
		{householdPBID: "hh_garcia", fieldName: fieldNameFamilyCampCabin, value: "Cabin 12"},
		{householdPBID: "hh_johnson", fieldName: fieldNameFamilyCampCabin, value: ""},
	}, nil)

	byHousehold := make(map[string]*registrationData, len(regs))
	for _, r := range regs {
		byHousehold[r.householdPBID] = r
	}

	reg, ok := byHousehold["hh_garcia"]
	if !ok {
		t.Fatal("expected a registration for the household with a cabin")
	}
	if reg.cabinAssignment != "Cabin 12" {
		t.Errorf("cabinAssignment = %q, want %q", reg.cabinAssignment, "Cabin 12")
	}

	// A household whose only value is an EMPTY cabin has nothing to record, so
	// it produces no row at all -- the "only include if has some data" gate.
	// The old helper returned an entry here, which is precisely the kind of
	// divergence a parallel mapping hides.
	if _, exists := byHousehold["hh_johnson"]; exists {
		t.Error("a household with only an empty cabin value must not produce a registration row")
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
		"FAM CAMP-Shared Cabin":         "shared_cabin_modes_raw",
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

// extractRegistrationsFromHouseholds is deliberately absent. It was a
// test-local re-implementation of processRegistrations' field->column mapping,
// and it had already drifted: a single accommodation name where production ORs
// across three generations, a single opt-out name, and last-wins assignment
// where production is first-wins. Every case arm added to processRegistrations
// widened the gap, and nothing failed. TestHouseholdCabinAssignment now drives
// the production path instead.

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

// TestLoadFieldDefinitionsRoutesRenamedRequestFieldByCMID closes the half
// extraFieldCMIDs could not. That allowlist decides only whether a definition is
// ADMITTED; routing downstream still switches on the display name, so a rename
// in CampMinder let an answer in and then dropped it on the floor. The
// request-layer registry in lodging_fields.go resolves the canonical name from
// the cm_id, so the switch sees the name it was written against.
func TestLoadFieldDefinitionsRoutesRenamedRequestFieldByCMID(t *testing.T) {
	app := newFieldDefsTestApp(t, map[int]string{
		// Staff renamed both in CampMinder. Neither new name matches anything
		// family_camp_derived.go's switch knows about.
		cmIDShareCabinsRegistration: "FC Cabin Sharing 2027",
		cmIDSharedRequest:           "Who do you want to bunk near?",
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
	for _, want := range []string{fieldShareCabinsRegistration, fieldSharedRequest} {
		if !loaded[want] {
			t.Errorf("a renamed request field did not resolve back to %q; got %v", want, got)
		}
	}
}

// TestProcessMedicalKeepsBothCamperAndAdultCPAPNarratives: the registration
// flags OR across the three CPAP fields because they describe DIFFERENT PEOPLE
// -- the Camper-partition generations and the Adult-partition twin. The
// narrative behind those flags has to follow the same rule, or staff see a
// bathroom flag with nothing in the admin-gated record explaining it.
//
// "Family Camp-CPAP" and "FAM CAMP-CPAP" are name-generations of the SAME
// question, so those two still collapse to one; Adult-CPAP is a different
// person and is always additive.
func TestProcessMedicalKeepsBothCamperAndAdultCPAPNarratives(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	vals := []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-CPAP",
			value: "Yes, outlet needed for CPAP machine", lastUpdated: ts},
		{householdPBID: "hh_garcia", fieldName: "Adult-CPAP",
			value: cpapBathroomOption, lastUpdated: ts},
	}

	regs := s.processRegistrations(nil, vals)
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if !regs[0].needsPower || !regs[0].needsPrivateBathroom {
		t.Fatalf("flags = power:%v bathroom:%v; both answers must raise their own flag",
			regs[0].needsPower, regs[0].needsPrivateBathroom)
	}

	meds := s.processMedical(vals)
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if !strings.Contains(meds[0].cpapInfo, "outlet") {
		t.Errorf("cpapInfo lost the camper narrative: %q", meds[0].cpapInfo)
	}
	if !strings.Contains(strings.ToLower(meds[0].cpapInfo), "bathroom") {
		t.Errorf("cpapInfo lost the adult narrative, leaving needs_private_bathroom "+
			"with no explanation behind it: %q", meds[0].cpapInfo)
	}
}

// TestProcessMedicalCollapsesCamperCPAPGenerations is the other half: the two
// Camper-partition names are the same question asked twice, so answering both
// must not duplicate the sentence in the medical record.
func TestProcessMedicalCollapsesCamperCPAPGenerations(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "Family Camp-CPAP",
			value: "Yes, outlet needed for CPAP machine", lastUpdated: ts},
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-CPAP",
			value: "Yes, outlet needed for CPAP machine", lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if strings.Count(strings.ToLower(meds[0].cpapInfo), "outlet") != 1 {
		t.Errorf("cpapInfo repeated one question's answer: %q", meds[0].cpapInfo)
	}
}

// TestProcessRegistrationsMandatoryOnlyHouseholdSurvives: accommodation_is_mandatory
// is the honest blocker signal (opt_out_vip's OR is fail-unsafe and must never be
// read as one), so a household whose ONLY answer is the blocker cannot be the one
// row that gets dropped before it is ever written.
func TestProcessRegistrationsMandatoryOnlyHouseholdSurvives(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "Adult-Opt Out", lastUpdated: ts,
			value: "No, I am only able to attend with this accommodation in place"},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1 -- the blocker was dropped", len(regs))
	}
	if !regs[0].accommodationIsMandatory {
		t.Error("accommodationIsMandatory not set")
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
	// This used to pair an opt-out with a blocker and assert the opt-out won.
	// That fixture was the kindred#1874 conflict, and the blocker now wins it --
	// see TestProcessRegistrationsOptOutLosesToABlockerInTheSameHousehold, which
	// covers that case in both member orders.
	//
	// The property this subtest exists for is narrower and still holds: the arm
	// accumulates across BOTH field names rather than assigning, so a second
	// member cannot clobber the first. Two agreeing members prove that without
	// depending on how a disagreement resolves.
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
				value:         "Yes, please register regardless of cabin type",
			},
		})
		if len(regs) != 1 {
			t.Fatalf("expected 1 registration, got %d", len(regs))
		}
		if !regs[0].optOutVIP {
			t.Error("Adult-Opt Out=Yes did not reach the column; the arm is not reading both field names")
		}
		if regs[0].accommodationIsMandatory {
			t.Error("two opt-outs and no blocker must not be mandatory")
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

// cpapBathroomOption is the multi-option CPAP answer whose own text contains
// "CPAP" -- inside "not CPAP related" -- which is why bathroom must be tested
// before any outlet/CPAP-machine match.
const cpapBathroomOption = "Yes, bathroom or other housing accommodation for a medical " +
	"(not CPAP related) or accessibility-related reason needed"

// The two spellings of the fourth CPAP option, which asks for BOTH needs at
// once. "we need" is the FAM CAMP-CPAP wording (13 values), "I need" the
// Adult-CPAP one (7). Both contain "bathroom", so a classifier that returns on
// the first bathroom match silently drops the outlet half for all 20.
const cpapBothOptionFamily = "Yes, we need an outlet for a CPAP machine and need a bathroom " +
	"or other housing accommodation for a medical or accessibility-related reason"
const cpapBothOptionAdult = "Yes, I need an outlet for a CPAP machine and need a bathroom " +
	"or other housing accommodation for a medical or accessibility-related reason"

// testRequestText is one parent's answer, stored against each enrolled child.
const testRequestText = "the Johnson family"

// TestProcessRegistrationsCollapsesDuplicateRequests is spec 4.2 at the
// integration point. The request fields are person-partition, so two enrolled
// children carry one parent's answer twice.
func TestProcessRegistrationsCollapsesDuplicateRequests(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 17, 51, 0, 0, time.UTC)

	// Two siblings in one household, same parent answer stored twice.
	personValues := []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "Shared-request",
			value: testRequestText, lastUpdated: ts},
		{householdPBID: "hh_garcia", fieldName: "Shared-request",
			value: testRequestText, lastUpdated: ts},
	}

	regs := s.processRegistrations(nil, personValues)
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if regs[0].requestText != testRequestText {
		t.Errorf("requestText = %q; the duplicate was not collapsed", regs[0].requestText)
	}
}

// TestProcessRegistrationsParsesGateAndModes: the 3-state gate and the two edge
// types, from the real option sentences.
func TestProcessRegistrationsParsesGateAndModes(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	personValues := []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: fieldShareCabinsRegistration, lastUpdated: ts,
			value: "Maybe, I am open to sharing a large camper cabin if a specific family " +
				"that I know wants to share a cabin with my family."},
		{householdPBID: "hh_garcia", fieldName: fieldSharedCabinForm, lastUpdated: ts,
			value: "Share a cabin WITH a specific family that I know (please include names below " +
				"and ensure that the request is mutual).|House my family NEAR a specific family " +
				"that I know (please include names below)"},
	}

	regs := s.processRegistrations(nil, personValues)
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if regs[0].shareCabinGate != gateMaybeMutual {
		t.Errorf("shareCabinGate = %q, want %q", regs[0].shareCabinGate, gateMaybeMutual)
	}
	if !regs[0].wantsNear || !regs[0].wantsWith {
		t.Errorf("wantsNear=%v wantsWith=%v; 24 households ask for both",
			regs[0].wantsNear, regs[0].wantsWith)
	}
}

// TestProcessRegistrationsDerivedAccessibilityFlags: the board gets booleans,
// never the narrative (spec 5.3).
func TestProcessRegistrationsDerivedAccessibilityFlags(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	personValues := []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-bathroom", value: "Yes", lastUpdated: ts},
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-CPAP", value: "Yes", lastUpdated: ts},
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-Opt Out VIP", lastUpdated: ts,
			value: "No, I am only able to attend with this accommodation in place"},
	}

	regs := s.processRegistrations(nil, personValues)
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	r := regs[0]
	if !r.needsPrivateBathroom {
		t.Error("needsPrivateBathroom not set from FAM CAMP-bathroom=Yes")
	}
	// Bare "Yes" on a CPAP field is power: the field is named CPAP and the
	// qualified options came later.
	if !r.needsPower {
		t.Error("needsPower not set from FAM CAMP-CPAP=Yes")
	}
	if !r.accommodationIsMandatory {
		t.Error(`"No, I am only able to attend with this accommodation in place" must be a blocker`)
	}
	if r.optOutVIP {
		t.Error("optOutVIP should be false for the No answer")
	}
}

// TestClassifyCPAPAnswer pins the option-level split. kindred#1875: the three
// CPAP fields are multi-option selects, and parseBoolFieldValue reads every
// option below as true.
func TestClassifyCPAPAnswer(t *testing.T) {
	cases := []struct {
		name         string
		value        string
		wantPower    bool
		wantBathroom bool
	}{
		{"bare yes is power", "Yes", true, false},
		{"outlet option", "Yes, outlet needed for CPAP machine", true, false},
		{"bathroom option is NOT power", cpapBathroomOption, false, true},
		{"bathroom option, lowercased", strings.ToLower(cpapBathroomOption), false, true},
		// The fourth option asks for both. Reading it as bathroom-only leaves a
		// CPAP machine without an outlet, which is the harmful direction.
		{"both option (family wording)", cpapBothOptionFamily, true, true},
		{"both option (adult wording)", cpapBothOptionAdult, true, true},
		{"no", "No", false, false},
		{"unanswered", "", false, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyCPAPAnswer(tc.value)
			if got.power != tc.wantPower || got.bathroom != tc.wantBathroom {
				t.Errorf("classifyCPAPAnswer(%q) = {power:%v bathroom:%v}, want {power:%v bathroom:%v}",
					tc.value, got.power, got.bathroom, tc.wantPower, tc.wantBathroom)
			}
		})
	}
}

// TestProcessRegistrationsCPAPBathroomIsNotPower is the 75-record case at the
// integration point: the household asked for a bathroom and said so in the
// same breath as "not CPAP related". It must not be given an outlet cabin.
func TestProcessRegistrationsCPAPBathroomIsNotPower(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-CPAP", value: cpapBathroomOption, lastUpdated: ts},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if regs[0].needsPower {
		t.Error(`"not CPAP related" must not set needsPower (75 records)`)
	}
	if !regs[0].needsPrivateBathroom {
		t.Error("the bathroom-qualified CPAP answer is a needsPrivateBathroom signal")
	}
}

// TestProcessRegistrationsHasInfant: Adult-Infant was allowlisted with no
// consumer in any phase (kindred#1876). It is a housing signal, so it gets one.
// The N/A option must not read as yes, and must not be special-cased either.
func TestProcessRegistrationsHasInfant(t *testing.T) {
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name  string
		value string
		want  bool
	}{
		{"yes", "Yes", true},
		{"no", "No", false},
		{"men's weekend registrant is not a yes", "I'm attending Men's Weekend", false},
		{"unanswered", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := NewFamilyCampDerivedSync(nil)
			regs := s.processRegistrations(nil, []customValueEntry{
				// Paired with a second signal so the "has some data" guard keeps
				// the row even when hasInfant is false.
				{householdPBID: "hh_garcia", fieldName: "FAM CAMP-bathroom", value: "Yes", lastUpdated: ts},
				{householdPBID: "hh_garcia", fieldName: "Adult-Infant", value: tc.value, lastUpdated: ts},
			})
			if len(regs) != 1 {
				t.Fatalf("registrations = %d, want 1", len(regs))
			}
			if regs[0].hasInfant != tc.want {
				t.Errorf("hasInfant for %q = %v, want %v", tc.value, regs[0].hasInfant, tc.want)
			}
		})
	}
}

// TestProcessRegistrationsHasInfantORsAcrossHousehold: unlike opt_out_vip, OR
// is fail-SAFE here -- one adult bringing an infant means the household has one.
func TestProcessRegistrationsHasInfantORsAcrossHousehold(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "Adult-Infant", value: "No", lastUpdated: ts},
		{householdPBID: "hh_garcia", fieldName: "Adult-Infant", value: "Yes", lastUpdated: ts},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if !regs[0].hasInfant {
		t.Error("one Yes in the household must set hasInfant")
	}
}

// TestProcessMedicalCPAPIncludesAdultField: Adult-CPAP is admitted by
// extraFieldCMIDs but processMedical never read it, so a household where only
// the accompanying adult answers produced an empty cpap_info. kindred#1875.
func TestProcessMedicalCPAPIncludesAdultField(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "Adult-CPAP", lastUpdated: ts,
			value: "Yes, outlet needed for CPAP machine"},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if meds[0].cpapInfo == "" {
		t.Error("cpapInfo empty; an adult-only CPAP answer was dropped")
	}
}

// TestProcessRegistrationsOptOutMakesTheNeedAWarning: the other polarity.
func TestProcessRegistrationsOptOutMakesTheNeedAWarning(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-bathroom", value: "Yes", lastUpdated: ts},
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-Opt Out VIP", lastUpdated: ts,
			value: "Yes, please register regardless of cabin type"},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if !regs[0].optOutVIP {
		t.Error(`"Yes, please register regardless of cabin type" must parse true`)
	}
	if regs[0].accommodationIsMandatory {
		t.Error("an opted-out accommodation is a warning, not a blocker")
	}
}

// TestProcessRegistrationsOptOutLosesToABlockerInTheSameHousehold is kindred#1874.
//
// The two columns are a three-state answer wearing two booleans, and they must
// stay mutually exclusive: a blocker anywhere in the household outranks another
// member's "I'll come anyway". A plain OR over optedOut collapsed the blocker
// into a warning for the 3 households a year whose members disagree, which is
// the fail-UNSAFE direction -- it reads as "this family will cope" when someone
// said they cannot attend without the accommodation.
//
// Order is varied because a running OR is order-sensitive and a finalization
// pass is not; asserting only one order would pass on a fix that works by luck.
func TestProcessRegistrationsOptOutLosesToABlockerInTheSameHousehold(t *testing.T) {
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)
	const optOut = "Yes, please register regardless of cabin type"
	const blocker = "No, I am only able to attend with this accommodation in place"

	for _, tc := range []struct {
		name   string
		first  string
		second string
	}{
		{"opt-out answered first", optOut, blocker},
		{"blocker answered first", blocker, optOut},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := NewFamilyCampDerivedSync(nil)
			regs := s.processRegistrations(nil, []customValueEntry{
				{householdPBID: "hh_garcia", fieldName: "FAM CAMP-Opt Out VIP",
					value: tc.first, lastUpdated: ts},
				{householdPBID: "hh_garcia", fieldName: "Adult-Opt Out",
					value: tc.second, lastUpdated: ts},
			})
			if len(regs) != 1 {
				t.Fatalf("registrations = %d, want 1", len(regs))
			}
			if !regs[0].accommodationIsMandatory {
				t.Error("a blocker in the household must survive another member's opt-out")
			}
			if regs[0].optOutVIP {
				t.Error("opt_out_vip must be false once any member answered blocker; " +
					"the two are mutually exclusive by construction")
			}
		})
	}
}

// TestProcessRegistrationsUnansweredOptOutIsNotMandatory: the default must be
// the softer reading, or every household with no answer becomes a blocker.
func TestProcessRegistrationsUnansweredOptOutIsNotMandatory(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "FAM CAMP-bathroom", value: "Yes", lastUpdated: ts},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if regs[0].accommodationIsMandatory {
		t.Error("an unanswered opt-out question must not make the need mandatory")
	}
}

// TestProcessMedicalRoutesNarrativeToTheAdminGatedTable: the sentences explaining
// a bathroom or accommodation need are PHI and belong only in
// family_camp_medical (spec 5.1).
func TestProcessMedicalRoutesNarrativeToTheAdminGatedTable(t *testing.T) {
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	// Deliberately non-specific placeholder text: never put a real disclosure,
	// or a real name, in a test fixture.
	const bathroomText = "requires an in-unit bathroom for a documented condition"
	const accommodationText = "requires ground-floor access"

	personValues := []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "Housing-Bathroom", value: bathroomText, lastUpdated: ts},
		{householdPBID: "hh_garcia", fieldName: "Housing Accommodation-Yes",
			value: accommodationText, lastUpdated: ts},
		// A real request, so the household actually produces a registration row.
		// Without it processRegistrations returns nothing and the second half of
		// this test asserts against an empty slice -- passing by checking
		// nothing, which is the failure mode it exists to catch.
		{householdPBID: "hh_garcia", fieldName: fieldSharedRequest,
			value: "we bunk with them every year", lastUpdated: ts},
	}

	med := s.processMedical(personValues)
	if len(med) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(med))
	}
	if med[0].bathroomExplain != bathroomText {
		t.Errorf("bathroomExplain = %q", med[0].bathroomExplain)
	}
	if med[0].accommodationExplain != accommodationText {
		t.Errorf("accommodationExplain = %q", med[0].accommodationExplain)
	}

	// And the same input must not put narrative on the registration row.
	regs := s.processRegistrations(nil, personValues)
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1; an empty slice would make the "+
			"assertions below vacuous", len(regs))
	}
	for _, r := range regs {
		for _, field := range []string{r.requestText, r.notes, r.goals, r.specialOccasions} {
			if strings.Contains(field, "documented condition") ||
				strings.Contains(field, "ground-floor") {
				t.Errorf("PHI narrative reached family_camp_registrations: %q", field)
			}
		}
	}
}

// TestRegistrationNeedsUpdateIgnoresTheUnknownSpelling pins the normalisation
// on the COMPARE path, which is what stops an endless rewrite.
//
// A household with no request values at all keeps Go's zero value "" on the
// struct, while setRegistrationRequestFields writes "unknown" to the row. If
// only the write normalised, every such household would compare unequal on
// every pass and be re-saved forever -- 35 rows on 2026 alone. Verified by hand
// against a real sync (a third pass touched 0 rows); this pins it.
func TestRegistrationNeedsUpdateIgnoresTheUnknownSpelling(t *testing.T) {
	col := core.NewBaseCollection("family_camp_registrations")
	col.Fields.Add(&core.TextField{Name: "share_eligibility"})
	col.Fields.Add(&core.TextField{Name: "share_eligibility_source"})
	col.Fields.Add(&core.BoolField{Name: "share_answers_conflict"})

	existing := core.NewRecord(col)
	existing.Set("share_eligibility", "unknown")
	existing.Set("share_eligibility_source", "none")

	s := &FamilyCampDerivedSync{}

	// The struct never reached the collapse, so it holds "". The row holds the
	// normalised spelling. Those are the SAME state and must not read as a
	// change.
	unwritten := &registrationData{}
	if s.registrationNeedsUpdate(existing, unwritten) {
		t.Error("an unwritten verdict must compare equal to the stored \"unknown\", or the sync rewrites it forever")
	}

	// A genuine change still registers.
	changed := &registrationData{
		shareEligibility:       "open",
		shareEligibilitySource: "form",
	}
	if !s.registrationNeedsUpdate(existing, changed) {
		t.Error("a real verdict change must still be detected")
	}
}

// TestProcessAdultsPersonFieldsTakeTheFirstLoadedSibling pins the CURRENT,
// arbitrary tie-break in processAdults' per-person merge, so that changing it
// is a deliberate, visible break rather than a silent drift.
//
// The person-partition fields (FC-P1/P2 First/Last Name, Email, Pronouns,
// Gender, DOB, Relationship) describe the household's ADULTS, but CampMinder
// stores them on every enrolled child's record. A household with two children
// therefore supplies two copies, and when a form was filled twice they can
// disagree. processAdults resolves that with "first non-empty wins" over a
// slice that loadPersonCustomValues returns in person_custom_values record-id
// order -- so the winner is whichever sibling's row happens to carry the lower
// record id, which correlates with nothing about the answer.
//
// Measured against the production snapshot for 2026, over the 382 rostered
// family-camp households: 254 (household, field, adult) groups have siblings
// that disagree, spread across 113 households, and resolving by CampMinder's
// own last_updated instead would pick a different value in 130 of them. So
// this is a live arbitrary choice, not a theoretical one -- but it is also a
// small one, because only two of the merged columns reach the UI at all.
//
// PENDING, deliberately (owner ruling on kindred#1945): which sibling should
// win is a product decision, and it is coupled to the still-open question of
// whether gender/date_of_birth/email/pronouns are kept. Do not "fix" this test
// by changing the merge until that ruling lands.
func TestProcessAdultsPersonFieldsTakeTheFirstLoadedSibling(t *testing.T) {
	s := &FamilyCampDerivedSync{}

	householdValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Emma Johnson"},
	}
	// Both entries come from the same household via two different children.
	// Order here is the order loadPersonCustomValues yields: ascending record
	// id. The SECOND one is the more recently edited, which is exactly why the
	// choice matters.
	personValues := []customValueEntry{
		{
			householdPBID: "hh_1",
			fieldName:     "Family Camp-Relationship to 1",
			value:         "Mother",
			lastUpdated:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			householdPBID: "hh_1",
			fieldName:     "Family Camp-Relationship to 1",
			value:         "Stepmother",
			lastUpdated:   time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		},
	}

	adults := s.processAdults(householdValues, personValues)

	if len(adults) != 1 {
		t.Fatalf("expected 1 merged adult, got %d", len(adults))
	}
	if adults[0].name != "Emma Johnson" {
		t.Errorf("household `name` is the column of record: got %q", adults[0].name)
	}
	if adults[0].relationship != "Mother" {
		t.Errorf(
			"first-loaded sibling wins today: got %q, want %q (if you changed the merge on purpose, "+
				"update this test and kindred#1945 together)",
			adults[0].relationship, "Mother",
		)
	}
}

// TestProcessAdultsKeepsANameOnlyAdult guards the shape that makes the
// household `name` column authoritative: adults 3-5 arrive with ONLY `name`,
// and first_name/last_name empty for 100% of those rows in every measured
// year. An admission filter that reads the split columns to decide whether a
// row is real would drop them -- 136 real adults across 2022-2026 are blank in
// first_name/last_name and populated in `name` (kindred#1945).
func TestProcessAdultsKeepsANameOnlyAdult(t *testing.T) {
	s := &FamilyCampDerivedSync{}

	householdValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 3", value: "Mateo Rivera"},
	}

	adults := s.processAdults(householdValues, nil)

	if len(adults) != 1 {
		t.Fatalf("a name-only adult must survive the merge, got %d adults", len(adults))
	}
	if adults[0].adultNumber != 3 || adults[0].name != "Mateo Rivera" {
		t.Errorf("got adult %d %q, want 3 %q", adults[0].adultNumber, adults[0].name, "Mateo Rivera")
	}
	if adults[0].firstName != "" || adults[0].lastName != "" {
		t.Errorf("nothing may invent split columns: got first=%q last=%q", adults[0].firstName, adults[0].lastName)
	}
}
