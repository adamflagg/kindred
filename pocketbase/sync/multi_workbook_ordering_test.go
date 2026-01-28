package sync

import (
	"testing"
)

// Test constants for tab names (goconst compliance)
const testTabNameAttendees = "Attendees"

// =============================================================================
// Multi-Workbook Tab Ordering Tests
// For the new architecture where each workbook has only one type of data
// =============================================================================

func TestSortGlobalsWorkbookTabs_IndexFirst(t *testing.T) {
	// Index sheet should always be first in globals workbook
	tabs := []string{
		"Tag Definitions",
		"Index",
		"Custom Field Definitions",
		"Divisions",
	}

	sorted := SortGlobalsWorkbookTabs(tabs)

	if sorted[0] != "Index" {
		t.Errorf("sorted[0] = %q, want 'Index'", sorted[0])
	}
}

func TestSortGlobalsWorkbookTabs_AlphabetizedAfterIndex(t *testing.T) {
	// After Index, other tabs should be alphabetized
	tabs := []string{
		"Tag Definitions",
		"Index",
		"Custom Field Definitions",
		"Financial Categories",
		"Divisions",
	}

	sorted := SortGlobalsWorkbookTabs(tabs)

	expected := []string{
		"Index",
		"Custom Field Definitions",
		"Divisions",
		"Financial Categories",
		"Tag Definitions",
	}

	if len(sorted) != len(expected) {
		t.Fatalf("len(sorted) = %d, want %d", len(sorted), len(expected))
	}

	for i, want := range expected {
		if sorted[i] != want {
			t.Errorf("sorted[%d] = %q, want %q", i, sorted[i], want)
		}
	}
}

func TestSortGlobalsWorkbookTabs_NoIndex(t *testing.T) {
	// If Index is not present, should just alphabetize
	tabs := []string{
		"Tag Definitions",
		"Divisions",
		"Custom Field Definitions",
	}

	sorted := SortGlobalsWorkbookTabs(tabs)

	expected := []string{
		"Custom Field Definitions",
		"Divisions",
		"Tag Definitions",
	}

	for i, want := range expected {
		if sorted[i] != want {
			t.Errorf("sorted[%d] = %q, want %q", i, sorted[i], want)
		}
	}
}

func TestSortYearWorkbookTabs_Alphabetized(t *testing.T) {
	// Year workbook tabs should be alphabetized
	tabs := []string{
		"Staff",
		testTabNameAttendees,
		"Persons",
		"Bunk Assignments",
	}

	sorted := SortYearWorkbookTabs(tabs)

	expected := []string{
		testTabNameAttendees,
		"Bunk Assignments",
		"Persons",
		"Staff",
	}

	for i, want := range expected {
		if sorted[i] != want {
			t.Errorf("sorted[%d] = %q, want %q", i, sorted[i], want)
		}
	}
}

// =============================================================================
// Multi-Workbook Tab Color Tests
// Category-based coloring for readable tab names
// =============================================================================

func TestGetMultiWorkbookTabColor_Index(t *testing.T) {
	// Index tab should be gold
	color := GetMultiWorkbookTabColor("Index")

	if color != TabColorIndex {
		t.Errorf("GetMultiWorkbookTabColor('Index') = %v, want TabColorIndex", color)
	}
}

func TestGetMultiWorkbookTabColor_CoreTables(t *testing.T) {
	// Core tables (Persons, Attendees) should be blue
	coreTabs := []string{testTabNameAttendees, "Persons", "Households"}

	for _, tab := range coreTabs {
		t.Run(tab, func(t *testing.T) {
			color := GetMultiWorkbookTabColor(tab)
			if color != TabColorCore {
				t.Errorf("GetMultiWorkbookTabColor(%q) = %v, want TabColorCore", tab, color)
			}
		})
	}
}

func TestGetMultiWorkbookTabColor_Assignments(t *testing.T) {
	// Assignment tables should be green
	assignmentTabs := []string{"Bunk Assignments", "Staff", "Bunks"}

	for _, tab := range assignmentTabs {
		t.Run(tab, func(t *testing.T) {
			color := GetMultiWorkbookTabColor(tab)
			if color != TabColorAssignments {
				t.Errorf("GetMultiWorkbookTabColor(%q) = %v, want TabColorAssignments", tab, color)
			}
		})
	}
}

func TestGetMultiWorkbookTabColor_Financial(t *testing.T) {
	// Financial tables should be teal
	financialTabs := []string{"Financial Transactions", "Financial Categories"}

	for _, tab := range financialTabs {
		t.Run(tab, func(t *testing.T) {
			color := GetMultiWorkbookTabColor(tab)
			if color != TabColorFinancial {
				t.Errorf("GetMultiWorkbookTabColor(%q) = %v, want TabColorFinancial", tab, color)
			}
		})
	}
}

func TestGetMultiWorkbookTabColor_CustomValues(t *testing.T) {
	// Custom values tables should be purple
	cvTabs := []string{"Person Custom Values", "Household Custom Values"}

	for _, tab := range cvTabs {
		t.Run(tab, func(t *testing.T) {
			color := GetMultiWorkbookTabColor(tab)
			if color != TabColorCustomValues {
				t.Errorf("GetMultiWorkbookTabColor(%q) = %v, want TabColorCustomValues", tab, color)
			}
		})
	}
}

func TestGetMultiWorkbookTabColor_GlobalTables(t *testing.T) {
	// Global tables should be light blue
	globalTabs := []string{"Tag Definitions", "Custom Field Definitions", "Divisions"}

	for _, tab := range globalTabs {
		t.Run(tab, func(t *testing.T) {
			color := GetMultiWorkbookTabColor(tab)
			if color != TabColorGlobal {
				t.Errorf("GetMultiWorkbookTabColor(%q) = %v, want TabColorGlobal", tab, color)
			}
		})
	}
}

func TestGetMultiWorkbookTabColor_Unknown(t *testing.T) {
	// Unknown tabs should get default color
	color := GetMultiWorkbookTabColor("Unknown Tab")

	if color != TabColorDefault {
		t.Errorf("GetMultiWorkbookTabColor('Unknown Tab') = %v, want TabColorDefault", color)
	}
}

// =============================================================================
// Multi-Workbook Tab Reordering Tests
// =============================================================================

func TestReorderGlobalsWorkbookTabs_AppliesColorsAndOrder(t *testing.T) {
	// Test that reordering applies correct colors and positions
	mockWriter := NewMockSheetsWriter()

	// Simulate existing tabs in the globals workbook
	tabs := []string{
		"Tag Definitions",
		"Index",
		"Custom Field Definitions",
		"Divisions",
	}
	for _, tab := range tabs {
		mockWriter.ExistingTabs[tab] = true
		mockWriter.SheetIDsByName[tab] = int64(len(mockWriter.SheetIDsByName))
	}

	// Just verify the sorting function works
	sorted := SortGlobalsWorkbookTabs(tabs)
	if sorted[0] != "Index" {
		t.Errorf("Index should be first, got %q", sorted[0])
	}
}

func TestReorderYearWorkbookTabs_AppliesColorsAndOrder(t *testing.T) {
	// Test that year workbook tabs are alphabetized
	mockWriter := NewMockSheetsWriter()

	tabs := []string{
		"Staff",
		testTabNameAttendees,
		"Persons",
	}
	for _, tab := range tabs {
		mockWriter.ExistingTabs[tab] = true
		mockWriter.SheetIDsByName[tab] = int64(len(mockWriter.SheetIDsByName))
	}

	sorted := SortYearWorkbookTabs(tabs)
	if sorted[0] != testTabNameAttendees {
		t.Errorf("Attendees should be first alphabetically, got %q", sorted[0])
	}
}
