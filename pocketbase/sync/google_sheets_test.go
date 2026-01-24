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
	TabColors    map[string]TabColor // sheetTab -> color (for SetTabColor)
	TabIndices   map[string]int  // sheetTab -> index (for SetTabIndex)
	WriteError   error
	ClearError   error
	EnsureError  error
	SetColorError error
	SetIndexError error
}

func NewMockSheetsWriter() *MockSheetsWriter {
	return &MockSheetsWriter{
		WrittenData:  make(map[string][][]interface{}),
		ClearedTabs:  []string{},
		EnsuredTabs:  []string{},
		ExistingTabs: make(map[string]bool),
		TabColors:    make(map[string]TabColor),
		TabIndices:   make(map[string]int),
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

// SetTabColor sets the color for a sheet tab
func (m *MockSheetsWriter) SetTabColor(_ context.Context, _, sheetTab string, color TabColor) error {
	if m.SetColorError != nil {
		return m.SetColorError
	}
	m.TabColors[sheetTab] = color
	return nil
}

// SetTabIndex sets the position of a sheet tab
func (m *MockSheetsWriter) SetTabIndex(_ context.Context, _, sheetTab string, index int) error {
	if m.SetIndexError != nil {
		return m.SetIndexError
	}
	m.TabIndices[sheetTab] = index
	return nil
}

// GetSheetMetadata returns metadata for all sheets
func (m *MockSheetsWriter) GetSheetMetadata(_ context.Context, _ string) ([]SheetInfo, error) {
	// Build from existing tabs
	result := make([]SheetInfo, 0, len(m.ExistingTabs))
	i := 0
	for tab := range m.ExistingTabs {
		result = append(result, SheetInfo{
			Title:   tab,
			SheetID: int64(i),
			Index:   m.TabIndices[tab],
		})
		i++
	}
	return result, nil
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

	// Expected: 11 year-specific + 4 global = 15 total tabs
	expectedTabs := []string{
		// Year-specific tables (11) - shortened names
		"2025-attendee",
		"2025-person",
		"2025-session",
		"2025-staff",
		"2025-bunk-assign",
		"2025-transactions",
		"2025-bunk",
		"2025-household",
		"2025-sess-group",
		"2025-person-cv",
		"2025-household-cv",
		// Global tables (4) - shortened names with "g-" prefix
		"g-tag-def",
		"g-cust-field-def",
		"g-fin-cat",
		"g-division",
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

	// Year-specific tabs should have different years (shortened names)
	has2024Attendee := false
	has2025Attendee := false

	for _, n := range names2024 {
		if n == "2024-attendee" {
			has2024Attendee = true
		}
	}
	for _, n := range names2025 {
		if n == "2025-attendee" {
			has2025Attendee = true
		}
	}

	if !has2024Attendee {
		t.Error("Expected 2024-attendee in 2024 export")
	}
	if !has2025Attendee {
		t.Error("Expected 2025-attendee in 2025 export")
	}

	// Global tabs should be the same for both years (use short "g-" prefix)
	const globalsTab = "g-tag-def"
	hasGlobals2024 := false
	hasGlobals2025 := false
	for _, n := range names2024 {
		if n == globalsTab {
			hasGlobals2024 = true
		}
	}
	for _, n := range names2025 {
		if n == globalsTab {
			hasGlobals2025 = true
		}
	}
	if !hasGlobals2024 || !hasGlobals2025 {
		t.Error("Global tabs should be present regardless of year")
	}
}

// =============================================================================
// Tab Color Tests
// =============================================================================

func TestGetTabColor_GlobalTabs(t *testing.T) {
	// Global tabs (g-*) should get light blue color
	tests := []string{
		"g-tag-def",
		"g-cust-field-def",
		"g-fin-cat",
		"g-division",
	}

	for _, tab := range tests {
		t.Run(tab, func(t *testing.T) {
			color := GetTabColor(tab)
			if color != TabColorGlobal {
				t.Errorf("GetTabColor(%q) = %v, want %v (TabColorGlobal)", tab, color, TabColorGlobal)
			}
		})
	}
}

func TestGetTabColor_YearTabs(t *testing.T) {
	// Year tabs should get year-specific colors
	tests := []struct {
		tab      string
		expected TabColor
	}{
		{"2024-attendee", TabColor2024},
		{"2024-person", TabColor2024},
		{"2025-session", TabColor2025},
		{"2025-staff", TabColor2025},
		{"2026-bunk", TabColor2026},
	}

	for _, tt := range tests {
		t.Run(tt.tab, func(t *testing.T) {
			color := GetTabColor(tt.tab)
			if color != tt.expected {
				t.Errorf("GetTabColor(%q) = %v, want %v", tt.tab, color, tt.expected)
			}
		})
	}
}

func TestGetTabColor_FutureYears(t *testing.T) {
	// Future years (2027+) should cycle through palette
	color2027 := GetTabColor("2027-attendees")
	color2028 := GetTabColor("2028-attendees")

	// Both should have valid RGB values (not empty)
	if color2027.R == 0 && color2027.G == 0 && color2027.B == 0 {
		t.Error("2027 should have a non-zero color")
	}
	if color2028.R == 0 && color2028.G == 0 && color2028.B == 0 {
		t.Error("2028 should have a non-zero color")
	}
}

func TestGetTabColor_UnknownTabs(t *testing.T) {
	// Tabs that don't match g-* or YYYY-* should get default color
	color := GetTabColor("random-sheet")
	if color != TabColorDefault {
		t.Errorf("GetTabColor(unknown) = %v, want %v (TabColorDefault)", color, TabColorDefault)
	}
}

func TestTabColorConstants(t *testing.T) {
	// Verify color constants are defined with valid RGB values
	colors := map[string]TabColor{
		"TabColorGlobal":  TabColorGlobal,
		"TabColor2024":    TabColor2024,
		"TabColor2025":    TabColor2025,
		"TabColor2026":    TabColor2026,
		"TabColorDefault": TabColorDefault,
	}

	for name, color := range colors {
		t.Run(name, func(t *testing.T) {
			// RGB values should be between 0 and 1
			if color.R < 0 || color.R > 1 {
				t.Errorf("%s.R = %v, want 0-1", name, color.R)
			}
			if color.G < 0 || color.G > 1 {
				t.Errorf("%s.G = %v, want 0-1", name, color.G)
			}
			if color.B < 0 || color.B > 1 {
				t.Errorf("%s.B = %v, want 0-1", name, color.B)
			}
		})
	}
}

// =============================================================================
// Tab Ordering Tests
// =============================================================================

func TestSortExportTabs_GlobalsFirst(t *testing.T) {
	// Globals should always come before year tabs
	tabs := []string{
		"2025-attendee",
		"g-division",
		"2024-person",
		"g-tag-def",
	}

	sorted := SortExportTabs(tabs)

	// First two should be globals (alphabetized)
	if sorted[0] != "g-division" {
		t.Errorf("sorted[0] = %q, want g-division", sorted[0])
	}
	if sorted[1] != "g-tag-def" {
		t.Errorf("sorted[1] = %q, want g-tag-def", sorted[1])
	}
}

func TestSortExportTabs_YearsDescending(t *testing.T) {
	// Years should be in descending order (newest first)
	tabs := []string{
		"2024-attendee",
		"2026-attendee",
		"2025-attendee",
	}

	sorted := SortExportTabs(tabs)

	if sorted[0] != "2026-attendee" {
		t.Errorf("sorted[0] = %q, want 2026-attendee (newest first)", sorted[0])
	}
	if sorted[1] != "2025-attendee" {
		t.Errorf("sorted[1] = %q, want 2025-attendee", sorted[1])
	}
	if sorted[2] != "2024-attendee" {
		t.Errorf("sorted[2] = %q, want 2024-attendee (oldest last)", sorted[2])
	}
}

func TestSortExportTabs_AlphabetizedWithinGroups(t *testing.T) {
	// Within each group (globals, each year), tabs should be alphabetized
	tabs := []string{
		"2025-staff",
		"2025-attendee",
		"g-tag-def",
		"g-division",
		"2025-bunk",
	}

	sorted := SortExportTabs(tabs)

	// Expected order:
	// 1. g-division (global, alphabetized)
	// 2. g-tag-def (global, alphabetized)
	// 3. 2025-attendee (2025, alphabetized)
	// 4. 2025-bunk (2025, alphabetized)
	// 5. 2025-staff (2025, alphabetized)
	expected := []string{
		"g-division",
		"g-tag-def",
		"2025-attendee",
		"2025-bunk",
		"2025-staff",
	}

	for i, want := range expected {
		if sorted[i] != want {
			t.Errorf("sorted[%d] = %q, want %q", i, sorted[i], want)
		}
	}
}

func TestSortExportTabs_FullExport(t *testing.T) {
	// Full export with multiple years and globals
	tabs := []string{
		"2024-attendee",
		"g-fin-cat",
		"2025-staff",
		"2026-bunk",
		"g-division",
		"2025-attendee",
		"2024-person",
	}

	sorted := SortExportTabs(tabs)

	// Verify globals come first
	if sorted[0] != "g-division" || sorted[1] != "g-fin-cat" {
		t.Errorf("Globals should be first and alphabetized: got %v", sorted[:2])
	}

	// Verify 2026 comes before 2025 before 2024
	yearOrder := make([]int, 0, len(sorted)-2)
	for _, tab := range sorted[2:] {
		year := ExtractYear(tab)
		yearOrder = append(yearOrder, year)
	}

	// Years should be descending within same-year groups
	for i := 1; i < len(yearOrder); i++ {
		if yearOrder[i] > yearOrder[i-1] {
			t.Errorf("Years should be descending, got %v", yearOrder)
			break
		}
	}
}

func TestExtractYear(t *testing.T) {
	tests := []struct {
		tab  string
		want int
	}{
		{"2025-attendee", 2025},
		{"2024-person", 2024},
		{"2026-bunk", 2026},
		{"g-division", 0},            // Global, no year
		{"random", 0},                // Unknown format
		{"25-attendee", 0},           // Too short for year
	}

	for _, tt := range tests {
		t.Run(tt.tab, func(t *testing.T) {
			got := ExtractYear(tt.tab)
			if got != tt.want {
				t.Errorf("ExtractYear(%q) = %d, want %d", tt.tab, got, tt.want)
			}
		})
	}
}
