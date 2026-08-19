// Package google provides Google API client initialization and configuration.
package google

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/api/drive/v3"
)

// Drive MIME types used when creating and searching for files.
const (
	// MimeTypeSpreadsheet is the Drive MIME type for a Google Sheets workbook.
	MimeTypeSpreadsheet = "application/vnd.google-apps.spreadsheet"
	// MimeTypeFolder is the Drive MIME type for a folder.
	MimeTypeFolder = "application/vnd.google-apps.folder"
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

	return CreateSpreadsheetInFolder(ctx, folderID, title)
}

// CreateSpreadsheetInFolder creates a new Google Sheets spreadsheet in an explicit folder.
// Unlike CreateSpreadsheet it does not consult GOOGLE_DRIVE_FOLDER_ID, so callers that
// write to a different surface (Family Camp rosters) cannot land in the export folder.
// The folder must be shared with the service account (Editor access).
func CreateSpreadsheetInFolder(ctx context.Context, folderID, title string) (string, error) {
	if !IsEnabled() {
		return "", fmt.Errorf("google sheets is not enabled")
	}
	if strings.TrimSpace(folderID) == "" {
		return "", fmt.Errorf("folder ID is required for creating spreadsheets")
	}

	created, err := createDriveFile(ctx, folderID, title, MimeTypeSpreadsheet)
	if err != nil {
		return "", fmt.Errorf("failed to create spreadsheet in folder: %w", err)
	}

	return created, nil
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

	return FindSpreadsheetInFolder(ctx, folderID, name)
}

// FindSpreadsheetInFolder searches for a spreadsheet by exact name in an explicit folder.
// Returns the spreadsheet ID if found, empty string if not found.
// Returns "", nil when Google Sheets is disabled (graceful degradation).
// Returns error only for API failures, NOT for "not found" scenarios.
func FindSpreadsheetInFolder(ctx context.Context, folderID, name string) (string, error) {
	if !IsEnabled() {
		return "", nil
	}
	if strings.TrimSpace(folderID) == "" {
		return "", fmt.Errorf("folder ID is required for searching spreadsheets")
	}

	id, err := findDriveFile(ctx, folderID, name, MimeTypeSpreadsheet)
	if err != nil {
		return "", fmt.Errorf("failed to search for spreadsheet: %w", err)
	}
	return id, nil
}

// FindOrCreateFolder returns the ID of the folder called name directly beneath parentID,
// creating it if it does not exist. Only folder names the code itself owns should go
// through this -- a configured folder is addressed by ID, so that renaming it in Drive
// surfaces as an error rather than silently creating a duplicate.
//
// Not concurrency-safe: two simultaneous callers can both miss the search and create
// two folders of the same name. Drive permits that. Exports are staff-triggered and
// synchronous, so the window is not worth a lock.
func FindOrCreateFolder(ctx context.Context, parentID, name string) (string, error) {
	if !IsEnabled() {
		return "", fmt.Errorf("google sheets is not enabled")
	}
	if strings.TrimSpace(parentID) == "" {
		// An empty parent would put the folder in the service account's own Drive,
		// where no member of staff can see it.
		return "", fmt.Errorf("parent folder ID is required for creating a folder")
	}
	if strings.TrimSpace(name) == "" {
		return "", fmt.Errorf("folder name is required")
	}

	existing, err := findDriveFile(ctx, parentID, name, MimeTypeFolder)
	if err != nil {
		return "", fmt.Errorf("failed to search for folder %q: %w", name, err)
	}
	if existing != "" {
		return existing, nil
	}

	created, err := createDriveFile(ctx, parentID, name, MimeTypeFolder)
	if err != nil {
		return "", fmt.Errorf("failed to create folder %q: %w", name, err)
	}
	return created, nil
}

// createDriveFile creates a file of the given MIME type inside folderID and returns its ID.
func createDriveFile(ctx context.Context, folderID, name, mimeType string) (string, error) {
	driveClient, err := NewDriveClient(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create drive client: %w", err)
	}
	if driveClient == nil {
		return "", fmt.Errorf("google drive client is nil")
	}

	file := &drive.File{
		Name:     name,
		MimeType: mimeType,
		Parents:  []string{folderID},
	}

	created, err := driveClient.Files.Create(file).
		SupportsAllDrives(true). // Required for Shared Drives
		Context(ctx).
		Do()
	if err != nil {
		return "", err //nolint:wrapcheck // callers add the surface-specific context
	}

	return created.Id, nil
}

// findDriveFile returns the ID of the first non-trashed file of mimeType named exactly
// name directly inside folderID, or "" when there is none. "" is not an error.
func findDriveFile(ctx context.Context, folderID, name, mimeType string) (string, error) {
	driveClient, err := NewDriveClient(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create drive client: %w", err)
	}
	if driveClient == nil {
		return "", fmt.Errorf("google drive client is nil")
	}

	fileList, err := driveClient.Files.List().
		Q(buildFileSearchQuery(folderID, name, mimeType)).
		SupportsAllDrives(true).         // Required for Shared Drives
		IncludeItemsFromAllDrives(true). // Required for Shared Drives
		Fields("files(id, name)").
		Context(ctx).
		Do()
	if err != nil {
		return "", err //nolint:wrapcheck // callers add the surface-specific context
	}

	if len(fileList.Files) == 0 {
		return "", nil // Not found - this is not an error
	}

	// Return the first match (there should only be one with exact name in folder)
	return fileList.Files[0].Id, nil
}

// buildFileSearchQuery builds a Drive API query matching one exactly-named,
// non-trashed file of mimeType directly inside folderID.
func buildFileSearchQuery(folderID, name, mimeType string) string {
	return fmt.Sprintf(
		"name='%s' and '%s' in parents and mimeType='%s' and trashed=false",
		escapeQueryString(name),
		folderID,
		mimeType,
	)
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
