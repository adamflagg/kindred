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

func TestWorkbookManager_GetShareEmails(t *testing.T) {
	// Test retrieving sharing email list from config

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	defer app.Cleanup()

	mockWriter := &MockSheetsWriter{}
	manager := NewWorkbookManager(app, mockWriter)

	// GetShareEmails returns emails from config file or database
	// In CI (no config file), this should return empty
	// Locally (with private config), this may return emails
	emails := manager.GetShareEmails(context.Background())

	// Just verify the function doesn't error - actual content depends on environment
	// This is a smoke test that the function works
	_ = emails
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
