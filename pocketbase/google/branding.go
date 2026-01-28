// Package google provides Google API client initialization and configuration.
package google

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const (
	// DefaultCampName is the fallback when no branding config is found
	DefaultCampName = "Kindred"

	// brandingFileName is the name of the local branding config file
	brandingFileName = "branding.local.json"
)

// configBasePath is the base path for config files. Can be overridden in tests.
var configBasePath = "."

// brandingConfig holds the parsed branding configuration
type brandingConfig struct {
	CampName      string `json:"camp_name"`
	CampNameShort string `json:"camp_name_short"`
}

// Cached branding data
var (
	cachedCampName string
	brandingOnce   sync.Once
	brandingMu     sync.Mutex
)

// resetBrandingCache clears the cached branding data (for testing)
func resetBrandingCache() {
	brandingMu.Lock()
	defer brandingMu.Unlock()
	cachedCampName = ""
	brandingOnce = sync.Once{}
}

// GetCampName returns the camp name from branding config, or DefaultCampName if not found.
// The value is cached after first load.
func GetCampName() string {
	brandingOnce.Do(func() {
		cachedCampName = loadCampName()
	})
	return cachedCampName
}

// loadCampName reads the camp name from the branding config file.
// Returns DefaultCampName if the file doesn't exist or is invalid.
func loadCampName() string {
	configPath := filepath.Join(configBasePath, "config", brandingFileName)

	data, err := os.ReadFile(configPath) //nolint:gosec // G304: path is from trusted config
	if err != nil {
		// File doesn't exist or can't be read - use default
		return DefaultCampName
	}

	var config brandingConfig
	if err := json.Unmarshal(data, &config); err != nil {
		// Invalid JSON - use default
		return DefaultCampName
	}

	if config.CampName == "" {
		// Empty camp name - use default
		return DefaultCampName
	}

	return config.CampName
}

// FormatWorkbookTitle generates a Google Sheets workbook title.
// For globals: "{Camp Name} Data - Globals"
// For year: "{Camp Name} Data - {Year}"
func FormatWorkbookTitle(workbookType string, year int) string {
	campName := GetCampName()

	if workbookType == "globals" {
		return fmt.Sprintf("%s Data - Globals", campName)
	}

	return fmt.Sprintf("%s Data - %d", campName, year)
}
