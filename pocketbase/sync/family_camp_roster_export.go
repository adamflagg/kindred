package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/camp/kindred/pocketbase/google"
	"github.com/pocketbase/pocketbase/core"
)

// Exporting one weekend's roster to Google Sheets. kindred#2433.
//
// The export APPENDS a dated tab and never prunes or overwrites one. Staff
// hand-edit every tab -- paper registrations exist only as lodging-board
// write-ins and never reach CampMinder -- so the previous tab is where they copy
// their work from. That is also why there is no scheduled run.

// defaultSheetTabName is the empty tab Google puts in every new spreadsheet.
const defaultSheetTabName = "Sheet1"

// ErrRosterFolderNotConfigured means GOOGLE_DRIVE_ROSTER_FOLDER_ID is unset.
//
// This REFUSES rather than falling back to GOOGLE_DRIVE_FOLDER_ID. Drive folder
// sharing is the privacy control for these workbooks and it is per-folder: the
// Exports folder's audience is wider, and a roster landing there would publish
// family contact details to it. A silent no-op is not an option either -- it is
// indistinguishable from a weekend with no enrolled campers.
var ErrRosterFolderNotConfigured = errors.New(
	"GOOGLE_DRIVE_ROSTER_FOLDER_ID is not set; it is required for Family Camp roster exports " +
		"and is deliberately a different folder from GOOGLE_DRIVE_FOLDER_ID")

// RosterDriveClient is the Drive surface the export needs, behind an interface
// so the whole orchestration is testable without a network call.
type RosterDriveClient interface {
	// RosterFolderID returns the configured roster folder, or "" when unset.
	RosterFolderID() string
	FindOrCreateFolder(ctx context.Context, parentID, name string) (string, error)
	FindSpreadsheetInFolder(ctx context.Context, folderID, name string) (string, error)
	CreateSpreadsheetInFolder(ctx context.Context, folderID, title string) (string, error)
}

// DefaultRosterDriveClient delegates to the google package.
type DefaultRosterDriveClient struct{}

// RosterFolderID returns GOOGLE_DRIVE_ROSTER_FOLDER_ID.
func (DefaultRosterDriveClient) RosterFolderID() string { return google.GetRosterFolderID() }

// FindOrCreateFolder returns the id of `name` beneath parentID, creating it if
// needed. Only the {year} folder goes through this: code owns that name and it
// is deterministic, whereas a CONFIGURED folder is addressed by id so that
// renaming it in Drive surfaces as an error rather than a silent duplicate.
func (DefaultRosterDriveClient) FindOrCreateFolder(
	ctx context.Context, parentID, name string,
) (string, error) {
	return google.FindOrCreateFolder(ctx, parentID, name)
}

// FindSpreadsheetInFolder searches one folder for a spreadsheet by exact name.
func (DefaultRosterDriveClient) FindSpreadsheetInFolder(
	ctx context.Context, folderID, name string,
) (string, error) {
	return google.FindSpreadsheetInFolder(ctx, folderID, name)
}

// CreateSpreadsheetInFolder creates a spreadsheet in an explicit folder.
func (DefaultRosterDriveClient) CreateSpreadsheetInFolder(
	ctx context.Context, folderID, title string,
) (string, error) {
	return google.CreateSpreadsheetInFolder(ctx, folderID, title)
}

// RosterExportResult is what one export produced, and the endpoint's response.
type RosterExportResult struct {
	SpreadsheetID  string `json:"spreadsheet_id"`
	URL            string `json:"url"`
	Title          string `json:"title"`
	TabName        string `json:"tab_name"`
	SessionCMID    int    `json:"session_cm_id"`
	SessionName    string `json:"session_name"`
	Year           int    `json:"year"`
	HouseholdCount int    `json:"household_count"`
	CamperCount    int    `json:"camper_count"`
	AdultCount     int    `json:"adult_count"`
	PersonCount    int    `json:"person_count"`
}

// RosterExporter builds a weekend's roster and appends it to that weekend's
// workbook.
type RosterExporter struct {
	app       core.App
	writer    SheetsWriter
	drive     RosterDriveClient
	workbooks *WorkbookManager
	now       func() time.Time
}

// NewRosterExporter wires an exporter. `now` is injected so the dated tab name
// and the export-time ages are testable.
func NewRosterExporter(
	app core.App, writer SheetsWriter, drive RosterDriveClient, now func() time.Time,
) *RosterExporter {
	return &RosterExporter{
		app:       app,
		writer:    writer,
		drive:     drive,
		workbooks: NewWorkbookManager(app, writer),
		now:       now,
	}
}

// Export builds the roster and appends it as a new dated tab, creating the
// weekend's workbook on the first run.
//
// It is synchronous: a handful of Google calls, not a sync run.
func (e *RosterExporter) Export(ctx context.Context, year, sessionCMID int) (*RosterExportResult, error) {
	// Built FIRST, so a weekend that refuses (not a family session, no enrolled
	// campers) never reaches Drive -- no empty workbook, no empty tab.
	at := e.now().In(campLocation())
	roster, err := BuildFamilyCampRoster(e.app, year, sessionCMID, at)
	if err != nil {
		return nil, err
	}

	title := google.FormatRosterWorkbookTitle(roster.SessionName, year)
	spreadsheetID, err := e.resolveWorkbook(ctx, roster, title)
	if err != nil {
		return nil, err
	}

	tabName, sheetID, err := e.appendTab(ctx, spreadsheetID, at)
	if err != nil {
		return nil, err
	}

	if err := e.writer.WriteToSheet(ctx, spreadsheetID, tabName, RosterSheetValues(roster)); err != nil {
		return nil, fmt.Errorf("writing roster tab %q: %w", tabName, err)
	}
	if err := e.writer.ApplyFormatting(ctx, spreadsheetID, RosterSheetFormat(sheetID, roster)); err != nil {
		return nil, fmt.Errorf("formatting roster tab %q: %w", tabName, err)
	}

	// Google puts an empty "Sheet1" in every new spreadsheet. Removed only after
	// the real tab exists, since a spreadsheet cannot have zero sheets.
	// Best-effort: an orphan default tab is untidy, not a failed export.
	if err := e.writer.DeleteSheet(ctx, spreadsheetID, defaultSheetTabName); err != nil {
		slog.Warn("Could not remove the default sheet from a roster workbook",
			"error", err, "spreadsheet_id", spreadsheetID)
	}

	result := &RosterExportResult{
		SpreadsheetID:  spreadsheetID,
		URL:            google.FormatSpreadsheetURL(spreadsheetID),
		Title:          title,
		TabName:        tabName,
		SessionCMID:    sessionCMID,
		SessionName:    roster.SessionName,
		Year:           year,
		HouseholdCount: roster.HouseholdCount(),
		CamperCount:    roster.CamperCount(),
		AdultCount:     roster.AdultCount(),
		PersonCount:    roster.PersonCount(),
	}

	if err := e.recordWorkbook(ctx, result); err != nil {
		return nil, err
	}

	slog.Info("Exported Family Camp roster",
		"session", roster.SessionName, "session_cm_id", sessionCMID, "year", year,
		"tab", tabName, "households", result.HouseholdCount, "people", result.PersonCount,
		"spreadsheet_id", spreadsheetID)
	return result, nil
}

// resolveWorkbook returns this weekend's spreadsheet id, creating the workbook
// on the first export.
//
// Three steps, in order of authority: the registry row, then a Drive search by
// name, then create. The middle one matters when the database has been cleared
// but the workbook is still in Drive -- creating a second one under the same
// name would leave staff with two and no way to tell which carries their edits.
func (e *RosterExporter) resolveWorkbook(ctx context.Context, roster *Roster, title string) (string, error) {
	existing, err := e.workbooks.GetWorkbookForSession(
		ctx, workbookTypeFCRoster, roster.Year, roster.SessionCMID)
	if err != nil {
		return "", fmt.Errorf("checking for an existing roster workbook: %w", err)
	}
	if existing != nil && existing.SpreadsheetID != "" {
		return existing.SpreadsheetID, nil
	}

	// Resolved only now, so a refused weekend never reaches Drive.
	rosterFolder := e.drive.RosterFolderID()
	if rosterFolder == "" {
		return "", ErrRosterFolderNotConfigured
	}

	// The {year} folder is created BENEATH whatever the env var resolves to, so
	// prod and dev each get their own without anything special-casing which is
	// which.
	yearFolder, err := e.drive.FindOrCreateFolder(ctx, rosterFolder, strconv.Itoa(roster.Year))
	if err != nil {
		return "", fmt.Errorf("resolving the %d roster folder: %w", roster.Year, err)
	}

	found, err := e.drive.FindSpreadsheetInFolder(ctx, yearFolder, title)
	if err != nil {
		return "", fmt.Errorf("searching for roster workbook %q: %w", title, err)
	}
	if found != "" {
		slog.Info("Re-linking a roster workbook already in Drive", "title", title, "spreadsheet_id", found)
		return found, nil
	}

	created, err := e.drive.CreateSpreadsheetInFolder(ctx, yearFolder, title)
	if err != nil {
		return "", fmt.Errorf("creating roster workbook %q: %w", title, err)
	}
	slog.Info("Created a roster workbook", "title", title, "spreadsheet_id", created)
	return created, nil
}

// appendTab adds a new dated tab and returns its name and sheet id.
//
// The sheet id is read back rather than assumed: ApplyFormatting aims every
// GridRange at it, and the wrong id would silently reformat another tab -- each
// of which is hand-edited staff work.
func (e *RosterExporter) appendTab(
	ctx context.Context, spreadsheetID string, at time.Time,
) (tabName string, sheetID int64, err error) {
	before, err := e.writer.GetSheetMetadata(ctx, spreadsheetID)
	if err != nil {
		return "", 0, fmt.Errorf("reading roster workbook tabs: %w", err)
	}
	existing := make([]string, 0, len(before))
	for _, sheet := range before {
		existing = append(existing, sheet.Title)
	}

	tabName = rosterTabName(at, existing)
	if ensureErr := e.writer.EnsureSheet(ctx, spreadsheetID, tabName); ensureErr != nil {
		return "", 0, fmt.Errorf("creating roster tab %q: %w", tabName, ensureErr)
	}

	after, err := e.writer.GetSheetMetadata(ctx, spreadsheetID)
	if err != nil {
		return "", 0, fmt.Errorf("reading back roster tab %q: %w", tabName, err)
	}

	for _, sheet := range after {
		if sheet.Title == tabName {
			return tabName, sheet.SheetID, nil
		}
	}
	return "", 0, fmt.Errorf("roster tab %q was created but is not in the workbook's metadata", tabName)
}

// recordWorkbook upserts the registry row, keyed on (type, year, session).
func (e *RosterExporter) recordWorkbook(ctx context.Context, result *RosterExportResult) error {
	tabs, err := e.writer.GetSheetMetadata(ctx, result.SpreadsheetID)
	if err != nil {
		return fmt.Errorf("counting roster workbook tabs: %w", err)
	}

	if _, err := e.workbooks.SaveWorkbookRecord(ctx, &WorkbookRecord{
		SpreadsheetID: result.SpreadsheetID,
		WorkbookType:  workbookTypeFCRoster,
		Year:          result.Year,
		SessionCMID:   result.SessionCMID,
		Title:         result.Title,
		URL:           result.URL,
		TabCount:      len(tabs),
		TotalRecords:  result.PersonCount,
		Status:        "ok",
	}); err != nil {
		return fmt.Errorf("recording roster workbook: %w", err)
	}
	return nil
}

// ErrRosterSheetsDisabled means GOOGLE_SHEETS_ENABLED is not true.
//
// The sync path degrades gracefully when Sheets is off, because a nightly export
// that quietly skips is better than one that fails the run. A staff-triggered
// export is the opposite: someone is waiting for a link, and a nil writer would
// panic on the first call rather than name what is switched off.
var ErrRosterSheetsDisabled = errors.New(
	"GOOGLE_SHEETS_ENABLED is not true; Family Camp roster export needs Google Sheets")

// NewRosterExporterForApp wires an exporter against the real Google clients.
//
// The writer is rate-limited, matching the data export: both surfaces share one
// Sheets quota, and the roster's formatting call is a write like any other.
func NewRosterExporterForApp(ctx context.Context, app core.App) (*RosterExporter, error) {
	if !google.IsEnabled() {
		return nil, ErrRosterSheetsDisabled
	}

	client, err := google.NewSheetsClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("creating the Google Sheets client: %w", err)
	}
	if client == nil {
		// IsEnabled said yes, so this is unreachable -- and is checked anyway
		// because the alternative is a nil-pointer panic inside a request.
		return nil, ErrRosterSheetsDisabled
	}

	writer := NewRateLimitedSheetsWriter(NewRealSheetsWriter(client), nil)
	return NewRosterExporter(app, writer, DefaultRosterDriveClient{}, time.Now), nil
}
