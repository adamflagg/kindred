package sync

import (
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strings"
	"time"

	// The roster stamps its tab name in camp-local time, so time.LoadLocation
	// must work. PocketBase ships on chainguard/static, which carries no
	// guarantee of /usr/share/zoneinfo, and a LoadLocation that silently failed
	// would date an evening export to the next day. Embedding the database costs
	// ~450KB and removes the dependency on the base image entirely.
	_ "time/tzdata"

	"github.com/pocketbase/pocketbase/tools/types"
)

// Rendering one Roster into the values and formatting directives for one tab.
// No Google calls: the SheetFormat is a value, asserted as a value in tests.
// kindred#2433.

// The sheet's shape. Row and column indices are 0-based, matching GridRange.
const (
	rosterTitleRow     = 0
	rosterSubtitleRow  = 1
	rosterHeaderRow    = 2
	rosterFirstDataRow = 3

	rosterNameColumn  = 0
	rosterRoleColumn  = 1
	rosterAgeColumn   = 2
	rosterEmailColumn = 3
	rosterCityColumn  = 4

	rosterColumnCount = 5
)

// rosterHeaders are upper-cased on the way out, matching the hand-made sheet.
var rosterHeaders = [rosterColumnCount]string{"Name", "Adult / Camper", "Age", "Email", "City"}

// rosterColumnPixels are the widths from the design, in the header order above.
var rosterColumnPixels = [rosterColumnCount]int{200, 115, 75, 245, 130}

// The palette. Every color here is stated once and read from both the fills and
// the borders, so a change lands in one place.
const (
	rosterBandHex     = "#ECEFF1" // alternating household banding
	rosterHeaderBgHex = "#37474F"
	rosterHeaderFgHex = "#FFFFFF"
	rosterSubtitleHex = "#5F6368"
	rosterRoleHex     = "#455A64"
	rosterBlockEdge   = "#78909C" // medium, the block's top and bottom
	rosterCellEdge    = "#DADDE1" // thin, everywhere else
)

// rosterLinkTints are the six pale fills a linked-household group can take
// (design §5). They REPLACE the banding rather than sitting alongside it, so a
// linked pair is visible whichever parity it lands on.
//
// Only three of 2026's ten family weekends contain any linked households at all,
// and the most in one weekend is two groups -- six is already generous, and
// group numbers wrap rather than run out.
var rosterLinkTints = [...]string{
	"#FFF8E1", // amber
	"#E8F5E9", // green
	"#E3F2FD", // blue
	"#FCE4EC", // pink
	"#F3E5F5", // purple
	"#FFF3E0", // orange
}

// rosterTabLayout is the tab name's timestamp format, e.g. "Aug 19, 2026 3:04 PM".
const rosterTabLayout = "Jan 2, 2006 3:04 PM"

// defaultCampTimezone is the fallback when TZ is unset, matching
// docker-compose.yml's `TZ=${TZ:-America/Los_Angeles}`.
const defaultCampTimezone = "America/Los_Angeles"

// RosterSheetValues renders the roster's cell values, ready for WriteToSheet.
//
// The City is written only on a block's FIRST row: it describes the household,
// and repeating it down every row is what makes the hand-made sheet read as a
// list of people rather than a list of families.
func RosterSheetValues(roster *Roster) [][]any {
	rows := make([][]any, 0, rosterFirstDataRow+roster.PersonCount())

	title := blankRosterRow()
	title[rosterNameColumn] = fmt.Sprintf("%s %d Roster", roster.SessionName, roster.Year)
	rows = append(rows, title)

	subtitle := blankRosterRow()
	subtitle[rosterNameColumn] = formatRosterDateRange(roster.Start, roster.End)
	rows = append(rows, subtitle)

	header := blankRosterRow()
	for col, name := range rosterHeaders {
		header[col] = strings.ToUpper(name)
	}
	rows = append(rows, header)

	for _, block := range roster.Blocks {
		for i, person := range block.People {
			row := blankRosterRow()
			row[rosterNameColumn] = person.Name
			row[rosterRoleColumn] = person.Role
			row[rosterAgeColumn] = person.Age
			row[rosterEmailColumn] = person.Email
			if i == 0 {
				row[rosterCityColumn] = block.City
			}
			rows = append(rows, row)
		}
	}
	return rows
}

// blankRosterRow returns a full-width row of empty strings. Every row is the
// same width so a short row cannot leave a previous tab's cell showing through
// -- and so the merged title row actually spans the columns it claims to.
func blankRosterRow() []any {
	row := make([]any, rosterColumnCount)
	for i := range row {
		row[i] = ""
	}
	return row
}

// RosterSheetFormat describes the whole tab's appearance for ONE batchUpdate.
// Per-block work is per-block RULES inside one call, never one call per block:
// a 63-household roster must not become 63 round trips.
func RosterSheetFormat(sheetID int64, roster *Roster) *SheetFormat {
	lastRow := rosterFirstDataRow + roster.PersonCount()

	format := &SheetFormat{
		SheetID: sheetID,
		Merges: []GridRange{
			fullWidthRosterRange(rosterTitleRow, rosterTitleRow+1),
			fullWidthRosterRange(rosterSubtitleRow, rosterSubtitleRow+1),
		},
		// Rows 1-3 frozen, so the first person is the first row to scroll.
		FrozenRows: rosterFirstDataRow,
	}

	for col, pixels := range rosterColumnPixels {
		format.ColumnWidths = append(format.ColumnWidths, ColumnWidth{
			StartCol: col, EndCol: col + 1, Pixels: pixels,
		})
	}

	format.Styles = append(format.Styles,
		StyleRule{
			Range: fullWidthRosterRange(rosterTitleRow, rosterTitleRow+1),
			Style: CellStyle{
				Bold: types.Pointer(true), FontSize: 14,
				HorizontalAlignment: "CENTER", VerticalAlignment: "MIDDLE",
			},
		},
		StyleRule{
			Range: fullWidthRosterRange(rosterSubtitleRow, rosterSubtitleRow+1),
			Style: CellStyle{
				FontSize: 10, FontHex: rosterSubtitleHex,
				HorizontalAlignment: "CENTER", VerticalAlignment: "MIDDLE",
			},
		},
		StyleRule{
			Range: fullWidthRosterRange(rosterHeaderRow, rosterHeaderRow+1),
			Style: CellStyle{
				BackgroundHex: rosterHeaderBgHex, FontHex: rosterHeaderFgHex,
				Bold: types.Pointer(true), FontSize: 9, VerticalAlignment: "MIDDLE",
			},
		},
	)

	// Nothing below this point has any rows to describe when the roster is empty,
	// and a zero-height GridRange is refused by buildFormatRequests rather than
	// silently widened to the whole tab. BuildFamilyCampRoster already refuses an
	// empty weekend; this keeps the renderer safe on its own terms.
	if roster.PersonCount() == 0 {
		return format
	}

	format.Styles = append(format.Styles,
		// Left first, then the age column's CENTER on top of it. The Sheets API
		// applies requests IN ORDER, so the reverse would left-align the ages.
		StyleRule{
			Range: fullWidthRosterRange(rosterFirstDataRow, lastRow),
			Style: CellStyle{HorizontalAlignment: "LEFT", VerticalAlignment: "MIDDLE"},
		},
		StyleRule{
			Range: GridRange{
				StartRow: rosterFirstDataRow, EndRow: lastRow,
				StartCol: rosterAgeColumn, EndCol: rosterAgeColumn + 1,
			},
			Style: CellStyle{HorizontalAlignment: "CENTER"},
		},
		StyleRule{
			Range: GridRange{
				StartRow: rosterFirstDataRow, EndRow: lastRow,
				StartCol: rosterRoleColumn, EndCol: rosterRoleColumn + 1,
			},
			Style: CellStyle{FontHex: rosterRoleHex},
		},
		// The whole city column, not one rule per block. Only a block's first row
		// carries a city, and bold on an empty cell is invisible -- so this is one
		// request where the per-block form would be one per household.
		StyleRule{
			Range: GridRange{
				StartRow: rosterFirstDataRow, EndRow: lastRow,
				StartCol: rosterCityColumn, EndCol: rosterCityColumn + 1,
			},
			Style: CellStyle{Bold: types.Pointer(true)},
		},
	)

	appendRosterBlockFormatting(format, roster)
	return format
}

// appendRosterBlockFormatting paints each household block: its fill, and the
// borders that make it read as one unit.
func appendRosterBlockFormatting(format *SheetFormat, roster *Roster) {
	blockEdge := &BorderEdge{Style: "SOLID_MEDIUM", Hex: rosterBlockEdge}
	cellEdge := &BorderEdge{Style: "SOLID", Hex: rosterCellEdge}

	row := rosterFirstDataRow
	for i, block := range roster.Blocks {
		if len(block.People) == 0 {
			continue
		}
		span := fullWidthRosterRange(row, row+len(block.People))

		// A linked group's tint REPLACES the banding; an ordinary block is
		// banded on odd indices and left white on even ones. White needs no
		// request: every export appends a brand-new tab, so there is no earlier
		// fill to clear.
		if fill := rosterBlockFill(block, i); fill != "" {
			format.Styles = append(format.Styles, StyleRule{
				Range: span, Style: CellStyle{BackgroundHex: fill},
			})
		}

		format.Borders = append(format.Borders, BorderRule{
			Range: span,
			Top:   blockEdge, Bottom: blockEdge,
			Left: cellEdge, Right: cellEdge,
			InnerHorizontal: cellEdge, InnerVertical: cellEdge,
		})

		row += len(block.People)
	}
}

// rosterBlockFill returns the background for one block, or "" for plain white.
func rosterBlockFill(block HouseholdBlock, index int) string {
	if block.LinkGroup > 0 {
		// Group numbers are 1-based and wrap rather than run out.
		return rosterLinkTints[(block.LinkGroup-1)%len(rosterLinkTints)]
	}
	if index%2 == 1 {
		return rosterBandHex
	}
	return ""
}

// fullWidthRosterRange is the half-open row span across every column.
func fullWidthRosterRange(startRow, endRow int) GridRange {
	return GridRange{
		StartRow: startRow, EndRow: endRow,
		StartCol: 0, EndCol: rosterColumnCount,
	}
}

// rosterTabName returns the date-stamped tab name for `at`, suffixed " (2)",
// " (3)", ... when a tab of that exact name already exists.
//
// Tabs are NEVER pruned and NEVER overwritten: staff hand-edit every one, and
// re-applying that work means copying from the previous tab. A collision means
// two exports inside one minute, which is a real thing staff do when the first
// one surprised them.
func rosterTabName(at time.Time, existing []string) string {
	base := at.Format(rosterTabLayout)
	if !slices.Contains(existing, base) {
		return base
	}
	for suffix := 2; ; suffix++ {
		candidate := fmt.Sprintf("%s (%d)", base, suffix)
		if !slices.Contains(existing, candidate) {
			return candidate
		}
	}
}

// campLocation returns the timezone tab names and export-time ages are rendered
// in: TZ when it names a zone Go can load, otherwise Pacific.
//
// The fallback is not cosmetic. PocketBase's container leaves time.Local at UTC
// unless TZ is set, and an export made at 5pm Pacific would then be stamped with
// the NEXT day's date -- on an artifact whose whole point is a dated audit trail
// of what staff pulled and when.
func campLocation() *time.Location {
	if name := strings.TrimSpace(os.Getenv("TZ")); name != "" {
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
		slog.Warn("TZ does not name a known timezone, falling back",
			"tz", name, "fallback", defaultCampTimezone)
	}
	if loc, err := time.LoadLocation(defaultCampTimezone); err == nil {
		return loc
	}
	// Unreachable with time/tzdata embedded, and deliberately not fatal: a
	// roster stamped in UTC is worth more than no roster.
	slog.Error("could not load any camp timezone, stamping in UTC")
	return time.UTC
}
