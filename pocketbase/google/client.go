// Package google provides Google API client initialization for Kindred
package google

import (
	"context"
	"fmt"
	"os"
	"strings"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

const (
	envEnabled     = "GOOGLE_SHEETS_ENABLED"
	envKeyFile     = "GOOGLE_SERVICE_ACCOUNT_KEY_FILE"
	envSpreadsheet = "GOOGLE_SHEETS_SPREADSHEET_ID"
	defaultKeyFile = "../google_sheets.json" // repo root, alongside .env
)

// IsEnabled returns true if Google Sheets sync is enabled via environment variable
func IsEnabled() bool {
	val := strings.ToLower(strings.TrimSpace(os.Getenv(envEnabled)))
	return val == "true" || val == "1"
}

// GetSpreadsheetID returns the configured Google Sheets spreadsheet ID
func GetSpreadsheetID() string {
	return strings.TrimSpace(os.Getenv(envSpreadsheet))
}

// NewSheetsClient creates a new Google Sheets API client using service account credentials.
// Returns nil, nil if Google Sheets sync is disabled (graceful degradation).
// Credentials are provided via GOOGLE_SERVICE_ACCOUNT_KEY_JSON environment variable.
func NewSheetsClient(ctx context.Context) (*sheets.Service, error) {
	// Check if enabled
	if !IsEnabled() {
		return nil, nil
	}

	// Get credentials
	credJSON, err := getCredentialsJSON()
	if err != nil {
		return nil, fmt.Errorf("failed to get credentials: %w", err)
	}

	// Parse credentials and create JWT config
	config, err := google.JWTConfigFromJSON(credJSON, sheets.SpreadsheetsScope)
	if err != nil {
		return nil, fmt.Errorf("failed to parse credentials: %w", err)
	}

	// Create HTTP client with credentials
	client := config.Client(ctx)

	// Create Sheets service
	srv, err := sheets.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("failed to create sheets service: %w", err)
	}

	return srv, nil
}

// getCredentialsJSON retrieves the service account credentials JSON.
// Reads from file specified by GOOGLE_SERVICE_ACCOUNT_KEY_FILE env var,
// defaulting to "google_sheets.json" in the working directory.
func getCredentialsJSON() ([]byte, error) {
	keyFile := strings.TrimSpace(os.Getenv(envKeyFile))
	if keyFile == "" {
		keyFile = defaultKeyFile
	}

	data, err := os.ReadFile(keyFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read credentials file %s: %w", keyFile, err)
	}
	return data, nil
}
