package sync

import (
	"context"
	"testing"
)

// MockSheetsWriter implements SheetsWriter interface for testing
type MockSheetsWriter struct {
	WrittenData   map[string][][]interface{} // sheetName -> rows
	ClearedTabs   []string
	EnsuredTabs   []string            // Tracks tabs that were ensured to exist
	ExistingTabs  map[string]bool     // Simulates which tabs already exist
	TabColors     map[string]TabColor // sheetTab -> color (for SetTabColor)
	TabIndices    map[string]int      // sheetTab -> index (for SetTabIndex)
	WriteError    error
	ClearError    error
	EnsureError   error
	SetColorError error
	SetIndexError error

	// API call tracking for rate limit testing
	SetColorCalls    int                   // Number of SetTabColor calls
	SetIndexCalls    int                   // Number of SetTabIndex calls
	BatchUpdateCalls int                   // Number of BatchUpdateTabProperties calls
	LastBatchUpdates []TabPropertyUpdate   // Last batch update request
	AllBatchUpdates  [][]TabPropertyUpdate // All batch update requests
	BatchUpdateError error
	GetMetadataCalls int              // Number of GetSheetMetadata calls
	SheetIDsByName   map[string]int64 // tab name -> sheet ID for metadata lookups
}

func NewMockSheetsWriter() *MockSheetsWriter {
	return &MockSheetsWriter{
		WrittenData:     make(map[string][][]interface{}),
		ClearedTabs:     []string{},
		EnsuredTabs:     []string{},
		ExistingTabs:    make(map[string]bool),
		TabColors:       make(map[string]TabColor),
		TabIndices:      make(map[string]int),
		AllBatchUpdates: [][]TabPropertyUpdate{},
		SheetIDsByName:  make(map[string]int64),
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
	m.SetColorCalls++
	if m.SetColorError != nil {
		return m.SetColorError
	}
	m.TabColors[sheetTab] = color
	return nil
}

// SetTabIndex sets the position of a sheet tab
func (m *MockSheetsWriter) SetTabIndex(_ context.Context, _, sheetTab string, index int) error {
	m.SetIndexCalls++
	if m.SetIndexError != nil {
		return m.SetIndexError
	}
	m.TabIndices[sheetTab] = index
	return nil
}

// GetSheetMetadata returns metadata for all sheets
func (m *MockSheetsWriter) GetSheetMetadata(_ context.Context, _ string) ([]SheetInfo, error) {
	m.GetMetadataCalls++
	// Build from existing tabs
	result := make([]SheetInfo, 0, len(m.ExistingTabs))
	i := int64(0)
	for tab := range m.ExistingTabs {
		sheetID := i
		if id, ok := m.SheetIDsByName[tab]; ok {
			sheetID = id
		}
		result = append(result, SheetInfo{
			Title:   tab,
			SheetID: sheetID,
			Index:   m.TabIndices[tab],
		})
		i++
	}
	return result, nil
}

// BatchUpdateTabProperties updates multiple tabs' properties in a single call
func (m *MockSheetsWriter) BatchUpdateTabProperties(_ context.Context, _ string, updates []TabPropertyUpdate) error {
	m.BatchUpdateCalls++
	m.LastBatchUpdates = updates
	m.AllBatchUpdates = append(m.AllBatchUpdates, updates)
	if m.BatchUpdateError != nil {
		return m.BatchUpdateError
	}
	// Apply the updates to our tracking maps (simulates what the real API would do)
	for _, update := range updates {
		if update.Color != nil {
			m.TabColors[update.TabName] = *update.Color
		}
		if update.Index != nil {
			m.TabIndices[update.TabName] = *update.Index
		}
	}
	return nil
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
// BatchUpdateTabProperties Tests
// =============================================================================

func TestBatchUpdateTabProperties_CombinesAllUpdates(t *testing.T) {
	// Test that BatchUpdateTabProperties accepts multiple tab updates
	// and applies them all in a single call
	mock := NewMockSheetsWriter()
	ctx := context.Background()

	color1 := TabColorGlobal
	color2 := TabColor2025
	idx0 := 0
	idx1 := 1
	idx2 := 2

	updates := []TabPropertyUpdate{
		{TabName: "g-division", SheetID: 100, Color: &color1, Index: &idx0},
		{TabName: "2025-attendee", SheetID: 101, Color: &color2, Index: &idx1},
		{TabName: "2025-person", SheetID: 102, Color: &color2, Index: &idx2},
	}

	err := mock.BatchUpdateTabProperties(ctx, "test-spreadsheet", updates)
	if err != nil {
		t.Fatalf("BatchUpdateTabProperties() error = %v", err)
	}

	// Verify only ONE batch call was made (not 3 separate calls)
	if mock.BatchUpdateCalls != 1 {
		t.Errorf("BatchUpdateCalls = %d, want 1", mock.BatchUpdateCalls)
	}

	// Verify all updates were captured
	if len(mock.LastBatchUpdates) != 3 {
		t.Errorf("LastBatchUpdates has %d items, want 3", len(mock.LastBatchUpdates))
	}

	// Verify the updates were applied correctly
	if mock.TabColors["g-division"] != TabColorGlobal {
		t.Error("g-division should have TabColorGlobal")
	}
	if mock.TabColors["2025-attendee"] != TabColor2025 {
		t.Error("2025-attendee should have TabColor2025")
	}
	if mock.TabIndices["g-division"] != 0 {
		t.Errorf("g-division index = %d, want 0", mock.TabIndices["g-division"])
	}
	if mock.TabIndices["2025-attendee"] != 1 {
		t.Errorf("2025-attendee index = %d, want 1", mock.TabIndices["2025-attendee"])
	}
}

func TestBatchUpdateTabProperties_PartialUpdates(t *testing.T) {
	// Test that we can update only color or only index for individual tabs
	mock := NewMockSheetsWriter()
	ctx := context.Background()

	color1 := TabColorGlobal
	idx1 := 5

	updates := []TabPropertyUpdate{
		{TabName: "tab1", SheetID: 100, Color: &color1, Index: nil}, // Color only
		{TabName: "tab2", SheetID: 101, Color: nil, Index: &idx1},   // Index only
	}

	err := mock.BatchUpdateTabProperties(ctx, "test-spreadsheet", updates)
	if err != nil {
		t.Fatalf("BatchUpdateTabProperties() error = %v", err)
	}

	// tab1 should have color but not index
	if mock.TabColors["tab1"] != TabColorGlobal {
		t.Error("tab1 should have TabColorGlobal")
	}
	if _, hasIndex := mock.TabIndices["tab1"]; hasIndex {
		t.Error("tab1 should not have index set")
	}

	// tab2 should have index but not color
	if _, hasColor := mock.TabColors["tab2"]; hasColor {
		t.Error("tab2 should not have color set")
	}
	if mock.TabIndices["tab2"] != 5 {
		t.Errorf("tab2 index = %d, want 5", mock.TabIndices["tab2"])
	}
}

func TestBatchUpdateTabProperties_EmptyUpdates(t *testing.T) {
	// Test that empty updates list doesn't cause errors
	mock := NewMockSheetsWriter()
	ctx := context.Background()

	err := mock.BatchUpdateTabProperties(ctx, "test-spreadsheet", []TabPropertyUpdate{})
	if err != nil {
		t.Fatalf("BatchUpdateTabProperties() with empty updates should not error: %v", err)
	}

	if mock.BatchUpdateCalls != 1 {
		t.Errorf("BatchUpdateCalls = %d, want 1", mock.BatchUpdateCalls)
	}
}

func TestBatchUpdateTabProperties_PreservesSheetID(t *testing.T) {
	// Verify that SheetID is correctly passed through for each update
	mock := NewMockSheetsWriter()
	ctx := context.Background()

	color1 := TabColorGlobal
	idx0 := 0

	updates := []TabPropertyUpdate{
		{TabName: "tab1", SheetID: 12345, Color: &color1, Index: &idx0},
		{TabName: "tab2", SheetID: 67890, Color: &color1, Index: &idx0},
	}

	err := mock.BatchUpdateTabProperties(ctx, "test-spreadsheet", updates)
	if err != nil {
		t.Fatalf("BatchUpdateTabProperties() error = %v", err)
	}

	// Verify SheetIDs were captured correctly
	if mock.LastBatchUpdates[0].SheetID != 12345 {
		t.Errorf("First update SheetID = %d, want 12345", mock.LastBatchUpdates[0].SheetID)
	}
	if mock.LastBatchUpdates[1].SheetID != 67890 {
		t.Errorf("Second update SheetID = %d, want 67890", mock.LastBatchUpdates[1].SheetID)
	}
}

func TestBatchUpdateTabProperties_ErrorHandling(t *testing.T) {
	// Test that errors are properly propagated
	mock := NewMockSheetsWriter()
	mock.BatchUpdateError = context.DeadlineExceeded
	ctx := context.Background()

	color1 := TabColorGlobal
	idx0 := 0

	updates := []TabPropertyUpdate{
		{TabName: "tab1", SheetID: 100, Color: &color1, Index: &idx0},
	}

	err := mock.BatchUpdateTabProperties(ctx, "test-spreadsheet", updates)
	if err != context.DeadlineExceeded {
		t.Errorf("BatchUpdateTabProperties() error = %v, want context.DeadlineExceeded", err)
	}
}

func TestBatchUpdateTabProperties_LargeBatch(t *testing.T) {
	// Test that a large batch (similar to real 16+ tabs) works correctly
	mock := NewMockSheetsWriter()
	ctx := context.Background()

	// Simulate 16 tabs (realistic scenario)
	tabs := []string{
		"g-division", "g-tag-def", "g-fin-cat", "g-cust-field-def",
		"2025-attendee", "2025-person", "2025-session", "2025-staff",
		"2025-bunk-assign", "2025-transactions", "2025-bunk", "2025-household",
		"2025-sess-group", "2025-person-cv", "2025-household-cv", "2025-camper-history",
	}

	updates := make([]TabPropertyUpdate, len(tabs))
	for i, tab := range tabs {
		color := GetTabColor(tab)
		idx := i
		updates[i] = TabPropertyUpdate{
			TabName: tab,
			SheetID: int64(100 + i),
			Color:   &color,
			Index:   &idx,
		}
	}

	err := mock.BatchUpdateTabProperties(ctx, "test-spreadsheet", updates)
	if err != nil {
		t.Fatalf("BatchUpdateTabProperties() error = %v", err)
	}

	// Verify single API call for all 16 tabs
	if mock.BatchUpdateCalls != 1 {
		t.Errorf("BatchUpdateCalls = %d, want 1 (should batch all 16 tabs)", mock.BatchUpdateCalls)
	}

	// Verify all tabs got their properties set
	if len(mock.TabColors) != 16 {
		t.Errorf("TabColors has %d entries, want 16", len(mock.TabColors))
	}
	if len(mock.TabIndices) != 16 {
		t.Errorf("TabIndices has %d entries, want 16", len(mock.TabIndices))
	}

	// Spot-check some values
	if mock.TabIndices["g-division"] != 0 {
		t.Errorf("g-division index = %d, want 0", mock.TabIndices["g-division"])
	}
	if mock.TabIndices["2025-camper-history"] != 15 {
		t.Errorf("2025-camper-history index = %d, want 15", mock.TabIndices["2025-camper-history"])
	}
}
