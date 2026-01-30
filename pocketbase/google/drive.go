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

// FindSpreadsheetByName searches for a spreadsheet by exact name in the configured folder.
// Returns the spreadsheet ID if found, empty string if not found.
// Returns "", nil when Google Sheets is disabled (graceful degradation).
// Returns error only for API failures, NOT for "not found" scenarios.
func FindSpreadsheetByName(ctx context.Context, name string) (string, error) {
	if !IsEnabled() {
		return "", nil
	}

	folderID := GetFolderID()
	if folderID == "" {
		return "", fmt.Errorf("GOOGLE_DRIVE_FOLDER_ID not set - required for searching spreadsheets")
	}

	driveClient, err := NewDriveClient(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create drive client: %w", err)
	}
	if driveClient == nil {
		return "", fmt.Errorf("google drive client is nil")
	}

	// Build query to search for spreadsheet by exact name in the folder
	// Escape single quotes in the name to prevent query injection
	escapedName := escapeQueryString(name)
	query := fmt.Sprintf(
		"name='%s' and '%s' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
		escapedName,
		folderID,
	)

	fileList, err := driveClient.Files.List().
		Q(query).
		SupportsAllDrives(true).           // Required for Shared Drives
		IncludeItemsFromAllDrives(true).   // Required for Shared Drives
		Fields("files(id, name)").
		Context(ctx).
		Do()
	if err != nil {
		return "", fmt.Errorf("failed to search for spreadsheet: %w", err)
	}

	if len(fileList.Files) == 0 {
		return "", nil // Not found - this is not an error
	}

	// Return the first match (there should only be one with exact name in folder)
	return fileList.Files[0].Id, nil
}

// escapeQueryString escapes single quotes for Drive API queries
func escapeQueryString(s string) string {
	// In Drive API queries, single quotes are escaped by doubling them
	result := ""
	for _, c := range s {
		if c == '\'' {
			result += "''"
		} else {
			result += string(c)
		}
	}
	return result
}
