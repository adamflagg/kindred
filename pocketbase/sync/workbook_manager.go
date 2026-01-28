package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/camp/kindred/pocketbase/google"
	"github.com/pocketbase/pocketbase/core"
)

const (
	// sheetsWorkbooksCollection is the PocketBase collection for workbook metadata
	sheetsWorkbooksCollection = "sheets_workbooks"

	// configCollection is the PocketBase collection for app configuration
	configCollection = "config"

	// indexSheetName is the name of the master index sheet
	indexSheetName = "Index"
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
func (m *WorkbookManager) GetWorkbookByType(ctx context.Context, workbookType string, year int) (*WorkbookRecord, error) {
	var filter string
	if workbookType == "globals" {
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
func (m *WorkbookManager) SaveWorkbookRecord(ctx context.Context, wb WorkbookRecord) (*WorkbookRecord, error) {
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
	return &wb, nil
}

// UpdateWorkbookStats updates the statistics for a workbook.
func (m *WorkbookManager) UpdateWorkbookStats(ctx context.Context, recordID string, tabCount, totalRecords int, status, errorMessage string) error {
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
func (m *WorkbookManager) ListAllWorkbooks(ctx context.Context) ([]WorkbookRecord, error) {
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

// sharingConfig represents the structure of sheets_sharing.local.json
// Supports both legacy format (emails + role) and new multi-permission format (editors/commenters/readers)
type sharingConfig struct {
	// New multi-permission format
	Editors    []string `json:"editors"`
	Commenters []string `json:"commenters"`
	Readers    []string `json:"readers"`

	// Legacy format (for backward compatibility)
	Emails []string `json:"emails"`
	Role   string   `json:"role"`
}

// loadShareConfigFromFile attempts to load sharing config from config/sheets_sharing.local.json.
// Returns nil if the file doesn't exist or can't be parsed.
func (m *WorkbookManager) loadShareConfigFromFile() *sharingConfig {
	// Try to find the config file relative to the executable or working directory
	configPaths := []string{
		"config/sheets_sharing.local.json",
		filepath.Join(os.Getenv("HOME"), "kindred/config/sheets_sharing.local.json"),
	}

	for _, path := range configPaths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue // File doesn't exist at this path, try next
		}

		var config sharingConfig
		if err := json.Unmarshal(data, &config); err != nil {
			slog.Warn("Failed to parse sheets_sharing.local.json", "path", path, "error", err)
			continue
		}

		// Check if we have any emails configured (new or legacy format)
		hasEmails := len(config.Editors) > 0 || len(config.Commenters) > 0 || len(config.Readers) > 0 || len(config.Emails) > 0
		if hasEmails {
			slog.Debug("Loaded sharing config from file", "path", path,
				"editors", len(config.Editors),
				"commenters", len(config.Commenters),
				"readers", len(config.Readers),
				"legacy_emails", len(config.Emails))
			return &config
		}
	}

	return nil
}

// loadShareEmailsFromDB reads sharing emails from PocketBase config table.
func (m *WorkbookManager) loadShareEmailsFromDB(ctx context.Context) []string {
	filter := `category = "google_sheets" && config_key = "sharing_emails"`
	records, err := m.app.FindRecordsByFilter(configCollection, filter, "", 1, 0)
	if err != nil || len(records) == 0 {
		return nil
	}

	value := records[0].Get("value")
	if value == nil {
		return nil
	}

	// Value should be a JSON array of strings
	var emails []string
	switch v := value.(type) {
	case string:
		// Try to parse as JSON
		if err := json.Unmarshal([]byte(v), &emails); err != nil {
			slog.Warn("Failed to parse sharing_emails config from DB", "error", err)
			return nil
		}
	case []interface{}:
		for _, e := range v {
			if s, ok := e.(string); ok {
				emails = append(emails, s)
			}
		}
	}

	return emails
}

// GetShareEmails returns all email addresses to share workbooks with (combined from all permission levels).
// This is a convenience method that returns a flat list for backward compatibility.
// The actual sharing with proper permissions is done in shareWorkbook().
// Priority order:
// 1. Config file (config/sheets_sharing.local.json) - preferred for deployment
// 2. PocketBase config table - fallback/override for runtime changes
func (m *WorkbookManager) GetShareEmails(ctx context.Context) []string {
	// Try config file first
	if config := m.loadShareConfigFromFile(); config != nil {
		// Combine all email lists (for backward compatibility / status display)
		var allEmails []string
		allEmails = append(allEmails, config.Editors...)
		allEmails = append(allEmails, config.Commenters...)
		allEmails = append(allEmails, config.Readers...)
		// Also include legacy format emails
		allEmails = append(allEmails, config.Emails...)
		if len(allEmails) > 0 {
			return allEmails
		}
	}

	// Fall back to database config
	return m.loadShareEmailsFromDB(ctx)
}

// GetOrCreateGlobalsWorkbook returns the globals workbook ID, creating if needed.
func (m *WorkbookManager) GetOrCreateGlobalsWorkbook(ctx context.Context) (string, error) {
	// Check if we already have a globals workbook
	existing, err := m.GetWorkbookByType(ctx, "globals", 0)
	if err != nil {
		return "", fmt.Errorf("checking existing globals workbook: %w", err)
	}
	if existing != nil {
		return existing.SpreadsheetID, nil
	}

	// Create new workbook
	title := google.FormatWorkbookTitle("globals", 0)
	slog.Info("Creating new globals workbook", "title", title)

	spreadsheetID, err := google.CreateSpreadsheet(ctx, title)
	if err != nil {
		return "", fmt.Errorf("creating globals spreadsheet: %w", err)
	}

	url := google.FormatSpreadsheetURL(spreadsheetID)

	// Save to database
	_, err = m.SaveWorkbookRecord(ctx, WorkbookRecord{
		SpreadsheetID: spreadsheetID,
		WorkbookType:  "globals",
		Year:          0,
		Title:         title,
		URL:           url,
		Status:        "ok",
	})
	if err != nil {
		return "", fmt.Errorf("saving globals workbook record: %w", err)
	}

	// Share with configured emails
	if err := m.shareWorkbook(ctx, spreadsheetID); err != nil {
		slog.Warn("Failed to share globals workbook", "error", err)
		// Don't fail - sharing is optional
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
	_, err = m.SaveWorkbookRecord(ctx, WorkbookRecord{
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

	// Share with configured emails
	if err := m.shareWorkbook(ctx, spreadsheetID); err != nil {
		slog.Warn("Failed to share year workbook", "error", err, "year", year)
		// Don't fail - sharing is optional
	}

	slog.Info("Created year workbook", "year", year, "spreadsheet_id", spreadsheetID, "url", url)
	return spreadsheetID, nil
}

// shareWorkbook shares a workbook with all configured email addresses at their respective permission levels.
func (m *WorkbookManager) shareWorkbook(ctx context.Context, spreadsheetID string) error {
	config := m.loadShareConfigFromFile()
	if config == nil {
		// Fall back to database config (legacy behavior)
		emails := m.loadShareEmailsFromDB(ctx)
		if len(emails) == 0 {
			return nil
		}
		// DB config uses commenter role by default
		for _, email := range emails {
			if err := google.ShareSpreadsheet(ctx, spreadsheetID, email, "commenter"); err != nil {
				slog.Warn("Failed to share workbook with email", "email", email, "role", "commenter", "error", err)
			} else {
				slog.Info("Shared workbook", "email", email, "role", "commenter", "spreadsheet_id", spreadsheetID)
			}
		}
		return nil
	}

	// Handle legacy format (emails + role)
	if len(config.Emails) > 0 {
		role := config.Role
		if role == "" {
			role = "commenter" // Default to commenter if role not specified
		}
		for _, email := range config.Emails {
			if err := google.ShareSpreadsheet(ctx, spreadsheetID, email, role); err != nil {
				slog.Warn("Failed to share workbook with email", "email", email, "role", role, "error", err)
			} else {
				slog.Info("Shared workbook", "email", email, "role", role, "spreadsheet_id", spreadsheetID)
			}
		}
	}

	// Handle new multi-permission format
	// Share with editors (writer role in Google's terminology)
	for _, email := range config.Editors {
		if err := google.ShareSpreadsheet(ctx, spreadsheetID, email, "writer"); err != nil {
			slog.Warn("Failed to share workbook with editor", "email", email, "error", err)
		} else {
			slog.Info("Shared workbook", "email", email, "role", "writer", "spreadsheet_id", spreadsheetID)
		}
	}

	// Share with commenters
	for _, email := range config.Commenters {
		if err := google.ShareSpreadsheet(ctx, spreadsheetID, email, "commenter"); err != nil {
			slog.Warn("Failed to share workbook with commenter", "email", email, "error", err)
		} else {
			slog.Info("Shared workbook", "email", email, "role", "commenter", "spreadsheet_id", spreadsheetID)
		}
	}

	// Share with readers
	for _, email := range config.Readers {
		if err := google.ShareSpreadsheet(ctx, spreadsheetID, email, "reader"); err != nil {
			slog.Warn("Failed to share workbook with reader", "email", email, "error", err)
		} else {
			slog.Info("Shared workbook", "email", email, "role", "reader", "spreadsheet_id", spreadsheetID)
		}
	}

	return nil
}

// UpdateMasterIndex updates the Index sheet in the globals workbook.
func (m *WorkbookManager) UpdateMasterIndex(ctx context.Context) error {
	// Get globals workbook
	globals, err := m.GetWorkbookByType(ctx, "globals", 0)
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

	slog.Info("Updated master index", "workbook_count", len(workbooks))
	return nil
}

// BuildIndexSheetData builds the data matrix for the master index sheet.
// Rows are sorted: globals first, then years in descending order.
func BuildIndexSheetData(workbooks []WorkbookRecord) [][]interface{} {
	// Header row
	data := [][]interface{}{
		{"Year", "Workbook", "Link", "Last Sync", "Tabs", "Records", "Status"},
	}

	// Sort workbooks: globals first, then years descending
	sorted := make([]WorkbookRecord, len(workbooks))
	copy(sorted, workbooks)
	sort.Slice(sorted, func(i, j int) bool {
		// Globals always first
		if sorted[i].WorkbookType == "globals" {
			return true
		}
		if sorted[j].WorkbookType == "globals" {
			return false
		}
		// Years in descending order
		return sorted[i].Year > sorted[j].Year
	})

	// Add data rows
	for _, wb := range sorted {
		var yearDisplay interface{}
		if wb.WorkbookType == "globals" {
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
		link := fmt.Sprintf(`=HYPERLINK("%s","Open")`, wb.URL)

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
