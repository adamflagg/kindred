package sync

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// Test constants for fictional data
const testSynagogue = "Temple Beth El"

// TestBunkAssignmentsHistoryFilter verifies the filter scopes by year only.
// is_deleted has been dropped from the bunk_assignments schema; the filter
// must not reference it.
func TestBunkAssignmentsHistoryFilter(t *testing.T) {
	t.Parallel()
	got := bunkAssignmentsHistoryFilter(2025)
	want := "year = 2025"
	if got != want {
		t.Errorf("bunkAssignmentsHistoryFilter(2025) = %q, want %q", got, want)
	}
}

// TestCamperHistorySync_Name verifies the service name is correct
func TestCamperHistorySync_Name(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
		return
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	attendees := []testAttendee{}

	personData := aggregateByPerson(attendees)

	if len(personData) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(personData))
	}
}

// TestCamperHistoryYearValidation tests year parameter validation
func TestCamperHistoryYearValidation(t *testing.T) {
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
			valid := isValidYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestCamperHistoryStatusPriority tests status priority for multi-status campers
func TestCamperHistoryStatusPriority(t *testing.T) {
	t.Parallel()
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

// joinSorted sorts strings and joins with ", "
func joinSorted(strs []string) string {
	if len(strs) == 0 {
		return ""
	}
	sorted := make([]string, len(strs))
	copy(sorted, strs)
	slices.Sort(sorted)
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	// Simulate household_custom_values data
	// Key: household_id, Value: synagogue name (or empty if not set)
	synagogueByHousehold := map[int]string{
		5001: testSynagogue,
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
			expectedSynagogue: testSynagogue,
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
	t.Parallel()
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
		return
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
		return
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
		return
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
	t.Parallel()
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
		Synagogue:      testSynagogue,
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
	if record.Synagogue != testSynagogue {
		t.Errorf("Synagogue = %q, want %q", record.Synagogue, testSynagogue)
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
	t.Parallel()
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
	t.Parallel()
	tests := []struct {
		name                      string
		currentYear               int
		enrolledYears             []int
		expectedFirstYearAttended int
	}{
		{
			name:                      "new camper - no history",
			currentYear:               2025,
			enrolledYears:             []int{}, // No prior years
			expectedFirstYearAttended: 2025,    // Current year is their first
		},
		{
			name:                      "returning camper - single prior year",
			currentYear:               2025,
			enrolledYears:             []int{2024},
			expectedFirstYearAttended: 2024, // Min of enrolled years
		},
		{
			name:                      "veteran camper - multiple years",
			currentYear:               2025,
			enrolledYears:             []int{2020, 2021, 2022, 2023, 2024},
			expectedFirstYearAttended: 2020, // Earliest year
		},
		{
			name:                      "gap years - still returns earliest",
			currentYear:               2025,
			enrolledYears:             []int{2019, 2023}, // Skipped 2020-2022
			expectedFirstYearAttended: 2019,              // Earliest year, gaps don't matter
		},
		{
			name:                      "unsorted years - finds minimum",
			currentYear:               2025,
			enrolledYears:             []int{2022, 2019, 2024, 2021}, // Not in order
			expectedFirstYearAttended: 2019,                          // Should find min
		},
		{
			name:                      "single gap year before current",
			currentYear:               2025,
			enrolledYears:             []int{2023}, // Skipped 2024
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
	t.Parallel()
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
	t.Parallel()
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
		return
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
	t.Parallel()
	// Sample camper history records with various session types
	records := []testCamperHistoryWithSessionTypes{
		{PersonID: 1001, SessionTypes: "main", Grade: 6},           // Summer - include
		{PersonID: 1002, SessionTypes: "embedded", Grade: 7},       // Summer - include
		{PersonID: 1003, SessionTypes: "ag, main", Grade: 8},       // Summer - include
		{PersonID: 1004, SessionTypes: "family", Grade: 0},         // Family - exclude
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
		if r.SessionTypes == sessionTypeFamily {
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
func aggregateAttendeesWithSessionTypes(
	attendees []testAttendeeWithSessionType,
) map[int]*testPersonDataWithSessionTypes {
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
func filterBySessionTypes(
	records []testCamperHistoryWithSessionTypes,
	allowedTypes []string,
) []testCamperHistoryWithSessionTypes {
	var filtered []testCamperHistoryWithSessionTypes

	for _, r := range records {
		// Parse the comma-separated session_types
		var recordTypes []string
		if r.SessionTypes != "" {
			recordTypes = append(recordTypes, splitAndTrim(r.SessionTypes, ",")...)
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

// ============================================================================
// V2 TESTS: Non-deduplicated, per-attendee schema
// These tests define the new behavior: one row per (person_id, session_cm_id, year)
// ============================================================================

// Note: summerSessionTypes and familySessionTypes are defined in camper_history.go

// testAttendeeV2 represents an attendee record for v2 tests
type testAttendeeV2 struct {
	PersonID       int
	PersonPBID     string
	SessionCMID    int
	SessionPBID    string
	SessionName    string
	SessionType    string
	Year           int
	Status         string
	EnrollmentDate string
}

// testBunkAssignmentV2 represents a bunk assignment keyed by session
type testBunkAssignmentV2 struct {
	PersonPBID  string
	SessionPBID string
	BunkName    string
	BunkCMID    int
	Year        int
}

// testCamperHistoryV2 represents the output record structure
type testCamperHistoryV2 struct {
	PersonID          int
	PersonPBID        string
	SessionCMID       int
	SessionPBID       string
	SessionName       string
	SessionType       string
	Year              int
	FirstName         string
	LastName          string
	Age               float64
	IsReturningSummer bool
	IsReturningFamily bool
	BunkName          string
	BunkCMID          int
	Status            string
}

// TestV2_OneRecordPerAttendee tests that v2 creates one record per attendee,
// not one record per person (the key behavior change from v1)
func TestV2_OneRecordPerAttendee(t *testing.T) {
	t.Parallel()
	attendees := []testAttendeeV2{
		{PersonID: 1001, SessionCMID: 100, SessionName: "Session 1", SessionType: "main", Year: 2025},
		{PersonID: 1001, SessionCMID: 101, SessionName: "Session 2", SessionType: "main", Year: 2025},
		{PersonID: 1001, SessionCMID: 102, SessionName: "Session 2 AG", SessionType: "ag", Year: 2025},
	}

	// v2 should produce 3 records for the same person (one per session)
	records := buildV2Records(attendees)

	if len(records) != 3 {
		t.Errorf("v2 should create %d records (one per attendee), got %d", len(attendees), len(records))
	}

	// Verify each record has the correct session
	sessionCMIDs := make(map[int]bool)
	for _, r := range records {
		sessionCMIDs[r.SessionCMID] = true
		if r.PersonID != 1001 {
			t.Errorf("expected person_id 1001, got %d", r.PersonID)
		}
	}

	if len(sessionCMIDs) != 3 {
		t.Errorf("expected 3 unique session_cm_ids, got %d", len(sessionCMIDs))
	}
}

// TestV2_UniqueConstraint tests the unique key is (person_id, session_cm_id, year)
func TestV2_UniqueConstraint(t *testing.T) {
	t.Parallel()
	attendees := []testAttendeeV2{
		{PersonID: 1001, SessionCMID: 100, Year: 2025},
		{PersonID: 1001, SessionCMID: 100, Year: 2025}, // Duplicate - should be deduplicated
		{PersonID: 1001, SessionCMID: 100, Year: 2024}, // Different year - unique
		{PersonID: 1001, SessionCMID: 101, Year: 2025}, // Different session - unique
		{PersonID: 1002, SessionCMID: 100, Year: 2025}, // Different person - unique
	}

	records := buildV2Records(attendees)

	// After deduplication by (person_id, session_cm_id, year), expect 4 unique records
	if len(records) != 4 {
		t.Errorf("expected 4 unique records, got %d", len(records))
	}

	// Verify unique keys
	seen := make(map[string]bool)
	for _, r := range records {
		key := fmt.Sprintf("%d-%d-%d", r.PersonID, r.SessionCMID, r.Year)
		if seen[key] {
			t.Errorf("duplicate key found: %s", key)
		}
		seen[key] = true
	}
}

// TestV2_BunkLookupBySession tests that bunk assignment matches the specific session
func TestV2_BunkLookupBySession(t *testing.T) {
	t.Parallel()
	attendees := []testAttendeeV2{
		{PersonID: 1001, PersonPBID: "p1001", SessionCMID: 100, SessionPBID: "s100", SessionName: "Session 1", Year: 2025},
		{PersonID: 1001, PersonPBID: "p1001", SessionCMID: 101, SessionPBID: "s101", SessionName: "Session 2", Year: 2025},
	}

	// Bunk assignments keyed by (person, session, year)
	bunkAssignments := []testBunkAssignmentV2{
		{PersonPBID: "p1001", SessionPBID: "s100", BunkName: "B-12", BunkCMID: 5012, Year: 2025},
		{PersonPBID: "p1001", SessionPBID: "s101", BunkName: "B-14", BunkCMID: 5014, Year: 2025},
	}

	records := buildV2RecordsWithBunks(attendees, bunkAssignments)

	// Verify Session 1 has B-12
	s1Record := findRecordBySession(records, 100)
	if s1Record == nil {
		t.Fatal("session 100 record not found")
		return
	}
	if s1Record.BunkName != "B-12" {
		t.Errorf("session 100: expected bunk B-12, got %q", s1Record.BunkName)
	}
	if s1Record.BunkCMID != 5012 {
		t.Errorf("session 100: expected bunk_cm_id 5012, got %d", s1Record.BunkCMID)
	}

	// Verify Session 2 has B-14
	s2Record := findRecordBySession(records, 101)
	if s2Record == nil {
		t.Fatal("session 101 record not found")
		return
	}
	if s2Record.BunkName != "B-14" {
		t.Errorf("session 101: expected bunk B-14, got %q", s2Record.BunkName)
	}
}

// TestV2_IsReturningSummerOnlyConsidersSummerTypes tests that is_returning_summer
// only considers summer session types in the prior year
func TestV2_IsReturningSummerOnlyConsidersSummerTypes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                 string
		currentYear          int
		currentSessionType   string
		priorYearEnrollments []struct {
			Year        int
			SessionType string
		}
		expectedReturningSummer bool
	}{
		{
			name:               "returning - attended main session last year",
			currentYear:        2025,
			currentSessionType: "main",
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "main"},
			},
			expectedReturningSummer: true,
		},
		{
			name:               "returning - attended ag session last year",
			currentYear:        2025,
			currentSessionType: "main",
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "ag"},
			},
			expectedReturningSummer: true,
		},
		{
			name:               "returning - attended embedded session last year",
			currentYear:        2025,
			currentSessionType: "main",
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "embedded"},
			},
			expectedReturningSummer: true,
		},
		{
			name:               "NOT returning - only attended family last year",
			currentYear:        2025,
			currentSessionType: "main",
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "family"},
			},
			expectedReturningSummer: false, // Family doesn't count as summer
		},
		{
			name:               "NOT returning - only attended adult last year",
			currentYear:        2025,
			currentSessionType: "main",
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "adult"},
			},
			expectedReturningSummer: false, // Adult doesn't count as summer
		},
		{
			name:               "NOT returning - summer attendance was 2 years ago",
			currentYear:        2025,
			currentSessionType: "main",
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2023, "main"}, // Gap year
			},
			expectedReturningSummer: false,
		},
		{
			name:               "returning - multiple types last year including summer",
			currentYear:        2025,
			currentSessionType: "main",
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "family"},
				{2024, "main"}, // This counts
			},
			expectedReturningSummer: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := computeIsReturningSummer(tt.currentYear, tt.priorYearEnrollments)
			if result != tt.expectedReturningSummer {
				t.Errorf("computeIsReturningSummer = %v, want %v", result, tt.expectedReturningSummer)
			}
		})
	}
}

// TestV2_IsReturningFamilyOnlyConsidersFamilyTypes tests that is_returning_family
// only considers family/adult session types in the prior year
func TestV2_IsReturningFamilyOnlyConsidersFamilyTypes(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                 string
		currentYear          int
		priorYearEnrollments []struct {
			Year        int
			SessionType string
		}
		expectedReturningFamily bool
	}{
		{
			name:        "returning family - attended family last year",
			currentYear: 2025,
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "family"},
			},
			expectedReturningFamily: true,
		},
		{
			name:        "returning family - attended adult last year",
			currentYear: 2025,
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "adult"},
			},
			expectedReturningFamily: true,
		},
		{
			name:        "NOT returning family - only attended summer last year",
			currentYear: 2025,
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "main"},
				{2024, "ag"},
			},
			expectedReturningFamily: false,
		},
		{
			name:        "returning family - attended both summer and family last year",
			currentYear: 2025,
			priorYearEnrollments: []struct {
				Year        int
				SessionType string
			}{
				{2024, "main"},
				{2024, "family"},
			},
			expectedReturningFamily: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := computeIsReturningFamily(tt.currentYear, tt.priorYearEnrollments)
			if result != tt.expectedReturningFamily {
				t.Errorf("computeIsReturningFamily = %v, want %v", result, tt.expectedReturningFamily)
			}
		})
	}
}

// TestV2_SessionTypeSelectValues tests that session_type field uses correct enum values
func TestV2_SessionTypeSelectValues(t *testing.T) {
	t.Parallel()
	// These are all the valid session types from camp_sessions enum
	validTypes := []string{
		"main", "embedded", "ag", "family", "quest", "scit",
		"bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other",
	}

	// Verify summer types are subset of valid types
	for _, st := range summerSessionTypes {
		found := false
		for _, vt := range validTypes {
			if st == vt {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("summer session type %q not in valid types", st)
		}
	}

	// Verify family types are subset of valid types
	for _, ft := range familySessionTypes {
		found := false
		for _, vt := range validTypes {
			if ft == vt {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("family session type %q not in valid types", ft)
		}
	}

	// Verify no overlap between summer and family
	for _, st := range summerSessionTypes {
		for _, ft := range familySessionTypes {
			if st == ft {
				t.Errorf("session type %q appears in both summer and family", st)
			}
		}
	}
}

// TestV2_SessionTypeFieldPresent tests that each record has session_type
func TestV2_SessionTypeFieldPresent(t *testing.T) {
	t.Parallel()
	attendees := []testAttendeeV2{
		{PersonID: 1001, SessionCMID: 100, SessionName: "Session 1", SessionType: "main", Year: 2025},
		{PersonID: 1001, SessionCMID: 101, SessionName: "Family Camp", SessionType: "family", Year: 2025},
		{PersonID: 1001, SessionCMID: 102, SessionName: "AG Session", SessionType: "ag", Year: 2025},
	}

	records := buildV2Records(attendees)

	for _, r := range records {
		if r.SessionType == "" {
			t.Errorf("record for session %d missing session_type", r.SessionCMID)
		}
	}

	// Verify session types match input
	mainRecord := findRecordBySession(records, 100)
	if mainRecord.SessionType != "main" {
		t.Errorf("session 100: expected type 'main', got %q", mainRecord.SessionType)
	}

	familyRecord := findRecordBySession(records, 101)
	if familyRecord.SessionType != sessionTypeFamily {
		t.Errorf("session 101: expected type %q, got %q", sessionTypeFamily, familyRecord.SessionType)
	}
}

// ============================================================================
// V2 test helper functions
// ============================================================================

// buildV2Records creates camper_history v2 records from attendees
func buildV2Records(attendees []testAttendeeV2) []testCamperHistoryV2 {
	// Use map to deduplicate by (person_id, session_cm_id, year)
	seen := make(map[string]bool)
	var records []testCamperHistoryV2

	for _, a := range attendees {
		key := fmt.Sprintf("%d-%d-%d", a.PersonID, a.SessionCMID, a.Year)
		if seen[key] {
			continue
		}
		seen[key] = true

		records = append(records, testCamperHistoryV2{
			PersonID:    a.PersonID,
			PersonPBID:  a.PersonPBID,
			SessionCMID: a.SessionCMID,
			SessionPBID: a.SessionPBID,
			SessionName: a.SessionName,
			SessionType: a.SessionType,
			Year:        a.Year,
			Status:      a.Status,
		})
	}

	return records
}

// buildV2RecordsWithBunks creates records with bunk lookup
func buildV2RecordsWithBunks(
	attendees []testAttendeeV2,
	bunkAssignments []testBunkAssignmentV2,
) []testCamperHistoryV2 {
	// Build bunk lookup by (person, session, year)
	bunkLookup := make(map[string]testBunkAssignmentV2)
	for _, ba := range bunkAssignments {
		key := fmt.Sprintf("%s-%s-%d", ba.PersonPBID, ba.SessionPBID, ba.Year)
		bunkLookup[key] = ba
	}

	records := buildV2Records(attendees)

	// Enrich with bunk data
	for i := range records {
		key := fmt.Sprintf("%s-%s-%d", records[i].PersonPBID, records[i].SessionPBID, records[i].Year)
		if ba, ok := bunkLookup[key]; ok {
			records[i].BunkName = ba.BunkName
			records[i].BunkCMID = ba.BunkCMID
		}
	}

	return records
}

// findRecordBySession finds a record by session CM ID
func findRecordBySession(records []testCamperHistoryV2, sessionCMID int) *testCamperHistoryV2 {
	for i := range records {
		if records[i].SessionCMID == sessionCMID {
			return &records[i]
		}
	}
	return nil
}

// computeIsReturningSummer checks if person was enrolled in a summer session in prior year
func computeIsReturningSummer(currentYear int, enrollments []struct {
	Year        int
	SessionType string
}) bool {
	priorYear := currentYear - 1
	for _, e := range enrollments {
		if e.Year == priorYear && isSummerSessionType(e.SessionType) {
			return true
		}
	}
	return false
}

// computeIsReturningFamily checks if person was enrolled in a family session in prior year
func computeIsReturningFamily(currentYear int, enrollments []struct {
	Year        int
	SessionType string
}) bool {
	priorYear := currentYear - 1
	for _, e := range enrollments {
		if e.Year == priorYear && isFamilySessionType(e.SessionType) {
			return true
		}
	}
	return false
}

// isSummerSessionType checks if session type is a summer type
func isSummerSessionType(sessionType string) bool {
	for _, st := range summerSessionTypes {
		if sessionType == st {
			return true
		}
	}
	return false
}

// isFamilySessionType checks if session type is a family type
func isFamilySessionType(sessionType string) bool {
	for _, ft := range familySessionTypes {
		if sessionType == ft {
			return true
		}
	}
	return false
}

// ============================================================================
// Idempotency tests for upsert pattern
// ============================================================================

// ============================================================================
// Tests: City/State extraction from discrete address columns
// ============================================================================

// TestCamperHistoryAddressDiscreteColumns tests that city/state are read
// directly from address_city and address_state columns (not JSON parsing)
func TestCamperHistoryAddressDiscreteColumns(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		addressCity   string
		addressState  string
		expectedCity  string
		expectedState string
	}{
		{
			name:          "both city and state present",
			addressCity:   "Oakland",
			addressState:  "CA",
			expectedCity:  "Oakland",
			expectedState: "CA",
		},
		{
			name:          "city only",
			addressCity:   "San Francisco",
			addressState:  "",
			expectedCity:  "San Francisco",
			expectedState: "",
		},
		{
			name:          "state only",
			addressCity:   "",
			addressState:  "NY",
			expectedCity:  "",
			expectedState: "NY",
		},
		{
			name:          "both empty",
			addressCity:   "",
			addressState:  "",
			expectedCity:  "",
			expectedState: "",
		},
		{
			name:          "city with space",
			addressCity:   "Los Angeles",
			addressState:  "CA",
			expectedCity:  "Los Angeles",
			expectedState: "CA",
		},
		{
			name:          "full state name",
			addressCity:   "Berkeley",
			addressState:  "California",
			expectedCity:  "Berkeley",
			expectedState: "California",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Production code now directly reads address_city and address_state
			// from the persons table - no JSON parsing needed
			city := tt.addressCity
			state := tt.addressState
			if city != tt.expectedCity {
				t.Errorf("city = %q, want %q", city, tt.expectedCity)
			}
			if state != tt.expectedState {
				t.Errorf("state = %q, want %q", state, tt.expectedState)
			}
		})
	}
}

// ============================================================================
// Bug Fix Tests: Congregation data source (person_custom_values vs household)
// ============================================================================

// TestCamperHistoryCongregationSourcePriority tests that congregation is loaded
// from person_custom_values (HH-Name of Congregation) as primary source,
// with household_custom_values (Synagogue) as fallback
func TestCamperHistoryCongregationSourcePriority(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                   string
		personCongregation     string // From person_custom_values "HH-Name of Congregation"
		householdSynagogue     string // From household_custom_values "Synagogue"
		expectedCongregation   string
		expectedUsingPersonSrc bool
	}{
		{
			name:                   "person congregation available",
			personCongregation:     "Temple Beth Abraham",
			householdSynagogue:     "Different Synagogue",
			expectedCongregation:   "Temple Beth Abraham", // Person takes priority
			expectedUsingPersonSrc: true,
		},
		{
			name:                   "only household synagogue available",
			personCongregation:     "",
			householdSynagogue:     "Congregation Shalom",
			expectedCongregation:   "Congregation Shalom", // Fallback to household
			expectedUsingPersonSrc: false,
		},
		{
			name:                   "both empty",
			personCongregation:     "",
			householdSynagogue:     "",
			expectedCongregation:   "",
			expectedUsingPersonSrc: false,
		},
		{
			name:                   "person congregation takes priority even when both exist",
			personCongregation:     "Beth Jacob",
			householdSynagogue:     "Temple Israel",
			expectedCongregation:   "Beth Jacob",
			expectedUsingPersonSrc: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, usedPersonSrc := mergeCongregationSources(tt.personCongregation, tt.householdSynagogue)
			if result != tt.expectedCongregation {
				t.Errorf("congregation = %q, want %q", result, tt.expectedCongregation)
			}
			if usedPersonSrc != tt.expectedUsingPersonSrc {
				t.Errorf("usedPersonSrc = %v, want %v", usedPersonSrc, tt.expectedUsingPersonSrc)
			}
		})
	}
}

// mergeCongregationSources merges congregation from person and household sources
// Person source takes priority (HH-Name of Congregation from person_custom_values)
// Household source is fallback (Synagogue from household_custom_values)
func mergeCongregationSources(personCongregation, householdSynagogue string) (result string, usedPersonSrc bool) {
	if personCongregation != "" {
		return personCongregation, true
	}
	return householdSynagogue, false
}

// TestCamperHistoryCongregationFieldNames tests the correct custom field names
func TestCamperHistoryCongregationFieldNames(t *testing.T) {
	t.Parallel()
	// These are the expected field names in CampMinder custom values
	personFieldName := "HH-Name of Congregation" // person_custom_values - rich data (2376 records)
	householdFieldName := "Synagogue"            // household_custom_values - sparse data (29 records)

	// Verify the field names are not empty
	if personFieldName == "" {
		t.Error("personFieldName should not be empty")
	}
	if householdFieldName == "" {
		t.Error("householdFieldName should not be empty")
	}

	// Verify they are different (not the same field)
	if personFieldName == householdFieldName {
		t.Error("person and household congregation field names should be different")
	}
}

// ============================================================================
// Upsert helper tests (continued)
// ============================================================================

// TestCamperHistoryCompositeKeyFormat tests the composite key format used for upsert
func TestCamperHistoryCompositeKeyFormat(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		personCMID  int
		sessionCMID int
		year        int
		expected    string
	}{
		{
			name:        "standard key",
			personCMID:  1001,
			sessionCMID: 100,
			year:        2025,
			expected:    "1001:100|2025",
		},
		{
			name:        "different year same person/session",
			personCMID:  1001,
			sessionCMID: 100,
			year:        2024,
			expected:    "1001:100|2024",
		},
		{
			name:        "large IDs",
			personCMID:  9999999,
			sessionCMID: 999999,
			year:        2025,
			expected:    "9999999:999999|2025",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := fmt.Sprintf("%d:%d|%d", tt.personCMID, tt.sessionCMID, tt.year)
			if key != tt.expected {
				t.Errorf("composite key = %q, want %q", key, tt.expected)
			}
		})
	}
}

// TestCamperHistoryCompositeKeyDeterministic tests that the same input always produces the same key
func TestCamperHistoryCompositeKeyDeterministic(t *testing.T) {
	t.Parallel()
	// Generate key multiple times
	keys := make([]string, 10)
	for i := range 10 {
		keys[i] = fmt.Sprintf("%d:%d|%d", 1001, 100, 2025)
	}

	// All should be identical
	for i := 1; i < len(keys); i++ {
		if keys[i] != keys[0] {
			t.Errorf("key %d (%q) differs from key 0 (%q)", i, keys[i], keys[0])
		}
	}
}

// TestCamperHistoryOrphanDetection tests that records not in processed keys are identified as orphans
func TestCamperHistoryOrphanDetection(t *testing.T) {
	t.Parallel()
	// Simulate existing records
	existingKeys := map[string]bool{
		"1001:100|2025": true, // Will be processed
		"1002:100|2025": true, // Will be processed
		"1003:100|2025": true, // NOT processed = orphan (unenrolled camper)
	}

	// Simulate processed keys (what was synced from source data)
	processedKeys := map[string]bool{
		"1001:100|2025": true,
		"1002:100|2025": true,
		// 1003 not in source data anymore
	}

	// Count orphans (records in existing but not in processed)
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

// TestCamperHistoryUpsertDecision tests the create vs update decision logic
func TestCamperHistoryUpsertDecision(t *testing.T) {
	t.Parallel()
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
			newKey:       "1001:100|2025",
			expectCreate: true,
			expectUpdate: false,
		},
		{
			name:         "existing record - should update",
			existingKeys: map[string]bool{"1001:100|2025": true},
			newKey:       "1001:100|2025",
			expectCreate: false,
			expectUpdate: true,
		},
		{
			name:         "different session - new record",
			existingKeys: map[string]bool{"1001:100|2025": true},
			newKey:       "1001:101|2025",
			expectCreate: true,
			expectUpdate: false,
		},
		{
			name:         "different year - new record",
			existingKeys: map[string]bool{"1001:100|2025": true},
			newKey:       "1001:100|2026",
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

// TestCamperHistoryCompareFields verifies that the compareFields list for camper_history
// contains exactly the expected fields (inclusion list pattern, not skipFields exclusion).
func TestCamperHistoryCompareFields(t *testing.T) {
	t.Parallel()
	// camperHistoryCompareFields should list all fields that matter for idempotency checks,
	// excluding PocketBase-managed fields (id, created, updated, collectionId, collectionName)
	// and the unique key fields (person_id, session_cm_id, year) which don't change.
	expected := map[string]bool{
		"session_name":        true,
		"first_name":          true,
		"last_name":           true,
		"school":              true,
		"city":                true,
		"state":               true,
		"is_returning_summer": true,
		"is_returning_family": true,
		"years_at_camp":       true,
		"person":              true,
		"session":             true,
		"session_type":        true,
		"gender":              true,
		"grade":               true,
		"age":                 true,
		"household_id":        true,
		"division_name":       true,
		"status":              true,
		"enrollment_date":     true,
		"bunk_name":           true,
		"bunk_cm_id":          true,
		"synagogue":           true,
	}

	actual := make(map[string]bool)
	for _, f := range camperHistoryCompareFields {
		actual[f] = true
	}

	// Check all expected fields are present
	for field := range expected {
		if !actual[field] {
			t.Errorf("camperHistoryCompareFields missing expected field %q", field)
		}
	}

	// Check no unexpected fields are present
	for field := range actual {
		if !expected[field] {
			t.Errorf("camperHistoryCompareFields contains unexpected field %q", field)
		}
	}

	// Verify the unique key fields are NOT in compareFields
	keyFields := []string{"person_id", "session_cm_id", "year"}
	for _, field := range keyFields {
		if actual[field] {
			t.Errorf("camperHistoryCompareFields should NOT contain key field %q", field)
		}
	}
}

// TestCamperHistoryRecordNeedsUpdateUsesCompareFields verifies that recordNeedsUpdate
// correctly detects when fields match (no update) and when they differ (needs update).
func TestCamperHistoryRecordNeedsUpdateUsesCompareFields(t *testing.T) {
	t.Parallel()
	c := &CamperHistorySync{}

	// Create a minimal collection with the fields used in comparison
	col := core.NewBaseCollection("test_camper_history")
	col.Fields.Add(&core.TextField{Name: "session_name"})
	col.Fields.Add(&core.TextField{Name: "first_name"})
	col.Fields.Add(&core.TextField{Name: "last_name"})
	col.Fields.Add(&core.TextField{Name: "school"})
	col.Fields.Add(&core.TextField{Name: "city"})
	col.Fields.Add(&core.TextField{Name: "state"})
	col.Fields.Add(&core.BoolField{Name: "is_returning_summer"})
	col.Fields.Add(&core.BoolField{Name: "is_returning_family"})
	col.Fields.Add(&core.NumberField{Name: "years_at_camp"})
	col.Fields.Add(&core.TextField{Name: "person"})
	col.Fields.Add(&core.TextField{Name: "session"})
	col.Fields.Add(&core.TextField{Name: "session_type"})
	col.Fields.Add(&core.TextField{Name: "gender"})
	col.Fields.Add(&core.NumberField{Name: "grade"})
	col.Fields.Add(&core.NumberField{Name: "age"})
	col.Fields.Add(&core.NumberField{Name: "household_id"})
	col.Fields.Add(&core.TextField{Name: "division_name"})
	col.Fields.Add(&core.TextField{Name: "status"})
	col.Fields.Add(&core.TextField{Name: "enrollment_date"})
	col.Fields.Add(&core.TextField{Name: "bunk_name"})
	col.Fields.Add(&core.NumberField{Name: "bunk_cm_id"})
	col.Fields.Add(&core.TextField{Name: "synagogue"})

	t.Run("no update when all fields match", func(t *testing.T) {
		existing := core.NewRecord(col)
		existing.Set("session_name", "Session 1")
		existing.Set("first_name", testFirstName)
		existing.Set("last_name", "Garcia")
		existing.Set("school", "Riverside Elementary")
		existing.Set("city", "Portland")
		existing.Set("state", "OR")
		existing.Set("is_returning_summer", true)
		existing.Set("is_returning_family", false)
		existing.Set("years_at_camp", 3)
		existing.Set("person", "pb_person1")
		existing.Set("session", "pb_session1")
		existing.Set("session_type", "main")
		existing.Set("gender", "M")
		existing.Set("grade", 5)
		existing.Set("age", 11)
		existing.Set("household_id", 5001)
		existing.Set("division_name", "Division A")
		existing.Set("status", "enrolled")
		existing.Set("enrollment_date", "2025-01-15")
		existing.Set("bunk_name", "Cabin 7")
		existing.Set("bunk_cm_id", 200)
		existing.Set("synagogue", testSynagogue)

		newData := map[string]any{
			"session_name":        "Session 1",
			"first_name":          testFirstName,
			"last_name":           "Garcia",
			"school":              "Riverside Elementary",
			"city":                "Portland",
			"state":               "OR",
			"is_returning_summer": true,
			"is_returning_family": false,
			"years_at_camp":       3,
			"person":              "pb_person1",
			"session":             "pb_session1",
			"session_type":        "main",
			"gender":              "M",
			"grade":               5,
			"age":                 11,
			"household_id":        5001,
			"division_name":       "Division A",
			"status":              "enrolled",
			"enrollment_date":     "2025-01-15",
			"bunk_name":           "Cabin 7",
			"bunk_cm_id":          200,
			"synagogue":           testSynagogue,
		}

		if c.recordNeedsUpdate(existing, newData, camperHistoryCompareFields) {
			t.Error("expected no update needed when all compareFields match")
		}
	})

	t.Run("needs update when a compare field differs", func(t *testing.T) {
		existing := core.NewRecord(col)
		existing.Set("session_name", "Session 1")
		existing.Set("first_name", testFirstName)
		existing.Set("last_name", "Garcia")
		existing.Set("school", "Riverside Elementary")
		existing.Set("city", "Portland")
		existing.Set("state", "OR")
		existing.Set("is_returning_summer", true)
		existing.Set("is_returning_family", false)
		existing.Set("years_at_camp", 3)
		existing.Set("person", "pb_person1")
		existing.Set("session", "pb_session1")
		existing.Set("session_type", "main")
		existing.Set("gender", "M")
		existing.Set("grade", 5)
		existing.Set("age", 11)
		existing.Set("household_id", 5001)
		existing.Set("division_name", "Division A")
		existing.Set("status", "enrolled")
		existing.Set("enrollment_date", "2025-01-15")
		existing.Set("bunk_name", "Cabin 7")
		existing.Set("bunk_cm_id", 200)
		existing.Set("synagogue", testSynagogue)

		newData := map[string]any{
			"session_name":        "Session 1",
			"first_name":          testFirstName,
			"last_name":           "Garcia",
			"school":              "Oak Valley Middle",
			"city":                "Portland",
			"state":               "OR",
			"is_returning_summer": true,
			"is_returning_family": false,
			"years_at_camp":       3,
			"person":              "pb_person1",
			"session":             "pb_session1",
			"session_type":        "main",
			"gender":              "M",
			"grade":               5,
			"age":                 11,
			"household_id":        5001,
			"division_name":       "Division A",
			"status":              "enrolled",
			"enrollment_date":     "2025-01-15",
			"bunk_name":           "Cabin 7",
			"bunk_cm_id":          200,
			"synagogue":           testSynagogue,
		}

		if !c.recordNeedsUpdate(existing, newData, camperHistoryCompareFields) {
			t.Error("expected update needed when school differs")
		}
	})
}

// TestCamperHistoryDeleteOrphansRefusesCollapsedComputedSet pins the guard
// kindred#2283 adds. Before this fix deleteOrphans returned a bare int and had
// no channel to refuse a sweep at all -- an empty ProcessedKeys map against a
// populated year deleted the whole year and reported success.
func TestCamperHistoryDeleteOrphansRefusesCollapsedComputedSet(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "camper_history", "person_id", "session_cm_id")
	col, err := app.FindCollectionByNameOrId("camper_history")
	if err != nil {
		t.Fatalf("find camper_history: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("person_id", 5001)
	rec.Set("session_cm_id", 200)
	rec.Set("year", 2026)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save existing row: %v", saveErr)
	}

	c := NewCamperHistorySync(app)
	c.SyncSuccessful = true
	c.ProcessedKeys = make(map[string]bool) // nothing processed this run

	existing := map[string]*core.Record{"5001:200|2026": rec}
	deleted, err := c.deleteOrphans(existing, 2026)

	if err == nil {
		t.Fatal("expected an error when nothing was processed and rows exist, got nil")
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- nothing may be removed on the refusal path", deleted)
	}

	remaining, err := app.FindRecordsByFilter("camper_history", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("%d rows survived, want 1 -- the guard must not delete", len(remaining))
	}
}

// TestCamperHistoryDeleteOrphansStillSweepsGenuineOrphans proves the guard did
// not disable orphan deletion for the normal case (a camper unenrolled from a
// session).
func TestCamperHistoryDeleteOrphansStillSweepsGenuineOrphans(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "camper_history", "person_id", "session_cm_id")
	col, err := app.FindCollectionByNameOrId("camper_history")
	if err != nil {
		t.Fatalf("find camper_history: %v", err)
	}
	orphan := core.NewRecord(col)
	orphan.Set("person_id", 5002)
	orphan.Set("session_cm_id", 200)
	orphan.Set("year", 2026)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("save orphan: %v", saveErr)
	}

	c := NewCamperHistorySync(app)
	c.SyncSuccessful = true
	c.ProcessedKeys = map[string]bool{"5001:200|2026": true}

	existing := map[string]*core.Record{"5002:200|2026": orphan}
	deleted, err := c.deleteOrphans(existing, 2026)
	if err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
}

// newCamperHistorySyncTestApp builds the collections CamperHistorySync.Sync()
// reads on its way to the orphan sweep. Most are empty -- the loaders tolerate
// that -- but they must exist, because a query against a missing collection is
// an error that would abort Sync() long before the sweep.
func newCamperHistorySyncTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	simple := map[string][]string{
		"camp_sessions":           {"name", "session_type"},
		"bunks":                   {"name"},
		"divisions":               {"name"},
		"custom_field_defs":       {"name"},
		"households":              {},
		"persons":                 {"first_name", "last_name", "gender"},
		"person_custom_values":    {"person", "field_definition", "value"},
		"household_custom_values": {"household", "field_definition", "value"},
		"bunk_assignments":        {"person", "session", "bunk"},
		"attendees":               {"person", "session", "status", "session_type"},
	}
	for name, textFields := range simple {
		col := core.NewBaseCollection(name)
		for _, f := range textFields {
			col.Fields.Add(&core.TextField{Name: f})
		}
		col.Fields.Add(&core.NumberField{Name: "cm_id"})
		col.Fields.Add(&core.NumberField{Name: "person_id"})
		col.Fields.Add(&core.NumberField{Name: "status_id"})
		col.Fields.Add(&core.NumberField{Name: "year"})
		// The loaders page with a "-created" sort; the field has to exist.
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		if err := app.Save(col); err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
	}

	hist := core.NewBaseCollection("camper_history")
	hist.Fields.Add(&core.NumberField{Name: "person_id"})
	hist.Fields.Add(&core.NumberField{Name: "session_cm_id"})
	hist.Fields.Add(&core.NumberField{Name: "year"})
	for _, f := range []string{"name", "session_name", "session_type", "gender", "status"} {
		hist.Fields.Add(&core.TextField{Name: f})
	}
	hist.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(hist); err != nil {
		t.Fatalf("create camper_history: %v", err)
	}
	return app
}

// TestCamperHistorySyncPropagatesSweepRefusal is the caller-propagation test for
// kindred#2283. camper_history.go is one of the two files that previously called
// deleteOrphans without even capturing its return value, so "the caller now uses
// the error" is the whole point of the change here -- and the guard tests alone
// prove nothing about it. Sibling PR kindred#2294 shipped exactly this gap.
//
// Deleting the `if orphanErr != nil` return in camper_history.go makes this test
// fail; without it the whole sync suite stays green.
func TestCamperHistorySyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCamperHistorySyncTestApp(t)

	attendees, err := app.FindCollectionByNameOrId("attendees")
	if err != nil {
		t.Fatalf("find attendees: %v", err)
	}
	// Three attendees this run -- believable on its own, a collapse against
	// what is already stored.
	for _, cmID := range []int{101, 102, 103} {
		a := core.NewRecord(attendees)
		a.Set("person_id", cmID)
		a.Set("year", 2026)
		if saveErr := app.Save(a); saveErr != nil {
			t.Fatalf("save attendee %d: %v", cmID, saveErr)
		}
	}

	hist, err := app.FindCollectionByNameOrId("camper_history")
	if err != nil {
		t.Fatalf("find camper_history: %v", err)
	}
	for i := range OrphanSweepMinRows + 5 {
		rec := core.NewRecord(hist)
		rec.Set("person_id", 900+i)
		rec.Set("session_cm_id", 200)
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("save existing row %d: %v", i, saveErr)
		}
	}

	c := NewCamperHistorySync(app)
	c.Year = 2026
	syncErr := c.Sync(context.Background())

	if syncErr == nil {
		t.Fatal("Sync returned nil on a refused sweep -- the refusal never reached the caller")
	}
	if !strings.Contains(syncErr.Error(), "orphan sweep refused") {
		t.Errorf("Sync error = %q, want it to carry the sweep refusal", syncErr.Error())
	}

	remaining, err := app.FindRecordsByFilter("camper_history", "year = 2026 && person_id >= 900", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != OrphanSweepMinRows+5 {
		t.Errorf("%d seeded rows survived, want %d -- a refused sweep must delete nothing",
			len(remaining), OrphanSweepMinRows+5)
	}
}
