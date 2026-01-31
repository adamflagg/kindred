package sync

import (
	"fmt"
	"testing"
)

// TestStaffApplicationsServiceName verifies the service name constant
func TestStaffApplicationsServiceName(t *testing.T) {
	expected := "staff_applications"
	if serviceNameStaffApplications != expected {
		t.Errorf("serviceNameStaffApplications = %q, want %q", serviceNameStaffApplications, expected)
	}
}

// TestMapAppFieldToColumn tests the CampMinder field name to column mapping
// for the 39 App- fields used in staff applications
func TestMapAppFieldToColumn(t *testing.T) {
	tests := []struct {
		cmField  string
		expected string
	}{
		// Work availability fields
		{"App-Work Camp Dates?", "can_work_dates"},
		{"App-Can't Work Camp Dates Expl", "cant_work_explain"},
		{"App- Work Camp Dates Supervisor?", "work_dates_supervisor"},
		{"App-Work Camp Dates WILD?", "work_dates_wild"},
		{"App- Work Camp Dates Driver?", "work_dates_driver"},

		// Qualifications and expectations
		{"App-Work Expectations", "work_expectations"},
		{"App-Qualifications", "qualifications"},
		{"App-Qualification changes", "qualification_changes"},

		// Position preferences
		{"Position Preference 1", "position_pref_1"},
		{"Position Preference 2", "position_pref_2"},
		{"Position Preference 3", "position_pref_3"},

		// Essays and reflections
		{"App-Why Tawonga?", "why_tawonga"},
		{"App-Why work at camp again?", "why_work_again"},
		{"App-Jewish Community", "jewish_community"},
		{"App-Three Rules...", "three_rules"},
		{"App-Autobiography...", "autobiography"},
		{"App-Community Means...", "community_means"},
		{"App- Working Across Differences", "working_across_differences"},

		// Personal info
		{"App-languages", "languages"},
		{"App-Dietary Needs", "dietary_needs"},
		{"App-Dietary Needs (Other)", "dietary_needs_other"},
		{"App-Over 21", "over_21"},

		// Reference fields
		{"App-Ref 1 Name", "ref_1_name"},
		{"App-Ref 1 Phone Number", "ref_1_phone"},
		{"App-Ref 1 Email", "ref_1_email"},
		{"App-Ref 1 Relationship", "ref_1_relationship"},
		{"App-Ref 1 Yrs of Acquaintance", "ref_1_years"},

		// Reflection prompts (returning staff)
		{"App-I got stressed when", "stress_situation"},
		{"App-I responded to my stress", "stress_response"},
		{"App-I had a spiritual moment", "spiritual_moment"},
		{"App-An activity or program", "activity_program"},
		{"App-Someone whose work I", "someone_admire"},
		{"App-Since camp I've been", "since_camp"},
		{"App-I wish I had gotten toknow", "wish_knew"},
		{"App-Last summer I learned", "last_summer_learned"},
		{"App-My favorite camper moment", "favorite_camper_moment"},
		{"App-My closest friend at camp", "closest_friend"},
		{"App-Tawonga makes me think of", "tawonga_makes_think"},
		{"App-what advice would you", "advice_would_give"},
		{"App-How do you look at camp", "how_look_at_camp"},

		// Unknown field should return empty
		{"Unknown-Field", ""},
	}

	for _, tt := range tests {
		t.Run(tt.cmField, func(t *testing.T) {
			got := MapAppFieldToColumn(tt.cmField)
			if got != tt.expected {
				t.Errorf("MapAppFieldToColumn(%q) = %q, want %q", tt.cmField, got, tt.expected)
			}
		})
	}
}

// TestParseAppBool tests boolean parsing for staff application fields
func TestParseAppBool(t *testing.T) {
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
			got := parseAppBool(tt.input)
			if got != tt.expected {
				t.Errorf("parseAppBool(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

// TestStaffApplicationsCompositeKey tests the unique key generation
// Key format: personID|year
func TestStaffApplicationsCompositeKey(t *testing.T) {
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
			got := makeStaffApplicationsKey(tt.personID, tt.year)
			if got != tt.expected {
				t.Errorf("makeStaffApplicationsKey(%d, %d) = %q, want %q",
					tt.personID, tt.year, got, tt.expected)
			}
		})
	}
}

// TestStaffApplicationsFieldMapping tests that all expected fields are present
func TestStaffApplicationsFieldMapping(t *testing.T) {
	expectedFields := []string{
		// Work availability
		"can_work_dates",
		"cant_work_explain",
		"work_dates_supervisor",
		"work_dates_wild",
		"work_dates_driver",
		// Qualifications
		"work_expectations",
		"qualifications",
		"qualification_changes",
		// Position preferences
		"position_pref_1",
		"position_pref_2",
		"position_pref_3",
		// Essays
		"why_tawonga",
		"why_work_again",
		"jewish_community",
		"three_rules",
		"autobiography",
		"community_means",
		"working_across_differences",
		// Personal info
		"languages",
		"dietary_needs",
		"dietary_needs_other",
		"over_21",
		// Reference
		"ref_1_name",
		"ref_1_phone",
		"ref_1_email",
		"ref_1_relationship",
		"ref_1_years",
		// Reflection prompts
		"stress_situation",
		"stress_response",
		"spiritual_moment",
		"activity_program",
		"someone_admire",
		"since_camp",
		"wish_knew",
		"last_summer_learned",
		"favorite_camper_moment",
		"closest_friend",
		"tawonga_makes_think",
		"advice_would_give",
		"how_look_at_camp",
	}

	// Verify we have all 40 expected columns (excluding staff, person_id, year, created, updated)
	// Note: Plan said 39, but actual count from CampMinder fields is 40
	if len(expectedFields) != 40 {
		t.Errorf("Expected 40 custom fields, got %d", len(expectedFields))
	}

	// Test each field has a valid CM field mapping back
	for _, field := range expectedFields {
		cmField := getAppCMFieldForColumn(field)
		if cmField == "" {
			t.Errorf("Column %q has no CampMinder field mapping", field)
		}

		// Verify round-trip
		backToColumn := MapAppFieldToColumn(cmField)
		if backToColumn != field {
			t.Errorf("Round-trip failed: column %q -> cmField %q -> column %q",
				field, cmField, backToColumn)
		}
	}
}

// Helper functions that define expected behavior - implementation must match these

// MapAppFieldToColumn maps CampMinder custom field names to database column names
func MapAppFieldToColumn(cmField string) string {
	mapping := map[string]string{
		// Work availability fields
		"App-Work Camp Dates?":           "can_work_dates",
		"App-Can't Work Camp Dates Expl": "cant_work_explain",
		"App- Work Camp Dates Supervisor?": "work_dates_supervisor",
		"App-Work Camp Dates WILD?":        "work_dates_wild",
		"App- Work Camp Dates Driver?":     "work_dates_driver",

		// Qualifications and expectations
		"App-Work Expectations":    "work_expectations",
		"App-Qualifications":       "qualifications",
		"App-Qualification changes": "qualification_changes",

		// Position preferences (note: no App- prefix in CampMinder)
		"Position Preference 1": "position_pref_1",
		"Position Preference 2": "position_pref_2",
		"Position Preference 3": "position_pref_3",

		// Essays and reflections
		"App-Why Tawonga?":                "why_tawonga",
		"App-Why work at camp again?":     "why_work_again",
		"App-Jewish Community":            "jewish_community",
		"App-Three Rules...":              "three_rules",
		"App-Autobiography...":            "autobiography",
		"App-Community Means...":          "community_means",
		"App- Working Across Differences": "working_across_differences",

		// Personal info
		"App-languages":            "languages",
		"App-Dietary Needs":        "dietary_needs",
		"App-Dietary Needs (Other)": "dietary_needs_other",
		"App-Over 21":              "over_21",

		// Reference fields
		"App-Ref 1 Name":              "ref_1_name",
		"App-Ref 1 Phone Number":      "ref_1_phone",
		"App-Ref 1 Email":             "ref_1_email",
		"App-Ref 1 Relationship":      "ref_1_relationship",
		"App-Ref 1 Yrs of Acquaintance": "ref_1_years",

		// Reflection prompts (returning staff)
		"App-I got stressed when":       "stress_situation",
		"App-I responded to my stress":  "stress_response",
		"App-I had a spiritual moment":  "spiritual_moment",
		"App-An activity or program":    "activity_program",
		"App-Someone whose work I":      "someone_admire",
		"App-Since camp I've been":      "since_camp",
		"App-I wish I had gotten toknow": "wish_knew",
		"App-Last summer I learned":     "last_summer_learned",
		"App-My favorite camper moment": "favorite_camper_moment",
		"App-My closest friend at camp": "closest_friend",
		"App-Tawonga makes me think of": "tawonga_makes_think",
		"App-what advice would you":     "advice_would_give",
		"App-How do you look at camp":   "how_look_at_camp",
	}

	return mapping[cmField]
}

// getAppCMFieldForColumn is the reverse mapping
func getAppCMFieldForColumn(column string) string {
	mapping := map[string]string{
		// Work availability
		"can_work_dates":        "App-Work Camp Dates?",
		"cant_work_explain":     "App-Can't Work Camp Dates Expl",
		"work_dates_supervisor": "App- Work Camp Dates Supervisor?",
		"work_dates_wild":       "App-Work Camp Dates WILD?",
		"work_dates_driver":     "App- Work Camp Dates Driver?",

		// Qualifications
		"work_expectations":      "App-Work Expectations",
		"qualifications":         "App-Qualifications",
		"qualification_changes":  "App-Qualification changes",

		// Position preferences
		"position_pref_1": "Position Preference 1",
		"position_pref_2": "Position Preference 2",
		"position_pref_3": "Position Preference 3",

		// Essays
		"why_tawonga":                 "App-Why Tawonga?",
		"why_work_again":              "App-Why work at camp again?",
		"jewish_community":            "App-Jewish Community",
		"three_rules":                 "App-Three Rules...",
		"autobiography":               "App-Autobiography...",
		"community_means":             "App-Community Means...",
		"working_across_differences": "App- Working Across Differences",

		// Personal info
		"languages":          "App-languages",
		"dietary_needs":      "App-Dietary Needs",
		"dietary_needs_other": "App-Dietary Needs (Other)",
		"over_21":            "App-Over 21",

		// Reference
		"ref_1_name":         "App-Ref 1 Name",
		"ref_1_phone":        "App-Ref 1 Phone Number",
		"ref_1_email":        "App-Ref 1 Email",
		"ref_1_relationship": "App-Ref 1 Relationship",
		"ref_1_years":        "App-Ref 1 Yrs of Acquaintance",

		// Reflection prompts
		"stress_situation":        "App-I got stressed when",
		"stress_response":         "App-I responded to my stress",
		"spiritual_moment":        "App-I had a spiritual moment",
		"activity_program":        "App-An activity or program",
		"someone_admire":          "App-Someone whose work I",
		"since_camp":              "App-Since camp I've been",
		"wish_knew":               "App-I wish I had gotten toknow",
		"last_summer_learned":     "App-Last summer I learned",
		"favorite_camper_moment":  "App-My favorite camper moment",
		"closest_friend":          "App-My closest friend at camp",
		"tawonga_makes_think":     "App-Tawonga makes me think of",
		"advice_would_give":       "App-what advice would you",
		"how_look_at_camp":        "App-How do you look at camp",
	}

	return mapping[column]
}

// parseAppBool parses Yes/No values to boolean
func parseAppBool(value string) bool {
	switch value {
	case "Yes", "yes", "YES":
		return true
	default:
		return false
	}
}

// makeStaffApplicationsKey creates the composite key for upsert logic
func makeStaffApplicationsKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}
