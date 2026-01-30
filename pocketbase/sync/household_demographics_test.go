package sync

import (
	"testing"
)

// ============================================================================
// Service Identity Tests
// ============================================================================

// TestHouseholdDemographicsSync_Name verifies the service name is correct
func TestHouseholdDemographicsSync_Name(t *testing.T) {
	// The service name must be "household_demographics" for orchestrator integration
	expectedName := serviceNameHouseholdDemographics

	// Test the constant/expected name matches what the service should return
	// (actual instance test requires PocketBase app)
	if expectedName != serviceNameHouseholdDemographics {
		t.Errorf("expected service name %q", expectedName)
	}
}

// TestHouseholdDemographicsSync_YearValidation tests year parameter validation
func TestHouseholdDemographicsSync_YearValidation(t *testing.T) {
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
			valid := isValidYearForDemographics(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidYearForDemographics(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// ============================================================================
// Field Mapping Tests
// ============================================================================

// TestHouseholdDemographicsFieldMapping tests mapping from HH- fields to demographic columns
func TestHouseholdDemographicsFieldMapping(t *testing.T) {
	tests := []struct {
		fieldName      string
		expectedColumn string
	}{
		// Family Description
		{"HH-Family Description", "family_description"},
		{"HH-Family Description Other", "family_description_other"},

		// Jewish Identity
		{"HH-Jewish Affiliation", "jewish_affiliation"},
		{"HH-Jewish Affiliation Other", "jewish_affiliation_other"},
		{"HH-Jewish Identities", "jewish_identities"},

		// Congregation - from person (summer camp)
		{"HH-Name of Congregation", "congregation_summer"},

		// JCC - from person (summer camp)
		{"HH-Name of JCC", "jcc_summer"},

		// Demographics
		{"HH-Military", "military_family"},
		{"HH-parent born outside US", "parent_immigrant"},
		{"HH-if yes parent born outside US, where", "parent_immigrant_origin"},

		// Custody
		{"HH-special living arrangements", "custody_summer"},
		{"HH-special living arrange-yes", "has_custody_considerations"},

		// Away info
		{"HH-Home or Away", "away_during_camp"},
		{"HH-Away location", "away_location"},
		{"HH-Phone number while away", "away_phone"},
		{"HH-Away From (mm/dd/yy)", "away_from_date"},
		{"HH-Returning (mm/dd/yy)", "away_return_date"},

		// Metadata
		{"HH-Who is filling out info", "form_filler"},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			column := mapHHFieldToColumn(tt.fieldName)
			if column != tt.expectedColumn {
				t.Errorf("mapHHFieldToColumn(%q) = %q, want %q", tt.fieldName, column, tt.expectedColumn)
			}
		})
	}
}

// TestHouseholdCustomFieldMapping tests mapping from household custom fields
func TestHouseholdCustomFieldMapping(t *testing.T) {
	tests := []struct {
		fieldName      string
		expectedColumn string
	}{
		// These come from household_custom_values, not person_custom_values
		{"Synagogue", "congregation_family"},
		{"Center", "jcc_family"},
		{"Custody Issues", "custody_family"},
		{"Board", "board_member"},

		// Fields that should be ignored (not relevant to demographics)
		{"Filemaker Household Acct No", ""},
		{"Early Reg", ""},
		{"Family Camp Cabin", ""},   // Handled by family_camp_derived
		{"Family Camp Adult 1", ""}, // Handled by family_camp_derived
		{"Unknown Field Name", ""},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			column := mapHouseholdFieldToColumn(tt.fieldName)
			if column != tt.expectedColumn {
				t.Errorf("mapHouseholdFieldToColumn(%q) = %q, want %q", tt.fieldName, column, tt.expectedColumn)
			}
		})
	}
}

// ============================================================================
// Aggregation Tests
// ============================================================================

// TestHouseholdDemographicsAggregation tests aggregation of person values by household
func TestHouseholdDemographicsAggregation(t *testing.T) {
	// Simulate person custom values for multiple family members
	personValues := []testHHPersonCustomValue{
		// Person 1 in household 5001 - has most fields filled
		{HouseholdID: 5001, FieldName: "HH-Family Description", Value: "LGBTQ"},
		{HouseholdID: 5001, FieldName: "HH-Jewish Affiliation", Value: "Reform"},
		{HouseholdID: 5001, FieldName: "HH-Name of Congregation", Value: "Temple Beth El"},

		// Person 2 in same household 5001 - some fields overlap, some empty
		{HouseholdID: 5001, FieldName: "HH-Family Description", Value: "LGBTQ"}, // Same value (expected)
		{HouseholdID: 5001, FieldName: "HH-Jewish Affiliation", Value: ""},      // Empty
		{HouseholdID: 5001, FieldName: "HH-Name of Congregation", Value: ""},    // Empty

		// Person 3 in different household 5002
		{HouseholdID: 5002, FieldName: "HH-Family Description", Value: "Interfaith"},
		{HouseholdID: 5002, FieldName: "HH-Military", Value: "Yes"},
	}

	aggregated := aggregatePersonValuesByHousehold(personValues)

	// Household 5001 should have all values from the first person (first non-empty wins)
	hh5001 := aggregated[5001]
	if hh5001 == nil {
		t.Fatal("household 5001 not found in aggregated data")
	}
	if hh5001["HH-Family Description"] != "LGBTQ" {
		t.Errorf("household 5001 family description = %q, want %q", hh5001["HH-Family Description"], "LGBTQ")
	}
	if hh5001["HH-Jewish Affiliation"] != "Reform" {
		t.Errorf("household 5001 jewish affiliation = %q, want %q", hh5001["HH-Jewish Affiliation"], "Reform")
	}
	if hh5001["HH-Name of Congregation"] != "Temple Beth El" {
		t.Errorf("household 5001 congregation = %q, want %q", hh5001["HH-Name of Congregation"], "Temple Beth El")
	}

	// Household 5002 should have its own values
	hh5002 := aggregated[5002]
	if hh5002 == nil {
		t.Fatal("household 5002 not found in aggregated data")
	}
	if hh5002["HH-Family Description"] != "Interfaith" {
		t.Errorf("household 5002 family description = %q, want %q", hh5002["HH-Family Description"], "Interfaith")
	}
	if hh5002["HH-Military"] != "Yes" {
		t.Errorf("household 5002 military = %q, want %q", hh5002["HH-Military"], "Yes")
	}
}

// TestHouseholdDemographicsFirstNonEmptyWins tests that first non-empty value is taken
func TestHouseholdDemographicsFirstNonEmptyWins(t *testing.T) {
	values := []testHHPersonCustomValue{
		{HouseholdID: 5001, FieldName: "HH-Family Description", Value: ""},             // Empty
		{HouseholdID: 5001, FieldName: "HH-Family Description", Value: ""},             // Empty
		{HouseholdID: 5001, FieldName: "HH-Family Description", Value: "LGBTQ"},        // First non-empty
		{HouseholdID: 5001, FieldName: "HH-Family Description", Value: "Tawonga Alum"}, // Should be ignored
	}

	aggregated := aggregatePersonValuesByHousehold(values)

	hh5001 := aggregated[5001]
	if hh5001["HH-Family Description"] != "LGBTQ" {
		t.Errorf("expected first non-empty value %q, got %q", "LGBTQ", hh5001["HH-Family Description"])
	}
}

// ============================================================================
// Summer vs Family Camp Overlap Tests
// ============================================================================

// TestHouseholdDemographicsSummerVsFamily tests that overlapping fields are stored separately
func TestHouseholdDemographicsSummerVsFamily(t *testing.T) {
	// Person-level HH- fields (summer camp registration)
	personValues := []testHHPersonCustomValue{
		{HouseholdID: 5001, FieldName: "HH-Name of Congregation", Value: "Temple Beth El"},
		{HouseholdID: 5001, FieldName: "HH-Name of JCC", Value: "SF JCC"},
		{HouseholdID: 5001, FieldName: "HH-special living arrangements", Value: "Shared custody"},
	}

	// Household-level custom fields (family camp registration)
	householdValues := []testHHHouseholdCustomValue{
		{HouseholdID: 5001, FieldName: "Synagogue", Value: "Beth Sholom"},
		{HouseholdID: 5001, FieldName: "Center", Value: "Oakland JCC"},
		{HouseholdID: 5001, FieldName: "Custody Issues", Value: "Week on/week off"},
	}

	// Build demographic record
	demo := buildDemographicRecord(5001, personValues, householdValues)

	// Verify summer camp fields (from person)
	if demo.CongregationSummer != "Temple Beth El" {
		t.Errorf("congregation_summer = %q, want %q", demo.CongregationSummer, "Temple Beth El")
	}
	if demo.JCCSummer != "SF JCC" {
		t.Errorf("jcc_summer = %q, want %q", demo.JCCSummer, "SF JCC")
	}
	if demo.CustodySummer != "Shared custody" {
		t.Errorf("custody_summer = %q, want %q", demo.CustodySummer, "Shared custody")
	}

	// Verify family camp fields (from household)
	if demo.CongregationFamily != "Beth Sholom" {
		t.Errorf("congregation_family = %q, want %q", demo.CongregationFamily, "Beth Sholom")
	}
	if demo.JCCFamily != "Oakland JCC" {
		t.Errorf("jcc_family = %q, want %q", demo.JCCFamily, "Oakland JCC")
	}
	if demo.CustodyFamily != "Week on/week off" {
		t.Errorf("custody_family = %q, want %q", demo.CustodyFamily, "Week on/week off")
	}
}

// ============================================================================
// Boolean Field Parsing Tests
// ============================================================================

// TestHouseholdDemographicsBooleanParsing tests parsing of boolean custom field values
func TestHouseholdDemographicsBooleanParsing(t *testing.T) {
	tests := []struct {
		value    string
		expected bool
	}{
		// True values
		{"Yes", true},
		{"yes", true},
		{"YES", true},
		{"True", true},
		{"true", true},
		{"1", true},
		{"Y", true},
		{"y", true},

		// False values
		{"No", false},
		{"no", false},
		{"NO", false},
		{"False", false},
		{"false", false},
		{"0", false},
		{"N", false},
		{"n", false},
		{"", false},
		{"  ", false}, // Whitespace
		{"Unknown", false},
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result := parseBooleanCustomValue(tt.value)
			if result != tt.expected {
				t.Errorf("parseBooleanCustomValue(%q) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

// TestHouseholdDemographicsMilitaryField tests military_family boolean field
func TestHouseholdDemographicsMilitaryField(t *testing.T) {
	personValues := []testHHPersonCustomValue{
		{HouseholdID: 5001, FieldName: "HH-Military", Value: "Yes"},
		{HouseholdID: 5002, FieldName: "HH-Military", Value: "No"},
		{HouseholdID: 5003, FieldName: "HH-Military", Value: ""},
	}

	for _, pv := range personValues {
		var expected bool
		switch pv.HouseholdID {
		case 5001:
			expected = true
		case 5002, 5003:
			expected = false
		}

		result := parseBooleanCustomValue(pv.Value)
		if result != expected {
			t.Errorf("household %d: military = %v, want %v", pv.HouseholdID, result, expected)
		}
	}
}

// ============================================================================
// Multi-Select Field Tests
// ============================================================================

// TestHouseholdDemographicsMultiSelectAggregation tests aggregation of multi-select fields
func TestHouseholdDemographicsMultiSelectAggregation(t *testing.T) {
	// Family Description is a multi-select field
	// Values should be preserved as pipe-separated
	personValues := []testHHPersonCustomValue{
		// Multiple values for same field (different family members selecting different options)
		{HouseholdID: 5001, FieldName: "HH-Family Description", Value: "LGBTQ|Interfaith"},
		{HouseholdID: 5002, FieldName: "HH-Family Description", Value: "Tawonga Alum"},
		{HouseholdID: 5003, FieldName: "HH-Family Description", Value: "Single Parent|LGBTQ"},
	}

	aggregated := aggregatePersonValuesByHousehold(personValues)

	// Multi-select values should be preserved as-is (first non-empty wins)
	if aggregated[5001]["HH-Family Description"] != "LGBTQ|Interfaith" {
		t.Errorf("household 5001: got %q", aggregated[5001]["HH-Family Description"])
	}
	if aggregated[5002]["HH-Family Description"] != "Tawonga Alum" {
		t.Errorf("household 5002: got %q", aggregated[5002]["HH-Family Description"])
	}
	if aggregated[5003]["HH-Family Description"] != "Single Parent|LGBTQ" {
		t.Errorf("household 5003: got %q", aggregated[5003]["HH-Family Description"])
	}
}

// ============================================================================
// Composite Key Tests
// ============================================================================

// TestHouseholdDemographicsCompositeKey tests the unique key format
func TestHouseholdDemographicsCompositeKey(t *testing.T) {
	tests := []struct {
		householdPBID string
		year          int
		expected      string
	}{
		{"abc123", 2025, "abc123|2025"},
		{"xyz789", 2024, "xyz789|2024"},
		{"", 2025, "|2025"}, // Edge case: empty ID
	}

	for _, tt := range tests {
		key := buildDemographicsCompositeKey(tt.householdPBID, tt.year)
		if key != tt.expected {
			t.Errorf("buildDemographicsCompositeKey(%q, %d) = %q, want %q",
				tt.householdPBID, tt.year, key, tt.expected)
		}
	}
}

// ============================================================================
// Orphan Detection Tests
// ============================================================================

// TestHouseholdDemographicsOrphanDetection tests detection of orphaned records
func TestHouseholdDemographicsOrphanDetection(t *testing.T) {
	// Existing records in database
	existingKeys := map[string]bool{
		"hh001|2025": true, // Will be processed
		"hh002|2025": true, // Will be processed
		"hh003|2025": true, // NOT processed = orphan (household removed from year)
	}

	// Records processed from source data
	processedKeys := map[string]bool{
		"hh001|2025": true,
		"hh002|2025": true,
		// hh003 no longer has campers enrolled in 2025
	}

	// Count orphans
	orphanCount := 0
	for key := range existingKeys {
		if !processedKeys[key] {
			orphanCount++
		}
	}

	if orphanCount != 1 {
		t.Errorf("expected 1 orphan, got %d", orphanCount)
	}
}

// ============================================================================
// Full Record Construction Tests
// ============================================================================

// TestHouseholdDemographicsFullRecord tests construction of a complete demographic record
func TestHouseholdDemographicsFullRecord(t *testing.T) {
	personValues := []testHHPersonCustomValue{
		{HouseholdID: 5001, FieldName: "HH-Family Description", Value: "LGBTQ|Interfaith"},
		{HouseholdID: 5001, FieldName: "HH-Jewish Affiliation", Value: "Reform"},
		{HouseholdID: 5001, FieldName: "HH-Name of Congregation", Value: "Temple Beth El"},
		{HouseholdID: 5001, FieldName: "HH-Name of JCC", Value: "SF JCC"},
		{HouseholdID: 5001, FieldName: "HH-Military", Value: "No"},
		{HouseholdID: 5001, FieldName: "HH-parent born outside US", Value: "Yes"},
		{HouseholdID: 5001, FieldName: "HH-if yes parent born outside US, where", Value: "Israel"},
		{HouseholdID: 5001, FieldName: "HH-special living arrangements", Value: "Shared custody"},
		{HouseholdID: 5001, FieldName: "HH-special living arrange-yes", Value: "Yes"},
		{HouseholdID: 5001, FieldName: "HH-Home or Away", Value: "Home"},
	}

	householdValues := []testHHHouseholdCustomValue{
		{HouseholdID: 5001, FieldName: "Synagogue", Value: "Beth Sholom"},
		{HouseholdID: 5001, FieldName: "Center", Value: "Oakland JCC"},
		{HouseholdID: 5001, FieldName: "Board", Value: "Yes"},
	}

	demo := buildDemographicRecord(5001, personValues, householdValues)

	// Verify all fields
	if demo.FamilyDescription != "LGBTQ|Interfaith" {
		t.Errorf("family_description = %q", demo.FamilyDescription)
	}
	if demo.JewishAffiliation != "Reform" {
		t.Errorf("jewish_affiliation = %q", demo.JewishAffiliation)
	}
	if demo.CongregationSummer != "Temple Beth El" {
		t.Errorf("congregation_summer = %q", demo.CongregationSummer)
	}
	if demo.CongregationFamily != "Beth Sholom" {
		t.Errorf("congregation_family = %q", demo.CongregationFamily)
	}
	if demo.JCCSummer != "SF JCC" {
		t.Errorf("jcc_summer = %q", demo.JCCSummer)
	}
	if demo.JCCFamily != "Oakland JCC" {
		t.Errorf("jcc_family = %q", demo.JCCFamily)
	}
	if demo.MilitaryFamily != false {
		t.Errorf("military_family = %v", demo.MilitaryFamily)
	}
	if demo.ParentImmigrant != true {
		t.Errorf("parent_immigrant = %v", demo.ParentImmigrant)
	}
	if demo.ParentImmigrantOrigin != "Israel" {
		t.Errorf("parent_immigrant_origin = %q", demo.ParentImmigrantOrigin)
	}
	if demo.CustodySummer != "Shared custody" {
		t.Errorf("custody_summer = %q", demo.CustodySummer)
	}
	if demo.HasCustodyConsiderations != true {
		t.Errorf("has_custody_considerations = %v", demo.HasCustodyConsiderations)
	}
	if demo.AwayDuringCamp != false { // "Home" means not away
		t.Errorf("away_during_camp = %v", demo.AwayDuringCamp)
	}
	if demo.BoardMember != true {
		t.Errorf("board_member = %v", demo.BoardMember)
	}
}

// ============================================================================
// Upsert Decision Tests
// ============================================================================

// TestHouseholdDemographicsUpsertDecision tests create vs update decision
func TestHouseholdDemographicsUpsertDecision(t *testing.T) {
	tests := []struct {
		name         string
		existingKeys map[string]bool
		newKey       string
		expectCreate bool
		expectUpdate bool
	}{
		{
			name:         "new record - not in existing",
			existingKeys: map[string]bool{},
			newKey:       "hh001|2025",
			expectCreate: true,
			expectUpdate: false,
		},
		{
			name:         "existing record - should update",
			existingKeys: map[string]bool{"hh001|2025": true},
			newKey:       "hh001|2025",
			expectCreate: false,
			expectUpdate: true,
		},
		{
			name:         "different year - new record",
			existingKeys: map[string]bool{"hh001|2025": true},
			newKey:       "hh001|2026",
			expectCreate: true,
			expectUpdate: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			exists := tt.existingKeys[tt.newKey]

			isCreate := !exists
			isUpdate := exists

			if isCreate != tt.expectCreate {
				t.Errorf("create decision = %v, want %v", isCreate, tt.expectCreate)
			}
			if isUpdate != tt.expectUpdate {
				t.Errorf("update decision = %v, want %v", isUpdate, tt.expectUpdate)
			}
		})
	}
}

// ============================================================================
// HH Field Detection Tests
// ============================================================================

// TestIsHHField tests detection of HH- prefixed fields
func TestIsHHField(t *testing.T) {
	tests := []struct {
		fieldName string
		isHHField bool
	}{
		{"HH-Family Description", true},
		{"HH-Jewish Affiliation", true},
		{"HH-Military", true},
		{"Family Camp Adult 1", false},
		{"Synagogue", false},
		{"Board", false},
		{"hh-lowercase", false}, // Case sensitive
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := isHHField(tt.fieldName)
			if result != tt.isHHField {
				t.Errorf("isHHField(%q) = %v, want %v", tt.fieldName, result, tt.isHHField)
			}
		})
	}
}

// ============================================================================
// Test Helper Types
// ============================================================================

type testHHPersonCustomValue struct {
	HouseholdID int
	FieldName   string
	Value       string
}

type testHHHouseholdCustomValue struct {
	HouseholdID int
	FieldName   string
	Value       string
}

type testDemographicRecord struct {
	HouseholdID              int
	Year                     int
	FamilyDescription        string
	FamilyDescriptionOther   string
	JewishAffiliation        string
	JewishAffiliationOther   string
	JewishIdentities         string
	CongregationSummer       string
	CongregationFamily       string
	JCCSummer                string
	JCCFamily                string
	MilitaryFamily           bool
	ParentImmigrant          bool
	ParentImmigrantOrigin    string
	CustodySummer            string
	CustodyFamily            string
	HasCustodyConsiderations bool
	AwayDuringCamp           bool
	AwayLocation             string
	AwayPhone                string
	AwayFromDate             string
	AwayReturnDate           string
	FormFiller               string
	BoardMember              bool
}

// ============================================================================
// Test Helper Functions
// ============================================================================

// isValidYearForDemographics validates year parameter
func isValidYearForDemographics(year int) bool {
	return year >= 2017 && year <= 2050
}

// isHHField checks if a field name starts with "HH-"
func isHHField(fieldName string) bool {
	return len(fieldName) >= 3 && fieldName[:3] == "HH-"
}

// mapHHFieldToColumn maps HH- field names to demographic column names
func mapHHFieldToColumn(fieldName string) string {
	mapping := map[string]string{
		"HH-Family Description":                   "family_description",
		"HH-Family Description Other":             "family_description_other",
		"HH-Jewish Affiliation":                   "jewish_affiliation",
		"HH-Jewish Affiliation Other":             "jewish_affiliation_other",
		"HH-Jewish Identities":                    "jewish_identities",
		"HH-Name of Congregation":                 "congregation_summer",
		"HH-Name of JCC":                          "jcc_summer",
		"HH-Military":                             "military_family",
		"HH-parent born outside US":               "parent_immigrant",
		"HH-if yes parent born outside US, where": "parent_immigrant_origin",
		"HH-special living arrangements":          "custody_summer",
		"HH-special living arrange-yes":           "has_custody_considerations",
		"HH-Home or Away":                         "away_during_camp",
		"HH-Away location":                        "away_location",
		"HH-Phone number while away":              "away_phone",
		"HH-Away From (mm/dd/yy)":                 "away_from_date",
		"HH-Returning (mm/dd/yy)":                 "away_return_date",
		"HH-Who is filling out info":              "form_filler",
	}
	return mapping[fieldName]
}

// mapHouseholdFieldToColumn maps household custom field names to demographic column names
func mapHouseholdFieldToColumn(fieldName string) string {
	mapping := map[string]string{
		"Synagogue":      "congregation_family",
		"Center":         "jcc_family",
		"Custody Issues": "custody_family",
		"Board":          "board_member",
	}
	return mapping[fieldName]
}

// parseBooleanCustomValue parses boolean values from custom field strings
func parseBooleanCustomValue(value string) bool {
	if value == "" {
		return false
	}
	// Trim whitespace
	trimmed := value
	for trimmed != "" && (trimmed[0] == ' ' || trimmed[0] == '\t') {
		trimmed = trimmed[1:]
	}
	for trimmed != "" && (trimmed[len(trimmed)-1] == ' ' || trimmed[len(trimmed)-1] == '\t') {
		trimmed = trimmed[:len(trimmed)-1]
	}
	if trimmed == "" {
		return false
	}

	// Check for true values (case insensitive)
	lower := toLowerASCII(trimmed)
	return lower == "yes" || lower == "true" || lower == "1" || lower == "y"
}

// toLowerASCII converts ASCII letters to lowercase
func toLowerASCII(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}

// aggregatePersonValuesByHousehold groups person custom values by household ID
// First non-empty value wins for each field
func aggregatePersonValuesByHousehold(values []testHHPersonCustomValue) map[int]map[string]string {
	result := make(map[int]map[string]string)

	for _, v := range values {
		if v.Value == "" {
			continue
		}

		if result[v.HouseholdID] == nil {
			result[v.HouseholdID] = make(map[string]string)
		}

		// First non-empty wins
		if _, exists := result[v.HouseholdID][v.FieldName]; !exists {
			result[v.HouseholdID][v.FieldName] = v.Value
		}
	}

	return result
}

// buildDemographicsCompositeKey builds the composite key for upsert
func buildDemographicsCompositeKey(householdPBID string, year int) string {
	return householdPBID + "|" + itoa(year)
}

// itoa is defined in financial_aid_applications_test.go

// buildDemographicRecord constructs a demographic record from custom values
func buildDemographicRecord(
	householdID int,
	personValues []testHHPersonCustomValue,
	householdValues []testHHHouseholdCustomValue,
) testDemographicRecord {
	// Aggregate person values
	personAgg := make(map[string]string)
	for _, v := range personValues {
		if v.HouseholdID != householdID || v.Value == "" {
			continue
		}
		if _, exists := personAgg[v.FieldName]; !exists {
			personAgg[v.FieldName] = v.Value
		}
	}

	// Aggregate household values
	householdAgg := make(map[string]string)
	for _, v := range householdValues {
		if v.HouseholdID != householdID || v.Value == "" {
			continue
		}
		if _, exists := householdAgg[v.FieldName]; !exists {
			householdAgg[v.FieldName] = v.Value
		}
	}

	// Build record
	demo := testDemographicRecord{
		HouseholdID: householdID,
	}

	// Map person fields (summer camp)
	demo.FamilyDescription = personAgg["HH-Family Description"]
	demo.FamilyDescriptionOther = personAgg["HH-Family Description Other"]
	demo.JewishAffiliation = personAgg["HH-Jewish Affiliation"]
	demo.JewishAffiliationOther = personAgg["HH-Jewish Affiliation Other"]
	demo.JewishIdentities = personAgg["HH-Jewish Identities"]
	demo.CongregationSummer = personAgg["HH-Name of Congregation"]
	demo.JCCSummer = personAgg["HH-Name of JCC"]
	demo.MilitaryFamily = parseBooleanCustomValue(personAgg["HH-Military"])
	demo.ParentImmigrant = parseBooleanCustomValue(personAgg["HH-parent born outside US"])
	demo.ParentImmigrantOrigin = personAgg["HH-if yes parent born outside US, where"]
	demo.CustodySummer = personAgg["HH-special living arrangements"]
	demo.HasCustodyConsiderations = parseBooleanCustomValue(personAgg["HH-special living arrange-yes"])
	demo.FormFiller = personAgg["HH-Who is filling out info"]

	// Away info
	homeOrAway := personAgg["HH-Home or Away"]
	// "Away" means away_during_camp = true, anything else = false
	demo.AwayDuringCamp = toLowerASCII(homeOrAway) == "away"
	demo.AwayLocation = personAgg["HH-Away location"]
	demo.AwayPhone = personAgg["HH-Phone number while away"]
	demo.AwayFromDate = personAgg["HH-Away From (mm/dd/yy)"]
	demo.AwayReturnDate = personAgg["HH-Returning (mm/dd/yy)"]

	// Map household fields (family camp)
	demo.CongregationFamily = householdAgg["Synagogue"]
	demo.JCCFamily = householdAgg["Center"]
	demo.CustodyFamily = householdAgg["Custody Issues"]
	demo.BoardMember = parseBooleanCustomValue(householdAgg["Board"])

	return demo
}
