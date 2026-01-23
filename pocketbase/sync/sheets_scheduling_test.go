package sync

import (
	"testing"
)

// =============================================================================
// Phase 6-7: Scheduled and Historical Export Tests
// =============================================================================

func TestGoogleSheetsExport_SyncGlobalsOnly_MethodExists(t *testing.T) {
	// Test that SyncGlobalsOnly method exists and is callable
	// Actual DB interaction is tested in integration tests
	mock := NewMockSheetsWriter()
	export := &GoogleSheetsExport{
		sheetsWriter:  mock,
		spreadsheetID: "test-spreadsheet-id",
		year:          2025,
		// Note: App is nil, so DB queries will fail
	}

	// Method should exist and be callable (will error due to nil App)
	_ = export.SyncGlobalsOnly

	// The method signature test - we just verify it compiles
	// Integration tests will verify actual behavior with DB
}

func TestGoogleSheetsExport_SyncDailyOnly_MethodExists(t *testing.T) {
	// Test that SyncDailyOnly method exists and is callable
	mock := NewMockSheetsWriter()
	export := &GoogleSheetsExport{
		sheetsWriter:  mock,
		spreadsheetID: "test-spreadsheet-id",
		year:          2025,
	}

	// Method should exist and be callable
	_ = export.SyncDailyOnly

	// Integration tests will verify actual behavior with DB
}

func TestGoogleSheetsExport_SyncForYears_MethodExists(t *testing.T) {
	// Test that SyncForYears method exists and is callable
	mock := NewMockSheetsWriter()
	export := &GoogleSheetsExport{
		sheetsWriter:  mock,
		spreadsheetID: "test-spreadsheet-id",
		year:          2025,
	}

	// Method should exist and be callable
	_ = export.SyncForYears

	// Integration tests will verify actual behavior with DB
}

func TestGoogleSheetsExportOptions_DefaultValues(t *testing.T) {
	// Test default export options
	opts := NewGoogleSheetsExportOptions()

	if opts.IncludeGlobals != true {
		t.Error("Expected IncludeGlobals default to be true")
	}
	if opts.IncludeYearData != true {
		t.Error("Expected IncludeYearData default to be true")
	}
	if len(opts.Years) != 0 {
		t.Error("Expected Years to be empty by default")
	}
}

func TestGoogleSheetsExportOptions_WithYears(t *testing.T) {
	// Test setting specific years
	opts := NewGoogleSheetsExportOptions()
	opts.Years = []int{2024, 2023, 2022}

	if len(opts.Years) != 3 {
		t.Errorf("Expected 3 years, got %d", len(opts.Years))
	}
	if opts.Years[0] != 2024 {
		t.Errorf("Expected first year to be 2024, got %d", opts.Years[0])
	}
}

func TestGoogleSheetsExportOptions_GlobalsOnlyMode(t *testing.T) {
	// Test globals-only export mode
	opts := NewGoogleSheetsExportOptions()
	opts.IncludeGlobals = true
	opts.IncludeYearData = false

	if !opts.IncludeGlobals {
		t.Error("Expected IncludeGlobals to be true")
	}
	if opts.IncludeYearData {
		t.Error("Expected IncludeYearData to be false")
	}
}

func TestGoogleSheetsExportOptions_DailyOnlyMode(t *testing.T) {
	// Test daily-only export mode (year data only)
	opts := NewGoogleSheetsExportOptions()
	opts.IncludeGlobals = false
	opts.IncludeYearData = true

	if opts.IncludeGlobals {
		t.Error("Expected IncludeGlobals to be false")
	}
	if !opts.IncludeYearData {
		t.Error("Expected IncludeYearData to be true")
	}
}

func TestSheetsExportServiceNames(t *testing.T) {
	// Test that service names for scheduling are defined
	names := GetSheetsExportServiceNames()

	// Should have at least the main service
	hasMain := false
	hasGlobals := false
	hasDaily := false

	for _, name := range names {
		switch name {
		case "google_sheets_export":
			hasMain = true
		case "google_sheets_export_globals":
			hasGlobals = true
		case "google_sheets_export_daily":
			hasDaily = true
		}
	}

	if !hasMain {
		t.Error("Expected google_sheets_export service name")
	}
	if !hasGlobals {
		t.Error("Expected google_sheets_export_globals service name")
	}
	if !hasDaily {
		t.Error("Expected google_sheets_export_daily service name")
	}
}

func TestParseExportYearsParam(t *testing.T) {
	// Test parsing years parameter from API request
	tests := []struct {
		input    string
		want     []int
		wantErr  bool
	}{
		{"", []int{}, false},                    // Empty = current year only
		{"2024", []int{2024}, false},            // Single year
		{"2024,2023", []int{2024, 2023}, false}, // Multiple years
		{"2024,2023,2022", []int{2024, 2023, 2022}, false},
		{"invalid", nil, true},                  // Invalid input
		{"2024,invalid", nil, true},             // Partial invalid
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := ParseExportYearsParam(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseExportYearsParam(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if !tt.wantErr {
				if len(got) != len(tt.want) {
					t.Errorf("ParseExportYearsParam(%q) = %v, want %v", tt.input, got, tt.want)
				}
			}
		})
	}
}

func TestValidateExportYears(t *testing.T) {
	// Test year validation (reasonable range)
	tests := []struct {
		years   []int
		maxYear int
		wantErr bool
	}{
		{[]int{2024}, 2025, false},
		{[]int{2024, 2023}, 2025, false},
		{[]int{2017}, 2025, false},           // Oldest valid year
		{[]int{2016}, 2025, true},            // Too old
		{[]int{2026}, 2025, true},            // Future year
		{[]int{2024, 2023, 2022, 2021, 2020, 2019}, 2025, true}, // Too many years (max 5)
	}

	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			err := ValidateExportYears(tt.years, tt.maxYear)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateExportYears(%v, %d) error = %v, wantErr %v",
					tt.years, tt.maxYear, err, tt.wantErr)
			}
		})
	}
}
