package sync

import (
	"testing"
)

// TestParseDate_SharedFunction tests the shared ParseDate function that consolidates
// date parsing from attendees.go, sessions.go, staff.go, and financial_transactions.go.
// All 4 services previously had their own parseDate with inconsistent format lists,
// output formats, and error handling.
func TestParseDate_SharedFunction(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		// === RFC3339 variants (most common from CampMinder) ===
		{
			name:     "RFC3339 with timezone offset",
			input:    "2024-06-15T10:30:00-07:00",
			expected: "2024-06-15 17:30:00Z",
		},
		{
			name:     "RFC3339 UTC",
			input:    "2024-06-15T10:30:00Z",
			expected: "2024-06-15 10:30:00Z",
		},
		{
			name:     "RFC3339Nano",
			input:    "2024-06-15T10:30:00.123456789Z",
			expected: "2024-06-15 10:30:00Z",
		},

		// === ISO 8601 variants ===
		{
			name:     "ISO with Z suffix",
			input:    "2024-06-15T10:30:00Z",
			expected: "2024-06-15 10:30:00Z",
		},
		{
			name:     "ISO with milliseconds and Z",
			input:    "2024-06-15T10:30:00.000Z",
			expected: "2024-06-15 10:30:00Z",
		},
		{
			name:     "ISO without timezone",
			input:    "2024-06-15T10:30:00",
			expected: "2024-06-15 10:30:00Z",
		},

		// === Date-only format ===
		{
			name:     "date only YYYY-MM-DD",
			input:    "2024-06-15",
			expected: "2024-06-15 00:00:00Z",
		},
		{
			name:     "date only normalizes to midnight (idempotency fix from PR #735)",
			input:    "2025-12-03",
			expected: "2025-12-03 00:00:00Z",
		},

		// === US date formats ===
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

		// === Edge cases ===
		{
			name:     "empty string returns empty",
			input:    "",
			expected: "",
		},
		{
			name:     "unparseable returns empty string (not raw input)",
			input:    "not a date",
			expected: "",
		},
		{
			name:     "partial date returns empty string",
			input:    "2024-06",
			expected: "",
		},
		{
			name:     "timestamp with positive offset",
			input:    "2024-06-15T10:30:00+05:30",
			expected: "2024-06-15 05:00:00Z",
		},
		{
			name:     "midnight ISO",
			input:    "2024-01-01T00:00:00Z",
			expected: "2024-01-01 00:00:00Z",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseDate(tt.input)
			if got != tt.expected {
				t.Errorf("ParseDate(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// TestParseDateValue tests the interface{}-accepting wrapper used by financial_transactions.go
func TestParseDateValue(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		input    any
		expected string
	}{
		{
			name:     "nil returns empty",
			input:    nil,
			expected: "",
		},
		{
			name:     "non-string returns empty",
			input:    12345,
			expected: "",
		},
		{
			name:     "empty string returns empty",
			input:    "",
			expected: "",
		},
		{
			name:     "valid date string",
			input:    "2024-06-15T10:30:00Z",
			expected: "2024-06-15 10:30:00Z",
		},
		{
			name:     "valid date-only string",
			input:    "2024-06-15",
			expected: "2024-06-15 00:00:00Z",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseDateValue(tt.input)
			if got != tt.expected {
				t.Errorf("ParseDateValue(%v) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// TestParseDate_ConsistentOutputFormat ensures all parseable inputs produce
// the same output format: "2006-01-02 15:04:05Z" (PocketBase DateTime without millis)
func TestParseDate_ConsistentOutputFormat(t *testing.T) {
	t.Parallel()
	inputs := []string{
		"2024-06-15T10:30:00Z",
		"2024-06-15T10:30:00.000Z",
		"2024-06-15T10:30:00",
		"2024-06-15T10:30:00-07:00",
		"2024-06-15T10:30:00.123456789Z",
		"2024-06-15",
		"6/15/2024",
		"06/15/2024",
	}

	for _, input := range inputs {
		got := ParseDate(input)
		if got == "" {
			t.Errorf("ParseDate(%q) returned empty, expected a valid date", input)
			continue
		}
		// All outputs should end with "Z" and have no "T" or milliseconds
		if got[len(got)-1] != 'Z' {
			t.Errorf("ParseDate(%q) = %q, output should end with Z", input, got)
		}
		if len(got) != 20 { // "2006-01-02 15:04:05Z" is 20 chars
			t.Errorf("ParseDate(%q) = %q, output should be 20 chars (got %d)", input, got, len(got))
		}
	}
}
