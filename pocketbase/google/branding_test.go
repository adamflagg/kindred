package google

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetCampName_DefaultFallback(t *testing.T) {
	// Reset cache for clean test
	resetBrandingCache()

	// When no branding file exists, should return default "Kindred"
	got := GetCampName()
	if got != DefaultCampName {
		t.Errorf("GetCampName() without config = %q, want %q", got, DefaultCampName)
	}
}

func TestGetCampName_FromConfigFile(t *testing.T) {
	// Create a temporary branding config file
	tempDir := t.TempDir()
	configDir := filepath.Join(tempDir, "config")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("Failed to create temp config dir: %v", err)
	}

	brandingFile := filepath.Join(configDir, "branding.local.json")
	content := `{"camp_name": "Camp Tawonga", "camp_name_short": "Tawonga"}`
	if err := os.WriteFile(brandingFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write temp branding file: %v", err)
	}

	// Reset cache and set config path
	resetBrandingCache()
	oldConfigPath := configBasePath
	configBasePath = tempDir
	defer func() { configBasePath = oldConfigPath }()

	got := GetCampName()
	if got != "Camp Tawonga" {
		t.Errorf("GetCampName() = %q, want %q", got, "Camp Tawonga")
	}
}

func TestGetCampName_InvalidJSON(t *testing.T) {
	// Create a temporary branding config file with invalid JSON
	tempDir := t.TempDir()
	configDir := filepath.Join(tempDir, "config")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("Failed to create temp config dir: %v", err)
	}

	brandingFile := filepath.Join(configDir, "branding.local.json")
	content := `not valid json`
	if err := os.WriteFile(brandingFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write temp branding file: %v", err)
	}

	// Reset cache and set config path
	resetBrandingCache()
	oldConfigPath := configBasePath
	configBasePath = tempDir
	defer func() { configBasePath = oldConfigPath }()

	// Should fall back to default when JSON is invalid
	got := GetCampName()
	if got != DefaultCampName {
		t.Errorf("GetCampName() with invalid JSON = %q, want %q", got, DefaultCampName)
	}
}

func TestGetCampName_EmptyCampName(t *testing.T) {
	// Create a temporary branding config file with empty camp_name
	tempDir := t.TempDir()
	configDir := filepath.Join(tempDir, "config")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("Failed to create temp config dir: %v", err)
	}

	brandingFile := filepath.Join(configDir, "branding.local.json")
	content := `{"camp_name": "", "camp_name_short": "Test"}`
	if err := os.WriteFile(brandingFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write temp branding file: %v", err)
	}

	// Reset cache and set config path
	resetBrandingCache()
	oldConfigPath := configBasePath
	configBasePath = tempDir
	defer func() { configBasePath = oldConfigPath }()

	// Should fall back to default when camp_name is empty
	got := GetCampName()
	if got != DefaultCampName {
		t.Errorf("GetCampName() with empty camp_name = %q, want %q", got, DefaultCampName)
	}
}

func TestGetCampName_Cached(t *testing.T) {
	// Create a temporary branding config file
	tempDir := t.TempDir()
	configDir := filepath.Join(tempDir, "config")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("Failed to create temp config dir: %v", err)
	}

	brandingFile := filepath.Join(configDir, "branding.local.json")
	content := `{"camp_name": "First Value"}`
	if err := os.WriteFile(brandingFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write temp branding file: %v", err)
	}

	// Reset cache and set config path
	resetBrandingCache()
	oldConfigPath := configBasePath
	configBasePath = tempDir
	defer func() { configBasePath = oldConfigPath }()

	// First call should load from file
	got1 := GetCampName()
	if got1 != "First Value" {
		t.Errorf("GetCampName() first call = %q, want %q", got1, "First Value")
	}

	// Change the file
	content2 := `{"camp_name": "Second Value"}`
	if err := os.WriteFile(brandingFile, []byte(content2), 0644); err != nil {
		t.Fatalf("Failed to write second branding file: %v", err)
	}

	// Second call should return cached value (not re-read file)
	got2 := GetCampName()
	if got2 != "First Value" {
		t.Errorf("GetCampName() second call (cached) = %q, want %q", got2, "First Value")
	}
}

func TestFormatWorkbookTitle_Globals(t *testing.T) {
	// Reset cache for clean test
	resetBrandingCache()

	title := FormatWorkbookTitle("globals", 0)
	// With default camp name
	expected := DefaultCampName + " Data - Globals"
	if title != expected {
		t.Errorf("FormatWorkbookTitle(globals, 0) = %q, want %q", title, expected)
	}
}

func TestFormatWorkbookTitle_Year(t *testing.T) {
	// Reset cache for clean test
	resetBrandingCache()

	title := FormatWorkbookTitle("year", 2025)
	expected := DefaultCampName + " Data - 2025"
	if title != expected {
		t.Errorf("FormatWorkbookTitle(year, 2025) = %q, want %q", title, expected)
	}
}

func TestFormatWorkbookTitle_WithCampName(t *testing.T) {
	// Create a temporary branding config file
	tempDir := t.TempDir()
	configDir := filepath.Join(tempDir, "config")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("Failed to create temp config dir: %v", err)
	}

	brandingFile := filepath.Join(configDir, "branding.local.json")
	content := `{"camp_name": "Camp Tawonga"}`
	if err := os.WriteFile(brandingFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write temp branding file: %v", err)
	}

	// Reset cache and set config path
	resetBrandingCache()
	oldConfigPath := configBasePath
	configBasePath = tempDir
	defer func() { configBasePath = oldConfigPath }()

	globalsTitle := FormatWorkbookTitle("globals", 0)
	if globalsTitle != "Camp Tawonga Data - Globals" {
		t.Errorf("FormatWorkbookTitle(globals) = %q, want %q", globalsTitle, "Camp Tawonga Data - Globals")
	}

	yearTitle := FormatWorkbookTitle("year", 2025)
	if yearTitle != "Camp Tawonga Data - 2025" {
		t.Errorf("FormatWorkbookTitle(year, 2025) = %q, want %q", yearTitle, "Camp Tawonga Data - 2025")
	}
}
