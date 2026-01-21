package sync

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"google.golang.org/api/sheets/v4"
)

const (
	// serviceNameGoogleSheets is the name of this sync service
	serviceNameGoogleSheets = "google_sheets_export"

	// Sheet tab names
	tabAttendees = "Attendees"
	tabSessions  = "Sessions"
)

// SheetsWriter interface for writing to Google Sheets (enables mocking)
type SheetsWriter interface {
	WriteToSheet(ctx context.Context, spreadsheetID, sheetTab string, data [][]interface{}) error
	ClearSheet(ctx context.Context, spreadsheetID, sheetTab string) error
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
func (w *RealSheetsWriter) WriteToSheet(ctx context.Context, spreadsheetID, sheetTab string, data [][]interface{}) error {
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

// AttendeeRecord represents an attendee for export
type AttendeeRecord struct {
	FirstName      string
	LastName       string
	Grade          int
	Gender         string
	SessionName    string
	SessionType    string
	EnrollmentDate string
	Status         string
}

// SessionRecord represents a session for export
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
}

// NewGoogleSheetsExport creates a new Google Sheets export service
func NewGoogleSheetsExport(sheetsService *sheets.Service, spreadsheetID string) *GoogleSheetsExport {
	return &GoogleSheetsExport{
		BaseSyncService: BaseSyncService{
			Stats:         Stats{},
			ProcessedKeys: make(map[string]bool),
		},
		sheetsWriter:  NewRealSheetsWriter(sheetsService),
		spreadsheetID: spreadsheetID,
	}
}

// Name returns the name of this sync service
func (g *GoogleSheetsExport) Name() string {
	return serviceNameGoogleSheets
}

// Sync implements the Service interface - exports data to Google Sheets
func (g *GoogleSheetsExport) Sync(ctx context.Context) error {
	startTime := time.Now()
	slog.Info("Starting Google Sheets export", "spreadsheet_id", g.spreadsheetID)

	g.Stats = Stats{}
	g.SyncSuccessful = false

	// This will be called from orchestrator with PocketBase app context
	// For now, return error indicating it needs to be called with data
	slog.Warn("Sync() called without data - use ExportFromPocketBase() instead")

	g.Stats.Duration = int(time.Since(startTime).Seconds())
	return nil
}

// ExportToSheets exports attendee and session data to Google Sheets
func (g *GoogleSheetsExport) ExportToSheets(ctx context.Context, attendees []AttendeeRecord, sessions []SessionRecord) error {
	startTime := time.Now()
	slog.Info("Exporting to Google Sheets",
		"attendee_count", len(attendees),
		"session_count", len(sessions),
	)

	// Export Attendees
	if err := g.exportTab(ctx, tabAttendees, FormatAttendeesData(attendees)); err != nil {
		return fmt.Errorf("exporting attendees: %w", err)
	}
	g.Stats.Created += len(attendees)

	// Export Sessions
	if err := g.exportTab(ctx, tabSessions, FormatSessionsData(sessions)); err != nil {
		return fmt.Errorf("exporting sessions: %w", err)
	}
	g.Stats.Updated += len(sessions)

	g.SyncSuccessful = true
	g.Stats.Duration = int(time.Since(startTime).Seconds())

	slog.Info("Google Sheets export complete",
		"attendees", len(attendees),
		"sessions", len(sessions),
		"duration_seconds", g.Stats.Duration,
	)

	return nil
}

// exportTab clears and writes data to a single sheet tab
func (g *GoogleSheetsExport) exportTab(ctx context.Context, tabName string, data [][]interface{}) error {
	// Clear existing data
	if err := g.sheetsWriter.ClearSheet(ctx, g.spreadsheetID, tabName); err != nil {
		slog.Warn("Failed to clear sheet tab (may not exist yet)", "tab", tabName, "error", err)
		// Continue anyway - the write might still succeed
	}

	// Write new data
	if err := g.sheetsWriter.WriteToSheet(ctx, g.spreadsheetID, tabName, data); err != nil {
		return fmt.Errorf("writing to %s: %w", tabName, err)
	}

	return nil
}

// FormatAttendeesData formats attendee records for Google Sheets
func FormatAttendeesData(records []AttendeeRecord) [][]interface{} {
	// Header row
	data := [][]interface{}{
		{"First Name", "Last Name", "Grade", "Gender", "Session", "Session Type", "Enrollment Date", "Status"},
	}

	// Data rows
	for _, r := range records {
		data = append(data, []interface{}{
			r.FirstName,
			r.LastName,
			r.Grade,
			r.Gender,
			r.SessionName,
			r.SessionType,
			r.EnrollmentDate,
			r.Status,
		})
	}

	return data
}

// FormatSessionsData formats session records for Google Sheets
func FormatSessionsData(records []SessionRecord) [][]interface{} {
	// Header row
	data := [][]interface{}{
		{"Name", "Type", "Start Date", "End Date", "Year"},
	}

	// Data rows
	for _, r := range records {
		data = append(data, []interface{}{
			r.Name,
			r.Type,
			r.StartDate,
			r.EndDate,
			r.Year,
		})
	}

	return data
}
