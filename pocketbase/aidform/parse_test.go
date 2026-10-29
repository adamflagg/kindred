package aidform

import "testing"

// The §7 table of the adult-aid form design, as real-shaped strings (fictional,
// never real answers). GF-5 = A: a hedged figure reads as its number, flagged.
// Unknown is never 0: Known false always carries Value 0 AND a note.
func TestParseFigure(t *testing.T) {
	t.Parallel()
	type want struct {
		value    float64
		known    bool
		reported bool
		note     string
	}
	cases := []struct {
		name  string
		typed string
		kind  FigureKind
		want  want
	}{
		// Clean reads: no note.
		{"dollar sign and comma", "$1,200", FigureRequired, want{1200, true, true, ""}},
		{"plain digits", "1200", FigureRequired, want{1200, true, true, ""}},
		{"cents", "1200.00", FigureRequired, want{1200, true, true, ""}},
		{"currency word", "1,200 USD", FigureRequired, want{1200, true, true, ""}},
		{"padded", " 1200 ", FigureRequired, want{1200, true, true, ""}},
		{"dollars word", "85000 dollars", FigureRequired, want{85000, true, true, ""}},
		{"real cents kept", "$1,234.56", FigureRequired, want{1234.56, true, true, ""}},
		{"per year is the annual figure", "$72,000 per year", FigureRequired, want{72000, true, true, ""}},

		// A reported zero is known and reported.
		{"zero", "0", FigureRequired, want{0, true, true, ""}},
		{"zero dollars", "$0", FigureRequired, want{0, true, true, ""}},
		{"none", "none", FigureRequired, want{0, true, true, ""}},
		{"n/a", "N/A", FigureRequired, want{0, true, true, ""}},
		{"dash", "-", FigureRequired, want{0, true, true, ""}},
		{"zero cents", "0.00", FigureRequired, want{0, true, true, ""}},

		// Blank: optional rent or mortgage is 0 and not reported; a required one is unknown.
		{"blank optional", "", FigureOptionalHousing, want{0, true, false, ""}},
		{"space optional", "   ", FigureOptionalHousing, want{0, true, false, ""}},
		{"blank required", "", FigureRequired, want{0, false, false, "left blank"}},
		{"space required", " ", FigureRequired, want{0, false, false, "left blank"}},

		// GF-5 = A: hedged figures read as the number, flagged.
		{"about 1k", "about 1k", FigureRequired, want{1000, true, true, "read 'about 1k' as $1,000"}},
		{"tilde", "~1,000", FigureRequired, want{1000, true, true, "read '~1,000' as $1,000"}},
		{"approx 85k", "approx 85k", FigureRequired, want{85000, true, true, "read 'approx 85k' as $85,000"}},
		{"1.2k", "1.2k", FigureRequired, want{1200, true, true, "read '1.2k' as $1,200"}},
		{"85K", "85K", FigureRequired, want{85000, true, true, "read '85K' as $85,000"}},
		{"approximately with dollar", "approximately $92,500", FigureRequired,
			want{92500, true, true, "read 'approximately $92,500' as $92,500"}},
		{"around", "around 60000", FigureRequired, want{60000, true, true, "read 'around 60000' as $60,000"}},
		{"estimated", "estimated 45,000", FigureRequired,
			want{45000, true, true, "read 'estimated 45,000' as $45,000"}},
		{"ish", "70kish", FigureRequired, want{70000, true, true, "read '70kish' as $70,000"}},
		{"plus", "100k+", FigureRequired, want{100000, true, true, "read '100k+' as $100,000"}},
		{"thousand word", "85 thousand", FigureRequired, want{85000, true, true, "read '85 thousand' as $85,000"}},
		{"million", "1.5 million", FigureRequired, want{1500000, true, true, "read '1.5 million' as $1,500,000"}},

		// Ranges stay unknown.
		{"hyphen range", "1000-1500", FigureRequired, want{0, false, false, "a range: not read"}},
		{"between", "between 70 and 80k", FigureRequired, want{0, false, false, "a range: not read"}},
		{"to range", "$70,000 to $80,000", FigureRequired, want{0, false, false, "a range: not read"}},
		{"k range", "80-90k", FigureRequired, want{0, false, false, "a range: not read"}},
		{"en dash range", "70k – 80k", FigureRequired, want{0, false, false, "a range: not read"}},

		// Monthly: unknown for income, ×12 for rent and mortgage.
		{"monthly income", "$1,500/month", FigureRequired, want{0, false, false, "monthly: not read"}},
		{"per mo income", "1500 per mo", FigureRequired, want{0, false, false, "monthly: not read"}},
		{"monthly rent", "$1,500/month", FigureOptionalHousing,
			want{18000, true, true, "monthly: ×12 = $18,000"}},
		{"per month mortgage", "2200 per month", FigureOptionalHousing,
			want{26400, true, true, "monthly: ×12 = $26,400"}},
		{"monthly word rent", "1800 monthly", FigureOptionalHousing,
			want{21600, true, true, "monthly: ×12 = $21,600"}},
		{"hedged monthly rent", "about 1500/mo", FigureOptionalHousing,
			want{18000, true, true, "read 'about 1500/mo' as $1,500; monthly: ×12 = $18,000"}},

		// Not a dollar amount.
		{"percent", "50%", FigureRequired, want{0, false, false, "not a dollar amount"}},
		{"as much as possible", "as much as possible", FigureRequired, want{0, false, false, "not a dollar amount"}},
		{"whatever you can", "whatever you can", FigureRequired, want{0, false, false, "not a dollar amount"}},
		{"percent of cost", "half of the cost", FigureRequired, want{0, false, false, "not a dollar amount"}},

		// Words, negatives, several numbers.
		{"words", "twelve hundred", FigureRequired, want{0, false, false, "not a number"}},
		{"negative", "-500", FigureRequired, want{0, false, false, "negative"}},
		{"negative dollar", "-$2,000", FigureRequired, want{0, false, false, "negative"}},
		{"accounting negative", "($2,000)", FigureRequired, want{0, false, false, "negative"}},
		{"several numbers", "80000 in 2026, 75000 in 2025", FigureRequired,
			want{0, false, false, "several numbers: not read"}},
		{"number then prose", "1200 for the weekend please", FigureRequired, want{0, false, false, "not a number"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := ParseFigure(tc.typed, tc.kind)
			if got.Value != tc.want.value || got.Known != tc.want.known ||
				got.Reported != tc.want.reported || got.Note != tc.want.note {
				t.Errorf("ParseFigure(%q) = %+v, want %+v", tc.typed, got, tc.want)
			}
			if !got.Known && (got.Value != 0 || got.Note == "") {
				t.Errorf("an unknown figure must read 0 and carry a note: %+v", got)
			}
		})
	}
}

func TestParseCount(t *testing.T) {
	t.Parallel()
	cases := []struct {
		typed string
		value int
		known bool
		note  string
	}{
		{"2", 2, true, ""},
		{" 3 ", 3, true, ""},
		{"two", 2, true, ""},
		{"Two", 2, true, ""},
		{"0", 0, true, ""},
		{"none", 0, true, ""},
		{"2 kids", 2, true, ""},
		{"three children", 3, true, ""},
		{"", 0, false, "left blank"},
		{"a few", 0, false, "not a number"},
		{"2-3", 0, false, "not a number"},
		{"51", 0, false, "not a number"},
		{"-1", 0, false, "not a number"},
	}
	for _, tc := range cases {
		got, known, note := ParseCount(tc.typed)
		if got != tc.value || known != tc.known || note != tc.note {
			t.Errorf("ParseCount(%q) = (%d, %v, %q), want (%d, %v, %q)",
				tc.typed, got, known, note, tc.value, tc.known, tc.note)
		}
	}
}

func TestParseYesNo(t *testing.T) {
	t.Parallel()
	cases := []struct {
		typed     string
		value, ok bool
	}{
		{"Yes", true, true},
		{"yes ", true, true},
		{"No", false, true},
		{"", false, false},
		{"Prefer not to answer", false, false},
	}
	for _, tc := range cases {
		v, ok := ParseYesNo(tc.typed)
		if v != tc.value || ok != tc.ok {
			t.Errorf("ParseYesNo(%q) = (%v, %v), want (%v, %v)", tc.typed, v, ok, tc.value, tc.ok)
		}
	}
}

func TestNormalizeDate(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"1971-04-02":   "1971-04-02",
		" 1971-04-02 ": "1971-04-02",
		"04/02/1971":   "",
		"":             "",
		"1971-13-02":   "",
	}
	for typed, want := range cases {
		if got := NormalizeDate(typed); got != want {
			t.Errorf("NormalizeDate(%q) = %q, want %q", typed, got, want)
		}
	}
}
