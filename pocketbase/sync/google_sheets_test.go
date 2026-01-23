package sync

import (
	"context"
	"testing"
)


// MockSheetsWriter implements SheetsWriter interface for testing
type MockSheetsWriter struct {
	WrittenData  map[string][][]interface{} // sheetName -> rows
	ClearedTabs  []string
	EnsuredTabs  []string        // Tracks tabs that were ensured to exist
	ExistingTabs map[string]bool // Simulates which tabs already exist
	WriteError   error
	ClearError   error
	EnsureError  error
}

func NewMockSheetsWriter() *MockSheetsWriter {
	return &MockSheetsWriter{
		WrittenData:  make(map[string][][]interface{}),
		ClearedTabs:  []string{},
		EnsuredTabs:  []string{},
		ExistingTabs: make(map[string]bool),
	}
}

func (m *MockSheetsWriter) WriteToSheet(_ context.Context, _, sheetTab string, data [][]interface{}) error {
	if m.WriteError != nil {
		return m.WriteError
	}
	m.WrittenData[sheetTab] = data
	return nil
}

func (m *MockSheetsWriter) ClearSheet(_ context.Context, _, sheetTab string) error {
	if m.ClearError != nil {
		return m.ClearError
	}
	m.ClearedTabs = append(m.ClearedTabs, sheetTab)
	return nil
}

// EnsureSheet creates a sheet tab if it doesn't exist (idempotent)
func (m *MockSheetsWriter) EnsureSheet(_ context.Context, _, sheetTab string) error {
	if m.EnsureError != nil {
		return m.EnsureError
	}
	m.EnsuredTabs = append(m.EnsuredTabs, sheetTab)
	// Mark tab as existing after ensuring
	m.ExistingTabs[sheetTab] = true
	return nil
}

func TestGoogleSheetsExport_Name(t *testing.T) {
	export := &GoogleSheetsExport{}
	if got := export.Name(); got != "google_sheets_export" {
		t.Errorf("Name() = %q, want %q", got, "google_sheets_export")
	}
}

func TestGoogleSheetsExport_GetStats(t *testing.T) {
	export := &GoogleSheetsExport{}
	export.Stats = Stats{
		Created: 10,
		Updated: 5,
	}

	stats := export.GetStats()
	if stats.Created != 10 {
		t.Errorf("Stats.Created = %d, want 10", stats.Created)
	}
	if stats.Updated != 5 {
		t.Errorf("Stats.Updated = %d, want 5", stats.Updated)
	}
}

func TestMockSheetsWriter_EnsureSheetIsIdempotent(t *testing.T) {
	// Test that calling EnsureSheet multiple times works (idempotent)
	mock := NewMockSheetsWriter()
	ctx := context.Background()

	// Call EnsureSheet twice for the same tab
	err := mock.EnsureSheet(ctx, "spreadsheet-id", "TestTab")
	if err != nil {
		t.Errorf("First EnsureSheet() error = %v", err)
	}

	err = mock.EnsureSheet(ctx, "spreadsheet-id", "TestTab")
	if err != nil {
		t.Errorf("Second EnsureSheet() error = %v", err)
	}

	// Both calls should be recorded (real implementation would be idempotent at API level)
	if len(mock.EnsuredTabs) != 2 {
		t.Errorf("Expected 2 EnsureSheet calls recorded, got %d", len(mock.EnsuredTabs))
	}

	// Tab should be marked as existing
	if !mock.ExistingTabs["TestTab"] {
		t.Error("TestTab should be marked as existing after EnsureSheet")
	}
}

// =============================================================================
// Full Export Tests - Sync() should export all tables
// =============================================================================

func TestGetAllExportSheetNames(t *testing.T) {
	// Test that GetAllExportSheetNames returns all expected sheet tab names
	// This documents the expected behavior of the full export
	year := 2025
	names := GetAllExportSheetNames(year)

	// Expected: 6 year-specific + 4 global = 10 total tabs
	expectedTabs := []string{
		// Year-specific tables (6)
		"2025-attendees",
		"2025-persons",
		"2025-sessions",
		"2025-staff",
		"2025-bunk-assignments",
		"2025-financial-transactions",
		// Global tables (4)
		"globals-tag-definitions",
		"globals-custom-field-definitions",
		"globals-financial-categories",
		"globals-staff-positions",
	}

	if len(names) != len(expectedTabs) {
		t.Errorf("GetAllExportSheetNames() returned %d tabs, want %d", len(names), len(expectedTabs))
		t.Logf("Got: %v", names)
	}

	// Verify each expected tab is present
	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[n] = true
	}

	for _, expected := range expectedTabs {
		if !nameSet[expected] {
			t.Errorf("Missing expected tab: %s", expected)
		}
	}
}

func TestGetAllExportSheetNames_YearSubstitution(t *testing.T) {
	// Verify year placeholder is correctly substituted
	names2024 := GetAllExportSheetNames(2024)
	names2025 := GetAllExportSheetNames(2025)

	// Year-specific tabs should have different years
	has2024Attendees := false
	has2025Attendees := false

	for _, n := range names2024 {
		if n == "2024-attendees" {
			has2024Attendees = true
		}
	}
	for _, n := range names2025 {
		if n == "2025-attendees" {
			has2025Attendees = true
		}
	}

	if !has2024Attendees {
		t.Error("Expected 2024-attendees in 2024 export")
	}
	if !has2025Attendees {
		t.Error("Expected 2025-attendees in 2025 export")
	}

	// Global tabs should be the same for both years
	hasGlobals2024 := false
	hasGlobals2025 := false
	for _, n := range names2024 {
		if n == "globals-tag-definitions" {
			hasGlobals2024 = true
		}
	}
	for _, n := range names2025 {
		if n == "globals-tag-definitions" {
			hasGlobals2025 = true
		}
	}
	if !hasGlobals2024 || !hasGlobals2025 {
		t.Error("Global tabs should be present regardless of year")
	}
}
