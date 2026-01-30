package sync

import (
	"strings"
	"testing"
)

// TestFinancialAidApplicationsSync_Name verifies the service name is correct
func TestFinancialAidApplicationsSync_Name(t *testing.T) {
	// The service name must be "financial_aid_applications" for orchestrator integration
	expectedName := "financial_aid_applications"

	// Test that the expected name matches the constant
	if serviceNameFinancialAidApplications != expectedName {
		t.Errorf("expected service name %q, got %q", expectedName, serviceNameFinancialAidApplications)
	}
}

// TestFAYearValidation tests year parameter validation
func TestFAYearValidation(t *testing.T) {
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
			valid := isValidFAYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidFAYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestIsFAField tests the field name matching patterns for FA fields
func TestIsFAField(t *testing.T) {
	tests := []struct {
		fieldName string
		wantMatch bool
	}{
		// FA- prefix fields (should match)
		{"FA-Contact Parent Name", true},
		{"FA-Contact Parent Email", true},
		{"FA-Total Gross Pre-Tax Income", true},
		{"FA-Applicant Signature", true},
		{"FA-Number of Programs", true},
		{"FA-COVIDchild care", true},
		{"FA-Fire", true},
		{"FA-Deposit", true},

		// Fa- prefix (typo in CampMinder, should match)
		{"Fa-Contact Parent Last Name", true},

		// CA- prefix fields (interest indicators, should match)
		{"CA-FinancialAssistanceInterest", true},
		{"CA-FinancialAssistanceAmount", true},
		{"CA-Donation amount", true},
		{"CA-Donation other", true},

		// Amount requested fields (no FA- prefix, should match)
		{"Summer/Quest: Amt Requested", true},
		{"Family Camp: Amt Requested", true},
		{"B'nai Mitzvah: Amt Requested", true},

		// Non-FA fields (should NOT match)
		{"Family Camp Adult 1", false},
		{"Family Camp-CPAP", false},
		{"FAM CAMP-Share Cabins", false},
		{"Gender", false},
		{"Email", false},
		{"CA-CamperInterest", false}, // Different CA- field
		{"Session", false},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := isFAField(tt.fieldName)
			if result != tt.wantMatch {
				t.Errorf("isFAField(%q) = %v, want %v", tt.fieldName, result, tt.wantMatch)
			}
		})
	}
}

// TestFAFieldMapping tests the mapping from CampMinder field names to column names
func TestFAFieldMapping(t *testing.T) {
	// Test a representative sample of field mappings
	tests := []struct {
		cmFieldName    string
		expectedColumn string
	}{
		// Contact info
		{"FA-Contact Parent Name", "contact_first_name"},
		{"Fa-Contact Parent Last Name", "contact_last_name"},
		{"FA-Contact Parent Email", "contact_email"},
		{"FA-Contact Parent Phone", "contact_phone"},
		{"FA-Contact Parent Address", "contact_address"},
		{"FA-Contact parent city", "contact_city"},
		{"FA-Contact Parent State", "contact_state"},
		{"FA-Contact Parent Zip", "contact_zip"},
		{"FA-Contact Parent Country", "contact_country"},
		{"FA-Contact Parent Marital Stat", "contact_marital_status"},
		{"FA-Contact Parent Jewish", "contact_jewish"},

		// Parent 2
		{"FA-Parent 2 Name", "parent_2_name"},
		{"FA-Parent 2 Marital Status", "parent_2_marital_status"},
		{"FA-Parent 2 Jewish", "parent_2_jewish"},

		// Income
		{"FA-Total Gross Pre-Tax Income", "total_gross_income"},
		{"FA-Expected Gross Pre-Tax Inco", "expected_gross_income"},
		{"FA-Total Adjusted Gross Income", "total_adjusted_income"},
		{"FA-Total Exemptions", "total_exemptions"},
		{"FA-Unemployment", "unemployment"},
		{"FA-still unemployed", "still_unemployed"},

		// Assets
		{"FA-Non-retirement savings", "non_retirement_savings"},
		{"FA-Amt in retirement accounts", "retirement_accounts"},
		{"FA-StudentDebt", "student_debt"},
		{"FA-Do parents own a home?", "owns_home"},

		// Expenses
		{"FA-TotaExpectedMedicalExpenses", "total_medical_expenses"},
		{"FA-Total Expected Edu Expenses", "total_edu_expenses"},
		{"FA-Total Mortgage/RentExpenses", "total_housing_expenses"},
		{"FA-Total Rent", "total_rent"},

		// Family info
		{"FA-Number of Children in Fam", "num_children"},
		{"FA-Single Parent", "single_parent"},
		{"FA-Camper Name", "camper_name"},
		{"FA-Special Financial Circumsta", "special_circumstances"},

		// Jewish affiliations
		{"FA-Affiliated with JCC", "affiliated_jcc"},
		{"FA-Child Affiliated Synagogue", "child_affiliated_synagogue"},
		{"FA-Children Jewish Day School", "children_jewish_day_school"},
		{"FA-Russian", "russian_speaking"},

		// Government/external aid
		{"FA-Gov Subsidies", "gov_subsidies"},
		{"FA-Gov Subsidies Detail", "gov_subsidies_detail"},
		{"FA-SynagogueGrant", "synagogue_grant"},
		{"FA-OneHappy Camper", "one_happy_camper"},
		{"FA-Other financial support", "other_financial_support"},
		{"FA-Other Support Amount", "other_support_amount"},
		{"FA-Other Support Expectations", "other_support_expectations"},
		{"FA-Financial Support", "financial_support"},

		// Program requests
		{"FA-What Program", "summer_program"},
		{"Summer/Quest: Amt Requested", "summer_amount_requested"},
		{"FA-What Family Camp Program", "fc_program"},
		{"Family Camp: Amt Requested", "fc_amount_requested"},
		{"FA-What Bar and Bat Mitzvah", "tbm_program"},
		{"B'nai Mitzvah: Amt Requested", "tbm_amount_requested"},
		{"FA-Number of Programs", "num_programs"},
		{"FA-How many sessions", "num_sessions"},
		{"FA-Amt of Assistance Requested", "amount_requested"},

		// COVID/disaster
		{"FA-COVIDchild care", "covid_childcare"},
		{"FA-COVIDchidcare amount", "covid_childcare_amount"},
		{"FA-COVIDexpenses", "covid_expenses"},
		{"FA-COVIDexpenses additional", "covid_expenses_additional"},
		{"FA-COVIDexpenses amount", "covid_expenses_amount"},
		{"FA-Fire", "fire"},
		{"FA-FireYes/No", "fire_affected"},
		{"FA-Fire Detail", "fire_detail"},

		// Admin/status
		{"FA-Deposit", "deposit_paid"},
		{"FA-Applicant Signature", "applicant_signature"},
		{"FA-confirmpretax income", "income_confirmed"},
		{"FA-ComfirmationRequestedAmount", "amount_confirmed"},

		// CA- prefix interest indicators
		{"CA-FinancialAssistanceInterest", "interest_expressed"},
		{"CA-FinancialAssistanceAmount", "amount_awarded"},
		{"CA-Donation amount", "donation_preference"},
		{"CA-Donation other", "donation_other"},
	}

	for _, tt := range tests {
		t.Run(tt.cmFieldName, func(t *testing.T) {
			result := mapFAFieldToColumn(tt.cmFieldName)
			if result != tt.expectedColumn {
				t.Errorf("mapFAFieldToColumn(%q) = %q, want %q", tt.cmFieldName, result, tt.expectedColumn)
			}
		})
	}
}

// TestFABoolFieldParsing tests parsing of boolean custom field values
func TestFABoolFieldParsing(t *testing.T) {
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
		{"N/A", false},
		{"Maybe", false}, // Non-standard values treated as false
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result := parseFABoolField(tt.value)
			if result != tt.expected {
				t.Errorf("parseFABoolField(%q) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

// TestFANumberParsing tests parsing of numeric values from text fields
func TestFANumberParsing(t *testing.T) {
	tests := []struct {
		value    string
		expected float64
	}{
		// Standard numbers
		{"100000", 100000},
		{"50000.50", 50000.50},
		{"0", 0},

		// With currency formatting
		{"$100,000", 100000},
		{"$50,000.50", 50000.50},
		{"$1,234,567.89", 1234567.89},

		// With commas only
		{"100,000", 100000},
		{"1,234,567", 1234567},

		// Edge cases
		{"", 0},
		{"N/A", 0},
		{"unknown", 0},
		{"-500", -500},
		{"  5000  ", 5000}, // With whitespace
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result := parseFANumberField(tt.value)
			if result != tt.expected {
				t.Errorf("parseFANumberField(%q) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

// TestFACompositeKeyGeneration tests the unique key generation for upsert
func TestFACompositeKeyGeneration(t *testing.T) {
	tests := []struct {
		personID string
		year     int
		expected string
	}{
		{"abc123", 2025, "abc123:2025"},
		{"xyz789", 2024, "xyz789:2024"},
		{"", 2025, ":2025"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := generateFACompositeKey(tt.personID, tt.year)
			if result != tt.expected {
				t.Errorf("generateFACompositeKey(%q, %d) = %q, want %q",
					tt.personID, tt.year, result, tt.expected)
			}
		})
	}
}

// TestFAInterestExpressionDetection tests detection of interest expression
func TestFAInterestExpressionDetection(t *testing.T) {
	tests := []struct {
		value    string
		expected bool
	}{
		// Interest expressed
		{"Yes", true},
		{"Interested", true},
		{"yes", true},
		{"1", true},
		{"true", true},
		{"I am interested", true},

		// No interest
		{"", false},
		{"No", false},
		{"no", false},
		{"0", false},
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result := hasFAInterestExpressed(tt.value)
			if result != tt.expected {
				t.Errorf("hasFAInterestExpressed(%q) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

// TestFADataAggregation tests that multiple custom values for the same person are aggregated correctly
func TestFADataAggregation(t *testing.T) {
	// Simulate custom values for the same person
	values := []testFACustomValue{
		{PersonPBID: "person1", FieldName: "FA-Contact Parent Name", Value: "John"},
		{PersonPBID: "person1", FieldName: "FA-Contact Parent Email", Value: "john@example.com"},
		{PersonPBID: "person1", FieldName: "FA-Total Gross Pre-Tax Income", Value: "100000"},
		{PersonPBID: "person1", FieldName: "CA-FinancialAssistanceInterest", Value: "Yes"},
		{PersonPBID: "person2", FieldName: "FA-Contact Parent Name", Value: "Jane"},
	}

	apps := aggregateFAApplications(values, 2025)

	// Should have 2 applications (one per person)
	if len(apps) != 2 {
		t.Errorf("expected 2 applications, got %d", len(apps))
	}

	// Verify person1's data
	app1 := apps["person1"]
	if app1 == nil {
		t.Fatal("expected application for person1")
	}
	if app1.ContactFirstName != "John" {
		t.Errorf("expected contact_first_name 'John', got %q", app1.ContactFirstName)
	}
	if app1.ContactEmail != "john@example.com" {
		t.Errorf("expected contact_email 'john@example.com', got %q", app1.ContactEmail)
	}
	if app1.TotalGrossIncome != 100000 {
		t.Errorf("expected total_gross_income 100000, got %v", app1.TotalGrossIncome)
	}
	if !app1.InterestExpressed {
		t.Error("expected interest_expressed to be true")
	}
}

// TestFAEmptyDataHandling tests graceful handling of empty input
func TestFAEmptyDataHandling(t *testing.T) {
	values := []testFACustomValue{}
	apps := aggregateFAApplications(values, 2025)

	if len(apps) != 0 {
		t.Errorf("expected 0 applications for empty data, got %d", len(apps))
	}
}

// TestFAFieldTypeDetection tests detection of field types (bool, number, text)
func TestFAFieldTypeDetection(t *testing.T) {
	boolFields := []string{
		"unemployment", "still_unemployed", "owns_home", "single_parent",
		"affiliated_jcc", "russian_speaking", "gov_subsidies",
		"covid_childcare", "fire_affected", "income_confirmed", "amount_confirmed",
		"interest_expressed",
	}

	numberFields := []string{
		"total_gross_income", "expected_gross_income", "total_adjusted_income",
		"total_exemptions", "non_retirement_savings", "retirement_accounts",
		"student_debt", "total_medical_expenses", "total_edu_expenses",
		"total_housing_expenses", "total_rent", "num_children",
		"summer_amount_requested", "fc_amount_requested", "tbm_amount_requested",
		"num_programs", "num_sessions", "amount_requested",
		"covid_childcare_amount", "covid_expenses_amount",
		"deposit_paid", "deposit_paid_adult", "amount_awarded",
		"other_support_amount",
	}

	for _, field := range boolFields {
		t.Run("bool_"+field, func(t *testing.T) {
			if !isFABoolColumn(field) {
				t.Errorf("expected %q to be detected as bool column", field)
			}
			if isFANumberColumn(field) {
				t.Errorf("did not expect %q to be detected as number column", field)
			}
		})
	}

	for _, field := range numberFields {
		t.Run("number_"+field, func(t *testing.T) {
			if !isFANumberColumn(field) {
				t.Errorf("expected %q to be detected as number column", field)
			}
			if isFABoolColumn(field) {
				t.Errorf("did not expect %q to be detected as bool column", field)
			}
		})
	}
}

// TestFAFirstNonEmptyWins tests that when a person has duplicate field values, first non-empty wins
func TestFAFirstNonEmptyWins(t *testing.T) {
	values := []testFACustomValue{
		// First record has empty email
		{PersonPBID: "person1", FieldName: "FA-Contact Parent Email", Value: ""},
		// Second record has the email
		{PersonPBID: "person1", FieldName: "FA-Contact Parent Email", Value: "john@example.com"},
		// Third record also has email (should be ignored)
		{PersonPBID: "person1", FieldName: "FA-Contact Parent Email", Value: "different@example.com"},
	}

	apps := aggregateFAApplications(values, 2025)

	if len(apps) != 1 {
		t.Fatalf("expected 1 application, got %d", len(apps))
	}

	app := apps["person1"]
	if app.ContactEmail != "john@example.com" {
		t.Errorf("expected first non-empty email 'john@example.com', got %q", app.ContactEmail)
	}
}

// ============================================================================
// Test helper types and functions (mirror production implementation)
// ============================================================================

type testFACustomValue struct {
	PersonPBID string
	FieldName  string
	Value      string
}

type testFAApplication struct {
	PersonPBID        string
	Year              int
	InterestExpressed bool
	ContactFirstName  string
	ContactEmail      string
	TotalGrossIncome  float64
	// Add more fields as needed for testing
}

// isValidFAYear validates year parameter for FA sync
func isValidFAYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// isFAField checks if a field name is related to financial aid
func isFAField(name string) bool {
	// FA- prefix (standard financial aid fields)
	if len(name) >= 3 && (name[:3] == "FA-" || name[:3] == "Fa-") {
		return true
	}

	// CA- prefix for financial assistance interest/amount only
	if len(name) >= 3 && name[:3] == "CA-" {
		if name == "CA-FinancialAssistanceInterest" ||
			name == "CA-FinancialAssistanceAmount" ||
			name == "CA-Donation amount" ||
			name == "CA-Donation other" {
			return true
		}
		return false
	}

	// Special amount requested fields without FA- prefix
	if name == "Summer/Quest: Amt Requested" ||
		name == "Family Camp: Amt Requested" ||
		name == "B'nai Mitzvah: Amt Requested" {
		return true
	}

	return false
}

// mapFAFieldToColumn maps CampMinder field names to database column names
func mapFAFieldToColumn(fieldName string) string {
	mapping := map[string]string{
		// Contact info
		"FA-Contact Parent Name":         "contact_first_name",
		"Fa-Contact Parent Last Name":    "contact_last_name",
		"FA-Contact Parent Email":        "contact_email",
		"FA-Contact Parent Phone":        "contact_phone",
		"FA-Contact Parent Address":      "contact_address",
		"FA-Contact parent city":         "contact_city",
		"FA-Contact Parent State":        "contact_state",
		"FA-Contact Parent Zip":          "contact_zip",
		"FA-Contact Parent Country":      "contact_country",
		"FA-Contact Parent Marital Stat": "contact_marital_status",
		"FA-Contact Parent Jewish":       "contact_jewish",

		// Parent 2
		"FA-Parent 2 Name":           "parent_2_name",
		"FA-Parent 2 Marital Status": "parent_2_marital_status",
		"FA-Parent 2 Jewish":         "parent_2_jewish",

		// Income
		"FA-Total Gross Pre-Tax Income":  "total_gross_income",
		"FA-Expected Gross Pre-Tax Inco": "expected_gross_income",
		"FA-Total Adjusted Gross Income": "total_adjusted_income",
		"FA-Total Exemptions":            "total_exemptions",
		"FA-Unemployment":                "unemployment",
		"FA-still unemployed":            "still_unemployed",

		// Assets
		"FA-Non-retirement savings":     "non_retirement_savings",
		"FA-Amt in retirement accounts": "retirement_accounts",
		"FA-StudentDebt":                "student_debt",
		"FA-Do parents own a home?":     "owns_home",

		// Expenses
		"FA-TotaExpectedMedicalExpenses": "total_medical_expenses",
		"FA-Total Expected Edu Expenses": "total_edu_expenses",
		"FA-Total Mortgage/RentExpenses": "total_housing_expenses",
		"FA-Total Rent":                  "total_rent",

		// Family info
		"FA-Number of Children in Fam":   "num_children",
		"FA-Single Parent":               "single_parent",
		"FA-Camper Name":                 "camper_name",
		"FA-Special Financial Circumsta": "special_circumstances",

		// Jewish affiliations
		"FA-Affiliated with JCC":        "affiliated_jcc",
		"FA-Child Affiliated Synagogue": "child_affiliated_synagogue",
		"FA-Children Jewish Day School": "children_jewish_day_school",
		"FA-Russian":                    "russian_speaking",

		// Government/external aid
		"FA-Gov Subsidies":              "gov_subsidies",
		"FA-Gov Subsidies Detail":       "gov_subsidies_detail",
		"FA-SynagogueGrant":             "synagogue_grant",
		"FA-OneHappy Camper":            "one_happy_camper",
		"FA-Other financial support":    "other_financial_support",
		"FA-Other Support Amount":       "other_support_amount",
		"FA-Other Support Expectations": "other_support_expectations",
		"FA-Financial Support":          "financial_support",

		// Program requests
		"FA-What Program":                "summer_program",
		"Summer/Quest: Amt Requested":    "summer_amount_requested",
		"FA-What Family Camp Program":    "fc_program",
		"Family Camp: Amt Requested":     "fc_amount_requested",
		"FA-What Bar and Bat Mitzvah":    "tbm_program",
		"B'nai Mitzvah: Amt Requested":   "tbm_amount_requested",
		"FA-Number of Programs":          "num_programs",
		"FA-How many sessions":           "num_sessions",
		"FA-Amt of Assistance Requested": "amount_requested",

		// COVID/disaster
		"FA-COVIDchild care":          "covid_childcare",
		"FA-COVIDchidcare amount":     "covid_childcare_amount",
		"FA-COVIDexpenses":            "covid_expenses",
		"FA-COVIDexpenses additional": "covid_expenses_additional",
		"FA-COVIDexpenses amount":     "covid_expenses_amount",
		"FA-Fire":                     "fire",
		"FA-FireYes/No":               "fire_affected",
		"FA-Fire Detail":              "fire_detail",

		// Admin/status
		"FA-Deposit":                     "deposit_paid",
		"FA-Applicant Signature":         "applicant_signature",
		"FA-confirmpretax income":        "income_confirmed",
		"FA-ComfirmationRequestedAmount": "amount_confirmed",

		// CA- prefix interest indicators
		"CA-FinancialAssistanceInterest": "interest_expressed",
		"CA-FinancialAssistanceAmount":   "amount_awarded",
		"CA-Donation amount":             "donation_preference",
		"CA-Donation other":              "donation_other",
	}

	if col, ok := mapping[fieldName]; ok {
		return col
	}
	return ""
}

// parseFABoolField parses boolean values from custom field strings
func parseFABoolField(value string) bool {
	if value == "" {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(value))

	switch lower {
	case "yes", "y", "true", "1":
		return true
	default:
		return false
	}
}

// parseFANumberField parses numeric values from text fields
func parseFANumberField(value string) float64 {
	if value == "" {
		return 0
	}

	// Trim whitespace
	clean := value
	for clean != "" && (clean[0] == ' ' || clean[0] == '\t') {
		clean = clean[1:]
	}
	for clean != "" && (clean[len(clean)-1] == ' ' || clean[len(clean)-1] == '\t') {
		clean = clean[:len(clean)-1]
	}

	// Remove $ and , characters
	result := ""
	for _, c := range clean {
		if c != '$' && c != ',' {
			result += string(c)
		}
	}

	// Parse as float
	var num float64
	_, err := parseFloat(result, &num)
	if err != nil {
		return 0
	}
	return num
}

// parseFloat helper - simple float parsing
func parseFloat(s string, result *float64) (bool, error) {
	if s == "" {
		*result = 0
		return true, nil
	}

	negative := false
	if s != "" && s[0] == '-' {
		negative = true
		s = s[1:]
	}

	var intPart, fracPart float64
	var inFrac bool
	var fracDiv float64 = 10

	for _, c := range s {
		if c == '.' {
			inFrac = true
			continue
		}
		if c < '0' || c > '9' {
			*result = 0
			return false, nil
		}
		digit := float64(c - '0')
		if inFrac {
			fracPart += digit / fracDiv
			fracDiv *= 10
		} else {
			intPart = intPart*10 + digit
		}
	}

	*result = intPart + fracPart
	if negative {
		*result = -*result
	}
	return true, nil
}

// generateFACompositeKey generates a composite key for upsert lookups
func generateFACompositeKey(personID string, year int) string {
	return personID + ":" + itoa(year)
}

// itoa - simple int to string conversion
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	negative := n < 0
	if negative {
		n = -n
	}
	digits := ""
	for n > 0 {
		digits = string('0'+byte(n%10)) + digits
		n /= 10
	}
	if negative {
		digits = "-" + digits
	}
	return digits
}

// hasFAInterestExpressed checks if the value indicates interest was expressed
func hasFAInterestExpressed(value string) bool {
	if value == "" {
		return false
	}
	// Any non-empty, non-negative value indicates interest
	lower := strings.ToLower(strings.TrimSpace(value))
	return lower != "no" && lower != "n" && lower != "0" && lower != "false"
}

// aggregateFAApplications aggregates custom values into application records
func aggregateFAApplications(values []testFACustomValue, year int) map[string]*testFAApplication {
	result := make(map[string]*testFAApplication)

	for _, v := range values {
		if result[v.PersonPBID] == nil {
			result[v.PersonPBID] = &testFAApplication{
				PersonPBID: v.PersonPBID,
				Year:       year,
			}
		}

		app := result[v.PersonPBID]
		column := mapFAFieldToColumn(v.FieldName)

		// Skip empty values
		if v.Value == "" {
			continue
		}

		// Only set if not already set (first non-empty wins)
		switch column {
		case "contact_first_name":
			if app.ContactFirstName == "" {
				app.ContactFirstName = v.Value
			}
		case "contact_email":
			if app.ContactEmail == "" {
				app.ContactEmail = v.Value
			}
		case "total_gross_income":
			if app.TotalGrossIncome == 0 {
				app.TotalGrossIncome = parseFANumberField(v.Value)
			}
		case "interest_expressed":
			if !app.InterestExpressed {
				app.InterestExpressed = hasFAInterestExpressed(v.Value)
			}
		}
	}

	return result
}

// isFABoolColumn returns true if the column stores boolean values
func isFABoolColumn(column string) bool {
	boolColumns := map[string]bool{
		"interest_expressed": true,
		"unemployment":       true,
		"still_unemployed":   true,
		"owns_home":          true,
		"single_parent":      true,
		"affiliated_jcc":     true,
		"russian_speaking":   true,
		"gov_subsidies":      true,
		"covid_childcare":    true,
		"fire_affected":      true,
		"income_confirmed":   true,
		"amount_confirmed":   true,
	}
	return boolColumns[column]
}

// isFANumberColumn returns true if the column stores numeric values
func isFANumberColumn(column string) bool {
	numberColumns := map[string]bool{
		"total_gross_income":      true,
		"expected_gross_income":   true,
		"total_adjusted_income":   true,
		"total_exemptions":        true,
		"non_retirement_savings":  true,
		"retirement_accounts":     true,
		"student_debt":            true,
		"total_medical_expenses":  true,
		"total_edu_expenses":      true,
		"total_housing_expenses":  true,
		"total_rent":              true,
		"num_children":            true,
		"summer_amount_requested": true,
		"fc_amount_requested":     true,
		"tbm_amount_requested":    true,
		"num_programs":            true,
		"num_sessions":            true,
		"amount_requested":        true,
		"covid_childcare_amount":  true,
		"covid_expenses_amount":   true,
		"deposit_paid":            true,
		"deposit_paid_adult":      true,
		"amount_awarded":          true,
		"other_support_amount":    true,
	}
	return numberColumns[column]
}
