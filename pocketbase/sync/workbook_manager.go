package sync

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
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

	// workbookTypeFCRoster is the type identifier for a Family Camp weekend's
	// roster workbook (kindred#2433). Unlike globals and year, several rows share
	// a year -- one per weekend -- so these are the only rows whose key needs the
	// session dimension. workbook_type stays a CLOSED vocabulary: one type per
	// session would turn GetWorkbookByType's filter into id string-matching and
	// the admin Sheets tab's grouping into noise.
	workbookTypeFCRoster = "fc_roster"

	// notSessionScoped is the session_cm_id a globals or per-year workbook
	// carries. A real CampMinder id is never 0, and PocketBase declares number
	// columns NUMERIC DEFAULT 0 NOT NULL, so the rows that predate migration
	// 1500000165 already read as this.
	notSessionScoped = 0
)

// WorkbookRecord represents a workbook stored in the database.
type WorkbookRecord struct {
	ID            string
	SpreadsheetID string
	WorkbookType  string // "globals", "year" or "fc_roster"
	Year          int    // 0 for globals
	// SessionCMID scopes a roster workbook to one Family Camp weekend, and is
	// notSessionScoped for globals and per-year workbooks.
	SessionCMID  int
	Title        string
	URL          string
	TabCount     int
	TotalRecords int
	Status       string // "ok", "error", "syncing"
	ErrorMessage string
	LastSync     string
}

// DriveSearcher allows searching Drive for existing spreadsheets (enables mocking)
type DriveSearcher interface {
	FindSpreadsheetByName(ctx context.Context, name string) (string, error)
}

// DefaultDriveSearcher uses the google package functions
type DefaultDriveSearcher struct{}

// FindSpreadsheetByName searches Drive for a spreadsheet by exact name
func (d *DefaultDriveSearcher) FindSpreadsheetByName(ctx context.Context, name string) (string, error) {
	id, err := google.FindSpreadsheetByName(ctx, name)
	if err != nil {
		return "", fmt.Errorf("searching Drive for spreadsheet %q: %w", name, err)
	}
	return id, nil
}

// WorkbookManager handles the lifecycle of Google Sheets workbooks.
// It creates, tracks, and manages multiple workbooks (globals + per-year).
type WorkbookManager struct {
	app           core.App
	sheetsWriter  SheetsWriter
	driveSearcher DriveSearcher // optional, nil = skip Drive search
}

// Compile-time check that WorkbookManager implements WorkbookManagerInterface
var _ WorkbookManagerInterface = (*WorkbookManager)(nil)

// NewWorkbookManager creates a new WorkbookManager without Drive search capability.
// Use NewWorkbookManagerWithSearcher to enable automatic recovery of existing workbooks.
func NewWorkbookManager(app core.App, sheetsWriter SheetsWriter) *WorkbookManager {
	return &WorkbookManager{
		app:          app,
		sheetsWriter: sheetsWriter,
	}
}

// NewWorkbookManagerWithSearcher creates a WorkbookManager with Drive search capability.
// This enables automatic recovery of existing workbooks when the database is cleared.
func NewWorkbookManagerWithSearcher(
	app core.App,
	sheetsWriter SheetsWriter,
	driveSearcher DriveSearcher,
) *WorkbookManager {
	return &WorkbookManager{
		app:           app,
		sheetsWriter:  sheetsWriter,
		driveSearcher: driveSearcher,
	}
}

// GetWorkbookByType retrieves a workbook record by type and year.
// For globals workbook, pass year=0.
// Returns nil if no workbook exists.
//
// This is the NON-session-scoped lookup: it matches only rows carrying
// session_cm_id = notSessionScoped, which is every globals and per-year row.
// Roster workbooks share a year with the per-year workbook, so without that
// clause this would start returning an arbitrary weekend's roster to the data
// export. Use GetWorkbookForSession for those.
func (m *WorkbookManager) GetWorkbookByType(
	ctx context.Context, workbookType string, year int,
) (*WorkbookRecord, error) {
	return m.GetWorkbookForSession(ctx, workbookType, year, notSessionScoped)
}

// GetWorkbookForSession retrieves a workbook record by type, year and session.
// Returns nil if no workbook exists.
func (m *WorkbookManager) GetWorkbookForSession(
	_ context.Context, workbookType string, year, sessionCMID int,
) (*WorkbookRecord, error) {
	// Note the spaces around every operator -- PocketBase's filter parser
	// silently returns wrong results without them.
	filter := fmt.Sprintf("workbook_type = '%s' && session_cm_id = %d", workbookType, sessionCMID)
	if workbookType != workbookTypeGlobals {
		filter = fmt.Sprintf("%s && year = %d", filter, year)
	}

	records, err := m.app.FindRecordsByFilter(sheetsWorkbooksCollection, filter, "", 1, 0)
	if err != nil {
		// Collection might not exist yet (before migration runs)
		slog.Debug("Error finding workbook",
			"error", err, "type", workbookType, "year", year, "session_cm_id", sessionCMID)
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
		SessionCMID:   safeInt(record.Get("session_cm_id")),
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

	// Check if record already exists. Keyed on the SESSION too: without it the
	// second Family Camp weekend of a season matches the first weekend's row,
	// takes the update branch below, and silently overwrites its spreadsheet_id.
	// The unique index cannot catch that -- this check short-circuits ahead of it.
	existing, err := m.GetWorkbookForSession(ctx, wb.WorkbookType, wb.Year, wb.SessionCMID)
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
	// Always set, unlike year: 0 is a meaningful value here (notSessionScoped),
	// and it must match what GetWorkbookForSession filters on.
	record.Set("session_cm_id", wb.SessionCMID)
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
			SessionCMID:   safeInt(record.Get("session_cm_id")),
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
// If driveSearcher is configured, searches Drive for existing workbook before creating new.
func (m *WorkbookManager) GetOrCreateGlobalsWorkbook(ctx context.Context) (string, error) {
	// Check if we already have a globals workbook in the database
	existing, err := m.GetWorkbookByType(ctx, workbookTypeGlobals, 0)
	if err != nil {
		return "", fmt.Errorf("checking existing globals workbook: %w", err)
	}
	if existing != nil {
		return existing.SpreadsheetID, nil
	}

	// Generate the expected title for this workbook
	title := google.FormatWorkbookTitle(workbookTypeGlobals, 0)

	// If driveSearcher is configured, try to find existing workbook in Drive
	if m.driveSearcher != nil {
		foundID, searchErr := m.driveSearcher.FindSpreadsheetByName(ctx, title)
		if searchErr != nil {
			// Log warning but continue to create - Drive search is best-effort
			slog.Warn("Drive search failed, will create new workbook", "error", searchErr, "title", title)
		} else if foundID != "" {
			// Found existing workbook in Drive - link it to database
			slog.Info("Found existing workbook in Drive, linking to database", "title", title, "spreadsheet_id", foundID)
			url := google.FormatSpreadsheetURL(foundID)
			_, saveErr := m.SaveWorkbookRecord(ctx, &WorkbookRecord{
				SpreadsheetID: foundID,
				WorkbookType:  workbookTypeGlobals,
				Year:          0,
				Title:         title,
				URL:           url,
				Status:        "ok",
			})
			if saveErr != nil {
				return "", fmt.Errorf("saving recovered globals workbook record: %w", saveErr)
			}
			return foundID, nil
		}
	}

	// Create new workbook
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
// If driveSearcher is configured, searches Drive for existing workbook before creating new.
func (m *WorkbookManager) GetOrCreateYearWorkbook(ctx context.Context, year int) (string, error) {
	// Check if we already have this year's workbook in the database
	existing, err := m.GetWorkbookByType(ctx, "year", year)
	if err != nil {
		return "", fmt.Errorf("checking existing year workbook: %w", err)
	}
	if existing != nil {
		return existing.SpreadsheetID, nil
	}

	// Generate the expected title for this workbook
	title := google.FormatWorkbookTitle("year", year)

	// If driveSearcher is configured, try to find existing workbook in Drive
	if m.driveSearcher != nil {
		foundID, searchErr := m.driveSearcher.FindSpreadsheetByName(ctx, title)
		if searchErr != nil {
			// Log warning but continue to create - Drive search is best-effort
			slog.Warn("Drive search failed, will create new workbook", "error", searchErr, "title", title, "year", year)
		} else if foundID != "" {
			// Found existing workbook in Drive - link it to database
			slog.Info("Found existing workbook in Drive, linking to database",
				"title", title, "year", year, "spreadsheet_id", foundID)
			url := google.FormatSpreadsheetURL(foundID)
			_, saveErr := m.SaveWorkbookRecord(ctx, &WorkbookRecord{
				SpreadsheetID: foundID,
				WorkbookType:  "year",
				Year:          year,
				Title:         title,
				URL:           url,
				Status:        "ok",
			})
			if saveErr != nil {
				return "", fmt.Errorf("saving recovered year workbook record: %w", saveErr)
			}
			return foundID, nil
		}
	}

	// Create new workbook
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
	// Get or recover globals workbook (uses driveSearcher to find existing workbooks in Drive)
	// This is important for historical syncs where the database might not have the record
	// but the workbook exists in Google Drive
	_, err := m.GetOrCreateGlobalsWorkbook(ctx)
	if err != nil {
		return fmt.Errorf("globals workbook not found: %w", err)
	}

	// Now get the full record for spreadsheet ID access
	globals, err := m.GetWorkbookByType(ctx, workbookTypeGlobals, 0)
	if err != nil || globals == nil {
		return fmt.Errorf("globals workbook record not found after recovery")
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
//
// Family Camp roster workbooks are EXCLUDED. The Index sheet lives in the
// globals workbook, in the Exports folder, whose audience is deliberately wider
// than the roster folder's -- that per-folder split is the privacy control for
// workbooks carrying family contact details (kindred#2433 design §2). Listing
// one here would publish its weekend name and a clickable link to that wider
// audience. They would also all render as their year, since the index has no
// session column, so eight 2026 weekends would arrive as eight rows labeled
// 2026. Staff reach a roster through the roster folder or the export's own
// response, never through this index.
func BuildIndexSheetData(workbooks []WorkbookRecord) [][]any {
	// Sort workbooks: globals first, then years descending
	sorted := make([]WorkbookRecord, 0, len(workbooks))
	for i := range workbooks {
		if workbooks[i].WorkbookType != workbookTypeFCRoster {
			sorted = append(sorted, workbooks[i])
		}
	}
	slices.SortFunc(sorted, func(a, b WorkbookRecord) int {
		// Globals always first
		aGlobal := a.WorkbookType == workbookTypeGlobals
		bGlobal := b.WorkbookType == workbookTypeGlobals
		if aGlobal && !bGlobal {
			return -1
		}
		if !aGlobal && bGlobal {
			return 1
		}
		// Years in descending order
		return b.Year - a.Year
	})

	// Preallocate data with header row + one row per workbook
	data := make([][]any, 0, 1+len(sorted))
	data = append(data, []any{"Year", "Workbook", "Link", "Last Sync", "Tabs", "Records", "Status"})

	// Add data rows
	for i := range sorted {
		wb := &sorted[i]
		var yearDisplay any
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

		data = append(data, []any{
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

// safeInt safely converts any to int
func safeInt(v any) int {
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
