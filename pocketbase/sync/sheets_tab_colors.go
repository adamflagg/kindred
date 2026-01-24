package sync

import (
	"strconv"
	"strings"
)

// TabColor represents an RGB color for Google Sheets tab coloring
type TabColor struct {
	R float64 `json:"r"`
	G float64 `json:"g"`
	B float64 `json:"b"`
}

// Predefined tab colors for visual grouping
var (
	// TabColorGlobal is light blue for global tables (g-*)
	TabColorGlobal = TabColor{R: 0.68, G: 0.85, B: 0.90}

	// TabColor2024 is light green for 2024 data
	TabColor2024 = TabColor{R: 0.56, G: 0.93, B: 0.56}

	// TabColor2025 is purple for 2025 data
	TabColor2025 = TabColor{R: 0.73, G: 0.33, B: 0.83}

	// TabColor2026 is orange for 2026 data
	TabColor2026 = TabColor{R: 1.0, G: 0.65, B: 0.0}

	// TabColorDefault is light gray for unknown tabs
	TabColorDefault = TabColor{R: 0.9, G: 0.9, B: 0.9}

	// colorPalette is used for years 2027+ (cycles through)
	colorPalette = []TabColor{
		{R: 0.53, G: 0.81, B: 0.92}, // Sky blue
		{R: 1.0, G: 0.71, B: 0.76},  // Light pink
		{R: 0.69, G: 0.88, B: 0.69}, // Light green
		{R: 1.0, G: 0.93, B: 0.55},  // Light yellow
		{R: 0.87, G: 0.72, B: 0.87}, // Light lavender
		{R: 0.96, G: 0.64, B: 0.64}, // Light coral
	}

	// yearColorMap maps known years to their specific colors
	yearColorMap = map[int]TabColor{
		2024: TabColor2024,
		2025: TabColor2025,
		2026: TabColor2026,
	}
)

// GetTabColor returns the appropriate color for a sheet tab name
// Global tabs (g-*) get light blue, year tabs get year-specific colors
func GetTabColor(tabName string) TabColor {
	// Global tabs
	if strings.HasPrefix(tabName, "g-") {
		return TabColorGlobal
	}

	// Year tabs
	year := ExtractYear(tabName)
	if year == 0 {
		return TabColorDefault
	}

	// Check for known year colors
	if color, ok := yearColorMap[year]; ok {
		return color
	}

	// Future years (2027+) cycle through palette
	// Use year mod palette length to pick a color
	paletteIndex := (year - 2027) % len(colorPalette)
	if paletteIndex < 0 {
		paletteIndex = 0
	}
	return colorPalette[paletteIndex]
}

// ExtractYear extracts the year from a tab name like "2025-attendees"
// Returns 0 if no valid year is found
func ExtractYear(tabName string) int {
	// Tab name must be at least 4 characters for a year
	if len(tabName) < 4 {
		return 0
	}

	// Extract first 4 characters as potential year
	yearStr := tabName[:4]
	year, err := strconv.Atoi(yearStr)
	if err != nil {
		return 0
	}

	// Sanity check: year should be reasonable (2000+)
	if year < 2000 {
		return 0
	}

	return year
}
