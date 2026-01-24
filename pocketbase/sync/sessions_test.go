package sync

import (
	"testing"
)

const testSessionName = "Session 2"

// TestParseDate tests date parsing from various CampMinder formats
func TestParseDate(t *testing.T) {
	s := &SessionsSync{}

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		// ISO formats
		{
			name:     "ISO 8601 with Z",
			input:    "2024-06-15T10:30:00Z",
			expected: "2024-06-15 10:30:00Z",
		},
		{
			name:     "ISO 8601 without Z",
			input:    "2024-06-15T10:30:00",
			expected: "2024-06-15 10:30:00Z",
		},
		{
			name:     "ISO 8601 with milliseconds",
			input:    "2024-06-15T10:30:00.000Z",
			expected: "2024-06-15 10:30:00Z",
		},
		{
			name:     "date only",
			input:    "2024-06-15",
			expected: "2024-06-15 00:00:00Z",
		},
		// US formats
		{
			name:     "US format M/D/YYYY",
			input:    "6/15/2024",
			expected: "2024-06-15 00:00:00Z",
		},
		{
			name:     "US format MM/DD/YYYY",
			input:    "06/15/2024",
			expected: "2024-06-15 00:00:00Z",
		},
		// RFC3339
		{
			name:     "RFC3339 with timezone",
			input:    "2024-06-15T10:30:00-07:00",
			expected: "2024-06-15 17:30:00Z", // Converted to UTC
		},
		// Invalid formats
		{
			name:     "invalid format",
			input:    "not a date",
			expected: "",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := s.parseDate(tt.input)
			if got != tt.expected {
				t.Errorf("parseDate(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestSessionsSync_Name(t *testing.T) {
	// Create a SessionsSync without dependencies for this simple test
	s := &SessionsSync{}

	got := s.Name()
	want := "sessions"

	if got != want {
		t.Errorf("SessionsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformSessionExtractsAllFields tests that all CampMinder fields are extracted to PocketBase format
func TestTransformSessionExtractsAllFields(t *testing.T) {
	// Create SessionsSync with groupIDMap populated for session_group relation
	s := &SessionsSync{
		groupIDMap: map[int]string{
			100: "group_pb_id_100", // Maps GroupID 100 to PocketBase ID
		},
	}

	// Mock CampMinder API response with all fields
	// Note: CampMinder API has typo "IsForChilden" (missing 'r')
	sessionData := map[string]interface{}{
		"ID":            float64(12345),
		"Name":          testSessionName,
		"StartDate":     "2025-06-15T00:00:00Z",
		"EndDate":       "2025-07-13T00:00:00Z",
		"SeasonID":      float64(2025),
		"Description":   "Main summer session",
		"IsActive":      true,
		"SortOrder":     float64(2),
		"GroupID":       float64(100),
		"IsDay":         false,
		"IsResidential": true,
		"IsForChilden":  true, // CampMinder API typo - missing 'r'
		"IsForAdults":   false,
		"StartGradeID":  float64(3),
		"EndGradeID":    float64(10),
		"GenderID":      float64(0),
	}

	// No parent sessions for this test (empty map)
	mainSessions := make(map[string]int)

	pbData, err := s.transformSessionToPBWithParent(sessionData, mainSessions)
	if err != nil {
		t.Fatalf("transformSessionToPBWithParent returned error: %v", err)
	}

	// Verify existing fields still work
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), testSessionName; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
	if got, want := pbData["session_type"].(string), "main"; got != want {
		t.Errorf("session_type = %q, want %q", got, want)
	}

	// Verify new fields are extracted
	if got, want := pbData["description"], "Main summer session"; got != want {
		t.Errorf("description = %v, want %v", got, want)
	}
	if got, want := pbData["is_active"], true; got != want {
		t.Errorf("is_active = %v, want %v", got, want)
	}
	if got, want := pbData["sort_order"], float64(2); got != want {
		t.Errorf("sort_order = %v, want %v", got, want)
	}
	// session_group is resolved from GroupID via groupIDMap
	if got, want := pbData["session_group"], "group_pb_id_100"; got != want {
		t.Errorf("session_group = %v, want %v", got, want)
	}
	if got, want := pbData["is_day"], false; got != want {
		t.Errorf("is_day = %v, want %v", got, want)
	}
	if got, want := pbData["is_residential"], true; got != want {
		t.Errorf("is_residential = %v, want %v", got, want)
	}
	if got, want := pbData["is_for_children"], true; got != want {
		t.Errorf("is_for_children = %v, want %v", got, want)
	}
	if got, want := pbData["is_for_adults"], false; got != want {
		t.Errorf("is_for_adults = %v, want %v", got, want)
	}
	if got, want := pbData["start_grade_id"], float64(3); got != want {
		t.Errorf("start_grade_id = %v, want %v", got, want)
	}
	if got, want := pbData["end_grade_id"], float64(10); got != want {
		t.Errorf("end_grade_id = %v, want %v", got, want)
	}
	if got, want := pbData["gender_id"], float64(0); got != want {
		t.Errorf("gender_id = %v, want %v", got, want)
	}
}

// TestTransformSessionHandlesMissingFields tests that nil/missing fields don't cause errors
func TestTransformSessionHandlesMissingFields(t *testing.T) {
	s := &SessionsSync{}

	// Minimal session data with only required fields
	sessionData := map[string]interface{}{
		"ID":       float64(12345),
		"Name":     testSessionName,
		"SeasonID": float64(2025),
		// All optional fields are missing
	}

	mainSessions := make(map[string]int)

	pbData, err := s.transformSessionToPBWithParent(sessionData, mainSessions)
	if err != nil {
		t.Fatalf("transformSessionToPBWithParent returned error: %v", err)
	}

	// Required fields should be set
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}

	// Optional fields that are always present (may be nil)
	// Note: session_group is NOT included because it's only set when GroupID is present
	// and can be resolved via groupIDMap
	optionalFields := []string{
		"description", "is_active", "sort_order",
		"is_day", "is_residential", "is_for_children", "is_for_adults",
		"start_grade_id", "end_grade_id", "gender_id",
	}

	for _, field := range optionalFields {
		// Field should exist in pbData but can be nil
		if _, exists := pbData[field]; !exists {
			t.Errorf("field %q missing from pbData (should be present even if nil)", field)
		}
	}

	// session_group should NOT be present when GroupID is missing/not resolvable
	if _, exists := pbData["session_group"]; exists {
		t.Errorf("session_group should not be present when GroupID is missing")
	}
}

// TestTransformSessionHandlesNullFields tests that explicit null values are handled
func TestTransformSessionHandlesNullFields(t *testing.T) {
	s := &SessionsSync{}

	// Session data with explicit nil values (as might come from JSON null)
	sessionData := map[string]interface{}{
		"ID":            float64(12345),
		"Name":          testSessionName,
		"StartDate":     "2025-06-15T00:00:00Z",
		"EndDate":       "2025-07-13T00:00:00Z",
		"SeasonID":      float64(2025),
		"Description":   nil, // explicit null
		"IsActive":      nil,
		"SortOrder":     nil,
		"GroupID":       nil,
		"IsDay":         nil,
		"IsResidential": nil,
		"IsForChildren": nil,
		"IsForAdults":   nil,
		"StartGradeID":  nil,
		"EndGradeID":    nil,
		"GenderID":      nil,
	}

	mainSessions := make(map[string]int)

	pbData, err := s.transformSessionToPBWithParent(sessionData, mainSessions)
	if err != nil {
		t.Fatalf("transformSessionToPBWithParent returned error: %v", err)
	}

	// Should not panic and required fields should still work
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}

	// Null fields should be nil in the result
	if pbData["description"] != nil {
		t.Errorf("description should be nil for null input, got %v", pbData["description"])
	}
}

func TestGetSessionTypeFromName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		// Main sessions
		{
			name:     "taste of camp",
			input:    "Taste of Camp",
			expected: sessionTypeMain, // "main"
		},
		{
			name:     "session 2",
			input:    "Session 2",
			expected: sessionTypeMain, // "main"
		},
		{
			name:     "session 3",
			input:    "Session 3",
			expected: sessionTypeMain, // "main"
		},
		{
			name:     "session 4",
			input:    "Session 4",
			expected: sessionTypeMain, // "main"
		},
		// Embedded sessions
		{
			name:     "session 2a embedded",
			input:    "Session 2a",
			expected: "embedded",
		},
		{
			name:     "session 3b embedded",
			input:    "Session 3b",
			expected: "embedded",
		},
		// AG sessions
		{
			name:     "all-gender cabin",
			input:    "All-Gender Cabin-Session 2",
			expected: "ag",
		},
		// TLI sessions
		{
			name:     "tli sub-program",
			input:    "TLI: Leadership Week",
			expected: "tli",
		},
		{
			name:     "teen leadership institute",
			input:    "Teen Leadership Institute",
			expected: "tli",
		},
		// Family sessions
		{
			name:     "family camp",
			input:    "Family Camp 1",
			expected: "family",
		},
		{
			name:     "winter family camp",
			input:    "Winter Family Camp",
			expected: "family",
		},
		// Other/unknown sessions
		{
			name:     "session 1 is other (not matched)",
			input:    "Session 1",
			expected: "other",
		},
		{
			name:     "random session name",
			input:    "Some Random Program",
			expected: "other",
		},
	}

	s := &SessionsSync{}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := s.getSessionTypeFromName(tt.input)
			if got != tt.expected {
				t.Errorf("getSessionTypeFromName(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
