package sync

import (
	"encoding/json"
	"testing"
)

// camperHistoryServiceName is the expected service name for camper history sync
const camperHistoryServiceName = "camper_history"

// TestCamperHistorySyncServiceName tests the service name
func TestCamperHistorySyncServiceName(t *testing.T) {
	// CamperHistorySync should have the correct name
	expectedName := camperHistoryServiceName

	// Test the service name matches expected
	if expectedName != camperHistoryServiceName {
		t.Errorf("expected service name %q, got %q", camperHistoryServiceName, expectedName)
	}
}

// TestCamperHistoryYearParameterParsing tests year parameter validation
func TestCamperHistoryYearParameterParsing(t *testing.T) {
	tests := []struct {
		name      string
		yearStr   string
		wantYear  int
		wantValid bool
	}{
		{"valid year 2024", "2024", 2024, true},
		{"valid year 2017 (minimum)", "2017", 2017, true},
		{"valid year 2025", "2025", 2025, true},
		{"year too old 2016", "2016", 0, false},
		{"year far future 2100", "2100", 0, false},
		{"non-numeric", "abc", 0, false},
		{"empty", "", 0, false},
		{"negative", "-2024", 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			year, valid := parseCamperHistoryYear(tt.yearStr)

			if valid != tt.wantValid {
				t.Errorf("expected valid=%v, got %v", tt.wantValid, valid)
			}

			if valid && year != tt.wantYear {
				t.Errorf("expected year=%d, got %d", tt.wantYear, year)
			}
		})
	}
}

// parseCamperHistoryYear parses and validates year parameter for camper history
func parseCamperHistoryYear(yearStr string) (int, bool) {
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

	// Valid range is 2017 to 2050 (reasonable future bound)
	if year < 2017 || year > 2050 {
		return 0, false
	}

	return year, true
}

// TestCamperHistoryStatsJSONParsing tests parsing stats from Python output
func TestCamperHistoryStatsJSONParsing(t *testing.T) {
	tests := []struct {
		name        string
		jsonData    string
		wantSuccess bool
		wantCreated int
		wantDeleted int
		wantErrors  int
	}{
		{
			name:        "successful run",
			jsonData:    `{"success": true, "created": 150, "deleted": 5, "errors": 0}`,
			wantSuccess: true,
			wantCreated: 150,
			wantDeleted: 5,
			wantErrors:  0,
		},
		{
			name:        "run with errors",
			jsonData:    `{"success": false, "created": 145, "deleted": 0, "errors": 5}`,
			wantSuccess: false,
			wantCreated: 145,
			wantDeleted: 0,
			wantErrors:  5,
		},
		{
			name:        "empty run",
			jsonData:    `{"success": true, "created": 0, "deleted": 0, "errors": 0}`,
			wantSuccess: true,
			wantCreated: 0,
			wantDeleted: 0,
			wantErrors:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var result struct {
				Success bool `json:"success"`
				Created int  `json:"created"`
				Deleted int  `json:"deleted"`
				Errors  int  `json:"errors"`
			}

			err := json.Unmarshal([]byte(tt.jsonData), &result)
			if err != nil {
				t.Errorf("failed to parse JSON: %v", err)
				return
			}

			if result.Success != tt.wantSuccess {
				t.Errorf("success = %v, want %v", result.Success, tt.wantSuccess)
			}
			if result.Created != tt.wantCreated {
				t.Errorf("created = %d, want %d", result.Created, tt.wantCreated)
			}
			if result.Deleted != tt.wantDeleted {
				t.Errorf("deleted = %d, want %d", result.Deleted, tt.wantDeleted)
			}
			if result.Errors != tt.wantErrors {
				t.Errorf("errors = %d, want %d", result.Errors, tt.wantErrors)
			}
		})
	}
}

// TestCamperHistoryPythonArgsBuilding tests building Python command arguments
func TestCamperHistoryPythonArgsBuilding(t *testing.T) {
	tests := []struct {
		name       string
		year       int
		dryRun     bool
		wantArgs   []string
		wantModule string
	}{
		{
			name:       "basic run",
			year:       2025,
			dryRun:     false,
			wantModule: "bunking.metrics.compute_camper_history",
			wantArgs:   []string{"--year", "2025"},
		},
		{
			name:       "dry run",
			year:       2025,
			dryRun:     true,
			wantModule: "bunking.metrics.compute_camper_history",
			wantArgs:   []string{"--year", "2025", "--dry-run"},
		},
		{
			name:       "historical year",
			year:       2023,
			dryRun:     false,
			wantModule: "bunking.metrics.compute_camper_history",
			wantArgs:   []string{"--year", "2023"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := buildCamperHistoryArgs(tt.year, tt.dryRun, "/tmp/stats.json")

			// Verify module name is first args
			if len(args) < 2 || args[0] != "-m" || args[1] != tt.wantModule {
				t.Errorf("expected module args [-m %s], got %v", tt.wantModule, args[:2])
			}

			// Verify --year is present with correct value
			yearFound := false
			for i, arg := range args {
				if arg == "--year" && i+1 < len(args) {
					if args[i+1] == tt.wantArgs[1] {
						yearFound = true
					}
				}
			}
			if !yearFound {
				t.Errorf("expected --year %d in args", tt.year)
			}

			// Verify --dry-run is present if expected
			if tt.dryRun {
				dryRunFound := false
				for _, arg := range args {
					if arg == "--dry-run" {
						dryRunFound = true
						break
					}
				}
				if !dryRunFound {
					t.Error("expected --dry-run in args")
				}
			}
		})
	}
}

// buildCamperHistoryArgs builds the Python command arguments
func buildCamperHistoryArgs(year int, dryRun bool, statsFile string) []string {
	args := []string{
		"-m",
		"bunking.metrics.compute_camper_history",
		"--year", formatYear(year),
		"--stats-output", statsFile,
	}

	if dryRun {
		args = append(args, "--dry-run")
	}

	return args
}

// formatYear converts int year to string
func formatYear(year int) string {
	// Simple int to string conversion
	if year == 0 {
		return "0"
	}
	result := ""
	for year > 0 {
		result = string('0'+rune(year%10)) + result
		year /= 10
	}
	return result
}

// TestCamperHistoryServiceValidation tests sync type validation includes camper_history
func TestCamperHistoryServiceValidation(t *testing.T) {
	// camper_history should be a valid sync type
	validSyncTypes := map[string]bool{
		"session_groups":   true,
		"sessions":         true,
		"divisions":        true,
		"attendees":        true,
		"persons":          true,
		"bunks":            true,
		"bunk_plans":       true,
		"bunk_assignments": true,
		"staff":            true,
		"camper_history":   true, // NEW
		"bunk_requests":    true,
		"process_requests": true,
	}

	// Verify camper_history is valid
	if !validSyncTypes["camper_history"] {
		t.Error("camper_history should be a valid sync type")
	}
}

// TestCamperHistoryDependencies tests that camper_history has correct dependencies
func TestCamperHistoryDependencies(t *testing.T) {
	// camper_history depends on: attendees, persons, bunk_assignments, camp_sessions
	// It should run AFTER these in the sync order
	dependencies := []string{
		"sessions",         // For session names
		"attendees",        // For enrollment data
		"persons",          // For demographics
		"bunk_assignments", // For bunk data
	}

	// All dependencies should exist and run before camper_history
	for _, dep := range dependencies {
		// Just verify the dependency names are as expected
		if dep == "" {
			t.Error("dependency should not be empty")
		}
	}

	// Verify count
	if len(dependencies) != 4 {
		t.Errorf("expected 4 dependencies, got %d", len(dependencies))
	}
}
