package sync

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/camp/kindred/pocketbase/google"
	"github.com/pocketbase/pocketbase/core"
)

const (
	// sheetsWorkbooksCollection is the PocketBase collection for workbook metadata
	sheetsWorkbooksCollection = "sheets_workbooks"

	// indexSheetName is the name of the master index sheet
	indexSheetName = "Index"

	// workbookTypeGlobals is the type identifier for the globals workbook
	workbookTypeGlobals = "globals"
)

// WorkbookRecord represents a workbook stored in the database.
type WorkbookRecord struct {
	ID            string
	SpreadsheetID string
	WorkbookType  string // "globals" or "year"
	Year          int    // 0 for globals
	Title         string
	URL           string
	TabCount      int
	TotalRecords  int
	Status        string // "ok", "error", "syncing"
	ErrorMessage  string
	LastSync      string
}

// WorkbookManager handles the lifecycle of Google Sheets workbooks.
// It creates, tracks, and manages multiple workbooks (globals + per-year).
type WorkbookManager struct {
	app          core.App
	sheetsWriter SheetsWriter
}

// Compile-time check that WorkbookManager implements WorkbookManagerInterface
var _ WorkbookManagerInterface = (*WorkbookManager)(nil)

// NewWorkbookManager creates a new WorkbookManager.
func NewWorkbookManager(app core.App, sheetsWriter SheetsWriter) *WorkbookManager {
	return &WorkbookManager{
		app:          app,
		sheetsWriter: sheetsWriter,
	}
}

// GetWorkbookByType retrieves a workbook record by type and year.
// For globals workbook, pass year=0.
// Returns nil if no workbook exists.
func (m *WorkbookManager) GetWorkbookByType(_ context.Context, workbookType string, year int) (*WorkbookRecord, error) {
	var filter string
	if workbookType == workbookTypeGlobals {
		filter = fmt.Sprintf("workbook_type = '%s'", workbookType)
	} else {
		filter = fmt.Sprintf("workbook_type = '%s' && year = %d", workbookType, year)
	}

	records, err := m.app.FindRecordsByFilter(sheetsWorkbooksCollection, filter, "", 1, 0)
	if err != nil {
		// Collection might not exist yet (before migration runs)
		slog.Debug("Error finding workbook", "error", err, "type", workbookType, "year", year)
		return nil, nil
	}

	if len(records) == 0 {
		return nil, nil
	}

	record := records[0]
	return &WorkbookRecord{
		ID:            record.Id,
		SpreadsheetID: safeString(record.Get("spreadsheet_id")),
		WorkbookType:  safeString(record.Get("workbook_type")),
		Year:          safeInt(record.Get("year")),
		Title:         safeString(record.Get("title")),
		URL:           safeString(record.Get("url")),
		TabCount:      safeInt(record.Get("tab_count")),
		TotalRecords:  safeInt(record.Get("total_records")),
		Status:        safeString(record.Get("status")),
		ErrorMessage:  safeString(record.Get("error_message")),
		LastSync:      safeString(record.Get("last_sync")),
	}, nil
}

// SaveWorkbookRecord creates or updates a workbook record.
func (m *WorkbookManager) SaveWorkbookRecord(ctx context.Context, wb *WorkbookRecord) (*WorkbookRecord, error) {
	collection, err := m.app.FindCollectionByNameOrId(sheetsWorkbooksCollection)
	if err != nil {
		return nil, fmt.Errorf("collection %s not found: %w", sheetsWorkbooksCollection, err)
	}

	// Check if record already exists
	existing, err := m.GetWorkbookByType(ctx, wb.WorkbookType, wb.Year)
	if err != nil {
		return nil, fmt.Errorf("checking existing workbook: %w", err)
	}

	var record *core.Record
	if existing != nil {
		// Update existing record
		record, err = m.app.FindRecordById(sheetsWorkbooksCollection, existing.ID)
		if err != nil {
			return nil, fmt.Errorf("finding existing record: %w", err)
		}
	} else {
		// Create new record
		record = core.NewRecord(collection)
	}

	// Set fields
	record.Set("spreadsheet_id", wb.SpreadsheetID)
	record.Set("workbook_type", wb.WorkbookType)
	if wb.Year > 0 {
		record.Set("year", wb.Year)
	}
	record.Set("title", wb.Title)
	record.Set("url", wb.URL)
	record.Set("tab_count", wb.TabCount)
	record.Set("total_records", wb.TotalRecords)
	record.Set("status", wb.Status)
	if wb.ErrorMessage != "" {
		record.Set("error_message", wb.ErrorMessage)
	}

	if err := m.app.Save(record); err != nil {
		return nil, fmt.Errorf("saving workbook record: %w", err)
	}

	wb.ID = record.Id
	return wb, nil
}

// UpdateWorkbookStats updates the statistics for a workbook.
func (m *WorkbookManager) UpdateWorkbookStats(
	_ context.Context, recordID string, tabCount, totalRecords int, status, errorMessage string,
) error {
	record, err := m.app.FindRecordById(sheetsWorkbooksCollection, recordID)
	if err != nil {
		return fmt.Errorf("finding record %s: %w", recordID, err)
	}

	record.Set("tab_count", tabCount)
	record.Set("total_records", totalRecords)
	record.Set("status", status)
	if errorMessage != "" {
		record.Set("error_message", errorMessage)
	} else {
		record.Set("error_message", "")
	}

	if err := m.app.Save(record); err != nil {
		return fmt.Errorf("updating workbook stats: %w", err)
	}

	return nil
}

// ListAllWorkbooks returns all workbook records.
func (m *WorkbookManager) ListAllWorkbooks(_ context.Context) ([]WorkbookRecord, error) {
	records, err := m.app.FindRecordsByFilter(sheetsWorkbooksCollection, "", "-year", 0, 0)
	if err != nil {
		// Collection might not exist yet
		slog.Debug("Error listing workbooks", "error", err)
		return nil, nil
	}

	workbooks := make([]WorkbookRecord, 0, len(records))
	for _, record := range records {
		workbooks = append(workbooks, WorkbookRecord{
			ID:            record.Id,
			SpreadsheetID: safeString(record.Get("spreadsheet_id")),
			WorkbookType:  safeString(record.Get("workbook_type")),
			Year:          safeInt(record.Get("year")),
			Title:         safeString(record.Get("title")),
			URL:           safeString(record.Get("url")),
			TabCount:      safeInt(record.Get("tab_count")),
			TotalRecords:  safeInt(record.Get("total_records")),
			Status:        safeString(record.Get("status")),
			ErrorMessage:  safeString(record.Get("error_message")),
			LastSync:      safeString(record.Get("last_sync")),
		})
	}

	return workbooks, nil
}

// GetOrCreateGlobalsWorkbook returns the globals workbook ID, creating if needed.
func (m *WorkbookManager) GetOrCreateGlobalsWorkbook(ctx context.Context) (string, error) {
	// Check if we already have a globals workbook
	existing, err := m.GetWorkbookByType(ctx, workbookTypeGlobals, 0)
	if err != nil {
		return "", fmt.Errorf("checking existing globals workbook: %w", err)
	}
	if existing != nil {
		return existing.SpreadsheetID, nil
	}

	// Create new workbook
	title := google.FormatWorkbookTitle(workbookTypeGlobals, 0)
	slog.Info("Creating new globals workbook", "title", title)

	spreadsheetID, err := google.CreateSpreadsheet(ctx, title)
	if err != nil {
		return "", fmt.Errorf("creating globals spreadsheet: %w", err)
	}

	url := google.FormatSpreadsheetURL(spreadsheetID)

	// Save to database
	_, err = m.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: spreadsheetID,
		WorkbookType:  workbookTypeGlobals,
		Year:          0,
		Title:         title,
		URL:           url,
		Status:        "ok",
	})
	if err != nil {
		return "", fmt.Errorf("saving globals workbook record: %w", err)
	}

	slog.Info("Created globals workbook", "spreadsheet_id", spreadsheetID, "url", url)
	return spreadsheetID, nil
}

// GetOrCreateYearWorkbook returns the year workbook ID, creating if needed.
func (m *WorkbookManager) GetOrCreateYearWorkbook(ctx context.Context, year int) (string, error) {
	// Check if we already have this year's workbook
	existing, err := m.GetWorkbookByType(ctx, "year", year)
	if err != nil {
		return "", fmt.Errorf("checking existing year workbook: %w", err)
	}
	if existing != nil {
		return existing.SpreadsheetID, nil
	}

	// Create new workbook
	title := google.FormatWorkbookTitle("year", year)
	slog.Info("Creating new year workbook", "year", year, "title", title)

	spreadsheetID, err := google.CreateSpreadsheet(ctx, title)
	if err != nil {
		return "", fmt.Errorf("creating year spreadsheet: %w", err)
	}

	url := google.FormatSpreadsheetURL(spreadsheetID)

	// Save to database
	_, err = m.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: spreadsheetID,
		WorkbookType:  "year",
		Year:          year,
		Title:         title,
		URL:           url,
		Status:        "ok",
	})
	if err != nil {
		return "", fmt.Errorf("saving year workbook record: %w", err)
	}

	slog.Info("Created year workbook", "year", year, "spreadsheet_id", spreadsheetID, "url", url)
	return spreadsheetID, nil
}

// UpdateMasterIndex updates the Index sheet in the globals workbook.
func (m *WorkbookManager) UpdateMasterIndex(ctx context.Context) error {
	// Get globals workbook
	globals, err := m.GetWorkbookByType(ctx, workbookTypeGlobals, 0)
	if err != nil || globals == nil {
		return fmt.Errorf("globals workbook not found")
	}

	// Get all workbooks
	workbooks, err := m.ListAllWorkbooks(ctx)
	if err != nil {
		return fmt.Errorf("listing workbooks: %w", err)
	}

	// Build index data
	data := BuildIndexSheetData(workbooks)

	// Ensure Index sheet exists
	if err := m.sheetsWriter.EnsureSheet(ctx, globals.SpreadsheetID, indexSheetName); err != nil {
		return fmt.Errorf("ensuring index sheet: %w", err)
	}

	// Clear and write data
	if err := m.sheetsWriter.ClearSheet(ctx, globals.SpreadsheetID, indexSheetName); err != nil {
		return fmt.Errorf("clearing index sheet: %w", err)
	}

	if err := m.sheetsWriter.WriteToSheet(ctx, globals.SpreadsheetID, indexSheetName, data); err != nil {
		return fmt.Errorf("writing index sheet: %w", err)
	}

	// Reorder tabs now that Index sheet exists (ensures Index is first)
	if err := ReorderGlobalsWorkbookTabs(ctx, m.sheetsWriter, globals.SpreadsheetID); err != nil {
		slog.Warn("Failed to reorder globals tabs after index update", "error", err)
	}

	slog.Info("Updated master index", "workbook_count", len(workbooks))
	return nil
}

// BuildIndexSheetData builds the data matrix for the master index sheet.
// Rows are sorted: globals first, then years in descending order.
func BuildIndexSheetData(workbooks []WorkbookRecord) [][]interface{} {
	// Sort workbooks: globals first, then years descending
	sorted := make([]WorkbookRecord, len(workbooks))
	copy(sorted, workbooks)
	sort.Slice(sorted, func(i, j int) bool {
		// Globals always first
		if sorted[i].WorkbookType == workbookTypeGlobals {
			return true
		}
		if sorted[j].WorkbookType == workbookTypeGlobals {
			return false
		}
		// Years in descending order
		return sorted[i].Year > sorted[j].Year
	})

	// Preallocate data with header row + one row per workbook
	data := make([][]interface{}, 0, 1+len(sorted))
	data = append(data, []interface{}{"Year", "Workbook", "Link", "Last Sync", "Tabs", "Records", "Status"})

	// Add data rows
	for i := range sorted {
		wb := &sorted[i]
		var yearDisplay interface{}
		if wb.WorkbookType == workbookTypeGlobals {
			yearDisplay = "Globals"
		} else {
			yearDisplay = wb.Year
		}

		// Format last sync for display
		lastSync := wb.LastSync
		if t, err := time.Parse(time.RFC3339, wb.LastSync); err == nil {
			lastSync = t.Format("2006-01-02 15:04")
		}

		// Create hyperlink formula for the link column
		link := fmt.Sprintf(`=HYPERLINK(%q,"Open")`, wb.URL)

		data = append(data, []interface{}{
			yearDisplay,
			wb.Title,
			link,
			lastSync,
			wb.TabCount,
			wb.TotalRecords,
			wb.Status,
		})
	}

	return data
}

// safeInt safely converts an interface{} to int
func safeInt(v interface{}) int {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int:
		return val
	case int64:
		return int(val)
	case float64:
		return int(val)
	default:
		return 0
	}
}
