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
	defaultKeyFile = "/config/google_sheets.json" // Docker: /config volume, Dev: set via env
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

// getAuthenticatedHTTPClient creates an authenticated HTTP client for the given scope.
// Returns the zero value and nil error if Google Sheets sync is disabled.
func getAuthenticatedHTTPClient(ctx context.Context, scope string) (option.ClientOption, bool, error) {
	if !IsEnabled() {
		return nil, false, nil
	}

	credJSON, err := getCredentialsJSON()
	if err != nil {
		return nil, false, fmt.Errorf("failed to get credentials: %w", err)
	}

	config, err := google.JWTConfigFromJSON(credJSON, scope)
	if err != nil {
		return nil, false, fmt.Errorf("failed to parse credentials: %w", err)
	}

	client := config.Client(ctx)
	return option.WithHTTPClient(client), true, nil
}

// NewSheetsClient creates a new Google Sheets API client using service account credentials.
// Returns nil, nil if Google Sheets sync is disabled (graceful degradation).
// Credentials are provided via GOOGLE_SERVICE_ACCOUNT_KEY_FILE environment variable.
func NewSheetsClient(ctx context.Context) (*sheets.Service, error) {
	opt, enabled, err := getAuthenticatedHTTPClient(ctx, sheets.SpreadsheetsScope)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, nil
	}

	srv, err := sheets.NewService(ctx, opt)
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

	data, err := os.ReadFile(keyFile) //nolint:gosec // G304: path from trusted env var or hardcoded default
	if err != nil {
		return nil, fmt.Errorf("failed to read credentials file %s: %w", keyFile, err)
	}
	return data, nil
}
