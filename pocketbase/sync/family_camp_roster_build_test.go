package sync

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The roster builder's database half: what it reads, what it refuses, and the
// data traps it must respect (design §7). kindred#2433.

const rosterYear = 2026

// rosterFixture is a weekend under construction, so a test can say what it needs
// and nothing else.
type rosterFixture struct {
	t         *testing.T
	app       core.App
	sessionID string
}

func newRosterFixture(t *testing.T) *rosterFixture {
	t.Helper()
	app := newSyncTestApp(t)
	f := &rosterFixture{t: t, app: app}
	f.sessionID = f.addSession(cmIDFamilyCamp1, "Family Camp 2: Keshet LGBTQ Weekend", "family",
		"2026-08-20 07:00:00.000Z", "2026-08-23 07:00:00.000Z")
	return f
}

func (f *rosterFixture) addSession(cmID int, name, sessionType, start, end string) string {
	f.t.Helper()
	collection, err := f.app.FindCollectionByNameOrId("camp_sessions")
	if err != nil {
		f.t.Fatalf("camp_sessions: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("cm_id", cmID)
	record.Set("name", name)
	record.Set("session_type", sessionType)
	record.Set("start_date", start)
	record.Set("end_date", end)
	record.Set("year", rosterYear)
	if err := f.app.Save(record); err != nil {
		f.t.Fatalf("save session %q: %v", name, err)
	}
	return record.Id
}

// addHousehold creates a households row and returns its record id.
func (f *rosterFixture) addHousehold(cmID int) string {
	f.t.Helper()
	collection, err := f.app.FindCollectionByNameOrId("households")
	if err != nil {
		f.t.Fatalf("households: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("cm_id", cmID)
	record.Set("year", rosterYear)
	if err := f.app.Save(record); err != nil {
		f.t.Fatalf("save household %d: %v", cmID, err)
	}
	return record.Id
}

type rosterTestPerson struct {
	CMID           int
	First          string
	Last           string
	Preferred      string
	Birthdate      string
	NormalizedCity string
	AddressCity    string
	Year           int // 0 means rosterYear
}

// addPerson creates a persons row WITHOUT enrolling them, which is how a
// household member who is not an enrolled camper reaches the fixture.
func (f *rosterFixture) addPerson(householdID string, p *rosterTestPerson) string {
	f.t.Helper()
	collection, err := f.app.FindCollectionByNameOrId("persons")
	if err != nil {
		f.t.Fatalf("persons: %v", err)
	}
	year := p.Year
	if year == 0 {
		year = rosterYear
	}
	record := core.NewRecord(collection)
	record.Set("cm_id", p.CMID)
	record.Set("household", householdID)
	record.Set("year", year)
	record.Set("first_name", p.First)
	record.Set("last_name", p.Last)
	record.Set("preferred_name", p.Preferred)
	record.Set("birthdate", p.Birthdate)
	record.Set("normalized_city", p.NormalizedCity)
	record.Set("address_city", p.AddressCity)
	if err := f.app.Save(record); err != nil {
		f.t.Fatalf("save person %d: %v", p.CMID, err)
	}
	return record.Id
}

// enroll attaches an attendees row. statusID 2 is active-enrolled.
func (f *rosterFixture) enroll(personID, sessionID string, statusID, year int) {
	f.t.Helper()
	collection, err := f.app.FindCollectionByNameOrId("attendees")
	if err != nil {
		f.t.Fatalf("attendees: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("person", personID)
	record.Set("session", sessionID)
	record.Set("status_id", statusID)
	record.Set("year", year)
	if err := f.app.Save(record); err != nil {
		f.t.Fatalf("enroll %s: %v", personID, err)
	}
}

// addCamper is the common case: a person in a household, actively enrolled in
// the fixture's session for the roster year.
func (f *rosterFixture) addCamper(householdID string, p *rosterTestPerson) string {
	f.t.Helper()
	personID := f.addPerson(householdID, p)
	f.enroll(personID, f.sessionID, 2, rosterYear)
	return personID
}

type rosterTestAdult struct {
	Number int
	Name   string
	First  string
	Last   string
	Email  string
	Year   int // 0 means rosterYear
}

func (f *rosterFixture) addAdult(householdID string, a *rosterTestAdult) {
	f.t.Helper()
	collection, err := f.app.FindCollectionByNameOrId("family_camp_adults")
	if err != nil {
		f.t.Fatalf("family_camp_adults: %v", err)
	}
	year := a.Year
	if year == 0 {
		year = rosterYear
	}
	record := core.NewRecord(collection)
	record.Set("household", householdID)
	record.Set("year", year)
	record.Set("adult_number", a.Number)
	record.Set("name", a.Name)
	record.Set("first_name", a.First)
	record.Set("last_name", a.Last)
	record.Set("email", a.Email)
	if err := f.app.Save(record); err != nil {
		f.t.Fatalf("save adult %d: %v", a.Number, err)
	}
}

func (f *rosterFixture) build() (*Roster, error) {
	f.t.Helper()
	return BuildFamilyCampRoster(f.app, rosterYear, cmIDFamilyCamp1, exportedAt)
}

func (f *rosterFixture) mustBuild() *Roster {
	f.t.Helper()
	roster, err := f.build()
	if err != nil {
		f.t.Fatalf("BuildFamilyCampRoster: %v", err)
	}
	return roster
}

// blockNames renders one block as "Name|Role|Age|Email" rows, which is what the
// assertions compare -- naming the whole row makes a failure legible.
func blockRows(block HouseholdBlock) []string {
	out := make([]string, len(block.People))
	for i, p := range block.People {
		out[i] = strings.Join([]string{p.Name, p.Role, p.Age, p.Email}, "|")
	}
	return out
}

func assertRows(t *testing.T, block HouseholdBlock, want []string) {
	t.Helper()
	got := blockRows(block)
	if len(got) != len(want) {
		t.Fatalf("block has %d rows, want %d:\n got %v\nwant %v", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestBuildFamilyCampRosterOrdersOneHousehold pins the whole block shape:
// campers youngest first, then adults by adult_number, ages at export time, the
// email only on adults, and the city on the household rather than the row.
func TestBuildFamilyCampRosterOrdersOneHousehold(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{
		CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02", NormalizedCity: "Berkeley, CA",
	})
	f.addCamper(household, &rosterTestPerson{
		CMID: 2, First: "Avigail", Preferred: "Ava", Last: "Johnson", Birthdate: "2019-11-30",
	})
	f.addAdult(household, &rosterTestAdult{Number: 2, Name: "Liam Johnson", Email: "liam@example.com"})
	f.addAdult(household, &rosterTestAdult{Number: 1, Name: "Sarah Johnson", Email: "sarah@example.com"})

	roster := f.mustBuild()

	if len(roster.Blocks) != 1 {
		t.Fatalf("blocks = %d, want 1", len(roster.Blocks))
	}
	block := roster.Blocks[0]
	assertRows(t, block, []string{
		"Ava Johnson|Camper|6|",
		"Emma Johnson|Camper|12|",
		"Sarah Johnson|Adult 1||sarah@example.com",
		"Liam Johnson|Adult 2||liam@example.com",
	})
	if block.City != "Berkeley" {
		t.Errorf("city = %q, want %q", block.City, "Berkeley")
	}
	if roster.SessionName != "Family Camp 2: Keshet LGBTQ Weekend" {
		t.Errorf("session name = %q", roster.SessionName)
	}
	if roster.CamperCount() != 2 || roster.AdultCount() != 2 || roster.HouseholdCount() != 1 {
		t.Errorf("counts = %d campers, %d adults, %d households; want 2, 2, 1",
			roster.CamperCount(), roster.AdultCount(), roster.HouseholdCount())
	}
}

// TestBuildFamilyCampRosterExcludesNonEnrolledAttendees pins the attendee
// filter. status_id 32 is cancelled and 512 is incomplete; treating either as
// attending puts a family on the roster who is not coming.
func TestBuildFamilyCampRosterExcludesNonEnrolledAttendees(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})

	for _, status := range []int{32, 512} {
		cancelled := f.addPerson(household, &rosterTestPerson{CMID: 100 + status, First: "Ghost", Last: "Johnson"})
		f.enroll(cancelled, f.sessionID, status, rosterYear)
	}

	roster := f.mustBuild()
	if roster.CamperCount() != 1 {
		t.Fatalf("campers = %d, want 1 (rows: %v)", roster.CamperCount(), blockRows(roster.Blocks[0]))
	}
}

// TestBuildFamilyCampRosterExcludesOtherSessionsAndYears keeps one weekend's
// roster to that weekend. CampMinder reuses session ids across years, so the
// year filter is load-bearing, not belt-and-braces.
func TestBuildFamilyCampRosterExcludesOtherSessionsAndYears(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	other := f.addSession(cmIDFamilyCamp6, "Family Camp 6", "family",
		"2026-09-24 07:00:00.000Z", "2026-09-27 07:00:00.000Z")

	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})

	elsewhere := f.addPerson(household, &rosterTestPerson{CMID: 2, First: "Other", Last: "Weekend"})
	f.enroll(elsewhere, other, 2, rosterYear)

	lastYear := f.addPerson(household, &rosterTestPerson{CMID: 3, First: "Last", Last: "Year", Year: 2025})
	f.enroll(lastYear, f.sessionID, 2, 2025)

	roster := f.mustBuild()
	if roster.CamperCount() != 1 {
		t.Fatalf("campers = %d, want 1 (rows: %v)", roster.CamperCount(), blockRows(roster.Blocks[0]))
	}
}

// TestBuildFamilyCampRosterFiltersPlaceholderAdults keeps "N/A" off a family's
// block while keeping the real adult beside it.
func TestBuildFamilyCampRosterFiltersPlaceholderAdults(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})
	f.addAdult(household, &rosterTestAdult{Number: 1, Name: "Sarah Johnson", Email: "sarah@example.com"})
	f.addAdult(household, &rosterTestAdult{Number: 2, Name: "N/A"})
	f.addAdult(household, &rosterTestAdult{Number: 3, Name: "  "})

	roster := f.mustBuild()
	assertRows(t, roster.Blocks[0], []string{
		"Emma Johnson|Camper|12|",
		"Sarah Johnson|Adult 1||sarah@example.com",
	})
}

// TestBuildFamilyCampRosterKeepsNamelessEmailOnLaterAdults pins design §7: an
// adult_number >= 3 row carries a name and nothing else on 27 of 27 such 2026
// rows. A blank email there is CORRECT and permanent, not missing data, so the
// row must render rather than be filtered as incomplete.
func TestBuildFamilyCampRosterKeepsNamelessEmailOnLaterAdults(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})
	f.addAdult(household, &rosterTestAdult{Number: 1, Name: "Sarah Johnson", Email: "sarah@example.com"})
	f.addAdult(household, &rosterTestAdult{Number: 3, Name: "Ruth Okafor"})

	roster := f.mustBuild()
	assertRows(t, roster.Blocks[0], []string{
		"Emma Johnson|Camper|12|",
		"Sarah Johnson|Adult 1||sarah@example.com",
		"Ruth Okafor|Adult 3||",
	})
}

// TestBuildFamilyCampRosterCoalescesAdultNames pins that the split columns are
// the FALLBACK. last_name is blank on every 2026 row, so a builder reading the
// pair first renders a first name and a trailing space.
func TestBuildFamilyCampRosterCoalescesAdultNames(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})
	f.addAdult(household, &rosterTestAdult{Number: 1, First: "Sarah", Last: "Johnson"})

	roster := f.mustBuild()
	assertRows(t, roster.Blocks[0], []string{
		"Emma Johnson|Camper|12|",
		"Sarah Johnson|Adult 1||",
	})
}

// TestBuildFamilyCampRosterRendersDuplicateAdultsRaw pins design §7 and
// kindred#2483: the same person in two adult slots, both coalescing to one name,
// exists in 2 households in 2026. The export renders them RAW -- deduping here
// would hide the underlying sync defect behind a clean-looking roster.
func TestBuildFamilyCampRosterRendersDuplicateAdultsRaw(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})
	f.addAdult(household, &rosterTestAdult{Number: 1, Name: "Sarah Johnson", Email: "sarah@example.com"})
	f.addAdult(household, &rosterTestAdult{Number: 2, Name: "Sarah Johnson", Email: "sarah@example.com"})

	roster := f.mustBuild()
	assertRows(t, roster.Blocks[0], []string{
		"Emma Johnson|Camper|12|",
		"Sarah Johnson|Adult 1||sarah@example.com",
		"Sarah Johnson|Adult 2||sarah@example.com",
	})
}

// TestBuildFamilyCampRosterFallsBackToAnyHouseholdMemberForCity pins design §3:
// the city can sit on a household member who is not an enrolled camper.
func TestBuildFamilyCampRosterFallsBackToAnyHouseholdMemberForCity(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})
	f.addPerson(household, &rosterTestPerson{
		CMID: 2, First: "Sarah", Last: "Johnson", AddressCity: testCityOakland + ", CA",
	})

	roster := f.mustBuild()
	if roster.Blocks[0].City != testCityOakland {
		t.Errorf("city = %q, want %q", roster.Blocks[0].City, testCityOakland)
	}
}

// TestBuildFamilyCampRosterCityFallbackStaysWithinTheHousehold guards the
// fallback against reaching across families -- a wrong city on a family's block
// is worse than a blank one.
//
// Both households here are city-less at camper level, so BOTH go through the
// fallback query together; only one has a non-camper member carrying a city.
// That is what makes the test able to fail: with one household in the batch, a
// fallback that assigned its find to every household in the batch would be
// indistinguishable from a correct one.
func TestBuildFamilyCampRosterCityFallbackStaysWithinTheHousehold(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)

	knows := f.addHousehold(9001)
	f.addCamper(knows, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})
	f.addPerson(knows, &rosterTestPerson{CMID: 2, First: "Sarah", Last: "Johnson", AddressCity: "Fresno, CA"})

	blank := f.addHousehold(9002)
	f.addCamper(blank, &rosterTestPerson{CMID: 3, First: "Ben", Last: "Garcia", Birthdate: "2015-01-01"})
	f.addPerson(blank, &rosterTestPerson{CMID: 4, First: "Rosa", Last: "Garcia"})

	cities := map[string]string{}
	for _, block := range f.mustBuild().Blocks {
		cities[block.HouseholdID] = block.City
	}
	if cities[knows] != "Fresno" {
		t.Errorf("city = %q on the household that has one, want %q", cities[knows], "Fresno")
	}
	if cities[blank] != "" {
		t.Errorf("city = %q on the household with none, want empty -- the fallback leaked", cities[blank])
	}
}

// TestBuildFamilyCampRosterKeepsHouseholdsWithNoAdults pins design §7 and §8: a
// household with enrolled campers and no Family Camp registration is legitimate
// (4 of 391 in 2026) and renders as-is, with no cue in v1.
func TestBuildFamilyCampRosterKeepsHouseholdsWithNoAdults(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})

	roster := f.mustBuild()
	assertRows(t, roster.Blocks[0], []string{"Emma Johnson|Camper|12|"})
}

// TestBuildFamilyCampRosterIgnoresOtherYearsAdults keeps last season's adults off
// this season's roster. family_camp_adults is keyed (household, year,
// adult_number), so the year filter is what separates them.
func TestBuildFamilyCampRosterIgnoresOtherYearsAdults(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})
	f.addAdult(household, &rosterTestAdult{Number: 1, Name: "Sarah Johnson"})
	f.addAdult(household, &rosterTestAdult{Number: 2, Name: "Last Season", Year: 2025})

	roster := f.mustBuild()
	assertRows(t, roster.Blocks[0], []string{
		"Emma Johnson|Camper|12|",
		"Sarah Johnson|Adult 1||",
	})
}

// TestBuildFamilyCampRosterOrdersHouseholds pins the sheet-level order:
// ascending on the first (youngest) camper's surname.
func TestBuildFamilyCampRosterOrdersHouseholds(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	for cmID, surname := range map[int]string{9001: "Ortiz", 9002: "Garcia", 9003: "Johnson"} {
		household := f.addHousehold(cmID)
		f.addCamper(household, &rosterTestPerson{
			CMID: cmID, First: "Kid", Last: surname, Birthdate: "2014-03-02",
		})
	}

	roster := f.mustBuild()
	want := []string{"Kid Garcia", "Kid Johnson", "Kid Ortiz"}
	for i, name := range want {
		if got := roster.Blocks[i].People[0].Name; got != name {
			t.Errorf("block %d first person = %q, want %q", i, got, name)
		}
	}
}

// TestBuildFamilyCampRosterMarksLinkedHouseholds pins design §5 end to end: two
// households sharing an adult are colored, never merged.
func TestBuildFamilyCampRosterMarksLinkedHouseholds(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	first := f.addHousehold(9001)
	f.addCamper(first, &rosterTestPerson{CMID: 1, First: "Ana", Last: "Garcia", Birthdate: "2014-03-02"})
	f.addAdult(first, &rosterTestAdult{Number: 1, Name: "Sarah Johnson"})

	second := f.addHousehold(9002)
	f.addCamper(second, &rosterTestPerson{CMID: 2, First: "Ben", Last: "Johnson", Birthdate: "2014-03-02"})
	f.addAdult(second, &rosterTestAdult{Number: 1, Name: "Sarah Johnson"})

	alone := f.addHousehold(9003)
	f.addCamper(alone, &rosterTestPerson{CMID: 3, First: "Cara", Last: "Ortiz", Birthdate: "2014-03-02"})
	f.addAdult(alone, &rosterTestAdult{Number: 1, Name: "Ruth Okafor"})

	roster := f.mustBuild()
	if len(roster.Blocks) != 3 {
		t.Fatalf("blocks = %d, want 3", len(roster.Blocks))
	}
	byHousehold := map[string]HouseholdBlock{}
	for _, block := range roster.Blocks {
		byHousehold[block.HouseholdID] = block
	}
	if g := byHousehold[first].LinkGroup; g == 0 || g != byHousehold[second].LinkGroup {
		t.Errorf("link groups = %d and %d, want equal and non-zero",
			byHousehold[first].LinkGroup, byHousehold[second].LinkGroup)
	}
	if g := byHousehold[alone].LinkGroup; g != 0 {
		t.Errorf("unlinked household has group %d, want 0", g)
	}
}

func TestBuildFamilyCampRosterRefusals(t *testing.T) {
	t.Parallel()

	t.Run("unknown session", func(t *testing.T) {
		t.Parallel()
		app := newSyncTestApp(t)
		_, err := BuildFamilyCampRoster(app, rosterYear, 1234567, exportedAt)
		if !errors.Is(err, ErrRosterSessionNotFound) {
			t.Fatalf("err = %v, want ErrRosterSessionNotFound", err)
		}
	})

	// A summer session has no family_camp_adults rows at all, so building one
	// would emit a camper-only roster that looks plausible and is wrong.
	t.Run("not a family session", func(t *testing.T) {
		t.Parallel()
		f := newRosterFixture(t)
		summer := f.addSession(1309600, "Session 1", "summer",
			"2026-06-20 07:00:00.000Z", "2026-07-04 07:00:00.000Z")
		household := f.addHousehold(9001)
		person := f.addPerson(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson"})
		f.enroll(person, summer, 2, rosterYear)

		_, err := BuildFamilyCampRoster(f.app, rosterYear, 1309600, exportedAt)
		if !errors.Is(err, ErrRosterSessionNotFamily) {
			t.Fatalf("err = %v, want ErrRosterSessionNotFamily", err)
		}
	})

	// Two of 2026's ten family weekends have no enrolled campers. An empty tab
	// appended to a workbook is worse than a clear error.
	t.Run("no enrolled campers", func(t *testing.T) {
		t.Parallel()
		f := newRosterFixture(t)
		_, err := f.build()
		if !errors.Is(err, ErrRosterNoEnrolledCampers) {
			t.Fatalf("err = %v, want ErrRosterNoEnrolledCampers", err)
		}
	})
}

// TestBuildFamilyCampRosterUsesTheGivenInstantForAges pins that ages come from
// the caller's clock rather than the session start (design §Age). The reference
// implementation passed session start; the design supersedes it, and only a test
// separating the two can tell them apart.
func TestBuildFamilyCampRosterUsesTheGivenInstantForAges(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	// Birthday falls between the session start (2026-08-20) and the export.
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2018-08-19"})

	sessionStart := time.Date(2026, time.August, 20, 0, 0, 0, 0, time.UTC)
	atStart, err := BuildFamilyCampRoster(f.app, rosterYear, cmIDFamilyCamp1, sessionStart)
	if err != nil {
		t.Fatalf("build at session start: %v", err)
	}
	if got := atStart.Blocks[0].People[0].Age; got != "8" {
		t.Fatalf("age at session start = %q, want %q", got, "8")
	}

	dayBefore := time.Date(2026, time.August, 18, 0, 0, 0, 0, time.UTC)
	earlier, err := BuildFamilyCampRoster(f.app, rosterYear, cmIDFamilyCamp1, dayBefore)
	if err != nil {
		t.Fatalf("build before the birthday: %v", err)
	}
	if got := earlier.Blocks[0].People[0].Age; got != "7" {
		t.Errorf("age two days earlier = %q, want %q -- ages must follow the export instant", got, "7")
	}
}

// TestBuildFamilyCampRosterCityFallbackIsYearScoped pins the year filter on the
// fallback query.
//
// Belt-and-braces today, deliberately. `households` is itself year-scoped --
// unique on (cm_id, year), one record per household per season -- so a 2026
// household record cannot be reached by a 2025 person, and production carries
// zero households whose persons span years. The filter costs nothing, states the
// scoping at the query rather than leaving it to a reader who has to know the
// households invariant, and matches attachRosterAdults, which filters the same
// way. This test seeds the shape the invariant forbids so that the filter is
// pinned rather than merely present.
func TestBuildFamilyCampRosterCityFallbackIsYearScoped(t *testing.T) {
	t.Parallel()
	f := newRosterFixture(t)
	household := f.addHousehold(9001)
	f.addCamper(household, &rosterTestPerson{CMID: 1, First: "Emma", Last: "Johnson", Birthdate: "2014-03-02"})
	// A prior season's member of the same household record, carrying a city.
	f.addPerson(household, &rosterTestPerson{
		CMID: 2, First: "Sarah", Last: "Johnson", AddressCity: "Fresno, CA", Year: 2025,
	})

	roster := f.mustBuild()
	if got := roster.Blocks[0].City; got != "" {
		t.Errorf("city = %q, want empty -- a prior season's row must not supply this year's city", got)
	}
}
