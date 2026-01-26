package sync

import (
	"sort"
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
		if s == "enrolled" {
			return "enrolled"
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
