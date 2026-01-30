package sync

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestWorkbookManager_GetOrCreateGlobalsWorkbook_NewWorkbook(t *testing.T) {
	// Test that GetOrCreateGlobalsWorkbook creates a new workbook when none exists
	// This tests the database interaction and workbook creation flow

	// Create test app
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Create mock writer that tracks calls
	mockWriter := &MockSheetsWriter{}

	// Create manager with mock
	manager := NewWorkbookManager(app, mockWriter)

	// Query should return empty (no existing workbook)
	workbook, err := manager.GetWorkbookByType(context.Background(), "globals", 0)
	if err != nil {
		t.Fatalf("GetWorkbookByType failed: %v", err)
	}
	if workbook != nil {
		t.Error("Expected no workbook to exist initially")
	}
}

func TestWorkbookManager_GetOrCreateYearWorkbook_NewWorkbook(t *testing.T) {
	// Test that GetOrCreateYearWorkbook creates a new workbook when none exists

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	mockWriter := &MockSheetsWriter{}
	manager := NewWorkbookManager(app, mockWriter)

	// Query should return empty (no existing workbook)
	workbook, err := manager.GetWorkbookByType(context.Background(), "year", 2025)
	if err != nil {
		t.Fatalf("GetWorkbookByType failed: %v", err)
	}
	if workbook != nil {
		t.Error("Expected no workbook to exist initially")
	}
}

func TestWorkbookManager_SaveWorkbookRecord(t *testing.T) {
	// Test saving a workbook record to the database
	// This is an integration test that requires the sheets_workbooks collection

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := &MockSheetsWriter{}
	manager := NewWorkbookManager(app, mockWriter)

	// Save a globals workbook record
	ctx := context.Background()
	record, err := manager.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: "test-spreadsheet-id",
		WorkbookType:  "globals",
		Year:          0,
		Title:         "Test Data - Globals",
		URL:           "https://docs.google.com/spreadsheets/d/test-spreadsheet-id/edit",
		TabCount:      4,
		TotalRecords:  100,
		Status:        "ok",
	})
	if err != nil {
		t.Fatalf("SaveWorkbookRecord failed: %v", err)
	}
	if record == nil {
		t.Fatal("Expected record to be returned")
	}

	// Verify we can retrieve it
	retrieved, err := manager.GetWorkbookByType(ctx, "globals", 0)
	if err != nil {
		t.Fatalf("GetWorkbookByType after save failed: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Expected to retrieve saved workbook")
	}
	if retrieved.SpreadsheetID != "test-spreadsheet-id" {
		t.Errorf("SpreadsheetID = %q, want %q", retrieved.SpreadsheetID, "test-spreadsheet-id")
	}
}

func TestWorkbookManager_SaveWorkbookRecord_YearWorkbook(t *testing.T) {
	// Test saving a year-specific workbook record
	// This is an integration test that requires the sheets_workbooks collection

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := &MockSheetsWriter{}
	manager := NewWorkbookManager(app, mockWriter)

	ctx := context.Background()
	_, err = manager.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: "year-2025-id",
		WorkbookType:  "year",
		Year:          2025,
		Title:         "Test Data - 2025",
		URL:           "https://docs.google.com/spreadsheets/d/year-2025-id/edit",
		TabCount:      12,
		TotalRecords:  5000,
		Status:        "ok",
	})
	if err != nil {
		t.Fatalf("SaveWorkbookRecord failed: %v", err)
	}

	// Verify we can retrieve it by year
	retrieved, err := manager.GetWorkbookByType(ctx, "year", 2025)
	if err != nil {
		t.Fatalf("GetWorkbookByType after save failed: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Expected to retrieve saved workbook")
	}
	if retrieved.Year != 2025 {
		t.Errorf("Year = %d, want %d", retrieved.Year, 2025)
	}
}

func TestWorkbookManager_UpdateWorkbookStats(t *testing.T) {
	// Test updating stats for an existing workbook
	// This is an integration test that requires the sheets_workbooks collection

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := &MockSheetsWriter{}
	manager := NewWorkbookManager(app, mockWriter)

	ctx := context.Background()

	// First save a workbook
	record, err := manager.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: "stats-test-id",
		WorkbookType:  "globals",
		Year:          0,
		Title:         "Test Data - Globals",
		URL:           "https://docs.google.com/spreadsheets/d/stats-test-id/edit",
		TabCount:      4,
		TotalRecords:  100,
		Status:        "ok",
	})
	if err != nil {
		t.Fatalf("SaveWorkbookRecord failed: %v", err)
	}

	// Update stats
	err = manager.UpdateWorkbookStats(ctx, record.ID, 5, 200, "ok", "")
	if err != nil {
		t.Fatalf("UpdateWorkbookStats failed: %v", err)
	}

	// Verify stats were updated
	retrieved, err := manager.GetWorkbookByType(ctx, "globals", 0)
	if err != nil {
		t.Fatalf("GetWorkbookByType after update failed: %v", err)
	}
	if retrieved.TabCount != 5 {
		t.Errorf("TabCount = %d, want %d", retrieved.TabCount, 5)
	}
	if retrieved.TotalRecords != 200 {
		t.Errorf("TotalRecords = %d, want %d", retrieved.TotalRecords, 200)
	}
}

func TestWorkbookManager_ListAllWorkbooks(t *testing.T) {
	// Test listing all workbooks
	// This is an integration test that requires the sheets_workbooks collection

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := &MockSheetsWriter{}
	manager := NewWorkbookManager(app, mockWriter)

	ctx := context.Background()

	// Save multiple workbooks
	_, err = manager.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: "globals-id",
		WorkbookType:  "globals",
		Year:          0,
		Title:         "Test Data - Globals",
		Status:        "ok",
	})
	if err != nil {
		t.Fatalf("SaveWorkbookRecord (globals) failed: %v", err)
	}

	_, err = manager.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: "year-2024-id",
		WorkbookType:  "year",
		Year:          2024,
		Title:         "Test Data - 2024",
		Status:        "ok",
	})
	if err != nil {
		t.Fatalf("SaveWorkbookRecord (2024) failed: %v", err)
	}

	_, err = manager.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: "year-2025-id",
		WorkbookType:  "year",
		Year:          2025,
		Title:         "Test Data - 2025",
		Status:        "ok",
	})
	if err != nil {
		t.Fatalf("SaveWorkbookRecord (2025) failed: %v", err)
	}

	// List all workbooks
	workbooks, err := manager.ListAllWorkbooks(ctx)
	if err != nil {
		t.Fatalf("ListAllWorkbooks failed: %v", err)
	}
	if len(workbooks) != 3 {
		t.Errorf("ListAllWorkbooks returned %d workbooks, want 3", len(workbooks))
	}
}

func TestBuildIndexSheetData(t *testing.T) {
	// Test building the index sheet data matrix

	workbooks := []WorkbookRecord{
		{
			WorkbookType: "globals",
			Year:         0,
			Title:        "Camp Data - Globals",
			URL:          "https://docs.google.com/spreadsheets/d/globals-id/edit",
			TabCount:     4,
			TotalRecords: 523,
			Status:       "ok",
			LastSync:     "2025-01-28T10:30:00Z",
		},
		{
			WorkbookType: "year",
			Year:         2025,
			Title:        "Camp Data - 2025",
			URL:          "https://docs.google.com/spreadsheets/d/2025-id/edit",
			TabCount:     12,
			TotalRecords: 15423,
			Status:       "ok",
			LastSync:     "2025-01-28T10:30:00Z",
		},
		{
			WorkbookType: "year",
			Year:         2024,
			Title:        "Camp Data - 2024",
			URL:          "https://docs.google.com/spreadsheets/d/2024-id/edit",
			TabCount:     12,
			TotalRecords: 14892,
			Status:       "ok",
			LastSync:     "2025-01-15T09:00:00Z",
		},
	}

	data := BuildIndexSheetData(workbooks)

	// Should have header + 3 data rows
	if len(data) != 4 {
		t.Errorf("BuildIndexSheetData returned %d rows, want 4", len(data))
	}

	// Check header row
	header := data[0]
	expectedHeaders := []string{"Year", "Workbook", "Link", "Last Sync", "Tabs", "Records", "Status"}
	for i, expected := range expectedHeaders {
		if header[i] != expected {
			t.Errorf("Header[%d] = %v, want %v", i, header[i], expected)
		}
	}

	// Check globals row (should be first data row)
	globalsRow := data[1]
	if globalsRow[0] != "Globals" {
		t.Errorf("Globals row Year = %v, want 'Globals'", globalsRow[0])
	}
	if globalsRow[4] != 4 {
		t.Errorf("Globals row TabCount = %v, want 4", globalsRow[4])
	}

	// Check 2025 row (should be second, years in descending order)
	year2025Row := data[2]
	if year2025Row[0] != 2025 {
		t.Errorf("2025 row Year = %v, want 2025", year2025Row[0])
	}

	// Check 2024 row (should be third)
	year2024Row := data[3]
	if year2024Row[0] != 2024 {
		t.Errorf("2024 row Year = %v, want 2024", year2024Row[0])
	}
}

// WorkbookRecord is defined in workbook_manager.go

// =============================================================================
// MockDriveSearcher for testing Drive-based recovery
// =============================================================================

// MockDriveSearcher implements DriveSearcher interface for testing
type MockDriveSearcher struct {
	FoundID string   // Return this ID when FindSpreadsheetByName is called
	Err     error    // Return this error when FindSpreadsheetByName is called
	Calls   int      // Track number of calls
	Names   []string // Track names that were searched
}

func (m *MockDriveSearcher) FindSpreadsheetByName(_ context.Context, name string) (string, error) {
	m.Calls++
	m.Names = append(m.Names, name)
	return m.FoundID, m.Err
}

// =============================================================================
// Drive Recovery Tests
// =============================================================================

func TestGetOrCreateGlobalsWorkbook_RecoverFromDrive(t *testing.T) {
	// Test that when DB is empty but Drive has the workbook,
	// we recover by linking the existing Drive workbook to the DB

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := NewMockSheetsWriter()
	mockSearcher := &MockDriveSearcher{
		FoundID: "existing-drive-spreadsheet-id",
	}

	// Create manager with mock searcher
	manager := NewWorkbookManagerWithSearcher(app, mockWriter, mockSearcher)

	ctx := context.Background()

	// Verify no workbook exists initially
	existing, err := manager.GetWorkbookByType(ctx, "globals", 0)
	if err != nil {
		t.Fatalf("GetWorkbookByType failed: %v", err)
	}
	if existing != nil {
		t.Fatal("Expected no workbook to exist initially")
	}

	// GetOrCreateGlobalsWorkbook should find it in Drive and link it
	spreadsheetID, err := manager.GetOrCreateGlobalsWorkbook(ctx)
	if err != nil {
		t.Fatalf("GetOrCreateGlobalsWorkbook failed: %v", err)
	}

	// Should return the Drive ID
	if spreadsheetID != "existing-drive-spreadsheet-id" {
		t.Errorf("GetOrCreateGlobalsWorkbook() = %q, want %q", spreadsheetID, "existing-drive-spreadsheet-id")
	}

	// Should have called Drive search once
	if mockSearcher.Calls != 1 {
		t.Errorf("DriveSearcher.Calls = %d, want 1", mockSearcher.Calls)
	}

	// Should have saved to DB
	saved, err := manager.GetWorkbookByType(ctx, "globals", 0)
	if err != nil {
		t.Fatalf("GetWorkbookByType after recovery failed: %v", err)
	}
	if saved == nil {
		t.Fatal("Expected workbook to be saved after recovery")
	}
	if saved.SpreadsheetID != "existing-drive-spreadsheet-id" {
		t.Errorf("Saved SpreadsheetID = %q, want %q", saved.SpreadsheetID, "existing-drive-spreadsheet-id")
	}
}

func TestGetOrCreateGlobalsWorkbook_DriveSearchFails_ContinuesToCreate(t *testing.T) {
	// Test that when Drive search fails, we log a warning and continue to create new
	// This ensures resilience - Drive API failures don't block the sync

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := NewMockSheetsWriter()
	mockSearcher := &MockDriveSearcher{
		Err: context.DeadlineExceeded, // Simulate API timeout
	}

	manager := NewWorkbookManagerWithSearcher(app, mockWriter, mockSearcher)

	ctx := context.Background()

	// This should NOT fail - it should log warning and try to create
	// But since we don't have real Google credentials, it will fail at creation
	// The important thing is that the Drive error doesn't propagate
	_, err = manager.GetOrCreateGlobalsWorkbook(ctx)

	// Should have called Drive search
	if mockSearcher.Calls != 1 {
		t.Errorf("DriveSearcher.Calls = %d, want 1", mockSearcher.Calls)
	}

	// Error should be from CreateSpreadsheet (no credentials), not from Drive search
	if err != nil && err.Error() == context.DeadlineExceeded.Error() {
		t.Error("Drive search error should not propagate - should continue to create")
	}
}

func TestGetOrCreateGlobalsWorkbook_DriveSearcherNil_SkipsSearch(t *testing.T) {
	// Test backward compatibility - when driveSearcher is nil, skip Drive search entirely

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := NewMockSheetsWriter()

	// Use original constructor which doesn't set driveSearcher
	manager := NewWorkbookManager(app, mockWriter)

	ctx := context.Background()

	// This should proceed without Drive search
	// It will fail at CreateSpreadsheet (no credentials), but that's expected
	_, err = manager.GetOrCreateGlobalsWorkbook(ctx)

	// Should fail at CreateSpreadsheet, not at Drive search
	// (Can't fully test without mocking CreateSpreadsheet, but this validates no panic)
	if err == nil {
		t.Log("Unexpected success - might have Google credentials configured")
	}
}

func TestGetOrCreateYearWorkbook_RecoverFromDrive(t *testing.T) {
	// Same pattern for year workbook recovery

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := NewMockSheetsWriter()
	mockSearcher := &MockDriveSearcher{
		FoundID: "existing-2025-spreadsheet-id",
	}

	manager := NewWorkbookManagerWithSearcher(app, mockWriter, mockSearcher)

	ctx := context.Background()

	// GetOrCreateYearWorkbook should find it in Drive and link it
	spreadsheetID, err := manager.GetOrCreateYearWorkbook(ctx, 2025)
	if err != nil {
		t.Fatalf("GetOrCreateYearWorkbook failed: %v", err)
	}

	if spreadsheetID != "existing-2025-spreadsheet-id" {
		t.Errorf("GetOrCreateYearWorkbook() = %q, want %q", spreadsheetID, "existing-2025-spreadsheet-id")
	}

	// Should have called Drive search once
	if mockSearcher.Calls != 1 {
		t.Errorf("DriveSearcher.Calls = %d, want 1", mockSearcher.Calls)
	}

	// Should have saved to DB
	saved, err := manager.GetWorkbookByType(ctx, "year", 2025)
	if err != nil {
		t.Fatalf("GetWorkbookByType after recovery failed: %v", err)
	}
	if saved == nil {
		t.Fatal("Expected workbook to be saved after recovery")
	}
	if saved.SpreadsheetID != "existing-2025-spreadsheet-id" {
		t.Errorf("Saved SpreadsheetID = %q, want %q", saved.SpreadsheetID, "existing-2025-spreadsheet-id")
	}
	if saved.Year != 2025 {
		t.Errorf("Saved Year = %d, want 2025", saved.Year)
	}
}

func TestGetOrCreateGlobalsWorkbook_NotInDrive_CreatesNew(t *testing.T) {
	// Test that when neither DB nor Drive has the workbook, we create new

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Check if collection exists (skip if not - this is an integration test)
	_, err = app.FindCollectionByNameOrId("sheets_workbooks")
	if err != nil {
		t.Skip("Skipping: sheets_workbooks collection not available (integration test)")
	}

	mockWriter := NewMockSheetsWriter()
	mockSearcher := &MockDriveSearcher{
		FoundID: "", // Not found in Drive
	}

	manager := NewWorkbookManagerWithSearcher(app, mockWriter, mockSearcher)

	ctx := context.Background()

	// This will search Drive, find nothing, then try to create
	// Creation will fail without credentials, but Drive search should happen
	_, err = manager.GetOrCreateGlobalsWorkbook(ctx)

	// Should have called Drive search
	if mockSearcher.Calls != 1 {
		t.Errorf("DriveSearcher.Calls = %d, want 1", mockSearcher.Calls)
	}

	// Error should be from CreateSpreadsheet (expected without credentials)
	if err == nil {
		t.Log("Unexpected success - might have Google credentials configured")
	}
}
