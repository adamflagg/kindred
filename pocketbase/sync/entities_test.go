package sync

import (
	"testing"
	"time"
)

// Test constants
const genderMixed = "Mixed"

// TestStatusEndTime tests status end time handling
func TestStatusEndTime(t *testing.T) {
	t.Parallel()
	now := time.Now()
	status := Status{
		Type:      "test",
		Status:    "running",
		StartTime: now,
		EndTime:   nil, // Not statusCompleted yet
	}

	// Complete the status
	endTime := now.Add(time.Minute)
	status.Status = "statusCompleted"
	status.EndTime = &endTime

	duration := status.EndTime.Sub(status.StartTime)
	if duration != time.Minute {
		t.Errorf("expected 1 minute duration, got %v", duration)
	}
}

// TestSyncServiceOrdering tests the expected ordering of sync services
func TestSyncServiceOrdering(t *testing.T) {
	t.Parallel()
	// The correct order based on dependencies
	expectedOrder := []string{
		"sessions",         // No dependencies
		"attendees",        // Depends on sessions
		"persons",          // Depends on attendees
		"bunks",            // No dependencies
		"bunk_plans",       // Depends on bunks, sessions
		"bunk_assignments", // Depends on bunk_plans, persons
		"bunk_requests",    // Depends on persons, sessions
	}

	// Verify each service depends on services earlier in the list
	type dependency struct {
		service string
		deps    []string
	}

	dependencies := []dependency{
		{service: "sessions", deps: nil},
		{service: "attendees", deps: []string{"sessions"}},
		{service: "persons", deps: []string{"attendees"}},
		{service: "bunks", deps: nil},
		{service: "bunk_plans", deps: []string{"sessions", "bunks"}},
		{service: "bunk_assignments", deps: []string{"bunk_plans", "persons"}},
		{service: "bunk_requests", deps: []string{"persons", "sessions"}},
	}

	positionMap := make(map[string]int)
	for i, name := range expectedOrder {
		positionMap[name] = i
	}

	for _, d := range dependencies {
		servicePos, exists := positionMap[d.service]
		if !exists {
			t.Errorf("service %q not in expected order", d.service)
			continue
		}

		for _, dep := range d.deps {
			depPos, exists := positionMap[dep]
			if !exists {
				t.Errorf("dependency %q not in expected order", dep)
				continue
			}

			if depPos >= servicePos {
				t.Errorf("%q (pos %d) must come after %q (pos %d)",
					d.service, servicePos, dep, depPos)
			}
		}
	}
}

// TestGenderMapping tests gender value mapping
func TestGenderMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input    string
		expected string
	}{
		{"M", "M"},
		{"F", "F"},
		{"Male", "M"},
		{"Female", "F"},
		{"m", "M"},
		{"f", "F"},
		{"male", "M"},
		{"female", "F"},
		{"MALE", "M"},
		{"FEMALE", "F"},
		{"Mixed", "Mixed"},
		{"mixed", "Mixed"},
		{"NB", "NB"},
		{"", ""},
		{"Unknown", "Unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := normalizeGender(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeGender(%q) = %q, want %q",
					tt.input, result, tt.expected)
			}
		})
	}
}

// normalizeGender normalizes gender values to standard format
func normalizeGender(gender string) string {
	switch gender {
	case "M", "m", "Male", "male", "MALE":
		return "M"
	case "F", "f", "Female", "female", "FEMALE":
		return "F"
	case genderMixed, "mixed", "MIXED":
		return genderMixed
	default:
		return gender
	}
}

// TestSessionTypeFromName tests session type extraction
func TestSessionTypeFromName(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		expected string
	}{
		{"Session 2", "main"},
		{"Session 3", "main"},
		{"Session 4", "main"},
		{"Taste of Camp", "main"},
		{"Session 2a", "embedded"},
		{"Session 3b", "embedded"},
		{"All-Gender Cabin", "ag"},
		{"Family Camp", "family"},
		{"Random Name", "other"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getSessionTypeForTest(tt.name)
			if result != tt.expected {
				t.Errorf("getSessionType(%q) = %q, want %q",
					tt.name, result, tt.expected)
			}
		})
	}
}

// getSessionTypeForTest is a test helper that mimics session type logic
func getSessionTypeForTest(name string) string {
	// Embedded sessions (partial sessions like 2a, 3b)
	if len(name) >= 10 {
		lastTwo := name[len(name)-2:]
		if lastTwo == "2a" || lastTwo == "2b" || lastTwo == "3a" || lastTwo == "3b" {
			return "embedded"
		}
	}

	// All-gender
	if name == "All-Gender Cabin" {
		return "ag"
	}

	// Family camps
	if name == "Family Camp" || name == "Winter Family Camp" {
		return "family"
	}

	// Main sessions
	mainSessions := []string{"Session 2", "Session 3", "Session 4", "Taste of Camp"}
	for _, main := range mainSessions {
		if name == main {
			return sessionTypeMain
		}
	}

	return "other"
}

// TestYearExtraction tests year extraction from various formats
func TestYearExtraction(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input    string
		expected int
		wantErr  bool
	}{
		{"2024", 2024, false},
		{"2025", 2025, false},
		{"", 0, true},
		{"abc", 0, true},
		{"2017", 2017, false},
		{"1999", 0, true}, // Too old
		{"2099", 0, true}, // Too far in future
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			year, err := extractYear(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error for input %q", tt.input)
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error for input %q: %v", tt.input, err)
				}
				if year != tt.expected {
					t.Errorf("extractYear(%q) = %d, want %d",
						tt.input, year, tt.expected)
				}
			}
		})
	}
}

// extractYear extracts and validates a year from string
func extractYear(s string) (int, error) {
	if s == "" {
		return 0, &yearError{"empty year string"}
	}

	year := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, &yearError{"non-numeric year"}
		}
		year = year*10 + int(c-'0')
	}

	// Valid range
	currentYear := time.Now().Year()
	if year < 2017 || year > currentYear+1 {
		return 0, &yearError{"year out of range"}
	}

	return year, nil
}

type yearError struct {
	msg string
}

func (e *yearError) Error() string {
	return e.msg
}

// TestCMIDValidation tests CampMinder ID validation
func TestCMIDValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		cmid    int
		isValid bool
	}{
		{12345678, true},
		{1, true},
		{0, false},
		{-1, false},
		{-12345, false},
	}

	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			valid := isValidCMID(tt.cmid)
			if valid != tt.isValid {
				t.Errorf("isValidCMID(%d) = %v, want %v",
					tt.cmid, valid, tt.isValid)
			}
		})
	}
}

// isValidCMID validates a CampMinder ID
func isValidCMID(cmid int) bool {
	return cmid > 0
}

// TestBunkNameParsing tests bunk name parsing
func TestBunkNameParsing(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		wantGender string
		wantNumber string
	}{
		{"B-1", "M", "1"},
		{"B-2", "M", "2"},
		{"G-1", "F", "1"},
		{"G-Aleph", "F", "Aleph"},
		{"AG-8", "Mixed", "8"},
		{"AG-10", "Mixed", "10"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gender, number := parseBunkName(tt.name)
			if gender != tt.wantGender {
				t.Errorf("gender = %q, want %q", gender, tt.wantGender)
			}
			if number != tt.wantNumber {
				t.Errorf("number = %q, want %q", number, tt.wantNumber)
			}
		})
	}
}

// parseBunkName extracts gender and number from bunk name
func parseBunkName(name string) (gender, number string) {
	if len(name) < 3 {
		return "", ""
	}

	// AG bunks
	if len(name) > 3 && name[:3] == "AG-" {
		return "Mixed", name[3:]
	}

	// B/G bunks
	if name[1] == '-' {
		switch name[0] {
		case 'B':
			return "M", name[2:]
		case 'G':
			return "F", name[2:]
		}
	}

	return "", ""
}

// TestRequestTypeValidation tests bunk request type validation
func TestRequestTypeValidation(t *testing.T) {
	t.Parallel()
	validTypes := []string{
		"bunk_with",
		"not_bunk_with",
		"bunking_notes",
		"internal_notes",
		"socialize_with",
	}

	for _, rt := range validTypes {
		if !isValidRequestType(rt) {
			t.Errorf("%q should be valid request type", rt)
		}
	}

	invalidTypes := []string{
		"",
		"invalid",
		"bunk",
		"BUNK_WITH",
	}

	for _, rt := range invalidTypes {
		if isValidRequestType(rt) {
			t.Errorf("%q should be invalid request type", rt)
		}
	}
}

// isValidRequestType validates a bunk request type
func isValidRequestType(rt string) bool {
	valid := map[string]bool{
		"bunk_with":      true,
		"not_bunk_with":  true,
		"bunking_notes":  true,
		"internal_notes": true,
		"socialize_with": true,
	}
	return valid[rt]
}

// TestPageSizeSelection tests page size selection logic
func TestPageSizeSelection(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		entityCount  int
		expectedSize int
	}{
		{"small dataset", 10, SmallPageSize},
		{"medium dataset", 100, DefaultPageSize},
		{"large dataset", 1000, LargePageSize},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			size := selectPageSize(tt.entityCount)
			if size != tt.expectedSize {
				t.Errorf("selectPageSize(%d) = %d, want %d",
					tt.entityCount, size, tt.expectedSize)
			}
		})
	}
}

// selectPageSize selects appropriate page size based on expected entity count
func selectPageSize(count int) int {
	if count <= 50 {
		return SmallPageSize
	}
	if count <= 500 {
		return DefaultPageSize
	}
	return LargePageSize
}
