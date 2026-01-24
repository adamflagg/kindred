package sync

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
)

// SheetInfo contains metadata about a sheet tab
type SheetInfo struct {
	Title   string
	SheetID int64
	Index   int
}

// SortExportTabs sorts export tab names in the correct display order:
// 1. Global tabs (g-*) first, alphabetized
// 2. Year tabs ordered by year descending (newest first)
// 3. Within each year, tabs are alphabetized
func SortExportTabs(tabs []string) []string {
	var globals []string
	yearGroups := make(map[int][]string)

	for _, tab := range tabs {
		if strings.HasPrefix(tab, "g-") {
			globals = append(globals, tab)
		} else if year := ExtractYear(tab); year > 0 {
			yearGroups[year] = append(yearGroups[year], tab)
		}
		// Ignore tabs that don't match our patterns
	}

	// Sort globals alphabetically
	sort.Strings(globals)

	// Get years in descending order
	var years []int
	for y := range yearGroups {
		years = append(years, y)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(years)))

	// Build result: globals first, then years descending (each alphabetized)
	result := make([]string, 0, len(tabs))
	result = append(result, globals...)

	for _, year := range years {
		yearTabs := yearGroups[year]
		sort.Strings(yearTabs)
		result = append(result, yearTabs...)
	}

	return result
}

// ReorderAllTabs reorganizes all export tabs into correct positions
// and applies colors. This should be called after all exports complete.
func ReorderAllTabs(ctx context.Context, writer SheetsWriter, spreadsheetID string, exportedTabs []string) error {
	// Sort tabs into correct order
	sorted := SortExportTabs(exportedTabs)

	slog.Info("Reordering and coloring sheet tabs",
		"total_tabs", len(sorted),
		"globals", countGlobals(sorted),
	)

	// Apply colors and indices to each tab
	for i, tabName := range sorted {
		// Set tab color
		color := GetTabColor(tabName)
		if err := writer.SetTabColor(ctx, spreadsheetID, tabName, color); err != nil {
			slog.Warn("Failed to set tab color",
				"tab", tabName,
				"error", err,
			)
			// Continue with other tabs
		}

		// Set tab index (position)
		if err := writer.SetTabIndex(ctx, spreadsheetID, tabName, i); err != nil {
			return fmt.Errorf("setting tab index for %s: %w", tabName, err)
		}
	}

	slog.Info("Tab reordering complete")
	return nil
}

// countGlobals counts how many tabs start with "g-"
func countGlobals(tabs []string) int {
	count := 0
	for _, tab := range tabs {
		if strings.HasPrefix(tab, "g-") {
			count++
		}
	}
	return count
}
