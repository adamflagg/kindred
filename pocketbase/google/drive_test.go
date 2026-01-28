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
