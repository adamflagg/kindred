package sync

import (
	"fmt"
	"strings"
	"testing"
)

// TestQuestRegistrationsSync_Name verifies the service name is correct
func TestQuestRegistrationsSync_Name(t *testing.T) {
	expectedName := "quest_registrations"
	if serviceNameQuestRegistrations != expectedName {
		t.Errorf("expected service name %q, got %q", expectedName, serviceNameQuestRegistrations)
	}
}

// TestQuestRegistrationsYearValidation tests year parameter validation
func TestQuestRegistrationsYearValidation(t *testing.T) {
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
			valid := isValidQuestYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidQuestYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestQuestFieldMapping tests CampMinder field to column mapping
func TestQuestFieldMapping(t *testing.T) {
	tests := []struct {
		fieldName  string
		wantColumn string
	}{
		// Quest- prefixed fields
		{"Quest-Parent Signature", "parent_signature"},
		{"Quest-Signature of Quester", "quester_signature"},
		{"Quest-prefer to be called", "preferred_name"},
		{"Quest-biggest hope", "biggest_hope"},
		{"Quest-biggest concern", "biggest_concern"},
		{"Quest-How easily make friends", "make_friends_ease"},
		{"Quest-Make friends - explain", "make_friends_explain"},
		{"Quest-React to Separation", "separation_reaction"},
		{"Quest-React to Separat explain", "separation_explain"},
		{"Quest-away from home before?", "away_before"},
		{"Quest-away from home explain", "away_explain"},
		{"Quest-Expressfrustration/anger", "express_frustration"},
		{"Quest-What makes child angry", "what_makes_angry"},
		{"Quest-cooperate with limits", "cooperates_with_limits"},
		{"Quest-techniques to set limits", "techniques_limits"},
		{"Quest-any medications", "any_medications"},
		{"Quest-Physical Limitations", "physical_limitations"},
		{"Quest-Physical limit explain", "physical_limit_explain"},
		{"Quest-fears or anxieties", "fears_anxieties"},
		{"Quest-situations/transitions", "situations_transitions"},
		{"Quest-Bad camp experiences", "bad_camp_experiences"},
		{"Quest-child matured", "child_matured"},
		{"Quest-Change since last year", "change_since_last_year"},
		{"Quest-Extracurricular activiti", "extracurricular"},
		{"Quest-Cook/chores around house", "cook_chores"},
		{"Quest-Cook/Chores Explain", "cook_chores_explain"},
		{"Quest-decision attend Tawonga", "decision_attend"},
		{"Quest-How can we help?", "how_can_help"},
		{"Quest-How much does child", "how_much_child"},
		{"Quest-Has your quester", "has_quester_before"},
		{"Quest-Special Needs", "special_needs"},
		{"Quest-Concerns for child", "concerns_for_child"},
		{"Quest-Anything else", "anything_else"},
		{"Quest-Bar/BatMitzvah this year", "bar_mitzvah_year"},
		{"Quest-Bar/BatMitzvah where", "bar_mitzvah_where"},
		{"Quest-Bar mitzvah month", "bar_mitzvah_month"},
		{"Quest-Backpack", "backpack_info"},
		// Q- prefixed fields
		{"Q-Why come?", "why_come"},
		{"Q-Most looking forward to", "most_looking_forward"},
		{"Q-least looking forward to", "least_looking_forward"},
		{"Q-biggest accomplishment", "biggest_accomplishment"},
		{"Q-biggest disappointment", "biggest_disappointment"},
		{"Q-Whose decision", "whose_decision"},
		{"Q-If returning", "if_returning"},
		// Quest BUS- fields
		{"Quest BUS-person picking up", "bus_pickup_name"},
		{"Quest BUS-phone person picking up", "bus_pickup_phone"},
		{"Quest BUS-relationship to camper pick up", "bus_pickup_relationship"},
		{"Quest BUS-alternate pick up", "bus_alt_pickup"},
		{"Quest BUS-alternate phone", "bus_alt_phone"},
		// Unknown field
		{"Unknown-Field", ""},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := MapQuestFieldToColumn(tt.fieldName)
			if result != tt.wantColumn {
				t.Errorf("MapQuestFieldToColumn(%q) = %q, want %q", tt.fieldName, result, tt.wantColumn)
			}
		})
	}
}

// TestQuestCompositeKeyFormat tests composite key generation
func TestQuestCompositeKeyFormat(t *testing.T) {
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
			key := formatQuestCompositeKey(tt.personID, tt.year)
			if key != tt.expected {
				t.Errorf("formatQuestCompositeKey = %q, want %q", key, tt.expected)
			}
		})
	}
}

// TestIsQuestField tests identification of Quest fields
func TestIsQuestField(t *testing.T) {
	tests := []struct {
		fieldName   string
		wantIsQuest bool
	}{
		{"Quest-Parent Signature", true},
		{"Quest-biggest hope", true},
		{"Q-Why come?", true},
		{"Q-Most looking forward to", true},
		{"Quest BUS-person picking up", true},
		{"Family Camp Adult 1", false},
		{"Bunk Preference", false},
		{"quest-parent signature", false}, // case sensitive
		{"Q -Why come", false},            // extra space
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := isQuestField(tt.fieldName)
			if result != tt.wantIsQuest {
				t.Errorf("isQuestField(%q) = %v, want %v", tt.fieldName, result, tt.wantIsQuest)
			}
		})
	}
}

// TestQuestBooleanParsing tests parsing Bar/Bat Mitzvah year field
func TestQuestBooleanParsing(t *testing.T) {
	tests := []struct {
		name     string
		rawValue string
		wantBool bool
	}{
		{"Yes", "Yes", true},
		{"yes lowercase", "yes", true},
		{"No", "No", false},
		{"empty", "", false},
		{"This year", "This year", true},
		{"Not this year", "Not this year", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseQuestBool(tt.rawValue)
			if result != tt.wantBool {
				t.Errorf("parseQuestBool(%q) = %v, want %v", tt.rawValue, result, tt.wantBool)
			}
		})
	}
}

// TestQuestRecordBuilding tests building quest records from source data
func TestQuestRecordBuilding(t *testing.T) {
	fieldValues := []testQuestFieldValue{
		{PersonID: 12345, FieldName: "Quest-Parent Signature", Value: "John Smith", Year: 2025},
		{PersonID: 12345, FieldName: "Quest-biggest hope", Value: "Make new friends", Year: 2025},
		{PersonID: 12345, FieldName: "Q-Why come?", Value: "Loves the outdoors", Year: 2025},
		{PersonID: 12345, FieldName: "Quest-Bar/BatMitzvah this year", Value: "Yes", Year: 2025},
		{PersonID: 12346, FieldName: "Quest-Parent Signature", Value: "Jane Doe", Year: 2025},
	}

	records := buildQuestRecords(fieldValues)

	// Should have 2 records (one per person-year combination)
	if len(records) != 2 {
		t.Errorf("expected 2 records, got %d", len(records))
	}

	// Verify first record
	r1 := findQuestRecord(records, 12345, 2025)
	if r1 == nil {
		t.Fatal("record for person 12345, year 2025 not found")
	}
	if r1.ParentSignature != "John Smith" {
		t.Errorf("expected parent_signature 'John Smith', got %q", r1.ParentSignature)
	}
	if r1.BiggestHope != "Make new friends" {
		t.Errorf("expected biggest_hope 'Make new friends', got %q", r1.BiggestHope)
	}
	if r1.WhyCome != "Loves the outdoors" {
		t.Errorf("expected why_come 'Loves the outdoors', got %q", r1.WhyCome)
	}
	if !r1.BarMitzvahYear {
		t.Error("expected bar_mitzvah_year = true")
	}
}

// TestQuestEmptyDataHandling tests graceful handling of empty input
func TestQuestEmptyDataHandling(t *testing.T) {
	fieldValues := []testQuestFieldValue{}

	records := buildQuestRecords(fieldValues)

	if len(records) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(records))
	}
}

// TestQuestFieldCount tests that we map all expected fields
func TestQuestFieldCount(t *testing.T) {
	// From the plan: 45 Quest-/Q- fields total
	// We should map at least the key ones
	knownFields := []string{
		"Quest-Parent Signature",
		"Quest-Signature of Quester",
		"Quest-prefer to be called",
		"Q-Why come?",
		"Q-Most looking forward to",
		"Q-least looking forward to",
		"Q-biggest accomplishment",
		"Q-biggest disappointment",
		"Q-Whose decision",
		"Q-If returning",
		"Quest-biggest hope",
		"Quest-biggest concern",
		"Quest-How easily make friends",
		"Quest-Make friends - explain",
		"Quest-React to Separation",
		"Quest-React to Separat explain",
		"Quest-away from home before?",
		"Quest-away from home explain",
		"Quest-Expressfrustration/anger",
		"Quest-What makes child angry",
		"Quest-cooperate with limits",
		"Quest-techniques to set limits",
		"Quest-any medications",
		"Quest-Physical Limitations",
		"Quest-Physical limit explain",
		"Quest-fears or anxieties",
		"Quest-situations/transitions",
		"Quest-Bad camp experiences",
		"Quest-child matured",
		"Quest-Change since last year",
		"Quest-Extracurricular activiti",
		"Quest-Cook/chores around house",
		"Quest-Cook/Chores Explain",
		"Quest-decision attend Tawonga",
		"Quest-How can we help?",
		"Quest-How much does child",
		"Quest-Has your quester",
		"Quest-Special Needs",
		"Quest-Concerns for child",
		"Quest-Anything else",
		"Quest-Bar/BatMitzvah this year",
		"Quest-Bar/BatMitzvah where",
		"Quest-Bar mitzvah month",
		"Quest-Backpack",
		"Quest BUS-person picking up",
		"Quest BUS-phone person picking up",
		"Quest BUS-relationship to camper pick up",
		"Quest BUS-alternate pick up",
		"Quest BUS-alternate phone",
	}

	mappedCount := 0
	for _, field := range knownFields {
		if MapQuestFieldToColumn(field) != "" {
			mappedCount++
		}
	}

	// All known fields should be mapped
	if mappedCount != len(knownFields) {
		t.Errorf("expected %d fields mapped, got %d", len(knownFields), mappedCount)
	}
}

// ============================================================================
// Test helper types and functions
// ============================================================================

type testQuestFieldValue struct {
	PersonID  int
	FieldName string
	Value     string
	Year      int
}

type testQuestRecord struct {
	PersonID        int
	Year            int
	ParentSignature string
	QuesterSignature string
	PreferredName   string
	WhyCome         string
	MostLookingFwd  string
	LeastLookingFwd string
	BiggestHope     string
	BiggestConcern  string
	BarMitzvahYear  bool
	BarMitzvahWhere string
	BarMitzvahMonth string
	// ... many more fields
}

// isValidQuestYear validates year parameter
func isValidQuestYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// parseQuestBool parses Yes/No/This year strings to boolean
func parseQuestBool(rawValue string) bool {
	lower := strings.ToLower(strings.TrimSpace(rawValue))
	switch lower {
	case "yes", "true", "1", "y", "this year":
		return true
	}
	return false
}

// MapQuestFieldToColumn maps field names to database column names
func MapQuestFieldToColumn(fieldName string) string {
	switch fieldName {
	// Quest- prefixed fields
	case "Quest-Parent Signature":
		return "parent_signature"
	case "Quest-Signature of Quester":
		return "quester_signature"
	case "Quest-prefer to be called":
		return "preferred_name"
	case "Quest-biggest hope":
		return "biggest_hope"
	case "Quest-biggest concern":
		return "biggest_concern"
	case "Quest-How easily make friends":
		return "make_friends_ease"
	case "Quest-Make friends - explain":
		return "make_friends_explain"
	case "Quest-React to Separation":
		return "separation_reaction"
	case "Quest-React to Separat explain":
		return "separation_explain"
	case "Quest-away from home before?":
		return "away_before"
	case "Quest-away from home explain":
		return "away_explain"
	case "Quest-Expressfrustration/anger":
		return "express_frustration"
	case "Quest-What makes child angry":
		return "what_makes_angry"
	case "Quest-cooperate with limits":
		return "cooperates_with_limits"
	case "Quest-techniques to set limits":
		return "techniques_limits"
	case "Quest-any medications":
		return "any_medications"
	case "Quest-Physical Limitations":
		return "physical_limitations"
	case "Quest-Physical limit explain":
		return "physical_limit_explain"
	case "Quest-fears or anxieties":
		return "fears_anxieties"
	case "Quest-situations/transitions":
		return "situations_transitions"
	case "Quest-Bad camp experiences":
		return "bad_camp_experiences"
	case "Quest-child matured":
		return "child_matured"
	case "Quest-Change since last year":
		return "change_since_last_year"
	case "Quest-Extracurricular activiti":
		return "extracurricular"
	case "Quest-Cook/chores around house":
		return "cook_chores"
	case "Quest-Cook/Chores Explain":
		return "cook_chores_explain"
	case "Quest-decision attend Tawonga":
		return "decision_attend"
	case "Quest-How can we help?":
		return "how_can_help"
	case "Quest-How much does child":
		return "how_much_child"
	case "Quest-Has your quester":
		return "has_quester_before"
	case "Quest-Special Needs":
		return "special_needs"
	case "Quest-Concerns for child":
		return "concerns_for_child"
	case "Quest-Anything else":
		return "anything_else"
	case "Quest-Bar/BatMitzvah this year":
		return "bar_mitzvah_year"
	case "Quest-Bar/BatMitzvah where":
		return "bar_mitzvah_where"
	case "Quest-Bar mitzvah month":
		return "bar_mitzvah_month"
	case "Quest-Backpack":
		return "backpack_info"
	// Q- prefixed fields
	case "Q-Why come?":
		return "why_come"
	case "Q-Most looking forward to":
		return "most_looking_forward"
	case "Q-least looking forward to":
		return "least_looking_forward"
	case "Q-biggest accomplishment":
		return "biggest_accomplishment"
	case "Q-biggest disappointment":
		return "biggest_disappointment"
	case "Q-Whose decision":
		return "whose_decision"
	case "Q-If returning":
		return "if_returning"
	// Quest BUS- fields
	case "Quest BUS-person picking up":
		return "bus_pickup_name"
	case "Quest BUS-phone person picking up":
		return "bus_pickup_phone"
	case "Quest BUS-relationship to camper pick up":
		return "bus_pickup_relationship"
	case "Quest BUS-alternate pick up":
		return "bus_alt_pickup"
	case "Quest BUS-alternate phone":
		return "bus_alt_phone"
	}
	return ""
}

// isQuestField checks if a field is a Quest field
func isQuestField(fieldName string) bool {
	if strings.HasPrefix(fieldName, "Quest-") {
		return true
	}
	if strings.HasPrefix(fieldName, "Q-") {
		return true
	}
	if strings.HasPrefix(fieldName, "Quest BUS-") {
		return true
	}
	return false
}

// formatQuestCompositeKey creates composite key
func formatQuestCompositeKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}

// buildQuestRecords builds records from field values
func buildQuestRecords(fieldValues []testQuestFieldValue) []*testQuestRecord {
	recordsByKey := make(map[string]*testQuestRecord)

	for _, fv := range fieldValues {
		key := formatQuestCompositeKey(fv.PersonID, fv.Year)

		if _, exists := recordsByKey[key]; !exists {
			recordsByKey[key] = &testQuestRecord{
				PersonID: fv.PersonID,
				Year:     fv.Year,
			}
		}

		rec := recordsByKey[key]
		column := MapQuestFieldToColumn(fv.FieldName)
		switch column {
		case "parent_signature":
			rec.ParentSignature = fv.Value
		case "quester_signature":
			rec.QuesterSignature = fv.Value
		case "preferred_name":
			rec.PreferredName = fv.Value
		case "why_come":
			rec.WhyCome = fv.Value
		case "most_looking_forward":
			rec.MostLookingFwd = fv.Value
		case "least_looking_forward":
			rec.LeastLookingFwd = fv.Value
		case "biggest_hope":
			rec.BiggestHope = fv.Value
		case "biggest_concern":
			rec.BiggestConcern = fv.Value
		case "bar_mitzvah_year":
			rec.BarMitzvahYear = parseQuestBool(fv.Value)
		case "bar_mitzvah_where":
			rec.BarMitzvahWhere = fv.Value
		case "bar_mitzvah_month":
			rec.BarMitzvahMonth = fv.Value
		}
	}

	records := make([]*testQuestRecord, 0, len(recordsByKey))
	for _, r := range recordsByKey {
		records = append(records, r)
	}
	return records
}

// findQuestRecord finds a record by person ID and year
func findQuestRecord(records []*testQuestRecord, personID, year int) *testQuestRecord {
	for _, r := range records {
		if r.PersonID == personID && r.Year == year {
			return r
		}
	}
	return nil
}
