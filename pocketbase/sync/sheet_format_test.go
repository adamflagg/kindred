package sync

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

// jsonMap marshals a value and reads it back as a map, so assertions compare what
// Google actually receives rather than the Go struct. This is what catches fields
// the JSON encoder drops as zero values.
func jsonMap(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshaling: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshaling: %v", err)
	}
	return out
}

func wantJSON(t *testing.T, literal string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(literal), &out); err != nil {
		t.Fatalf("bad literal in test: %v", err)
	}
	return out
}

func assertJSONEqual(t *testing.T, got any, wantLiteral string) {
	t.Helper()
	gotMap := jsonMap(t, got)
	want := wantJSON(t, wantLiteral)
	if !reflect.DeepEqual(gotMap, want) {
		gotPretty, _ := json.MarshalIndent(gotMap, "", "  ")
		wantPretty, _ := json.MarshalIndent(want, "", "  ")
		t.Errorf("request JSON mismatch\ngot:\n%s\nwant:\n%s", gotPretty, wantPretty)
	}
}

func boolPtr(b bool) *bool { return &b }

// =============================================================================
// parseHexColor
// =============================================================================

func TestParseHexColor(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		hex     string
		wantR   float64
		wantG   float64
		wantB   float64
		wantErr bool
	}{
		{name: "Leading hash", hex: "#ECEFF1", wantR: 236.0 / 255, wantG: 239.0 / 255, wantB: 241.0 / 255},
		{name: "No hash", hex: "37474F", wantR: 55.0 / 255, wantG: 71.0 / 255, wantB: 79.0 / 255},
		{name: "Lowercase", hex: "#dadde1", wantR: 218.0 / 255, wantG: 221.0 / 255, wantB: 225.0 / 255},
		{name: "Black", hex: "#000000", wantR: 0, wantG: 0, wantB: 0},
		{name: "White", hex: "#FFFFFF", wantR: 1, wantG: 1, wantB: 1},
		{name: "Too short", hex: "#FFF", wantErr: true},
		{name: "Too long", hex: "#FFFFFFFF", wantErr: true},
		{name: "Not hex", hex: "#GGGGGG", wantErr: true},
		{name: "Empty", hex: "", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseHexColor(tt.hex)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseHexColor(%q) = %+v, want error", tt.hex, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseHexColor(%q): %v", tt.hex, err)
			}
			const tol = 1e-9
			if math.Abs(got.Red-tt.wantR) > tol ||
				math.Abs(got.Green-tt.wantG) > tol ||
				math.Abs(got.Blue-tt.wantB) > tol {
				t.Errorf("parseHexColor(%q) = (%v, %v, %v), want (%v, %v, %v)",
					tt.hex, got.Red, got.Green, got.Blue, tt.wantR, tt.wantG, tt.wantB)
			}
		})
	}
}

// A color whose components are all zero must still reach Google. Go's JSON encoder
// drops zero-valued floats, so #000000 would otherwise serialize to {} and silently
// mean "unset" rather than black.
func TestParseHexColor_BlackSurvivesSerialisation(t *testing.T) {
	t.Parallel()
	got, err := parseHexColor("#000000")
	if err != nil {
		t.Fatalf("parseHexColor: %v", err)
	}
	assertJSONEqual(t, got, `{"red":0,"green":0,"blue":0}`)
}

// =============================================================================
// buildFormatRequests
// =============================================================================

func TestBuildFormatRequests_EmptyFormatEmitsNothing(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{SheetID: 7})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d requests, want 0", len(got))
	}
}

// Order is fixed so a diff of the emitted batch is readable and stable.
func TestBuildFormatRequests_FixedRequestOrder(t *testing.T) {
	t.Parallel()
	format := SheetFormat{
		SheetID:      3,
		Merges:       []GridRange{{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5}},
		FrozenRows:   3,
		ColumnWidths: []ColumnWidth{{StartCol: 0, EndCol: 1, Pixels: 200}},
		Styles: []StyleRule{
			{Range: GridRange{StartRow: 2, EndRow: 3, StartCol: 0, EndCol: 5},
				Style: CellStyle{BackgroundHex: "#000000"}},
		},
		Borders: []BorderRule{
			{Range: GridRange{StartRow: 3, EndRow: 4, StartCol: 0, EndCol: 5},
				Top: &BorderEdge{Style: "SOLID_MEDIUM", Hex: "#000000"}},
		},
	}

	got, err := buildFormatRequests(&format)
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("got %d requests, want 5", len(got))
	}

	if got[0].MergeCells == nil {
		t.Error("request 0: want MergeCells")
	}
	if got[1].UpdateSheetProperties == nil {
		t.Error("request 1: want UpdateSheetProperties (frozen rows)")
	}
	if got[2].UpdateDimensionProperties == nil {
		t.Error("request 2: want UpdateDimensionProperties (column width)")
	}
	if got[3].RepeatCell == nil {
		t.Error("request 3: want RepeatCell (style)")
	}
	if got[4].UpdateBorders == nil {
		t.Error("request 4: want UpdateBorders")
	}
}

func TestBuildFormatRequests_Merge(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{
		SheetID: 42,
		Merges:  []GridRange{{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5}},
	})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d requests, want 1", len(got))
	}
	assertJSONEqual(t, got[0], `{
		"mergeCells": {
			"mergeType": "MERGE_ALL",
			"range": {"sheetId": 42, "startRowIndex": 0, "endRowIndex": 1,
			          "startColumnIndex": 0, "endColumnIndex": 5}
		}
	}`)
}

func TestBuildFormatRequests_FrozenRows(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{SheetID: 42, FrozenRows: 3})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d requests, want 1", len(got))
	}
	assertJSONEqual(t, got[0], `{
		"updateSheetProperties": {
			"properties": {"sheetId": 42, "gridProperties": {"frozenRowCount": 3}},
			"fields": "gridProperties.frozenRowCount"
		}
	}`)
}

func TestBuildFormatRequests_ColumnWidths(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{
		SheetID:      42,
		ColumnWidths: []ColumnWidth{{StartCol: 2, EndCol: 3, Pixels: 75}},
	})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d requests, want 1", len(got))
	}
	assertJSONEqual(t, got[0], `{
		"updateDimensionProperties": {
			"range": {"sheetId": 42, "dimension": "COLUMNS", "startIndex": 2, "endIndex": 3},
			"properties": {"pixelSize": 75},
			"fields": "pixelSize"
		}
	}`)
}

// The fields mask must name ONLY what the style sets. A blanket "userEnteredFormat"
// mask would wipe every property the rule is silent about -- which for the roster
// means one style pass erasing the previous one's fills.
func TestBuildFormatRequests_StyleMaskNamesOnlyWhatIsSet(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		style CellStyle
		want  string
	}{
		{
			name:  "Background only",
			style: CellStyle{BackgroundHex: "#FFFFFF"},
			want:  "userEnteredFormat.backgroundColorStyle",
		},
		{
			name:  "Alignment only",
			style: CellStyle{HorizontalAlignment: "CENTER", VerticalAlignment: "MIDDLE"},
			want:  "userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
		},
		{
			name:  "Font size only",
			style: CellStyle{FontSize: 14},
			want:  "userEnteredFormat.textFormat.fontSize",
		},
		{
			name:  "Font color only",
			style: CellStyle{FontHex: "#000000"},
			want:  "userEnteredFormat.textFormat.foregroundColorStyle",
		},
		{
			name:  "Bold only",
			style: CellStyle{Bold: boolPtr(true)},
			want:  "userEnteredFormat.textFormat.bold",
		},
		{
			name: "Everything",
			style: CellStyle{
				BackgroundHex:       "#FFFFFF",
				HorizontalAlignment: "LEFT",
				VerticalAlignment:   "MIDDLE",
				Bold:                boolPtr(true),
				FontSize:            9,
				FontHex:             "#000000",
			},
			want: "userEnteredFormat.backgroundColorStyle," +
				"userEnteredFormat.horizontalAlignment," +
				"userEnteredFormat.verticalAlignment," +
				"userEnteredFormat.textFormat.bold," +
				"userEnteredFormat.textFormat.fontSize," +
				"userEnteredFormat.textFormat.foregroundColorStyle",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := buildFormatRequests(&SheetFormat{
				SheetID: 1,
				Styles: []StyleRule{
					{Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5}, Style: tt.style},
				},
			})
			if err != nil {
				t.Fatalf("buildFormatRequests: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("got %d requests, want 1", len(got))
			}
			if got[0].RepeatCell.Fields != tt.want {
				t.Errorf("fields mask =\n  %q\nwant\n  %q", got[0].RepeatCell.Fields, tt.want)
			}
		})
	}
}

// A style that sets nothing emits nothing: an empty fields mask is rejected by the
// Sheets API, and a blanket mask would clear the range.
func TestBuildFormatRequests_EmptyStyleEmitsNoRequest(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{
		SheetID: 1,
		Styles: []StyleRule{
			{Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5}, Style: CellStyle{}},
		},
	})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d requests, want 0", len(got))
	}
}

// The mask a fully-populated style produces, spelled out once. Each fragment is
// pinned individually by TestBuildFormatRequests_StyleMaskNamesOnlyWhatIsSet.
const allSixMasks = "userEnteredFormat.backgroundColorStyle," +
	"userEnteredFormat.horizontalAlignment," +
	"userEnteredFormat.verticalAlignment," +
	"userEnteredFormat.textFormat.bold," +
	"userEnteredFormat.textFormat.fontSize," +
	"userEnteredFormat.textFormat.foregroundColorStyle"

func TestBuildFormatRequests_StyleJSON(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{
		SheetID: 8,
		Styles: []StyleRule{{
			Range: GridRange{StartRow: 2, EndRow: 3, StartCol: 0, EndCol: 5},
			Style: CellStyle{
				BackgroundHex:       "#000000",
				FontHex:             "#FFFFFF",
				FontSize:            9,
				Bold:                boolPtr(true),
				HorizontalAlignment: "LEFT",
				VerticalAlignment:   "MIDDLE",
			},
		}},
	})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	assertJSONEqual(t, got[0], `{
		"repeatCell": {
			"range": {"sheetId": 8, "startRowIndex": 2, "endRowIndex": 3,
			          "startColumnIndex": 0, "endColumnIndex": 5},
			"cell": {"userEnteredFormat": {
				"backgroundColorStyle": {"rgbColor": {"red":0,"green":0,"blue":0}},
				"horizontalAlignment": "LEFT",
				"verticalAlignment": "MIDDLE",
				"textFormat": {
					"bold": true,
					"fontSize": 9,
					"foregroundColorStyle": {"rgbColor": {"red":1,"green":1,"blue":1}}
				}
			}},
			"fields": "`+allSixMasks+`"
		}
	}`)
}

// Bold:false must reach Google as an explicit false, not vanish as a zero value.
func TestBuildFormatRequests_BoldFalseIsExplicit(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{
		SheetID: 1,
		Styles: []StyleRule{{
			Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 1},
			Style: CellStyle{Bold: boolPtr(false)},
		}},
	})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d requests, want 1", len(got))
	}
	assertJSONEqual(t, got[0], `{
		"repeatCell": {
			"range": {"sheetId": 1, "startRowIndex": 0, "endRowIndex": 1,
			          "startColumnIndex": 0, "endColumnIndex": 1},
			"cell": {"userEnteredFormat": {"textFormat": {"bold": false}}},
			"fields": "userEnteredFormat.textFormat.bold"
		}
	}`)
}

func TestBuildFormatRequests_Borders(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{
		SheetID: 5,
		Borders: []BorderRule{{
			Range:  GridRange{StartRow: 4, EndRow: 7, StartCol: 0, EndCol: 5},
			Top:    &BorderEdge{Style: "SOLID_MEDIUM", Hex: "#000000"},
			Bottom: &BorderEdge{Style: "SOLID_MEDIUM", Hex: "#000000"},
			// Left/Right/inner deliberately unset: nil must omit the edge entirely,
			// not send a NONE that erases an adjacent block's border.
		}},
	})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d requests, want 1", len(got))
	}
	assertJSONEqual(t, got[0], `{
		"updateBorders": {
			"range": {"sheetId": 5, "startRowIndex": 4, "endRowIndex": 7,
			          "startColumnIndex": 0, "endColumnIndex": 5},
			"top":    {"style": "SOLID_MEDIUM", "colorStyle": {"rgbColor": {"red":0,"green":0,"blue":0}}},
			"bottom": {"style": "SOLID_MEDIUM", "colorStyle": {"rgbColor": {"red":0,"green":0,"blue":0}}}
		}
	}`)
}

func TestBuildFormatRequests_BorderWithNoEdgesEmitsNothing(t *testing.T) {
	t.Parallel()
	got, err := buildFormatRequests(&SheetFormat{
		SheetID: 5,
		Borders: []BorderRule{{Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5}}},
	})
	if err != nil {
		t.Fatalf("buildFormatRequests: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d requests, want 0", len(got))
	}
}

func TestBuildFormatRequests_RejectsBadColor(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		format SheetFormat
	}{
		{
			name: "Style background",
			format: SheetFormat{Styles: []StyleRule{{
				Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 1},
				Style: CellStyle{BackgroundHex: "puce"},
			}}},
		},
		{
			name: "Style font",
			format: SheetFormat{Styles: []StyleRule{{
				Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 1},
				Style: CellStyle{FontHex: "#12345"},
			}}},
		},
		{
			name: "Border edge",
			format: SheetFormat{Borders: []BorderRule{{
				Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 1},
				Top:   &BorderEdge{Style: "SOLID", Hex: "nope"},
			}}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if _, err := buildFormatRequests(&tt.format); err == nil {
				t.Error("expected an error for an unparseable color, got nil")
			}
		})
	}
}

// A zero EndRow/EndCol means "unbounded to the end of the sheet" in the Sheets API,
// so an accidentally-empty range silently formats the whole tab. Refuse.
func TestBuildFormatRequests_RejectsEmptyOrInvertedRange(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		r    GridRange
	}{
		{name: "Zero rows", r: GridRange{StartRow: 0, EndRow: 0, StartCol: 0, EndCol: 5}},
		{name: "Zero cols", r: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 0}},
		{name: "Inverted rows", r: GridRange{StartRow: 5, EndRow: 2, StartCol: 0, EndCol: 5}},
		{name: "Inverted cols", r: GridRange{StartRow: 0, EndRow: 1, StartCol: 5, EndCol: 2}},
		{name: "Negative start", r: GridRange{StartRow: -1, EndRow: 1, StartCol: 0, EndCol: 5}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if _, err := buildFormatRequests(&SheetFormat{Merges: []GridRange{tt.r}}); err == nil {
				t.Errorf("Merges %+v: expected an error, got nil", tt.r)
			}
			if _, err := buildFormatRequests(&SheetFormat{Styles: []StyleRule{
				{Range: tt.r, Style: CellStyle{BackgroundHex: "#FFFFFF"}},
			}}); err == nil {
				t.Errorf("Styles %+v: expected an error, got nil", tt.r)
			}
		})
	}
}

func TestBuildFormatRequests_RejectsBadColumnWidth(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		w    ColumnWidth
	}{
		{name: "Empty span", w: ColumnWidth{StartCol: 0, EndCol: 0, Pixels: 100}},
		{name: "Inverted span", w: ColumnWidth{StartCol: 3, EndCol: 1, Pixels: 100}},
		{name: "Zero pixels", w: ColumnWidth{StartCol: 0, EndCol: 1, Pixels: 0}},
		{name: "Negative pixels", w: ColumnWidth{StartCol: 0, EndCol: 1, Pixels: -5}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if _, err := buildFormatRequests(&SheetFormat{ColumnWidths: []ColumnWidth{tt.w}}); err == nil {
				t.Errorf("ColumnWidth %+v: expected an error, got nil", tt.w)
			}
		})
	}
}

// A negative FontSize is not "empty" by isEmpty's == 0 test, but the mask is only
// appended when FontSize > 0 -- so it used to slip through both and emit a
// repeatCell with an EMPTY field mask. Sheets rejects that with a 400, and since
// the whole tab is one batchUpdate, every merge, freeze, width, style and border
// for that tab dies with it. Refused explicitly, like every other numeric input.
func TestBuildFormatRequests_RejectsNegativeFontSize(t *testing.T) {
	t.Parallel()
	_, err := buildFormatRequests(&SheetFormat{
		SheetID: 1,
		Styles: []StyleRule{{
			Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5},
			Style: CellStyle{FontSize: -5},
		}},
	})
	if err == nil {
		t.Error("expected an error for a negative FontSize, got nil")
	}
}

// The belt-and-braces half of the same invariant: whatever the inputs, a
// repeatCell must never carry an empty field mask. This is what keeps a future
// CellStyle field added with the same == 0 / > 0 asymmetry from reintroducing a
// silent whole-tab failure instead of a loud one.
func TestBuildFormatRequests_NeverEmitsAnEmptyFieldMask(t *testing.T) {
	t.Parallel()
	styles := []CellStyle{
		{BackgroundHex: "#FFFFFF"},
		{FontHex: "#000000"},
		{FontSize: 9},
		{Bold: boolPtr(false)},
		{HorizontalAlignment: "LEFT"},
		{VerticalAlignment: "MIDDLE"},
	}
	for i := range styles {
		got, err := buildFormatRequests(&SheetFormat{
			SheetID: 1,
			Styles: []StyleRule{
				{Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5}, Style: styles[i]},
			},
		})
		if err != nil {
			t.Fatalf("style %+v: %v", styles[i], err)
		}
		for _, request := range got {
			if request.RepeatCell != nil && request.RepeatCell.Fields == "" {
				t.Errorf("style %+v emitted a repeatCell with an empty field mask", styles[i])
			}
		}
	}
}

func TestBuildFormatRequests_RejectsNegativeFrozenRows(t *testing.T) {
	t.Parallel()
	if _, err := buildFormatRequests(&SheetFormat{FrozenRows: -1}); err == nil {
		t.Error("expected an error for negative FrozenRows, got nil")
	}
}

// =============================================================================
// RealSheetsWriter.ApplyFormatting
// =============================================================================

func newFakeSheetsService(t *testing.T, handler http.HandlerFunc) *sheets.Service {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	service, err := sheets.NewService(t.Context(),
		option.WithHTTPClient(server.Client()),
		option.WithEndpoint(server.URL),
	)
	if err != nil {
		t.Fatalf("creating sheets service: %v", err)
	}
	return service
}

// The whole point of the directive batch is that a 63-household roster costs ONE
// round trip, not one per block.
func TestRealSheetsWriter_ApplyFormatting_IssuesExactlyOneBatchUpdate(t *testing.T) {
	t.Parallel()

	var calls, batched atomic.Int32
	service := newFakeSheetsService(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var req sheets.BatchUpdateSpreadsheetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decoding request body: %v", err)
		}
		batched.Store(int32(len(req.Requests))) //nolint:gosec // small test fixture
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write([]byte(`{"spreadsheetId":"sheet-1"}`)); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})

	format := SheetFormat{
		SheetID: 0,
		Merges: []GridRange{
			{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5},
			{StartRow: 1, EndRow: 2, StartCol: 0, EndCol: 5},
		},
		FrozenRows: 3,
		ColumnWidths: []ColumnWidth{
			{StartCol: 0, EndCol: 1, Pixels: 200},
			{StartCol: 1, EndCol: 2, Pixels: 115},
		},
		Styles: []StyleRule{
			{Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 5},
				Style: CellStyle{Bold: boolPtr(true)}},
		},
		Borders: []BorderRule{
			{Range: GridRange{StartRow: 3, EndRow: 6, StartCol: 0, EndCol: 5},
				Top: &BorderEdge{Style: "SOLID_MEDIUM", Hex: "#78909C"}},
		},
	}

	if err := NewRealSheetsWriter(service).ApplyFormatting(t.Context(), "sheet-1", &format); err != nil {
		t.Fatalf("ApplyFormatting: %v", err)
	}

	if got := calls.Load(); got != 1 {
		t.Errorf("HTTP calls = %d, want 1", got)
	}
	// 2 merges + 1 frozen-rows + 2 column widths + 1 style + 1 border.
	if got := batched.Load(); got != 7 {
		t.Errorf("requests inside the single batch = %d, want 7", got)
	}
}

// An empty format must not burn a Google API call.
func TestRealSheetsWriter_ApplyFormatting_NoDirectivesIssuesNoCall(t *testing.T) {
	t.Parallel()

	var calls atomic.Int32
	service := newFakeSheetsService(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write([]byte(`{"spreadsheetId":"sheet-1"}`)); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})

	if err := NewRealSheetsWriter(service).ApplyFormatting(t.Context(), "sheet-1", &SheetFormat{}); err != nil {
		t.Fatalf("ApplyFormatting: %v", err)
	}
	if got := calls.Load(); got != 0 {
		t.Errorf("HTTP calls = %d, want 0", got)
	}
}

// A malformed directive must fail before any API call is made.
func TestRealSheetsWriter_ApplyFormatting_InvalidDirectiveDoesNotCallAPI(t *testing.T) {
	t.Parallel()

	var calls atomic.Int32
	service := newFakeSheetsService(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write([]byte(`{}`)); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})

	err := NewRealSheetsWriter(service).ApplyFormatting(t.Context(), "sheet-1", &SheetFormat{
		Styles: []StyleRule{{
			Range: GridRange{StartRow: 0, EndRow: 1, StartCol: 0, EndCol: 1},
			Style: CellStyle{BackgroundHex: "not-a-color"},
		}},
	})
	if err == nil {
		t.Fatal("expected an error for an unparseable color, got nil")
	}
	if !strings.Contains(err.Error(), "not-a-color") {
		t.Errorf("error %q should name the offending value", err)
	}
	if got := calls.Load(); got != 0 {
		t.Errorf("HTTP calls = %d, want 0", got)
	}
}
