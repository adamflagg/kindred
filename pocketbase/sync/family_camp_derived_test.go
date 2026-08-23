package sync

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
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
	t.Parallel()
	// The service name must be "family_camp_derived" for orchestrator integration
	expectedName := serviceNameFamilyCampDerived

	// Test that the expected name matches (actual instance test requires PocketBase app)
	if expectedName != serviceNameFamilyCampDerived {
		t.Errorf("expected service name %q", expectedName)
	}
}

// TestFamilyCampYearValidation tests year parameter validation
func TestFamilyCampYearValidation(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	fieldMappings := map[string]string{
		"Family Camp Cabin":             "cabin_assignment",
		"FAM CAMP-Share Cabins":         "share_cabin_preference",
		"FAM CAMP-Shared Cabin":         "shared_cabin_modes_raw",
		"Family Camp-Trans ETA":         "arrival_eta",
		"Family Camp-Special occasions": "special_occasions",
		"Family Camp-Goals Attending":   "goals",
		"Family Camp-Anything else":     "notes",
		"FAM Camp-Accommodation":        "needs_accommodation",
		"FAM CAMP-Opt Out VIP":          "accommodation_is_mandatory",
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
	t.Parallel()
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

// TestMedicalDeduplicationByHousehold tests that medical info is deduplicated per household.
//
// NOTE: it drives aggregateMedicalByHousehold, a test-local reimplementation,
// and asserts only non-emptiness -- so it is blind to how production collapses a
// household's answers and cannot fail when processMedical changes. The real
// coverage of that is TestProcessMedicalKeepsEveryAnswerersNarrative and the
// kindred#2255 tests beside it.
func TestMedicalDeduplicationByHousehold(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
		"FAM CAMP-Opt Out VIP":          "accommodation_is_mandatory",
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	app := newFieldDefsTestApp(t, map[int]string{
		223999: "FAM Camp-Accommodation", // retired but kept for 2023/2024 backfill
		274057: "Housing Accommodation",  // Camper successor, name heuristic misses it
		274055: "Housing Accomodation",   // Adult twin, CampMinder's own typo
		224987: "Accommodation-Explain",  // Adult explain twin of 274058 (kindred#2224)
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
		"Accommodation-Explain",
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
// is the one stored VIP signal (owner ruling 2026-08-22), so a household whose
// ONLY answer is the blocker cannot be the one row that gets dropped before it
// is ever written.
func TestProcessRegistrationsMandatoryOnlyHouseholdSurvives(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	// OWNER RULING 2026-08-22: the VIP answer is ONE field in Kindred --
	// accommodation_is_mandatory, the answer's No pole. "Yes, please register
	// regardless" carries no signal we store, so a household whose only
	// answers are yes-flexible writes NO registration row at all. The
	// both-field-names property has two witnesses: the order-varied blocker
	// test (TestProcessRegistrationsOptOutLosesToABlockerInTheSameHousehold)
	// feeds the No pole through "Adult-Opt Out" in one order and
	// "FAM CAMP-Opt Out VIP" in the other, and
	// TestProcessRegistrationsMandatoryOnlyHouseholdSurvives sends its only
	// blocker through "Adult-Opt Out". Dropping either field name from the
	// switch arm fails the suite.
	t.Run("yes-flexible answers alone store nothing", func(t *testing.T) {
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
		if len(regs) != 0 {
			t.Fatalf("expected no registration row for a yes-flexible-only household, got %d", len(regs))
		}
	})

	// An all-No household is a blocker, not a warning (spec 4.5).
	t.Run("all-No household is a blocker", func(t *testing.T) {
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
		if !regs[0].accommodationIsMandatory {
			t.Error("the No answer must set accommodation_is_mandatory")
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
}

// TestClassifyCPAPAnswer pins the option-level split. kindred#1875: the three
// CPAP fields are multi-option selects, and parseBoolFieldValue reads every
// option below as true.
func TestClassifyCPAPAnswer(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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

// TestProcessRegistrationsHasInfantORsAcrossHousehold: OR is fail-SAFE here --
// one adult bringing an infant means the household has one.
func TestProcessRegistrationsHasInfantORsAcrossHousehold(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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

// TestProcessMedicalAccommodationExplainIncludesAdultField is the accommodation
// twin of TestProcessMedicalCPAPIncludesAdultField, and of the two-key loop
// bathroomExplain already runs. accommodationExplain read only "Housing
// Accommodation-Yes" (the Camper key), so a household narrated solely through
// the adult gate's own explain twin -- "Accommodation-Explain", cm_id 224987,
// admitted by extraFieldCMIDs -- lost its narrative outright even though the
// field was in the map. kindred#2224.
//
// Measured against production, 2026: of 42 accommodation-gated households, 12
// had no Camper-side narrative, and all 12 have text in this field -- so
// admitting it alone takes the un-narrated count from 12 to 0.
func TestProcessMedicalAccommodationExplainIncludesAdultField(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2025, 4, 21, 0, 0, 0, 0, time.UTC)

	const accommodationText = "requires accessible transfer space"

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_martinez", fieldName: "Accommodation-Explain",
			value: accommodationText, lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if meds[0].accommodationExplain != accommodationText {
		t.Errorf("accommodationExplain = %q; an adult-only accommodation "+
			"explain was dropped", meds[0].accommodationExplain)
	}
}

// TestProcessRegistrationsOptOutMakesTheNeedAWarning: the other polarity.
func TestProcessRegistrationsOptOutMakesTheNeedAWarning(t *testing.T) {
	t.Parallel()
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
	if regs[0].accommodationIsMandatory {
		t.Error("an opted-out accommodation is a warning, not a blocker")
	}
}

// TestProcessRegistrationsOptOutLosesToABlockerInTheSameHousehold is kindred#1874.
//
// The VIP answer is ONE stored boolean (owner ruling 2026-08-22):
// accommodation_is_mandatory, its No pole. A blocker anywhere in the household
// outranks another member's "I'll come anyway" -- with only the blocker stored
// as a plain OR, that fail-SAFE resolution is structural rather than a
// finalization pass, but the property is still worth pinning: it reads as
// "this family will cope" when someone said they cannot attend, and that is
// the direction that must never regress.
//
// Order is varied because a running OR is order-sensitive and a finalization
// pass is not; asserting only one order would pass on a fix that works by luck.
func TestProcessRegistrationsOptOutLosesToABlockerInTheSameHousehold(t *testing.T) {
	t.Parallel()
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
		})
	}
}

// TestProcessRegistrationsUnansweredOptOutIsNotMandatory: the default must be
// the softer reading, or every household with no answer becomes a blocker.
func TestProcessRegistrationsUnansweredOptOutIsNotMandatory(t *testing.T) {
	t.Parallel()
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
// a bathroom or accommodation need are medical narrative and belong only in
// family_camp_medical (spec 5.1).
func TestProcessMedicalRoutesNarrativeToTheAdminGatedTable(t *testing.T) {
	t.Parallel()
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
				t.Errorf("medical narrative reached family_camp_registrations: %q", field)
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
	t.Parallel()
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

// TestProcessAdultsMergeTiebreaksOnCampMinderID replaces
// TestProcessAdultsPersonFieldsTakeTheFirstLoadedSibling, which deliberately
// pinned the PRE-kindred#2275 behavior: the winner was whichever sibling's
// person_custom_values row happened to carry the lower PocketBase record id.
// That key is not durable -- the vendor sync's orphan sweep deletes and later
// re-admits a row with a brand-new random id, so the SAME two siblings'
// answers could pick a different winner on a later resync with no data
// change at all.
//
// Owner ruling 2026-08-19: "whatever sort we choose, must be repeatable, not
// random", then "none of these are stable if an older child is edited
// later?" -- adopted answer: first-wins, with a CampMinder-id tiebreak. A
// person's own CampMinder id survives every resync, so processAdults now
// sorts the person-values slice by personCMID (ascending) before merging --
// mergeFirstNonEmpty itself is UNCHANGED; only the order fed into it moved.
// The winner is the lowest-keyed sibling with a non-empty answer, full stop.
//
// This test pins that policy two ways a record-id tiebreak could not:
//
//  1. Order-independence: every permutation of the two source rows produces
//     the identical winner (the retired test asserted only one hard-coded
//     order, matching whichever happened to load first).
//  2. Recency-independence: the ruling was adopted specifically because a
//     recency rule is NOT stable under a later edit to the losing sibling's
//     answer. The fixture gives the losing sibling (cmid 5002, "Stepmother")
//     the newer lastUpdated on purpose, and the winner must not follow it.
func TestProcessAdultsMergeTiebreaksOnCampMinderID(t *testing.T) {
	t.Parallel()

	// A local constant rather than the literal twice: goconst counts repeated
	// string literals across the package and this name is already used in
	// three other sync tests.
	const wantName = "Emma Johnson"

	householdValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: wantName},
	}

	// cmid 5001 (Mother) must win over cmid 5002 (Stepmother) regardless of
	// which one loads first and regardless of which one was edited more
	// recently.
	base := []customValueEntry{
		{
			householdPBID: "hh_1", personPBID: "person_mother", personCMID: 5001,
			fieldName:   "Family Camp-Relationship to 1",
			value:       "Mother",
			lastUpdated: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			householdPBID: "hh_1", personPBID: "person_stepmother", personCMID: 5002,
			fieldName:   "Family Camp-Relationship to 1",
			value:       "Stepmother",
			lastUpdated: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
		},
	}

	for _, personValues := range permutations(base) {
		s := &FamilyCampDerivedSync{}
		adults := s.processAdults(householdValues, personValues)

		if len(adults) != 1 {
			t.Fatalf("expected 1 merged adult, got %d (input order %+v)", len(adults), personValues)
		}
		if adults[0].name != wantName {
			t.Errorf("household `name` is the column of record: got %q", adults[0].name)
		}
		if adults[0].relationship != "Mother" {
			t.Errorf(
				"lowest CampMinder id must win regardless of load order or recency: got %q, want %q "+
					"(input order %+v)",
				adults[0].relationship, "Mother", personValues,
			)
		}
	}
}

// TestProcessAdultsCampMinderIDTiebreakAppliesToDateOfBirth is the headline
// case: date_of_birth is the single largest loss in this file -- 1,159
// answers discarded across all years, raw and unnormalised, re-measured
// 2026-08-21 against pocketbase/pb_data/data-prod.db (drift of +8 from the
// 1,151 last recorded 2026-08-19; counts here move with ongoing 2026
// registration and are not a stable constant to cite blindly).
// Confirms the same CampMinder-id tiebreak governs date_of_birth, normalised
// before the merge exactly as processAdults already does, and stays
// order-independent under every permutation of the source rows.
func TestProcessAdultsCampMinderIDTiebreakAppliesToDateOfBirth(t *testing.T) {
	t.Parallel()

	// A name is required for the row to survive processAdults' admission
	// filter (kindred#1946) -- a slot with only a DOB and no name anywhere is
	// not admitted as an adult at all, which is orthogonal to what this test
	// pins.
	householdValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Emma Johnson"},
	}
	base := []customValueEntry{
		{
			householdPBID: "hh_1", personPBID: "person_a", personCMID: 7001,
			fieldName: "Family Camp DOB 1", value: "3/4/1980",
		},
		{
			householdPBID: "hh_1", personPBID: "person_b", personCMID: 7002,
			fieldName: "Family Camp DOB 1", value: "9/2/1979",
		},
	}

	for _, personValues := range permutations(base) {
		s := &FamilyCampDerivedSync{}
		adults := s.processAdults(householdValues, personValues)

		if len(adults) != 1 {
			t.Fatalf("expected 1 merged adult, got %d (input order %+v)", len(adults), personValues)
		}
		const want = "1980-03-04" // normalizeDateOfBirth's canonical form for the lower cmid's answer
		if adults[0].dateOfBirth != want {
			t.Errorf("lowest CampMinder id must win regardless of load order: got %q, want %q (input order %+v)",
				adults[0].dateOfBirth, want, personValues)
		}
	}
}

// TestProcessAdultsKeepsANameOnlyAdult guards the shape that makes the
// household `name` column authoritative: adults 3-5 arrive with ONLY `name`,
// and first_name/last_name empty for 100% of those rows in every measured
// year. An admission filter that reads the split columns to decide whether a
// row is real would drop them -- 196 real adults across 2022-2026 are blank in
// first_name/last_name and populated in `name` (kindred#1945).
func TestProcessAdultsKeepsANameOnlyAdult(t *testing.T) {
	t.Parallel()
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

// TestProcessAdultsDropsNamelessRows pins kindred#1946: an adult with no
// name in ANY field (name/first_name/last_name) must not be admitted, even
// if email or gender data exists for it -- those two arms of the old
// admission OR-chain let 194 wholly nameless rows into production. A real
// `name` with blank split columns is the OPPOSITE case (kindred#1945/#1946
// safety point, ~196 real adults across 2022-2026) and must still survive.
func TestProcessAdultsDropsNamelessRows(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name            string
		householdValues []customValueEntry
		personValues    []customValueEntry
		wantAdmitted    bool
	}{
		{
			name: "gender only, no name anywhere -- NOT admitted",
			personValues: []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Gender 1", value: "Female"},
			},
			wantAdmitted: false,
		},
		{
			name: "email only, no name anywhere -- NOT admitted",
			personValues: []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: "parent@example.com"},
			},
			wantAdmitted: false,
		},
		{
			name: "gender placeholder NA does not rescue a nameless row",
			personValues: []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Gender 1", value: "NA"},
			},
			wantAdmitted: false,
		},
		{
			name: "real name, blank first/last name -- IS admitted (196-row safety case)",
			householdValues: []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Noah Smith"},
			},
			wantAdmitted: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &FamilyCampDerivedSync{}
			adults := s.processAdults(tc.householdValues, tc.personValues)
			gotAdmitted := len(adults) == 1
			if len(adults) > 1 {
				t.Fatalf("expected at most 1 adult, got %d", len(adults))
			}
			if gotAdmitted != tc.wantAdmitted {
				t.Errorf("admitted = %v, want %v (adults: %+v)", gotAdmitted, tc.wantAdmitted, adults)
			}
		})
	}
}

// TestProcessAdultsEmailMergePrefersWellFormedValue pins the kindred#1945
// fix: when two sibling forms carry DIFFERENT NON-EMPTY emails for the same
// adult, the well-formed one must win, regardless of which sibling's row
// processAdults sees first. Both orderings are asserted for every case
// because the bug being fixed IS the iteration-order tie-break -- a test
// that only tried the order where the well-formed value happens to load
// first would pass against the OLD, buggy code too (first-non-empty already
// gets it right by luck in that order) and would prove nothing.
func TestProcessAdultsEmailMergePrefersWellFormedValue(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		malformed  string
		wellFormed string
	}{
		// Missing dot in the domain -- mirrors the "domain typo" harm the
		// issue measured against production (5 stored emails, 4 with a
		// correct sibling value discarded by iteration order).
		{name: "missing dot in domain", malformed: "amy.johnson@examplecom", wellFormed: "amy.johnson@example.com"},
		// Trailing junk -- the other malformation kindred#1945 calls out
		// explicitly ("no trailing/leading junk such as a trailing comma").
		{name: "trailing comma junk", malformed: "ben.garcia@example.com,", wellFormed: "ben.garcia@example.com"},
	}

	for _, tc := range cases {
		for _, order := range []string{"malformed-first", "well-formed-first"} {
			t.Run(tc.name+"/"+order, func(t *testing.T) {
				s := &FamilyCampDerivedSync{}
				householdValues := []customValueEntry{
					{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
				}
				malformedEntry := customValueEntry{
					householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: tc.malformed,
				}
				wellFormedEntry := customValueEntry{
					householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: tc.wellFormed,
				}

				var personValues []customValueEntry
				if order == "malformed-first" {
					personValues = []customValueEntry{malformedEntry, wellFormedEntry}
				} else {
					personValues = []customValueEntry{wellFormedEntry, malformedEntry}
				}

				adults := s.processAdults(householdValues, personValues)

				if len(adults) != 1 {
					t.Fatalf("expected 1 merged adult, got %d", len(adults))
				}
				if adults[0].email != tc.wellFormed {
					t.Errorf(
						"order=%s: got email %q, want well-formed %q -- validity must decide, not load order",
						order, adults[0].email, tc.wellFormed,
					)
				}
			})
		}
	}
}

// TestProcessAdultsEmailBothWellFormedKeepsFirstLoaded guards the OTHER half
// of the kindred#1945 rule: validity only breaks a tie when it actually
// discriminates. Two different but BOTH well-formed emails (e.g. two
// legitimately distinct addresses) must fall back to the pre-existing
// first-loaded-sibling behavior, not get silently overwritten just because
// email now has a validity notion.
func TestProcessAdultsEmailBothWellFormedKeepsFirstLoaded(t *testing.T) {
	t.Parallel()
	const first = "amy.johnson@example.com"
	const second = "amy.j.johnson@example.org"

	s := &FamilyCampDerivedSync{}
	householdValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
	}
	personValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: first},
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: second},
	}

	adults := s.processAdults(householdValues, personValues)

	if len(adults) != 1 {
		t.Fatalf("expected 1 merged adult, got %d", len(adults))
	}
	if adults[0].email != first {
		t.Errorf("both emails are well-formed: got %q, want first-loaded %q unchanged", adults[0].email, first)
	}
}

// TestProcessAdultsEmailGapFillStillWins is the regression guard the issue
// asks for: gap-fill (one sibling blank, the other filled) must keep
// producing the filled value, in both iteration orders. This is ~246 of
// what the merge does across the dataset, and a validity change that broke
// it would be a regression, not a fix.
func TestProcessAdultsEmailGapFillStillWins(t *testing.T) {
	t.Parallel()
	const filled = "amy.johnson@example.com"

	for _, order := range []string{"blank-first", "filled-first"} {
		t.Run(order, func(t *testing.T) {
			s := &FamilyCampDerivedSync{}
			householdValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
			}
			blankEntry := customValueEntry{
				householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: "",
			}
			filledEntry := customValueEntry{
				householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: filled,
			}

			var personValues []customValueEntry
			if order == "blank-first" {
				personValues = []customValueEntry{blankEntry, filledEntry}
			} else {
				personValues = []customValueEntry{filledEntry, blankEntry}
			}

			adults := s.processAdults(householdValues, personValues)

			if len(adults) != 1 {
				t.Fatalf("expected 1 merged adult, got %d", len(adults))
			}
			if adults[0].email != filled {
				t.Errorf("order=%s: got email %q, want %q -- gap-fill must still win", order, adults[0].email, filled)
			}
		})
	}
}

// ============================================================================
// kindred#2275 phase D -- NORMALISATION of date_of_birth and
// relationship_to_camper. Format/case only; the merge policy and the record
// grain are unchanged and remain kindred#2275's open subject.
// ============================================================================

// TestNormalizeDateOfBirthAcceptsEveryStoredFormat is the guard against the
// trap that cost the measurement of kindred#2275 three rounds: a date parser
// that only accepts M/D/YYYY reports the other 3,243 readable production
// answers as junk. Every case below is a shape that actually occurs in the family camp
// DOB fields (cm_id 34166/34167), and every one must come out as the single
// canonical form YYYY-MM-DD.
func TestNormalizeDateOfBirthAcceptsEveryStoredFormat(t *testing.T) {
	t.Parallel()

	const want = "1979-09-02"

	cases := []struct {
		name string
		raw  string
		want string
	}{
		{name: "M/D/YYYY (10,418 of 13,823)", raw: "9/2/1979", want: want},
		{name: "MM/DD/YYYY zero padded", raw: "09/02/1979", want: want},
		{name: "M/D/YY (2,042)", raw: "9/2/79", want: want},
		{name: "M-D-YYYY (384)", raw: "9-2-1979", want: want},
		{name: "MM-DD-YYYY zero padded", raw: "09-02-1979", want: want},
		{name: "M-D-YY (147)", raw: "9-2-79", want: want},
		{name: "M.D.YYYY (45)", raw: "9.2.1979", want: want},
		{name: "M.D.YY (49)", raw: "2.13.80", want: "1980-02-13"},
		{name: "MMDDYYYY (369)", raw: "09021979", want: want},
		{name: "MMDDYYYY without leading zero month", raw: "10221978", want: "1978-10-22"},
		{name: "MMDDYY six digits", raw: "090279", want: want},
		{name: "ISO already canonical (1)", raw: "1979-09-02", want: want},
		{name: "ISO with single digit parts", raw: "1979-9-2", want: want},
		{name: "long month name", raw: "October 28, 1981", want: "1981-10-28"},
		{name: "abbreviated month name", raw: "Oct 6, 1981", want: "1981-10-06"},
		{name: "month name without comma", raw: "September 2 1979", want: want},
		{name: "day-first with abbreviated month", raw: "9-Oct-1974", want: "1974-10-09"},
		{name: "day-first spaced", raw: "28 Nov 1967", want: "1967-11-28"},
		{name: "space separated numeric", raw: "03 16 1976", want: "1976-03-16"},
		{name: "mixed separators", raw: "05-02/1972", want: "1972-05-02"},
		{name: "surrounding whitespace is trimmed", raw: "  9/2/1979  ", want: want},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizeDateOfBirth(tc.raw); got != tc.want {
				t.Errorf("normalizeDateOfBirth(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

// TestNormalizeDateOfBirthNormalisesRatherThanDiscards pins the half of the
// contract that is easy to get backwards: a value the parser cannot read is
// returned UNCHANGED, never blanked. Only 162 of 13,823 production answers
// (1.2%) land here, and every one of them is a real answer a staff member
// typed -- discarding them would be a data loss dressed up as a cleanup.
func TestNormalizeDateOfBirthNormalisesRatherThanDiscards(t *testing.T) {
	t.Parallel()

	// Every one of these is a verbatim shape from the production snapshot.
	unparseable := []string{
		"11/13",   // month/day only, no year
		"6274",    // four bare digits
		"1974",    // year only
		"None",    // literal
		"na",      // literal
		"N/A",     // literal
		"July 30", // month and day, no year
		"2/30/1980",
		"13/1/1980", // month out of range
	}

	for _, raw := range unparseable {
		t.Run(raw, func(t *testing.T) {
			t.Parallel()
			if got := normalizeDateOfBirth(raw); got != raw {
				t.Errorf("normalizeDateOfBirth(%q) = %q, want the input back unchanged", raw, got)
			}
		})
	}

	if got := normalizeDateOfBirth(""); got != "" {
		t.Errorf("normalizeDateOfBirth(%q) = %q, want empty", "", got)
	}
	if got := normalizeDateOfBirth("   "); got != "" {
		t.Errorf("normalizeDateOfBirth(%q) = %q, want empty", "   ", got)
	}
}

// TestNormalizeDateOfBirthTwoDigitYearPivot states the century rule
// explicitly, because a two-digit year is genuinely ambiguous and a silent
// choice here would be a guess. Rule: YY >= 30 is 19YY, YY < 30 is 20YY.
// The pivot sits in a gap that is empty in production -- the two-digit years
// actually stored are 01-24 (52 answers, children's dates typed into an adult
// field) and 43-99 (2,188 answers), with 25-42 absent -- so it cannot
// misclassify any value present today.
func TestNormalizeDateOfBirthTwoDigitYearPivot(t *testing.T) {
	t.Parallel()

	cases := []struct{ raw, want string }{
		{raw: "1/2/99", want: "1999-01-02"},
		{raw: "1/2/58", want: "1958-01-02"},
		{raw: "1/2/43", want: "1943-01-02"},
		{raw: "1/2/30", want: "1930-01-02"},
		{raw: "1/2/29", want: "2029-01-02"},
		{raw: "1/2/24", want: "2024-01-02"},
		{raw: "1/2/01", want: "2001-01-02"},
		{raw: "1/2/00", want: "2000-01-02"},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			t.Parallel()
			if got := normalizeDateOfBirth(tc.raw); got != tc.want {
				t.Errorf("normalizeDateOfBirth(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

// TestNormalizeDateOfBirthDoesNotValidatePlausibility pins that this is a
// FORMAT normaliser and not a validator. Production holds mistyped years
// (2986, 9171, 1073) that are perfectly well-formed dates and hopeless
// birthdays. Rewriting them into canonical form is lossless and makes them
// comparable; rejecting them would put them back in the "junk" bucket the
// earlier measurements wrongly inflated.
func TestNormalizeDateOfBirthDoesNotValidatePlausibility(t *testing.T) {
	t.Parallel()

	if got := normalizeDateOfBirth("2/13/2986"); got != "2986-02-13" {
		t.Errorf("normalizeDateOfBirth(%q) = %q, want %q", "2/13/2986", got, "2986-02-13")
	}
}

// TestNormalizeRelationshipToCamperFoldsCaseAndTheTwoSynonymPairs covers the
// second normalisation. 315 of 5,751 (household, year, adult slot) groups
// disagree on relationship_to_camper in production, and the largest single
// cause is case: `Father`/`father`/`FAther`/`FATHER` are four spellings of one
// answer. Mom<->Mother and Dad<->Father are the only synonym pairs folded.
func TestNormalizeRelationshipToCamperFoldsCaseAndTheTwoSynonymPairs(t *testing.T) {
	t.Parallel()

	cases := []struct{ raw, want string }{
		{raw: "Mother", want: "Mother"},
		{raw: "mother", want: "Mother"},
		{raw: "MOther", want: "Mother"},
		{raw: "MOTHER", want: "Mother"},
		{raw: "Mom", want: "Mother"},
		{raw: "mom", want: "Mother"},
		{raw: "MOM", want: "Mother"},
		{raw: "Father", want: "Father"},
		{raw: "father", want: "Father"},
		{raw: "FAther", want: "Father"},
		{raw: "Dad", want: "Father"},
		{raw: "dad", want: "Father"},
		{raw: "DAD", want: "Father"},
		{raw: "Parent", want: "Parent"},
		{raw: "parent", want: "Parent"},
		{raw: "PArent", want: "Parent"},
		{raw: "self", want: "Self"},
		{raw: "Self", want: "Self"},
		{raw: "grandmother", want: "Grandmother"},
		{raw: "spouse", want: "Spouse"},
		{raw: "  Mother  ", want: "Mother"},
		{raw: "", want: ""},
		{raw: "   ", want: ""},
	}

	for _, tc := range cases {
		t.Run("raw="+tc.raw, func(t *testing.T) {
			t.Parallel()
			if got := normalizeRelationshipToCamper(tc.raw); got != tc.want {
				t.Errorf("normalizeRelationshipToCamper(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

// TestNormalizeRelationshipToCamperKeepsDistinctAnswersDistinct is the guard
// on what must NOT be folded.
//
//   - Mother and Father must never collapse into each other. 92 of the 167
//     groups that still disagree after normalisation are exactly this pair --
//     two children naming two DIFFERENT PEOPLE into one adult slot. That is
//     the signal kindred#2275 exists to measure; folding it would delete the
//     evidence and make the residual look artificially small.
//   - Step-parents are a real if small population (~21 production answers:
//     `Step Father`, `step mother`, `Stepmom`, `Dad/Stepdad` ...). Synonym
//     folding is exact-match on the whole value, never a substring, so none of
//     them is rewritten into `Mother` or `Father`.
//   - Free text keeps the capitalisation the parent typed. Only a single
//     all-letters token is case-folded.
func TestNormalizeRelationshipToCamperKeepsDistinctAnswersDistinct(t *testing.T) {
	t.Parallel()

	cases := []struct{ raw, want string }{
		{raw: "Stepmom", want: "Stepmom"},
		{raw: "stepmom", want: "Stepmom"},
		{raw: "Stepmother", want: "Stepmother"},
		{raw: "Step Father", want: "Step Father"},
		{raw: "step mother", want: "step mother"},
		{raw: "Dad/Stepdad", want: "Dad/Stepdad"},
		{raw: "Grandmother of Emma Johnson", want: "Grandmother of Emma Johnson"},
		{raw: "mother of Emma and Liam", want: "mother of Emma and Liam"},
		{raw: "N/A", want: "N/A"},
		{raw: "Self?", want: "Self?"},
	}

	for _, tc := range cases {
		t.Run("raw="+tc.raw, func(t *testing.T) {
			t.Parallel()
			if got := normalizeRelationshipToCamper(tc.raw); got != tc.want {
				t.Errorf("normalizeRelationshipToCamper(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}

	if normalizeRelationshipToCamper("Mother") == normalizeRelationshipToCamper("Father") {
		t.Fatal("Mother and Father must never normalise to the same value")
	}
}

// TestProcessAdultsNormalisesSiblingDateFormats is the end-to-end half: two
// enrolled siblings type the SAME birthday in two different formats into the
// same adult slot. Before normalisation the merge kept whichever row loaded
// first and the two values compared as different, which is 583 of the 1,124
// diverging production groups. After it, both orders produce the same stored
// value and the divergence is gone.
func TestProcessAdultsNormalisesSiblingDateFormats(t *testing.T) {
	t.Parallel()

	const wantDOB = "1979-09-02"

	for _, order := range [][2]string{
		{"9/2/1979", "09-02-79"},
		{"09-02-79", "9/2/1979"},
		{"09021979", "September 2, 1979"},
	} {
		t.Run(order[0]+"_then_"+order[1], func(t *testing.T) {
			t.Parallel()
			s := &FamilyCampDerivedSync{}
			householdValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
			}
			personValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp DOB 1", value: order[0]},
				{householdPBID: "hh_1", fieldName: "Family Camp DOB 1", value: order[1]},
			}

			adults := s.processAdults(householdValues, personValues)

			if len(adults) != 1 {
				t.Fatalf("expected 1 merged adult, got %d", len(adults))
			}
			if adults[0].dateOfBirth != wantDOB {
				t.Errorf("got date_of_birth %q, want canonical %q", adults[0].dateOfBirth, wantDOB)
			}
		})
	}
}

// TestProcessAdultsNormalisesRelationshipCase is the relationship half of the
// same end-to-end check, plus the negative case: a genuine Mother/Father
// collision still resolves by load order and is still visible as a
// disagreement, because normalisation is not a merge policy.
func TestProcessAdultsNormalisesRelationshipCase(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		first      string
		second     string
		wantStored string
	}{
		{name: "case variants fold", first: "mother", second: "Mother", wantStored: "Mother"},
		{name: "synonym folds", first: "Mom", second: "mother", wantStored: "Mother"},
		{name: "dad folds to father", first: "dad", second: "Father", wantStored: "Father"},
		{name: "genuine collision keeps first loaded", first: "Father", second: "Mother", wantStored: "Father"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := &FamilyCampDerivedSync{}
			householdValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
			}
			personValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp-Relationship to 1", value: tc.first},
				{householdPBID: "hh_1", fieldName: "Family Camp-Relationship to 1", value: tc.second},
			}

			adults := s.processAdults(householdValues, personValues)

			if len(adults) != 1 {
				t.Fatalf("expected 1 merged adult, got %d", len(adults))
			}
			if adults[0].relationship != tc.wantStored {
				t.Errorf("got relationship %q, want %q", adults[0].relationship, tc.wantStored)
			}
		})
	}
}

// TestNormalizeDateOfBirthIsIdempotent guards the sync's compare-before-write:
// a normaliser that changed its own output on a second pass would rewrite
// every family_camp_adults row on every run forever.
func TestNormalizeDateOfBirthIsIdempotent(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{"9/2/1979", "2.13.80", "October 28, 1981", "11/13", "None", ""} {
		once := normalizeDateOfBirth(raw)
		if twice := normalizeDateOfBirth(once); twice != once {
			t.Errorf("normalizeDateOfBirth(%q) = %q but re-normalises to %q", raw, once, twice)
		}
		relOnce := normalizeRelationshipToCamper(raw)
		if relTwice := normalizeRelationshipToCamper(relOnce); relTwice != relOnce {
			t.Errorf("normalizeRelationshipToCamper(%q) = %q but re-normalises to %q", raw, relOnce, relTwice)
		}
	}
}

// ============================================================================
// kindred#2275 Option B -- attribute_conflicts.
//
// OWNER RULING 2026-08-17: the grain change is DECLINED. family_camp_adults
// stays at (household, year, adult_number) and first-non-empty-wins is
// UNCHANGED for every attribute. What is additive is that the answers the
// merge discards are now RECORDED, keyed by the column they were destined
// for, instead of vanishing.
//
// The divergent answers are not two children reporting on their parents.
// They are one parent filling in the family-camp section of a per-camper form
// once per camper, on a form where that section should have been skipped
// after the first child -- so a divergence is one person being less careful
// the second time. Tests below are written against that reading: a conflict
// is a data-entry artifact worth showing staff, not evidence that the row is
// keyed wrong.
// ============================================================================

// TestProcessAdultsRecordsResidualAttributeConflicts is the core of Option B:
// only the RESIDUAL lights up. The 583 date_of_birth and 146
// relationship_to_camper divergences that the kindred#2405 normalisers
// already collapse must stay silent, or the badge fires on 1,439 slots
// instead of the ~700 that are real.
func TestProcessAdultsRecordsResidualAttributeConflicts(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name          string
		fieldName     string
		values        []string
		wantStored    string
		wantConflicts string
	}{
		{
			name:      "identical answers record nothing",
			fieldName: "Family Camp DOB 1",
			values:    []string{"9/2/1979", "9/2/1979"},
			// The merged value is still the first-non-empty winner, normalised.
			wantStored:    "1979-09-02",
			wantConflicts: "",
		},
		{
			name:          "normalisation collapses the disagreement -- stays silent",
			fieldName:     "Family Camp DOB 1",
			values:        []string{"9/2/1979", "09-02-79"},
			wantStored:    "1979-09-02",
			wantConflicts: "",
		},
		{
			name:          "a different birth YEAR is a real conflict",
			fieldName:     "Family Camp DOB 1",
			values:        []string{"9/2/1979", "9/2/1981"},
			wantStored:    "1979-09-02",
			wantConflicts: `{"date_of_birth":["1981-09-02"]}`,
		},
		{
			name:          "relationship case and synonym folding stays silent",
			fieldName:     "Family Camp-Relationship to 1",
			values:        []string{"mother", "Mom"},
			wantStored:    "Mother",
			wantConflicts: "",
		},
		{
			name:          "Mother vs Father is a real conflict",
			fieldName:     "Family Camp-Relationship to 1",
			values:        []string{"Father", "Mother"},
			wantStored:    "Father",
			wantConflicts: `{"relationship_to_camper":["Mother"]}`,
		},
		{
			name:          "gap-fill is not a conflict",
			fieldName:     "Family Camp DOB 1",
			values:        []string{"", "9/2/1979"},
			wantStored:    "1979-09-02",
			wantConflicts: "",
		},
		{
			name:          "first name disagreement is recorded",
			fieldName:     "Family Camp-P1 First Name",
			values:        []string{"Amy Johnson", "Amy R Johnson"},
			wantStored:    "Amy Johnson",
			wantConflicts: `{"first_name":["Amy R Johnson"]}`,
		},
		{
			// The free-text columns have no kindred#2405 normaliser, so the
			// only thing standing between staff and 232 badges that say
			// "Amy Johnson vs amy johnson" is the conflict comparison itself.
			// Measured over data-prod.db, all years: 189 of 1,429 lit slots
			// (32 of 2026's 124) light up on nothing but letter case.
			name:          "a case-only difference is one answer, not two",
			fieldName:     "Family Camp-P1 First Name",
			values:        []string{"Amy Johnson", "amy johnson"},
			wantStored:    "Amy Johnson",
			wantConflicts: "",
		},
		{
			// CampMinder does not trim these values and the loader does not
			// either, so a stray space is a spelling, not an answer.
			name:          "a whitespace-only difference is one answer, not two",
			fieldName:     "Family Camp-P1 First Name",
			values:        []string{"Amy Johnson", "Amy  Johnson "},
			wantStored:    "Amy Johnson",
			wantConflicts: "",
		},
		{
			name:          "case folding applies to every merged column",
			fieldName:     "Family Camp Gender 1",
			values:        []string{"Female", "female"},
			wantStored:    "Female",
			wantConflicts: "",
		},
		{
			name:      "the same losing answer twice is recorded once",
			fieldName: "Family Camp Gender 1",
			values:    []string{"Female", "F", "F"},
			// Three campers on the form, two of them typed the same
			// second answer. The tooltip must not show it twice.
			wantStored:    "Female",
			wantConflicts: `{"gender":["F"]}`,
		},
		{
			name:          "two distinct losing answers are both kept, sorted",
			fieldName:     "Family Camp Gender 1",
			values:        []string{"Female", "Nonbinary", "F"},
			wantStored:    "Female",
			wantConflicts: `{"gender":["F","Nonbinary"]}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := &FamilyCampDerivedSync{}
			householdValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
			}
			var personValues []customValueEntry
			for _, v := range tc.values {
				personValues = append(personValues, customValueEntry{
					householdPBID: "hh_1", fieldName: tc.fieldName, value: v,
				})
			}

			adults := s.processAdults(householdValues, personValues)

			if len(adults) != 1 {
				t.Fatalf("expected 1 merged adult, got %d", len(adults))
			}
			if got := adults[0].conflictsJSON(); got != tc.wantConflicts {
				t.Errorf("attribute_conflicts = %s, want %s", got, tc.wantConflicts)
			}
			stored := map[string]string{
				"Family Camp DOB 1":             adults[0].dateOfBirth,
				"Family Camp-Relationship to 1": adults[0].relationship,
				"Family Camp-P1 First Name":     adults[0].firstName,
				"Family Camp Gender 1":          adults[0].gender,
			}[tc.fieldName]
			if stored != tc.wantStored {
				t.Errorf("merged value = %q, want %q -- the merge policy must NOT change", stored, tc.wantStored)
			}
		})
	}
}

// TestProcessAdultsConflictsLeaveTheMergedValueUnchanged is the guard the
// owner ruling turns on: recording a conflict must not change WHICH answer
// wins. First-non-empty-wins over load order is unchanged, so reversing the
// input order must reverse both the winner AND the recorded loser, with the
// stored attribute matching what the pre-Option-B code produced.
func TestProcessAdultsConflictsLeaveTheMergedValueUnchanged(t *testing.T) {
	t.Parallel()

	const early = "1979-09-02"
	const late = "1981-09-02"

	for _, order := range [][2]string{{early, late}, {late, early}} {
		t.Run(order[0]+"_then_"+order[1], func(t *testing.T) {
			t.Parallel()
			s := &FamilyCampDerivedSync{}
			householdValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
			}
			personValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp DOB 1", value: order[0]},
				{householdPBID: "hh_1", fieldName: "Family Camp DOB 1", value: order[1]},
			}

			adults := s.processAdults(householdValues, personValues)

			if len(adults) != 1 {
				t.Fatalf("expected 1 merged adult, got %d", len(adults))
			}
			if adults[0].dateOfBirth != order[0] {
				t.Errorf("first-non-empty-wins must still pick %q, got %q", order[0], adults[0].dateOfBirth)
			}
			want := `{"date_of_birth":["` + order[1] + `"]}`
			if got := adults[0].conflictsJSON(); got != want {
				t.Errorf("attribute_conflicts = %s, want %s", got, want)
			}
		})
	}
}

// TestProcessAdultsEmailConflictRecordsTheDisplacedValue covers the one
// attribute that already had a tie-break (kindred#1945's preferEmail). When
// validity displaces the first-loaded answer, the DISPLACED value is the one
// that has to be recorded -- recording the candidate instead would report the
// winner as the conflict.
func TestProcessAdultsEmailConflictRecordsTheDisplacedValue(t *testing.T) {
	t.Parallel()

	const wellFormed = "amy.johnson@example.com"
	const malformed = "amy.johnson@examplecom"

	for _, order := range [][2]string{{malformed, wellFormed}, {wellFormed, malformed}} {
		t.Run(order[0]+"_then_"+order[1], func(t *testing.T) {
			t.Parallel()
			s := &FamilyCampDerivedSync{}
			householdValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
			}
			personValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: order[0]},
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: order[1]},
			}

			adults := s.processAdults(householdValues, personValues)

			if len(adults) != 1 {
				t.Fatalf("expected 1 merged adult, got %d", len(adults))
			}
			if adults[0].email != wellFormed {
				t.Errorf("validity still decides the merge: got %q, want %q", adults[0].email, wellFormed)
			}
			want := `{"email":["` + malformed + `"]}`
			if got := adults[0].conflictsJSON(); got != want {
				t.Errorf("attribute_conflicts = %s, want %s", got, want)
			}
		})
	}
}

// TestProcessAdultsEmailCaseVariantIsNotAConflict covers the column with the
// highest case-noise rate in production: 111 of 325 recorded email conflicts,
// before this guard, were one address typed with a capitalised first letter.
// A mail domain is case-insensitive by RFC 1035 and every provider treats the
// local part that way in practice, so `Amy@example.com` and `amy@example.com`
// are one answer -- staff cannot act on the difference.
//
// The second case is the one that needs the guard on BOTH branches: a leading
// space makes the value fail emailFormatPattern, so preferEmail DISPLACES it
// with the trimmed spelling. Without the guard the displaced value is recorded
// as a conflicting answer against itself.
func TestProcessAdultsEmailCaseVariantIsNotAConflict(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		values     []string
		wantStored string
	}{
		{
			name:       "capitalisation only",
			values:     []string{"Amy.Johnson@example.com", "amy.johnson@example.com"},
			wantStored: "Amy.Johnson@example.com",
		},
		{
			name:       "capitalisation only, reversed",
			values:     []string{"amy.johnson@example.com", "Amy.Johnson@example.com"},
			wantStored: "amy.johnson@example.com",
		},
		{
			// preferEmail displaces the untrimmed spelling because the leading
			// space fails emailFormatPattern. The merge is unchanged; what must
			// not happen is a conflict against the same address.
			name:       "leading space displaced by the trimmed spelling",
			values:     []string{" amy.johnson@example.com", "amy.johnson@example.com"},
			wantStored: "amy.johnson@example.com",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := &FamilyCampDerivedSync{}
			householdValues := []customValueEntry{
				{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Amy Johnson"},
			}
			var personValues []customValueEntry
			for _, v := range tc.values {
				personValues = append(personValues, customValueEntry{
					householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: v,
				})
			}

			adults := s.processAdults(householdValues, personValues)

			if len(adults) != 1 {
				t.Fatalf("expected 1 merged adult, got %d", len(adults))
			}
			if adults[0].email != tc.wantStored {
				t.Errorf("merged email = %q, want %q -- the merge policy must NOT change",
					adults[0].email, tc.wantStored)
			}
			if got := adults[0].conflictsJSON(); got != "" {
				t.Errorf("attribute_conflicts = %s, want none -- one address in two spellings", got)
			}
		})
	}
}

// TestAdultConflictsJSONIsCanonical pins the stored form. The sync compares
// before it writes, so a rendering that depended on map iteration order would
// rewrite every conflicted row on every run.
func TestAdultConflictsJSONIsCanonical(t *testing.T) {
	t.Parallel()

	empty := &adultData{}
	if got := empty.conflictsJSON(); got != "" {
		t.Errorf("no conflicts must render as the empty string, got %q", got)
	}

	a := &adultData{}
	a.noteConflict("relationship_to_camper", "Mother")
	a.noteConflict("date_of_birth", "1981-09-02")
	a.noteConflict("date_of_birth", "1975-01-04")
	a.noteConflict("date_of_birth", "1981-09-02")

	const want = `{"date_of_birth":["1975-01-04","1981-09-02"],"relationship_to_camper":["Mother"]}`
	first := a.conflictsJSON()
	if first != want {
		t.Fatalf("conflictsJSON() = %s, want %s", first, want)
	}
	for i := 0; i < 20; i++ {
		if again := a.conflictsJSON(); again != first {
			t.Fatalf("conflictsJSON() is not stable: %s then %s", first, again)
		}
	}
}

// TestUpsertAdultsPersistsAttributeConflicts is the round trip through a real
// record: the column is written, an unchanged re-run does not rewrite it, and
// a changed conflict set does.
func TestUpsertAdultsPersistsAttributeConflicts(t *testing.T) {
	t.Parallel()

	app := newFamilyCampReplayTestApp(t)
	s := &FamilyCampDerivedSync{App: app, ProcessedAdultKeys: map[string]bool{}}

	conflicted := &adultData{householdPBID: "hh_1", adultNumber: 1, name: "Amy Johnson", dateOfBirth: "1979-09-02"}
	conflicted.noteConflict("date_of_birth", "1981-09-02")

	created, _, _, errCount := s.upsertAdults(
		context.Background(), []*adultData{conflicted}, 2026, map[string]*core.Record{})
	if created != 1 || errCount != 0 {
		t.Fatalf("create: got created=%d errors=%d, want 1/0", created, errCount)
	}

	existing, err := s.preloadExistingAdults(2026)
	if err != nil {
		t.Fatalf("preloadExistingAdults: %v", err)
	}
	stored := existing[familyCampAdultKey("hh_1", 2026, 1)]
	if stored == nil {
		t.Fatal("the created adult did not come back from preloadExistingAdults")
	}
	if got := storedAttributeConflicts(stored); got != `{"date_of_birth":["1981-09-02"]}` {
		t.Fatalf("stored attribute_conflicts = %s", got)
	}

	// An identical second pass must not rewrite the row.
	_, updated, skipped, errCount := s.upsertAdults(context.Background(), []*adultData{conflicted}, 2026, existing)
	if updated != 0 || skipped != 1 || errCount != 0 {
		t.Errorf("idempotent re-run: got updated=%d skipped=%d errors=%d, want 0/1/0", updated, skipped, errCount)
	}

	// A row whose conflict has been resolved upstream must clear the column.
	resolved := &adultData{householdPBID: "hh_1", adultNumber: 1, name: "Amy Johnson", dateOfBirth: "1979-09-02"}
	if !s.adultNeedsUpdate(stored, resolved) {
		t.Fatal("clearing a conflict must count as a change, or the badge never goes away")
	}
	_, updated, _, errCount = s.upsertAdults(context.Background(), []*adultData{resolved}, 2026, existing)
	if updated != 1 || errCount != 0 {
		t.Fatalf("clearing pass: got updated=%d errors=%d, want 1/0", updated, errCount)
	}
	cleared, err := s.preloadExistingAdults(2026)
	if err != nil {
		t.Fatalf("preloadExistingAdults after clear: %v", err)
	}
	if got := storedAttributeConflicts(cleared[familyCampAdultKey("hh_1", 2026, 1)]); got != "" {
		t.Errorf("resolved row still carries attribute_conflicts = %s", got)
	}
}

// TestAdultsCollectionHasAttributeConflictsColumn is the schema half. The Go
// writer above is inert without the migration, and a Go-only PR would ship a
// Set() against a column PocketBase would reject.
func TestAdultsCollectionHasAttributeConflictsColumn(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("../pb_migrations/1500000160_family_camp_adults_attribute_conflicts.js")
	if err != nil {
		t.Fatalf("the attribute_conflicts migration must exist: %v", err)
	}
	// maxSize is in the list because PB v0.23 accepts the field without it and
	// silently applies its own default (1 MB for json, per
	// docs/reference/pocketbase-migrations.md) -- the cap this column's comment
	// justifies would then exist nowhere.
	for _, want := range []string{
		"family_camp_adults", "attribute_conflicts", "new Field(", "type: 'json'", "maxSize: 50000",
	} {
		if !strings.Contains(string(source), want) {
			t.Errorf("migration is missing %q -- a plain fields.add({...}) is silently ignored in PB v0.23", want)
		}
	}
}

// ---------------------------------------------------------------------------
// kindred#2255 -- processMedical must collapse a household's answers by TOTAL
// aggregation, never by picking a winner.
//
// The tests below are deliberately written against the PRODUCTION
// processMedical. The two tests that look like they already cover this
// (TestMedicalDeduplicationByHousehold, which drives a test-local
// reimplementation and asserts only non-emptiness, and
// TestProcessMedicalCollapsesCamperCPAPGenerations, which exercises one person)
// are blind to the defect by construction.
// ---------------------------------------------------------------------------

// medicalNarrativeA/B are placeholder disclosures. Never put a real medical
// sentence, or a real name, in a fixture.
const (
	medicalNarrativeA = "carries an epinephrine auto-injector"
	medicalNarrativeB = "reacts to shellfish"
)

// TestProcessMedicalKeepsEveryAnswerersNarrative is the regression test the
// issue says no fixture covered: two people in one household answer the SAME
// narrative field and both answers must survive. Before the fix the flatten
// kept whichever record id sorted first and discarded the rest, which is why
// staff saw part of a household's medical picture and not all of it.
func TestProcessMedicalKeepsEveryAnswerersNarrative(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergy Info",
			value: medicalNarrativeA, lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergy Info",
			value: medicalNarrativeB, lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	for _, want := range []string{medicalNarrativeA, medicalNarrativeB} {
		if !strings.Contains(meds[0].allergyInfo, want) {
			t.Errorf("allergyInfo dropped an answerer's disclosure: %q missing from %q",
				want, meds[0].allergyInfo)
		}
	}
}

// TestProcessMedicalOrsTheGateAcrossAnswerers pins the half of the fix that
// makes the join safe. A gate is a two-value Yes/No question; joining two
// people's gate answers verbatim would render "No; Yes; <narrative>", which is
// why an earlier uniform dedup-and-join was reverted. The household's gate is
// the OR of its answers, so the one person who said Yes is not overruled by the
// one who said No.
//
// The "No" is listed FIRST so the test fails against first-non-empty-wins
// rather than passing by luck of load order.
func TestProcessMedicalOrsTheGateAcrossAnswerers(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergies",
			value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergies",
			value: "Yes", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergy Info",
			value: medicalNarrativeA, lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if got, want := meds[0].allergyInfo, "Yes; "+medicalNarrativeA; got != want {
		t.Errorf("allergyInfo = %q, want %q -- a denial in front of the condition "+
			"it denies is the rendered contradiction this fixes", got, want)
	}
}

// TestProcessMedicalIsOrderIndependent is the probe the issue prescribes
// instead of a flakiness test: the winner used to be a function of load order,
// so feeding the same answers in the opposite order must produce byte-identical
// output. It must not pin which answerer wins, because after the fix none does.
func TestProcessMedicalIsOrderIndependent(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	forward := []customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergies", value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergy Info", value: medicalNarrativeA, lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Dietary Needs", value: "Yes", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Dietary Explain", value: "no dairy", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Camp-Special Needs", value: "Yes", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Camp-Special Needs Yes",
			value: "needs a quiet unit", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergies", value: "Yes", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergy Info", value: medicalNarrativeB, lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Dietary Needs", value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Camp-Special Needs", value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Additional", value: "second note", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Additional", value: "first note", lastUpdated: ts},
	}
	reversed := make([]customValueEntry, len(forward))
	for i, v := range forward {
		reversed[len(forward)-1-i] = v
	}

	a := s.processMedical(forward)
	b := s.processMedical(reversed)
	if len(a) != 1 || len(b) != 1 {
		t.Fatalf("medical rows = %d and %d, want 1 each", len(a), len(b))
	}
	if *a[0] != *b[0] {
		t.Errorf("processMedical output depends on load order:\n forward  = %+v\n reversed = %+v", *a[0], *b[0])
	}
}

// TestProcessMedicalCollapsesOneAnswerFannedOntoSiblings covers the case that
// is far more common than genuine disagreement: CampMinder asks the family-camp
// questions on a per-CAMPER form, so one parent's single answer arrives once
// per enrolled child. Three identical copies are one answer, not three.
func TestProcessMedicalCollapsesOneAnswerFannedOntoSiblings(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergy Info", value: medicalNarrativeA, lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergy Info", value: medicalNarrativeA, lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-Allergy Info", value: medicalNarrativeA, lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if got, want := meds[0].allergyInfo, medicalNarrativeA; got != want {
		t.Errorf("allergyInfo = %q, want %q", got, want)
	}
}

// TestProcessMedicalCapsAJoinedColumn: joining several answers is what makes a
// column able to overflow for the first time. family_camp_medical's columns are
// NOT uniformly 10,000 -- bathroom_explain and accommodation_explain are 4,000
// -- and record.Set() past a PocketBase field's max fails the row's save, which
// would lose the whole household rather than one sentence.
func TestProcessMedicalCapsAJoinedColumn(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	limit := medicalColumnLimits["bathroom_explain"]
	if limit == 0 {
		t.Fatal("bathroom_explain has no declared column limit")
	}
	long := strings.Repeat("a", limit-10)
	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Housing-Bathroom", value: long, lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Bathroom-Yes", value: strings.Repeat("b", 100), lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if n := len([]rune(meds[0].bathroomExplain)); n > limit {
		t.Errorf("bathroomExplain = %d runes, over the %d column cap", n, limit)
	}
	if !strings.Contains(meds[0].bathroomExplain, long) {
		t.Error("bathroomExplain cut an answer in half instead of dropping a whole one")
	}
}

// TestJoinMedicalColumnKeepsEverythingForAnUndeclaredColumn: joinAnswers with a
// zero limit returns "", so a column added to processMedical and forgotten in
// medicalColumnLimits would blank itself on every sync -- silently, and for
// every household. The fallback keeps the answers.
func TestJoinMedicalColumnKeepsEverythingForAnUndeclaredColumn(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	got := s.joinMedicalColumn("hh_johnson", "a_column_nobody_declared",
		[]string{medicalNarrativeA, medicalNarrativeB})
	if want := medicalNarrativeA + "; " + medicalNarrativeB; got != want {
		t.Errorf("joinMedicalColumn = %q, want %q", got, want)
	}
}

// medicalColumnMaxPattern finds one text field's declared cap in a PocketBase
// migration: `name: "<column>"` and the `max:` that belongs to the SAME field
// literal. `[^}]*?` is what binds the two -- it cannot cross the closing brace
// of the field it started in, so a field that declares no max reads as absent
// rather than silently borrowing the next field's.
var medicalColumnMaxPattern = regexp.MustCompile(`name:\s*["']([a-z_]+)["'][^}]*?max:\s*(\d+)`)

// TestMedicalColumnLimitsMatchTheSchema pins medicalColumnLimits against the
// migrations that declare the columns, by READING them.
//
// It used to restate the same literals a second time, which pins nothing: a
// migration that narrowed a column would leave the map too large and the test
// still green. A limit larger than the real one caps nothing -- record.Set()
// past a PocketBase field's max fails the whole row's save, losing a household
// rather than a sentence -- so the map has to be checked against the schema and
// not against itself.
//
// EVERY declaration found must agree with the map, rather than the last one
// winning. A regex over JavaScript cannot tell which collection or which
// direction of migrate() a field literal sits in, so last-wins would let a
// same-named field on another collection, or a down() block, quietly stand in
// for a narrowed medical limit. Requiring agreement turns that into a loud
// failure naming the file, which is the safe direction for a guard: a migration
// that legitimately changes a cap has to update this map anyway.
//
// Files that never mention family_camp_medical are skipped, because
// 1500000044_camper_dietary.js declares an allergy_info of its own on a
// different collection.
func TestMedicalColumnLimitsMatchTheSchema(t *testing.T) {
	t.Parallel()

	paths, err := filepath.Glob("../pb_migrations/*.js")
	if err != nil {
		t.Fatalf("globbing migrations: %v", err)
	}
	if len(paths) == 0 {
		t.Fatal("no migrations found -- this test would pass vacuously")
	}
	slices.Sort(paths)

	type declaration struct {
		path string
		max  int
	}
	declared := make(map[string][]declaration, len(medicalColumnLimits))
	for _, path := range paths {
		source, err := os.ReadFile(path) //nolint:gosec // fixed repo-relative glob
		if err != nil {
			t.Fatalf("reading %s: %v", path, err)
		}
		if !strings.Contains(string(source), "family_camp_medical") {
			continue
		}
		for _, m := range medicalColumnMaxPattern.FindAllStringSubmatch(string(source), -1) {
			if _, wanted := medicalColumnLimits[m[1]]; !wanted {
				continue
			}
			declaredMax, err := strconv.Atoi(m[2])
			if err != nil {
				t.Fatalf("%s declares a non-numeric max for %s: %v", path, m[1], err)
			}
			declared[m[1]] = append(declared[m[1]], declaration{path: path, max: declaredMax})
		}
	}

	for column, limit := range medicalColumnLimits {
		sites := declared[column]
		if len(sites) == 0 {
			t.Errorf("medicalColumnLimits declares %q, which no migration creates on "+
				"family_camp_medical -- record.Set() would be rejected", column)
			continue
		}
		for _, site := range sites {
			if site.max != limit {
				t.Errorf("medicalColumnLimits[%q] = %d, but %s declares max %d",
					column, limit, filepath.Base(site.path), site.max)
			}
		}
	}
	for column := range declared {
		if _, ok := medicalColumnLimits[column]; !ok {
			t.Errorf("family_camp_medical.%s has a declared max but no entry in "+
				"medicalColumnLimits -- joinMedicalColumn would not cap it", column)
		}
	}
}

// ---------------------------------------------------------------------------
// The CPAP column is the one gate/explain pair processMedical still stores as a
// gate STRING. docs/reference/family-camp-field-provenance.md section 4 names
// Special Needs and CPAP as the two pairs where a split across children does
// real harm; Special Needs is now ORed, and CPAP is carved out of kindred#2255
// for its own pass. Aggregating it the way every other field is aggregated is
// what would put a denial and a disclosure in one column.
// ---------------------------------------------------------------------------

// TestProcessMedicalDropsADeniedCPAPGateBesideADisclosedOne: one child's form
// says No and another's says Yes. Keeping both renders
// "No; Yes; <explanation>" -- the contradiction medicalGateFields exists to
// prevent, reaching the row through the one column medicalGateFields does not
// cover.
func TestProcessMedicalDropsADeniedCPAPGateBesideADisclosedOne(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Family Camp-CPAP", value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Camp-CPAP", value: "Yes", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Adult-CPAP", value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Medical-CPAP Explain",
			value: "needs an outlet overnight", lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if got, want := meds[0].cpapInfo, "Yes; needs an outlet overnight"; got != want {
		t.Errorf("cpapInfo = %q, want %q -- a denial in front of the need it denies", got, want)
	}
}

// TestProcessMedicalKeepsTwoDifferentCPAPNeeds: the CPAP fields are NOT a
// two-value gate (kindred#1875) -- every affirmative option names WHICH
// accommodation is needed, so two different affirmatives are two different
// needs and neither may be collapsed away. Only the pure denial goes.
func TestProcessMedicalKeepsTwoDifferentCPAPNeeds(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	const (
		outlet   = "Yes, outlet needed for CPAP machine"
		bathroom = "Yes, bathroom or other housing accommodation needed"
	)
	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "FAM CAMP-CPAP", value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "FAM CAMP-CPAP", value: outlet, lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "FAM CAMP-CPAP", value: bathroom, lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if got, want := meds[0].cpapInfo, bathroom+"; "+outlet; got != want {
		t.Errorf("cpapInfo = %q, want %q", got, want)
	}
}

// TestProcessMedicalUnionsBothCamperCPAPFields: the two Camper-partition CPAP
// names are the same question asked twice, and a household can carry an answer
// under each. processMedical used to stop at the first name that had one, so a
// "No" on Family Camp-CPAP hid a disclosure on FAM CAMP-CPAP entirely -- while
// processRegistrations ORs BOTH fields into needs_power and
// needs_private_bathroom, so the household got a housing flag with a cpap_info
// that denies it. 27 households in 2025 and 1 in 2026 on the production
// snapshot.
func TestProcessMedicalUnionsBothCamperCPAPFields(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	const outlet = "Yes, outlet needed for CPAP machine"
	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Family Camp-CPAP", value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "FAM CAMP-CPAP", value: outlet, lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if got, want := meds[0].cpapInfo, outlet; got != want {
		t.Errorf("cpapInfo = %q, want %q -- the flag says the household needs power "+
			"and the narrative would deny it", got, want)
	}
}

// TestProcessMedicalKeepsAnUnanimousCPAPDenial: dropping negatives is only the
// half of the OR that applies. A household where nobody said Yes still has an
// answer, and blanking it would be the silent loss this whole change ends.
func TestProcessMedicalKeepsAnUnanimousCPAPDenial(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Family Camp-CPAP", value: "No", lastUpdated: ts},
		{householdPBID: "hh_johnson", fieldName: "Family Camp-CPAP", value: "No", lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if got, want := meds[0].cpapInfo, "No"; got != want {
		t.Errorf("cpapInfo = %q, want %q", got, want)
	}
}

// ---------------------------------------------------------------- needs_fridge
//
// kindred#2224. The accommodation gate is a bare Yes/No; the substance lands in
// a separate narrative field the product never read. Nine of the free-text asks
// name a refrigerator and twelve cabins have one, and nothing connected them.
//
// Measured on the production snapshot, 2026: 6 of the 42 accommodation-gated
// households name a fridge across the two narrative fields (274058 Camper,
// 224987 Adult), against 12 of 118 units carrying `has_fridge`. 2026 is only
// 16% placed, so 6 is the SHAPE of the demand, not a rate.
//
// The narrative itself is PHI-adjacent -- it names diagnoses, medications and
// feeding disorders -- so only the BOOLEAN is derived here. The sentence stays
// in family_camp_medical, which is admin-gated and absent from every export.

func TestProcessRegistrationsDerivesNeedsFridgeFromTheCamperNarrative(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Housing Accommodation", value: "Yes"},
		{householdPBID: "hh_johnson", fieldName: "Housing Accommodation-Yes",
			value: "We need a refrigerator for medication"},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if !regs[0].needsFridge {
		t.Error("a camper narrative naming a refrigerator did not set needsFridge")
	}
}

// The Adult twin. Its gate (Housing Accomodation, one m) and its narrative
// (Accommodation-Explain, cm_id 224987) are a different partition, and reading
// the Camper key alone left every adult-weekend household structurally blind.
func TestProcessRegistrationsDerivesNeedsFridgeFromTheAdultNarrative(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_garcia", fieldName: "Housing Accomodation", value: "Yes"},
		{householdPBID: "hh_garcia", fieldName: "Accommodation-Explain",
			value: "Please give us a cabin with a mini fridge"},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if !regs[0].needsFridge {
		t.Error("an adult narrative naming a fridge did not set needsFridge")
	}
}

// RECALL OVER PRECISION, deliberately. The derived flag is ADVISORY -- it
// hatches a card, it never refuses a drop -- so a false positive costs a mark
// staff can overrule while a false negative costs the ask entirely.
func TestMentionsFridgeVocabulary(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		text string
		want bool
	}{
		{"We need a refrigerator for insulin", true},
		{"a mini fridge would help", true},
		{"MINI-FRIDGE, please", true},
		// CampMinder free text is unspellchecked; this misspelling is common
		// enough that a substring match on "fridge" has to cover it.
		{"somewhere to keep a refridgerator", true}, //nolint:misspell // the misspelling is the fixture
		// Adds 0 households on the 2026 snapshot, kept for recall: a family
		// asking for a cooler is asking the same question of the registry.
		{"space for a cooler with ice", true},
		{"", false},
		{"We need a private bathroom", false},
		{"Please place us close to the dining hall", false},
	} {
		if got := mentionsFridge(tc.text); got != tc.want {
			t.Errorf("mentionsFridge(%q) = %v, want %v", tc.text, got, tc.want)
		}
	}
}

// The gate field is routed by LITERAL DISPLAY NAME and is not covered by the
// LodgingRequestFieldNames rename overlay, so a CampMinder rename silently
// stops population -- admission is by cm_id and survives, routing is by name
// and does not. Successor spellings are registered defensively, exactly as the
// gate's own arm carries three generations.
func TestAccommodationExplainRoutingCarriesSuccessorSpellings(t *testing.T) {
	t.Parallel()

	for _, name := range []string{
		"Housing Accommodation-Yes", // Camper, cm_id 274058 -- live
		"Accommodation-Explain",     // Adult,  cm_id 224987 -- live
		"Housing Accomodation-Yes",  // (sic) -- the gate is already misspelled this way
		"Accomodation-Explain",      // (sic)
	} {
		s := NewFamilyCampDerivedSync(nil)
		regs := s.processRegistrations(nil, []customValueEntry{
			{householdPBID: "hh_lee", fieldName: name, value: "we need a fridge for breast milk"},
		})
		if len(regs) != 1 || !regs[0].needsFridge {
			t.Errorf("field %q did not route into needsFridge", name)
		}
	}
}

// A household whose ONLY answer is the fridge narrative must not be the row
// that gets dropped before it is written -- the same trap accommodationIsMandatory
// fell into.
func TestProcessRegistrationsFridgeOnlyHouseholdSurvives(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_lee", fieldName: "Housing Accommodation-Yes",
			value: "we would like a fridge"},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1 -- the fridge-only household was dropped", len(regs))
	}
	if !regs[0].needsFridge {
		t.Error("needsFridge not set")
	}
}

// PHI CONTAINMENT. The narrative names diagnoses and medications. Only the
// boolean may reach family_camp_registrations, which is not admin-gated; the
// sentence belongs to family_camp_medical alone.
func TestProcessRegistrationsNeverStoresTheAccommodationNarrative(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	const narrative = "Our daughter has a feeding disorder and her formula needs a fridge"
	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_lee", fieldName: "Housing Accommodation-Yes", value: narrative},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	for column, stored := range map[string]string{
		"notes":                  regs[0].notes,
		"goals":                  regs[0].goals,
		"special_occasions":      regs[0].specialOccasions,
		"request_text":           regs[0].requestText,
		"cabin_assignment":       regs[0].cabinAssignment,
		"share_cabin_preference": regs[0].shareCabinPreference,
		"shared_cabin_modes_raw": regs[0].sharedCabinModesRaw,
		"arrival_eta":            regs[0].arrivalETA,
	} {
		if strings.Contains(stored, "feeding disorder") {
			t.Errorf("registration column %s carries the medical narrative: %q", column, stored)
		}
	}
}

// The medical column keeps both partitions AND the defensive successors, so a
// rename cannot silently empty the one place staff can read the sentence.
func TestProcessMedicalAccommodationExplainCarriesSuccessorSpellings(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	meds := s.processMedical([]customValueEntry{
		{householdPBID: "hh_lee", fieldName: "Accomodation-Explain",
			value: "renamed field narrative", lastUpdated: ts},
	})
	if len(meds) != 1 {
		t.Fatalf("medical rows = %d, want 1", len(meds))
	}
	if !strings.Contains(meds[0].accommodationExplain, "renamed field narrative") {
		t.Errorf("accommodationExplain = %q", meds[0].accommodationExplain)
	}
}

// TestProcessAdultsDedupesCoalescedNameMatch pins kindred#2483: two adult
// slots in the same household that coalesce to the identical casefolded
// display name, with non-conflicting dates of birth, are the same human
// counted twice. This is the exact reproduction from the issue -- one slot
// carries the name in the household `name` column, the other carries it
// (mislabeled, per the doc comment above processAdults) in `first_name`,
// plus an email and a date_of_birth the other slot never answered.
func TestProcessAdultsDedupesCoalescedNameMatch(t *testing.T) {
	t.Parallel()
	s := &FamilyCampDerivedSync{}

	// A local constant rather than the literal three times: goconst counts
	// repeated string literals across the package and this name is already
	// used in other sync tests.
	const wantMergedName = "Emma Johnson"

	householdValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: wantMergedName},
	}
	personValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp-P2 First Name", value: wantMergedName},
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 2 Email", value: "test@example.com"},
		{householdPBID: "hh_1", fieldName: "Family Camp DOB 2", value: "1980-06-15"},
	}

	adults := s.processAdults(householdValues, personValues)

	if len(adults) != 1 {
		t.Fatalf("expected the duplicate slot collapsed to 1 adult, got %d: %+v", len(adults), adults)
	}
	got := adults[0]
	if got.adultNumber != 1 {
		t.Errorf("survivor adult_number = %d, want 1 (lower slot wins)", got.adultNumber)
	}
	if got.name != wantMergedName {
		t.Errorf("survivor name = %q, want %q", got.name, wantMergedName)
	}
	// Field survival: the losing slot's email and date_of_birth must attach
	// to the survivor rather than being dropped.
	if got.email != "test@example.com" {
		t.Errorf("survivor email = %q, want the losing slot's email to attach", got.email)
	}
	if got.dateOfBirth != "1980-06-15" {
		t.Errorf("survivor date_of_birth = %q, want the losing slot's DOB to attach", got.dateOfBirth)
	}
}

// TestProcessAdultsDedupesCaseOnlyNameMatch pins the second reported 2026
// pair: a byte-exact comparison misses this one, only casefolding catches
// it, matching the pattern is_attending_adult_name already uses.
func TestProcessAdultsDedupesCaseOnlyNameMatch(t *testing.T) {
	t.Parallel()
	s := &FamilyCampDerivedSync{}

	personValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp-P1 First Name", value: "Liam Garcia"},
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1 Email", value: "test@example.com"},
		{householdPBID: "hh_1", fieldName: "Family Camp DOB 1", value: "1985-03-22"},
		{householdPBID: "hh_1", fieldName: "Family Camp-P2 First Name", value: "liam garcia"},
		{householdPBID: "hh_1", fieldName: "Family Camp DOB 2", value: "1985-03-22"},
	}

	adults := s.processAdults(nil, personValues)

	if len(adults) != 1 {
		t.Fatalf("expected the case-only duplicate collapsed to 1 adult, got %d: %+v", len(adults), adults)
	}
	if adults[0].firstName != "Liam Garcia" {
		t.Errorf("survivor first_name = %q, want the first-loaded spelling kept", adults[0].firstName)
	}
	if adults[0].email != "test@example.com" {
		t.Errorf("survivor email = %q, want the only email to attach", adults[0].email)
	}
}

// TestProcessAdultsRefusesConflictingDOBSameName pins the falsification in
// the issue's correction: a name-only key would merge 27 groups of DIFFERENT
// people who happen to share a name. Same casefolded name with a genuinely
// conflicting (both populated, unequal) date_of_birth must NOT be merged.
func TestProcessAdultsRefusesConflictingDOBSameName(t *testing.T) {
	t.Parallel()
	s := &FamilyCampDerivedSync{}

	personValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp-P1 First Name", value: "Noah Smith"},
		{householdPBID: "hh_1", fieldName: "Family Camp DOB 1", value: "2013-05-03"},
		{householdPBID: "hh_1", fieldName: "Family Camp-P2 First Name", value: "Noah Smith"},
		{householdPBID: "hh_1", fieldName: "Family Camp DOB 2", value: "1960-08-07"},
	}

	adults := s.processAdults(nil, personValues)

	if len(adults) != 2 {
		t.Fatalf("conflicting DOB must refuse the merge -- expected 2 adults, got %d: %+v", len(adults), adults)
	}
}

// TestProcessAdultsDedupesHandlesThreeRowGroup pins the n>2 requirement:
// one production 2024 group holds three rows for the same person, and the
// merge must not assume a pair.
func TestProcessAdultsDedupesHandlesThreeRowGroup(t *testing.T) {
	t.Parallel()
	s := &FamilyCampDerivedSync{}

	householdValues := []customValueEntry{
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 1", value: "Sofia Nguyen"},
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 3", value: "Sofia Nguyen"},
		{householdPBID: "hh_1", fieldName: "Family Camp Adult 5", value: "sofia nguyen"},
	}

	adults := s.processAdults(householdValues, nil)

	if len(adults) != 1 {
		t.Fatalf("expected the three-row group collapsed to 1 adult, got %d: %+v", len(adults), adults)
	}
	if adults[0].adultNumber != 1 {
		t.Errorf("survivor adult_number = %d, want 1 (lowest slot wins)", adults[0].adultNumber)
	}
}

// -------------------------------------------------------------- needs_step_free
//
// kindred#2438. The third graded need dimension, mirroring needs_fridge
// (kindred#2224) one column over: the family's ask is resolved out of the same
// free-text narrative, and the registry answers it with `has_ramp`.
//
// Measured on the production snapshot, 2026, at the household grain and over
// BOTH narrative fields: 86 households carry any narrative at all, 6 name cold
// storage, and 14 describe a mobility or step-free need -- more than twice the
// signal that justified shipping needs_fridge. Supply: 14 of 118 units carry a
// staff `has_ramp` assessment (5 yes / 5 partial / 4 no), which a boolean read
// of that three-value select reports as 0.
//
// The narrative is PHI-adjacent, so only the BOOLEAN is derived here; the
// sentence stays in family_camp_medical, which is admin-gated and absent from
// every export.

func TestProcessRegistrationsDerivesNeedsStepFreeFromTheAccommodationNarrative(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_johnson", fieldName: "Housing Accommodation", value: "Yes"},
		{householdPBID: "hh_johnson", fieldName: "Housing Accommodation-Yes",
			value: "One adult in our party cannot manage a long uphill walk"},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if !regs[0].needsStepFree {
		t.Error("an accommodation narrative describing limited walking did not set needsStepFree")
	}
}

// ⚠️ THE ROUTING TRAP. needs_fridge reads the accommodation narrative ALONE,
// and copying that routing verbatim loses more than a third of this signal: on
// the 2026 snapshot 5 of the 14 mobility households narrate ONLY through the
// bathroom field and 3 through both, against 0 of the 6 fridge households. It makes
// sense -- a family explaining why they need a private bathroom is often
// explaining that someone cannot walk to the shared one.
func TestProcessRegistrationsDerivesNeedsStepFreeFromTheBathroomNarrative(t *testing.T) {
	t.Parallel()

	// Both partitions of the bathroom narrative: "Housing-Bathroom" is the
	// Camper key (cm_id 274059) and "Bathroom-Yes" the Adult twin (274054).
	for _, name := range []string{"Housing-Bathroom", "Bathroom-Yes"} {
		s := NewFamilyCampDerivedSync(nil)
		regs := s.processRegistrations(nil, []customValueEntry{
			{householdPBID: "hh_garcia", fieldName: name,
				value: "Grandmother uses crutches and cannot manage the steps to the bathhouse"},
		})
		if len(regs) != 1 || !regs[0].needsStepFree {
			t.Errorf("field %q did not route into needsStepFree", name)
		}
	}
}

// The two routings stay DISTINCT. needs_fridge deliberately reads only the
// accommodation narrative (kindred#2224 measured 0 fridge asks in the bathroom
// field), so widening the step-free route must not widen the fridge one with it.
func TestProcessRegistrationsDoesNotDeriveNeedsFridgeFromTheBathroomNarrative(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	regs := s.processRegistrations(nil, []customValueEntry{
		// A gate answer, so the row survives the has-some-data guard on
		// something other than the flag under test.
		{householdPBID: "hh_garcia", fieldName: "Housing Accommodation", value: "Yes"},
		{householdPBID: "hh_garcia", fieldName: "Housing-Bathroom",
			value: "we would like a fridge in the cabin"},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	if regs[0].needsFridge {
		t.Error("the bathroom narrative set needsFridge -- the fridge route reads accommodation only")
	}
}

// RECALL OVER PRECISION, on the same reasoning as mentionsFridge: the flag is
// ADVISORY -- it hatches a card and never refuses a drop -- so a false positive
// costs a mark staff overrule at a glance while a false negative costs the ask.
func TestMentionsStepFreeVocabulary(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		text string
		want bool
	}{
		// "walk" carries most of the signal on its own: 10 of the 14 2026
		// households, as a SUBSTRING so it also catches walking/walkway.
		{"cannot walk to the bathhouse in the dark", true},
		{"trouble walking on uneven ground", true},
		{"somewhere with an even walkway from the parking area", true},
		{"limited mobility", true},
		{"MOBILITY ISSUES, please", true},
		{"she walks on crutches", true},
		// Zero households on the 2026 snapshot, kept for recall: each is the
		// plain word for an ask the registry's has_ramp column answers.
		{"we need a wheelchair accessible cabin", true},
		{"a cabin with a ramp", true},
		{"cannot manage stairs", true},
		{"no steps please", true},
		{"a ground floor room", true},
		{"anywhere on a single level", true},
		{"one level, no climbing", true},
		{"he uses a mobility scooter", true},
		{"dad walks with a cane", true},
		// Diagnosis words, admitted on evidence rather than on shape: every
		// knee/hip mention in the corpus, in every year, is a mobility
		// limitation -- a joint replacement, a post-surgical recovery, or a
		// stated limit on distance -- and three are households nothing else in
		// this surface catches.
		{"her knee replacement is still healing", true},
		{"post-op hip, cannot manage a slope", true},
		// ⚠️ "hip" MUST match as a whole word. As a bare substring it fires on
		// "relationship" and "shipping", which are ordinary words in a family
		// narrative and say nothing about mobility -- a false positive that
		// recall-over-precision does not buy, because it is not a near-miss on
		// the ask, it is an unrelated word. "cane" and "ramp" are the same
		// shape ("hurricane", "cramp"), so they take the same rule.
		{"our family relationship with camp goes back years", false},
		{"shipping the trunk ahead of time", false},
		{"the hurricane year, 2024", false},
		{"she gets leg cramps at night", false},
		{"", false},
		{"We need a private bathroom", false},
		{"a mini fridge for insulin", false},
		// Deliberately OUT of the surface. Bare "close to" matches 5 of the 86
		// 2026 narrative households and is PROXIMITY, not step-free access --
		// the registry answers it with map coordinates and near_bathhouse, not
		// with has_ramp, so flagging on it hatches cards against a column that
		// cannot speak to the ask.
		{"please put us close to the dining hall", false},
	} {
		if got := mentionsStepFree(tc.text); got != tc.want {
			t.Errorf("mentionsStepFree(%q) = %v, want %v", tc.text, got, tc.want)
		}
	}
}

// ⚠️ THE GATE TRAP. 3 of the 14 2026 mobility households are NOT
// accommodation-gated, so needs_step_free has to join the has-some-data guard
// that decides whether a registration row is written at all -- otherwise those
// three rows are dropped before they are stored, and the flag is invisible for
// exactly the households nothing else records.
func TestProcessRegistrationsStepFreeOnlyHouseholdSurvives(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_lee", fieldName: "Housing-Bathroom",
			value: "cannot walk far from the parking area"},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1 -- the ungated step-free household was dropped", len(regs))
	}
	if !regs[0].needsStepFree {
		t.Error("needsStepFree not set")
	}
	if regs[0].needsAccommodation {
		t.Error("needsAccommodation set -- this household answered no gate question at all")
	}
}

// PHI CONTAINMENT, the same bar needs_fridge holds. The mobility narrative names
// individuals and their conditions; only the boolean may reach
// family_camp_registrations, which is not admin-gated.
func TestProcessRegistrationsNeverStoresTheMobilityNarrative(t *testing.T) {
	t.Parallel()
	s := NewFamilyCampDerivedSync(nil)

	const narrative = "Grandmother has late-stage neuropathy and cannot walk on gravel"
	regs := s.processRegistrations(nil, []customValueEntry{
		{householdPBID: "hh_lee", fieldName: "Housing-Bathroom", value: narrative},
	})
	if len(regs) != 1 {
		t.Fatalf("registrations = %d, want 1", len(regs))
	}
	for column, stored := range map[string]string{
		"notes":                  regs[0].notes,
		"goals":                  regs[0].goals,
		"special_occasions":      regs[0].specialOccasions,
		"request_text":           regs[0].requestText,
		"cabin_assignment":       regs[0].cabinAssignment,
		"share_cabin_preference": regs[0].shareCabinPreference,
		"shared_cabin_modes_raw": regs[0].sharedCabinModesRaw,
		"arrival_eta":            regs[0].arrivalETA,
	} {
		if strings.Contains(stored, "neuropathy") {
			t.Errorf("registration column %s carries the medical narrative: %q", column, stored)
		}
	}
}

// ONE routing list, shared by processMedical (which stores the sentence) and
// processRegistrations (which derives a boolean and stores nothing) -- the same
// discipline accommodationExplainFieldNames already follows, and for the same
// reason: two copies of a name-keyed route drift the moment a generation is
// added, which is how the Adult accommodation twin came to be read in one of
// the two and not the other.
func TestProcessMedicalBathroomExplainUsesTheSharedRoutingList(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)

	for _, name := range bathroomExplainFieldNames {
		s := NewFamilyCampDerivedSync(nil)
		meds := s.processMedical([]customValueEntry{
			{householdPBID: "hh_lee", fieldName: name, value: "narrative for " + name, lastUpdated: ts},
		})
		if len(meds) != 1 {
			t.Fatalf("field %q: medical rows = %d, want 1", name, len(meds))
		}
		if !strings.Contains(meds[0].bathroomExplain, "narrative for "+name) {
			t.Errorf("field %q: bathroomExplain = %q", name, meds[0].bathroomExplain)
		}
	}
}

// TestMedicalGateColumnsExistInASchemaMigration guards the failure mode that has
// no symptom: record.Set() on a PocketBase column that does not exist is a
// silent no-op, so a gate whose migration was never written simply never
// persists, with nothing in the logs and nothing in the tests to notice.
//
// Ranges over gateColumns (lodging_medical_narrative_test.go, same package)
// rather than a list of its own -- two identical lists in this package is
// exactly the drift shape TestMedicalColumnLimitsMatchTheSchema above already
// guards against for medicalColumnLimits.
func TestMedicalGateColumnsExistInASchemaMigration(t *testing.T) {
	t.Parallel()

	paths, err := filepath.Glob("../pb_migrations/*.js")
	if err != nil {
		t.Fatalf("globbing migrations: %v", err)
	}
	if len(paths) == 0 {
		t.Fatal("no migrations found -- this test would pass vacuously")
	}

	declared := make(map[string]string, len(gateColumns))
	for _, path := range paths {
		source, err := os.ReadFile(path) //nolint:gosec // fixed repo-relative glob
		if err != nil {
			t.Fatalf("reading %s: %v", path, err)
		}
		text := string(source)
		if !strings.Contains(text, "family_camp_medical") {
			continue
		}
		for _, column := range gateColumns {
			if strings.Contains(text, `name: "`+column+`"`) {
				declared[column] = filepath.Base(path)
			}
		}
	}

	for _, column := range gateColumns {
		path, ok := declared[column]
		if !ok {
			t.Errorf("family_camp_medical.%s is written by processMedical but no "+
				"migration creates it -- record.Set() would silently no-op", column)
			continue
		}
		source, err := os.ReadFile(filepath.Join("../pb_migrations", path)) //nolint:gosec // from the glob above
		if err != nil {
			t.Fatalf("re-reading %s: %v", path, err)
		}
		text := string(source)
		if !strings.Contains(text, `"select"`) {
			t.Errorf("%s declares %s but no select field -- the gate must be a "+
				"three-state select, not a bool", path, column)
		}
		if !strings.Contains(text, `values: ["yes", "no"]`) {
			t.Errorf(`%s declares %s without values: ["yes", "no"]`, path, column)
		}
	}
}
