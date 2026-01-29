package sync

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
)

// =============================================================================
// Multi-Workbook Tab Ordering
// Simplified ordering for workbooks that contain only one type of data
// =============================================================================

// SortGlobalsWorkbookTabs sorts tabs for the globals workbook.
// Index sheet is always first, followed by other tabs alphabetized.
func SortGlobalsWorkbookTabs(tabs []string) []string {
	// Separate Index from other tabs
	var indexTab string
	var otherTabs []string

	for _, tab := range tabs {
		if tab == indexSheetName {
			indexTab = tab
		} else {
			otherTabs = append(otherTabs, tab)
		}
	}

	// Sort other tabs alphabetically
	sort.Strings(otherTabs)

	// Build result: Index first, then alphabetized
	result := make([]string, 0, len(tabs))
	if indexTab != "" {
		result = append(result, indexTab)
	}
	result = append(result, otherTabs...)

	return result
}

// SortYearWorkbookTabs sorts tabs for a year workbook.
// Tabs are simply alphabetized since they're all the same year.
func SortYearWorkbookTabs(tabs []string) []string {
	sorted := make([]string, len(tabs))
	copy(sorted, tabs)
	sort.Strings(sorted)
	return sorted
}

// =============================================================================
// Multi-Workbook Tab Colors
// Orange for CampMinder-sourced tables, grey for globals and derived tables
// =============================================================================

// Tab colors for multi-workbook architecture
var (
	// TabColorIndex is gold for the master Index sheet
	TabColorIndex = TabColor{R: 1.0, G: 0.84, B: 0.0}

	// TabColorCMSourced is orange for CampMinder-sourced tables in year workbooks
	TabColorCMSourced = TabColor{R: 1.0, G: 0.65, B: 0.0}

	// TabColorDerived is grey for derived/computed tables (not directly from CM)
	TabColorDerived = TabColor{R: 0.85, G: 0.85, B: 0.85}

	// derivedTables lists tables that are computed/derived, not directly from CampMinder
	derivedTables = map[string]bool{
		"Camper History": true,
	}

	// globalTables lists tables in the globals workbook (all get grey)
	globalTables = map[string]bool{
		"Tag Definitions":          true,
		"Custom Field Definitions": true,
		"Financial Categories":     true,
		"Divisions":                true,
	}
)

// GetMultiWorkbookTabColor returns the color for a tab in multi-workbook mode.
// - Index sheet: gold
// - Global tables: grey
// - Derived tables (Camper History): grey
// - CampMinder-sourced tables: orange
func GetMultiWorkbookTabColor(tabName string) TabColor {
	// Index sheet gets gold
	if tabName == indexSheetName {
		return TabColorIndex
	}

	// Global tables get grey
	if globalTables[tabName] {
		return TabColorDerived
	}

	// Derived/computed tables get grey
	if derivedTables[tabName] {
		return TabColorDerived
	}

	// All other year workbook tables are CM-sourced, get orange
	return TabColorCMSourced
}

// =============================================================================
// Multi-Workbook Tab Reordering Functions
// Apply ordering and colors to tabs in a multi-workbook spreadsheet
// =============================================================================

// ReorderGlobalsWorkbookTabs reorganizes tabs in the globals workbook.
// Index first, then other tabs alphabetized, with category colors.
func ReorderGlobalsWorkbookTabs(ctx context.Context, writer SheetsWriter, spreadsheetID string) error {
	// Get all existing sheet tabs
	allSheets, err := writer.GetSheetMetadata(ctx, spreadsheetID)
	if err != nil {
		return fmt.Errorf("getting sheet metadata: %w", err)
	}

	// Build sheet ID map and tab list
	sheetIDByName := make(map[string]int64)
	var tabs []string
	for _, sheet := range allSheets {
		sheetIDByName[sheet.Title] = sheet.SheetID
		tabs = append(tabs, sheet.Title)
	}

	// Sort tabs (Index first, then alphabetized)
	sorted := SortGlobalsWorkbookTabs(tabs)

	slog.Info("Reordering globals workbook tabs",
		"total_tabs", len(sorted),
	)

	// Build batch updates
	updates := make([]TabPropertyUpdate, len(sorted))
	for i, tabName := range sorted {
		color := GetMultiWorkbookTabColor(tabName)
		index := i
		updates[i] = TabPropertyUpdate{
			TabName: tabName,
			SheetID: sheetIDByName[tabName],
			Color:   &color,
			Index:   &index,
		}
	}

	// Apply updates
	if err := writer.BatchUpdateTabProperties(ctx, spreadsheetID, updates); err != nil {
		return fmt.Errorf("batch updating tab properties: %w", err)
	}

	slog.Info("Globals workbook tab reordering complete")
	return nil
}

// ReorderYearWorkbookTabs reorganizes tabs in a year workbook.
// Tabs are alphabetized with category colors.
func ReorderYearWorkbookTabs(ctx context.Context, writer SheetsWriter, spreadsheetID string) error {
	// Get all existing sheet tabs
	allSheets, err := writer.GetSheetMetadata(ctx, spreadsheetID)
	if err != nil {
		return fmt.Errorf("getting sheet metadata: %w", err)
	}

	// Build sheet ID map and tab list
	sheetIDByName := make(map[string]int64)
	var tabs []string
	for _, sheet := range allSheets {
		sheetIDByName[sheet.Title] = sheet.SheetID
		tabs = append(tabs, sheet.Title)
	}

	// Sort tabs alphabetically
	sorted := SortYearWorkbookTabs(tabs)

	slog.Info("Reordering year workbook tabs",
		"total_tabs", len(sorted),
	)

	// Build batch updates
	updates := make([]TabPropertyUpdate, len(sorted))
	for i, tabName := range sorted {
		color := GetMultiWorkbookTabColor(tabName)
		index := i
		updates[i] = TabPropertyUpdate{
			TabName: tabName,
			SheetID: sheetIDByName[tabName],
			Color:   &color,
			Index:   &index,
		}
	}

	// Apply updates
	if err := writer.BatchUpdateTabProperties(ctx, spreadsheetID, updates); err != nil {
		return fmt.Errorf("batch updating tab properties: %w", err)
	}

	slog.Info("Year workbook tab reordering complete")
	return nil
}

// IsReadableTabName returns true if the tab name is a readable multi-workbook name
// (as opposed to legacy year-prefixed names like "2025-attendee" or "g-tag-def")
func IsReadableTabName(tabName string) bool {
	// Readable names don't start with year prefix or "g-"
	if strings.HasPrefix(tabName, "g-") {
		return false
	}
	if len(tabName) >= 4 && tabName[4] == '-' {
		// Check if first 4 chars are a year
		year := ExtractYear(tabName)
		if year >= 2000 {
			return false
		}
	}
	return true
}
