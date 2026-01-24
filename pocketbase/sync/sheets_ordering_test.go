package sync

import (
	"context"
	"testing"
)

func TestIsExportTab(t *testing.T) {
	tests := []struct {
		tab  string
		want bool
	}{
		// Global tabs should match (shortened names)
		{"g-division", true},
		{"g-tag-def", true},
		{"g-cust-field-def", true},
		{"g-fin-cat", true},

		// Year tabs should match (shortened names)
		{"2025-attendee", true},
		{"2024-person", true},
		{"2026-bunk", true},
		{"2023-bunk-assign", true},

		// Non-export tabs should NOT match
		{"Sheet1", false},      // Default Google Sheets tab
		{"Notes", false},       // User-created tab
		{"random-tab", false},  // Random tab
		{"Summary", false},     // User-created tab
		{"globals-old", false}, // Old prefix (no longer used)
		{"test", false},        // Short name
		{"", false},            // Empty string
		{"1999-data", false},   // Year < 2000 is not valid
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

// TestReorderAllTabs_FetchesAllExistingTabs tests that ReorderAllTabs considers ALL
// existing tabs in the spreadsheet, not just the ones passed in exportedTabs.
// This is critical for historical syncs where 2024 data is exported to a spreadsheet
// that already contains 2025 data.
func TestReorderAllTabs_FetchesAllExistingTabs(t *testing.T) {
	mock := NewMockSheetsWriter()

	// Pre-existing tabs in the spreadsheet (from previous 2025 sync)
	mock.ExistingTabs = map[string]bool{
		"g-division":    true,
		"2025-attendee": true,
		"2025-person":   true,
	}

	// Run a "2024 historical sync" - these are the only tabs we exported this run
	exportedTabs := []string{"2024-attendee", "2024-person"}

	// Ensure the 2024 tabs also exist in the mock (as if they were just created)
	for _, tab := range exportedTabs {
		mock.ExistingTabs[tab] = true
	}

	// Execute
	err := ReorderAllTabs(context.Background(), mock, "test-spreadsheet-id", exportedTabs)
	if err != nil {
		t.Fatalf("ReorderAllTabs() error = %v", err)
	}

	// The key assertion: ReorderAllTabs must fetch and reorder ALL tabs,
	// not just the exportedTabs parameter.
	// Expected order: g-division (0), 2025-attendee (1), 2025-person (2), 2024-attendee (3), 2024-person (4)

	expectedOrder := map[string]int{
		"g-division":    0,
		"2025-attendee": 1,
		"2025-person":   2,
		"2024-attendee": 3,
		"2024-person":   4,
	}

	for tab, expectedIndex := range expectedOrder {
		if gotIndex, ok := mock.TabIndices[tab]; !ok {
			t.Errorf("Tab %q was not reordered (not in TabIndices)", tab)
		} else if gotIndex != expectedIndex {
			t.Errorf("Tab %q index = %d, want %d", tab, gotIndex, expectedIndex)
		}
	}

	// Also verify we got colors for all tabs
	for tab := range expectedOrder {
		if _, ok := mock.TabColors[tab]; !ok {
			t.Errorf("Tab %q did not get a color assigned", tab)
		}
	}
}

// TestReorderAllTabs_IgnoresNonExportTabs tests that user-created tabs like "Sheet1"
// or "Notes" are left alone and not included in the reordering.
func TestReorderAllTabs_IgnoresNonExportTabs(t *testing.T) {
	mock := NewMockSheetsWriter()

	// Mix of export tabs and user-created tabs
	mock.ExistingTabs = map[string]bool{
		"Sheet1":        true, // Default Google Sheets tab - should be ignored
		"Notes":         true, // User-created tab - should be ignored
		"g-division":    true,
		"2025-attendee": true,
	}

	err := ReorderAllTabs(context.Background(), mock, "test-spreadsheet-id", []string{})
	if err != nil {
		t.Fatalf("ReorderAllTabs() error = %v", err)
	}

	// Only export tabs should be in TabIndices
	if _, ok := mock.TabIndices["Sheet1"]; ok {
		t.Error("Sheet1 should not be reordered (non-export tab)")
	}
	if _, ok := mock.TabIndices["Notes"]; ok {
		t.Error("Notes should not be reordered (non-export tab)")
	}

	// Export tabs should be reordered
	if mock.TabIndices["g-division"] != 0 {
		t.Errorf("g-division index = %d, want 0", mock.TabIndices["g-division"])
	}
	if mock.TabIndices["2025-attendee"] != 1 {
		t.Errorf("2025-attendee index = %d, want 1", mock.TabIndices["2025-attendee"])
	}
}
