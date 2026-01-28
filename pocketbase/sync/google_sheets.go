package sync

import (
	"context"
	"fmt"
	"log/slog"

	"google.golang.org/api/sheets/v4"
)

// SheetInfo contains metadata about a sheet tab
type SheetInfo struct {
	Title   string
	SheetID int64
	Index   int
}

// TabPropertyUpdate holds updates for a single tab in a batch operation
type TabPropertyUpdate struct {
	TabName string
	SheetID int64
	Color   *TabColor // nil if no color change
	Index   *int      // nil if no index change
}

// SheetsWriter interface for writing to Google Sheets (enables mocking)
type SheetsWriter interface {
	WriteToSheet(ctx context.Context, spreadsheetID, sheetTab string, data [][]interface{}) error
	ClearSheet(ctx context.Context, spreadsheetID, sheetTab string) error
	EnsureSheet(ctx context.Context, spreadsheetID, sheetTab string) error
	SetTabColor(ctx context.Context, spreadsheetID, sheetTab string, color TabColor) error
	SetTabIndex(ctx context.Context, spreadsheetID, sheetTab string, index int) error
	GetSheetMetadata(ctx context.Context, spreadsheetID string) ([]SheetInfo, error)
	// BatchUpdateTabProperties updates multiple tabs' colors and indices in a single API call.
	// This significantly reduces API calls compared to individual SetTabColor/SetTabIndex calls.
	BatchUpdateTabProperties(ctx context.Context, spreadsheetID string, updates []TabPropertyUpdate) error
	// DeleteSheet deletes a sheet tab from the spreadsheet (idempotent - no error if sheet doesn't exist).
	// This is useful for removing the default "Sheet1" created by Google when a new spreadsheet is made.
	DeleteSheet(ctx context.Context, spreadsheetID, sheetTab string) error
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

// SetTabColor sets the color for a sheet tab
func (w *RealSheetsWriter) SetTabColor(ctx context.Context, spreadsheetID, sheetTab string, color TabColor) error {
	// Get sheet ID by looking up tab name
	sheetID, err := w.getSheetID(ctx, spreadsheetID, sheetTab)
	if err != nil {
		return fmt.Errorf("getting sheet ID: %w", err)
	}

	// Update tab color
	req := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: []*sheets.Request{{
			UpdateSheetProperties: &sheets.UpdateSheetPropertiesRequest{
				Properties: &sheets.SheetProperties{
					SheetId: sheetID,
					TabColorStyle: &sheets.ColorStyle{
						RgbColor: &sheets.Color{
							Red:   color.R,
							Green: color.G,
							Blue:  color.B,
						},
					},
				},
				Fields: "tabColorStyle",
			},
		}},
	}

	_, err = w.service.Spreadsheets.BatchUpdate(spreadsheetID, req).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("setting tab color for %s: %w", sheetTab, err)
	}

	return nil
}

// SetTabIndex sets the position (index) of a sheet tab
func (w *RealSheetsWriter) SetTabIndex(ctx context.Context, spreadsheetID, sheetTab string, index int) error {
	// Get sheet ID by looking up tab name
	sheetID, err := w.getSheetID(ctx, spreadsheetID, sheetTab)
	if err != nil {
		return fmt.Errorf("getting sheet ID: %w", err)
	}

	// Update sheet index
	req := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: []*sheets.Request{{
			UpdateSheetProperties: &sheets.UpdateSheetPropertiesRequest{
				Properties: &sheets.SheetProperties{
					SheetId: sheetID,
					Index:   int64(index),
				},
				Fields: "index",
			},
		}},
	}

	_, err = w.service.Spreadsheets.BatchUpdate(spreadsheetID, req).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("setting tab index for %s: %w", sheetTab, err)
	}

	return nil
}

// GetSheetMetadata returns metadata for all sheets in the spreadsheet
func (w *RealSheetsWriter) GetSheetMetadata(ctx context.Context, spreadsheetID string) ([]SheetInfo, error) {
	spreadsheet, err := w.service.Spreadsheets.Get(spreadsheetID).Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("getting spreadsheet: %w", err)
	}

	result := make([]SheetInfo, 0, len(spreadsheet.Sheets))
	for _, sheet := range spreadsheet.Sheets {
		result = append(result, SheetInfo{
			Title:   sheet.Properties.Title,
			SheetID: sheet.Properties.SheetId,
			Index:   int(sheet.Properties.Index),
		})
	}

	return result, nil
}

// BatchUpdateTabProperties updates multiple tabs' colors and indices in a single API call.
// This reduces API calls from O(n*2) to O(1) for n tabs, avoiding rate limits.
func (w *RealSheetsWriter) BatchUpdateTabProperties(
	ctx context.Context,
	spreadsheetID string,
	updates []TabPropertyUpdate,
) error {
	if len(updates) == 0 {
		return nil
	}

	// Build batch request with all property updates
	requests := make([]*sheets.Request, 0, len(updates)*2) // up to 2 requests per tab (color + index)

	for _, update := range updates {
		// Add color update if specified
		if update.Color != nil {
			requests = append(requests, &sheets.Request{
				UpdateSheetProperties: &sheets.UpdateSheetPropertiesRequest{
					Properties: &sheets.SheetProperties{
						SheetId: update.SheetID,
						TabColorStyle: &sheets.ColorStyle{
							RgbColor: &sheets.Color{
								Red:   update.Color.R,
								Green: update.Color.G,
								Blue:  update.Color.B,
							},
						},
					},
					Fields: "tabColorStyle",
				},
			})
		}

		// Add index update if specified
		if update.Index != nil {
			requests = append(requests, &sheets.Request{
				UpdateSheetProperties: &sheets.UpdateSheetPropertiesRequest{
					Properties: &sheets.SheetProperties{
						SheetId: update.SheetID,
						Index:   int64(*update.Index),
					},
					Fields: "index",
				},
			})
		}
	}

	if len(requests) == 0 {
		return nil
	}

	// Execute single batch request for all updates
	batchReq := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: requests,
	}

	_, err := w.service.Spreadsheets.BatchUpdate(spreadsheetID, batchReq).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("batch updating tab properties: %w", err)
	}

	slog.Info("Batch updated tab properties",
		"tabs", len(updates),
		"requests", len(requests),
	)

	return nil
}

// getSheetID looks up the sheet ID for a given tab name
func (w *RealSheetsWriter) getSheetID(ctx context.Context, spreadsheetID, sheetTab string) (int64, error) {
	spreadsheet, err := w.service.Spreadsheets.Get(spreadsheetID).Context(ctx).Do()
	if err != nil {
		return 0, fmt.Errorf("getting spreadsheet: %w", err)
	}

	for _, sheet := range spreadsheet.Sheets {
		if sheet.Properties.Title == sheetTab {
			return sheet.Properties.SheetId, nil
		}
	}

	return 0, fmt.Errorf("sheet tab %q not found", sheetTab)
}

// DeleteSheet deletes a sheet tab from the spreadsheet (idempotent).
// Returns nil if the sheet doesn't exist (no error - idempotent behavior).
func (w *RealSheetsWriter) DeleteSheet(ctx context.Context, spreadsheetID, sheetTab string) error {
	sheetID, err := w.getSheetID(ctx, spreadsheetID, sheetTab)
	if err != nil {
		// Sheet not found - idempotent success
		return nil
	}

	req := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: []*sheets.Request{{
			DeleteSheet: &sheets.DeleteSheetRequest{
				SheetId: sheetID,
			},
		}},
	}

	_, err = w.service.Spreadsheets.BatchUpdate(spreadsheetID, req).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("deleting sheet %s: %w", sheetTab, err)
	}

	slog.Info("Deleted sheet tab", "tab", sheetTab)
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

// PersonInfo holds person data for lookup
type PersonInfo struct {
	FirstName string
	LastName  string
	Gender    string
	Grade     int
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
