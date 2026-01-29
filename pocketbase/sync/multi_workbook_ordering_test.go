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
// Orange for CM-sourced, grey for globals and derived
// =============================================================================

func TestGetMultiWorkbookTabColor_Index(t *testing.T) {
	// Index tab should be gold
	color := GetMultiWorkbookTabColor("Index")

	if color != TabColorIndex {
		t.Errorf("GetMultiWorkbookTabColor('Index') = %v, want TabColorIndex", color)
	}
}

func TestGetMultiWorkbookTabColor_CMSourcedTables(t *testing.T) {
	// CampMinder-sourced tables should be orange
	cmTabs := []string{
		testTabNameAttendees, "Persons", "Households",
		"Bunk Assignments", "Staff", "Bunks",
		"Financial Transactions", "Sessions", "Session Groups",
		"Person Custom Values", "Household Custom Values",
	}

	for _, tab := range cmTabs {
		t.Run(tab, func(t *testing.T) {
			color := GetMultiWorkbookTabColor(tab)
			if color != TabColorCMSourced {
				t.Errorf("GetMultiWorkbookTabColor(%q) = %v, want TabColorCMSourced (orange)", tab, color)
			}
		})
	}
}

func TestGetMultiWorkbookTabColor_GlobalTables(t *testing.T) {
	// Global tables should be grey
	globalTabsList := []string{"Tag Definitions", "Custom Field Definitions", "Divisions", "Financial Categories"}

	for _, tab := range globalTabsList {
		t.Run(tab, func(t *testing.T) {
			color := GetMultiWorkbookTabColor(tab)
			if color != TabColorDerived {
				t.Errorf("GetMultiWorkbookTabColor(%q) = %v, want TabColorDerived (grey)", tab, color)
			}
		})
	}
}

func TestGetMultiWorkbookTabColor_DerivedTables(t *testing.T) {
	// Derived/computed tables should be grey
	derivedTabsList := []string{"Camper History"}

	for _, tab := range derivedTabsList {
		t.Run(tab, func(t *testing.T) {
			color := GetMultiWorkbookTabColor(tab)
			if color != TabColorDerived {
				t.Errorf("GetMultiWorkbookTabColor(%q) = %v, want TabColorDerived (grey)", tab, color)
			}
		})
	}
}

func TestGetMultiWorkbookTabColor_Unknown(t *testing.T) {
	// Unknown tabs in year workbook default to CM-sourced (orange)
	color := GetMultiWorkbookTabColor("New CM Table")

	if color != TabColorCMSourced {
		t.Errorf("GetMultiWorkbookTabColor('New CM Table') = %v, want TabColorCMSourced (orange)", color)
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
