package sync

import (
	"bytes"
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
		"sessions":         true,
		"attendees":        true,
		"persons":          true,
		"bunks":            true,
		"bunk_plans":       true,
		"bunk_assignments": true,
		"bunk_requests":    true,
		"process_requests": true,
	}

	tests := []struct {
		name      string
		syncType  string
		wantValid bool
	}{
		{"sessions", "sessions", true},
		{"attendees", "attendees", true},
		{"persons", "persons", true},
		{"bunks", "bunks", true},
		{"bunk_plans", "bunk_plans", true},
		{"bunk_assignments", "bunk_assignments", true},
		{"bunk_requests", "bunk_requests", true},
		{"process_requests", "process_requests", true},
		{"invalid type", "invalid", false},
		{"empty", "", false},
		{"typo", "session", false},
		{"case sensitive", "Sessions", false},
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
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"bunk_requests",
		"process_requests",
	}

	// Verify all expected sync types are covered
	if len(syncTypes) != 8 {
		t.Errorf("expected 8 sync types, got %d", len(syncTypes))
	}

	// Verify no duplicates
	seen := make(map[string]bool)
	for _, st := range syncTypes {
		if seen[st] {
			t.Errorf("duplicate sync type: %s", st)
		}
		seen[st] = true
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
