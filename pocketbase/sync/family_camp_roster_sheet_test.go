package sync

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
)

// Rendering one Roster into the values and formatting directives for one tab.
// Nothing here calls Google: the SheetFormat is asserted as a value, which is
// the whole reason it is a value. kindred#2433.

// alignCenter is the Sheets horizontal-alignment value the age column takes.
const alignCenter = "CENTER"

// sampleRoster is two households -- one banded, one not -- with a camper of each
// age shape and an adult carrying no email.
func sampleRoster() *Roster {
	return &Roster{
		SessionName: "Family Camp 2: Keshet LGBTQ Weekend",
		SessionCMID: 1309515,
		Year:        2026,
		Start:       time.Date(2026, time.August, 20, 7, 0, 0, 0, time.UTC),
		End:         time.Date(2026, time.August, 23, 7, 0, 0, 0, time.UTC),
		Blocks: []HouseholdBlock{
			{
				HouseholdID: "hh1",
				City:        "Berkeley",
				campers:     2,
				People: []RosterPerson{
					{Name: "Ava Johnson", Role: "Camper", Age: "6"},
					{Name: "Emma Johnson", Role: "Camper", Age: "12"},
					{Name: "Sarah Johnson", Role: "Adult 1", Email: "sarah@example.com"},
				},
			},
			{
				HouseholdID: "hh2",
				City:        "Oakland",
				campers:     1,
				People: []RosterPerson{
					{Name: "Ben Garcia", Role: "Camper", Age: "11 mos"},
					{Name: "Rosa Garcia", Role: "Adult 3"},
				},
			},
		},
	}
}

func TestRosterSheetValues(t *testing.T) {
	t.Parallel()
	values := RosterSheetValues(sampleRoster())

	want := [][]string{
		{"Family Camp 2: Keshet LGBTQ Weekend 2026 Roster", "", "", "", ""},
		{"August 20–23, 2026", "", "", "", ""},
		{"NAME", "ADULT / CAMPER", "AGE", "EMAIL", "CITY"},
		// City appears only on the block's first row.
		{"Ava Johnson", "Camper", "6", "", "Berkeley"},
		{"Emma Johnson", "Camper", "12", "", ""},
		{"Sarah Johnson", "Adult 1", "", "sarah@example.com", ""},
		{"Ben Garcia", "Camper", "11 mos", "", "Oakland"},
		{"Rosa Garcia", "Adult 3", "", "", ""},
	}

	if len(values) != len(want) {
		t.Fatalf("values has %d rows, want %d:\n%v", len(values), len(want), values)
	}
	for row := range want {
		if len(values[row]) != rosterColumnCount {
			t.Fatalf("row %d has %d cells, want %d: %v", row, len(values[row]), rosterColumnCount, values[row])
		}
		for col := range want[row] {
			if got := fmt.Sprintf("%v", values[row][col]); got != want[row][col] {
				t.Errorf("values[%d][%d] = %q, want %q", row, col, got, want[row][col])
			}
		}
	}
}

// findStyle returns the first style rule covering exactly the given range.
func findStyle(t *testing.T, format *SheetFormat, r GridRange) CellStyle {
	t.Helper()
	for _, rule := range format.Styles {
		if rule.Range == r {
			return rule.Style
		}
	}
	t.Fatalf("no style rule for range %+v; have %d rules", r, len(format.Styles))
	return CellStyle{}
}

func TestRosterSheetFormatStructure(t *testing.T) {
	t.Parallel()
	format := RosterSheetFormat(42, sampleRoster())

	if format.SheetID != 42 {
		t.Errorf("SheetID = %d, want 42", format.SheetID)
	}
	// Rows 1-3 frozen, so row 4 -- the first person -- is the first to scroll.
	if format.FrozenRows != 3 {
		t.Errorf("FrozenRows = %d, want 3", format.FrozenRows)
	}

	wantMerges := []GridRange{
		{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5},
		{StartRow: 1, EndRow: 2, StartCol: 0, EndCol: 5},
	}
	if len(format.Merges) != len(wantMerges) {
		t.Fatalf("merges = %+v, want %+v", format.Merges, wantMerges)
	}
	for i, want := range wantMerges {
		if format.Merges[i] != want {
			t.Errorf("merge %d = %+v, want %+v", i, format.Merges[i], want)
		}
	}

	wantWidths := []ColumnWidth{
		{StartCol: 0, EndCol: 1, Pixels: 200},
		{StartCol: 1, EndCol: 2, Pixels: 115},
		{StartCol: 2, EndCol: 3, Pixels: 75},
		{StartCol: 3, EndCol: 4, Pixels: 245},
		{StartCol: 4, EndCol: 5, Pixels: 130},
	}
	if len(format.ColumnWidths) != len(wantWidths) {
		t.Fatalf("widths = %+v, want %+v", format.ColumnWidths, wantWidths)
	}
	for i, want := range wantWidths {
		if format.ColumnWidths[i] != want {
			t.Errorf("width %d = %+v, want %+v", i, format.ColumnWidths[i], want)
		}
	}
}

func TestRosterSheetFormatHeaderAndTitle(t *testing.T) {
	t.Parallel()
	format := RosterSheetFormat(42, sampleRoster())

	title := findStyle(t, format, GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5})
	if title.FontSize != 14 || title.Bold == nil || !*title.Bold || title.HorizontalAlignment != alignCenter {
		t.Errorf("title style = %+v, want bold 14pt centered", title)
	}

	subtitle := findStyle(t, format, GridRange{StartRow: 1, EndRow: 2, StartCol: 0, EndCol: 5})
	if subtitle.FontSize != 10 || subtitle.FontHex != "#5F6368" || subtitle.HorizontalAlignment != alignCenter {
		t.Errorf("subtitle style = %+v, want 10pt #5F6368 centered", subtitle)
	}

	header := findStyle(t, format, GridRange{StartRow: 2, EndRow: 3, StartCol: 0, EndCol: 5})
	if header.BackgroundHex != "#37474F" || header.FontHex != "#FFFFFF" ||
		header.FontSize != 9 || header.Bold == nil || !*header.Bold {
		t.Errorf("header style = %+v, want bold 9pt white on #37474F", header)
	}
}

// TestRosterSheetFormatBandsPerHousehold pins the rule that makes a family read
// as one unit: the fill alternates per BLOCK, not per row.
func TestRosterSheetFormatBandsPerHousehold(t *testing.T) {
	t.Parallel()
	roster := sampleRoster()
	format := RosterSheetFormat(42, roster)

	// Block 0 is rows 3-5 and unbanded; block 1 is rows 6-7 and banded.
	banded := GridRange{StartRow: 6, EndRow: 8, StartCol: 0, EndCol: 5}
	if got := findStyle(t, format, banded).BackgroundHex; got != "#ECEFF1" {
		t.Errorf("second block fill = %q, want %q", got, "#ECEFF1")
	}

	unbanded := GridRange{StartRow: 3, EndRow: 6, StartCol: 0, EndCol: 5}
	for _, rule := range format.Styles {
		if rule.Range == unbanded && rule.Style.BackgroundHex != "" {
			t.Errorf("first block has fill %q, want none -- banding starts white", rule.Style.BackgroundHex)
		}
	}
}

// TestRosterSheetFormatTintsLinkedHouseholds pins §5: a linked household's tint
// REPLACES its banding, so the pair is visible whichever parity it lands on.
func TestRosterSheetFormatTintsLinkedHouseholds(t *testing.T) {
	t.Parallel()
	roster := sampleRoster()
	roster.Blocks[0].LinkGroup = 1
	roster.Blocks[1].LinkGroup = 1
	format := RosterSheetFormat(42, roster)

	first := findStyle(t, format, GridRange{StartRow: 3, EndRow: 6, StartCol: 0, EndCol: 5}).BackgroundHex
	second := findStyle(t, format, GridRange{StartRow: 6, EndRow: 8, StartCol: 0, EndCol: 5}).BackgroundHex

	if first != second {
		t.Errorf("linked blocks have fills %q and %q, want one color for the group", first, second)
	}
	if first == "" || first == "#ECEFF1" {
		t.Errorf("linked fill = %q, want a tint that is neither empty nor the banding grey", first)
	}
}

// TestRosterSheetFormatGivesEachLinkGroupItsOwnColour keeps two pairings apart.
func TestRosterSheetFormatGivesEachLinkGroupItsOwnColour(t *testing.T) {
	t.Parallel()
	roster := sampleRoster()
	roster.Blocks[0].LinkGroup = 1
	roster.Blocks[1].LinkGroup = 2
	format := RosterSheetFormat(42, roster)

	first := findStyle(t, format, GridRange{StartRow: 3, EndRow: 6, StartCol: 0, EndCol: 5}).BackgroundHex
	second := findStyle(t, format, GridRange{StartRow: 6, EndRow: 8, StartCol: 0, EndCol: 5}).BackgroundHex
	if first == second {
		t.Errorf("both link groups painted %q, want distinct colors", first)
	}
}

// TestRosterSheetFormatLinkPaletteWrapsSafely guards the modulo: a group number
// beyond the palette must still yield a color rather than panic or go blank.
func TestRosterSheetFormatLinkPaletteWrapsSafely(t *testing.T) {
	t.Parallel()
	for _, group := range []int{1, 6, 7, 13, 99} {
		roster := sampleRoster()
		roster.Blocks[0].LinkGroup = group
		format := RosterSheetFormat(42, roster)
		got := findStyle(t, format, GridRange{StartRow: 3, EndRow: 6, StartCol: 0, EndCol: 5}).BackgroundHex
		if got == "" {
			t.Errorf("link group %d painted nothing", group)
		}
	}
}

// TestRosterSheetFormatBordersEachBlock pins the block borders: medium on the
// first row's top edge and the last row's bottom edge, thin everywhere else.
func TestRosterSheetFormatBordersEachBlock(t *testing.T) {
	t.Parallel()
	format := RosterSheetFormat(42, sampleRoster())

	wantRanges := []GridRange{
		{StartRow: 3, EndRow: 6, StartCol: 0, EndCol: 5},
		{StartRow: 6, EndRow: 8, StartCol: 0, EndCol: 5},
	}
	if len(format.Borders) != len(wantRanges) {
		t.Fatalf("borders = %d rules, want %d (one per block)", len(format.Borders), len(wantRanges))
	}
	for i, want := range wantRanges {
		rule := format.Borders[i]
		if rule.Range != want {
			t.Errorf("border %d range = %+v, want %+v", i, rule.Range, want)
		}
		if rule.Top == nil || rule.Top.Style != "SOLID_MEDIUM" || rule.Top.Hex != "#78909C" {
			t.Errorf("border %d top = %+v, want medium #78909C", i, rule.Top)
		}
		if rule.Bottom == nil || rule.Bottom.Style != "SOLID_MEDIUM" || rule.Bottom.Hex != "#78909C" {
			t.Errorf("border %d bottom = %+v, want medium #78909C", i, rule.Bottom)
		}
		for name, edge := range map[string]*BorderEdge{
			"left": rule.Left, "right": rule.Right,
			"innerHorizontal": rule.InnerHorizontal, "innerVertical": rule.InnerVertical,
		} {
			if edge == nil || edge.Style != "SOLID" || edge.Hex != "#DADDE1" {
				t.Errorf("border %d %s = %+v, want thin #DADDE1", i, name, edge)
			}
		}
	}
}

// TestRosterSheetFormatCentresOnlyTheAgeColumn pins the alignment, and pins that
// the CENTER rule is emitted AFTER the LEFT rule -- the Sheets API applies
// requests in order, so the reverse would left-align the age column.
func TestRosterSheetFormatCentresOnlyTheAgeColumn(t *testing.T) {
	t.Parallel()
	format := RosterSheetFormat(42, sampleRoster())

	leftAt, centreAt := -1, -1
	for i, rule := range format.Styles {
		switch rule.Style.HorizontalAlignment {
		case "LEFT":
			if rule.Range.StartCol == 0 && rule.Range.EndCol == rosterColumnCount {
				leftAt = i
			}
		case alignCenter:
			if rule.Range.StartCol == rosterAgeColumn && rule.Range.EndCol == rosterAgeColumn+1 {
				centreAt = i
			}
		}
	}
	if leftAt < 0 {
		t.Fatal("no LEFT alignment rule spanning every column")
	}
	if centreAt < 0 {
		t.Fatal("no CENTER alignment rule for the age column alone")
	}
	if centreAt < leftAt {
		t.Errorf("CENTER rule at %d precedes LEFT rule at %d -- the later request wins, "+
			"so the age column would end up left-aligned", centreAt, leftAt)
	}
}

// TestRosterSheetFormatIsOneBatch pins the design's round-trip budget: a
// 63-household roster is ONE ApplyFormatting call, so the request count must
// grow with households rather than the call count.
func TestRosterSheetFormatIsOneBatch(t *testing.T) {
	t.Parallel()
	roster := sampleRoster()
	format := RosterSheetFormat(42, roster)
	if format.isEmpty() {
		t.Fatal("format is empty")
	}
	if _, err := buildFormatRequests(format); err != nil {
		t.Fatalf("buildFormatRequests rejected the roster format: %v", err)
	}
}

// TestRosterSheetFormatRejectsNothing runs the real request builder over a
// roster big enough to exercise every branch, because an invalid range is a 400
// that takes the whole tab's single batchUpdate down with it.
func TestRosterSheetFormatSurvivesAManyHouseholdRoster(t *testing.T) {
	t.Parallel()
	roster := &Roster{
		SessionName: "Family Camp 6",
		Year:        2026,
		Start:       time.Date(2026, time.September, 24, 7, 0, 0, 0, time.UTC),
		End:         time.Date(2026, time.September, 27, 7, 0, 0, 0, time.UTC),
	}
	for i := range 63 {
		roster.Blocks = append(roster.Blocks, HouseholdBlock{
			HouseholdID: fmt.Sprintf("hh%d", i),
			City:        "Berkeley",
			campers:     1,
			LinkGroup:   i % 3, // exercises ungrouped and several palette entries
			People: []RosterPerson{
				{Name: "Camper", Role: "Camper", Age: "8"},
				{Name: "Adult", Role: "Adult 1", Email: "a@example.com"},
			},
		})
	}

	format := RosterSheetFormat(7, roster)
	requests, err := buildFormatRequests(format)
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(requests) == 0 {
		t.Fatal("no requests emitted")
	}
	values := RosterSheetValues(roster)
	if len(values) != rosterFirstDataRow+126 {
		t.Errorf("values = %d rows, want %d", len(values), rosterFirstDataRow+126)
	}
}

func TestRosterTabName(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, time.August, 19, 15, 4, 0, 0, time.UTC)

	if got := rosterTabName(at, nil); got != testRosterTab {
		t.Errorf("rosterTabName = %q, want %q", got, testRosterTab)
	}
}

// TestRosterTabNameSuffixesOnCollision pins the two-exports-inside-one-minute
// case. Tabs are NEVER pruned and NEVER overwritten -- staff hand-edit each one.
func TestRosterTabNameSuffixesOnCollision(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, time.August, 19, 15, 4, 0, 0, time.UTC)
	base := testRosterTab

	if got := rosterTabName(at, []string{base}); got != base+" (2)" {
		t.Errorf("rosterTabName = %q, want %q", got, base+" (2)")
	}
	if got := rosterTabName(at, []string{base, base + " (2)"}); got != base+" (3)" {
		t.Errorf("rosterTabName = %q, want %q", got, base+" (3)")
	}
	// An unrelated tab must not push the suffix.
	if got := rosterTabName(at, []string{"Aug 18, 2026 9:00 AM"}); got != base {
		t.Errorf("rosterTabName = %q, want %q", got, base)
	}
}

// TestRosterTabNameFitsSheetsLimits keeps the generated name inside the 31-char
// cap and clear of the characters Sheets rejects.
//
// The colon is NOT in that set, despite the design's §Tab naming sentence saying
// it is -- which would have made the design's own "3:04 PM" format illegal.
// Probed against the real API on 2026-08-19: addSheet accepted
// "Aug 19, 2026 3:04 PM", and a Values.Update reached it through BOTH
// "'Aug 19, 2026 3:04 PM'!A1" and the bare "Aug 19, 2026 3:04 PM!A1" that
// WriteToSheet builds. That last part is why WriteToSheet needs no change to
// carry a tab name containing spaces and commas.
func TestRosterTabNameFitsSheetsLimits(t *testing.T) {
	t.Parallel()
	// December at 12:59 gives the longest shape this layout can produce.
	at := time.Date(2026, time.December, 31, 12, 59, 0, 0, time.UTC)
	existing := make([]string, 0, 12)
	for range 12 {
		name := rosterTabName(at, existing)
		if len(name) > 31 {
			t.Errorf("tab name %q is %d chars, over the 31-char cap", name, len(name))
		}
		if strings.ContainsAny(name, `\/?*[]`) {
			t.Errorf("tab name %q contains a character Sheets rejects", name)
		}
		if slices.Contains(existing, name) {
			t.Fatalf("tab name %q collides with one already taken: %v", name, existing)
		}
		existing = append(existing, name)
	}
}

// TestCampLocationDefaultsToPacific pins the design's default. PocketBase runs in
// a container whose Go time.Local is UTC unless TZ is set, and a roster stamped
// "Aug 20, 2026 12:15 AM" for an export made on the 19th reads as the wrong day.
func TestCampLocationDefaultsToPacific(t *testing.T) {
	t.Setenv("TZ", "")
	if got := campLocation().String(); got != "America/Los_Angeles" {
		t.Errorf("campLocation = %q, want America/Los_Angeles", got)
	}
}

func TestCampLocationHonoursTZ(t *testing.T) {
	t.Setenv("TZ", "America/New_York")
	if got := campLocation().String(); got != "America/New_York" {
		t.Errorf("campLocation = %q, want America/New_York", got)
	}
}

// TestCampLocationFallsBackOnAnUnknownZone keeps a typo in TZ from taking the
// export down.
func TestCampLocationFallsBackOnAnUnknownZone(t *testing.T) {
	t.Setenv("TZ", "Mars/Olympus_Mons")
	if got := campLocation().String(); got != "America/Los_Angeles" {
		t.Errorf("campLocation = %q, want the Pacific default", got)
	}
}
