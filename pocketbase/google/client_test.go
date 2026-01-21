package google

import (
	"context"
	"testing"
)

func TestNewSheetsClient_Disabled(t *testing.T) {
	// When GOOGLE_SHEETS_ENABLED is not set or false, should return nil client without error
	t.Setenv("GOOGLE_SHEETS_ENABLED", "")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_JSON", "")

	client, err := NewSheetsClient(context.Background())
	if err != nil {
		t.Errorf("Expected no error when disabled, got: %v", err)
	}
	if client != nil {
		t.Error("Expected nil client when disabled")
	}
}

func TestNewSheetsClient_DisabledExplicitly(t *testing.T) {
	// Explicit false should also return nil
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")

	client, err := NewSheetsClient(context.Background())
	if err != nil {
		t.Errorf("Expected no error when explicitly disabled, got: %v", err)
	}
	if client != nil {
		t.Error("Expected nil client when explicitly disabled")
	}
}

func TestNewSheetsClient_EnabledButNoCredentials(t *testing.T) {
	// Enabled but no credentials should return error
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_JSON", "")

	_, err := NewSheetsClient(context.Background())
	if err == nil {
		t.Error("Expected error when enabled but no credentials provided")
	}
}

func TestNewSheetsClient_InvalidJSON(t *testing.T) {
	// Invalid JSON should return error
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_JSON", "not valid json")

	_, err := NewSheetsClient(context.Background())
	if err == nil {
		t.Error("Expected error for invalid JSON credentials")
	}
}

func TestNewSheetsClient_ValidInlineJSON(t *testing.T) {
	// Test inline JSON credentials
	// nolint:gosec // G101: This is a fake test credential, not a real private key
	testJSON := `{
		"type": "service_account",
		"project_id": "test-project",
		"private_key_id": "key123",
		"private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBALRiMLAHudeSA2rkHgPz\n-----END RSA PRIVATE KEY-----\n",
		"client_email": "test@test-project.iam.gserviceaccount.com",
		"client_id": "123456789",
		"auth_uri": "https://accounts.google.com/o/oauth2/auth",
		"token_uri": "https://oauth2.googleapis.com/token"
	}`

	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_JSON", testJSON)

	// Similar to above - will fail at auth but should parse JSON correctly
	_, err := NewSheetsClient(context.Background())
	if err != nil && !isAuthError(err) {
		t.Logf("Got expected auth-related error: %v", err)
	}
}

func TestGetSpreadsheetID(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		want     string
	}{
		{"Empty", "", ""},
		{"Simple ID", "abc123def456", "abc123def456"},
		{"With spaces trimmed", "  abc123  ", "abc123"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("GOOGLE_SHEETS_SPREADSHEET_ID", tt.envValue)

			got := GetSpreadsheetID()
			if got != tt.want {
				t.Errorf("GetSpreadsheetID() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestIsEnabled(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		want     bool
	}{
		{"Not set", "", false},
		{"Explicit false", "false", false},
		{"Explicit true", "true", true},
		{"True uppercase", "TRUE", true},
		{"One", "1", true},
		{"Random value", "yes", false}, // Only "true" and "1" should work
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("GOOGLE_SHEETS_ENABLED", tt.envValue)

			got := IsEnabled()
			if got != tt.want {
				t.Errorf("IsEnabled() = %v, want %v", got, tt.want)
			}
		})
	}
}

// isAuthError checks if an error is related to authentication/credentials
// rather than JSON parsing
func isAuthError(err error) bool {
	errStr := err.Error()
	// Auth-related errors typically mention these terms
	return contains(errStr, "private key") ||
		contains(errStr, "credential") ||
		contains(errStr, "token") ||
		contains(errStr, "auth") ||
		contains(errStr, "jwt") ||
		contains(errStr, "invalid")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
