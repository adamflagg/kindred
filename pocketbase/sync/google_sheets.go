package sync

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"google.golang.org/api/sheets/v4"
)

const (
	// serviceNameGoogleSheets is the name of this sync service
	serviceNameGoogleSheets = "google_sheets_export"
)

// SheetsWriter interface for writing to Google Sheets (enables mocking)
type SheetsWriter interface {
	WriteToSheet(ctx context.Context, spreadsheetID, sheetTab string, data [][]interface{}) error
	ClearSheet(ctx context.Context, spreadsheetID, sheetTab string) error
	EnsureSheet(ctx context.Context, spreadsheetID, sheetTab string) error
}

// RealSheetsWriter implements SheetsWriter using the Google Sheets API
type RealSheetsWriter struct {
	service *sheets.Service
}

// NewRealSheetsWriter creates a new RealSheetsWriter
func NewRealSheetsWriter(service *sheets.Service) *RealSheetsWriter {
	return &RealSheetsWriter{service: service}
}

// WriteToSheet writes data to a specific sheet tab
func (w *RealSheetsWriter) WriteToSheet(
	ctx context.Context, spreadsheetID, sheetTab string, data [][]interface{},
) error {
	valueRange := &sheets.ValueRange{
		Values: data,
	}

	_, err := w.service.Spreadsheets.Values.Update(
		spreadsheetID,
		sheetTab+"!A1",
		valueRange,
	).ValueInputOption("RAW").Context(ctx).Do()

	return err
}

// ClearSheet clears all data from a sheet tab
func (w *RealSheetsWriter) ClearSheet(ctx context.Context, spreadsheetID, sheetTab string) error {
	_, err := w.service.Spreadsheets.Values.Clear(
		spreadsheetID,
		sheetTab+"!A:Z",
		&sheets.ClearValuesRequest{},
	).Context(ctx).Do()

	return err
}

// EnsureSheet creates a sheet tab if it doesn't exist (idempotent)
func (w *RealSheetsWriter) EnsureSheet(ctx context.Context, spreadsheetID, sheetTab string) error {
	// Get spreadsheet metadata to check existing tabs
	spreadsheet, err := w.service.Spreadsheets.Get(spreadsheetID).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("getting spreadsheet: %w", err)
	}

	// Check if tab already exists
	for _, sheet := range spreadsheet.Sheets {
		if sheet.Properties.Title == sheetTab {
			// Tab already exists, nothing to do
			return nil
		}
	}

	// Tab doesn't exist, create it
	addSheetRequest := &sheets.Request{
		AddSheet: &sheets.AddSheetRequest{
			Properties: &sheets.SheetProperties{
				Title: sheetTab,
			},
		},
	}

	batchUpdateRequest := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: []*sheets.Request{addSheetRequest},
	}

	_, err = w.service.Spreadsheets.BatchUpdate(spreadsheetID, batchUpdateRequest).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("creating sheet tab %s: %w", sheetTab, err)
	}

	slog.Info("Created new sheet tab", "tab", sheetTab)
	return nil
}

// SessionRecord represents a session for export (used by loadSessions for lookups)
type SessionRecord struct {
	Name      string
	Type      string
	StartDate string
	EndDate   string
	Year      int
}

// GoogleSheetsExport handles exporting data to Google Sheets
type GoogleSheetsExport struct {
	BaseSyncService
	sheetsWriter  SheetsWriter
	spreadsheetID string
	year          int
}

// NewGoogleSheetsExport creates a new Google Sheets export service
func NewGoogleSheetsExport(app core.App, sheetsService *sheets.Service, spreadsheetID string) *GoogleSheetsExport {
	// Get year from environment (same as other sync services)
	year := 2025 // Default
	if yearStr := os.Getenv("CAMPMINDER_SEASON_ID"); yearStr != "" {
		if parsed, err := strconv.Atoi(yearStr); err == nil {
			year = parsed
		}
	}

	return &GoogleSheetsExport{
		BaseSyncService: BaseSyncService{
			App:           app,
			Stats:         Stats{},
			ProcessedKeys: make(map[string]bool),
		},
		sheetsWriter:  NewRealSheetsWriter(sheetsService),
		spreadsheetID: spreadsheetID,
		year:          year,
	}
}

// Name returns the name of this sync service
func (g *GoogleSheetsExport) Name() string {
	return serviceNameGoogleSheets
}

// Sync implements the Service interface - exports data to Google Sheets
// This is the main entry point for full exports (both globals and year-specific data)
func (g *GoogleSheetsExport) Sync(ctx context.Context) error {
	startTime := time.Now()
	slog.Info("Starting Google Sheets full export",
		"spreadsheet_id", g.spreadsheetID,
		"year", g.year,
		"expected_tabs", len(GetAllExportSheetNames(g.year)),
	)

	g.Stats = Stats{}
	g.SyncSuccessful = false

	// Export global tables (4 tabs: tag definitions, custom fields, etc.)
	if err := g.SyncGlobalsOnly(ctx); err != nil {
		slog.Error("Failed to export global tables", "error", err)
		// Continue with year-specific data even if globals fail
	}

	// Export year-specific tables (6 tabs: attendees, persons, sessions, etc.)
	if err := g.SyncDailyOnly(ctx); err != nil {
		return fmt.Errorf("exporting year-specific data: %w", err)
	}

	g.SyncSuccessful = true
	g.Stats.Duration = int(time.Since(startTime).Seconds())

	slog.Info("Google Sheets full export complete",
		"duration_seconds", g.Stats.Duration,
		"records_exported", g.Stats.Created,
	)

	return nil
}

// PersonInfo holds person data for lookup
type PersonInfo struct {
	FirstName string
	LastName  string
	Gender    string
	Grade     int
}

// loadPersons loads all persons into a map keyed by PB ID
func (g *GoogleSheetsExport) loadPersons() (map[string]PersonInfo, error) {
	filter := fmt.Sprintf("year = %d", g.year)
	records, err := g.App.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		return nil, err
	}

	personMap := make(map[string]PersonInfo)
	for _, r := range records {
		grade := 0
		if gradeVal := r.Get("grade"); gradeVal != nil {
			if gradeFloat, ok := gradeVal.(float64); ok {
				grade = int(gradeFloat)
			}
		}
		personMap[r.Id] = PersonInfo{
			FirstName: safeString(r.Get("first_name")),
			LastName:  safeString(r.Get("last_name")),
			Gender:    safeString(r.Get("gender")),
			Grade:     grade,
		}
	}
	return personMap, nil
}

// loadSessions loads all sessions into a map keyed by PB ID
func (g *GoogleSheetsExport) loadSessions() (map[string]SessionRecord, error) {
	filter := fmt.Sprintf("year = %d", g.year)
	records, err := g.App.FindRecordsByFilter("camp_sessions", filter, "", 0, 0)
	if err != nil {
		return nil, err
	}

	sessionMap := make(map[string]SessionRecord)
	for _, r := range records {
		year := 0
		if yearVal := r.Get("year"); yearVal != nil {
			if yearFloat, ok := yearVal.(float64); ok {
				year = int(yearFloat)
			}
		}
		sessionMap[r.Id] = SessionRecord{
			Name:      safeString(r.Get("name")),
			Type:      safeString(r.Get("session_type")),
			StartDate: safeString(r.Get("start_date")),
			EndDate:   safeString(r.Get("end_date")),
			Year:      year,
		}
	}
	return sessionMap, nil
}

// safeString safely converts an interface{} to string
func safeString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

