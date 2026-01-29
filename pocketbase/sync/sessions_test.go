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

	// No parent sessions for this test (empty maps)
	mainSessions := make(map[string]int)
	overrideTypes := map[int]string{12345: sessionTypeMain} // Provide expected type
	overrideParents := make(map[int]int)

	pbData, err := s.transformSessionToPBWithParent(sessionData, mainSessions, overrideTypes, overrideParents)
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
	if got, want := pbData["session_type"].(string), sessionTypeMain; got != want {
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
	overrideTypes := map[int]string{12345: sessionTypeMain}
	overrideParents := make(map[int]int)

	pbData, err := s.transformSessionToPBWithParent(sessionData, mainSessions, overrideTypes, overrideParents)
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
	overrideTypes := map[int]string{12345: sessionTypeMain}
	overrideParents := make(map[int]int)

	pbData, err := s.transformSessionToPBWithParent(sessionData, mainSessions, overrideTypes, overrideParents)
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

// TestReclassifyOverlappingSessions_SharedStartDate tests that sessions sharing a start date
// are reclassified so the longer session stays "main" and shorter ones become "embedded"
func TestReclassifyOverlappingSessions_SharedStartDate(t *testing.T) {
	s := &SessionsSync{}

	// Session 2 (June 15 - July 13) and Taste of Camp 2 (June 15 - June 20)
	// Both share start date June 15, Session 2 is longer
	sessions := []map[string]interface{}{
		{
			"ID":        float64(1001),
			"Name":      "Session 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-07-13T00:00:00Z",
		},
		{
			"ID":        float64(1002),
			"Name":      "Taste of Camp 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-06-20T00:00:00Z",
		},
	}

	// Initial types from name-based classification
	initialTypes := map[int]string{
		1001: sessionTypeMain, // Session 2
		1002: sessionTypeMain, // Taste of Camp 2 matches "taste of camp" -> main
	}

	correctedTypes, parentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Session 2 should stay main (longest duration)
	if correctedTypes[1001] != sessionTypeMain {
		t.Errorf("Session 2 type = %q, want %q", correctedTypes[1001], sessionTypeMain)
	}

	// Taste of Camp 2 should become embedded
	if correctedTypes[1002] != sessionTypeEmbedded {
		t.Errorf("Taste of Camp 2 type = %q, want %q", correctedTypes[1002], sessionTypeEmbedded)
	}

	// Taste of Camp 2 should have parent_id = Session 2's cm_id
	if parentIDs[1002] != 1001 {
		t.Errorf("Taste of Camp 2 parent_id = %d, want %d", parentIDs[1002], 1001)
	}

	// Session 2 should have no parent
	if parentIDs[1001] != 0 {
		t.Errorf("Session 2 parent_id = %d, want %d", parentIDs[1001], 0)
	}
}

// TestReclassifyOverlappingSessions_SharedEndDate tests that sessions sharing an end date
// are reclassified correctly
func TestReclassifyOverlappingSessions_SharedEndDate(t *testing.T) {
	s := &SessionsSync{}

	// Session 3 (July 14 - Aug 10) and Session 3a (Aug 1 - Aug 10)
	// Both share end date Aug 10, Session 3 is longer
	sessions := []map[string]interface{}{
		{
			"ID":        float64(2001),
			"Name":      "Session 3",
			"StartDate": "2025-07-14T00:00:00Z",
			"EndDate":   "2025-08-10T00:00:00Z",
		},
		{
			"ID":        float64(2002),
			"Name":      "Session 3a",
			"StartDate": "2025-08-01T00:00:00Z",
			"EndDate":   "2025-08-10T00:00:00Z",
		},
	}

	// Initial types - 3a is already embedded by name pattern
	initialTypes := map[int]string{
		2001: sessionTypeMain,     // Session 3
		2002: sessionTypeEmbedded, // Session 3a - already embedded by name pattern
	}

	correctedTypes, parentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Session 3 should stay main
	if correctedTypes[2001] != sessionTypeMain {
		t.Errorf("Session 3 type = %q, want %q", correctedTypes[2001], sessionTypeMain)
	}

	// Session 3a should stay embedded (already was)
	if correctedTypes[2002] != sessionTypeEmbedded {
		t.Errorf("Session 3a type = %q, want %q", correctedTypes[2002], sessionTypeEmbedded)
	}

	// Session 3a should get parent_id assigned since it shares end date with main session
	if parentIDs[2002] != 2001 {
		t.Errorf("Session 3a parent_id = %d, want %d", parentIDs[2002], 2001)
	}
}

// TestReclassifyOverlappingSessions_AGSessionsExempt tests that AG sessions are never reclassified
func TestReclassifyOverlappingSessions_AGSessionsExempt(t *testing.T) {
	s := &SessionsSync{}

	// AG session with same dates as main session
	sessions := []map[string]interface{}{
		{
			"ID":        float64(3001),
			"Name":      "Session 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-07-13T00:00:00Z",
		},
		{
			"ID":        float64(3002),
			"Name":      "All-Gender Cabin-Session 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-07-13T00:00:00Z",
		},
	}

	initialTypes := map[int]string{
		3001: sessionTypeMain,
		3002: "ag", // AG session
	}

	correctedTypes, parentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Session 2 stays main
	if correctedTypes[3001] != sessionTypeMain {
		t.Errorf("Session 2 type = %q, want %q", correctedTypes[3001], sessionTypeMain)
	}

	// AG session stays ag (exempt from reclassification)
	if correctedTypes[3002] != "ag" {
		t.Errorf("AG session type = %q, want %q", correctedTypes[3002], "ag")
	}

	// Neither should have parent_id set by this function
	// (AG parent_id is set separately in transformSessionToPBWithParent)
	if parentIDs[3001] != 0 || parentIDs[3002] != 0 {
		t.Errorf("Neither session should have parent_id from reclassification")
	}
}

// TestReclassifyOverlappingSessions_EqualDurationAlphabetical tests that sessions with
// equal duration are decided by alphabetical name (first stays main)
func TestReclassifyOverlappingSessions_EqualDurationAlphabetical(t *testing.T) {
	s := &SessionsSync{}

	// "Session A" and "Session B" with identical dates
	sessions := []map[string]interface{}{
		{
			"ID":        float64(4002),
			"Name":      "Session B",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-06-20T00:00:00Z",
		},
		{
			"ID":        float64(4001),
			"Name":      "Session A",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-06-20T00:00:00Z",
		},
	}

	initialTypes := map[int]string{
		4001: sessionTypeMain, // Session A
		4002: sessionTypeMain, // Session B
	}

	correctedTypes, parentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Session A should stay main (alphabetically first)
	if correctedTypes[4001] != sessionTypeMain {
		t.Errorf("Session A type = %q, want %q", correctedTypes[4001], sessionTypeMain)
	}

	// Session B should become embedded
	if correctedTypes[4002] != sessionTypeEmbedded {
		t.Errorf("Session B type = %q, want %q", correctedTypes[4002], sessionTypeEmbedded)
	}

	// Session B should have parent_id = Session A's cm_id
	if parentIDs[4002] != 4001 {
		t.Errorf("Session B parent_id = %d, want %d", parentIDs[4002], 4001)
	}
}

// TestReclassifyOverlappingSessions_MultipleOverlaps tests that multiple sessions sharing
// a start date are all reclassified correctly
func TestReclassifyOverlappingSessions_MultipleOverlaps(t *testing.T) {
	s := &SessionsSync{}

	// Session 2, ToC2, and Session 2b all share June 15 start
	sessions := []map[string]interface{}{
		{
			"ID":        float64(5001),
			"Name":      "Session 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-07-13T00:00:00Z", // 28 days
		},
		{
			"ID":        float64(5002),
			"Name":      "Taste of Camp 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-06-20T00:00:00Z", // 5 days
		},
		{
			"ID":        float64(5003),
			"Name":      "Session 2b",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-06-25T00:00:00Z", // 10 days
		},
	}

	initialTypes := map[int]string{
		5001: sessionTypeMain,     // Session 2
		5002: sessionTypeMain,     // Taste of Camp 2 (name pattern -> main)
		5003: sessionTypeEmbedded, // Session 2b (name pattern -> embedded)
	}

	correctedTypes, parentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Session 2 stays main (longest)
	if correctedTypes[5001] != sessionTypeMain {
		t.Errorf("Session 2 type = %q, want %q", correctedTypes[5001], sessionTypeMain)
	}

	// Taste of Camp 2 becomes embedded
	if correctedTypes[5002] != sessionTypeEmbedded {
		t.Errorf("Taste of Camp 2 type = %q, want %q", correctedTypes[5002], sessionTypeEmbedded)
	}

	// Session 2b stays embedded (already was)
	if correctedTypes[5003] != sessionTypeEmbedded {
		t.Errorf("Session 2b type = %q, want %q", correctedTypes[5003], sessionTypeEmbedded)
	}

	// Both embedded sessions should have Session 2 as parent
	if parentIDs[5002] != 5001 {
		t.Errorf("Taste of Camp 2 parent_id = %d, want %d", parentIDs[5002], 5001)
	}
	if parentIDs[5003] != 5001 {
		t.Errorf("Session 2b parent_id = %d, want %d", parentIDs[5003], 5001)
	}
}

// TestReclassifyOverlappingSessions_NoOverlap tests that sessions with unique dates
// retain their original types
func TestReclassifyOverlappingSessions_NoOverlap(t *testing.T) {
	s := &SessionsSync{}

	sessions := []map[string]interface{}{
		{
			"ID":        float64(6001),
			"Name":      "Session 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-07-13T00:00:00Z",
		},
		{
			"ID":        float64(6002),
			"Name":      "Session 3",
			"StartDate": "2025-07-14T00:00:00Z",
			"EndDate":   "2025-08-10T00:00:00Z",
		},
	}

	initialTypes := map[int]string{
		6001: sessionTypeMain,
		6002: sessionTypeMain,
	}

	correctedTypes, parentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Both should stay main (no overlap)
	if correctedTypes[6001] != sessionTypeMain {
		t.Errorf("Session 2 type = %q, want %q", correctedTypes[6001], sessionTypeMain)
	}
	if correctedTypes[6002] != sessionTypeMain {
		t.Errorf("Session 3 type = %q, want %q", correctedTypes[6002], sessionTypeMain)
	}

	// No parent IDs should be set
	if parentIDs[6001] != 0 || parentIDs[6002] != 0 {
		t.Errorf("No parent IDs should be set when no overlap")
	}
}

// TestReclassifyOverlappingSessions_NonMainUnchanged tests that non-main types
// (family, tli, etc.) are not reclassified even if dates overlap
func TestReclassifyOverlappingSessions_NonMainUnchanged(t *testing.T) {
	s := &SessionsSync{}

	// Family camp with same dates as a main session
	sessions := []map[string]interface{}{
		{
			"ID":        float64(7001),
			"Name":      "Session 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-07-13T00:00:00Z",
		},
		{
			"ID":        float64(7002),
			"Name":      "Family Camp 1",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-06-20T00:00:00Z",
		},
	}

	initialTypes := map[int]string{
		7001: sessionTypeMain,
		7002: "family",
	}

	correctedTypes, parentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Session 2 stays main
	if correctedTypes[7001] != sessionTypeMain {
		t.Errorf("Session 2 type = %q, want %q", correctedTypes[7001], sessionTypeMain)
	}

	// Family camp stays family (non-main types are exempt)
	if correctedTypes[7002] != "family" {
		t.Errorf("Family Camp type = %q, want %q", correctedTypes[7002], "family")
	}

	// No parent IDs should be set
	if parentIDs[7001] != 0 || parentIDs[7002] != 0 {
		t.Errorf("No parent IDs should be set for non-main types")
	}
}

// TestReclassifyOverlappingSessions_MissingDates tests that sessions without dates
// are skipped in reclassification
func TestReclassifyOverlappingSessions_MissingDates(t *testing.T) {
	s := &SessionsSync{}

	sessions := []map[string]interface{}{
		{
			"ID":        float64(8001),
			"Name":      "Session 2",
			"StartDate": "2025-06-15T00:00:00Z",
			"EndDate":   "2025-07-13T00:00:00Z",
		},
		{
			"ID":   float64(8002),
			"Name": "No Dates Session",
			// Missing StartDate and EndDate
		},
	}

	initialTypes := map[int]string{
		8001: sessionTypeMain,
		8002: sessionTypeMain,
	}

	correctedTypes, parentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Session 2 stays main
	if correctedTypes[8001] != sessionTypeMain {
		t.Errorf("Session 2 type = %q, want %q", correctedTypes[8001], sessionTypeMain)
	}

	// No Dates Session keeps its original type (skipped)
	if correctedTypes[8002] != sessionTypeMain {
		t.Errorf("No Dates Session type = %q, want %q", correctedTypes[8002], sessionTypeMain)
	}

	// No parent IDs
	if parentIDs[8001] != 0 || parentIDs[8002] != 0 {
		t.Errorf("No parent IDs should be set")
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
			expected: sessionTypeEmbedded,
		},
		{
			name:     "session 3b embedded",
			input:    "Session 3b",
			expected: sessionTypeEmbedded,
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

// TestGetSessionTypeFromGroupID tests that session group cm_ids map to correct session types
// Session groups are stable across all years, making this classification reliable for historical data
func TestGetSessionTypeFromGroupID(t *testing.T) {
	s := &SessionsSync{}

	tests := []struct {
		name        string
		groupCMID   int
		sessionName string
		expected    string
	}{
		// Summer Camp group (937) - returns "summer_candidate" for further refinement
		{
			name:        "summer camp group returns summer_candidate",
			groupCMID:   groupSummerCamp,
			sessionName: "Session 2",
			expected:    "summer_candidate",
		},
		// Family Camp group (940)
		{
			name:        "family camp group",
			groupCMID:   groupFamilyCamp,
			sessionName: "Family Camp 1",
			expected:    "family",
		},
		// Quest group (938)
		{
			name:        "quest group",
			groupCMID:   groupQuests,
			sessionName: "Quest 2025",
			expected:    "quest",
		},
		// Teen Leadership group (939) - needs name refinement
		{
			name:        "leadership group TLI",
			groupCMID:   groupLeadership,
			sessionName: "Teen Leadership Institute",
			expected:    "tli",
		},
		{
			name:        "leadership group CIT",
			groupCMID:   groupLeadership,
			sessionName: "Counselor In-Training",
			expected:    "training",
		},
		{
			name:        "leadership group SIT",
			groupCMID:   groupLeadership,
			sessionName: "Specialist In-Training",
			expected:    "training",
		},
		// Teen Retreat group (4447)
		{
			name:        "teen retreat group",
			groupCMID:   groupTeenRetreat,
			sessionName: "Teen Winter Retreat",
			expected:    "teen",
		},
		// B'Mitzvah/Hebrew group (4445) - needs name refinement
		{
			name:        "bmitzvah hebrew group - bmitzvah",
			groupCMID:   groupBMitzvahHebrew,
			sessionName: "B*Mitzvah Program",
			expected:    "bmitzvah",
		},
		{
			name:        "bmitzvah hebrew group - hebrew",
			groupCMID:   groupBMitzvahHebrew,
			sessionName: "Hebrew Lessons",
			expected:    "hebrew",
		},
		// Adult group (11600)
		{
			name:        "adult group",
			groupCMID:   groupAdult,
			sessionName: "Adults Unplugged",
			expected:    "adult",
		},
		// Family School group (12165)
		{
			name:        "family school group",
			groupCMID:   groupFamilySchool,
			sessionName: "Family School Weekend",
			expected:    "school",
		},
		// Unknown group defaults to other
		{
			name:        "unknown group defaults to other",
			groupCMID:   99999,
			sessionName: "Unknown Session",
			expected:    "other",
		},
		// Zero group ID defaults to other
		{
			name:        "zero group defaults to other",
			groupCMID:   0,
			sessionName: "No Group Session",
			expected:    "other",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := s.getSessionTypeFromGroupID(tt.groupCMID, tt.sessionName)
			if got != tt.expected {
				t.Errorf("getSessionTypeFromGroupID(%d, %q) = %q, want %q",
					tt.groupCMID, tt.sessionName, got, tt.expected)
			}
		})
	}
}

// TestRefineSummerSessionType tests that summer camp sessions are correctly classified
// as main, ag, or embedded based on name and date patterns
func TestRefineSummerSessionType(t *testing.T) {
	s := &SessionsSync{}

	// Build a list of all sessions for AG detection (AG needs matching dates with another session)
	allSessions := []sessionInfo{
		{cmID: 1001, name: "Session 2", startDate: "2025-06-15", endDate: "2025-07-13"},
		{cmID: 1002, name: "All-Gender Cabin-Session 2", startDate: "2025-06-15", endDate: "2025-07-13"},
		{cmID: 1003, name: "Session 2a", startDate: "2025-06-15", endDate: "2025-06-25"},
		// 2021-style naming
		{cmID: 2001, name: "Session A", startDate: "2021-06-20", endDate: "2021-07-11"},
		{cmID: 2002, name: "Session B (All-Gender Cabins)", startDate: "2021-07-12", endDate: "2021-08-01"},
		{cmID: 2003, name: "Session B", startDate: "2021-07-12", endDate: "2021-08-01"},
		// 2022-style naming with grade suffixes
		{cmID: 3001, name: "Session 4", startDate: "2022-07-24", endDate: "2022-08-13"},
		{cmID: 3002, name: "Session 4 (All-Gender Cabin)-6th & 7th grades", startDate: "2022-07-24", endDate: "2022-08-13"},
		// Taste of Camp with AG
		{cmID: 4001, name: "A Taste of Camp 2021", startDate: "2021-06-15", endDate: "2021-06-19"},
		{cmID: 4002, name: "A Taste of Camp 2021 (All-Gender Cabin)", startDate: "2021-06-15", endDate: "2021-06-19"},
	}

	tests := []struct {
		name     string
		session  sessionInfo
		expected string
	}{
		// Current naming patterns
		{
			name:     "Session 2 is main",
			session:  sessionInfo{cmID: 1001, name: "Session 2", startDate: "2025-06-15", endDate: "2025-07-13"},
			expected: "main",
		},
		{
			name: "All-Gender Cabin-Session 2 is ag (current naming)",
			session: sessionInfo{
				cmID: 1002, name: "All-Gender Cabin-Session 2",
				startDate: "2025-06-15", endDate: "2025-07-13",
			},
			expected: "ag",
		},
		{
			name:     "Session 2a is embedded",
			session:  sessionInfo{cmID: 1003, name: "Session 2a", startDate: "2025-06-15", endDate: "2025-06-25"},
			expected: "embedded",
		},
		// 2021-style historical naming
		{
			name:     "Session A (2021) is main",
			session:  sessionInfo{cmID: 2001, name: "Session A", startDate: "2021-06-20", endDate: "2021-07-11"},
			expected: "main",
		},
		{
			name:     "Session B (2021) is main",
			session:  sessionInfo{cmID: 2003, name: "Session B", startDate: "2021-07-12", endDate: "2021-08-01"},
			expected: "main",
		},
		{
			name: "Session B (All-Gender Cabins) (2021) is ag",
			session: sessionInfo{
				cmID: 2002, name: "Session B (All-Gender Cabins)",
				startDate: "2021-07-12", endDate: "2021-08-01",
			},
			expected: "ag",
		},
		// 2022-style naming with grade suffixes
		{
			name:     "Session 4 (2022) is main",
			session:  sessionInfo{cmID: 3001, name: "Session 4", startDate: "2022-07-24", endDate: "2022-08-13"},
			expected: "main",
		},
		{
			name: "Session 4 (All-Gender Cabin)-6th & 7th grades is ag",
			session: sessionInfo{
				cmID: 3002, name: "Session 4 (All-Gender Cabin)-6th & 7th grades",
				startDate: "2022-07-24", endDate: "2022-08-13",
			},
			expected: "ag",
		},
		// Taste of Camp variations
		{
			name:     "A Taste of Camp 2021 is main",
			session:  sessionInfo{cmID: 4001, name: "A Taste of Camp 2021", startDate: "2021-06-15", endDate: "2021-06-19"},
			expected: "main",
		},
		{
			name: "A Taste of Camp 2021 (All-Gender Cabin) is ag",
			session: sessionInfo{
				cmID: 4002, name: "A Taste of Camp 2021 (All-Gender Cabin)",
				startDate: "2021-06-15", endDate: "2021-06-19",
			},
			expected: "ag",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := s.refineSummerSessionType(tt.session, allSessions)
			if got != tt.expected {
				t.Errorf("refineSummerSessionType(%q) = %q, want %q",
					tt.session.name, got, tt.expected)
			}
		})
	}
}

// TestIsAGSession tests the AG session detection logic using date matching + "gender" keyword
func TestIsAGSession(t *testing.T) {
	s := &SessionsSync{}

	// Sessions for date matching
	allSessions := []sessionInfo{
		{cmID: 1001, name: "Session 2", startDate: "2025-06-15", endDate: "2025-07-13"},
		{cmID: 1002, name: "Session B", startDate: "2021-07-12", endDate: "2021-08-01"},
		{cmID: 1003, name: "Taste of Camp", startDate: "2025-06-15", endDate: "2025-06-20"},
	}

	tests := []struct {
		name     string
		session  sessionInfo
		expected bool
	}{
		// AG sessions - contain "gender" and have matching dates
		{
			name:     "All-Gender Cabin-Session 2 is AG",
			session:  sessionInfo{name: "All-Gender Cabin-Session 2", startDate: "2025-06-15", endDate: "2025-07-13"},
			expected: true,
		},
		{
			name:     "Session B (All-Gender Cabins) is AG",
			session:  sessionInfo{name: "Session B (All-Gender Cabins)", startDate: "2021-07-12", endDate: "2021-08-01"},
			expected: true,
		},
		{
			name: "Session 4 (All-Gender Cabin)-6th & 7th grades is AG",
			session: sessionInfo{
				name:      "Session 4 (All-Gender Cabin)-6th & 7th grades",
				startDate: "2025-06-15", endDate: "2025-07-13",
			},
			expected: true,
		},
		// Not AG - no "gender" in name
		{
			name:     "Session 2 is not AG",
			session:  sessionInfo{name: "Session 2", startDate: "2025-06-15", endDate: "2025-07-13"},
			expected: false,
		},
		{
			name:     "Taste of Camp is not AG",
			session:  sessionInfo{name: "Taste of Camp", startDate: "2025-06-15", endDate: "2025-06-20"},
			expected: false,
		},
		// Not AG - has "gender" but no matching dates with another session
		{
			name:     "All-Gender standalone (no matching dates) is not AG",
			session:  sessionInfo{name: "All-Gender Special Session", startDate: "2025-08-01", endDate: "2025-08-10"},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := s.isAGSession(tt.session, allSessions)
			if got != tt.expected {
				t.Errorf("isAGSession(%q) = %v, want %v",
					tt.session.name, got, tt.expected)
			}
		})
	}
}
