// Package google provides Google API client initialization and configuration.
package google

import (
	"context"
	"fmt"

	"google.golang.org/api/drive/v3"
)

// NewDriveClient creates a new Google Drive API client using service account credentials.
// Returns nil, nil if Google Sheets sync is disabled (graceful degradation).
// Uses the same credentials as the Sheets client.
func NewDriveClient(ctx context.Context) (*drive.Service, error) {
	opt, enabled, err := getAuthenticatedHTTPClient(ctx, drive.DriveScope)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, nil
	}

	srv, err := drive.NewService(ctx, opt)
	if err != nil {
		return nil, fmt.Errorf("failed to create drive service: %w", err)
	}

	return srv, nil
}

// CreateSpreadsheet creates a new Google Sheets spreadsheet in the configured folder.
// Requires Google Sheets to be enabled and GOOGLE_DRIVE_FOLDER_ID to be set.
// The folder must be shared with the service account (Editor access).
func CreateSpreadsheet(ctx context.Context, title string) (string, error) {
	if !IsEnabled() {
		return "", fmt.Errorf("google sheets is not enabled")
	}

	folderID := GetFolderID()
	if folderID == "" {
		return "", fmt.Errorf("GOOGLE_DRIVE_FOLDER_ID not set - required for creating spreadsheets")
	}

	driveClient, err := NewDriveClient(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create drive client: %w", err)
	}
	if driveClient == nil {
		return "", fmt.Errorf("google drive client is nil")
	}

	file := &drive.File{
		Name:     title,
		MimeType: "application/vnd.google-apps.spreadsheet",
		Parents:  []string{folderID},
	}

	created, err := driveClient.Files.Create(file).
		SupportsAllDrives(true). // Required for Shared Drives
		Context(ctx).
		Do()
	if err != nil {
		return "", fmt.Errorf("failed to create spreadsheet in folder: %w", err)
	}

	return created.Id, nil
}

// FormatSpreadsheetURL returns the edit URL for a Google Sheets spreadsheet.
func FormatSpreadsheetURL(spreadsheetID string) string {
	return fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/edit", spreadsheetID)
}
