package sync

import (
	"testing"
)

// TestGetSessionNamePattern tests the session name pattern generation
// Session 1 is "Taste of Camp", not "Session 1"
func TestGetSessionNamePattern(t *testing.T) {
	tests := []struct {
		name        string
		sessionNum  string
		wantPattern string
	}{
		{
			name:        "session 1 should match Taste of Camp",
			sessionNum:  "1",
			wantPattern: "Taste of Camp",
		},
		{
			name:        "session 2 should match Session 2",
			sessionNum:  "2",
			wantPattern: "Session 2",
		},
		{
			name:        "session 3 should match Session 3",
			sessionNum:  "3",
			wantPattern: "Session 3",
		},
		{
			name:        "session 4 should match Session 4",
			sessionNum:  "4",
			wantPattern: "Session 4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := getSessionNamePattern(tt.sessionNum)
			if got != tt.wantPattern {
				t.Errorf("getSessionNamePattern(%q) = %q, want %q", tt.sessionNum, got, tt.wantPattern)
			}
		})
	}
}

// TestIsEmbeddedSession tests detection of embedded sessions (2a, 2b, 3a, etc.)
func TestIsEmbeddedSession(t *testing.T) {
	tests := []struct {
		name       string
		sessionNum string
		want       bool
	}{
		// Main sessions - not embedded
		{"session 1 is main", "1", false},
		{"session 2 is main", "2", false},
		{"session 3 is main", "3", false},
		{"session 4 is main", "4", false},
		// Embedded sessions
		{"session 2a is embedded", "2a", true},
		{"session 2b is embedded", "2b", true},
		{"session 3a is embedded", "3a", true},
		{"session 3b is embedded", "3b", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isEmbeddedSession(tt.sessionNum)
			if got != tt.want {
				t.Errorf("isEmbeddedSession(%q) = %v, want %v", tt.sessionNum, got, tt.want)
			}
		})
	}
}
