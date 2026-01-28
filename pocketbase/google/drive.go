// Package google provides Google API client initialization and configuration.
package google

import (
	"context"
	"fmt"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/sheets/v4"
)

// Valid sharing roles for Google Drive
var validShareRoles = map[string]bool{
	"reader":    true,
	"writer":    true,
	"commenter": true,
	"owner":     true,
}

// NewDriveClient creates a new Google Drive API client using service account credentials.
// Returns nil, nil if Google Sheets sync is disabled (graceful degradation).
// Uses the same credentials as the Sheets client.
func NewDriveClient(ctx context.Context) (*drive.Service, error) {
	opt, err := getAuthenticatedHTTPClient(ctx, drive.DriveScope)
	if err != nil {
		return nil, err
	}
	if opt == nil {
		return nil, nil
	}

	srv, err := drive.NewService(ctx, *opt)
	if err != nil {
		return nil, fmt.Errorf("failed to create drive service: %w", err)
	}

	return srv, nil
}

// CreateSpreadsheet creates a new Google Sheets spreadsheet and returns its ID.
// Requires Google Sheets to be enabled.
func CreateSpreadsheet(ctx context.Context, title string) (string, error) {
	if !IsEnabled() {
		return "", fmt.Errorf("google sheets is not enabled")
	}

	sheetsClient, err := NewSheetsClient(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create sheets client: %w", err)
	}
	if sheetsClient == nil {
		return "", fmt.Errorf("google sheets client is nil")
	}

	spreadsheet := &sheets.Spreadsheet{
		Properties: &sheets.SpreadsheetProperties{
			Title: title,
		},
	}

	created, err := sheetsClient.Spreadsheets.Create(spreadsheet).Context(ctx).Do()
	if err != nil {
		return "", fmt.Errorf("failed to create spreadsheet: %w", err)
	}

	return created.SpreadsheetId, nil
}

// ShareSpreadsheet shares a spreadsheet with the specified email address.
// Role must be one of: "reader", "writer", "commenter", "owner".
// Requires Google Sheets to be enabled.
func ShareSpreadsheet(ctx context.Context, spreadsheetID, email, role string) error {
	if err := validateShareRole(role); err != nil {
		return err
	}

	if !IsEnabled() {
		return fmt.Errorf("google sheets is not enabled")
	}

	driveClient, err := NewDriveClient(ctx)
	if err != nil {
		return fmt.Errorf("failed to create drive client: %w", err)
	}
	if driveClient == nil {
		return fmt.Errorf("google drive client is nil")
	}

	permission := &drive.Permission{
		Type:         "user",
		Role:         role,
		EmailAddress: email,
	}

	_, err = driveClient.Permissions.Create(spreadsheetID, permission).
		SendNotificationEmail(false).
		Context(ctx).
		Do()
	if err != nil {
		return fmt.Errorf("failed to share spreadsheet with %s: %w", email, err)
	}

	return nil
}

// FormatSpreadsheetURL returns the edit URL for a Google Sheets spreadsheet.
func FormatSpreadsheetURL(spreadsheetID string) string {
	return fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/edit", spreadsheetID)
}

// validateShareRole checks if the role is valid for Google Drive sharing.
func validateShareRole(role string) error {
	if !validShareRoles[role] {
		return fmt.Errorf("invalid sharing role %q: must be one of reader, writer, commenter, owner", role)
	}
	return nil
}
