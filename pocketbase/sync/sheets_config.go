package sync

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// TableConfig defines configuration for exporting a single table
type TableConfig struct {
	Enabled   bool   `json:"enabled"`
	SheetName string `json:"sheet_name"`
	IsGlobal  bool   `json:"is_global"`
}

// SheetsConfig holds the configuration for Google Sheets export
type SheetsConfig struct {
	Tables map[string]*TableConfig `json:"tables"`
}

// DefaultSheetName converts a PocketBase collection name to a default sheet name
// Uses lowercase with hyphens instead of underscores (e.g., person_tag_defs → person-tag-defs)
func DefaultSheetName(collection string) string {
	return strings.ReplaceAll(collection, "_", "-")
}

// GetSheetName returns the full sheet tab name for a collection
// For global tables: "g-{sheet_name}" (short prefix for readability)
// For year tables: "{year}-{sheet_name}"
// Falls back to default naming if collection not in config
func (c *SheetsConfig) GetSheetName(collection string, year int) string {
	table := c.Tables[collection]
	if table == nil {
		// Fallback to default naming
		return fmt.Sprintf("%d-%s", year, DefaultSheetName(collection))
	}

	if table.IsGlobal {
		return fmt.Sprintf("g-%s", table.SheetName)
	}
	return fmt.Sprintf("%d-%s", year, table.SheetName)
}

// IsTableEnabled checks if a table is enabled for export
// Returns false for unknown tables
func (c *SheetsConfig) IsTableEnabled(collection string) bool {
	table := c.Tables[collection]
	if table == nil {
		return false
	}
	return table.Enabled
}

// GetGlobalTables returns a list of enabled global table collection names
func (c *SheetsConfig) GetGlobalTables() []string {
	var tables []string
	for name, config := range c.Tables {
		if config.IsGlobal && config.Enabled {
			tables = append(tables, name)
		}
	}
	return tables
}

// GetYearTables returns a list of enabled year-specific table collection names
func (c *SheetsConfig) GetYearTables() []string {
	var tables []string
	for name, config := range c.Tables {
		if !config.IsGlobal && config.Enabled {
			tables = append(tables, name)
		}
	}
	return tables
}

// LoadSheetsConfig loads configuration from a JSON file
// If the file doesn't exist, generates defaults and saves them
func LoadSheetsConfig(configPath string) (*SheetsConfig, error) {
	// Check if file exists
	data, err := os.ReadFile(configPath) //nolint:gosec // Config path is application-controlled
	if err != nil {
		if os.IsNotExist(err) {
			// Generate defaults and save
			config := GenerateDefaultConfig()
			if saveErr := config.Save(configPath); saveErr != nil {
				return nil, fmt.Errorf("saving default config: %w", saveErr)
			}
			return config, nil
		}
		return nil, fmt.Errorf("reading config file: %w", err)
	}

	var config SheetsConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("parsing config file: %w", err)
	}

	return &config, nil
}

// Save writes the configuration to a JSON file
func (c *SheetsConfig) Save(configPath string) error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}

	if err := os.WriteFile(configPath, data, 0600); err != nil {
		return fmt.Errorf("writing config file: %w", err)
	}

	return nil
}

// GenerateDefaultConfig creates a default configuration with all known tables
func GenerateDefaultConfig() *SheetsConfig {
	return &SheetsConfig{
		Tables: map[string]*TableConfig{
			// Year-specific tables (daily exports)
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
			"camp_sessions": {
				Enabled:   true,
				SheetName: "sessions",
				IsGlobal:  false,
			},
			"staff": {
				Enabled:   true,
				SheetName: "staff",
				IsGlobal:  false,
			},
			"bunk_assignments": {
				Enabled:   true,
				SheetName: "bunk-assignments",
				IsGlobal:  false,
			},
			"financial_transactions": {
				Enabled:   true,
				SheetName: "financial-transactions",
				IsGlobal:  false,
			},
			"person_custom_values": {
				Enabled:   true,
				SheetName: "custom-fields-persons",
				IsGlobal:  false,
			},
			"household_custom_values": {
				Enabled:   true,
				SheetName: "custom-fields-households",
				IsGlobal:  false,
			},

			// Global tables (weekly exports)
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
			"financial_categories": {
				Enabled:   true,
				SheetName: "financial-categories",
				IsGlobal:  true,
			},
			"staff_positions": {
				Enabled:   true,
				SheetName: "staff-positions",
				IsGlobal:  true,
			},
		},
	}
}

// KnownGlobalTables returns the list of collections that are considered global
// (not year-scoped) for auto-detection purposes
func KnownGlobalTables() []string {
	return []string{
		"person_tag_defs",
		"custom_field_defs",
		"financial_categories",
		"staff_positions",
		"payment_methods",
		"staff_org_categories",
		"staff_program_areas",
	}
}
