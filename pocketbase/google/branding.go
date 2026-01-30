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

	// devPrefix is added to workbook titles in dev environments to distinguish from production
	devPrefix = "(DEV) "
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
// Tries multiple paths for different runtime contexts:
// 1. Production Docker: PocketBase runs from /, config at /app/config/
// 2. Dev from project root: ./config/
// 3. Dev from pocketbase/: ../config/
// Returns DefaultCampName if the file doesn't exist or is invalid.
func loadCampName() string {
	configPaths := []string{
		"/app/config/" + brandingFileName,                               // Docker production
		filepath.Join(configBasePath, "config", brandingFileName),       // Running from project root
		filepath.Join(configBasePath, "..", "config", brandingFileName), // Running from pocketbase/
	}

	for _, configPath := range configPaths {
		data, err := os.ReadFile(configPath) //nolint:gosec // G304: path is from trusted config
		if err != nil {
			continue // Try next path
		}

		var config brandingConfig
		if err := json.Unmarshal(data, &config); err != nil {
			continue // Try next path
		}

		if config.CampName != "" {
			return config.CampName
		}
	}

	return DefaultCampName
}

// isDevEnvironment returns true if running in local dev (not Docker production)
func isDevEnvironment() bool {
	// IS_DOCKER is set in production Docker containers
	return os.Getenv("IS_DOCKER") == ""
}

// FormatWorkbookTitle generates a Google Sheets workbook title.
// For globals: "{Camp Name} Data - Globals"
// For year: "{Camp Name} Data - {Year}"
// In dev environments, adds "(DEV) " prefix to distinguish from production.
func FormatWorkbookTitle(workbookType string, year int) string {
	campName := GetCampName()
	prefix := ""
	if isDevEnvironment() {
		prefix = devPrefix
	}

	if workbookType == "globals" {
		return fmt.Sprintf("%s%s CM Data - Globals", prefix, campName)
	}

	return fmt.Sprintf("%s%s CM Data - %d", prefix, campName, year)
}
