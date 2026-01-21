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
func (g *GoogleSheetsExport) Sync(ctx context.Context) error {
	startTime := time.Now()
	slog.Info("Starting Google Sheets export", "spreadsheet_id", g.spreadsheetID, "year", g.year)

	g.Stats = Stats{}
	g.SyncSuccessful = false

	// Query attendees from PocketBase
	attendees, err := g.queryAttendees()
	if err != nil {
		return fmt.Errorf("querying attendees: %w", err)
	}

	// Query sessions from PocketBase
	sessions, err := g.querySessions()
	if err != nil {
		return fmt.Errorf("querying sessions: %w", err)
	}

	// Export to Google Sheets
	if err := g.ExportToSheets(ctx, attendees, sessions); err != nil {
		return err
	}

	g.Stats.Duration = int(time.Since(startTime).Seconds())
	return nil
}

// queryAttendees queries attendee records from PocketBase
func (g *GoogleSheetsExport) queryAttendees() ([]AttendeeRecord, error) {
	// Query enrolled, active attendees for the configured year
	filter := fmt.Sprintf("year = %d && is_active = 1 && status_id = 2", g.year)

	records, err := g.App.FindRecordsByFilter(
		"attendees",
		filter,
		"", // no sort
		0,  // no limit
		0,  // no offset
	)
	if err != nil {
		return nil, fmt.Errorf("querying attendees: %w", err)
	}

	// Pre-load persons and sessions for efficient lookup
	personMap, err := g.loadPersons()
	if err != nil {
		slog.Warn("Failed to load persons", "error", err)
	}

	sessionMap, err := g.loadSessions()
	if err != nil {
		slog.Warn("Failed to load sessions", "error", err)
	}

	attendees := make([]AttendeeRecord, 0, len(records))
	for _, record := range records {
		attendee := AttendeeRecord{
			Status: safeString(record.Get("status")),
		}

		// Get enrollment date
		if enrollDate := record.Get("enrollment_date"); enrollDate != nil {
			if dateStr, ok := enrollDate.(string); ok {
				attendee.EnrollmentDate = dateStr
			}
		}

		// Get person data from map (using PB ID)
		if personID := safeString(record.Get("person")); personID != "" {
			if person, ok := personMap[personID]; ok {
				attendee.FirstName = person.FirstName
				attendee.LastName = person.LastName
				attendee.Gender = person.Gender
				attendee.Grade = person.Grade
			}
		}

		// Get session data from map (using PB ID)
		if sessionID := safeString(record.Get("session")); sessionID != "" {
			if session, ok := sessionMap[sessionID]; ok {
				attendee.SessionName = session.Name
				attendee.SessionType = session.Type
			}
		}

		attendees = append(attendees, attendee)
	}

	slog.Info("Queried attendees", "count", len(attendees))
	return attendees, nil
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

// querySessions queries session records from PocketBase
func (g *GoogleSheetsExport) querySessions() ([]SessionRecord, error) {
	// Query sessions for the configured year (main and embedded only)
	filter := fmt.Sprintf("year = %d && (session_type = 'main' || session_type = 'embedded')", g.year)

	records, err := g.App.FindRecordsByFilter(
		"camp_sessions",
		filter,
		"name", // sort by name
		0,      // no limit
		0,      // no offset
	)
	if err != nil {
		return nil, fmt.Errorf("querying sessions: %w", err)
	}

	sessions := make([]SessionRecord, 0, len(records))
	for _, record := range records {
		session := SessionRecord{
			Name: safeString(record.Get("name")),
			Type: safeString(record.Get("session_type")),
		}

		// Get dates
		if startDate := record.Get("start_date"); startDate != nil {
			if dateStr, ok := startDate.(string); ok {
				session.StartDate = dateStr
			}
		}
		if endDate := record.Get("end_date"); endDate != nil {
			if dateStr, ok := endDate.(string); ok {
				session.EndDate = dateStr
			}
		}

		// Get year
		if year := record.Get("year"); year != nil {
			if yearFloat, ok := year.(float64); ok {
				session.Year = int(yearFloat)
			}
		}

		sessions = append(sessions, session)
	}

	slog.Info("Queried sessions", "count", len(sessions))
	return sessions, nil
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

// ExportToSheets exports attendee and session data to Google Sheets
func (g *GoogleSheetsExport) ExportToSheets(
	ctx context.Context, attendees []AttendeeRecord, sessions []SessionRecord,
) error {
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
	// Preallocate with capacity: 1 header + len(records) data rows
	data := make([][]interface{}, 0, 1+len(records))

	// Header row
	data = append(data, []interface{}{
		"First Name", "Last Name", "Grade", "Gender", "Session", "Session Type", "Enrollment Date", "Status",
	})

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
	// Preallocate with capacity: 1 header + len(records) data rows
	data := make([][]interface{}, 0, 1+len(records))

	// Header row
	data = append(data, []interface{}{"Name", "Type", "Start Date", "End Date", "Year"})

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
