package sync

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// kindred#2784: attribute each weekend's cabin from captured value history.
//
// The rule under test, as the owner ruled it on 2026-09-23:
//
//   - A weekend's cabin is the value in effect when that weekend STARTS -- the
//     start of its first day, camp-local.
//   - The clock is CampMinder's change time, not the time our sync saw it.
//   - An unchanged value carries forward to every later weekend.
//   - A value written after the party's last weekend started lands on that last
//     weekend (the existing "lone late edit" behavior).
//   - The timeline is known only from its earliest known write. A weekend whose
//     cutoff falls before that floor is undetermined, and stays unplaced.
//   - A staff confirmation on the queue still wins.

// Cabin strings for the history tests. Deliberately generic: no registry unit
// name appears in this file.
const (
	histCabinA     = "Cabin A"
	histCabinB     = "Cabin B"
	histCabinTypo  = "Cabni A"
	histHousehold  = 9101
	histPerson     = 5101
	histAdultGuest = 5201
)

// testPacific is the camp's timezone, loaded explicitly so these tests do not
// depend on the machine's TZ.
func testPacific(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load Pacific: %v", err)
	}
	return loc
}

// at parses an RFC3339 instant for a fixture.
func at(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return v
}

// weekend builds a SessionWindow starting at local midnight on the given date,
// which is how camp_sessions.start_date is stored (e.g. 07:00Z in summer).
func weekend(t *testing.T, cmID int, startUTC string) SessionWindow {
	t.Helper()
	start := at(t, startUTC)
	return SessionWindow{
		ID: "pb-" + strings.ReplaceAll(startUTC, ":", ""), CMID: cmID,
		Name: "Weekend", Start: start, End: start.Add(72 * time.Hour),
	}
}

// valuesOf flattens an attribution to one string per weekend, "?" for an
// undetermined weekend, so a failure message shows the whole answer at once.
func valuesOf(got []weekendValue) []string {
	out := make([]string, 0, len(got))
	for _, w := range got {
		if !w.Known {
			out = append(out, "?")
			continue
		}
		out = append(out, w.Value)
	}
	return out
}

func assertWeekendValues(t *testing.T, got []weekendValue, want ...string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d weekends %v, want %d %v", len(got), valuesOf(got), len(want), want)
	}
	for i, w := range valuesOf(got) {
		if w != want[i] {
			t.Errorf("weekend %d = %q, want %q (all: %v)", i+1, w, want[i], valuesOf(got))
		}
	}
}

// Every pure-rule test sits after both weekends unless it says otherwise.
const histNowAfterAll = "2026-10-15T12:00:00Z"

func TestHistoryAttributionOneValueBeforeBothWeekendsPlacesBoth(t *testing.T) {
	t.Parallel()
	w1 := weekend(t, 1, "2026-05-22T07:00:00Z")
	w2 := weekend(t, 2, "2026-09-24T07:00:00Z")

	got := attributeFromHistory([]SessionWindow{w1, w2}, nil,
		valueWrite{At: at(t, "2026-05-15T17:05:34Z"), Value: histCabinA},
		at(t, histNowAfterAll), testPacific(t))

	assertWeekendValues(t, got, histCabinA, histCabinA)
}

func TestHistoryAttributionChangeBetweenWeekendsSplitsThem(t *testing.T) {
	t.Parallel()
	w1 := weekend(t, 1, "2026-05-22T07:00:00Z")
	w2 := weekend(t, 2, "2026-09-24T07:00:00Z")

	got := attributeFromHistory([]SessionWindow{w1, w2},
		[]valueWrite{{At: at(t, "2026-05-10T09:00:00Z"), Value: histCabinA}},
		valueWrite{At: at(t, "2026-06-01T09:00:00Z"), Value: histCabinB},
		at(t, histNowAfterAll), testPacific(t))

	assertWeekendValues(t, got, histCabinA, histCabinB)
}

// Two edits before W1 -- a typo, then its fix. W1 is the later edit, and W2
// carries it forward. The history is passed out of order on purpose: a rule
// that paired the k-th write with the k-th weekend would put the typo on W1 and
// the fix on W2, and the rule is by TIME, not by position.
func TestHistoryAttributionTypoFixBeforeW1CarriesTheFixForward(t *testing.T) {
	t.Parallel()
	w1 := weekend(t, 1, "2026-05-22T07:00:00Z")
	w2 := weekend(t, 2, "2026-09-24T07:00:00Z")

	got := attributeFromHistory([]SessionWindow{w1, w2},
		[]valueWrite{
			{At: at(t, "2026-05-11T09:05:00Z"), Value: histCabinA},
			{At: at(t, "2026-05-11T09:00:00Z"), Value: histCabinTypo},
		},
		valueWrite{At: at(t, "2026-05-11T09:05:00Z"), Value: histCabinA},
		at(t, histNowAfterAll), testPacific(t))

	assertWeekendValues(t, got, histCabinA, histCabinA)
}

// Back-to-back weekends: staff work the next weekend's housing while the
// current one is running. An edit made DURING W1 belongs to W2.
func TestHistoryAttributionEditDuringW1BelongsToW2(t *testing.T) {
	t.Parallel()
	w1 := weekend(t, 1, "2026-08-20T07:00:00Z")
	w2 := weekend(t, 2, "2026-08-27T07:00:00Z")

	got := attributeFromHistory([]SessionWindow{w1, w2},
		[]valueWrite{{At: at(t, "2026-08-10T09:00:00Z"), Value: histCabinA}},
		valueWrite{At: at(t, "2026-08-21T18:00:00Z"), Value: histCabinB},
		at(t, histNowAfterAll), testPacific(t))

	assertWeekendValues(t, got, histCabinA, histCabinB)
}

// An edit on W2's arrival day is after W2's cutoff, so it belongs to the next
// weekend when there is one.
func TestHistoryAttributionArrivalDayEditGoesToTheNextWeekend(t *testing.T) {
	t.Parallel()
	w1 := weekend(t, 1, "2026-05-22T07:00:00Z")
	w2 := weekend(t, 2, "2026-08-20T07:00:00Z")
	w3 := weekend(t, 3, "2026-09-24T07:00:00Z")

	got := attributeFromHistory([]SessionWindow{w1, w2, w3},
		[]valueWrite{{At: at(t, "2026-05-01T09:00:00Z"), Value: histCabinA}},
		// 11am Pacific on W2's first day.
		valueWrite{At: at(t, "2026-08-20T18:00:00Z"), Value: histCabinB},
		at(t, histNowAfterAll), testPacific(t))

	assertWeekendValues(t, got, histCabinA, histCabinA, histCabinB)
}

// ...and when W2 is the party's last weekend, the arrival-day edit lands on W2:
// the lone-late-edit behavior.
func TestHistoryAttributionArrivalDayEditOnTheLastWeekendLandsOnIt(t *testing.T) {
	t.Parallel()
	w1 := weekend(t, 1, "2026-05-22T07:00:00Z")
	w2 := weekend(t, 2, "2026-08-20T07:00:00Z")

	got := attributeFromHistory([]SessionWindow{w1, w2},
		[]valueWrite{{At: at(t, "2026-05-01T09:00:00Z"), Value: histCabinA}},
		valueWrite{At: at(t, "2026-08-20T18:00:00Z"), Value: histCabinB},
		at(t, histNowAfterAll), testPacific(t))

	assertWeekendValues(t, got, histCabinA, histCabinB)
}

// The knowledge floor: with no history row, the timeline begins at the current
// value's own change time. W1 started before anything is known, so it is
// undetermined -- not given the current value.
func TestHistoryAttributionFloorAfterW1CutoffLeavesW1Undetermined(t *testing.T) {
	t.Parallel()
	w1 := weekend(t, 1, "2026-05-22T07:00:00Z")
	w2 := weekend(t, 2, "2026-09-24T07:00:00Z")

	got := attributeFromHistory([]SessionWindow{w1, w2}, nil,
		valueWrite{At: at(t, "2026-06-01T09:00:00Z"), Value: histCabinB},
		at(t, histNowAfterAll), testPacific(t))

	assertWeekendValues(t, got, "?", histCabinB)
}

// Until a weekend starts, the value currently in CampMinder is its answer.
func TestHistoryAttributionUpcomingWeekendTakesTheCurrentValue(t *testing.T) {
	t.Parallel()
	w1 := weekend(t, 1, "2026-05-22T07:00:00Z")
	w2 := weekend(t, 2, "2026-09-24T07:00:00Z")
	w3 := weekend(t, 3, "2026-10-01T07:00:00Z")

	got := attributeFromHistory([]SessionWindow{w1, w2, w3},
		[]valueWrite{{At: at(t, "2026-05-10T09:00:00Z"), Value: histCabinA}},
		valueWrite{At: at(t, "2026-06-01T09:00:00Z"), Value: histCabinB},
		at(t, "2026-09-10T12:00:00Z"), testPacific(t))

	assertWeekendValues(t, got, histCabinA, histCabinB, histCabinB)
}

// The cutoff is the start of the first day CAMP-LOCAL. A start_date carrying a
// time of day is truncated to that day's local midnight, and the comparison is
// made in Pacific time, not UTC: 23:30 Pacific the night before arrival is
// 06:30Z on the arrival date, which a UTC-midnight cutoff would wrongly call
// "after the weekend started".
func TestHistoryAttributionCutoffIsLocalStartOfFirstDay(t *testing.T) {
	t.Parallel()
	loc := testPacific(t)
	// 3pm Pacific check-in, stored with its time of day.
	w1 := SessionWindow{ID: "w1", CMID: 1, Start: at(t, "2026-05-22T22:00:00Z")}
	w2 := weekend(t, 2, "2026-09-24T07:00:00Z")

	t.Run("the night before arrival counts for the weekend", func(t *testing.T) {
		got := attributeFromHistory([]SessionWindow{w1, w2},
			[]valueWrite{{At: at(t, "2026-05-01T09:00:00Z"), Value: histCabinA}},
			valueWrite{At: at(t, "2026-05-22T06:30:00Z"), Value: histCabinB},
			at(t, histNowAfterAll), loc)
		assertWeekendValues(t, got, histCabinB, histCabinB)
	})

	t.Run("the arrival morning is after the cutoff", func(t *testing.T) {
		got := attributeFromHistory([]SessionWindow{w1, w2},
			[]valueWrite{{At: at(t, "2026-05-01T09:00:00Z"), Value: histCabinA}},
			valueWrite{At: at(t, "2026-05-22T17:00:00Z"), Value: histCabinB},
			at(t, histNowAfterAll), loc)
		assertWeekendValues(t, got, histCabinA, histCabinB)
	})
}

// CampMinder's dates are free text in several formats. The change-time parser
// accepts the ones this repo has seen and refuses what it cannot read rather
// than guessing.
func TestParseSourceChangeTimeAcceptsCampMinderFormats(t *testing.T) {
	t.Parallel()
	loc := testPacific(t)
	cases := []struct {
		in   string
		want string // RFC3339 in UTC; "" means unparseable
	}{
		{"2026-05-10T09:00:00.1234567+00:00", "2026-05-10T09:00:00Z"},
		{"2026-05-10T02:00:00-07:00", "2026-05-10T09:00:00Z"},
		{"2026-05-10 09:00:00.000Z", "2026-05-10T09:00:00Z"},
		{"2026-05-10 09:00:00Z", "2026-05-10T09:00:00Z"},
		// No offset: read as camp-local.
		{"2026-05-10T02:00:00", "2026-05-10T09:00:00Z"},
		{"2026-05-10 02:00:00", "2026-05-10T09:00:00Z"},
		{"5/10/2026 2:00:00 AM", "2026-05-10T09:00:00Z"},
		{"5/10/2026 2:00 AM", "2026-05-10T09:00:00Z"},
		{"05/10/2026 02:00", "2026-05-10T09:00:00Z"},
		// A bare date is local midnight: an edit on arrival day is therefore
		// never read as before that day's cutoff.
		{"2026-05-10", "2026-05-10T07:00:00Z"},
		{"5/10/2026", "2026-05-10T07:00:00Z"},
		{"  2026-05-10T09:00:00Z  ", "2026-05-10T09:00:00Z"},
		{"", ""},
		{"not a date", ""},
		{"yesterday", ""},
	}
	for _, c := range cases {
		got, ok := parseSourceChangeTime(c.in, loc)
		if c.want == "" {
			if ok {
				t.Errorf("parseSourceChangeTime(%q) = %v, want unparseable", c.in, got)
			}
			continue
		}
		if !ok {
			t.Errorf("parseSourceChangeTime(%q) failed, want %s", c.in, c.want)
			continue
		}
		if got.UTC().Format(time.RFC3339) != c.want {
			t.Errorf("parseSourceChangeTime(%q) = %s, want %s", c.in, got.UTC().Format(time.RFC3339), c.want)
		}
	}
}

// ---------------------------------------------------------------------------
// Through the sync.
// ---------------------------------------------------------------------------

// histFixture is a 2026 household enrolled in two family weekends that have
// both already started: W1 on 22 May and W2 on 20 August.
type histFixture struct {
	w1, w2       string // camp_sessions PB ids
	unitA, unitB string
	household    string // households PB id
	cabinDef     string
}

func seedHistoryHousehold(t *testing.T, app core.App) histFixture {
	t.Helper()
	var f histFixture
	f.w1 = addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", sessionTypeFamily,
		"2026-05-22 07:00:00.000Z", "2026-05-25 07:00:00.000Z", 2026)
	f.w2 = addSession(t, app, cmIDFamilyCamp2, "Family Camp 2", sessionTypeFamily,
		"2026-08-20 07:00:00.000Z", "2026-08-23 07:00:00.000Z", 2026)
	f.unitA = addUnit(t, app, "hist-cabin-a", 2026)
	addAlias(t, app, histCabinA, []string{f.unitA}, 0, 0)
	f.unitB = addUnit(t, app, "hist-cabin-b", 2026)
	addAlias(t, app, histCabinB, []string{f.unitB}, 0, 0)
	f.cabinDef = addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	f.household = addHousehold(t, app, histHousehold, 2026)
	child := addPerson(t, app, histPerson, histHousehold, 2026, f.household)
	addAttendee(t, app, child, f.w1, histPerson, statusIDActiveEnrolled, 2026)
	addAttendee(t, app, child, f.w2, histPerson, statusIDActiveEnrolled, 2026)
	return f
}

// addValueHistoryRow writes one lodging_value_history row as the capture hook
// would have.
func addValueHistoryRow(
	t *testing.T, app core.App, fieldCMID, householdCMID, personCMID int,
	oldValue, newValue, sourceChangedAt, observedAt string, genesis bool,
) {
	t.Helper()
	saveRecord(t, app, lodgingValueHistoryCollection, map[string]any{
		"year": 2026, "field_cm_id": fieldCMID,
		"household_cm_id": householdCMID, "person_cm_id": personCMID,
		"source_field": lodgingRetainedHistoryFields[fieldCMID],
		"old_value":    oldValue, "new_value": newValue,
		"source_changed_at": sourceChangedAt, "observed_at": observedAt,
		"is_genesis": genesis,
	})
}

// seedHistoryAtoB records the common timeline: A written before W1, B written
// after W1 started and before W2 started. The current CampMinder value is B.
func seedHistoryAtoB(t *testing.T, app core.App, f *histFixture) {
	t.Helper()
	addValueHistoryRow(t, app, cmIDFamilyCampCabin, histHousehold, 0,
		"", histCabinA, "2026-05-10T16:00:00.0000000+00:00", "2026-05-11 10:00:00.000Z", true)
	addValueHistoryRow(t, app, cmIDFamilyCampCabin, histHousehold, 0,
		histCabinA, histCabinB, "2026-06-01T16:00:00.0000000+00:00", "2026-06-02 10:00:00.000Z", false)
	addHouseholdValue(t, app, f.household, f.cabinDef, histCabinB, "2026-06-01T16:00:00.0000000+00:00", 2026)
}

func runLodgingSync(t *testing.T, app core.App, year int, dryRun bool) *LodgingAssignmentsSync {
	t.Helper()
	s := NewLodgingAssignmentsSync(app)
	s.Year = year
	s.ActiveSeasonYear = year
	s.DryRun = dryRun
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	return s
}

// placementsBySession returns session PB id -> the units placed there.
func placementsBySession(t *testing.T, app core.App) map[string][]string {
	t.Helper()
	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	out := make(map[string][]string, len(rows))
	for _, r := range rows {
		out[r.GetString("session")] = r.GetStringSlice("units")
	}
	return out
}

func issuesOfKind(t *testing.T, app core.App, kind string) []*core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter("lodging_ingest_issues", "kind = {:kind}", "", 0, 0,
		map[string]any{"kind": kind})
	if err != nil {
		t.Fatalf("find issues: %v", err)
	}
	return rows
}

func assertPlaced(t *testing.T, got map[string][]string, session, unit, label string) {
	t.Helper()
	units, ok := got[session]
	if !ok {
		t.Errorf("%s: not placed, want %s", label, unit)
		return
	}
	if len(units) != 1 || units[0] != unit {
		t.Errorf("%s: units = %v, want [%s]", label, units, unit)
	}
}

func TestHistoryAttributionSyncPlacesEachWeekendItsOwnCabin(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	seedHistoryAtoB(t, app, &f)

	runLodgingSync(t, app, 2026, false)

	got := placementsBySession(t, app)
	if len(got) != 2 {
		t.Fatalf("placements = %d, want one per weekend", len(got))
	}
	assertPlaced(t, got, f.w1, f.unitA, "W1")
	assertPlaced(t, got, f.w2, f.unitB, "W2")
	if n := len(issuesOfKind(t, app, issueAmbiguousSession)); n != 0 {
		t.Errorf("ambiguous_session rows = %d, want 0 -- history answered the question", n)
	}
}

// Both grains: an adult guest at two adult weekends is attributed the same way.
func TestHistoryAttributionSyncPersonGrain(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	ww := addSession(t, app, 1335115, "Adult Weekend 1", sessionTypeAdult,
		"2026-04-17 07:00:00.000Z", "2026-04-19 07:00:00.000Z", 2026)
	mw := addSession(t, app, 1351453, "Adult Weekend 2", sessionTypeAdult,
		"2026-07-17 07:00:00.000Z", "2026-07-19 07:00:00.000Z", 2026)
	unitA := addUnit(t, app, "hist-cabin-a", 2026)
	addAlias(t, app, histCabinA, []string{unitA}, 0, 0)
	unitB := addUnit(t, app, "hist-cabin-b", 2026)
	addAlias(t, app, histCabinB, []string{unitB}, 0, 0)
	def := addFieldDef(t, app, cmIDReportableFamilyCampCabin, fieldNameReportableFamilyCampCabin)
	guest := addPerson(t, app, histAdultGuest, 0, 2026, "")
	addAttendee(t, app, guest, ww, histAdultGuest, statusIDActiveEnrolled, 2026)
	addAttendee(t, app, guest, mw, histAdultGuest, statusIDActiveEnrolled, 2026)

	addValueHistoryRow(t, app, cmIDReportableFamilyCampCabin, 0, histAdultGuest,
		"", histCabinA, "2026-04-01T16:00:00.0000000+00:00", "2026-04-02 10:00:00.000Z", true)
	addValueHistoryRow(t, app, cmIDReportableFamilyCampCabin, 0, histAdultGuest,
		histCabinA, histCabinB, "2026-05-01T16:00:00.0000000+00:00", "2026-05-02 10:00:00.000Z", false)
	addPersonValue(t, app, guest, def, histCabinB, "2026-05-01T16:00:00.0000000+00:00", 2026)

	runLodgingSync(t, app, 2026, false)

	got := placementsBySession(t, app)
	assertPlaced(t, got, ww, unitA, "first adult weekend")
	assertPlaced(t, got, mw, unitB, "second adult weekend")
}

func TestHistoryAttributionSyncLeavesAWeekendBeforeTheFloorUnplaced(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	// No history row: the current value's own change time is the floor, and it
	// falls after W1 started.
	addHouseholdValue(t, app, f.household, f.cabinDef, histCabinB, "2026-06-01T16:00:00.0000000+00:00", 2026)

	runLodgingSync(t, app, 2026, false)

	got := placementsBySession(t, app)
	if _, ok := got[f.w1]; ok {
		t.Errorf("W1 placed with %v; its cutoff is before anything is known", got[f.w1])
	}
	assertPlaced(t, got, f.w2, f.unitB, "W2")
}

// A staff confirmation wins over history: the confirmed weekend is placed
// exactly as before, and history does not add the other one.
func TestHistoryAttributionStaffConfirmationWins(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	seedHistoryAtoB(t, app, &f)
	confirmedID := seedIssue(t, app, map[string]any{
		"kind": issueAmbiguousSession, "raw_value": histCabinB,
		"source_field": fieldNameFamilyCampCabin, "year": 2026,
		"household_cm_id": histHousehold, "is_resolved": true,
		"confirmed_session_cm_id": cmIDFamilyCamp1, "occurrences": 1,
	})

	runLodgingSync(t, app, 2026, false)

	got := placementsBySession(t, app)
	if len(got) != 1 {
		t.Fatalf("placements = %v, want only the confirmed weekend", got)
	}
	// Staff said the current value, B, is W1's. History would say A.
	assertPlaced(t, got, f.w1, f.unitB, "confirmed W1")

	row, err := app.FindRecordById("lodging_ingest_issues", confirmedID)
	if err != nil {
		t.Fatalf("reload confirmed row: %v", err)
	}
	if row.GetString("resolution_note") != "" {
		t.Errorf("the confirmed row gained a note %q; the sync must never touch it",
			row.GetString("resolution_note"))
	}
	if row.GetInt("confirmed_session_cm_id") != cmIDFamilyCamp1 || !row.GetBool("is_resolved") {
		t.Error("the confirmed row changed")
	}
}

// An open ambiguous_session row whose weekends history now places is closed,
// with a note saying why. A row staff already resolved is left exactly as it is.
func TestHistoryAttributionClosesTheQueueRowsItAnswers(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	seedHistoryAtoB(t, app, &f)
	openID := seedIssue(t, app, map[string]any{
		"kind": issueAmbiguousSession, "raw_value": histCabinB,
		"source_field": fieldNameFamilyCampCabin, "year": 2026,
		"household_cm_id": histHousehold, "is_resolved": false, "occurrences": 1,
	})
	// A row for the earlier value, which the sync no longer observes. It is the
	// same party's same question, so it closes too.
	staleID := seedIssue(t, app, map[string]any{
		"kind": issueAmbiguousSession, "raw_value": histCabinA,
		"source_field": fieldNameFamilyCampCabin, "year": 2026,
		"household_cm_id": histHousehold, "is_resolved": false, "occurrences": 1,
	})
	const staffNote = "staff looked at this"
	resolvedID := seedIssue(t, app, map[string]any{
		"kind": issueAmbiguousSession, "raw_value": histCabinTypo,
		"source_field": fieldNameFamilyCampCabin, "year": 2026,
		"household_cm_id": histHousehold, "is_resolved": true,
		"resolution_note": staffNote, "occurrences": 1,
	})
	// Another party's open row: nothing answered it.
	otherID := seedIssue(t, app, map[string]any{
		"kind": issueAmbiguousSession, "raw_value": histCabinA,
		"source_field": fieldNameFamilyCampCabin, "year": 2026,
		"household_cm_id": 9999, "is_resolved": false, "occurrences": 1,
	})

	runLodgingSync(t, app, 2026, false)

	for _, id := range []string{openID, staleID} {
		row, err := app.FindRecordById("lodging_ingest_issues", id)
		if err != nil {
			t.Fatalf("reload %s: %v", id, err)
		}
		if !row.GetBool("is_resolved") {
			t.Errorf("row %s still open; history placed both weekends", id)
		}
		if note := row.GetString("resolution_note"); !strings.Contains(note, "captured cabin history") {
			t.Errorf("row %s note = %q, want it to say it was attributed from captured cabin history", id, note)
		}
		if strings.Contains(row.GetString("resolution_note"), "overwritten before capture began") {
			t.Errorf("row %s: a fully determined party's note claims a weekend was lost", id)
		}
	}

	resolved, err := app.FindRecordById("lodging_ingest_issues", resolvedID)
	if err != nil {
		t.Fatalf("reload resolved row: %v", err)
	}
	if resolved.GetString("resolution_note") != staffNote {
		t.Errorf("staff-resolved row's note = %q, want it untouched (%q)",
			resolved.GetString("resolution_note"), staffNote)
	}

	other, err := app.FindRecordById("lodging_ingest_issues", otherID)
	if err != nil {
		t.Fatalf("reload other row: %v", err)
	}
	if other.GetBool("is_resolved") {
		t.Error("another party's open row was closed")
	}
}

// A partially determined party: its row still closes, and the note says the
// earlier weekend's value was overwritten before capture began.
func TestHistoryAttributionPartialCloseSaysTheEarlierWeekendWasLost(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	addHouseholdValue(t, app, f.household, f.cabinDef, histCabinB, "2026-06-01T16:00:00.0000000+00:00", 2026)
	openID := seedIssue(t, app, map[string]any{
		"kind": issueAmbiguousSession, "raw_value": histCabinB,
		"source_field": fieldNameFamilyCampCabin, "year": 2026,
		"household_cm_id": histHousehold, "is_resolved": false, "occurrences": 1,
	})

	runLodgingSync(t, app, 2026, false)

	row, err := app.FindRecordById("lodging_ingest_issues", openID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !row.GetBool("is_resolved") {
		t.Fatal("row still open; history placed the later weekend")
	}
	note := row.GetString("resolution_note")
	if !strings.Contains(note, "captured cabin history") ||
		!strings.Contains(note, "overwritten before capture began") ||
		!strings.Contains(note, "Family Camp 1") {
		t.Errorf("note = %q, want it to name the unplaced weekend and say its value was "+
			"overwritten before capture began", note)
	}
}

// An unparseable source_changed_at falls back to observed_at, and says so in
// the log. Without the fallback W1 would be undetermined: the only other clock
// is the current value's, which is after W1 started.
//
// Not parallel: it swaps the process-global slog default (see captureSweepLogs).
func TestHistoryAttributionUnparseableSourceTimeFallsBackToObservedAt(t *testing.T) {
	logs := captureSweepLogs(t)
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	addValueHistoryRow(t, app, cmIDFamilyCampCabin, histHousehold, 0,
		"", histCabinA, "sometime in May", "2026-05-11 10:00:00.000Z", true)
	addValueHistoryRow(t, app, cmIDFamilyCampCabin, histHousehold, 0,
		histCabinA, histCabinB, "2026-06-01T16:00:00.0000000+00:00", "2026-06-02 10:00:00.000Z", false)
	addHouseholdValue(t, app, f.household, f.cabinDef, histCabinB, "2026-06-01T16:00:00.0000000+00:00", 2026)

	runLodgingSync(t, app, 2026, false)

	got := placementsBySession(t, app)
	assertPlaced(t, got, f.w1, f.unitA, "W1 (via observed_at)")
	assertPlaced(t, got, f.w2, f.unitB, "W2")
	if !strings.Contains(logs.String(), "observed_at") || !strings.Contains(logs.String(), "sometime in May") {
		t.Errorf("no log line for the fallback; got:\n%s", logs.String())
	}
}

// A single-weekend party keeps its current behavior: the current value is its
// cabin, whatever the history says about the value in effect at the start.
func TestHistoryAttributionSingleWeekendPartyIsUnchanged(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	// A second household, at W2 only.
	hh := addHousehold(t, app, 9102, 2026)
	child := addPerson(t, app, 5102, 9102, 2026, hh)
	addAttendee(t, app, child, f.w2, 5102, statusIDActiveEnrolled, 2026)
	addValueHistoryRow(t, app, cmIDFamilyCampCabin, 9102, 0,
		"", histCabinA, "2026-05-10T16:00:00.0000000+00:00", "2026-05-11 10:00:00.000Z", true)
	addValueHistoryRow(t, app, cmIDFamilyCampCabin, 9102, 0,
		histCabinA, histCabinB, "2026-09-01T16:00:00.0000000+00:00", "2026-09-02 10:00:00.000Z", false)
	addHouseholdValue(t, app, hh, f.cabinDef, histCabinB, "2026-09-01T16:00:00.0000000+00:00", 2026)

	runLodgingSync(t, app, 2026, false)

	rows, err := app.FindRecordsByFilter("lodging_assignments", "household_cm_id = 9102", "", 0, 0)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if len(rows) != 1 || rows[0].GetString("session") != f.w2 {
		t.Fatalf("placements = %d, want one on W2", len(rows))
	}
	if units := rows[0].GetStringSlice("units"); len(units) != 1 || units[0] != f.unitB {
		t.Errorf("units = %v, want the current value's [%s]", units, f.unitB)
	}

	// For one weekend the history rule would reduce to the same answer, so the
	// placement alone cannot show the party kept its old path. The plan can.
	dry := runLodgingSync(t, app, 2026, true)
	for _, p := range dry.DryRunPlan {
		if p.HouseholdCMID == 9102 && p.FromHistory {
			t.Error("a single-weekend party went through the history rule")
		}
	}
}

// Prior years are untouched: the rule is for 2026 onward, and a 2025
// multi-weekend party is still flagged, not placed, whatever rows exist.
func TestHistoryAttributionLeavesPriorYearsFlagged(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	w1 := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", sessionTypeFamily,
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	w2 := addSession(t, app, cmIDFamilyCamp6, "Family Camp 6", sessionTypeFamily,
		"2025-09-18 07:00:00.000Z", "2025-09-21 07:00:00.000Z", 2025)
	unit := addUnit(t, app, "hist-cabin-a", 2025)
	addAlias(t, app, histCabinA, []string{unit}, 0, 0)
	def := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, histHousehold, 2025)
	child := addPerson(t, app, histPerson, histHousehold, 2025, hh)
	addAttendee(t, app, child, w1, histPerson, statusIDActiveEnrolled, 2025)
	addAttendee(t, app, child, w2, histPerson, statusIDActiveEnrolled, 2025)
	saveRecord(t, app, lodgingValueHistoryCollection, map[string]any{
		"year": 2025, "field_cm_id": cmIDFamilyCampCabin, "household_cm_id": histHousehold,
		"source_field": fieldNameFamilyCampCabin, "new_value": histCabinA,
		"source_changed_at": "2025-05-01T16:00:00.0000000+00:00",
		"observed_at":       "2025-05-02 10:00:00.000Z", "is_genesis": true,
	})
	addHouseholdValue(t, app, hh, def, histCabinA, "2025-05-01T16:00:00.0000000+00:00", 2025)

	runLodgingSync(t, app, 2025, false)

	if got := placementsBySession(t, app); len(got) != 0 {
		t.Errorf("a 2025 party was placed: %v", got)
	}
	if n := len(issuesOfKind(t, app, issueAmbiguousSession)); n != 1 {
		t.Errorf("ambiguous_session rows = %d, want the 2025 party still flagged", n)
	}
}

// DryRun computes the placements and the rows it would close, and writes
// neither.
func TestHistoryAttributionDryRunWritesAndClosesNothing(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	seedHistoryAtoB(t, app, &f)
	openID := seedIssue(t, app, map[string]any{
		"kind": issueAmbiguousSession, "raw_value": histCabinB,
		"source_field": fieldNameFamilyCampCabin, "year": 2026,
		"household_cm_id": histHousehold, "is_resolved": false, "occurrences": 1,
	})

	s := runLodgingSync(t, app, 2026, true)

	if got := placementsBySession(t, app); len(got) != 0 {
		t.Errorf("a dry run wrote placements: %v", got)
	}
	row, err := app.FindRecordById("lodging_ingest_issues", openID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if row.GetBool("is_resolved") || row.GetString("resolution_note") != "" {
		t.Error("a dry run closed a queue row")
	}

	// ...but it reports what it would have done.
	planned := map[int][]string{}
	for _, p := range s.DryRunPlan {
		if p.HouseholdCMID == histHousehold && p.FromHistory {
			planned[p.SessionCMID] = p.UnitIDs
		}
	}
	if len(planned[cmIDFamilyCamp1]) != 1 || planned[cmIDFamilyCamp1][0] != f.unitA ||
		len(planned[cmIDFamilyCamp2]) != 1 || planned[cmIDFamilyCamp2][0] != f.unitB {
		t.Errorf("dry-run plan = %v, want W1 -> A and W2 -> B from history", planned)
	}
	if len(s.DryRunClosures) != 1 || s.DryRunClosures[0].ID != openID {
		t.Errorf("dry-run closures = %v, want the one open row %s", s.DryRunClosures, openID)
	}
}

// An alias-mapping click replays every party that wrote the string, and must
// attribute a multi-weekend party the way the sync does. The case where the two
// could differ: CampMinder bumped last_updated without changing the value. On
// its own the current value's clock then puts the knowledge floor after W1
// started; the history's genesis row shows the same cabin was in place before
// W1. A replay that did not read history would place W2 alone.
func TestHistoryAttributionReplayFanOutAgreesWithTheSync(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	f := seedHistoryHousehold(t, app)
	// The B alias does not exist yet, so the sync cannot place anything.
	aliasB, err := app.FindFirstRecordByFilter("lodging_unit_aliases", "alias_string = {:a}",
		map[string]any{"a": histCabinB})
	if err != nil {
		t.Fatalf("find alias: %v", err)
	}
	if delErr := app.Delete(aliasB); delErr != nil {
		t.Fatalf("delete alias: %v", delErr)
	}
	addValueHistoryRow(t, app, cmIDFamilyCampCabin, histHousehold, 0,
		"", histCabinB, "2026-05-10T16:00:00.0000000+00:00", "2026-05-11 10:00:00.000Z", true)
	addHouseholdValue(t, app, f.household, f.cabinDef, histCabinB, "2026-06-01T16:00:00.0000000+00:00", 2026)
	openID := seedIssue(t, app, map[string]any{
		"kind": issueAmbiguousSession, "raw_value": histCabinB,
		"source_field": fieldNameFamilyCampCabin, "year": 2026,
		"household_cm_id": histHousehold, "is_resolved": false, "occurrences": 1,
	})

	runLodgingSync(t, app, 2026, false)
	if got := placementsBySession(t, app); len(got) != 0 {
		t.Fatalf("placed %v before the alias existed", got)
	}
	unresolved := issuesOfKind(t, app, issueUnresolvedAlias)
	if len(unresolved) != 1 {
		t.Fatalf("unresolved_alias rows = %d, want 1 for the unmapped string", len(unresolved))
	}

	// Staff map the string, which ticks the row and replays it.
	newAlias := addAlias(t, app, histCabinB, []string{f.unitB}, 0, 0)
	unresolved[0].Set("is_resolved", true)
	unresolved[0].Set("resolved_alias", newAlias)
	if saveErr := app.Save(unresolved[0]); saveErr != nil {
		t.Fatalf("tick alias row: %v", saveErr)
	}
	if _, replayErr := ReplayPartylessIssue(app, unresolved[0].Id); replayErr != nil {
		t.Fatalf("ReplayPartylessIssue: %v", replayErr)
	}

	got := placementsBySession(t, app)
	assertPlaced(t, got, f.w1, f.unitB, "W1 after replay")
	assertPlaced(t, got, f.w2, f.unitB, "W2 after replay")
	if n := len(issuesOfKind(t, app, issueAmbiguousSession)); n != 1 {
		t.Errorf("ambiguous_session rows = %d, want no new one from the replay", n)
	}

	// A click never closes a queue row; the next sync closes what it answered.
	runLodgingSync(t, app, 2026, false)
	row, err := app.FindRecordById("lodging_ingest_issues", openID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !row.GetBool("is_resolved") {
		t.Error("the sync after the replay left the answered row open")
	}
}
