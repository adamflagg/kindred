package sync

import (
	"os"
	"path/filepath"
	"testing"
)

// =============================================================================
// Phase 2: Configuration File System Tests
// =============================================================================

func TestSheetsConfig_DefaultSheetName(t *testing.T) {
	// Test that default sheet names use lowercase with hyphens
	tests := []struct {
		collection string
		want       string
	}{
		{"persons", "persons"},
		{"person_tag_defs", "person-tag-defs"},
		{"custom_field_defs", "custom-field-defs"},
		{"person_custom_field_values", "person-custom-field-values"},
		{"camp_sessions", "camp-sessions"},
	}

	for _, tt := range tests {
		t.Run(tt.collection, func(t *testing.T) {
			got := DefaultSheetName(tt.collection)
			if got != tt.want {
				t.Errorf("DefaultSheetName(%q) = %q, want %q", tt.collection, got, tt.want)
			}
		})
	}
}

func TestSheetsConfig_GetSheetName_YearPrefixed(t *testing.T) {
	// Test that year-specific tables get year prefix
	config := &SheetsConfig{
		Tables: map[string]*TableConfig{
			"persons": {
				Enabled:   true,
				SheetName: "persons",
				IsGlobal:  false,
			},
			"attendees": {
				Enabled:   true,
				SheetName: "attendees",
				IsGlobal:  false,
			},
		},
	}

	tests := []struct {
		collection string
		year       int
		want       string
	}{
		{"persons", 2025, "2025-persons"},
		{"persons", 2024, "2024-persons"},
		{"attendees", 2025, "2025-attendees"},
	}

	for _, tt := range tests {
		t.Run(tt.collection, func(t *testing.T) {
			got := config.GetSheetName(tt.collection, tt.year)
			if got != tt.want {
				t.Errorf("GetSheetName(%q, %d) = %q, want %q", tt.collection, tt.year, got, tt.want)
			}
		})
	}
}

func TestSheetsConfig_GetSheetName_GlobalPrefixed(t *testing.T) {
	// Test that global tables get short "g-" prefix (not "globals-")
	config := &SheetsConfig{
		Tables: map[string]*TableConfig{
			"person_tag_defs": {
				Enabled:   true,
				SheetName: "tag-definitions",
				IsGlobal:  true,
			},
			"custom_field_defs": {
				Enabled:   true,
				SheetName: "custom-field-definitions",
				IsGlobal:  true,
			},
		},
	}

	tests := []struct {
		collection string
		year       int
		want       string
	}{
		{"person_tag_defs", 2025, "g-tag-definitions"},
		{"custom_field_defs", 2024, "g-custom-field-definitions"},
	}

	for _, tt := range tests {
		t.Run(tt.collection, func(t *testing.T) {
			got := config.GetSheetName(tt.collection, tt.year)
			if got != tt.want {
				t.Errorf("GetSheetName(%q, %d) = %q, want %q", tt.collection, tt.year, got, tt.want)
			}
		})
	}
}

func TestSheetsConfig_GetSheetName_FallbackToDefault(t *testing.T) {
	// Test that unknown collections fall back to default naming
	config := &SheetsConfig{
		Tables: map[string]*TableConfig{},
	}

	// Unknown collection should use default format: {year}-{collection-with-hyphens}
	got := config.GetSheetName("unknown_collection", 2025)
	want := "2025-unknown-collection"
	if got != want {
		t.Errorf("GetSheetName(unknown) = %q, want %q", got, want)
	}
}

func TestSheetsConfig_LoadConfig_AutoGeneratesDefaults(t *testing.T) {
	// Test that loading a missing config file auto-generates defaults
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "sheets_export.json")

	// Load config (file doesn't exist)
	config, err := LoadSheetsConfig(configPath)
	if err != nil {
		t.Fatalf("LoadSheetsConfig() error = %v", err)
	}

	// Should have default tables
	if len(config.Tables) == 0 {
		t.Error("Expected default tables to be generated")
	}

	// Check a known default table exists
	if config.Tables["persons"] == nil {
		t.Error("Expected 'persons' table in defaults")
	}

	// Config file should now exist
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		t.Error("Expected config file to be created")
	}
}

func TestSheetsConfig_LoadConfig_ReadsExistingFile(t *testing.T) {
	// Test that loading an existing config file works
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "sheets_export.json")

	// Write a custom config
	customConfig := `{
		"tables": {
			"persons": {
				"enabled": true,
				"sheet_name": "custom-persons-name",
				"is_global": false
			}
		}
	}`
	if err := os.WriteFile(configPath, []byte(customConfig), 0600); err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	// Load config
	config, err := LoadSheetsConfig(configPath)
	if err != nil {
		t.Fatalf("LoadSheetsConfig() error = %v", err)
	}

	// Should have custom value
	if config.Tables["persons"] == nil {
		t.Fatal("Expected 'persons' table")
	}
	if config.Tables["persons"].SheetName != "custom-persons-name" {
		t.Errorf("SheetName = %q, want %q", config.Tables["persons"].SheetName, "custom-persons-name")
	}
}

func TestSheetsConfig_IsTableEnabled(t *testing.T) {
	// Test enabled/disabled table checks
	config := &SheetsConfig{
		Tables: map[string]*TableConfig{
			"enabled_table": {
				Enabled:   true,
				SheetName: "enabled",
				IsGlobal:  false,
			},
			"disabled_table": {
				Enabled:   false,
				SheetName: "disabled",
				IsGlobal:  false,
			},
		},
	}

	if !config.IsTableEnabled("enabled_table") {
		t.Error("Expected enabled_table to be enabled")
	}
	if config.IsTableEnabled("disabled_table") {
		t.Error("Expected disabled_table to be disabled")
	}
	// Unknown tables should be disabled by default
	if config.IsTableEnabled("unknown_table") {
		t.Error("Expected unknown_table to be disabled")
	}
}

func TestSheetsConfig_GetGlobalTables(t *testing.T) {
	// Test getting only global tables
	config := &SheetsConfig{
		Tables: map[string]*TableConfig{
			"persons": {
				Enabled:   true,
				SheetName: "persons",
				IsGlobal:  false,
			},
			"person_tag_defs": {
				Enabled:   true,
				SheetName: "tag-definitions",
				IsGlobal:  true,
			},
			"custom_field_defs": {
				Enabled:   true,
				SheetName: "custom-field-definitions",
				IsGlobal:  true,
			},
			"disabled_global": {
				Enabled:   false,
				SheetName: "disabled",
				IsGlobal:  true,
			},
		},
	}

	globals := config.GetGlobalTables()

	// Should have 2 enabled global tables
	if len(globals) != 2 {
		t.Errorf("Expected 2 global tables, got %d", len(globals))
	}

	// Check both are present
	hasTagDefs := false
	hasCustomFieldDefs := false
	for _, table := range globals {
		if table == "person_tag_defs" {
			hasTagDefs = true
		}
		if table == "custom_field_defs" {
			hasCustomFieldDefs = true
		}
	}
	if !hasTagDefs {
		t.Error("Expected person_tag_defs in global tables")
	}
	if !hasCustomFieldDefs {
		t.Error("Expected custom_field_defs in global tables")
	}
}

func TestSheetsConfig_GetYearTables(t *testing.T) {
	// Test getting only year-specific tables
	config := &SheetsConfig{
		Tables: map[string]*TableConfig{
			"persons": {
				Enabled:   true,
				SheetName: "persons",
				IsGlobal:  false,
			},
			"attendees": {
				Enabled:   true,
				SheetName: "attendees",
				IsGlobal:  false,
			},
			"person_tag_defs": {
				Enabled:   true,
				SheetName: "tag-definitions",
				IsGlobal:  true,
			},
			"disabled_yearly": {
				Enabled:   false,
				SheetName: "disabled",
				IsGlobal:  false,
			},
		},
	}

	yearly := config.GetYearTables()

	// Should have 2 enabled year-specific tables
	if len(yearly) != 2 {
		t.Errorf("Expected 2 year tables, got %d", len(yearly))
	}
}
