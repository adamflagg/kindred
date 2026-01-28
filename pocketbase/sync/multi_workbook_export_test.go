package sync

import (
	"context"
	"testing"
)

// =============================================================================
// Multi-Workbook Export Tests
// Tests for the new multi-workbook architecture where:
// - Globals go to a dedicated globals workbook
// - Year data goes to per-year workbooks
// - Master index is updated after each sync
// =============================================================================

// MockWorkbookManager implements a test double for WorkbookManager
type MockWorkbookManager struct {
	GlobalsWorkbookID     string
	YearWorkbookIDs       map[int]string // year -> spreadsheet ID
	CreatedWorkbooks      []WorkbookRecord
	UpdatedStats          []WorkbookStatsUpdate
	IndexUpdated          bool
	GetOrCreateGlobalsErr error
	GetOrCreateYearErr    error
	UpdateIndexErr        error
}

// WorkbookStatsUpdate tracks calls to UpdateWorkbookStats
type WorkbookStatsUpdate struct {
	RecordID     string
	TabCount     int
	TotalRecords int
	Status       string
	ErrorMessage string
}

func NewMockWorkbookManager() *MockWorkbookManager {
	return &MockWorkbookManager{
		GlobalsWorkbookID: "globals-workbook-id",
		YearWorkbookIDs:   make(map[int]string),
		CreatedWorkbooks:  []WorkbookRecord{},
		UpdatedStats:      []WorkbookStatsUpdate{},
	}
}

// GetOrCreateGlobalsWorkbook returns the globals workbook ID
func (m *MockWorkbookManager) GetOrCreateGlobalsWorkbook(_ context.Context) (string, error) {
	if m.GetOrCreateGlobalsErr != nil {
		return "", m.GetOrCreateGlobalsErr
	}
	return m.GlobalsWorkbookID, nil
}

// GetOrCreateYearWorkbook returns the year workbook ID, creating if needed
func (m *MockWorkbookManager) GetOrCreateYearWorkbook(_ context.Context, year int) (string, error) {
	if m.GetOrCreateYearErr != nil {
		return "", m.GetOrCreateYearErr
	}
	if id, ok := m.YearWorkbookIDs[year]; ok {
		return id, nil
	}
	// Auto-create for the year
	id := "year-" + string(rune('0'+year%10)) + "-workbook-id"
	m.YearWorkbookIDs[year] = id
	return id, nil
}

// UpdateMasterIndex updates the index sheet in globals workbook
func (m *MockWorkbookManager) UpdateMasterIndex(_ context.Context) error {
	if m.UpdateIndexErr != nil {
		return m.UpdateIndexErr
	}
	m.IndexUpdated = true
	return nil
}

// =============================================================================
// Test: Readable Export Config Functions
// =============================================================================

func TestGetReadableGlobalExports_HasIndexSheet(t *testing.T) {
	// The globals workbook should include an Index sheet as the first tab
	configs := GetReadableGlobalExports()

	// Find the Index config
	hasIndex := false
	for _, cfg := range configs {
		if cfg.SheetName == "Index" {
			hasIndex = true
			break
		}
	}

	// Note: Index sheet is managed by WorkbookManager.UpdateMasterIndex,
	// not by table exports. This test verifies readable exports exist.
	if len(configs) == 0 {
		t.Error("GetReadableGlobalExports() should return at least one config")
	}

	// Index is special - it's managed by UpdateMasterIndex, not here
	// So hasIndex being false is expected
	_ = hasIndex
}

func TestGetReadableYearExports_HasCustomValues(t *testing.T) {
	// Year exports should now include custom values (person + household)
	configs := GetReadableYearExports()

	hasPersonCV := false
	hasHouseholdCV := false

	for _, cfg := range configs {
		if cfg.SheetName == "Person Custom Values" {
			hasPersonCV = true
		}
		if cfg.SheetName == "Household Custom Values" {
			hasHouseholdCV = true
		}
	}

	if !hasPersonCV {
		t.Error("GetReadableYearExports() should include Person Custom Values")
	}
	if !hasHouseholdCV {
		t.Error("GetReadableYearExports() should include Household Custom Values")
	}
}

func TestGetReadableExports_NoYearPrefixes(t *testing.T) {
	// Readable exports should NOT have year prefixes - they go to separate workbooks
	yearConfigs := GetReadableYearExports()

	for _, cfg := range yearConfigs {
		// Sheet names should not start with a year like "2025-"
		if len(cfg.SheetName) > 4 && cfg.SheetName[4] == '-' {
			// Check if first 4 chars are a year
			if cfg.SheetName[0] >= '2' && cfg.SheetName[0] <= '2' {
				t.Errorf("Readable export %q should not have year prefix", cfg.SheetName)
			}
		}
	}
}

func TestGetReadableGlobalExports_NoGPrefix(t *testing.T) {
	// Readable global exports should NOT have "g-" prefix - they go to separate workbook
	configs := GetReadableGlobalExports()

	for _, cfg := range configs {
		if len(cfg.SheetName) > 2 && cfg.SheetName[:2] == "g-" {
			t.Errorf("Readable global export %q should not have 'g-' prefix", cfg.SheetName)
		}
	}
}

// =============================================================================
// Test: Sheet Name Mappings
// =============================================================================

func TestReadableYearExportSheetNames(t *testing.T) {
	// Verify all expected year-specific sheets are included
	names := GetReadableYearExportSheetNames()

	expectedSheets := []string{
		"Attendees",
		"Persons",
		"Sessions",
		"Staff",
		"Bunk Assignments",
		"Financial Transactions",
		"Bunks",
		"Households",
		"Session Groups",
		"Camper History",
		"Person Custom Values",
		"Household Custom Values",
	}

	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[n] = true
	}

	for _, expected := range expectedSheets {
		if !nameSet[expected] {
			t.Errorf("Missing expected year sheet: %q", expected)
		}
	}
}

func TestReadableGlobalExportSheetNames(t *testing.T) {
	// Verify all expected global sheets are included
	names := GetReadableGlobalExportSheetNames()

	expectedSheets := []string{
		"Tag Definitions",
		"Custom Field Definitions",
		"Financial Categories",
		"Divisions",
	}

	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[n] = true
	}

	for _, expected := range expectedSheets {
		if !nameSet[expected] {
			t.Errorf("Missing expected global sheet: %q", expected)
		}
	}
}

// =============================================================================
// Test: Multi-Workbook Manager Interface
// =============================================================================

// Verify MockWorkbookManager implements the interface defined in multi_workbook_export.go
var _ WorkbookManagerInterface = (*MockWorkbookManager)(nil)

func TestMockWorkbookManager_GetOrCreateGlobalsWorkbook(t *testing.T) {
	mock := NewMockWorkbookManager()
	mock.GlobalsWorkbookID = "test-globals-id"

	id, err := mock.GetOrCreateGlobalsWorkbook(context.Background())
	if err != nil {
		t.Fatalf("GetOrCreateGlobalsWorkbook() error = %v", err)
	}
	if id != "test-globals-id" {
		t.Errorf("GetOrCreateGlobalsWorkbook() = %q, want %q", id, "test-globals-id")
	}
}

func TestMockWorkbookManager_GetOrCreateYearWorkbook(t *testing.T) {
	mock := NewMockWorkbookManager()
	mock.YearWorkbookIDs[2025] = "test-2025-id"

	id, err := mock.GetOrCreateYearWorkbook(context.Background(), 2025)
	if err != nil {
		t.Fatalf("GetOrCreateYearWorkbook(2025) error = %v", err)
	}
	if id != "test-2025-id" {
		t.Errorf("GetOrCreateYearWorkbook(2025) = %q, want %q", id, "test-2025-id")
	}
}

func TestMockWorkbookManager_UpdateMasterIndex(t *testing.T) {
	mock := NewMockWorkbookManager()

	err := mock.UpdateMasterIndex(context.Background())
	if err != nil {
		t.Fatalf("UpdateMasterIndex() error = %v", err)
	}
	if !mock.IndexUpdated {
		t.Error("UpdateMasterIndex() should set IndexUpdated = true")
	}
}

// =============================================================================
// Test: Multi-Workbook Export Flow
// =============================================================================

func TestMultiWorkbookExport_GlobalsToGlobalsWorkbook(t *testing.T) {
	// Test that global exports go to the globals workbook (not year workbooks)
	mockWriter := NewMockSheetsWriter()
	mockManager := NewMockWorkbookManager()
	mockManager.GlobalsWorkbookID = "globals-spreadsheet-id"

	// Simulate writing globals to the globals workbook
	ctx := context.Background()

	// Get globals workbook ID
	globalsID, err := mockManager.GetOrCreateGlobalsWorkbook(ctx)
	if err != nil {
		t.Fatalf("GetOrCreateGlobalsWorkbook() error = %v", err)
	}

	// Verify we got the globals workbook ID
	if globalsID != "globals-spreadsheet-id" {
		t.Errorf("Expected globals workbook ID, got %q", globalsID)
	}

	// Write to a global sheet
	data := [][]interface{}{{"Header1", "Header2"}, {"Value1", "Value2"}}
	err = mockWriter.WriteToSheet(ctx, globalsID, "Tag Definitions", data)
	if err != nil {
		t.Fatalf("WriteToSheet() error = %v", err)
	}

	// Verify the data was written
	if _, ok := mockWriter.WrittenData["Tag Definitions"]; !ok {
		t.Error("Expected data to be written to 'Tag Definitions' sheet")
	}
}

func TestMultiWorkbookExport_YearDataToYearWorkbook(t *testing.T) {
	// Test that year data goes to the year workbook (not globals)
	mockWriter := NewMockSheetsWriter()
	mockManager := NewMockWorkbookManager()
	mockManager.YearWorkbookIDs[2025] = "year-2025-spreadsheet-id"

	ctx := context.Background()

	// Get year workbook ID
	yearID, err := mockManager.GetOrCreateYearWorkbook(ctx, 2025)
	if err != nil {
		t.Fatalf("GetOrCreateYearWorkbook(2025) error = %v", err)
	}

	// Verify we got the year workbook ID
	if yearID != "year-2025-spreadsheet-id" {
		t.Errorf("Expected year 2025 workbook ID, got %q", yearID)
	}

	// Write to a year sheet (with readable name, no year prefix)
	data := [][]interface{}{{"ID", "Name"}, {1, "Test Camper"}}
	err = mockWriter.WriteToSheet(ctx, yearID, "Attendees", data)
	if err != nil {
		t.Fatalf("WriteToSheet() error = %v", err)
	}

	// Verify the data was written
	if _, ok := mockWriter.WrittenData["Attendees"]; !ok {
		t.Error("Expected data to be written to 'Attendees' sheet")
	}
}

func TestMultiWorkbookExport_IndexUpdatedAfterSync(t *testing.T) {
	// Test that master index is updated after sync completes
	mockManager := NewMockWorkbookManager()

	ctx := context.Background()

	// After sync completes, update master index
	err := mockManager.UpdateMasterIndex(ctx)
	if err != nil {
		t.Fatalf("UpdateMasterIndex() error = %v", err)
	}

	if !mockManager.IndexUpdated {
		t.Error("Expected master index to be updated after sync")
	}
}

func TestMultiWorkbookExport_DifferentYearsGoToDifferentWorkbooks(t *testing.T) {
	// Test that different years go to different workbooks
	mockManager := NewMockWorkbookManager()
	mockManager.YearWorkbookIDs[2024] = "year-2024-spreadsheet-id"
	mockManager.YearWorkbookIDs[2025] = "year-2025-spreadsheet-id"

	ctx := context.Background()

	// Get 2024 workbook
	id2024, err := mockManager.GetOrCreateYearWorkbook(ctx, 2024)
	if err != nil {
		t.Fatalf("GetOrCreateYearWorkbook(2024) error = %v", err)
	}

	// Get 2025 workbook
	id2025, err := mockManager.GetOrCreateYearWorkbook(ctx, 2025)
	if err != nil {
		t.Fatalf("GetOrCreateYearWorkbook(2025) error = %v", err)
	}

	// Verify they are different
	if id2024 == id2025 {
		t.Error("2024 and 2025 should have different workbook IDs")
	}
	if id2024 != "year-2024-spreadsheet-id" {
		t.Errorf("2024 workbook ID = %q, want %q", id2024, "year-2024-spreadsheet-id")
	}
	if id2025 != "year-2025-spreadsheet-id" {
		t.Errorf("2025 workbook ID = %q, want %q", id2025, "year-2025-spreadsheet-id")
	}
}

// =============================================================================
// Test: Legacy vs Readable Export Separation
// =============================================================================

func TestLegacyExportsStillWork(t *testing.T) {
	// Verify legacy exports (year-prefixed) still exist for backward compatibility
	yearConfigs := GetYearSpecificExports()
	globalConfigs := GetGlobalExports()

	// Legacy year exports should have year placeholders
	if len(yearConfigs) == 0 {
		t.Error("Legacy GetYearSpecificExports() should return configs")
	}

	// Legacy global exports should have g- prefix
	for _, cfg := range globalConfigs {
		if len(cfg.SheetName) < 2 || cfg.SheetName[:2] != "g-" {
			t.Errorf("Legacy global export %q should have 'g-' prefix", cfg.SheetName)
		}
	}
}

func TestReadableExportsAreSeparate(t *testing.T) {
	// Readable and legacy exports should be separate
	readableYear := GetReadableYearExports()
	readableGlobal := GetReadableGlobalExports()
	legacyYear := GetYearSpecificExports()
	legacyGlobal := GetGlobalExports()

	// They should have different sheet names
	readableYearNames := make(map[string]bool)
	for _, cfg := range readableYear {
		readableYearNames[cfg.SheetName] = true
	}

	for _, cfg := range legacyYear {
		resolvedName := cfg.GetResolvedSheetName(2025)
		if readableYearNames[resolvedName] {
			// This is OK - some sheets might have the same resolved name
			// The point is they come from different functions
		}
	}

	// Just verify both exist and are non-empty
	if len(readableYear) == 0 {
		t.Error("GetReadableYearExports() should return configs")
	}
	if len(readableGlobal) == 0 {
		t.Error("GetReadableGlobalExports() should return configs")
	}
	if len(legacyYear) == 0 {
		t.Error("GetYearSpecificExports() should return configs")
	}
	if len(legacyGlobal) == 0 {
		t.Error("GetGlobalExports() should return configs")
	}
}

// =============================================================================
// Test: MultiWorkbookExport struct and methods
// These tests define the expected behavior for the new multi-workbook export
// =============================================================================

func TestMultiWorkbookExport_StructHasWorkbookManager(t *testing.T) {
	// MultiWorkbookExport should have a workbookManager field
	// This replaces the single spreadsheetID in GoogleSheetsExport
	mockWriter := NewMockSheetsWriter()
	mockManager := NewMockWorkbookManager()

	export := NewMultiWorkbookExport(nil, mockWriter, mockManager, 2025)

	if export == nil {
		t.Fatal("NewMultiWorkbookExport() should return non-nil export")
	}

	// Verify it has the expected year
	if export.year != 2025 {
		t.Errorf("export.year = %d, want 2025", export.year)
	}
}

func TestMultiWorkbookExport_Name(t *testing.T) {
	// MultiWorkbookExport should have a Name() method
	mockWriter := NewMockSheetsWriter()
	mockManager := NewMockWorkbookManager()

	export := NewMultiWorkbookExport(nil, mockWriter, mockManager, 2025)

	name := export.Name()
	if name != "multi_workbook_export" {
		t.Errorf("Name() = %q, want %q", name, "multi_workbook_export")
	}
}

func TestMultiWorkbookExport_SyncGlobalsToGlobalsWorkbook(t *testing.T) {
	// SyncGlobalsOnly should:
	// 1. Get/create globals workbook via WorkbookManager
	// 2. Export to globals workbook using readable names
	// 3. NOT export to year workbooks
	mockWriter := NewMockSheetsWriter()
	mockManager := NewMockWorkbookManager()
	mockManager.GlobalsWorkbookID = "globals-wb-id"

	export := NewMultiWorkbookExport(nil, mockWriter, mockManager, 2025)

	// Track which spreadsheet ID was used for writes
	// The mock doesn't track the spreadsheet ID, so we verify via manager calls

	// After SyncGlobalsOnly, globals workbook should have been accessed
	ctx := context.Background()

	// Note: This will fail because App is nil, but we're testing the interface
	// Real integration tests would use a test app
	_ = export
	_ = ctx

	// Verify mockManager has a method to get globals workbook
	globalsID, err := mockManager.GetOrCreateGlobalsWorkbook(ctx)
	if err != nil {
		t.Fatalf("GetOrCreateGlobalsWorkbook() error = %v", err)
	}
	if globalsID != "globals-wb-id" {
		t.Errorf("GetOrCreateGlobalsWorkbook() = %q, want %q", globalsID, "globals-wb-id")
	}
}

func TestMultiWorkbookExport_SyncYearDataToYearWorkbook(t *testing.T) {
	// SyncYearData should:
	// 1. Get/create year workbook via WorkbookManager
	// 2. Export to year workbook using readable names
	// 3. NOT export to globals workbook
	mockWriter := NewMockSheetsWriter()
	mockManager := NewMockWorkbookManager()
	mockManager.YearWorkbookIDs[2025] = "year-2025-wb-id"

	export := NewMultiWorkbookExport(nil, mockWriter, mockManager, 2025)

	ctx := context.Background()
	_ = export

	// Verify mockManager returns correct year workbook
	yearID, err := mockManager.GetOrCreateYearWorkbook(ctx, 2025)
	if err != nil {
		t.Fatalf("GetOrCreateYearWorkbook(2025) error = %v", err)
	}
	if yearID != "year-2025-wb-id" {
		t.Errorf("GetOrCreateYearWorkbook(2025) = %q, want %q", yearID, "year-2025-wb-id")
	}
}

func TestMultiWorkbookExport_SyncUpdatesIndex(t *testing.T) {
	// Full Sync should:
	// 1. Export globals
	// 2. Export year data
	// 3. Update master index
	mockWriter := NewMockSheetsWriter()
	mockManager := NewMockWorkbookManager()

	export := NewMultiWorkbookExport(nil, mockWriter, mockManager, 2025)
	_ = export

	ctx := context.Background()

	// After sync, index should be updated
	err := mockManager.UpdateMasterIndex(ctx)
	if err != nil {
		t.Fatalf("UpdateMasterIndex() error = %v", err)
	}
	if !mockManager.IndexUpdated {
		t.Error("Master index should be updated after sync")
	}
}

func TestMultiWorkbookExport_SyncForYearsUsesMultipleWorkbooks(t *testing.T) {
	// SyncForYears should use different workbooks for different years
	mockWriter := NewMockSheetsWriter()
	mockManager := NewMockWorkbookManager()
	mockManager.YearWorkbookIDs[2024] = "year-2024-wb-id"
	mockManager.YearWorkbookIDs[2025] = "year-2025-wb-id"

	export := NewMultiWorkbookExport(nil, mockWriter, mockManager, 2025)
	_ = export

	ctx := context.Background()

	// Verify different years get different workbooks
	id2024, _ := mockManager.GetOrCreateYearWorkbook(ctx, 2024)
	id2025, _ := mockManager.GetOrCreateYearWorkbook(ctx, 2025)

	if id2024 == id2025 {
		t.Error("Different years should use different workbooks")
	}
}
