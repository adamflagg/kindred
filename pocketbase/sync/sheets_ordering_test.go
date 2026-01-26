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

// =============================================================================
// API Call Efficiency Tests (Rate Limit Prevention)
// =============================================================================

// TestReorderAllTabs_UsesBatchUpdate verifies that ReorderAllTabs uses
// BatchUpdateTabProperties instead of individual SetTabColor/SetTabIndex calls.
// This is critical for avoiding Google Sheets API rate limits (60 writes/min).
func TestReorderAllTabs_UsesBatchUpdate(t *testing.T) {
	mock := NewMockSheetsWriter()

	// Setup 5 tabs (realistic subset)
	mock.ExistingTabs = map[string]bool{
		"g-division":    true,
		"g-tag-def":     true,
		"2025-attendee": true,
		"2025-person":   true,
		"2025-session":  true,
	}
	// Setup sheet IDs for metadata lookup
	mock.SheetIDsByName = map[string]int64{
		"g-division":    100,
		"g-tag-def":     101,
		"2025-attendee": 102,
		"2025-person":   103,
		"2025-session":  104,
	}

	err := ReorderAllTabs(context.Background(), mock, "test-spreadsheet-id", []string{})
	if err != nil {
		t.Fatalf("ReorderAllTabs() error = %v", err)
	}

	// Should use batch update, NOT individual SetTabColor/SetTabIndex calls
	if mock.BatchUpdateCalls != 1 {
		t.Errorf("BatchUpdateCalls = %d, want 1 (should batch all updates)", mock.BatchUpdateCalls)
	}

	// Individual calls should be 0
	if mock.SetColorCalls != 0 {
		t.Errorf("SetColorCalls = %d, want 0 (should use batch instead)", mock.SetColorCalls)
	}
	if mock.SetIndexCalls != 0 {
		t.Errorf("SetIndexCalls = %d, want 0 (should use batch instead)", mock.SetIndexCalls)
	}

	// Verify all tabs still got their properties set (via batch)
	if len(mock.TabColors) != 5 {
		t.Errorf("TabColors has %d entries, want 5", len(mock.TabColors))
	}
	if len(mock.TabIndices) != 5 {
		t.Errorf("TabIndices has %d entries, want 5", len(mock.TabIndices))
	}
}

// TestReorderAllTabs_SingleMetadataFetch verifies that ReorderAllTabs fetches
// metadata only once, not per-tab. Each metadata fetch is an API call.
func TestReorderAllTabs_SingleMetadataFetch(t *testing.T) {
	mock := NewMockSheetsWriter()

	// Setup 5 tabs
	mock.ExistingTabs = map[string]bool{
		"g-division":    true,
		"g-tag-def":     true,
		"2025-attendee": true,
		"2025-person":   true,
		"2025-session":  true,
	}
	mock.SheetIDsByName = map[string]int64{
		"g-division":    100,
		"g-tag-def":     101,
		"2025-attendee": 102,
		"2025-person":   103,
		"2025-session":  104,
	}

	err := ReorderAllTabs(context.Background(), mock, "test-spreadsheet-id", []string{})
	if err != nil {
		t.Fatalf("ReorderAllTabs() error = %v", err)
	}

	// Should fetch metadata exactly once (not 5+ times)
	if mock.GetMetadataCalls != 1 {
		t.Errorf("GetMetadataCalls = %d, want 1 (should reuse fetched metadata)", mock.GetMetadataCalls)
	}
}

// TestReorderAllTabs_LargeBatchAPIEfficiency tests the realistic scenario
// of 16 tabs to verify we stay well under the 60 writes/minute limit.
func TestReorderAllTabs_LargeBatchAPIEfficiency(t *testing.T) {
	mock := NewMockSheetsWriter()

	// Full 16-tab export scenario
	tabs := []string{
		"g-division", "g-tag-def", "g-fin-cat", "g-cust-field-def",
		"2025-attendee", "2025-person", "2025-session", "2025-staff",
		"2025-bunk-assign", "2025-transactions", "2025-bunk", "2025-household",
		"2025-sess-group", "2025-person-cv", "2025-household-cv", "2025-camper-history",
	}

	for i, tab := range tabs {
		mock.ExistingTabs[tab] = true
		mock.SheetIDsByName[tab] = int64(100 + i)
	}

	err := ReorderAllTabs(context.Background(), mock, "test-spreadsheet-id", []string{})
	if err != nil {
		t.Fatalf("ReorderAllTabs() error = %v", err)
	}

	// Total API calls should be minimal:
	// - 1 GetMetadata call (read)
	// - 1 BatchUpdate call (write)
	// = 2 total (vs old: 1 + 32 reads + 32 writes = 65 calls)

	totalAPICalls := mock.GetMetadataCalls + mock.BatchUpdateCalls
	if totalAPICalls > 2 {
		t.Errorf("Total API calls = %d, want <= 2 (1 metadata + 1 batch)", totalAPICalls)
	}

	// Verify no individual calls
	if mock.SetColorCalls > 0 || mock.SetIndexCalls > 0 {
		t.Errorf("Individual calls made: SetColor=%d, SetIndex=%d, want 0 for both",
			mock.SetColorCalls, mock.SetIndexCalls)
	}

	// Verify batch contains all updates
	if mock.BatchUpdateCalls == 1 && len(mock.LastBatchUpdates) != 16 {
		t.Errorf("Batch had %d updates, want 16", len(mock.LastBatchUpdates))
	}
}

// TestReorderAllTabs_BatchIncludesCorrectSheetIDs verifies that the batch
// update uses the correct SheetIDs from metadata (not redundant lookups).
func TestReorderAllTabs_BatchIncludesCorrectSheetIDs(t *testing.T) {
	mock := NewMockSheetsWriter()

	mock.ExistingTabs = map[string]bool{
		"g-division":    true,
		"2025-attendee": true,
	}
	// Specific sheet IDs that must be used
	mock.SheetIDsByName = map[string]int64{
		"g-division":    12345,
		"2025-attendee": 67890,
	}

	err := ReorderAllTabs(context.Background(), mock, "test-spreadsheet-id", []string{})
	if err != nil {
		t.Fatalf("ReorderAllTabs() error = %v", err)
	}

	// Verify the batch used the correct sheet IDs
	if mock.BatchUpdateCalls != 1 {
		t.Fatalf("Expected 1 batch call, got %d", mock.BatchUpdateCalls)
	}

	// Find updates for each tab and verify SheetID
	sheetIDsByTab := make(map[string]int64)
	for _, update := range mock.LastBatchUpdates {
		sheetIDsByTab[update.TabName] = update.SheetID
	}

	if sheetIDsByTab["g-division"] != 12345 {
		t.Errorf("g-division SheetID = %d, want 12345", sheetIDsByTab["g-division"])
	}
	if sheetIDsByTab["2025-attendee"] != 67890 {
		t.Errorf("2025-attendee SheetID = %d, want 67890", sheetIDsByTab["2025-attendee"])
	}
}
