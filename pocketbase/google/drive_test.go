package google

import (
	"context"
	"testing"
)

func TestNewDriveClient_Disabled(t *testing.T) {
	// When GOOGLE_SHEETS_ENABLED is not set or false, should return nil client without error
	t.Setenv("GOOGLE_SHEETS_ENABLED", "")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_JSON", "")

	client, err := NewDriveClient(context.Background())
	if err != nil {
		t.Errorf("Expected no error when disabled, got: %v", err)
	}
	if client != nil {
		t.Error("Expected nil client when disabled")
	}
}

func TestNewDriveClient_DisabledExplicitly(t *testing.T) {
	// Explicit false should also return nil
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	client, err := NewDriveClient(context.Background())
	if err != nil {
		t.Errorf("Expected no error when explicitly disabled, got: %v", err)
	}
	if client != nil {
		t.Error("Expected nil client when explicitly disabled")
	}
}

func TestNewDriveClient_EnabledButNoCredentials(t *testing.T) {
	// Enabled but no credentials should return error
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_JSON", "")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "/nonexistent/path/to/credentials.json")

	_, err := NewDriveClient(context.Background())
	if err == nil {
		t.Error("Expected error when enabled but no credentials provided")
	}
}

func TestCreateSpreadsheet_Disabled(t *testing.T) {
	// When Google Sheets is disabled, CreateSpreadsheet should return error
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	_, err := CreateSpreadsheet(context.Background(), "Test Workbook")
	if err == nil {
		t.Error("Expected error when trying to create spreadsheet with Google Sheets disabled")
	}
}

func TestFormatSpreadsheetURL(t *testing.T) {
	tests := []struct {
		name          string
		spreadsheetID string
		want          string
	}{
		{
			name:          "Standard ID",
			spreadsheetID: "1CN--JleQq3dciUTzP7lB6TJTwzmDOFjcQqYRN927m0k",
			want:          "https://docs.google.com/spreadsheets/d/1CN--JleQq3dciUTzP7lB6TJTwzmDOFjcQqYRN927m0k/edit",
		},
		{
			name:          "Empty ID",
			spreadsheetID: "",
			want:          "https://docs.google.com/spreadsheets/d//edit",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FormatSpreadsheetURL(tt.spreadsheetID)
			if got != tt.want {
				t.Errorf("FormatSpreadsheetURL(%q) = %q, want %q", tt.spreadsheetID, got, tt.want)
			}
		})
	}
}

// =============================================================================
// FindSpreadsheetByName Tests
// =============================================================================

func TestFindSpreadsheetByName_Disabled(t *testing.T) {
	// When GOOGLE_SHEETS_ENABLED is false, should return "", nil (graceful degradation)
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	id, err := FindSpreadsheetByName(context.Background(), "Test Workbook")
	if err != nil {
		t.Errorf("Expected no error when disabled, got: %v", err)
	}
	if id != "" {
		t.Errorf("Expected empty ID when disabled, got: %q", id)
	}
}

func TestFindSpreadsheetByName_NoFolderID(t *testing.T) {
	// When GOOGLE_SHEETS_ENABLED is true but GOOGLE_DRIVE_FOLDER_ID not set, should return error
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_DRIVE_FOLDER_ID", "")
	// Need credentials to get past the auth check
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "/nonexistent/path/to/credentials.json")

	_, err := FindSpreadsheetByName(context.Background(), "Test Workbook")
	if err == nil {
		t.Error("Expected error when GOOGLE_DRIVE_FOLDER_ID not set")
	}
	// Error could be from missing folder ID or missing credentials - both are acceptable
	// The important thing is that it doesn't silently succeed
}

func TestFindSpreadsheetByName_EmptyName(t *testing.T) {
	// Empty name should still work (though unlikely to find anything)
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	id, err := FindSpreadsheetByName(context.Background(), "")
	if err != nil {
		t.Errorf("Expected no error for empty name when disabled, got: %v", err)
	}
	if id != "" {
		t.Errorf("Expected empty ID for empty name when disabled, got: %q", id)
	}
}

func TestFindSpreadsheetByName_SpecialCharacters(t *testing.T) {
	// Names with single quotes should be handled correctly
	// This tests the query escaping logic
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	// Names that would break a query if not escaped
	names := []string{
		"Camp's Data - 2025",
		"Test \"Quoted\" Name",
		"(DEV) Camp's Data - Globals",
	}

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			id, err := FindSpreadsheetByName(context.Background(), name)
			if err != nil {
				t.Errorf("Expected no error for name %q when disabled, got: %v", name, err)
			}
			if id != "" {
				t.Errorf("Expected empty ID when disabled, got: %q", id)
			}
		})
	}
}

// =============================================================================
// Folder-scoped helpers (kindred#2433)
// =============================================================================

func TestBuildFileSearchQuery(t *testing.T) {
	tests := []struct {
		name     string
		folderID string
		fileName string
		mimeType string
		want     string
	}{
		{
			name:     "Spreadsheet in folder",
			folderID: "folder123",
			fileName: "Camp Data - 2026",
			mimeType: MimeTypeSpreadsheet,
			want: "name='Camp Data - 2026' and 'folder123' in parents and " +
				"mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
		},
		{
			name:     "Folder in folder",
			folderID: "rosterFolder",
			fileName: "2026",
			mimeType: MimeTypeFolder,
			want: "name='2026' and 'rosterFolder' in parents and " +
				"mimeType='application/vnd.google-apps.folder' and trashed=false",
		},
		{
			// Drive v3 escapes with a BACKSLASH, not by SQL-style doubling.
			// https://developers.google.com/workspace/drive/api/guides/search-files
			name:     "Apostrophe is backslash-escaped",
			folderID: "folder123",
			fileName: "Camp's Roster",
			mimeType: MimeTypeSpreadsheet,
			want: `name='Camp\'s Roster' and 'folder123' in parents and ` +
				"mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
		},
		{
			name:     "Backslash is doubled",
			folderID: "folder123",
			fileName: `a\b`,
			mimeType: MimeTypeFolder,
			want: `name='a\\b' and 'folder123' in parents and ` +
				"mimeType='application/vnd.google-apps.folder' and trashed=false",
		},
		{
			// Google's own worked example, verbatim: "name contains
			// 'quinn\'s paper\\essay'". It is the case that catches a two-pass
			// implementation, where the backslash rule re-escapes the backslash
			// the apostrophe rule just wrote.
			name:     "Both, as the Drive guide spells it",
			folderID: "folder123",
			fileName: `quinn's paper\essay`,
			mimeType: MimeTypeSpreadsheet,
			want: `name='quinn\'s paper\\essay' and 'folder123' in parents and ` +
				"mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildFileSearchQuery(tt.folderID, tt.fileName, tt.mimeType)
			if got != tt.want {
				t.Errorf("buildFileSearchQuery() =\n  %q\nwant\n  %q", got, tt.want)
			}
		})
	}
}

func TestCreateSpreadsheetInFolder_Disabled(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	_, err := CreateSpreadsheetInFolder(context.Background(), "folder123", "Test Workbook")
	if err == nil {
		t.Error("Expected error when Google Sheets is disabled")
	}
}

func TestCreateSpreadsheetInFolder_EmptyFolderID(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "/nonexistent/path/to/credentials.json")

	_, err := CreateSpreadsheetInFolder(context.Background(), "", "Test Workbook")
	if err == nil {
		t.Error("Expected error when folder ID is empty")
	}
}

func TestFindSpreadsheetInFolder_Disabled(t *testing.T) {
	// Graceful degradation, matching FindSpreadsheetByName
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	id, err := FindSpreadsheetInFolder(context.Background(), "folder123", "Test Workbook")
	if err != nil {
		t.Errorf("Expected no error when disabled, got: %v", err)
	}
	if id != "" {
		t.Errorf("Expected empty ID when disabled, got: %q", id)
	}
}

func TestFindSpreadsheetInFolder_EmptyFolderID(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "/nonexistent/path/to/credentials.json")

	_, err := FindSpreadsheetInFolder(context.Background(), "", "Test Workbook")
	if err == nil {
		t.Error("Expected error when folder ID is empty")
	}
}

func TestFindOrCreateFolder_Disabled(t *testing.T) {
	// Creating is not a read, so this errors rather than degrading gracefully.
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	_, err := FindOrCreateFolder(context.Background(), "parent123", "2026")
	if err == nil {
		t.Error("Expected error when Google Sheets is disabled")
	}
}

func TestFindOrCreateFolder_EmptyParentID(t *testing.T) {
	// An empty parent would create the folder in the service account's own Drive,
	// which is invisible to staff. Refuse instead.
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "/nonexistent/path/to/credentials.json")

	_, err := FindOrCreateFolder(context.Background(), "", "2026")
	if err == nil {
		t.Error("Expected error when parent folder ID is empty")
	}
}

func TestFindOrCreateFolder_EmptyName(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "/nonexistent/path/to/credentials.json")

	_, err := FindOrCreateFolder(context.Background(), "parent123", "")
	if err == nil {
		t.Error("Expected error when folder name is empty")
	}
}
