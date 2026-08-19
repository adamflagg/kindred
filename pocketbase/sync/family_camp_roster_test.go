package sync

import (
	"testing"
	"time"
)

// exportedAt is the "now" every age test is measured against. Ages are computed
// AT EXPORT TIME rather than at session start (kindred#2433 design §Age), so the
// reference value is a wall-clock instant, not a session property.
var exportedAt = time.Date(2026, time.August, 19, 15, 4, 0, 0, time.UTC)

func TestRosterAgeLabel(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name      string
		birthdate string
		want      string
	}{
		{"blank birthdate renders nothing", "", ""},
		{"unparseable birthdate renders nothing", "not-a-date", ""},
		// The whole-years / whole-months boundary, from both sides. A camper one
		// day short of their first birthday is "11 mos", not "0".
		{"eleven months", "2025-09-19", "11 mos"},
		{"exactly twelve months", "2025-08-19", "1"},
		{"thirteen months", "2025-07-19", "1"},
		// The singular. "1 mos" is the tell that the branch is missing.
		{"one month", "2026-07-19", "1 mo"},
		{"zero months", "2026-08-19", "0 mos"},
		// Day-of-month borrow: born on the 20th, exported on the 19th, so the
		// current month has not completed.
		{"borrows when the day has not come round", "2026-07-20", "0 mos"},
		{"borrows across a year boundary", "2018-08-20", "7"},
		{"does not borrow on the birthday itself", "2018-08-19", "8"},
		// A birthdate in the future is bad data, never a negative age.
		{"future birthdate clamps to zero", "2027-01-01", "0 mos"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := rosterAgeLabel(tc.birthdate, exportedAt); got != tc.want {
				t.Errorf("rosterAgeLabel(%q) = %q, want %q", tc.birthdate, got, tc.want)
			}
		})
	}
}

// TestRosterAgeLabelAcrossALeapDayBirthday pins the two days that straddle a
// 29 February birthday in a non-leap year, where "the same day of the month"
// does not exist. 28 February must still be the last day of the ninth year.
func TestRosterAgeLabelAcrossALeapDayBirthday(t *testing.T) {
	t.Parallel()
	const leapling = "2016-02-29"
	for _, tc := range []struct {
		name string
		on   time.Time
		want string
	}{
		{"the day before", time.Date(2026, time.February, 28, 12, 0, 0, 0, time.UTC), "9"},
		{"the day after", time.Date(2026, time.March, 1, 12, 0, 0, 0, time.UTC), "10"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := rosterAgeLabel(leapling, tc.on); got != tc.want {
				t.Errorf("rosterAgeLabel(%q, %s) = %q, want %q", leapling, tc.on.Format(time.DateOnly), got, tc.want)
			}
		})
	}
}

func TestRosterCleanCity(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, normalized, raw, want string
	}{
		// normalized_city is preferred because it fixes casing.
		{"prefers the normalized value", "Berkeley, CA", "berkeley", "Berkeley"},
		{"falls back to the raw value", "", "Oakland", "Oakland"},
		{"falls back when normalized is whitespace", "   ", "Oakland", "Oakland"},
		{"strips the state suffix", "San Francisco, CA", "", "San Francisco"},
		{"strips a suffix with no space", "Portland,OR", "", "Portland"},
		{"keeps a comma that is not a state", "Washington, District", "", "Washington, District"},
		{"keeps a lowercase two-letter tail", "Something, ca", "", "Something, ca"},
		{"both blank", "", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := rosterCleanCity(tc.normalized, tc.raw); got != tc.want {
				t.Errorf("rosterCleanCity(%q, %q) = %q, want %q", tc.normalized, tc.raw, got, tc.want)
			}
		})
	}
}

// TestIsRosterAdultName pins the placeholder filter. Registrants type these into
// the adult-name field to mean "no second adult"; rendering them puts a row
// called "N/A" on a family's roster block.
func TestIsRosterAdultName(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		want bool
	}{
		{"Emma Johnson", true},
		{"", false},
		{"   ", false},
		{"na", false},
		{"NA", false},
		{"N/A", false},
		{"n/a", false},
		{"none", false},
		{"None", false},
		{"-", false},
		{"0", false},
		{"no", false},
		{" No ", false},
		// Real names that merely start with a placeholder token stay.
		{"Nathan Okafor", true},
		{"Noor Haddad", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := isRosterAdultName(tc.name); got != tc.want {
				t.Errorf("isRosterAdultName(%q) = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

// TestRosterAdultName pins the coalesce. family_camp_adults.last_name is blank
// for every 2026 row, so reading the split columns alone yields a first name and
// a trailing space -- `name` is the column of record.
func TestRosterAdultName(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, nameCol, first, last, want string
	}{
		{"name column wins", "Emma Johnson", "Emma", "Johnson", "Emma Johnson"},
		{"falls back to the split columns", "", "Liam", "Garcia", "Liam Garcia"},
		{"falls back when name is whitespace", "  ", "Liam", "Garcia", "Liam Garcia"},
		{"first name only", "", "Liam", "", "Liam"},
		{"last name only", "", "", "Garcia", "Garcia"},
		{"all blank", "", "", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := rosterAdultName(tc.nameCol, tc.first, tc.last)
			if got != tc.want {
				t.Errorf("rosterAdultName(%q, %q, %q) = %q, want %q",
					tc.nameCol, tc.first, tc.last, got, tc.want)
			}
		})
	}
}

func TestRosterCamperName(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, preferred, first, last, want string
	}{
		{"preferred name wins", "Ollie", "Oliver", "Chen", "Ollie Chen"},
		{"falls back to first name", "", "Oliver", "Chen", "Oliver Chen"},
		{"falls back when preferred is whitespace", " ", "Oliver", "Chen", "Oliver Chen"},
		{"no surname", "", "Oliver", "", "Oliver"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := rosterCamperName(tc.preferred, tc.first, tc.last)
			if got != tc.want {
				t.Errorf("rosterCamperName(%q, %q, %q) = %q, want %q",
					tc.preferred, tc.first, tc.last, got, tc.want)
			}
		})
	}
}

func TestFormatRosterDateRange(t *testing.T) {
	t.Parallel()
	day := func(y int, m time.Month, d int) time.Time {
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}
	for _, tc := range []struct {
		name       string
		start, end time.Time
		want       string
	}{
		{
			"within one month",
			day(2026, time.August, 20), day(2026, time.August, 23),
			"August 20–23, 2026",
		},
		{
			"straddling a month boundary",
			day(2026, time.August, 30), day(2026, time.September, 2),
			"August 30 – September 2, 2026",
		},
		{
			"a single day",
			day(2026, time.July, 4), day(2026, time.July, 4),
			"July 4–4, 2026",
		},
		{
			// The design names only the same-month and same-year-different-month
			// forms, both of which print one year -- the end's. Winter Family Camp
			// runs in late December (27-29 in 2026, 21-23 in 2025), so a New Year
			// weekend is a shape this will meet, and printing only the end year
			// would date the whole weekend to January.
			"straddling a year boundary",
			day(2026, time.December, 30), day(2027, time.January, 2),
			"December 30, 2026 – January 2, 2027",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := formatRosterDateRange(tc.start, tc.end); got != tc.want {
				t.Errorf("formatRosterDateRange = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestSortRosterCampers pins youngest-first, with a missing birthdate filing
// last. The order matters beyond the block itself: households are sorted on the
// FIRST camper's surname, so a wrong camper order silently reorders the sheet.
func TestSortRosterCampers(t *testing.T) {
	t.Parallel()
	campers := []rosterCamper{
		{Name: "Emma Johnson", Last: "Johnson", Birthdate: "2014-03-02"},
		{Name: "Noah Johnson", Last: "Johnson", Birthdate: ""},
		{Name: "Ava Johnson", Last: "Johnson", Birthdate: "2019-11-30"},
		{Name: "Liam Johnson", Last: "Johnson", Birthdate: "2017-06-01"},
	}
	sortRosterCampers(campers)

	want := []string{"Ava Johnson", "Liam Johnson", "Emma Johnson", "Noah Johnson"}
	for i, name := range want {
		if campers[i].Name != name {
			t.Errorf("campers[%d] = %q, want %q (full order: %v)", i, campers[i].Name, name, names(campers))
		}
	}
}

// TestSortRosterCampersBreaksTiesByName keeps the output stable for twins, whose
// birthdates are identical.
func TestSortRosterCampersBreaksTiesByName(t *testing.T) {
	t.Parallel()
	campers := []rosterCamper{
		{Name: "Zoe Garcia", Last: "Garcia", Birthdate: "2015-04-04"},
		{Name: "Ana Garcia", Last: "Garcia", Birthdate: "2015-04-04"},
	}
	sortRosterCampers(campers)
	if campers[0].Name != "Ana Garcia" {
		t.Errorf("campers = %v, want Ana Garcia first", names(campers))
	}
}

func names(campers []rosterCamper) []string {
	out := make([]string, len(campers))
	for i, c := range campers {
		out[i] = c.Name
	}
	return out
}

// TestOrderRosterHouseholds pins the household ordering: case-folded surname of
// the block's first camper, then that camper's display name, then the record id.
func TestOrderRosterHouseholds(t *testing.T) {
	t.Parallel()
	households := []rosterHousehold{
		{ID: "hh3", Campers: []rosterCamper{{Name: "Ana Ortiz", Last: "ortiz"}}},
		{ID: "hh1", Campers: []rosterCamper{{Name: "Emma Johnson", Last: "Johnson"}}},
		{ID: "hh2", Campers: []rosterCamper{{Name: "Ben Garcia", Last: "Garcia"}}},
	}
	orderRosterHouseholds(households)

	want := []string{"hh2", "hh1", "hh3"}
	for i, id := range want {
		if households[i].ID != id {
			t.Fatalf("order = %v, want %v", householdIDs(households), want)
		}
	}
}

// TestOrderRosterHouseholdsBreaksTies pins both tiebreakers, because two
// unrelated families sharing a surname is common and a nondeterministic order
// makes two exports of unchanged data differ.
func TestOrderRosterHouseholdsBreaksTies(t *testing.T) {
	t.Parallel()
	households := []rosterHousehold{
		{ID: "hhZ", Campers: []rosterCamper{{Name: "Zoe Garcia", Last: "Garcia"}}},
		{ID: "hhB", Campers: []rosterCamper{{Name: "Ana Garcia", Last: "Garcia"}}},
		{ID: "hhA", Campers: []rosterCamper{{Name: "Ana Garcia", Last: "Garcia"}}},
	}
	orderRosterHouseholds(households)

	want := []string{"hhA", "hhB", "hhZ"}
	for i, id := range want {
		if households[i].ID != id {
			t.Fatalf("order = %v, want %v", householdIDs(households), want)
		}
	}
}

func householdIDs(households []rosterHousehold) []string {
	out := make([]string, len(households))
	for i, h := range households {
		out[i] = h.ID
	}
	return out
}

// TestLinkedHouseholdGroups pins §5: two households sharing an adult are LINKED,
// never merged. Merging would fix the friend-attending-with-another-family case
// and force a single wrong city onto co-parents keeping two homes.
func TestLinkedHouseholdGroups(t *testing.T) {
	t.Parallel()
	order := []string{"hh1", "hh2", "hh3", "hh4"}
	adults := map[string][]string{
		"hh1": {"Emma Johnson", "Liam Johnson"},
		"hh2": {"Liam Johnson"}, // shares an adult with hh1
		"hh3": {"Ana Ortiz"},
		"hh4": {"Ben Garcia"},
	}

	groups := linkedHouseholdGroups(order, adults)

	if groups["hh1"] == 0 || groups["hh1"] != groups["hh2"] {
		t.Errorf("hh1=%d hh2=%d, want both in the same non-zero group", groups["hh1"], groups["hh2"])
	}
	if groups["hh3"] != 0 || groups["hh4"] != 0 {
		t.Errorf("hh3=%d hh4=%d, want both ungrouped", groups["hh3"], groups["hh4"])
	}
}

// TestLinkedHouseholdGroupsAreTransitive keeps one household out of two groups:
// A shares an adult with B and B with C, so all three are one group and get one
// color. Two colors on B would read as two separate pairings.
func TestLinkedHouseholdGroupsAreTransitive(t *testing.T) {
	t.Parallel()
	order := []string{"hhA", "hhB", "hhC"}
	adults := map[string][]string{
		"hhA": {"Emma Johnson"},
		"hhB": {"Emma Johnson", "Liam Garcia"},
		"hhC": {"Liam Garcia"},
	}

	groups := linkedHouseholdGroups(order, adults)
	if groups["hhA"] == 0 || groups["hhA"] != groups["hhB"] || groups["hhB"] != groups["hhC"] {
		t.Errorf("groups = %v, want all three in one non-zero group", groups)
	}
}

// TestLinkedHouseholdGroupsMatchCaseInsensitively: the same adult is typed into
// two households' registration forms by two different people.
func TestLinkedHouseholdGroupsMatchCaseInsensitively(t *testing.T) {
	t.Parallel()
	groups := linkedHouseholdGroups(
		[]string{"hh1", "hh2"},
		map[string][]string{"hh1": {"emma johnson"}, "hh2": {"  Emma Johnson "}},
	)
	if groups["hh1"] == 0 || groups["hh1"] != groups["hh2"] {
		t.Errorf("groups = %v, want one shared group", groups)
	}
}

// TestLinkedHouseholdGroupsIgnoreDuplicatesWithinOneHousehold guards the
// interaction with kindred#2483: the same person in two adult slots of ONE
// household is a duplicate, not a link, and must not color that household.
func TestLinkedHouseholdGroupsIgnoreDuplicatesWithinOneHousehold(t *testing.T) {
	t.Parallel()
	groups := linkedHouseholdGroups(
		[]string{"hh1"},
		map[string][]string{"hh1": {"Emma Johnson", "Emma Johnson"}},
	)
	if len(groups) != 0 {
		t.Errorf("groups = %v, want no household grouped", groups)
	}
}

// TestLinkedHouseholdGroupsNumberByFirstAppearance keeps colors stable: the
// group numbering follows the roster's own household order, so re-exporting
// unchanged data paints the same households the same color.
func TestLinkedHouseholdGroupsNumberByFirstAppearance(t *testing.T) {
	t.Parallel()
	order := []string{"hh1", "hh2", "hh3", "hh4"}
	adults := map[string][]string{
		"hh1": {"Ana Ortiz"},
		"hh2": {"Emma Johnson"},
		"hh3": {"Ana Ortiz"},
		"hh4": {"Emma Johnson"},
	}

	groups := linkedHouseholdGroups(order, adults)
	if groups["hh1"] != 1 || groups["hh3"] != 1 {
		t.Errorf("hh1=%d hh3=%d, want group 1 (first to appear)", groups["hh1"], groups["hh3"])
	}
	if groups["hh2"] != 2 || groups["hh4"] != 2 {
		t.Errorf("hh2=%d hh4=%d, want group 2", groups["hh2"], groups["hh4"])
	}
}
