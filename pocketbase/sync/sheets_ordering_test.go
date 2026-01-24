package sync

import "testing"

func TestIsExportTab(t *testing.T) {
	tests := []struct {
		tab  string
		want bool
	}{
		// Global tabs should match
		{"g-divisions", true},
		{"g-tag-definitions", true},
		{"g-custom-field-definitions", true},
		{"g-financial-categories", true},

		// Year tabs should match
		{"2025-attendees", true},
		{"2024-persons", true},
		{"2026-bunks", true},
		{"2023-bunk-assignments", true},

		// Non-export tabs should NOT match
		{"Sheet1", false},           // Default Google Sheets tab
		{"Notes", false},            // User-created tab
		{"random-tab", false},       // Random tab
		{"Summary", false},          // User-created tab
		{"globals-old", false},      // Old prefix (no longer used)
		{"test", false},             // Short name
		{"", false},                 // Empty string
		{"1999-data", false},        // Year < 2000 is not valid
	}

	for _, tt := range tests {
		t.Run(tt.tab, func(t *testing.T) {
			got := IsExportTab(tt.tab)
			if got != tt.want {
				t.Errorf("IsExportTab(%q) = %v, want %v", tt.tab, got, tt.want)
			}
		})
	}
}
