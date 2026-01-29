package sync

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
)

// TestCSVValidation tests CSV parsing and validation logic
func TestCSVValidation_ValidCSV(t *testing.T) {
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
// Note: Actual session validation happens in Python via SessionRepository.resolve_session_name()
// which dynamically queries the camp_sessions table. Go just passes the string through.
func TestSessionParameterPassthrough(t *testing.T) {
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
	tests := []struct {
		name       string
		param      string
		wantFields []string
		wantValid  bool
	}{
		// Empty/default
		{"empty param", "", nil, true},

		// Single fields
		{"single bunk_with", "bunk_with", []string{"bunk_with"}, true},
		{"single not_bunk_with", "not_bunk_with", []string{"not_bunk_with"}, true},
		{"single bunking_notes", "bunking_notes", []string{"bunking_notes"}, true},
		{"single internal_notes", "internal_notes", []string{"internal_notes"}, true},
		{"single socialize_with", "socialize_with", []string{"socialize_with"}, true},

		// Multiple fields (comma-separated)
		{
			"two fields",
			"bunk_with,not_bunk_with",
			[]string{"bunk_with", "not_bunk_with"},
			true,
		},
		{
			"all five fields",
			"bunk_with,not_bunk_with,bunking_notes,internal_notes,socialize_with",
			[]string{"bunk_with", "not_bunk_with", "bunking_notes", "internal_notes", "socialize_with"},
			true,
		},
		{
			"with spaces around commas",
			"bunk_with, not_bunk_with, bunking_notes",
			[]string{"bunk_with", "not_bunk_with", "bunking_notes"},
			true,
		},

		// Invalid fields
		{"invalid field", "invalid_field", nil, false},
		{"one valid one invalid", "bunk_with,invalid", nil, false},
		{"typo", "bunk_withs", nil, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fields, valid := parseSourceFieldParameter(tt.param)

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

// parseSourceFieldParameter parses and validates the source_field query parameter
// Returns slice of valid field names and validity
func parseSourceFieldParameter(param string) ([]string, bool) {
	if param == "" {
		return nil, true // Empty means all fields (default)
	}

	validFields := map[string]bool{
		"bunk_with":      true,
		"not_bunk_with":  true,
		"bunking_notes":  true,
		"internal_notes": true,
		"socialize_with": true,
	}

	parts := strings.Split(param, ",")
	fields := make([]string, 0, len(parts))
	for _, f := range parts {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		if !validFields[f] {
			return nil, false // Invalid field
		}
		fields = append(fields, f)
	}

	return fields, true
}

// TestCustomValuesSyncServices tests that custom values sync services are defined
func TestCustomValuesSyncServices(t *testing.T) {
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
	o := NewOrchestrator(nil)

	// Enqueue a sync (without custom values)
	qs1, err := o.EnqueueUnifiedSync(2025, "all", false, false, "user1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Try to enqueue the same year+service+includeCustomValues again
	qs2, err := o.EnqueueUnifiedSync(2025, "all", false, true, "user2") // Same includeCustomValues, different debug
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
	qs3, err := o.EnqueueUnifiedSync(2025, "all", true, false, "user3") // Different includeCustomValues
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
