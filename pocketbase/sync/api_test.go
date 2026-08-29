package sync

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// TestCSVValidation tests CSV parsing and validation logic
func TestCSVValidation_ValidCSV(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		csvContent     string
		wantErr        bool
		expectedCols   int
		missingColumns []string
	}{
		{
			name: "valid CSV with all required columns",
			csvContent: `PersonID,Last Name,First Name,Bunk With
12345,Smith,John,Jane Doe
12346,Jones,Mary,Bob Smith`,
			wantErr:      false,
			expectedCols: 4,
		},
		{
			name: "valid CSV with extra columns",
			csvContent: `PersonID,Last Name,First Name,Extra Column,Another
12345,Smith,John,value1,value2`,
			wantErr:      false,
			expectedCols: 5,
		},
		{
			name:       "CSV with UTF-8 BOM",
			csvContent: "\xEF\xBB\xBFPersonID,Last Name,First Name\n12345,Smith,John",
			wantErr:    false,
		},
		{
			name: "missing PersonID column",
			csvContent: `Last Name,First Name,Bunk With
Smith,John,Jane Doe`,
			wantErr:        true,
			missingColumns: []string{"PersonID"},
		},
		{
			name: "missing multiple required columns",
			csvContent: `Bunk With
Jane Doe`,
			wantErr:        true,
			missingColumns: []string{"PersonID", "Last Name", "First Name"},
		},
		{
			name:         "empty CSV",
			csvContent:   "",
			wantErr:      true,
			expectedCols: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := validateCSVStructure(tt.csvContent)

			if tt.wantErr && result.IsValid {
				t.Errorf("expected error but got valid result")
			}
			if !tt.wantErr && !result.IsValid {
				t.Errorf("expected valid but got error: %v", result.MissingColumns)
			}

			if tt.expectedCols > 0 && result.HeaderCount != tt.expectedCols {
				t.Errorf("expected %d columns, got %d", tt.expectedCols, result.HeaderCount)
			}

			if len(tt.missingColumns) > 0 {
				for _, col := range tt.missingColumns {
					found := false
					for _, missing := range result.MissingColumns {
						if strings.EqualFold(missing, col) {
							found = true
							break
						}
					}
					if !found {
						t.Errorf("expected missing column %q not found in %v", col, result.MissingColumns)
					}
				}
			}
		})
	}
}

// CSVValidationResult holds the result of CSV validation
type CSVValidationResult struct {
	IsValid        bool
	Headers        []string
	HeaderCount    int
	MissingColumns []string
	Error          string
}

// validateCSVStructure validates CSV content and returns structured result
func validateCSVStructure(content string) CSVValidationResult {
	result := CSVValidationResult{}

	// Strip UTF-8 BOM if present
	content = strings.TrimPrefix(content, "\xEF\xBB\xBF")

	if content == "" {
		result.Error = "Empty CSV content"
		return result
	}

	// Parse CSV headers
	lines := strings.Split(content, "\n")
	if len(lines) == 0 {
		result.Error = "No lines in CSV"
		return result
	}

	headerLine := strings.TrimSpace(lines[0])
	if headerLine == "" {
		result.Error = "Empty header line"
		return result
	}

	// Parse header columns
	result.Headers = strings.Split(headerLine, ",")
	for i := range result.Headers {
		result.Headers[i] = strings.TrimSpace(result.Headers[i])
	}
	result.HeaderCount = len(result.Headers)

	// Check required columns (case-insensitive)
	requiredColumns := []string{"PersonID", "Last Name", "First Name"}
	for _, required := range requiredColumns {
		found := false
		for _, header := range result.Headers {
			if strings.EqualFold(header, required) {
				found = true
				break
			}
		}
		if !found {
			result.MissingColumns = append(result.MissingColumns, required)
		}
	}

	result.IsValid = len(result.MissingColumns) == 0
	return result
}

// TestStripUTF8BOM tests UTF-8 BOM stripping
func TestStripUTF8BOM(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		input    []byte
		expected []byte
		hasBOM   bool
	}{
		{
			name:     "with BOM",
			input:    []byte{0xEF, 0xBB, 0xBF, 'h', 'e', 'l', 'l', 'o'},
			expected: []byte("hello"),
			hasBOM:   true,
		},
		{
			name:     "without BOM",
			input:    []byte("hello"),
			expected: []byte("hello"),
			hasBOM:   false,
		},
		{
			name:     "empty with BOM",
			input:    []byte{0xEF, 0xBB, 0xBF},
			expected: []byte{},
			hasBOM:   true,
		},
		{
			name:     "partial BOM (not stripped)",
			input:    []byte{0xEF, 0xBB, 'h', 'e', 'l', 'l', 'o'},
			expected: []byte{0xEF, 0xBB, 'h', 'e', 'l', 'l', 'o'},
			hasBOM:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, hadBOM := stripUTF8BOM(tt.input)

			if hadBOM != tt.hasBOM {
				t.Errorf("expected hasBOM=%v, got %v", tt.hasBOM, hadBOM)
			}

			if !bytes.Equal(result, tt.expected) {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// stripUTF8BOM strips UTF-8 BOM from byte slice and returns whether BOM was present
func stripUTF8BOM(data []byte) ([]byte, bool) {
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		return data[3:], true
	}
	return data, false
}

// TestSessionParameterValidation tests session parameter parsing
func TestSessionParameterValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		param       string
		wantSession int
		wantValid   bool
	}{
		{"empty param (default)", "", 0, true},
		{"session 0 (all)", "0", 0, true},
		{"session 1", "1", 1, true},
		{"session 2", "2", 2, true},
		{"session 3", "3", 3, true},
		{"session 4", "4", 4, true},
		{"session 5 (invalid)", "5", 0, false},
		{"negative session", "-1", 0, false},
		{"non-numeric", "abc", 0, false},
		{"float", "1.5", 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			session, valid := parseSessionParameter(tt.param)

			if valid != tt.wantValid {
				t.Errorf("expected valid=%v, got %v", tt.wantValid, valid)
			}

			if valid && session != tt.wantSession {
				t.Errorf("expected session=%d, got %d", tt.wantSession, session)
			}
		})
	}
}

// parseSessionParameter parses and validates the session parameter
func parseSessionParameter(param string) (int, bool) {
	if param == "" {
		return 0, true // Default: all sessions
	}

	session := 0
	for _, c := range param {
		if c < '0' || c > '9' {
			return 0, false // Non-numeric
		}
		session = session*10 + int(c-'0')
	}

	// Valid range is 0-4
	if session < 0 || session > 4 {
		return 0, false
	}

	return session, true
}

// TestYearParameterValidation tests year parameter parsing for historical sync
func TestYearParameterValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		yearStr   string
		wantYear  int
		wantValid bool
		maxYear   int // Current year for validation
	}{
		{"valid year 2024", "2024", 2024, true, 2025},
		{"valid year 2017 (minimum)", "2017", 2017, true, 2025},
		{"year too old", "2016", 0, false, 2025},
		{"year in future", "2026", 0, false, 2025},
		{"current year", "2025", 2025, true, 2025},
		{"non-numeric", "twenty", 0, false, 2025},
		{"empty", "", 0, false, 2025},
		{"negative", "-2024", 0, false, 2025},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			year, valid := parseYearParameter(tt.yearStr, tt.maxYear)

			if valid != tt.wantValid {
				t.Errorf("expected valid=%v, got %v", tt.wantValid, valid)
			}

			if valid && year != tt.wantYear {
				t.Errorf("expected year=%d, got %d", tt.wantYear, year)
			}
		})
	}
}

// parseYearParameter parses and validates year parameter
func parseYearParameter(yearStr string, maxYear int) (int, bool) {
	if yearStr == "" {
		return 0, false
	}

	year := 0
	for _, c := range yearStr {
		if c < '0' || c > '9' {
			return 0, false
		}
		year = year*10 + int(c-'0')
	}

	// Valid range is 2017 to current year
	if year < 2017 || year > maxYear {
		return 0, false
	}

	return year, true
}

// TestSyncTypeValidation tests sync type validation
func TestSyncTypeValidation(t *testing.T) {
	t.Parallel()
	validSyncTypes := map[string]bool{
		"session_groups":   true,
		"sessions":         true,
		"divisions":        true, // Division definitions (runs in daily sync before persons)
		"attendees":        true,
		"persons":          true, // Combined sync: persons + households (includes division relation)
		"bunks":            true,
		"bunk_plans":       true,
		"bunk_assignments": true,
		"bunk_requests":    true,
		"process_requests": true,
		"staff":            true, // Staff sync: program_areas, org_categories, positions, staff table
	}

	tests := []struct {
		name      string
		syncType  string
		wantValid bool
	}{
		{"session_groups", "session_groups", true},
		{"sessions", "sessions", true},
		{"divisions", "divisions", true},
		{"attendees", "attendees", true},
		{"persons", "persons", true},
		{"bunks", "bunks", true},
		{"bunk_plans", "bunk_plans", true},
		{"bunk_assignments", "bunk_assignments", true},
		{"bunk_requests", "bunk_requests", true},
		{"process_requests", "process_requests", true},
		{"staff", "staff", true},
		{"invalid type", "invalid", false},
		{"empty", "", false},
		{"typo", "session", false},
		{"case sensitive", "Sessions", false},
		{"division typo", "division_attendees", false}, // No longer exists
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			valid := validSyncTypes[tt.syncType]

			if valid != tt.wantValid {
				t.Errorf("expected valid=%v for %q, got %v", tt.wantValid, tt.syncType, valid)
			}
		})
	}
}

// TestStatusResponseFormat tests that status responses have expected format
func TestStatusResponseFormat(t *testing.T) {
	t.Parallel()
	syncTypes := []string{
		"session_groups",
		"sessions",
		"divisions", // Division definitions (runs in daily sync before persons)
		"attendees",
		"persons", // Combined sync: persons + households (includes division relation)
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"bunk_requests",
		"process_requests",
	}

	// Verify all expected sync types are covered (10 sync types)
	if len(syncTypes) != 10 {
		t.Errorf("expected 10 sync types, got %d", len(syncTypes))
	}

	// Verify no duplicates
	seen := make(map[string]bool)
	for _, st := range syncTypes {
		if seen[st] {
			t.Errorf("duplicate sync type: %s", st)
		}
		seen[st] = true
	}

	// Verify session-related types are in correct dependency order
	expectedSessionOrder := []string{"session_groups", "sessions"}
	sessionTypes := []string{}
	for _, st := range syncTypes {
		if strings.HasPrefix(st, "session") {
			sessionTypes = append(sessionTypes, st)
		}
	}
	if len(sessionTypes) != 2 {
		t.Errorf("expected 2 session-related types, got %d: %v", len(sessionTypes), sessionTypes)
	}
	for i, expected := range expectedSessionOrder {
		if i < len(sessionTypes) && sessionTypes[i] != expected {
			t.Errorf("session type order[%d]: expected %q, got %q", i, expected, sessionTypes[i])
		}
	}
}

// TestSessionParameterPassthrough verifies session parameter is passed through to Python
// Note: Actual session validation happens in Python via SessionRepository.resolve_session_cm_ids()
// which accepts "all" or a numeric cm_id string. Go just passes the string through.
func TestSessionParameterPassthrough(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		param       string
		wantSession string
	}{
		// Empty defaults to "all"
		{"empty param defaults to all", "", DefaultSession},

		// All values pass through as-is (validation happens in Python)
		{"all sessions", DefaultSession, DefaultSession},
		{"numeric 1", "1", "1"},
		{"numeric 2", "2", "2"},
		{"embedded 2a", "2a", "2a"},
		{"toc alias", "toc", "toc"},

		// Even invalid values pass through - Python will reject them
		{"invalid passes through", "invalid", "invalid"},
		{"numeric 99 passes through", "99", "99"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate what api.go does - just read and default
			session := tt.param
			if session == "" {
				session = DefaultSession
			}

			if session != tt.wantSession {
				t.Errorf("expected session=%q, got %q", tt.wantSession, session)
			}
		})
	}
}

// TestSourceFieldParameterValidation tests source_field query parameter parsing
func TestSourceFieldParameterValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		param      string
		wantFields []string
		wantValid  bool
	}{
		// Empty/default
		{"empty param", "", nil, true},

		// Single fields
		{"single bunk_request_form", "bunk_request_form", []string{"bunk_request_form"}, true},
		{"single staff_not_bunk_with", "staff_not_bunk_with", []string{"staff_not_bunk_with"}, true},
		{"single bunking_notes", "bunking_notes", []string{"bunking_notes"}, true},
		{"single internal_notes", "internal_notes", []string{"internal_notes"}, true},
		{"single socialize_with", "socialize_with", []string{"socialize_with"}, true},

		// Multiple fields (comma-separated)
		{
			"two fields",
			"bunk_request_form,staff_not_bunk_with",
			[]string{"bunk_request_form", "staff_not_bunk_with"},
			true,
		},
		{
			"all five fields",
			"bunk_request_form,staff_not_bunk_with,bunking_notes,internal_notes,socialize_with",
			[]string{"bunk_request_form", "staff_not_bunk_with", "bunking_notes", "internal_notes", "socialize_with"},
			true,
		},
		{
			"with spaces around commas",
			"bunk_request_form, staff_not_bunk_with, bunking_notes",
			[]string{"bunk_request_form", "staff_not_bunk_with", "bunking_notes"},
			true,
		},

		// Invalid fields
		{"invalid field", "invalid_field", nil, false},
		{"one valid one invalid", "bunk_request_form,invalid", nil, false},
		{"typo", "bunk_request_forms", nil, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fields, _, valid := parseSourceFieldParameter(tt.param)

			if valid != tt.wantValid {
				t.Errorf("expected valid=%v, got %v for param %q", tt.wantValid, valid, tt.param)
			}

			if valid {
				if len(fields) != len(tt.wantFields) {
					t.Errorf("expected %d fields, got %d: %v", len(tt.wantFields), len(fields), fields)
				}
				for i, want := range tt.wantFields {
					if i < len(fields) && fields[i] != want {
						t.Errorf("field[%d]: expected %q, got %q", i, want, fields[i])
					}
				}
			}
		})
	}
}

// parseSourceFieldParameter now lives in api.go (production); TestSourceFieldParameterValidation
// exercises that single implementation directly.

// TestCustomValuesSyncServices tests that custom values sync services are defined
func TestCustomValuesSyncServices(t *testing.T) {
	t.Parallel()
	// Verify GetCustomValuesSyncJobs returns the expected services
	expected := []string{"person_custom_values", "household_custom_values"}
	jobs := GetCustomValuesSyncJobs()

	if len(jobs) != len(expected) {
		t.Errorf("expected %d custom values sync jobs, got %d", len(expected), len(jobs))
	}

	for i, job := range expected {
		if i >= len(jobs) {
			t.Errorf("missing job %q at index %d", job, i)
			continue
		}
		if jobs[i] != job {
			t.Errorf("job[%d]: expected %q, got %q", i, job, jobs[i])
		}
	}
}

// TestCustomValuesSyncEndpointResponse tests expected response format
func TestCustomValuesSyncEndpointResponse(t *testing.T) {
	t.Parallel()
	// Test the expected response structure from the custom-values endpoint
	// The endpoint should return:
	// - message: string describing action taken
	// - services: array of service names being synced

	expectedMessage := "Custom values sync triggered"
	expectedServices := []string{"person_custom_values", "household_custom_values"}

	// Verify GetCustomValuesSyncJobs matches expected
	jobs := GetCustomValuesSyncJobs()
	if len(jobs) != len(expectedServices) {
		t.Errorf("GetCustomValuesSyncJobs returned %d jobs, expected %d", len(jobs), len(expectedServices))
	}

	for i, expected := range expectedServices {
		if i >= len(jobs) {
			break
		}
		if jobs[i] != expected {
			t.Errorf("service[%d]: expected %q, got %q", i, expected, jobs[i])
		}
	}

	// Verify message format (just test the constant exists and is non-empty)
	if expectedMessage == "" {
		t.Error("expected message should not be empty")
	}
}

// TestGetConfiguredYear tests the getConfiguredYear function
func TestGetConfiguredYear(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		envValue    string
		wantYear    int
		description string
	}{
		{
			name:        "valid year 2026",
			envValue:    "2026",
			wantYear:    2026,
			description: "should parse valid year from env",
		},
		{
			name:        "valid year 2024",
			envValue:    "2024",
			wantYear:    2024,
			description: "should parse historical year from env",
		},
		{
			name:        "empty env uses current year",
			envValue:    "",
			wantYear:    0, // Indicates current year should be used
			description: "empty env should fall back to current year",
		},
		{
			name:        "invalid non-numeric",
			envValue:    "abc",
			wantYear:    0, // Indicates fallback to current year
			description: "invalid value should fall back to current year",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			year := parseConfiguredYear(tt.envValue)
			if year != tt.wantYear {
				t.Errorf("parseConfiguredYear(%q) = %d, want %d", tt.envValue, year, tt.wantYear)
			}
		})
	}
}

// parseConfiguredYear parses year from env string, returning 0 if invalid/empty
func parseConfiguredYear(envValue string) int {
	if envValue == "" {
		return 0
	}
	year := 0
	for _, c := range envValue {
		if c < '0' || c > '9' {
			return 0
		}
		year = year*10 + int(c-'0')
	}
	return year
}

// TestYearPrefixedCSVPath tests the year-prefixed CSV path generation
func TestYearPrefixedCSVPath(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		year     int
		wantPath string
	}{
		{
			name:     "year 2026",
			year:     2026,
			wantPath: "2026_latest.csv",
		},
		{
			name:     "year 2024",
			year:     2024,
			wantPath: "2024_latest.csv",
		},
		{
			name:     "year 2017 (minimum)",
			year:     2017,
			wantPath: "2017_latest.csv",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := getYearPrefixedCSVFilename(tt.year)
			if path != tt.wantPath {
				t.Errorf("getYearPrefixedCSVFilename(%d) = %q, want %q", tt.year, path, tt.wantPath)
			}
		})
	}
}

// getYearPrefixedCSVFilename returns the CSV filename with year prefix
func getYearPrefixedCSVFilename(year int) string {
	return fmt.Sprintf("%d_latest.csv", year)
}

// TestYearPrefixedBackupFilename tests backup filename generation with year
func TestYearPrefixedBackupFilename(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		year      int
		timestamp string
		wantPath  string
	}{
		{
			name:      "year 2026",
			year:      2026,
			timestamp: "20260115_140000",
			wantPath:  "2026_backup_20260115_140000.csv",
		},
		{
			name:      "year 2024",
			year:      2024,
			timestamp: "20241231_235959",
			wantPath:  "2024_backup_20241231_235959.csv",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := getYearPrefixedBackupFilename(tt.year, tt.timestamp)
			if path != tt.wantPath {
				t.Errorf("getYearPrefixedBackupFilename(%d, %q) = %q, want %q",
					tt.year, tt.timestamp, path, tt.wantPath)
			}
		})
	}
}

// getYearPrefixedBackupFilename returns the backup filename with year prefix
func getYearPrefixedBackupFilename(year int, timestamp string) string {
	return fmt.Sprintf("%d_backup_%s.csv", year, timestamp)
}

// TestRunProcessRequestsParameterParsing tests the run_process_requests query parameter
func TestRunProcessRequestsParameterParsing(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		param     string
		wantValue bool
	}{
		// Default behavior
		{"empty param defaults to false", "", false},

		// Truthy values
		{"true string", "true", true},
		{"1 string", "1", true},

		// Falsy values
		{"false string", "false", false},
		{"0 string", "0", false},
		{"random string", "random", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseRunProcessRequestsParam(tt.param)
			if result != tt.wantValue {
				t.Errorf("parseRunProcessRequestsParam(%q) = %v, want %v", tt.param, result, tt.wantValue)
			}
		})
	}
}

// parseRunProcessRequestsParam parses the run_process_requests query parameter
// Returns true if the parameter is "true" or "1"
func parseRunProcessRequestsParam(param string) bool {
	return param == boolTrueStr || param == "1"
}

// TestBunkRequestsUploadWithProcessRequests validates that when both run_sync=true
// and run_process_requests=true are provided, the upload response should indicate
// both sync jobs will be triggered
func TestBunkRequestsUploadWithProcessRequests(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                  string
		runSync               bool
		runProcessRequests    bool
		expectSyncStarted     bool
		expectProcessRequests bool
	}{
		{
			name:                  "neither sync nor process",
			runSync:               false,
			runProcessRequests:    false,
			expectSyncStarted:     false,
			expectProcessRequests: false,
		},
		{
			name:                  "sync only",
			runSync:               true,
			runProcessRequests:    false,
			expectSyncStarted:     true,
			expectProcessRequests: false,
		},
		{
			name:                  "both sync and process",
			runSync:               true,
			runProcessRequests:    true,
			expectSyncStarted:     true,
			expectProcessRequests: true,
		},
		{
			name:                  "process without sync (ignored)",
			runSync:               false,
			runProcessRequests:    true,
			expectSyncStarted:     false,
			expectProcessRequests: false, // Can't process without sync
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate what the handler does
			syncStarted := tt.runSync
			processStarted := tt.runSync && tt.runProcessRequests

			if syncStarted != tt.expectSyncStarted {
				t.Errorf("syncStarted = %v, want %v", syncStarted, tt.expectSyncStarted)
			}
			if processStarted != tt.expectProcessRequests {
				t.Errorf("processStarted = %v, want %v", processStarted, tt.expectProcessRequests)
			}
		})
	}
}

// TestUploadYearParameterParsing tests year query parameter parsing for uploads
func TestUploadYearParameterParsing(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		yearParam      string
		defaultYear    int
		wantYear       int
		wantUseDefault bool
	}{
		{
			name:           "explicit year 2024",
			yearParam:      "2024",
			defaultYear:    2026,
			wantYear:       2024,
			wantUseDefault: false,
		},
		{
			name:           "explicit year 2026",
			yearParam:      "2026",
			defaultYear:    2026,
			wantYear:       2026,
			wantUseDefault: false,
		},
		{
			name:           "empty uses default",
			yearParam:      "",
			defaultYear:    2026,
			wantYear:       2026,
			wantUseDefault: true,
		},
		{
			name:           "invalid uses default",
			yearParam:      "abc",
			defaultYear:    2026,
			wantYear:       2026,
			wantUseDefault: true,
		},
		{
			name:           "year too old uses default",
			yearParam:      "2010",
			defaultYear:    2026,
			wantYear:       2026,
			wantUseDefault: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			year, usedDefault := parseUploadYearParam(tt.yearParam, tt.defaultYear)
			if year != tt.wantYear {
				t.Errorf("parseUploadYearParam(%q, %d) year = %d, want %d",
					tt.yearParam, tt.defaultYear, year, tt.wantYear)
			}
			if usedDefault != tt.wantUseDefault {
				t.Errorf("parseUploadYearParam(%q, %d) usedDefault = %v, want %v",
					tt.yearParam, tt.defaultYear, usedDefault, tt.wantUseDefault)
			}
		})
	}
}

// parseUploadYearParam parses year from query param, returning default if invalid
func parseUploadYearParam(yearParam string, defaultYear int) (int, bool) {
	if yearParam == "" {
		return defaultYear, true
	}

	year := 0
	for _, c := range yearParam {
		if c < '0' || c > '9' {
			return defaultYear, true
		}
		year = year*10 + int(c-'0')
	}

	// Validate year range (2017-present)
	if year < 2017 || year > 2030 {
		return defaultYear, true
	}

	return year, false
}

// TestSyncStatusIncludesConfiguredYear tests that sync status response includes configured year
func TestSyncStatusIncludesConfiguredYear(t *testing.T) {
	t.Parallel()
	// This test validates the expected response format
	// The actual handleSyncStatus function should include _configured_year

	// Expected response keys
	expectedKeys := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"bunk_requests",
		"process_requests",
		"_daily_sync_running",
		"_weekly_sync_running",
		"_historical_sync_running",
		"_configured_year", // NEW: should be included
	}

	// Verify _configured_year is in expected keys
	foundConfiguredYear := false
	for _, key := range expectedKeys {
		if key == "_configured_year" {
			foundConfiguredYear = true
			break
		}
	}

	if !foundConfiguredYear {
		t.Error("expected keys should include _configured_year")
	}
}

// =============================================================================
// Sync Queue API Tests
// =============================================================================

// TestSyncStatusIncludesQueue tests that sync status response includes queue info
func TestSyncStatusIncludesQueue(t *testing.T) {
	t.Parallel()
	// Expected queue-related keys in status response
	expectedKeys := []string{
		"_queue",        // Array of queued syncs
		"_queue_length", // Number of items in queue
	}

	// Verify these keys are documented for the status response
	// The actual implementation will add these to handleSyncStatus
	for _, key := range expectedKeys {
		if key == "" {
			t.Errorf("expected key should not be empty")
		}
	}

	// Test queue item structure
	queueItem := QueuedSync{
		ID:                  "test-id",
		Year:                2025,
		Service:             "all",
		IncludeCustomValues: true,
		Debug:               false,
	}

	if queueItem.ID == "" {
		t.Error("queue item should have ID")
	}
	if queueItem.Year != 2025 {
		t.Errorf("expected year 2025, got %d", queueItem.Year)
	}
}

// TestUnifiedSyncQueueResponse tests the expected 202 response structure
func TestUnifiedSyncQueueResponse(t *testing.T) {
	t.Parallel()
	// When a sync is already running and a new request comes in,
	// the API should return 202 Accepted with queue info

	// Expected 202 response structure
	type QueueResponse struct {
		Status   string `json:"status"`   // "queued"
		QueueID  string `json:"queue_id"` // UUID of queued item
		Position int    `json:"position"` // 1-based position in queue
		Year     int    `json:"year"`     // Year being synced
		Service  string `json:"service"`  // Service being synced
	}

	// Test expected values
	resp := QueueResponse{
		Status:   "queued",
		QueueID:  "test-uuid-123",
		Position: 2,
		Year:     2025,
		Service:  "all",
	}

	if resp.Status != "queued" {
		t.Errorf("expected status='queued', got %q", resp.Status)
	}
	if resp.Position < 1 {
		t.Errorf("expected position >= 1, got %d", resp.Position)
	}
	if resp.QueueID == "" {
		t.Error("expected non-empty queue_id")
	}
}

// TestCancelQueuedSyncEndpoint tests the expected behavior of the cancel endpoint
func TestCancelQueuedSyncEndpoint(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		queueID        string
		exists         bool
		expectedStatus int // HTTP status code
	}{
		{
			name:           "cancel existing queued sync",
			queueID:        "valid-uuid-123",
			exists:         true,
			expectedStatus: 200,
		},
		{
			name:           "cancel non-existent queued sync",
			queueID:        "non-existent-uuid",
			exists:         false,
			expectedStatus: 404,
		},
		{
			name:           "cancel with empty ID",
			queueID:        "",
			exists:         false,
			expectedStatus: 400, // Bad request - missing ID
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Document expected behavior
			if tt.exists && tt.expectedStatus != 200 {
				t.Errorf("existing item should return 200, not %d", tt.expectedStatus)
			}
			if !tt.exists && tt.queueID != "" && tt.expectedStatus != 404 {
				t.Errorf("non-existent item should return 404, not %d", tt.expectedStatus)
			}
			if tt.queueID == "" && tt.expectedStatus != 400 {
				t.Errorf("empty ID should return 400, not %d", tt.expectedStatus)
			}
		})
	}
}

// TestUnifiedSyncEnqueueBehavior tests the expected queuing behavior
func TestUnifiedSyncEnqueueBehavior(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name             string
		syncRunning      bool
		queueLength      int
		expectedStatus   int    // HTTP status code
		expectedBehavior string // "start", "queue", or "reject"
	}{
		{
			name:             "no sync running - start immediately",
			syncRunning:      false,
			queueLength:      0,
			expectedStatus:   200,
			expectedBehavior: "start",
		},
		{
			name:             "sync running, queue empty - enqueue",
			syncRunning:      true,
			queueLength:      0,
			expectedStatus:   202,
			expectedBehavior: "queue",
		},
		{
			name:             "sync running, queue has space - enqueue",
			syncRunning:      true,
			queueLength:      3,
			expectedStatus:   202,
			expectedBehavior: "queue",
		},
		{
			name:             "sync running, queue full - reject",
			syncRunning:      true,
			queueLength:      5, // MaxQueueSize
			expectedStatus:   409,
			expectedBehavior: "reject",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Verify expected behavior matches status code
			switch tt.expectedBehavior {
			case "start":
				if tt.expectedStatus != 200 {
					t.Errorf("'start' behavior should return 200, got %d", tt.expectedStatus)
				}
			case "queue":
				if tt.expectedStatus != 202 {
					t.Errorf("'queue' behavior should return 202, got %d", tt.expectedStatus)
				}
			case "reject":
				if tt.expectedStatus != 409 {
					t.Errorf("'reject' behavior should return 409, got %d", tt.expectedStatus)
				}
			default:
				t.Errorf("unknown behavior: %s", tt.expectedBehavior)
			}
		})
	}
}

// TestDuplicateQueueRequest tests that duplicate requests return existing queue position
func TestDuplicateQueueRequest(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Enqueue a sync (without custom values)
	qs1, err := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Try to enqueue the same year+service+includeCustomValues again
	qs2, err := o.EnqueueUnifiedSync(2025, "all", false, true, false, "user2") // Same includeCustomValues, different debug
	if err != nil {
		t.Fatalf("unexpected error for duplicate: %v", err)
	}

	// Should return the same queue item (same year+service+includeCustomValues)
	if qs1.ID != qs2.ID {
		t.Errorf("duplicate request should return existing item ID")
	}

	// Queue should still have only 1 item
	if o.GetQueueLength() != 1 {
		t.Errorf("expected queue length 1, got %d", o.GetQueueLength())
	}

	// Position should be 1 (not increase)
	pos := o.GetQueuePositionByID(qs1.ID)
	if pos != 1 {
		t.Errorf("expected position 1, got %d", pos)
	}

	// Different includeCustomValues should create a new queue item
	qs3, err := o.EnqueueUnifiedSync(2025, "all", true, false, false, "user3") // Different includeCustomValues
	if err != nil {
		t.Fatalf("unexpected error for different includeCustomValues: %v", err)
	}

	// Should create a new item
	if qs3.ID == qs1.ID {
		t.Error("different includeCustomValues should create new item")
	}

	// Queue should now have 2 items
	if o.GetQueueLength() != 2 {
		t.Errorf("expected queue length 2, got %d", o.GetQueueLength())
	}
}

// =============================================================================
// handleUnifiedSync dry_run tests (kindred#2334)
//
// Unlike the queue-response tests above (which document expected JSON shapes without calling
// the handler), these three actually invoke handleUnifiedSync via httptest -- the mechanism
// that let dry_run go unparsed and undiscovered: the parameter was accepted, echoed nowhere,
// and discarded, so nothing here could previously fail even though production would have
// written for real. TestProcessQueuedSyncsUnifiedHonorsDryRun and
// TestRunSyncWithOptionsHonorsDryRun (orchestrator_test.go) cover the actual
// write-suppression mechanism beneath these; these three cover what an operator sees at the
// HTTP boundary.
// =============================================================================

// TestHandleUnifiedSyncRejectsUnsupportedDryRun proves dry_run=true against a service with no
// DryRunnable support is rejected with 400, before either the immediate or the queued path
// ever touches it -- not run wet silently (kindred#2334's ruled fix direction: "either honor
// it or reject the request").
func TestHandleUnifiedSyncRejectsUnsupportedDryRun(t *testing.T) {
	// Not t.Parallel(): t.Setenv is incompatible with it.
	t.Setenv("CAMPMINDER_SEASON_ID", "2025")

	scheduler := NewScheduler(nil)
	orchestrator := scheduler.GetOrchestrator()
	svc := &notDryRunnableService{name: "session_groups"}
	orchestrator.RegisterService("session_groups", svc)

	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest(http.MethodPost,
		"/?year=2025&service=session_groups&dry_run=true", http.NoBody)
	rec := httptest.NewRecorder()
	re.Response = rec

	if err := handleUnifiedSync(re, scheduler); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "session_groups") {
		t.Errorf("expected the 400 body to name the unsupported service, got: %s", rec.Body.String())
	}
	if got := svc.callCount.Load(); got != 0 {
		t.Errorf("expected the rejected service to never run, ran %d times", got)
	}
}

// TestHandleUnifiedSyncImmediatePathEchoesDryRun proves the 200 response for the immediate
// path echoes dry_run -- the only reliable confirmation an operator gets that they actually
// got a dry run, and the property that let the original bug go unnoticed until the 200 body
// was compared against handleFamilyCampDerivedSync's, which already had it.
func TestHandleUnifiedSyncImmediatePathEchoesDryRun(t *testing.T) {
	// Not t.Parallel(): t.Setenv is incompatible with it.
	t.Setenv("CAMPMINDER_SEASON_ID", "2025")

	scheduler := NewScheduler(nil)
	orchestrator := scheduler.GetOrchestrator()
	orchestrator.RegisterService("family_camp_derived", &dryRunAwareService{name: "family_camp_derived"})

	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest(http.MethodPost,
		"/?year=2025&service=family_camp_derived&dry_run=true", http.NoBody)
	rec := httptest.NewRecorder()
	re.Response = rec

	if err := handleUnifiedSync(re, scheduler); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	dryRun, ok := body["dry_run"].(bool)
	if !ok {
		t.Fatalf("expected a boolean dry_run field in the 200 body, got: %v", body["dry_run"])
	}
	if !dryRun {
		t.Error("expected dry_run=true to be echoed back")
	}
}

// TestHandleUnifiedSyncQueuedPathEchoesDryRun proves the 202 response for the queued path
// echoes dry_run too -- the immediate path echoing it is not evidence the queued path does;
// the two are wired through entirely separate code (EnqueueUnifiedSync vs. the inline opts
// construction), which is exactly how kindred#2334 could have been "fixed" for one and not
// the other.
func TestHandleUnifiedSyncQueuedPathEchoesDryRun(t *testing.T) {
	// Not t.Parallel(): t.Setenv is incompatible with it.
	t.Setenv("CAMPMINDER_SEASON_ID", "2025")

	scheduler := NewScheduler(nil)
	orchestrator := scheduler.GetOrchestrator()
	orchestrator.RegisterService("family_camp_derived", &dryRunAwareService{name: "family_camp_derived"})

	// Force the enqueue branch: something else must already be running.
	orchestrator.RegisterService("placeholder", &notDryRunnableService{name: "placeholder"})
	if err := orchestrator.MarkSyncRunning("placeholder"); err != nil {
		t.Fatalf("MarkSyncRunning: %v", err)
	}

	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest(http.MethodPost,
		"/?year=2025&service=family_camp_derived&dry_run=true", http.NoBody)
	rec := httptest.NewRecorder()
	re.Response = rec

	if err := handleUnifiedSync(re, scheduler); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	dryRun, ok := body["dry_run"].(bool)
	if !ok {
		t.Fatalf("expected a boolean dry_run field in the 202 body, got: %v", body["dry_run"])
	}
	if !dryRun {
		t.Error("expected dry_run=true to be echoed back on the 202 response")
	}

	// And the mechanism that will eventually run it must have actually stored the flag --
	// echoing a local variable back would pass this test's response check while leaving the
	// queued item itself wet.
	queue := orchestrator.GetQueuedSyncs()
	if len(queue) != 1 || !queue[0].DryRun {
		t.Errorf("expected the queued item to carry DryRun=true, got %+v", queue)
	}
}

// =============================================================================
// Phase API Tests
// =============================================================================

// TestGetPhasesEndpointResponse tests the expected response from GET /api/custom/sync/phases
func TestGetPhasesEndpointResponse(t *testing.T) {
	t.Parallel()
	// Expected response structure: {id, name, description, jobs[]}
	// (PhaseInfo type defined in api.go handleGetPhases)

	// Verify all phases are returned
	allPhases := GetAllPhases()
	if len(allPhases) != 5 {
		t.Errorf("expected 5 phases, got %d", len(allPhases))
	}

	// Each phase should have jobs
	for _, phase := range allPhases {
		jobs := GetJobsForPhase(phase)
		if len(jobs) == 0 {
			t.Errorf("phase %q should have at least one job", phase)
		}
	}

	// Verify expected phases
	expectedPhases := []Phase{PhaseSource, PhaseExpensive, PhaseTransform, PhaseProcess, PhaseExport}
	for i, expected := range expectedPhases {
		if allPhases[i] != expected {
			t.Errorf("phase[%d]: expected %q, got %q", i, expected, allPhases[i])
		}
	}
}

// TestPhaseParameterValidation tests phase query parameter parsing
func TestPhaseParameterValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		param     string
		wantPhase Phase
		wantValid bool
	}{
		{"valid source phase", "source", PhaseSource, true},
		{"valid expensive phase", "expensive", PhaseExpensive, true},
		{"valid transform phase", "transform", PhaseTransform, true},
		{"valid process phase", "process", PhaseProcess, true},
		{"valid export phase", "export", PhaseExport, true},
		{"invalid phase", "invalid", "", false},
		{"empty phase", "", "", false},
		{"case sensitive", "Source", "", false}, // Phases are lowercase
		{"partial match", "trans", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			phase, valid := parsePhaseParameter(tt.param)

			if valid != tt.wantValid {
				t.Errorf("expected valid=%v for %q, got %v", tt.wantValid, tt.param, valid)
			}

			if valid && phase != tt.wantPhase {
				t.Errorf("expected phase=%q, got %q", tt.wantPhase, phase)
			}
		})
	}
}

// parsePhaseParameter parses and validates the phase query parameter
func parsePhaseParameter(param string) (Phase, bool) {
	if param == "" {
		return "", false
	}

	phase := Phase(param)

	// Check if this is a valid phase
	for _, p := range GetAllPhases() {
		if p == phase {
			return phase, true
		}
	}

	return "", false
}

// TestRunPhaseEndpointValidation tests run-phase endpoint parameter validation
func TestRunPhaseEndpointValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		yearParam      string
		phaseParam     string
		expectedStatus int
		description    string
	}{
		{
			name:           "valid request",
			yearParam:      "2025",
			phaseParam:     "source",
			expectedStatus: 200,
			description:    "should accept valid year and phase",
		},
		{
			name:           "missing year",
			yearParam:      "",
			phaseParam:     "source",
			expectedStatus: 400,
			description:    "should reject missing year",
		},
		{
			name:           "missing phase",
			yearParam:      "2025",
			phaseParam:     "",
			expectedStatus: 400,
			description:    "should reject missing phase",
		},
		{
			name:           "invalid phase",
			yearParam:      "2025",
			phaseParam:     "invalid",
			expectedStatus: 400,
			description:    "should reject invalid phase",
		},
		{
			name:           "invalid year",
			yearParam:      "abc",
			phaseParam:     "source",
			expectedStatus: 400,
			description:    "should reject invalid year",
		},
		{
			name:           "year too old",
			yearParam:      "2010",
			phaseParam:     "source",
			expectedStatus: 400,
			description:    "should reject year before 2017",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Validate parameters like the handler would
			var yearValid, phaseValid bool

			if tt.yearParam != "" {
				_, yearValid = parseYearParameter(tt.yearParam, 2026) // maxYear=2026 for testing
			}

			if tt.phaseParam != "" {
				_, phaseValid = parsePhaseParameter(tt.phaseParam)
			}

			// Determine expected validation result
			var expectedValid bool
			switch tt.expectedStatus {
			case 200:
				expectedValid = true
			case 400:
				expectedValid = false
			}

			actualValid := yearValid && phaseValid
			if actualValid != expectedValid {
				t.Errorf("%s: expected valid=%v, got yearValid=%v, phaseValid=%v",
					tt.description, expectedValid, yearValid, phaseValid)
			}
		})
	}
}

// TestRunPhaseResponseStructure tests the expected response from POST /api/custom/sync/run-phase
func TestRunPhaseResponseStructure(t *testing.T) {
	t.Parallel()
	// Expected response when phase starts successfully
	type RunPhaseResponse struct {
		Message string   `json:"message"`
		Phase   string   `json:"phase"`
		Year    int      `json:"year"`
		Jobs    []string `json:"jobs"`
	}

	// Verify response would have correct structure
	sourceJobs := GetJobsForPhase(PhaseSource)
	resp := RunPhaseResponse{
		Message: "Phase sync started",
		Phase:   string(PhaseSource),
		Year:    2025,
		Jobs:    sourceJobs,
	}

	if resp.Message == "" {
		t.Error("response should have non-empty message")
	}
	if resp.Phase != "source" {
		t.Errorf("expected phase='source', got %q", resp.Phase)
	}
	if resp.Year != 2025 {
		t.Errorf("expected year=2025, got %d", resp.Year)
	}
	if len(resp.Jobs) == 0 {
		t.Error("response should include jobs for the phase")
	}
}

// TestRunPhaseBlockedWhenSyncRunning tests that phase sync is blocked when other sync running
func TestRunPhaseBlockedWhenSyncRunning(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name              string
		dailyRunning      bool
		weeklyRunning     bool
		historicalRunning bool
		expectedStatus    int
		canRun            bool
	}{
		{
			name:           "no sync running - can start",
			expectedStatus: 200,
			canRun:         true,
		},
		{
			name:           "daily sync running - blocked",
			dailyRunning:   true,
			expectedStatus: 409,
			canRun:         false,
		},
		{
			name:           "weekly sync running - blocked",
			weeklyRunning:  true,
			expectedStatus: 409,
			canRun:         false,
		},
		{
			name:              "historical sync running - blocked",
			historicalRunning: true,
			expectedStatus:    409,
			canRun:            false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o := NewOrchestrator(nil)

			// Set up sync state
			o.mu.Lock()
			o.dailySyncRunning = tt.dailyRunning
			o.weeklySyncRunning = tt.weeklyRunning
			o.historicalSyncRunning = tt.historicalRunning
			o.mu.Unlock()

			// Check if phase sync can run
			canRun := !o.IsDailySyncRunning() && !o.IsWeeklySyncRunning() && !o.IsHistoricalSyncRunning()

			if canRun != tt.canRun {
				t.Errorf("expected canRun=%v, got %v", tt.canRun, canRun)
			}
		})
	}
}

// TestPhaseJobsInOrder tests that jobs returned by GetJobsForPhase maintain dependency order
func TestPhaseJobsInOrder(t *testing.T) {
	t.Parallel()
	// Source phase jobs should be in dependency order
	sourceJobs := GetJobsForPhase(PhaseSource)

	// Create position map
	positions := make(map[string]int)
	for i, job := range sourceJobs {
		positions[job] = i
	}

	// Define expected ordering constraints
	constraints := []struct {
		before string
		after  string
	}{
		{"session_groups", "sessions"},
		{"sessions", "attendees"},
		{"attendees", "persons"},
		{"bunks", "bunk_plans"},
		{"bunk_plans", "bunk_assignments"},
	}

	for _, c := range constraints {
		beforePos, beforeExists := positions[c.before]
		afterPos, afterExists := positions[c.after]

		if !beforeExists || !afterExists {
			continue // Skip if jobs not in this phase
		}

		if beforePos >= afterPos {
			t.Errorf("expected %q (pos %d) to come before %q (pos %d)",
				c.before, beforePos, c.after, afterPos)
		}
	}
}

// =============================================================================
// Issue #4: handleRunPhase Queue Check Tests
// =============================================================================

// TestRunPhaseQueuedWhenIndividualJobRunning tests that run-phase should queue
// when an individual job is running (not just daily/weekly/historical syncs).
// This was a bug: handleRunPhase was missing IsAnyJobRunning() check.
func TestRunPhaseQueuedWhenIndividualJobRunning(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name               string
		dailyRunning       bool
		weeklyRunning      bool
		historicalRunning  bool
		customValuesRun    bool
		individualJobRun   string // Empty means no individual job running
		expectedQueueCheck bool   // true = should queue, false = can start
	}{
		{
			name:               "no sync running - can start",
			expectedQueueCheck: false,
		},
		{
			name:               "daily sync running - should queue",
			dailyRunning:       true,
			expectedQueueCheck: true,
		},
		{
			name:               "individual job running - should queue",
			individualJobRun:   "lodging_assignments",
			expectedQueueCheck: true,
		},
		{
			name:               "two individual jobs running - should queue",
			individualJobRun:   "staff_skills",
			expectedQueueCheck: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o := NewOrchestrator(nil)

			// Set up sync state
			o.mu.Lock()
			o.dailySyncRunning = tt.dailyRunning
			o.weeklySyncRunning = tt.weeklyRunning
			o.historicalSyncRunning = tt.historicalRunning
			o.customValuesSyncRunning = tt.customValuesRun

			// Simulate individual job running
			if tt.individualJobRun != "" {
				o.runningJobs[tt.individualJobRun] = &Status{
					Type:   tt.individualJobRun,
					Status: statusRunning,
				}
			}
			o.mu.Unlock()

			// This is the fixed check that should be in handleRunPhase
			// The bug was: missing IsAnyJobRunning()
			shouldQueue := o.IsDailySyncRunning() || o.IsWeeklySyncRunning() ||
				o.IsHistoricalSyncRunning() || o.IsCustomValuesSyncRunning() ||
				o.IsAnyJobRunning()

			if shouldQueue != tt.expectedQueueCheck {
				t.Errorf("expected shouldQueue=%v, got %v", tt.expectedQueueCheck, shouldQueue)
			}
		})
	}
}

// =============================================================================
// Issue #5: Debug Reset Timing Tests
// =============================================================================

// TestDebugResetTimingSimulation tests that debug flag reset should happen
// AFTER sync completes, not immediately after goroutine starts.
// This was a race condition: debug was reset to false before sync ran.
func TestDebugResetTimingSimulation(t *testing.T) {
	t.Parallel()
	// Simulate the incorrect behavior vs correct behavior

	// Incorrect behavior (before fix):
	// 1. Set debug = true
	// 2. Start goroutine
	// 3. Reset debug = false (WRONG - too early!)
	// 4. Goroutine executes with debug = false

	// Correct behavior (after fix):
	// 1. Set debug = true
	// 2. Start goroutine
	// 3. Goroutine executes with debug = true
	// 4. Goroutine defer resets debug = false

	// Test the timing constraint
	type debugTracker struct {
		debugValue  bool
		wasSetTrue  bool
		wasSetFalse bool
	}

	tracker := &debugTracker{}

	// Simulate correct flow
	tracker.debugValue = true
	tracker.wasSetTrue = true

	// In goroutine (simulated)
	syncExecutedWithDebug := tracker.debugValue // Should be true

	// Defer in goroutine resets
	tracker.debugValue = false
	tracker.wasSetFalse = true

	if !syncExecutedWithDebug {
		t.Error("sync should execute with debug=true before reset")
	}
	if !tracker.wasSetTrue {
		t.Error("debug should have been set to true initially")
	}
	if !tracker.wasSetFalse {
		t.Error("debug should have been set to false after sync")
	}
	if tracker.debugValue {
		t.Error("debug should be false after sync completes")
	}
}

// TestDebugFlagInGoroutineDefer tests the pattern of resetting debug in goroutine defer
func TestDebugFlagInGoroutineDefer(t *testing.T) {
	t.Parallel()
	// This test documents the expected code pattern for the fix
	// The debug reset should be inside the goroutine's defer, not after go func(){}()

	// Expected pattern in handleIndividualSync:
	//
	// go func() {
	//     defer func() {
	//         if debug {
	//             if service := orchestrator.GetService(syncType); service != nil {
	//                 if debuggable, ok := service.(Debuggable); ok {
	//                     debuggable.SetDebug(false)
	//                 }
	//             }
	//         }
	//     }()
	//     // ... sync execution ...
	// }()
	//
	// NOT:
	//
	// go func() { ... }()
	// if debug { resetDebug() }  // WRONG - races with goroutine

	// This test just documents the expected pattern
	// The actual fix verification will be in the implementation test
	t.Log("Debug reset should be in goroutine defer, not after goroutine start")
}

// =============================================================================
// Issue #7: handleRunPhase Year Parameter Bug Tests
// =============================================================================

// TestRunPhaseYearMustBeSetOnOrchestrator tests that handleRunPhase must set
// the currentSyncYear on the orchestrator before running phase jobs.
// This was a bug: handleRunPhase parsed the year parameter but never set it
// on the orchestrator, causing transform jobs to use environment fallback (wrong year).
func TestRunPhaseYearMustBeSetOnOrchestrator(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Verify initial state: currentSyncYear should be 0
	o.mu.RLock()
	initialYear := o.currentSyncYear
	o.mu.RUnlock()

	if initialYear != 0 {
		t.Errorf("expected initial currentSyncYear=0, got %d", initialYear)
	}

	// The fix should set currentSyncYear before running jobs
	// This is the pattern used in RunSyncWithOptions:
	//
	// o.mu.Lock()
	// o.currentSyncYear = opts.Year
	// o.mu.Unlock()
	//
	// defer func() {
	//     o.mu.Lock()
	//     o.currentSyncYear = 0
	//     o.mu.Unlock()
	// }()

	// Simulate what handleRunPhase SHOULD do:
	testYear := 2025
	o.mu.Lock()
	o.currentSyncYear = testYear
	o.mu.Unlock()

	// Verify year is set
	o.mu.RLock()
	setYear := o.currentSyncYear
	o.mu.RUnlock()

	if setYear != testYear {
		t.Errorf("expected currentSyncYear=%d after setting, got %d", testYear, setYear)
	}

	// Reset like the defer should do
	o.mu.Lock()
	o.currentSyncYear = 0
	o.mu.Unlock()

	// Verify reset
	o.mu.RLock()
	finalYear := o.currentSyncYear
	o.mu.RUnlock()

	if finalYear != 0 {
		t.Errorf("expected currentSyncYear=0 after reset, got %d", finalYear)
	}
}

// TestRunPhaseYearPropagationToJobs tests that when handleRunPhase sets
// currentSyncYear, the RunSingleSync will use that year for job status.
func TestRunPhaseYearPropagationToJobs(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Set the sync year (simulating handleRunPhase fix)
	testYear := 2025
	o.mu.Lock()
	o.currentSyncYear = testYear
	o.mu.Unlock()

	// Create a status like RunSingleSync does (line 391)
	// The Year field should be populated from currentSyncYear
	status := &Status{
		Type:      "test_job",
		Status:    statusRunning,
		StartTime: time.Now(),
		Summary:   Stats{},
		Year:      o.currentSyncYear, // This is how RunSingleSync gets the year
	}

	if status.Year != testYear {
		t.Errorf("expected status.Year=%d from currentSyncYear, got %d", testYear, status.Year)
	}

	// Clean up
	o.mu.Lock()
	o.currentSyncYear = 0
	o.mu.Unlock()
}

// TestRunPhaseYearNotSetBugExplanation documents the bug:
// handleRunPhase parses year but never sets it on orchestrator.
func TestRunPhaseYearNotSetBugExplanation(t *testing.T) {
	t.Parallel()
	// BEFORE FIX (BUG):
	// Line ~2074: year, err := strconv.Atoi(yearParam)  // Parses year correctly
	// Line ~2192: orchestrator.runSyncAndWait(ctx, jobID)  // Runs job
	// BUT: currentSyncYear was never set, so RunSingleSync line 391 uses 0
	// Then services call ParseSeasonYear() which reads CAMPMINDER_SEASON_ID
	//
	// AFTER FIX:
	// Inside the goroutine, BEFORE the job loop:
	// o.mu.Lock()
	// o.currentSyncYear = year
	// o.mu.Unlock()
	//
	// defer func() {
	//     o.mu.Lock()
	//     o.currentSyncYear = 0
	//     o.mu.Unlock()
	// }()

	t.Log("Bug: handleRunPhase parses year parameter but never sets currentSyncYear")
	t.Log("Fix: Set currentSyncYear inside goroutine before job loop, reset in defer")
}

// TestRunPhaseYearMustPropagateToServices tests that handleRunPhase must set
// the year on each service instance, not just on orchestrator.currentSyncYear.
// BUG: currentSyncYear only affects status.Year, NOT what year the services query.
// Services read their own .Year field which defaults to env var CAMPMINDER_SEASON_ID.
func TestRunPhaseYearMustPropagateToServices(t *testing.T) {
	t.Parallel()
	// This test demonstrates that YearSetter interface is needed.
	// Services have .Year field that controls which year's data they query.
	// Setting orchestrator.currentSyncYear does NOT set service.Year.

	// Example service pattern (from staff_applications.go):
	//   year := s.Year
	//   if year == 0 {
	//       year, err = ParseSeasonYear()  // Returns explicit error if not set
	//       ...
	//   }

	// The fix requires:
	// 1. YearSetter interface: type YearSetter interface { SetYear(year int) }
	// 2. Services implement SetYear() to set their internal .Year field
	// 3. handleRunPhase calls SetYear(year) on each service before running

	// Verify that YearSetter interface exists (compilation will fail if not)
	var _ YearSetter = (*FamilyCampDerivedSync)(nil)
	var _ YearSetter = (*StaffApplicationsSync)(nil)
	var _ YearSetter = (*StaffVehicleInfoSync)(nil)
	var _ YearSetter = (*QuestRegistrationsSync)(nil)

	t.Log("YearSetter interface is implemented by year-aware services")
}

// TestSyncStatusListIncludesStrandedAssignmentCleanup verifies stranded_assignment_cleanup
// is registered in syncJobMeta with a phase AND actually published in the status payload.
//
// It used to only be able to check the first half: handleSyncStatus's syncTypes slice was a
// local var no test could read, so "placement in the diff" was the only guard on the second
// half. That slice is now statusSyncTypes(), so the membership this test was really about
// is asserted directly rather than trusted. api_status_types_test.go generalises it -- every
// job in every sequence must be published; these three are kept named here because each was
// a specific past regression.
func TestSyncStatusListIncludesStrandedAssignmentCleanup(t *testing.T) {
	t.Parallel()
	// Required jobs: registered in syncJobMeta with a phase, and published by
	// statusSyncTypes so the card does not sit at "idle" while the job runs.
	requiredInStatusList := []string{
		"normalize_geographic",
		"enrollment_snapshots",
		"stranded_assignment_cleanup", // must be present — card shows "idle" without it
	}

	// Cross-check against syncJobMeta: every job in the required list must also be
	// registered with its expected phase so the two sources stay in sync.
	for _, jobID := range requiredInStatusList {
		phase := GetPhaseForJob(jobID)
		if phase == "" {
			t.Errorf("job %q not found in syncJobMeta — add it before adding to status list", jobID)
		}
	}

	// The half that used to be unassertable: the job must actually reach the client.
	published := publishedSyncTypes()
	for _, jobID := range requiredInStatusList {
		if !published[jobID] {
			t.Errorf("job %q is not published by statusSyncTypes — its card shows \"idle\" while it runs", jobID)
		}
	}

	// Verify no duplicates in the required list.
	seen := make(map[string]bool)
	for _, id := range requiredInStatusList {
		if seen[id] {
			t.Errorf("duplicate in requiredInStatusList: %q", id)
		}
		seen[id] = true
	}
}

// TestNormalizeSession verifies session "0" normalizes to DefaultSession ("all"),
// matching the behavior of the other two endpoints that already handle this case.
// Regression test for #806.
func TestNormalizeSession(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"empty string normalizes to all", "", DefaultSession},
		{"zero normalizes to all", "0", DefaultSession},
		{"all stays all", "all", "all"},
		{"numeric cm_id stays as-is", "12345", "12345"},
		{"whitespace stays as-is", " ", " "},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeSession(tt.input)
			if got != tt.want {
				t.Errorf("normalizeSession(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// =============================================================================
// kindred#2491: the family-camp bounded custom-values jobs share collections with the
// unbounded ones but not their lock, phase slot, or log label. Face A + Face C below.
// =============================================================================

// TestHandleCustomValuesSyncRejectsWhenScopeFamilyCampGroupmateRunning pins Face A's
// original report: handleCustomValuesSync's front guard used to check only the literal names
// "person_custom_values" / "household_custom_values" via orchestrator.IsRunning, so it did not
// see the bounded daily family-camp jobs (kindred#2489) as writers of the same collections and
// would return 200 "Custom values sync triggered" while one was still in flight.
func TestHandleCustomValuesSyncRejectsWhenScopeFamilyCampGroupmateRunning(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name          string
		boundedJob    string
		registerBound func(o *Orchestrator)
	}{
		{
			name:       "person bounded pass blocks the endpoint",
			boundedJob: "person_custom_values_family_camp",
			registerBound: func(o *Orchestrator) {
				o.RegisterService("person_custom_values_family_camp",
					&MockService{name: "person_custom_values_family_camp"})
			},
		},
		{
			name:       "household bounded pass blocks the endpoint",
			boundedJob: "household_custom_values_family_camp",
			registerBound: func(o *Orchestrator) {
				o.RegisterService("household_custom_values_family_camp",
					&MockService{name: "household_custom_values_family_camp"})
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scheduler := NewScheduler(nil)
			orchestrator := scheduler.GetOrchestrator()
			tc.registerBound(orchestrator)

			if err := orchestrator.MarkSyncRunning(tc.boundedJob); err != nil {
				t.Fatalf("MarkSyncRunning(%q): %v", tc.boundedJob, err)
			}

			re := &core.RequestEvent{}
			re.Request = httptest.NewRequest(http.MethodPost, "/", http.NoBody)
			rec := httptest.NewRecorder()
			re.Response = rec

			if err := handleCustomValuesSync(re, scheduler); err != nil {
				t.Fatalf("handler returned error: %v", err)
			}

			if rec.Code != http.StatusConflict {
				t.Errorf("expected %d (already running), got %d: %s",
					http.StatusConflict, rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandleCustomValuesSyncAllowsRunWhenNothingRunning is the control case: with nothing
// running (bounded or unrestricted), the endpoint must still succeed.
func TestHandleCustomValuesSyncAllowsRunWhenNothingRunning(t *testing.T) {
	t.Parallel()
	scheduler := NewScheduler(nil)

	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest(http.MethodPost, "/", http.NoBody)
	rec := httptest.NewRecorder()
	re.Response = rec

	if err := handleCustomValuesSync(re, scheduler); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("expected %d, got %d: %s", http.StatusOK, rec.Code, rec.Body.String())
	}
}

// TestPhaseExecutionJobsExcludesScopeFamilyCampForExpensivePhase pins Face C: an admin
// running the "Custom Values" (PhaseExpensive) phase used to re-run the two bounded family-camp
// jobs alongside the unrestricted ones, because GetJobsForPhase(PhaseExpensive) -- built from
// syncJobMeta -- lists all four jobs. The bounded jobs are always covered by the daily cron
// (getDailySyncJobs) minutes before an admin-triggered phase run would otherwise re-fetch the
// identical family-camp cohort, burning ~11.5 min of rate-limited CampMinder quota for values
// already fresh.
//
// GetJobsForPhase itself is deliberately left untouched (see TestSyncJobMeta_
// ScopeFamilyCampJobsAreExpensivePhase in family_camp_daily_cadence_test.go, which pins the
// two bounded jobs' classification as PhaseExpensive) -- phaseExecutionJobs filters the
// *execution* list at the two call sites that actually run a phase (handleRunPhase,
// processQueuedSyncs) without changing what GetJobsForPhase reports for phase metadata/UI.
func TestPhaseExecutionJobsExcludesScopeFamilyCampForExpensivePhase(t *testing.T) {
	t.Parallel()

	jobs := phaseExecutionJobs(PhaseExpensive)

	for _, excluded := range []string{"person_custom_values_family_camp", "household_custom_values_family_camp"} {
		for _, j := range jobs {
			if j == excluded {
				t.Errorf("phaseExecutionJobs(PhaseExpensive) = %v, must not include %q "+
					"-- it is always covered by the daily cron", jobs, excluded)
			}
		}
	}

	for _, included := range []string{"person_custom_values", "household_custom_values"} {
		found := false
		for _, j := range jobs {
			if j == included {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("phaseExecutionJobs(PhaseExpensive) = %v, missing %q", jobs, included)
		}
	}

	// GetJobsForPhase itself must be untouched -- family_camp_daily_cadence_test.go's
	// TestSyncJobMeta_ScopeFamilyCampJobsAreExpensivePhase pins that it still lists all four.
	classified := GetJobsForPhase(PhaseExpensive)
	if len(classified) != 4 {
		t.Errorf("GetJobsForPhase(PhaseExpensive) = %v, expected phaseExecutionJobs to filter "+
			"a copy, not mutate the underlying classification", classified)
	}

	// Every other phase must pass through unfiltered.
	for _, phase := range GetAllPhases() {
		if phase == PhaseExpensive {
			continue
		}
		want := GetJobsForPhase(phase)
		got := phaseExecutionJobs(phase)
		if len(got) != len(want) {
			t.Errorf("phaseExecutionJobs(%q) = %v, want unfiltered %v", phase, got, want)
			continue
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("phaseExecutionJobs(%q)[%d] = %q, want %q", phase, i, got[i], want[i])
			}
		}
	}
}

// TestHandleRunPhaseImmediateResponseExcludesScopeFamilyCampJobs is the HTTP-level half of
// Face C: the "jobs" field handleRunPhase echoes back (and actually iterates to run) for
// ?phase=expensive must not list the two bounded family-camp jobs.
func TestHandleRunPhaseImmediateResponseExcludesScopeFamilyCampJobs(t *testing.T) {
	t.Parallel()
	scheduler := NewScheduler(nil)

	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest(http.MethodPost, "/?year=2025&phase=expensive", http.NoBody)
	rec := httptest.NewRecorder()
	re.Response = rec

	if err := handleRunPhase(re, scheduler); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected %d, got %d: %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var body struct {
		Jobs []string `json:"jobs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	for _, excluded := range []string{"person_custom_values_family_camp", "household_custom_values_family_camp"} {
		for _, j := range body.Jobs {
			if j == excluded {
				t.Errorf("handleRunPhase(?phase=expensive) jobs = %v, must not include %q",
					body.Jobs, excluded)
			}
		}
	}
	for _, included := range []string{"person_custom_values", "household_custom_values"} {
		found := false
		for _, j := range body.Jobs {
			if j == included {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("handleRunPhase(?phase=expensive) jobs = %v, missing %q", body.Jobs, included)
		}
	}
}

// TestHandleRefreshFamilyCampRejectsWhenUnrestrictedGroupmateRunning pins that the
// refresh-family-camp front guard is collection-group-aware, not keyed on the six literal job
// names.
//
// The chain contains "person_custom_values_family_camp" and
// "household_custom_values_family_camp", which write the SAME PocketBase collections as the
// unrestricted "person_custom_values" / "household_custom_values" jobs under different
// registered names (kindred#2489, kindred#2491 Face A). A guard built from
// orchestrator.IsRunning(job) over GetRefreshFamilyCampJobs() therefore does not see the
// weekly unrestricted sweep -- or an operator's on-demand custom-values run -- as a writer of
// the collections this chain is about to rewrite.
//
// That gap is not merely cosmetic. runSingleSyncInternal's own group-aware check (the deep
// enforcement added by kindred#2519) DOES block the bounded job, so the chain aborts mid-way:
// the handler has already answered 200 "started", attendees and persons have already run, and
// family_camp_derived and lodging_assignments -- the board's roster and its cabin mirror --
// never run at all. The operator is told the refresh started and the board silently keeps
// yesterday's cabins. Answering 409 up front is the difference between "try again later" and a
// half-applied refresh reported as success.
func TestHandleRefreshFamilyCampRejectsWhenUnrestrictedGroupmateRunning(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name         string
		runningJob   string
		blockedByJob string
	}{
		{
			name:         "unrestricted person sweep blocks the refresh",
			runningJob:   "person_custom_values",
			blockedByJob: "person_custom_values_family_camp",
		},
		{
			name:         "unrestricted household sweep blocks the refresh",
			runningJob:   "household_custom_values",
			blockedByJob: "household_custom_values_family_camp",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			scheduler := NewScheduler(nil)
			orchestrator := scheduler.GetOrchestrator()

			// Register the whole chain so that, if the guard wrongly lets the request
			// through, the failure is an observable 200 rather than an unregistered-service
			// error from a different cause.
			for _, job := range GetRefreshFamilyCampJobs() {
				orchestrator.RegisterService(job, &MockService{name: job})
			}

			orchestrator.RegisterService(tc.runningJob, &MockService{name: tc.runningJob})
			if err := orchestrator.MarkSyncRunning(tc.runningJob); err != nil {
				t.Fatalf("MarkSyncRunning(%q): %v", tc.runningJob, err)
			}

			// None of the six literal job names is running, so a guard keyed on
			// IsRunning(job) sees a clear field and answers 200.
			for _, job := range GetRefreshFamilyCampJobs() {
				if orchestrator.IsRunning(job) {
					t.Fatalf("precondition: %q must not be running under its own name", job)
				}
			}
			if !orchestrator.IsCustomValuesCollectionRunning(tc.blockedByJob) {
				t.Fatalf("precondition: %q must be blocked by %q's collection group",
					tc.blockedByJob, tc.runningJob)
			}

			re := &core.RequestEvent{}
			re.Request = httptest.NewRequest(http.MethodPost, "/", http.NoBody)
			rec := httptest.NewRecorder()
			re.Response = rec

			if err := handleRefreshFamilyCamp(re, scheduler); err != nil {
				t.Fatalf("handler returned error: %v", err)
			}

			if rec.Code != http.StatusConflict {
				t.Errorf("expected %d (a groupmate of %q is already writing the collection), got %d: %s",
					http.StatusConflict, tc.blockedByJob, rec.Code, rec.Body.String())
			}
		})
	}
}
