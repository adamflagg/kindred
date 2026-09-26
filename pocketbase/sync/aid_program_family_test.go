package sync

import "testing"

func TestProgramFamilyForSessionType(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"main":     programFamilySummer,
		"embedded": programFamilySummer,
		"ag":       programFamilySummer,
		"quest":    programFamilyQuest,
		"scit":     programFamilyTeen,
		"tli":      programFamilyTeen,
		"teen":     programFamilyTeen,
		"bmitzvah": programFamilyBMitzvah,
		"hebrew":   programFamilyBMitzvah,
		"family":   programFamilyFamilyCamp,
		"adult":    programFamilyAdultWeekend,
		"school":   programFamilyFamilySchool,
		"other":    programFamilyOther,
		"":         programFamilyOther,
		"unheard":  programFamilyOther,
	}
	for in, want := range cases {
		if got := programFamilyForSessionType(in); got != want {
			t.Errorf("programFamilyForSessionType(%q) = %q, want %q", in, got, want)
		}
	}
	// Session types are trimmed and case-folded before lookup.
	if got := programFamilyForSessionType("  MAIN "); got != programFamilySummer {
		t.Errorf("a padded upper-case type must still map, got %q", got)
	}
}

func TestIsAidProgramFamily(t *testing.T) {
	t.Parallel()
	for _, f := range aidProgramFamilies {
		if !isAidProgramFamily(f) {
			t.Errorf("%q must be a program family", f)
		}
	}
	for _, f := range []string{"", "Summer", "ambiguous", "unattributed"} {
		if isAidProgramFamily(f) {
			t.Errorf("%q must not be a program family", f)
		}
	}
	if len(aidProgramFamilies) != 8 {
		t.Errorf("expected the eight families of spec §6.3, got %d", len(aidProgramFamilies))
	}
}

func TestNormalizeAidLabel(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"Regional Grant - North":            "regional grant - north",
		"Regional Grant- North":             "regional grant - north",
		"Regional Grant-North":              "regional grant - north",
		"Regional Grant – North":            "regional grant - north",
		"Regional Grant —North":             "regional grant - north",
		"  REGIONAL   grant  -   north  ":   "regional grant - north",
		"Example Camp Financial Assistance": "example camp financial assistance",
		"Session 2":                         "session 2",
		"Session 3 (All-Gender Cabin)":      "session 3 (all - gender cabin)",
		"":                                  "",
		"   ":                               "",
		"Grant North":                       "grant north",
		"A\vB":                              "a b", // vertical tab: RE2's \s alone omits it
		"A B":                               "a b", // U+202F narrow no-break space: outside RE2's \s
	}
	for in, want := range cases {
		if got := normalizeAidLabel(in); got != want {
			t.Errorf("normalizeAidLabel(%q) = %q, want %q", in, got, want)
		}
	}
}
