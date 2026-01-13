package sync

import (
	"testing"
)

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
