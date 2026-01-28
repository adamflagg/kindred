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
// Category-based coloring for readable tab names (no year prefixes)
// =============================================================================

// Category-based tab colors for multi-workbook architecture
var (
	// TabColorIndex is gold for the master Index sheet
	TabColorIndex = TabColor{R: 1.0, G: 0.84, B: 0.0}

	// TabColorCore is blue for core people tables (Attendees, Persons, Households)
	TabColorCore = TabColor{R: 0.53, G: 0.81, B: 0.92}

	// TabColorAssignments is green for assignment tables (Staff, Bunks, Bunk Assignments)
	TabColorAssignments = TabColor{R: 0.56, G: 0.93, B: 0.56}

	// TabColorFinancial is teal for financial tables
	TabColorFinancial = TabColor{R: 0.0, G: 0.81, B: 0.82}

	// TabColorCustomValues is purple for custom values tables
	TabColorCustomValues = TabColor{R: 0.73, G: 0.33, B: 0.83}

	// tabCategoryMap maps tab names to their color category
	tabCategoryMap = map[string]TabColor{
		// Index
		indexSheetName: TabColorIndex,

		// Core people tables (blue)
		"Attendees":  TabColorCore,
		"Persons":    TabColorCore,
		"Households": TabColorCore,

		// Assignment tables (green)
		"Bunk Assignments": TabColorAssignments,
		"Staff":            TabColorAssignments,
		"Bunks":            TabColorAssignments,

		// Financial tables (teal)
		"Financial Transactions": TabColorFinancial,
		"Financial Categories":   TabColorFinancial,

		// Custom values (purple)
		"Person Custom Values":    TabColorCustomValues,
		"Household Custom Values": TabColorCustomValues,

		// Global tables (light blue - using existing TabColorGlobal)
		"Tag Definitions":          TabColorGlobal,
		"Custom Field Definitions": TabColorGlobal,
		"Divisions":                TabColorGlobal,

		// Session-related (use core color)
		"Sessions":       TabColorCore,
		"Session Groups": TabColorCore,
		"Camper History": TabColorCore,
	}
)

// GetMultiWorkbookTabColor returns the color for a tab in multi-workbook mode.
// Uses category-based coloring for readable tab names.
func GetMultiWorkbookTabColor(tabName string) TabColor {
	if color, ok := tabCategoryMap[tabName]; ok {
		return color
	}
	return TabColorDefault
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
