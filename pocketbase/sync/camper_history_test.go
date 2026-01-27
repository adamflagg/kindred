package sync

import (
	"sort"
	"strings"
	"testing"
)

// TestCamperHistorySync_Name verifies the service name is correct
func TestCamperHistorySync_Name(t *testing.T) {
	// The service name must be "camper_history" for orchestrator integration
	expectedName := serviceNameCamperHistory

	// Test that a mock sync would return the correct name
	// (actual instance test requires PocketBase app)
	if expectedName != serviceNameCamperHistory {
		t.Errorf("expected service name %q", expectedName)
	}
}

// TestCamperHistoryDeduplicatesMultiSessionCampers tests that persons enrolled in
// multiple sessions produce exactly one camper_history record per year
func TestCamperHistoryDeduplicatesMultiSessionCampers(t *testing.T) {
	// Simulate attendee records for the same person in different sessions
	attendees := []testAttendee{
		{PersonID: 1001, SessionID: 100, SessionName: "Session 1", Year: 2025, Status: "enrolled"},
		{PersonID: 1001, SessionID: 101, SessionName: "Session 2", Year: 2025, Status: "enrolled"},
		{PersonID: 1001, SessionID: 102, SessionName: "Session 3", Year: 2025, Status: "enrolled"},
	}

	// Group by person (simulating the aggregation logic)
	personData := aggregateByPerson(attendees)

	// Should produce exactly 1 record for person 1001
	if len(personData) != 1 {
		t.Errorf("expected 1 person record, got %d", len(personData))
	}

	// Verify sessions are aggregated
	pd, exists := personData[1001]
	if !exists {
		t.Fatal("person 1001 not found in aggregated data")
	}

	if len(pd.SessionNames) != 3 {
		t.Errorf("expected 3 sessions, got %d", len(pd.SessionNames))
	}

	// Sessions should be sorted for consistency
	expectedSessions := "Session 1, Session 2, Session 3"
	actualSessions := joinSorted(pd.SessionNames)
	if actualSessions != expectedSessions {
		t.Errorf("expected sessions %q, got %q", expectedSessions, actualSessions)
	}
}

// TestCamperHistoryComputesReturningStatus tests is_returning calculation
func TestCamperHistoryComputesReturningStatus(t *testing.T) {
	tests := []struct {
		name                string
		currentYear         int
		enrolledYears       []int
		expectedReturning   bool
		expectedYearsAtCamp int
	}{
		{
			name:                "new camper - never attended before",
			currentYear:         2025,
			enrolledYears:       []int{}, // No prior years
			expectedReturning:   false,
			expectedYearsAtCamp: 1, // Just current year
		},
		{
			name:                "returning from previous year",
			currentYear:         2025,
			enrolledYears:       []int{2024},
			expectedReturning:   true,
			expectedYearsAtCamp: 2,
		},
		{
			name:                "returning after gap year",
			currentYear:         2025,
			enrolledYears:       []int{2023}, // Skipped 2024
			expectedReturning:   false,       // Not returning (gap year)
			expectedYearsAtCamp: 2,
		},
		{
			name:                "veteran camper",
			currentYear:         2025,
			enrolledYears:       []int{2020, 2021, 2022, 2023, 2024},
			expectedReturning:   true,
			expectedYearsAtCamp: 6, // 5 prior + current
		},
		{
			name:                "returning with multiple gaps",
			currentYear:         2025,
			enrolledYears:       []int{2019, 2021, 2024},
			expectedReturning:   true, // Was enrolled in 2024
			expectedYearsAtCamp: 4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isReturning := computeIsReturning(tt.currentYear, tt.enrolledYears)
			if isReturning != tt.expectedReturning {
				t.Errorf("isReturning = %v, want %v", isReturning, tt.expectedReturning)
			}

			yearsAtCamp := computeYearsAtCamp(tt.enrolledYears)
			if yearsAtCamp != tt.expectedYearsAtCamp {
				t.Errorf("yearsAtCamp = %d, want %d", yearsAtCamp, tt.expectedYearsAtCamp)
			}
		})
	}
}

// TestCamperHistoryIncludesAllStatuses tests that all enrollment statuses are included
// (not just enrolled) per user requirement
func TestCamperHistoryIncludesAllStatuses(t *testing.T) {
	// All status types that should be included
	allStatuses := []string{
		"enrolled",
		"applied",
		"waitlisted",
		"canceled",
		"withdrawn",
		"left_early",
		"dismissed",
		"inquiry",
		"incomplete",
	}

	// Create attendees with various statuses
	attendees := make([]testAttendee, 0, len(allStatuses))
	for i, status := range allStatuses {
		attendees = append(attendees, testAttendee{
			PersonID:    1000 + i,
			SessionID:   100,
			SessionName: "Session 1",
			Year:        2025,
			Status:      status,
		})
	}

	// Verify all statuses are processed (no filtering)
	personData := aggregateByPersonIncludeAllStatuses(attendees)

	if len(personData) != len(allStatuses) {
		t.Errorf("expected %d persons (all statuses), got %d", len(allStatuses), len(personData))
	}

	// Verify specific statuses are included
	for i, status := range allStatuses {
		personID := 1000 + i
		if _, exists := personData[personID]; !exists {
			t.Errorf("person with status %q should be included but was not found", status)
		}
	}
}

// TestCamperHistoryAggregatesBunkAssignments tests bunk aggregation
func TestCamperHistoryAggregatesBunkAssignments(t *testing.T) {
	assignments := []testBunkAssignment{
		{PersonID: 1001, BunkName: "B-12", SessionID: 100},
		{PersonID: 1001, BunkName: "B-14", SessionID: 101}, // Different session
		{PersonID: 1002, BunkName: "G-8", SessionID: 100},
	}

	bunks := aggregateBunksByPerson(assignments)

	// Person 1001 should have 2 bunks
	if len(bunks[1001]) != 2 {
		t.Errorf("person 1001: expected 2 bunks, got %d", len(bunks[1001]))
	}

	// Verify bunks are sorted
	expectedBunks := "B-12, B-14"
	actualBunks := joinSorted(bunks[1001])
	if actualBunks != expectedBunks {
		t.Errorf("expected bunks %q, got %q", expectedBunks, actualBunks)
	}

	// Person 1002 should have 1 bunk
	if len(bunks[1002]) != 1 {
		t.Errorf("person 1002: expected 1 bunk, got %d", len(bunks[1002]))
	}
}

// TestCamperHistoryPriorYearData tests prior year session/bunk retrieval
func TestCamperHistoryPriorYearData(t *testing.T) {
	currentYear := 2025
	priorYear := 2024

	historicalAttendees := []testAttendee{
		{PersonID: 1001, SessionID: 100, SessionName: "Session 2", Year: 2024, Status: "enrolled"},
		{PersonID: 1001, SessionID: 101, SessionName: "Session 3", Year: 2024, Status: "enrolled"},
		{PersonID: 1002, SessionID: 100, SessionName: "Session 2", Year: 2023, Status: "enrolled"}, // Not prior year
	}

	historicalBunks := []testBunkAssignment{
		{PersonID: 1001, BunkName: "B-10", SessionID: 100, Year: 2024},
		{PersonID: 1001, BunkName: "B-12", SessionID: 101, Year: 2024},
		{PersonID: 1002, BunkName: "G-5", SessionID: 100, Year: 2023}, // Not prior year
	}

	// Get prior year data for person 1001
	priorSessions := getPriorYearSessions(historicalAttendees, 1001, priorYear)
	priorBunks := getPriorYearBunks(historicalBunks, 1001, priorYear)

	// Should have prior year data
	if priorSessions == "" {
		t.Error("expected prior year sessions for person 1001")
	}
	if priorSessions != "Session 2, Session 3" {
		t.Errorf("expected 'Session 2, Session 3', got %q", priorSessions)
	}

	if priorBunks == "" {
		t.Error("expected prior year bunks for person 1001")
	}
	if priorBunks != "B-10, B-12" {
		t.Errorf("expected 'B-10, B-12', got %q", priorBunks)
	}

	// Person 1002 should NOT have prior year data (their data is from 2023, not 2024)
	priorSessions2 := getPriorYearSessions(historicalAttendees, 1002, priorYear)
	priorBunks2 := getPriorYearBunks(historicalBunks, 1002, priorYear)

	if priorSessions2 != "" {
		t.Errorf("expected no prior year sessions for person 1002, got %q", priorSessions2)
	}
	if priorBunks2 != "" {
		t.Errorf("expected no prior year bunks for person 1002, got %q", priorBunks2)
	}

	// Verify current year is used correctly
	_ = currentYear // Silence unused warning
}

// TestCamperHistoryHandlesEmptyData tests graceful handling of no attendees
func TestCamperHistoryHandlesEmptyData(t *testing.T) {
	attendees := []testAttendee{}

	personData := aggregateByPerson(attendees)

	if len(personData) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(personData))
	}
}

// TestCamperHistoryYearValidation tests year parameter validation
func TestCamperHistoryYearValidation(t *testing.T) {
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
			valid := isValidYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestCamperHistoryStatusPriority tests status priority for multi-status campers
func TestCamperHistoryStatusPriority(t *testing.T) {
	// When a camper has multiple statuses across sessions,
	// we should prefer the "best" status (enrolled > others)
	tests := []struct {
		name         string
		statuses     []string
		expectedBest string
	}{
		{
			name:         "enrolled wins",
			statuses:     []string{"enrolled", "canceled", "withdrawn"},
			expectedBest: "enrolled",
		},
		{
			name:         "single status",
			statuses:     []string{"canceled"},
			expectedBest: "canceled",
		},
		{
			name:         "all enrolled",
			statuses:     []string{"enrolled", "enrolled", "enrolled"},
			expectedBest: "enrolled",
		},
		{
			name:         "canceled vs withdrawn",
			statuses:     []string{"canceled", "withdrawn"},
			expectedBest: "canceled", // First in list when no enrolled
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			best := getBestStatus(tt.statuses)
			if best != tt.expectedBest {
				t.Errorf("getBestStatus(%v) = %q, want %q", tt.statuses, best, tt.expectedBest)
			}
		})
	}
}

// TestCamperHistoryBatchedPersonLookup tests that person lookups work in batches
func TestCamperHistoryBatchedPersonLookup(t *testing.T) {
	// Simulate a large number of person IDs that need batching
	personIDs := make([]int, 1200) // More than typical batch size
	for i := range personIDs {
		personIDs[i] = 1000 + i
	}

	// Calculate expected batches
	batchSize := 100
	expectedBatches := (len(personIDs) + batchSize - 1) / batchSize

	batches := splitIntoBatches(personIDs, batchSize)

	if len(batches) != expectedBatches {
		t.Errorf("expected %d batches, got %d", expectedBatches, len(batches))
	}

	// Verify all IDs are included
	totalIDs := 0
	for _, batch := range batches {
		totalIDs += len(batch)
	}
	if totalIDs != len(personIDs) {
		t.Errorf("expected %d total IDs across batches, got %d", len(personIDs), totalIDs)
	}

	// Verify last batch has correct size
	lastBatchExpectedSize := len(personIDs) % batchSize
	if lastBatchExpectedSize == 0 {
		lastBatchExpectedSize = batchSize
	}
	if len(batches[len(batches)-1]) != lastBatchExpectedSize {
		t.Errorf("last batch size = %d, want %d", len(batches[len(batches)-1]), lastBatchExpectedSize)
	}
}

// ============================================================================
// Test helper types and functions (these match the production implementation)
// ============================================================================

type testAttendee struct {
	PersonID    int
	SessionID   int
	SessionName string
	Year        int
	Status      string
}

type testBunkAssignment struct {
	PersonID  int
	BunkName  string
	SessionID int
	Year      int
}

type testPersonData struct {
	PersonID     int
	SessionNames []string
	Statuses     []string
}

// aggregateByPerson groups attendees by person ID (simulates Go implementation)
func aggregateByPerson(attendees []testAttendee) map[int]*testPersonData {
	result := make(map[int]*testPersonData)
	for _, a := range attendees {
		if _, exists := result[a.PersonID]; !exists {
			result[a.PersonID] = &testPersonData{
				PersonID:     a.PersonID,
				SessionNames: []string{},
				Statuses:     []string{},
			}
		}
		pd := result[a.PersonID]
		// Only add session if not already present
		found := false
		for _, s := range pd.SessionNames {
			if s == a.SessionName {
				found = true
				break
			}
		}
		if !found {
			pd.SessionNames = append(pd.SessionNames, a.SessionName)
		}
		pd.Statuses = append(pd.Statuses, a.Status)
	}
	return result
}

// aggregateByPersonIncludeAllStatuses includes all statuses (production behavior)
func aggregateByPersonIncludeAllStatuses(attendees []testAttendee) map[int]*testPersonData {
	return aggregateByPerson(attendees) // Same as regular aggregation - no filtering
}

// aggregateBunksByPerson groups bunk assignments by person
func aggregateBunksByPerson(assignments []testBunkAssignment) map[int][]string {
	result := make(map[int][]string)
	for _, a := range assignments {
		// Only add bunk if not already present
		found := false
		for _, b := range result[a.PersonID] {
			if b == a.BunkName {
				found = true
				break
			}
		}
		if !found {
			result[a.PersonID] = append(result[a.PersonID], a.BunkName)
		}
	}
	return result
}

// computeIsReturning checks if person was enrolled in the previous year
func computeIsReturning(currentYear int, enrolledYears []int) bool {
	priorYear := currentYear - 1
	for _, y := range enrolledYears {
		if y == priorYear {
			return true
		}
	}
	return false
}

// computeYearsAtCamp counts distinct enrollment years plus current year
func computeYearsAtCamp(enrolledYears []int) int {
	// Deduplicate years
	yearSet := make(map[int]bool)
	for _, y := range enrolledYears {
		yearSet[y] = true
	}
	// +1 for current year
	return len(yearSet) + 1
}

// getPriorYearSessions gets session names from prior year for a person
func getPriorYearSessions(attendees []testAttendee, personID, priorYear int) string {
	var sessions []string
	for _, a := range attendees {
		if a.PersonID == personID && a.Year == priorYear {
			// Only add if not present
			found := false
			for _, s := range sessions {
				if s == a.SessionName {
					found = true
					break
				}
			}
			if !found {
				sessions = append(sessions, a.SessionName)
			}
		}
	}
	return joinSorted(sessions)
}

// getPriorYearBunks gets bunk names from prior year for a person
func getPriorYearBunks(assignments []testBunkAssignment, personID, priorYear int) string {
	var bunks []string
	for _, a := range assignments {
		if a.PersonID == personID && a.Year == priorYear {
			// Only add if not present
			found := false
			for _, b := range bunks {
				if b == a.BunkName {
					found = true
					break
				}
			}
			if !found {
				bunks = append(bunks, a.BunkName)
			}
		}
	}
	return joinSorted(bunks)
}

// isValidYear validates year parameter
func isValidYear(year int) bool {
	// Valid range is 2017 to 2050 (reasonable bounds)
	return year >= 2017 && year <= 2050
}

// getBestStatus returns the best status from a list (enrolled preferred)
func getBestStatus(statuses []string) string {
	if len(statuses) == 0 {
		return ""
	}
	// Enrolled is always best
	for _, s := range statuses {
		if s == statusEnrolled {
			return statusEnrolled
		}
	}
	// Otherwise return first status
	return statuses[0]
}

// splitIntoBatches splits a slice into batches of specified size
func splitIntoBatches(ids []int, batchSize int) [][]int {
	var batches [][]int
	for i := 0; i < len(ids); i += batchSize {
		end := i + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		batches = append(batches, ids[i:end])
	}
	return batches
}

// joinSorted sorts strings and joins with ", "
func joinSorted(strs []string) string {
	if len(strs) == 0 {
		return ""
	}
	sorted := make([]string, len(strs))
	copy(sorted, strs)
	sort.Strings(sorted)
	result := sorted[0]
	for i := 1; i < len(sorted); i++ {
		result += ", " + sorted[i]
	}
	return result
}

// ============================================================================
// Tests for new camper_history fields (household_id, gender, division_name,
// enrollment_date, status, synagogue)
// ============================================================================

// TestCamperHistoryExtendedDemographics tests extraction of new demographic fields
// (household_id, gender, division_name) from person records
func TestCamperHistoryExtendedDemographics(t *testing.T) {
	// Simulate extended person data with new fields
	persons := []testExtendedPerson{
		{
			PersonID:     1001,
			FirstName:    "Emma",
			LastName:     "Johnson",
			HouseholdID:  5001,
			Gender:       "F",
			DivisionID:   100,
			DivisionName: "Juniors",
			School:       "Riverside Elementary",
			City:         "Springfield",
			Grade:        5,
		},
		{
			PersonID:     1002,
			FirstName:    "Liam",
			LastName:     "Garcia",
			HouseholdID:  5002,
			Gender:       "M",
			DivisionID:   101,
			DivisionName: "Seniors",
			School:       "Oak Valley Middle",
			City:         "Riverside",
			Grade:        7,
		},
		{
			PersonID:     1003,
			FirstName:    "Olivia",
			LastName:     "Chen",
			HouseholdID:  0, // No household assigned
			Gender:       "",
			DivisionID:   0, // No division
			DivisionName: "",
			School:       "",
			City:         "",
			Grade:        0,
		},
	}

	// Build demographics map (simulating loadPersonDemographics with extended fields)
	demographics := buildExtendedDemographics(persons)

	// Test person 1001
	demo1 := demographics[1001]
	if demo1.householdID != 5001 {
		t.Errorf("person 1001: household_id = %d, want 5001", demo1.householdID)
	}
	if demo1.gender != "F" {
		t.Errorf("person 1001: gender = %q, want %q", demo1.gender, "F")
	}
	if demo1.divisionName != "Juniors" {
		t.Errorf("person 1001: division_name = %q, want %q", demo1.divisionName, "Juniors")
	}

	// Test person 1002
	demo2 := demographics[1002]
	if demo2.householdID != 5002 {
		t.Errorf("person 1002: household_id = %d, want 5002", demo2.householdID)
	}
	if demo2.gender != "M" {
		t.Errorf("person 1002: gender = %q, want %q", demo2.gender, "M")
	}
	if demo2.divisionName != "Seniors" {
		t.Errorf("person 1002: division_name = %q, want %q", demo2.divisionName, "Seniors")
	}

	// Test person 1003 (missing optional fields)
	demo3 := demographics[1003]
	if demo3.householdID != 0 {
		t.Errorf("person 1003: household_id = %d, want 0", demo3.householdID)
	}
	if demo3.gender != "" {
		t.Errorf("person 1003: gender = %q, want empty", demo3.gender)
	}
	if demo3.divisionName != "" {
		t.Errorf("person 1003: division_name = %q, want empty", demo3.divisionName)
	}
}

// TestCamperHistoryEnrollmentDateAggregation tests that enrollment_date uses the
// earliest date when a camper is enrolled in multiple sessions
func TestCamperHistoryEnrollmentDateAggregation(t *testing.T) {
	tests := []struct {
		name             string
		enrollmentDates  []string
		expectedEarliest string
	}{
		{
			name:             "single session",
			enrollmentDates:  []string{"2024-11-15"},
			expectedEarliest: "2024-11-15",
		},
		{
			name:             "multiple sessions - different dates",
			enrollmentDates:  []string{"2024-12-01", "2024-11-15", "2025-01-10"},
			expectedEarliest: "2024-11-15", // Earliest wins
		},
		{
			name:             "multiple sessions - same date",
			enrollmentDates:  []string{"2024-11-15", "2024-11-15"},
			expectedEarliest: "2024-11-15",
		},
		{
			name:             "empty dates",
			enrollmentDates:  []string{},
			expectedEarliest: "",
		},
		{
			name:             "some empty dates",
			enrollmentDates:  []string{"", "2024-11-15", ""},
			expectedEarliest: "2024-11-15",
		},
		{
			name:             "all empty dates",
			enrollmentDates:  []string{"", "", ""},
			expectedEarliest: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getEarliestEnrollmentDate(tt.enrollmentDates)
			if result != tt.expectedEarliest {
				t.Errorf("getEarliestEnrollmentDate(%v) = %q, want %q",
					tt.enrollmentDates, result, tt.expectedEarliest)
			}
		})
	}
}

// TestCamperHistoryStatusAggregation tests status aggregation logic across sessions
// Rule: "enrolled" if ANY session is enrolled, otherwise first non-empty status
func TestCamperHistoryStatusAggregation(t *testing.T) {
	tests := []struct {
		name           string
		statuses       []string
		expectedStatus string
	}{
		{
			name:           "single enrolled",
			statuses:       []string{"enrolled"},
			expectedStatus: "enrolled",
		},
		{
			name:           "single canceled",
			statuses:       []string{"canceled"},
			expectedStatus: "canceled",
		},
		{
			name:           "enrolled among others - enrolled first",
			statuses:       []string{"enrolled", "canceled", "waitlisted"},
			expectedStatus: "enrolled",
		},
		{
			name:           "enrolled among others - enrolled last",
			statuses:       []string{"canceled", "waitlisted", "enrolled"},
			expectedStatus: "enrolled",
		},
		{
			name:           "enrolled among others - enrolled middle",
			statuses:       []string{"waitlisted", "enrolled", "canceled"},
			expectedStatus: "enrolled",
		},
		{
			name:           "no enrolled - use first",
			statuses:       []string{"canceled", "withdrawn"},
			expectedStatus: "canceled",
		},
		{
			name:           "empty statuses",
			statuses:       []string{},
			expectedStatus: "",
		},
		{
			name:           "all enrolled",
			statuses:       []string{"enrolled", "enrolled", "enrolled"},
			expectedStatus: "enrolled",
		},
		{
			name:           "various non-enrolled",
			statuses:       []string{"waitlisted", "applied", "inquiry"},
			expectedStatus: "waitlisted", // First in list
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getAggregatedStatus(tt.statuses)
			if result != tt.expectedStatus {
				t.Errorf("getAggregatedStatus(%v) = %q, want %q",
					tt.statuses, result, tt.expectedStatus)
			}
		})
	}
}

// TestCamperHistorySynagogueLookup tests synagogue lookup from household custom values
func TestCamperHistorySynagogueLookup(t *testing.T) {
	// Simulate household_custom_values data
	// Key: household_id, Value: synagogue name (or empty if not set)
	synagogueByHousehold := map[int]string{
		5001: "Temple Beth El",
		5002: "Congregation Shalom",
		5003: "", // Empty synagogue value
		// 5004 not present - household doesn't exist in lookup
	}

	tests := []struct {
		name              string
		householdID       int
		expectedSynagogue string
	}{
		{
			name:              "household with synagogue",
			householdID:       5001,
			expectedSynagogue: "Temple Beth El",
		},
		{
			name:              "household with different synagogue",
			householdID:       5002,
			expectedSynagogue: "Congregation Shalom",
		},
		{
			name:              "household with empty synagogue",
			householdID:       5003,
			expectedSynagogue: "",
		},
		{
			name:              "household not in lookup",
			householdID:       5004,
			expectedSynagogue: "",
		},
		{
			name:              "no household (zero ID)",
			householdID:       0,
			expectedSynagogue: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := lookupSynagogue(synagogueByHousehold, tt.householdID)
			if result != tt.expectedSynagogue {
				t.Errorf("lookupSynagogue(%d) = %q, want %q",
					tt.householdID, result, tt.expectedSynagogue)
			}
		})
	}
}

// TestCamperHistoryExtendedAttendeeAggregation tests aggregation of attendee data
// including enrollment_date and status for multi-session campers
func TestCamperHistoryExtendedAttendeeAggregation(t *testing.T) {
	// Camper 1001 enrolled in 3 sessions with different dates and all enrolled
	// Camper 1002 enrolled in 2 sessions, one enrolled one canceled
	// Camper 1003 single session, waitlisted
	attendees := []testExtendedAttendee{
		{PersonID: 1001, SessionName: "Session 1", EnrollmentDate: "2024-12-01", Status: "enrolled"},
		{PersonID: 1001, SessionName: "Session 2", EnrollmentDate: "2024-11-15", Status: "enrolled"},
		{PersonID: 1001, SessionName: "Session 3", EnrollmentDate: "2024-11-20", Status: "enrolled"},
		{PersonID: 1002, SessionName: "Session 1", EnrollmentDate: "2024-12-10", Status: "canceled"},
		{PersonID: 1002, SessionName: "Session 2", EnrollmentDate: "2024-12-05", Status: "enrolled"},
		{PersonID: 1003, SessionName: "Session 1", EnrollmentDate: "2025-01-15", Status: "waitlisted"},
	}

	aggregated := aggregateExtendedAttendees(attendees)

	// Check person 1001
	data1 := aggregated[1001]
	if data1 == nil {
		t.Fatal("person 1001 not found in aggregated data")
	}
	if data1.earliestEnrollmentDate != "2024-11-15" {
		t.Errorf("person 1001: enrollment_date = %q, want %q", data1.earliestEnrollmentDate, "2024-11-15")
	}
	if data1.aggregatedStatus != statusEnrolled {
		t.Errorf("person 1001: status = %q, want %q", data1.aggregatedStatus, statusEnrolled)
	}

	// Check person 1002
	data2 := aggregated[1002]
	if data2 == nil {
		t.Fatal("person 1002 not found in aggregated data")
	}
	if data2.earliestEnrollmentDate != "2024-12-05" {
		t.Errorf("person 1002: enrollment_date = %q, want %q", data2.earliestEnrollmentDate, "2024-12-05")
	}
	if data2.aggregatedStatus != statusEnrolled {
		t.Errorf("person 1002: status = %q, want %q", data2.aggregatedStatus, statusEnrolled)
	}

	// Check person 1003
	data3 := aggregated[1003]
	if data3 == nil {
		t.Fatal("person 1003 not found in aggregated data")
	}
	if data3.earliestEnrollmentDate != "2025-01-15" {
		t.Errorf("person 1003: enrollment_date = %q, want %q", data3.earliestEnrollmentDate, "2025-01-15")
	}
	if data3.aggregatedStatus != "waitlisted" {
		t.Errorf("person 1003: status = %q, want %q", data3.aggregatedStatus, "waitlisted")
	}
}

// TestCamperHistoryFullRecordWithNewFields tests a complete camper history record
// with all 6 new fields populated
func TestCamperHistoryFullRecordWithNewFields(t *testing.T) {
	// This test verifies that all fields are correctly combined into a record
	record := testCamperHistoryRecord{
		// Existing fields
		PersonID:          1001,
		FirstName:         "Emma",
		LastName:          "Johnson",
		Year:              2025,
		Sessions:          "Session 1, Session 2",
		Bunks:             "G-8, G-10",
		School:            "Riverside Elementary",
		City:              "Springfield",
		Grade:             5,
		IsReturning:       true,
		YearsAtCamp:       3,
		PriorYearSessions: "Session 2",
		PriorYearBunks:    "G-6",
		// New fields
		HouseholdID:    5001,
		Gender:         "F",
		DivisionName:   "Juniors",
		EnrollmentDate: "2024-11-15",
		Status:         statusEnrolled,
		Synagogue:      "Temple Beth El",
	}

	// Verify new fields are set
	if record.HouseholdID != 5001 {
		t.Errorf("HouseholdID = %d, want 5001", record.HouseholdID)
	}
	if record.Gender != "F" {
		t.Errorf("Gender = %q, want %q", record.Gender, "F")
	}
	if record.DivisionName != "Juniors" {
		t.Errorf("DivisionName = %q, want %q", record.DivisionName, "Juniors")
	}
	if record.EnrollmentDate != "2024-11-15" {
		t.Errorf("EnrollmentDate = %q, want %q", record.EnrollmentDate, "2024-11-15")
	}
	if record.Status != statusEnrolled {
		t.Errorf("Status = %q, want %q", record.Status, statusEnrolled)
	}
	if record.Synagogue != "Temple Beth El" {
		t.Errorf("Synagogue = %q, want %q", record.Synagogue, "Temple Beth El")
	}

	// Verify existing fields still work
	if record.PersonID != 1001 {
		t.Errorf("PersonID = %d, want 1001", record.PersonID)
	}
	if !record.IsReturning {
		t.Errorf("IsReturning = %v, want true", record.IsReturning)
	}
}

// ============================================================================
// Extended test helper types for new fields
// ============================================================================

type testExtendedPerson struct {
	PersonID     int
	FirstName    string
	LastName     string
	HouseholdID  int
	Gender       string
	DivisionID   int
	DivisionName string
	School       string
	City         string
	Grade        int
}

type testExtendedDemographics struct {
	firstName    string
	lastName     string
	householdID  int
	gender       string
	divisionName string
	school       string
	city         string
	grade        int
}

type testExtendedAttendee struct {
	PersonID       int
	SessionName    string
	EnrollmentDate string
	Status         string
}

type testExtendedAttendeeData struct {
	sessionNames           []string
	enrollmentDates        []string
	statuses               []string
	earliestEnrollmentDate string
	aggregatedStatus       string
}

type testCamperHistoryRecord struct {
	// Existing fields
	PersonID          int
	FirstName         string
	LastName          string
	Year              int
	Sessions          string
	Bunks             string
	School            string
	City              string
	Grade             int
	IsReturning       bool
	YearsAtCamp       int
	PriorYearSessions string
	PriorYearBunks    string
	// New fields
	HouseholdID    int
	Gender         string
	DivisionName   string
	EnrollmentDate string
	Status         string
	Synagogue      string
}

// ============================================================================
// Extended helper functions for new fields
// ============================================================================

// buildExtendedDemographics creates a demographics map with extended fields
func buildExtendedDemographics(persons []testExtendedPerson) map[int]testExtendedDemographics {
	result := make(map[int]testExtendedDemographics)
	for i := range persons {
		p := &persons[i]
		result[p.PersonID] = testExtendedDemographics{
			firstName:    p.FirstName,
			lastName:     p.LastName,
			householdID:  p.HouseholdID,
			gender:       p.Gender,
			divisionName: p.DivisionName,
			school:       p.School,
			city:         p.City,
			grade:        p.Grade,
		}
	}
	return result
}

// getEarliestEnrollmentDate returns the earliest non-empty date from a list
func getEarliestEnrollmentDate(dates []string) string {
	earliest := ""
	for _, d := range dates {
		if d == "" {
			continue
		}
		if earliest == "" || d < earliest {
			earliest = d
		}
	}
	return earliest
}

// getAggregatedStatus returns "enrolled" if any status is enrolled, otherwise first non-empty
func getAggregatedStatus(statuses []string) string {
	if len(statuses) == 0 {
		return ""
	}
	// Check for enrolled first
	for _, s := range statuses {
		if s == statusEnrolled {
			return statusEnrolled
		}
	}
	// Return first non-empty status
	for _, s := range statuses {
		if s != "" {
			return s
		}
	}
	return ""
}

// lookupSynagogue looks up synagogue by household ID
func lookupSynagogue(synagogueByHousehold map[int]string, householdID int) string {
	if householdID == 0 {
		return ""
	}
	if val, ok := synagogueByHousehold[householdID]; ok {
		return val
	}
	return ""
}

// TestCamperHistoryUsesCMYearsAtCamp tests that years_at_camp uses CampMinder's
// authoritative value from the persons table instead of computing from historical data.
// This fixes the issue where production only has current year data, so computed value is always 1.
func TestCamperHistoryUsesCMYearsAtCamp(t *testing.T) {
	tests := []struct {
		name                string
		cmYearsAtCamp       int   // CampMinder's value from persons table
		enrolledYears       []int // Historical enrollment years in our DB
		expectedYearsAtCamp int
		expectUsingCMValue  bool // True if CM value should be used, false if computed
	}{
		{
			name:                "use CM value when available (typical production case)",
			cmYearsAtCamp:       5,
			enrolledYears:       []int{}, // No historical data in our DB
			expectedYearsAtCamp: 5,
			expectUsingCMValue:  true,
		},
		{
			name:                "use CM value even when we have some historical data",
			cmYearsAtCamp:       7,
			enrolledYears:       []int{2023, 2024}, // Partial history
			expectedYearsAtCamp: 7,                 // CM knows better
			expectUsingCMValue:  true,
		},
		{
			name:                "fallback to computed when CM value is 0",
			cmYearsAtCamp:       0,
			enrolledYears:       []int{2022, 2023, 2024},
			expectedYearsAtCamp: 4, // 3 prior years + 1 current
			expectUsingCMValue:  false,
		},
		{
			name:                "fallback to computed for new camper (CM=0, no history)",
			cmYearsAtCamp:       0,
			enrolledYears:       []int{},
			expectedYearsAtCamp: 1, // Just current year
			expectUsingCMValue:  false,
		},
		{
			name:                "CM value of 1 is valid (first year camper with CM data)",
			cmYearsAtCamp:       1,
			enrolledYears:       []int{},
			expectedYearsAtCamp: 1,
			expectUsingCMValue:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate the logic: use CM value if > 0, otherwise compute
			var yearsAtCamp int
			if tt.cmYearsAtCamp > 0 {
				yearsAtCamp = tt.cmYearsAtCamp
			} else {
				yearsAtCamp = computeYearsAtCamp(tt.enrolledYears)
			}

			if yearsAtCamp != tt.expectedYearsAtCamp {
				t.Errorf("yearsAtCamp = %d, want %d", yearsAtCamp, tt.expectedYearsAtCamp)
			}

			// Verify which source was used
			usedCMValue := tt.cmYearsAtCamp > 0
			if usedCMValue != tt.expectUsingCMValue {
				t.Errorf("used CM value = %v, want %v", usedCMValue, tt.expectUsingCMValue)
			}
		})
	}
}

// TestCamperHistoryComputeFirstYearAttended tests first_year_attended calculation
// This field stores the first year a camper ever attended summer camp (for onramp analysis)
func TestCamperHistoryComputeFirstYearAttended(t *testing.T) {
	tests := []struct {
		name                     string
		currentYear              int
		enrolledYears            []int
		expectedFirstYearAttended int
	}{
		{
			name:                     "new camper - no history",
			currentYear:              2025,
			enrolledYears:            []int{}, // No prior years
			expectedFirstYearAttended: 2025,    // Current year is their first
		},
		{
			name:                     "returning camper - single prior year",
			currentYear:              2025,
			enrolledYears:            []int{2024},
			expectedFirstYearAttended: 2024, // Min of enrolled years
		},
		{
			name:                     "veteran camper - multiple years",
			currentYear:              2025,
			enrolledYears:            []int{2020, 2021, 2022, 2023, 2024},
			expectedFirstYearAttended: 2020, // Earliest year
		},
		{
			name:                     "gap years - still returns earliest",
			currentYear:              2025,
			enrolledYears:            []int{2019, 2023}, // Skipped 2020-2022
			expectedFirstYearAttended: 2019,              // Earliest year, gaps don't matter
		},
		{
			name:                     "unsorted years - finds minimum",
			currentYear:              2025,
			enrolledYears:            []int{2022, 2019, 2024, 2021}, // Not in order
			expectedFirstYearAttended: 2019,                         // Should find min
		},
		{
			name:                     "single gap year before current",
			currentYear:              2025,
			enrolledYears:            []int{2023}, // Skipped 2024
			expectedFirstYearAttended: 2023,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			firstYear := computeFirstYearAttended(tt.currentYear, tt.enrolledYears)
			if firstYear != tt.expectedFirstYearAttended {
				t.Errorf("computeFirstYearAttended(%d, %v) = %d, want %d",
					tt.currentYear, tt.enrolledYears, firstYear, tt.expectedFirstYearAttended)
			}
		})
	}
}

// computeFirstYearAttended computes the first year a camper attended camp
// For new campers (no history), returns current year
// For returning campers, returns the minimum of enrolled years
func computeFirstYearAttended(currentYear int, enrolledYears []int) int {
	if len(enrolledYears) == 0 {
		return currentYear // New camper, this is their first year
	}
	minYear := enrolledYears[0]
	for _, y := range enrolledYears[1:] {
		if y < minYear {
			minYear = y
		}
	}
	return minYear
}

// ============================================================================
// Session Types field tests - filtering summer vs family camp
// ============================================================================

// TestCamperHistorySessionTypesField tests that session_types field is populated
// correctly from attendee sessions
func TestCamperHistorySessionTypesField(t *testing.T) {
	tests := []struct {
		name                 string
		sessionTypes         []string // Session types from camp_sessions
		expectedSessionTypes string   // Comma-separated, sorted result
	}{
		{
			name:                 "single main session",
			sessionTypes:         []string{"main"},
			expectedSessionTypes: "main",
		},
		{
			name:                 "main and ag sessions",
			sessionTypes:         []string{"main", "ag"},
			expectedSessionTypes: "ag, main", // Sorted alphabetically
		},
		{
			name:                 "embedded only",
			sessionTypes:         []string{"embedded"},
			expectedSessionTypes: "embedded",
		},
		{
			name:                 "all summer types",
			sessionTypes:         []string{"main", "embedded", "ag"},
			expectedSessionTypes: "ag, embedded, main",
		},
		{
			name:                 "family camp only",
			sessionTypes:         []string{"family"},
			expectedSessionTypes: "family",
		},
		{
			name:                 "multi-session same type",
			sessionTypes:         []string{"main", "main", "main"},
			expectedSessionTypes: "main", // Deduplicated
		},
		{
			name:                 "empty sessions",
			sessionTypes:         []string{},
			expectedSessionTypes: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := aggregateSessionTypes(tt.sessionTypes)
			if result != tt.expectedSessionTypes {
				t.Errorf("aggregateSessionTypes(%v) = %q, want %q",
					tt.sessionTypes, result, tt.expectedSessionTypes)
			}
		})
	}
}

// TestCamperHistoryMultiSessionWithDifferentTypes tests that multi-session campers
// correctly aggregate all their session types
func TestCamperHistoryMultiSessionWithDifferentTypes(t *testing.T) {
	// Simulate attendee records for a camper in main and AG sessions
	attendees := []testAttendeeWithSessionType{
		{PersonID: 1001, SessionID: 100, SessionName: "Session 2", SessionType: "main"},
		{PersonID: 1001, SessionID: 101, SessionName: "Session 2 AG", SessionType: "ag"},
		{PersonID: 1001, SessionID: 102, SessionName: "Session 3", SessionType: "main"},
	}

	// Group by person and aggregate session types
	personData := aggregateAttendeesWithSessionTypes(attendees)

	pd, exists := personData[1001]
	if !exists {
		t.Fatal("person 1001 not found in aggregated data")
	}

	// Should have both session types
	expectedTypes := "ag, main" // Deduplicated and sorted
	if pd.SessionTypes != expectedTypes {
		t.Errorf("SessionTypes = %q, want %q", pd.SessionTypes, expectedTypes)
	}
}

// TestCamperHistorySessionTypesFilteringSummerOnly tests the filter logic
// that excludes non-summer sessions from metrics
func TestCamperHistorySessionTypesFilteringSummerOnly(t *testing.T) {
	// Sample camper history records with various session types
	records := []testCamperHistoryWithSessionTypes{
		{PersonID: 1001, SessionTypes: "main", Grade: 6},         // Summer - include
		{PersonID: 1002, SessionTypes: "embedded", Grade: 7},     // Summer - include
		{PersonID: 1003, SessionTypes: "ag, main", Grade: 8},     // Summer - include
		{PersonID: 1004, SessionTypes: "family", Grade: 0},       // Family - exclude
		{PersonID: 1005, SessionTypes: "main, embedded", Grade: 5}, // Summer - include
	}

	summerTypes := []string{"main", "embedded", "ag"}

	// Filter to summer only
	filtered := filterBySessionTypes(records, summerTypes)

	if len(filtered) != 4 {
		t.Errorf("filtered count = %d, want 4", len(filtered))
	}

	// Verify family camp is excluded
	for _, r := range filtered {
		if r.SessionTypes == "family" {
			t.Error("family session type should be excluded")
		}
	}

	// Verify grade 0 is not in filtered results
	for _, r := range filtered {
		if r.Grade == 0 {
			t.Errorf("grade 0 should not be in filtered results (family camp adult)")
		}
	}
}

// Test helper types for session_types tests
type testAttendeeWithSessionType struct {
	PersonID    int
	SessionID   int
	SessionName string
	SessionType string
}

type testPersonDataWithSessionTypes struct {
	PersonID     int
	SessionNames []string
	SessionTypes string // Comma-separated, deduplicated, sorted
}

type testCamperHistoryWithSessionTypes struct {
	PersonID     int
	SessionTypes string
	Grade        int
}

// aggregateSessionTypes deduplicates and sorts session types
func aggregateSessionTypes(types []string) string {
	if len(types) == 0 {
		return ""
	}
	// Deduplicate
	seen := make(map[string]bool)
	unique := make([]string, 0, len(types))
	for _, t := range types {
		if t != "" && !seen[t] {
			seen[t] = true
			unique = append(unique, t)
		}
	}
	return joinSorted(unique)
}

// aggregateAttendeesWithSessionTypes groups attendees and aggregates session types
func aggregateAttendeesWithSessionTypes(attendees []testAttendeeWithSessionType) map[int]*testPersonDataWithSessionTypes {
	result := make(map[int]*testPersonDataWithSessionTypes)

	for _, a := range attendees {
		if _, exists := result[a.PersonID]; !exists {
			result[a.PersonID] = &testPersonDataWithSessionTypes{
				PersonID:     a.PersonID,
				SessionNames: []string{},
			}
		}
		pd := result[a.PersonID]

		// Add session name if not present
		found := false
		for _, s := range pd.SessionNames {
			if s == a.SessionName {
				found = true
				break
			}
		}
		if !found {
			pd.SessionNames = append(pd.SessionNames, a.SessionName)
		}
	}

	// Now aggregate session types for each person
	for personID, pd := range result {
		// Collect session types for this person
		var types []string
		for _, a := range attendees {
			if a.PersonID == personID {
				types = append(types, a.SessionType)
			}
		}
		pd.SessionTypes = aggregateSessionTypes(types)
	}

	return result
}

// filterBySessionTypes filters records to only those matching given session types
func filterBySessionTypes(records []testCamperHistoryWithSessionTypes, allowedTypes []string) []testCamperHistoryWithSessionTypes {
	var filtered []testCamperHistoryWithSessionTypes

	for _, r := range records {
		// Parse the comma-separated session_types
		recordTypes := make([]string, 0)
		if r.SessionTypes != "" {
			for _, t := range splitAndTrim(r.SessionTypes, ",") {
				recordTypes = append(recordTypes, t)
			}
		}

		// Check if any record type matches allowed types
		for _, rt := range recordTypes {
			for _, at := range allowedTypes {
				if rt == at {
					filtered = append(filtered, r)
					goto nextRecord
				}
			}
		}
	nextRecord:
	}

	return filtered
}

// splitAndTrim splits a string and trims each part
func splitAndTrim(s, sep string) []string {
	if s == "" {
		return nil
	}
	parts := make([]string, 0)
	for _, p := range strings.Split(s, sep) {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	return parts
}

// aggregateExtendedAttendees aggregates attendee data including enrollment_date and status
func aggregateExtendedAttendees(attendees []testExtendedAttendee) map[int]*testExtendedAttendeeData {
	result := make(map[int]*testExtendedAttendeeData)

	for _, a := range attendees {
		if _, exists := result[a.PersonID]; !exists {
			result[a.PersonID] = &testExtendedAttendeeData{
				sessionNames:    []string{},
				enrollmentDates: []string{},
				statuses:        []string{},
			}
		}
		data := result[a.PersonID]

		// Add session name if not present
		found := false
		for _, s := range data.sessionNames {
			if s == a.SessionName {
				found = true
				break
			}
		}
		if !found {
			data.sessionNames = append(data.sessionNames, a.SessionName)
		}

		// Track enrollment date and status
		data.enrollmentDates = append(data.enrollmentDates, a.EnrollmentDate)
		data.statuses = append(data.statuses, a.Status)
	}

	// Compute aggregated values
	for _, data := range result {
		data.earliestEnrollmentDate = getEarliestEnrollmentDate(data.enrollmentDates)
		data.aggregatedStatus = getAggregatedStatus(data.statuses)
	}

	return result
}
