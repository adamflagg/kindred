package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/tools/types"
)

// post_date and reversal_date are stored as true UTC since campership SP1 (design §6.2).
// Before that they held CampMinder's Mountain wall clock read as UTC, and that wall clock is
// what staff saw in Sheets. The exporter renders them back in America/Denver so the export
// does not move: an evening Mountain posting, stored as the next UTC day, exports as the
// Mountain date and time, in the layout DateTime.String() always produced.
func TestResolveValue_MountainInstantRendersDenverWallClock(t *testing.T) {
	t.Parallel()
	r := NewFieldResolver()
	col := &ColumnConfig{Field: "post_date", Header: "Post Date", Type: FieldTypeMountainInstant}

	mustDT := func(s string) types.DateTime {
		t.Helper()
		dt, err := types.ParseDateTime(s)
		if err != nil {
			t.Fatalf("ParseDateTime(%q): %v", s, err)
		}
		return dt
	}

	cases := []struct {
		name  string
		value any
		want  string
	}{
		// MST (UTC-7): 20:30 on Jan 15 in Mountain is stored as 03:30 on Jan 16 UTC.
		{"non-DST evening, next UTC day", mustDT("2026-01-16 03:30:00.000Z"), "2026-01-15 20:30:00.000Z"},
		// MDT (UTC-6): 20:15 on Jul 15 in Mountain is stored as 02:15 on Jul 16 UTC.
		{"DST evening, next UTC day", mustDT("2026-07-16 02:15:00.000Z"), "2026-07-15 20:15:00.000Z"},
		{"DST midday, same day", mustDT("2026-07-15 18:00:00.000Z"), "2026-07-15 12:00:00.000Z"},
		{"string form of a stored instant", "2026-01-16 03:30:00.000Z", "2026-01-15 20:30:00.000Z"},
		{"empty DateTime", types.DateTime{}, ""},
		{"empty string", "", ""},
		{"nil", nil, ""},
	}
	for _, tc := range cases {
		if got := r.ResolveValue(tc.value, col); got != tc.want {
			t.Errorf("%s: ResolveValue(%v) = %q, want %q", tc.name, tc.value, got, tc.want)
		}
	}
}

// The two transaction instants use the Mountain rendering; effective_date and the service
// dates are calendar dates, never converted on the way in, so they must not be shifted on
// the way out.
func TestFinancialTransactionsExport_InstantsRenderInMountainTime(t *testing.T) {
	t.Parallel()
	var cols []ColumnConfig
	for _, cfg := range GetReadableYearExports() {
		if cfg.Collection == "financial_transactions" {
			cols = cfg.Columns
		}
	}
	if cols == nil {
		t.Fatal("no financial_transactions export config")
	}
	want := map[string]FieldType{
		"post_date":          FieldTypeMountainInstant,
		"reversal_date":      FieldTypeMountainInstant,
		"effective_date":     FieldTypeDate,
		"service_start_date": FieldTypeDate,
		"service_end_date":   FieldTypeDate,
	}
	for i := range cols {
		if w, ok := want[cols[i].Field]; ok {
			if cols[i].Type != w {
				t.Errorf("column %q type = %v, want %v", cols[i].Field, cols[i].Type, w)
			}
			delete(want, cols[i].Field)
		}
	}
	for f := range want {
		t.Errorf("financial_transactions export has no %q column", f)
	}

	// End to end through BuildDataMatrix with the real column list.
	stored, err := types.ParseDateTime("2026-11-20 04:10:00.000Z") // 21:10 MST on Nov 19
	if err != nil {
		t.Fatal(err)
	}
	matrix := BuildDataMatrix([]map[string]any{{"post_date": stored}}, cols, NewFieldResolver())
	for i := range cols {
		if cols[i].Field == "post_date" {
			if got := matrix[1][i]; got != "2026-11-19 21:10:00.000Z" {
				t.Errorf("exported Post Date = %q, want the Mountain wall clock 2026-11-19 21:10:00.000Z", got)
			}
		}
	}
}
