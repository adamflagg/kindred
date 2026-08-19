package sync

import (
	"fmt"
	"strconv"
	"strings"

	"google.golang.org/api/sheets/v4"
)

// Formatting directives for one sheet tab, applied in a single spreadsheets.batchUpdate.
//
// These types deliberately keep google.golang.org/api/sheets out of the SheetsWriter
// interface, as TabColor and TabPropertyUpdate already do, so callers describe what
// the tab should look like and the translation to Google's request shapes -- with its
// field masks and its zero-value traps -- lives in one tested place.
//
// kindred#2433.

// GridRange is a half-open rectangle within one tab: rows [StartRow, EndRow) and
// columns [StartCol, EndCol), both 0-based. This mirrors the Sheets API GridRange,
// where an omitted end index means "to the end of the sheet" -- so an empty range is
// rejected rather than silently widened to the whole tab.
type GridRange struct {
	StartRow int
	EndRow   int
	StartCol int
	EndCol   int
}

// CellStyle is the visual treatment of a range. A zero-valued field is left alone:
// the emitted field mask names only what is set, so applying one style never clears
// formatting a later or earlier rule owns.
type CellStyle struct {
	BackgroundHex       string // "" leaves it unchanged, e.g. "#ECEFF1"
	FontHex             string // "" leaves it unchanged
	FontSize            int    // 0 leaves it unchanged
	Bold                *bool  // nil leaves it unchanged; false is written explicitly
	HorizontalAlignment string // "" leaves it unchanged; LEFT, CENTER, RIGHT
	VerticalAlignment   string // "" leaves it unchanged; TOP, MIDDLE, BOTTOM
}

// isEmpty reports whether the style would produce an empty field mask, which the
// Sheets API rejects.
func (s *CellStyle) isEmpty() bool {
	return s.BackgroundHex == "" && s.FontHex == "" && s.FontSize == 0 &&
		s.Bold == nil && s.HorizontalAlignment == "" && s.VerticalAlignment == ""
}

// BorderEdge is one edge of a border rule. Style is a Sheets border style:
// SOLID, SOLID_MEDIUM, SOLID_THICK, DOTTED, DASHED, DOUBLE or NONE.
type BorderEdge struct {
	Style string
	Hex   string
}

// BorderRule sets border edges on a range. A nil edge is omitted from the request
// entirely rather than sent as NONE, so a rule never erases a neighboring block's
// border as a side effect.
type BorderRule struct {
	Range           GridRange
	Top             *BorderEdge
	Bottom          *BorderEdge
	Left            *BorderEdge
	Right           *BorderEdge
	InnerHorizontal *BorderEdge
	InnerVertical   *BorderEdge
}

// hasEdge reports whether the rule sets at least one edge.
func (b *BorderRule) hasEdge() bool {
	return b.Top != nil || b.Bottom != nil || b.Left != nil || b.Right != nil ||
		b.InnerHorizontal != nil || b.InnerVertical != nil
}

// ColumnWidth sets the pixel width of the half-open column span [StartCol, EndCol).
type ColumnWidth struct {
	StartCol int
	EndCol   int
	Pixels   int
}

// StyleRule applies one CellStyle to one range.
type StyleRule struct {
	Range GridRange
	Style CellStyle
}

// SheetFormat is everything one tab's appearance needs, in the order it is applied:
// merges, frozen rows, column widths, cell styles, then borders.
type SheetFormat struct {
	SheetID      int64
	Merges       []GridRange
	FrozenRows   int // 0 emits no freeze request
	ColumnWidths []ColumnWidth
	Styles       []StyleRule
	Borders      []BorderRule
}

// isEmpty reports whether the format carries no directives at all.
func (f *SheetFormat) isEmpty() bool {
	return len(f.Merges) == 0 && f.FrozenRows == 0 && len(f.ColumnWidths) == 0 &&
		len(f.Styles) == 0 && len(f.Borders) == 0
}

// Field-mask fragments, in the order buildStyleRequest emits them.
const (
	maskBackground = "userEnteredFormat.backgroundColorStyle"
	maskHAlign     = "userEnteredFormat.horizontalAlignment"
	maskVAlign     = "userEnteredFormat.verticalAlignment"
	maskBold       = "userEnteredFormat.textFormat.bold"
	maskFontSize   = "userEnteredFormat.textFormat.fontSize"
	maskFontColor  = "userEnteredFormat.textFormat.foregroundColorStyle"
)

// buildFormatRequests translates a SheetFormat into the Sheets API requests for a
// single batchUpdate. It returns an error rather than dropping a directive it cannot
// express: a silently-skipped fill is invisible in the finished sheet.
func buildFormatRequests(format *SheetFormat) ([]*sheets.Request, error) {
	if format.FrozenRows < 0 {
		return nil, fmt.Errorf("FrozenRows must not be negative, got %d", format.FrozenRows)
	}

	requests := make([]*sheets.Request, 0,
		len(format.Merges)+1+len(format.ColumnWidths)+len(format.Styles)+len(format.Borders))

	for _, merge := range format.Merges {
		gridRange, err := gridRangeFor(format.SheetID, merge)
		if err != nil {
			return nil, fmt.Errorf("merge range: %w", err)
		}
		requests = append(requests, &sheets.Request{
			MergeCells: &sheets.MergeCellsRequest{Range: gridRange, MergeType: "MERGE_ALL"},
		})
	}

	if format.FrozenRows > 0 {
		requests = append(requests, &sheets.Request{
			UpdateSheetProperties: &sheets.UpdateSheetPropertiesRequest{
				Properties: &sheets.SheetProperties{
					SheetId: format.SheetID,
					GridProperties: &sheets.GridProperties{
						FrozenRowCount:  int64(format.FrozenRows),
						ForceSendFields: []string{"FrozenRowCount"},
					},
					ForceSendFields: []string{"SheetId"},
				},
				Fields: "gridProperties.frozenRowCount",
			},
		})
	}

	for _, width := range format.ColumnWidths {
		request, err := buildColumnWidthRequest(format.SheetID, width)
		if err != nil {
			return nil, err
		}
		requests = append(requests, request)
	}

	for i := range format.Styles {
		request, err := buildStyleRequest(format.SheetID, &format.Styles[i])
		if err != nil {
			return nil, err
		}
		if request != nil {
			requests = append(requests, request)
		}
	}

	for i := range format.Borders {
		request, err := buildBorderRequest(format.SheetID, &format.Borders[i])
		if err != nil {
			return nil, err
		}
		if request != nil {
			requests = append(requests, request)
		}
	}

	return requests, nil
}

// buildColumnWidthRequest builds the updateDimensionProperties request for one span.
func buildColumnWidthRequest(sheetID int64, width ColumnWidth) (*sheets.Request, error) {
	if width.StartCol < 0 || width.EndCol <= width.StartCol {
		return nil, fmt.Errorf("column width span [%d, %d) is empty or inverted",
			width.StartCol, width.EndCol)
	}
	if width.Pixels <= 0 {
		return nil, fmt.Errorf("column width must be a positive pixel count, got %d", width.Pixels)
	}

	return &sheets.Request{
		UpdateDimensionProperties: &sheets.UpdateDimensionPropertiesRequest{
			Range: &sheets.DimensionRange{
				SheetId:         sheetID,
				Dimension:       "COLUMNS",
				StartIndex:      int64(width.StartCol),
				EndIndex:        int64(width.EndCol),
				ForceSendFields: []string{"SheetId", "StartIndex"},
			},
			Properties: &sheets.DimensionProperties{PixelSize: int64(width.Pixels)},
			Fields:     "pixelSize",
		},
	}, nil
}

// buildStyleRequest builds the repeatCell request for one style rule, or nil when the
// style sets nothing. The field mask names only what the style sets: a blanket
// "userEnteredFormat" mask would clear every property the rule is silent about.
func buildStyleRequest(sheetID int64, rule *StyleRule) (*sheets.Request, error) {
	if rule.Style.isEmpty() {
		return nil, nil
	}

	gridRange, err := gridRangeFor(sheetID, rule.Range)
	if err != nil {
		return nil, fmt.Errorf("style range: %w", err)
	}

	cellFormat := &sheets.CellFormat{}
	textFormat := &sheets.TextFormat{}
	masks := make([]string, 0, 6)

	if rule.Style.BackgroundHex != "" {
		color, colorErr := parseHexColor(rule.Style.BackgroundHex)
		if colorErr != nil {
			return nil, fmt.Errorf("background color: %w", colorErr)
		}
		cellFormat.BackgroundColorStyle = &sheets.ColorStyle{RgbColor: color}
		masks = append(masks, maskBackground)
	}
	if rule.Style.HorizontalAlignment != "" {
		cellFormat.HorizontalAlignment = rule.Style.HorizontalAlignment
		masks = append(masks, maskHAlign)
	}
	if rule.Style.VerticalAlignment != "" {
		cellFormat.VerticalAlignment = rule.Style.VerticalAlignment
		masks = append(masks, maskVAlign)
	}
	if rule.Style.Bold != nil {
		textFormat.Bold = *rule.Style.Bold
		textFormat.ForceSendFields = append(textFormat.ForceSendFields, "Bold")
		masks = append(masks, maskBold)
	}
	if rule.Style.FontSize > 0 {
		textFormat.FontSize = int64(rule.Style.FontSize)
		masks = append(masks, maskFontSize)
	}
	if rule.Style.FontHex != "" {
		color, colorErr := parseHexColor(rule.Style.FontHex)
		if colorErr != nil {
			return nil, fmt.Errorf("font color: %w", colorErr)
		}
		textFormat.ForegroundColorStyle = &sheets.ColorStyle{RgbColor: color}
		masks = append(masks, maskFontColor)
	}

	if rule.Style.Bold != nil || rule.Style.FontSize > 0 || rule.Style.FontHex != "" {
		cellFormat.TextFormat = textFormat
	}

	return &sheets.Request{
		RepeatCell: &sheets.RepeatCellRequest{
			Range:  gridRange,
			Cell:   &sheets.CellData{UserEnteredFormat: cellFormat},
			Fields: strings.Join(masks, ","),
		},
	}, nil
}

// buildBorderRequest builds the updateBorders request for one rule, or nil when the
// rule sets no edge.
func buildBorderRequest(sheetID int64, rule *BorderRule) (*sheets.Request, error) {
	if !rule.hasEdge() {
		return nil, nil
	}

	gridRange, err := gridRangeFor(sheetID, rule.Range)
	if err != nil {
		return nil, fmt.Errorf("border range: %w", err)
	}

	request := &sheets.UpdateBordersRequest{Range: gridRange}
	edges := []struct {
		edge *BorderEdge
		dest **sheets.Border
	}{
		{rule.Top, &request.Top},
		{rule.Bottom, &request.Bottom},
		{rule.Left, &request.Left},
		{rule.Right, &request.Right},
		{rule.InnerHorizontal, &request.InnerHorizontal},
		{rule.InnerVertical, &request.InnerVertical},
	}
	for _, e := range edges {
		if e.edge == nil {
			continue
		}
		border, borderErr := buildBorder(*e.edge)
		if borderErr != nil {
			return nil, borderErr
		}
		*e.dest = border
	}

	return &sheets.Request{UpdateBorders: request}, nil
}

// buildBorder translates one edge into a Sheets border.
func buildBorder(edge BorderEdge) (*sheets.Border, error) {
	if edge.Style == "" {
		return nil, fmt.Errorf("border style is required")
	}
	color, err := parseHexColor(edge.Hex)
	if err != nil {
		return nil, fmt.Errorf("border color: %w", err)
	}
	return &sheets.Border{Style: edge.Style, ColorStyle: &sheets.ColorStyle{RgbColor: color}}, nil
}

// gridRangeFor validates a range and converts it to the Sheets API shape.
//
// The end indices are required. In the Sheets API an omitted end index means
// "to the end of the sheet", so a range left at its zero value would format the
// entire tab instead of nothing.
func gridRangeFor(sheetID int64, r GridRange) (*sheets.GridRange, error) {
	if r.StartRow < 0 || r.StartCol < 0 {
		return nil, fmt.Errorf("range start must not be negative: rows [%d, %d), cols [%d, %d)",
			r.StartRow, r.EndRow, r.StartCol, r.EndCol)
	}
	if r.EndRow <= r.StartRow || r.EndCol <= r.StartCol {
		return nil, fmt.Errorf("range is empty or inverted: rows [%d, %d), cols [%d, %d)",
			r.StartRow, r.EndRow, r.StartCol, r.EndCol)
	}

	return &sheets.GridRange{
		SheetId:          sheetID,
		StartRowIndex:    int64(r.StartRow),
		EndRowIndex:      int64(r.EndRow),
		StartColumnIndex: int64(r.StartCol),
		EndColumnIndex:   int64(r.EndCol),
		// Without these, a zero start index or sheet ID is dropped by the JSON
		// encoder. Sheets reads an absent start index as "unbounded", which happens
		// to coincide with 0 -- but an absent sheetId silently targets the first tab.
		ForceSendFields: []string{"SheetId", "StartRowIndex", "StartColumnIndex"},
	}, nil
}

// parseHexColor converts "#RRGGBB" or "RRGGBB" into a Sheets color.
//
// Every component is force-sent: Go's JSON encoder drops zero-valued floats, so
// #000000 would otherwise serialize to {} and read as "unset" rather than black.
func parseHexColor(hex string) (*sheets.Color, error) {
	cleaned := strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(cleaned) != 6 {
		return nil, fmt.Errorf("color %q is not a 6-digit hex value", hex)
	}

	value, err := strconv.ParseUint(cleaned, 16, 32)
	if err != nil {
		return nil, fmt.Errorf("color %q is not a 6-digit hex value: %w", hex, err)
	}

	return &sheets.Color{
		Red:             float64((value>>16)&0xFF) / 255,
		Green:           float64((value>>8)&0xFF) / 255,
		Blue:            float64(value&0xFF) / 255,
		ForceSendFields: []string{"Red", "Green", "Blue"},
	}, nil
}
