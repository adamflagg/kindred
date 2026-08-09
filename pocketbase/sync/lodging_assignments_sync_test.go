package sync

import (
	"context"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

const testLastUpdated = "2025-05-16T09:14:03.1234567+00:00"

// seedOneWeekendHousehold builds the 98% case: household 9001 with two enrolled
// children at one family weekend, one cabin value, and two accompanying adults.
func seedOneWeekendHousehold(t *testing.T, app core.App) (sessionID, unitID string) {
	t.Helper()
	sessionID = addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	unitID = addUnit(t, app, "ridge-a", 2025)
	addAlias(t, app, "Ridge A", []string{unitID}, 0, 0)

	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	liam := addPerson(t, app, 5002, 9001, 2025, hh)
	addAttendee(t, app, emma, sessionID, 5001, 2, 2025)
	addAttendee(t, app, liam, sessionID, 5002, 2, 2025)
	addFamilyCampAdult(t, app, hh, 2025, 1, "Noah Smith")
	addFamilyCampAdult(t, app, hh, 2025, 2, "Emma Johnson")
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2025)
	return sessionID, unitID
}

func TestLodgingAssignmentsSyncName(t *testing.T) {
	s := NewLodgingAssignmentsSync(nil)
	if s.Name() != serviceNameLodgingAssignments {
		t.Errorf("Name() = %q, want %q", s.Name(), serviceNameLodgingAssignments)
	}
}

// TestLodgingAssignmentsSyncHouseholdGrain: the whole happy path end to end.
func TestLodgingAssignmentsSyncHouseholdGrain(t *testing.T) {
	app := newLodgingTestApp(t)
	sessionID, unitID := seedOneWeekendHousehold(t, app)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 assignment, got %d", len(rows))
	}
	got := rows[0]
	if got.GetInt("household_cm_id") != 9001 {
		t.Errorf("household_cm_id = %d, want 9001", got.GetInt("household_cm_id"))
	}
	if got.GetInt("person_cm_id") != 0 {
		t.Errorf("person_cm_id = %d; the dual-grain XOR requires 0 here", got.GetInt("person_cm_id"))
	}
	if units := got.GetStringSlice("units"); len(units) != 1 || units[0] != unitID {
		t.Errorf("units = %v, want [%q]", units, unitID)
	}
	if got.GetString("session") != sessionID {
		t.Errorf("session = %q, want %q", got.GetString("session"), sessionID)
	}
	// The durable cross-year key (migration 1500000124). It is `required`, so a
	// writer that omits it does not write a 0 -- it fails validation outright.
	if got.GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Errorf("session_cm_id = %d, want %d", got.GetInt("session_cm_id"), cmIDFamilyCamp1)
	}
	if got.GetString("source") != "campminder_sync" {
		t.Errorf("source = %q, want campminder_sync", got.GetString("source"))
	}
	// 2 enrolled children + 2 accompanying adults.
	if got.GetInt("party_size") != 4 {
		t.Errorf("party_size = %d, want 4 (2 children + 2 adults)", got.GetInt("party_size"))
	}

	hist, err := app.FindRecordsByFilter("lodging_assignment_history", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find history: %v", err)
	}
	if len(hist) != 1 {
		t.Fatalf("expected 1 history row for the first observation, got %d", len(hist))
	}
	if hist[0].GetString("old_unit") != "" || hist[0].GetString("new_unit") != "ridge-a" {
		t.Errorf("history = (%q -> %q), want ('' -> 'ridge-a')",
			hist[0].GetString("old_unit"), hist[0].GetString("new_unit"))
	}
	if hist[0].GetString("source_field") != fieldNameFamilyCampCabin {
		t.Errorf("history source_field = %q", hist[0].GetString("source_field"))
	}
	// The audit trail is meant to outlive its session, so it carries the durable
	// key too -- otherwise a surviving row cannot say which weekend it described.
	if hist[0].GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Errorf("history session_cm_id = %d, want %d", hist[0].GetInt("session_cm_id"), cmIDFamilyCamp1)
	}
}

// TestLodgingAssignmentsSyncWritesTheSyncedYearsUnitIDs is the actual failure
// Task 5 exists to close, exercised at the write, not just at Resolve:
// upsertAssignment does `rec.Set("units", in.UnitIDs)` verbatim, so a resolver
// that translated the alias through the wrong year would write a stale
// season's unit ids straight into the placement, and every test that only
// asserts on UnitCodes/labels would stay green while it happened.
//
// "test-unit-a" gets a row in both 2026 and 2027; the alias is seeded against
// the EARLIER (2026) id, as it would be if authored once and never re-pointed
// (AliasResolver's own doc comment). The sync runs for 2027, and the written
// "units" relation must hold the 2027 row, never the 2026 one the alias
// happens to store.
func TestLodgingAssignmentsSyncWritesTheSyncedYearsUnitIDs(t *testing.T) {
	app := newLodgingTestApp(t)
	id2026 := addUnit(t, app, "test-unit-a", 2026)
	id2027 := addUnit(t, app, "test-unit-a", 2027)
	addAlias(t, app, "Test Building A", []string{id2026}, 0, 0)

	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2027-05-23 07:00:00.000Z", "2027-05-26 07:00:00.000Z", 2027)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2027)
	emma := addPerson(t, app, 5001, 9001, 2027, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2027)
	addHouseholdValue(t, app, hh, cabinDef, "Test Building A", testLastUpdated, 2027)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2027
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1", len(rows))
	}
	units := rows[0].GetStringSlice("units")
	if len(units) != 1 || units[0] != id2027 {
		t.Errorf("units = %v, want [%q] (the 2027 row)", units, id2027)
	}
	if len(units) == 1 && units[0] == id2026 {
		t.Error("the assignment's units relation holds the 2026 id in a 2027 sync")
	}
}

// TestLodgingAssignmentsSyncIsIdempotent: a second run must not duplicate the
// assignment or append a spurious history row.
func TestLodgingAssignmentsSyncIsIdempotent(t *testing.T) {
	app := newLodgingTestApp(t)
	seedOneWeekendHousehold(t, app)

	for pass := 0; pass < 2; pass++ {
		s := NewLodgingAssignmentsSync(app)
		s.Year = 2025
		if err := s.Sync(context.Background()); err != nil {
			t.Fatalf("pass %d: %v", pass, err)
		}
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Errorf("assignments after two passes = %d, want 1", len(rows))
	}
	hist, _ := app.FindRecordsByFilter("lodging_assignment_history", "", "", 0, 0)
	if len(hist) != 1 {
		t.Errorf("history rows after two passes = %d, want 1 (nothing changed)", len(hist))
	}
}

// TestLodgingAssignmentsSyncAppendsHistoryOnChange: this is the mechanism spec
// 3.6 relies on to recover multi-weekend households whose earlier assignment
// CampMinder overwrote.
func TestLodgingAssignmentsSyncAppendsHistoryOnChange(t *testing.T) {
	app := newLodgingTestApp(t)
	seedOneWeekendHousehold(t, app)
	ridgeB := addUnit(t, app, "ridge-b", 2025)
	addAlias(t, app, "Ridge B", []string{ridgeB}, 0, 0)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("first sync: %v", err)
	}

	// Staff move the household in CampMinder.
	vals, _ := app.FindRecordsByFilter("household_custom_values", "", "", 0, 0)
	vals[0].Set("value", "Ridge B")
	vals[0].Set("last_updated", "2025-05-18T11:02:44.0000000+00:00")
	if err := app.Save(vals[0]); err != nil {
		t.Fatalf("update value: %v", err)
	}

	s2 := NewLodgingAssignmentsSync(app)
	s2.Year = 2025
	if err := s2.Sync(context.Background()); err != nil {
		t.Fatalf("second sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1 (moved, not duplicated)", len(rows))
	}
	if units := rows[0].GetStringSlice("units"); len(units) != 1 || units[0] != ridgeB {
		t.Errorf("units = %v, want [%q]; assignment did not move to ridge-b", units, ridgeB)
	}

	hist, _ := app.FindRecordsByFilter("lodging_assignment_history", "", "-created", 0, 0)
	if len(hist) != 2 {
		t.Fatalf("history rows = %d, want 2", len(hist))
	}
	var sawMove bool
	for _, h := range hist {
		if h.GetString("old_unit") == "ridge-a" && h.GetString("new_unit") == "ridge-b" {
			sawMove = true
		}
	}
	if !sawMove {
		t.Error("no history row records the ridge-a -> ridge-b move")
	}
}

// TestLodgingAssignmentsSyncRespectsStaffTouched: a placement a human moved on
// the board is not reverted by the next CampMinder sync.
func TestLodgingAssignmentsSyncRespectsStaffTouched(t *testing.T) {
	app := newLodgingTestApp(t)
	seedOneWeekendHousehold(t, app)
	ridgeB := addUnit(t, app, "ridge-b", 2025)
	addAlias(t, app, "Ridge B", []string{ridgeB}, 0, 0)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("first sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	rows[0].Set("staff_touched", true)
	rows[0].Set("units", []string{ridgeB})
	if err := app.Save(rows[0]); err != nil {
		t.Fatalf("simulate staff move: %v", err)
	}

	s2 := NewLodgingAssignmentsSync(app)
	s2.Year = 2025
	if err := s2.Sync(context.Background()); err != nil {
		t.Fatalf("second sync: %v", err)
	}

	after, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if units := after[0].GetStringSlice("units"); len(units) != 1 || units[0] != ridgeB {
		t.Errorf("units = %v, want [%q]; the sync reverted a staff-touched placement", units, ridgeB)
	}
	if s2.GetStats().Skipped < 1 {
		t.Errorf("Skipped = %d, want at least 1 for the staff-touched row", s2.GetStats().Skipped)
	}
}

// TestLodgingAssignmentsSyncQueuesUnresolvedAlias: "Tuolumne 7" has no alias row
// -- one of four such strings in the real 2022/2023 data. It must become a work
// queue item and must not be dropped, and must not stop the run.
func TestLodgingAssignmentsSyncQueuesUnresolvedAlias(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	// Unrelated to "Tuolumne 7" below -- this only gives 2025 a registry, so
	// Sync's #2061 year guard (no lodging_units rows for the year) does not
	// intercept before reaching alias resolution. Without it, this fixture is
	// indistinguishable from "no registry loaded at all," and the case this
	// test means to cover -- one string that matches no alias -- never runs.
	addUnit(t, app, "ridge-a", 2025)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2025)
	addHouseholdValue(t, app, hh, cabinDef, "Tuolumne 7", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("an unresolved alias must not fail the sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 0 {
		t.Errorf("an unresolvable string produced %d assignments; expected 0", len(rows))
	}
	issues, _ := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if len(issues) != 1 {
		t.Fatalf("expected 1 work-queue item, got %d", len(issues))
	}
	if issues[0].GetString("kind") != issueUnresolvedAlias {
		t.Errorf("kind = %q, want %q", issues[0].GetString("kind"), issueUnresolvedAlias)
	}
	if issues[0].GetString("raw_value") != "Tuolumne 7" {
		t.Errorf("raw_value = %q; the verbatim string must survive", issues[0].GetString("raw_value"))
	}
	// History still records the observation, using the raw string, so the fact
	// that this household WAS assigned somewhere is not lost.
	hist, _ := app.FindRecordsByFilter("lodging_assignment_history", "", "", 0, 0)
	if len(hist) != 1 || hist[0].GetString("new_unit") != "Tuolumne 7" {
		t.Error("an unresolvable placement left no history trace")
	}
}

// TestLodgingAssignmentsSyncQueuesAmbiguousSession: 6-10 households a year
// attend more than one weekend against one CampMinder value. Spec 3.6 says flag
// them for manual entry.
func TestLodgingAssignmentsSyncQueuesAmbiguousSession(t *testing.T) {
	app := newLodgingTestApp(t)
	fc1 := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	winter := addSession(t, app, cmIDWinterFamily, "Winter Family Camp", "family",
		"2025-12-21 08:00:00.000Z", "2025-12-23 08:00:00.000Z", 2025)
	unit := addUnit(t, app, "ridge-a", 2025)
	addAlias(t, app, "Ridge A", []string{unit}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, fc1, 5001, 2, 2025)
	addAttendee(t, app, emma, winter, 5001, 2, 2025)
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", "2025-12-15T10:00:00.0000000+00:00", 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 0 {
		t.Errorf("an ambiguous household produced %d assignments; spec 3.6 says flag, don't guess", len(rows))
	}
	issues, _ := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if len(issues) != 1 || issues[0].GetString("kind") != issueAmbiguousSession {
		t.Fatalf("expected 1 ambiguous_session item, got %d", len(issues))
	}
	if issues[0].GetString("suggested_session") != winter {
		t.Errorf("suggested_session = %q, want the Winter session (value edited 15 Dec)",
			issues[0].GetString("suggested_session"))
	}
	if issues[0].GetInt("household_cm_id") != 9001 {
		t.Error("the queue item does not identify the household")
	}
}

// TestIngestWritesAMultiRoomPlacementAsOneRow closes the case that used to
// create a merge row: "Golden Triangle - Tioga 1and2" resolves to two units,
// so a two-room alias lands as one assignment naming both -- see placementFor.
// A merged slot is the alias's own member set, not a row pointing at it.
func TestIngestWritesAMultiRoomPlacementAsOneRow(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	bldg := addContainerUnit(t, app, "gt-tioga", 2025)
	t1 := addUnitWithParent(t, app, "gt-tioga-1", bldg, 2025)
	t2 := addUnitWithParent(t, app, "gt-tioga-2", bldg, 2025)
	addAlias(t, app, "Golden Triangle - Tioga 1and2", []string{t1, t2}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2025)
	addHouseholdValue(t, app, hh, cabinDef, "Golden Triangle - Tioga 1and2", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1", len(rows))
	}
	got := rows[0].GetStringSlice("units")
	if len(got) != 2 {
		t.Fatalf("want both rooms on the row, got %v", got)
	}
	if !slices.Contains(got, t1) || !slices.Contains(got, t2) {
		t.Errorf("units = %v, want both %q and %q", got, t1, t2)
	}
	// session_cm_id is required, so a row materialized without it never saves at
	// all -- this asserts the value, not just the save.
	if rows[0].GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Errorf("session_cm_id = %d, want %d", rows[0].GetInt("session_cm_id"), cmIDFamilyCamp1)
	}
}

// cmIDWomensWeekend is the adult weekend the person-grain tests place people in.
const cmIDWomensWeekend = 1335115

const testAdultSessionStart = "2025-10-16 07:00:00.000Z"
const testAdultSessionEnd = "2025-10-19 07:00:00.000Z"

// TestLodgingAssignmentsSyncPersonGrain: adult weekends enroll real persons, so
// the placement keys on person_cm_id and household_cm_id stays 0.
func TestLodgingAssignmentsSyncPersonGrain(t *testing.T) {
	app := newLodgingTestApp(t)
	womens := addSession(t, app, cmIDWomensWeekend, "Women's Weekend", "adult",
		testAdultSessionStart, testAdultSessionEnd, 2025)
	unit := addUnit(t, app, "river-c", 2025)
	addAlias(t, app, "River C", []string{unit}, 0, 0)
	def := addFieldDef(t, app, cmIDReportableFamilyCampCabin, fieldNameReportableFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, womens, 5001, 2, 2025)
	addPersonValue(t, app, emma, def, "River C", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1", len(rows))
	}
	if rows[0].GetInt("person_cm_id") != 5001 {
		t.Errorf("person_cm_id = %d, want 5001", rows[0].GetInt("person_cm_id"))
	}
	if rows[0].GetInt("household_cm_id") != 0 {
		t.Errorf("household_cm_id = %d; the XOR requires 0 on a person row",
			rows[0].GetInt("household_cm_id"))
	}
	if rows[0].GetInt("party_size") != 1 {
		t.Errorf("party_size = %d, want 1 for an individual", rows[0].GetInt("party_size"))
	}
	if rows[0].GetInt("session_cm_id") != cmIDWomensWeekend {
		t.Errorf("session_cm_id = %d, want %d", rows[0].GetInt("session_cm_id"), cmIDWomensWeekend)
	}
}

// TestLodgingAssignmentsSyncPersonGrainManyPerSession is the case Plan 1's
// pre-flight fix exists for: several individuals in one adult weekend. Had the
// unique index predicate compared against the empty string instead of using
// `> 0`, every person row (household_cm_id = 0) would have collided and only
// ONE could exist.
func TestLodgingAssignmentsSyncPersonGrainManyPerSession(t *testing.T) {
	app := newLodgingTestApp(t)
	womens := addSession(t, app, cmIDWomensWeekend, "Women's Weekend", "adult",
		testAdultSessionStart, testAdultSessionEnd, 2025)
	unit := addUnit(t, app, "river-c", 2025)
	addAlias(t, app, "River C", []string{unit}, 0, 0)
	def := addFieldDef(t, app, cmIDReportableFamilyCampCabin, fieldNameReportableFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2025)

	for i, cmID := range []int{5001, 5002, 5003} {
		p := addPerson(t, app, cmID, 9001+i, 2025, hh)
		addAttendee(t, app, p, womens, cmID, 2, 2025)
		addPersonValue(t, app, p, def, "River C", testLastUpdated, 2025)
	}

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 3 {
		t.Errorf("assignments = %d, want 3 (one per individual)", len(rows))
	}
}

// TestLodgingAssignmentsSyncPersonGrainNoEnrolment: 5 (2024) and 4 (2025)
// Reportable Family Camp Cabin values belong to persons with no active
// enrollment. Queue them; never drop them.
func TestLodgingAssignmentsSyncPersonGrainNoEnrolment(t *testing.T) {
	app := newLodgingTestApp(t)
	addSession(t, app, cmIDWomensWeekend, "Women's Weekend", "adult",
		testAdultSessionStart, testAdultSessionEnd, 2025)
	unit := addUnit(t, app, "river-c", 2025)
	addAlias(t, app, "River C", []string{unit}, 0, 0)
	def := addFieldDef(t, app, cmIDReportableFamilyCampCabin, fieldNameReportableFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	noah := addPerson(t, app, 5003, 9001, 2025, hh)
	// No attendee row at all -- cancelled before the season.
	addPersonValue(t, app, noah, def, "River C", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 0 {
		t.Errorf("assignments = %d, want 0 without an enrolment", len(rows))
	}
	issues, _ := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if len(issues) != 1 || issues[0].GetString("kind") != issueNoSession {
		t.Fatalf("expected 1 no_session item, got %d", len(issues))
	}
	if issues[0].GetInt("person_cm_id") != 5003 {
		t.Errorf("person_cm_id = %d on the queue item, want 5003", issues[0].GetInt("person_cm_id"))
	}
}

// TestLodgingAssignmentsRegisteredEverywhere: a job registered in some places
// but not others is the single most common defect when adding a sync
// (docs/architecture/sync-layer.md's own "Common Mistakes" table). Each miss is
// silent -- the job simply never runs, or the GUI shows "idle" forever.
func TestLodgingAssignmentsRegisteredEverywhere(t *testing.T) {
	var inMeta bool
	for _, m := range syncJobMeta {
		if m.ID == serviceNameLodgingAssignments {
			inMeta = true
			if m.Phase != PhaseTransform {
				t.Errorf("phase = %v, want PhaseTransform", m.Phase)
			}
		}
	}
	if !inMeta {
		t.Error("lodging_assignments missing from syncJobMeta")
	}

	daily := getDailySyncJobs()
	posDerived, posLodging := -1, -1
	for i, id := range daily {
		switch id {
		case serviceNameFamilyCampDerived:
			posDerived = i
		case serviceNameLodgingAssignments:
			posLodging = i
		}
	}
	if posLodging < 0 {
		t.Fatal("lodging_assignments missing from getDailySyncJobs; it would never run in the daily sync")
	}
	if posLodging < posDerived {
		t.Error("lodging_assignments runs before family_camp_derived; it depends on the same source data")
	}

	if _, ok := SyncJobToCollections[serviceNameLodgingAssignments]; !ok {
		t.Error("lodging_assignments missing from SyncJobToCollections; its sheets would never be skipped")
	}
}

// TestPlacementForPassesASingleRoomStraightThrough is the one-member case of
// the pass-through: still just the alias's own set, which is why it needs no
// App on the struct above.
func TestPlacementForPassesASingleRoomStraightThrough(t *testing.T) {
	s := &LodgingAssignmentsSync{}
	res := AliasResolution{Raw: "Room 1", UnitIDs: []string{"r1"}, Resolved: true}

	got := s.placementFor(res)
	if len(got) != 1 || got[0] != "r1" {
		t.Errorf("got %v, want [r1]", got)
	}
}

// TestPlacementForPassesTheAliasSetThrough pins the collapse: a multi-room
// alias no longer materializes a row, it simply IS the placement.
func TestPlacementForPassesTheAliasSetThrough(t *testing.T) {
	s := &LodgingAssignmentsSync{}
	got := s.placementFor(AliasResolution{UnitIDs: []string{"u1", "u2"}, Resolved: true})
	if len(got) != 2 || got[0] != "u1" || got[1] != "u2" {
		t.Fatalf("want the alias set unchanged, got %v", got)
	}
}

// TestLodgingAssignmentsSyncDryRunWritesNothing: DryRun's contract is "compute
// but do not write". recordHistory -- one of ingestValue's write paths -- sits
// UPSTREAM of the placement write, for a string no alias covers, so a guard
// placed just before upsertAssignment would leave rows behind in that table
// even though it never mentions it.
func TestLodgingAssignmentsSyncDryRunWritesNothing(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	t1 := addUnit(t, app, "gt-tioga-1", 2025)
	t2 := addUnit(t, app, "gt-tioga-2", 2025)
	addAlias(t, app, "Golden Triangle - Tioga 1and2", []string{t1, t2}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	// Household on a two-room alias: reaches the multi-room placement path.
	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2025)
	addHouseholdValue(t, app, hh, cabinDef, "Golden Triangle - Tioga 1and2", testLastUpdated, 2025)

	// Household on a string no alias covers: reaches recordHistory.
	hh2 := addHousehold(t, app, 9002, 2025)
	liam := addPerson(t, app, 5002, 9002, 2025, hh2)
	addAttendee(t, app, liam, sess, 5002, 2, 2025)
	addHouseholdValue(t, app, hh2, cabinDef, "Tuolumne 7", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	s.DryRun = true
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	for _, collection := range []string{
		"lodging_assignments", "lodging_assignment_history", "lodging_ingest_issues",
	} {
		rows, err := app.FindRecordsByFilter(collection, "", "", 0, 0)
		if err != nil {
			t.Fatalf("reading %s: %v", collection, err)
		}
		if len(rows) != 0 {
			t.Errorf("dry run wrote %d rows to %s; want 0", len(rows), collection)
		}
	}
}

// TestLodgingAssignmentsSyncUpdatesPartySizeInSameCabin: party_size is
// recomputed every run, so a household that gains an occupant without changing
// cabin must still have the new count persisted. The label is the MOVE
// detector; it is not the change detector.
func TestLodgingAssignmentsSyncUpdatesPartySizeInSameCabin(t *testing.T) {
	app := newLodgingTestApp(t)
	seedOneWeekendHousehold(t, app)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1", len(rows))
	}
	if got := rows[0].GetInt("party_size"); got != 4 {
		t.Fatalf("party_size = %d, want 4 (2 children + 2 adults)", got)
	}

	// A third accompanying adult joins. The cabin string is untouched.
	households, _ := app.FindRecordsByFilter("households", "cm_id = 9001", "", 1, 0)
	if len(households) != 1 {
		t.Fatalf("households = %d, want 1", len(households))
	}
	addFamilyCampAdult(t, app, households[0].Id, 2025, 3, "Olivia Martinez")

	s2 := NewLodgingAssignmentsSync(app)
	s2.Year = 2025
	if err := s2.Sync(context.Background()); err != nil {
		t.Fatalf("second sync: %v", err)
	}

	rows, _ = app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments after second sync = %d, want 1", len(rows))
	}
	if got := rows[0].GetInt("party_size"); got != 5 {
		t.Errorf("party_size = %d, want 5 -- the recomputed size was discarded", got)
	}
	// Same cabin, so this is not a move and must not append a history row.
	hist, _ := app.FindRecordsByFilter("lodging_assignment_history", "", "", 0, 0)
	if len(hist) != 1 {
		t.Errorf("history rows = %d, want 1; a party-size change is not a move", len(hist))
	}
}

// TestLodgingAssignmentsSyncQueuesUnknownHousehold: spec 6.2 is "zero silent
// drops". A cabin value whose household row is absent for the sync year has no
// CampMinder id to key a placement on, but skipping it outright loses the
// observation entirely -- and because the value is counted before the skip, even
// the field_zero_values warning stays quiet.
func TestLodgingAssignmentsSyncQueuesUnknownHousehold(t *testing.T) {
	app := newLodgingTestApp(t)
	addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	unit := addUnit(t, app, "ridge-a", 2025)
	addAlias(t, app, "Ridge A", []string{unit}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	// The household row is scoped to 2024, so the 2025 lookup cannot see it.
	hh := addHousehold(t, app, 9001, 2024)
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("a missing household must not fail the sync: %v", err)
	}

	issues, _ := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if len(issues) != 1 {
		t.Fatalf("expected 1 work-queue item for the unkeyable value, got %d", len(issues))
	}
	if issues[0].GetString("kind") != issueUnknownParty {
		t.Errorf("kind = %q, want %q", issues[0].GetString("kind"), issueUnknownParty)
	}
	if issues[0].GetString("raw_value") != "Ridge A" {
		t.Errorf("raw_value = %q; the verbatim string must survive", issues[0].GetString("raw_value"))
	}
}

// TestLodgingAssignmentsSyncQueuesUnknownPerson: the person-grain twin of
// TestLodgingAssignmentsSyncQueuesUnknownHousehold.
func TestLodgingAssignmentsSyncQueuesUnknownPerson(t *testing.T) {
	app := newLodgingTestApp(t)
	addSession(t, app, cmIDWomensWeekend, "Women's Weekend", "adult",
		testAdultSessionStart, testAdultSessionEnd, 2025)
	unit := addUnit(t, app, "ridge-a", 2025)
	addAlias(t, app, "Ridge A", []string{unit}, 0, 0)
	reportableDef := addFieldDef(t, app, cmIDReportableFamilyCampCabin, fieldNameReportableFamilyCampCabin)

	// The person row is scoped to 2024, so the 2025 lookup cannot see it.
	hh := addHousehold(t, app, 9001, 2024)
	ava := addPerson(t, app, 5001, 9001, 2024, hh)
	addPersonValue(t, app, ava, reportableDef, "Ridge A", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("a missing person must not fail the sync: %v", err)
	}

	issues, _ := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if len(issues) != 1 {
		t.Fatalf("expected 1 work-queue item for the unkeyable value, got %d", len(issues))
	}
	if issues[0].GetString("kind") != issueUnknownParty {
		t.Errorf("kind = %q, want %q", issues[0].GetString("kind"), issueUnknownParty)
	}
}

// TestLodgingAssignmentsSyncMergeLabelIgnoresMemberOrder: a multi-room
// placement's units come straight from the alias's own member_units, and
// PocketBase returns relation ids in storage order, which is not guaranteed
// stable. Two aliases naming the same two rooms in different orders must
// therefore resolve to the SAME placement, not a second row -- both the
// changed-check in upsertAssignment (unitsChanged) and the placement label
// (unitLabel) have to be order-independent, or reordering the members would
// read as a move on every run: a re-save and a history row for a household
// that never left its cabin.
func TestLodgingAssignmentsSyncMergeLabelIgnoresMemberOrder(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	bldg := addContainerUnit(t, app, "gt-tioga", 2025)
	t1 := addUnitWithParent(t, app, "gt-tioga-1", bldg, 2025)
	t2 := addUnitWithParent(t, app, "gt-tioga-2", bldg, 2025)
	addAlias(t, app, "Golden Triangle - Tioga 1and2", []string{t1, t2}, 0, 0)
	// The same two rooms, named the other way round. Staff type both.
	addAlias(t, app, "Golden Triangle - Tioga 2and1", []string{t2, t1}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2025)
	valueID := addHouseholdValue(t, app, hh, cabinDef,
		"Golden Triangle - Tioga 1and2", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("first sync: %v", err)
	}

	// CampMinder now carries the other spelling of the same two rooms.
	rec, err := app.FindRecordById("household_custom_values", valueID)
	if err != nil {
		t.Fatalf("reloading the custom value: %v", err)
	}
	rec.Set("value", "Golden Triangle - Tioga 2and1")
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("updating the custom value: %v", saveErr)
	}

	s2 := NewLodgingAssignmentsSync(app)
	s2.Year = 2025
	if err := s2.Sync(context.Background()); err != nil {
		t.Fatalf("second sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1; the same room set must not fork a second row", len(rows))
	}
	if got := rows[0].GetStringSlice("units"); len(got) != 2 {
		t.Errorf("units = %v, want both rooms still on the row", got)
	}
	hist, _ := app.FindRecordsByFilter("lodging_assignment_history", "", "", 0, 0)
	if len(hist) != 1 {
		t.Errorf("history rows = %d, want 1; reordering the members is not a move", len(hist))
	}
}

// TestLodgingAssignmentsSyncLabelDropsUnresolvableUnits: a placement may hold
// a unit id that resolves to nothing, and rendering it must not invent a move.
//
// 1500000134's backfill copies member_units across VERBATIM -- "an id that was
// dangling in member_units stays dangling in units" -- because filtering
// against lodging_units would silently change what a placement points at.
// AliasResolver.UnitCode returns the EMPTY STRING for an id it cannot map, so
// a set holding one dangling id and one real one rendered as "+ridge-a":
// unitLabel sorts the empty code first and joins it. The freshly resolved
// label is "ridge-a", the two differ, and upsertAssignment's
// `oldLabel == in.NewUnitLabel` short-circuit therefore fails to fire -- so
// writeHistory appends a row claiming the household moved out of a cabin whose
// name is a leading "+".
//
// The re-save itself is correct and must still happen: unitsChanged sees the
// dangling id leave the set. What must NOT happen is the history row. The
// audit trail is a record of MOVES, and dropping an id the database was
// already entitled to hold is not one.
func TestLodgingAssignmentsSyncLabelDropsUnresolvableUnits(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	ridge := addUnit(t, app, "ridge-a", 2025)
	addAlias(t, app, "Ridge A", []string{ridge}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2025)
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("first sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1 after the first sync", len(rows))
	}
	before, _ := app.FindRecordsByFilter("lodging_assignment_history", "", "", 0, 0)

	// The post-backfill shape: a real room plus an id naming a unit that is
	// gone. SaveNoValidate for the same reason 1500000134 uses it -- app.Save
	// runs RelationField.ValidateValue, which refuses to store an id that does
	// not resolve, so a validating write could not stage the state this test
	// is about.
	rows[0].Set("units", []string{"danglingunit001", ridge})
	if err := app.SaveNoValidate(rows[0]); err != nil {
		t.Fatalf("staging the dangling id: %v", err)
	}

	s2 := NewLodgingAssignmentsSync(app)
	s2.Year = 2025
	if err := s2.Sync(context.Background()); err != nil {
		t.Fatalf("second sync: %v", err)
	}

	after, _ := app.FindRecordsByFilter("lodging_assignment_history", "", "", 0, 0)
	if len(after) != len(before) {
		extra := after[len(after)-1]
		t.Errorf(
			"history grew from %d to %d rows; dropping an unresolvable id is not a move (old_unit=%q new_unit=%q)",
			len(before), len(after), extra.GetString("old_unit"), extra.GetString("new_unit"),
		)
	}

	fresh, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if got := fresh[0].GetStringSlice("units"); len(got) != 1 || got[0] != ridge {
		t.Errorf("units = %v, want just %q; the re-save should still drop the dangling id", got, ridge)
	}
}

// --- #2028: orphan cleanup for the mirror table ---
//
// A household/person placed while enrolled, later cancelled. CampMinder never
// clears the custom-field value, so ingestValue keeps observing the same raw
// string every run -- but the party's Candidates go empty (sessionIndex only
// counts status_id=2), so the write path never revisits the existing row (see
// syncHouseholdGrain/syncPersonGrain). staleHouseholdAssignment/
// stalePersonAssignment insert that row directly, the only way to stage the
// state #2028 describes.

func staleHouseholdAssignment(
	t *testing.T, app core.App, sessionID string, sessionCMID, hhCMID, year int, unitID string, staffTouched bool,
) string {
	t.Helper()
	return saveRecord(t, app, "lodging_assignments", map[string]any{
		"session": sessionID, "session_cm_id": sessionCMID, "year": year,
		"units": []string{unitID}, "household_cm_id": hhCMID, "party_size": 2,
		"source": sourceCampMinderSync, "staff_touched": staffTouched,
	})
}

func stalePersonAssignment(
	t *testing.T, app core.App, sessionID string, sessionCMID, personCMID, year int, unitID string,
) string {
	t.Helper()
	return saveRecord(t, app, "lodging_assignments", map[string]any{
		"session": sessionID, "session_cm_id": sessionCMID, "year": year,
		"units": []string{unitID}, "person_cm_id": personCMID, "party_size": 1,
		"source": sourceCampMinderSync, "staff_touched": false,
	})
}

// TestLodgingAssignmentsSyncDeletesOrphanedHouseholdMirrorRow is #2028 itself:
// nothing ever removed a cancelled household's lodging_assignments row before
// this pass.
func TestLodgingAssignmentsSyncDeletesOrphanedHouseholdMirrorRow(t *testing.T) {
	app := newLodgingTestApp(t)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025") // orphan sweep only runs for the active season (#2028)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	unit := addUnit(t, app, "ridge-a", 2025)
	addAlias(t, app, "Ridge A", []string{unit}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	// The cancelled household: still has a cabin value, no active enrolment.
	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 32, 2025) // cancelled
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2025)
	staleRow := staleHouseholdAssignment(t, app, sess, cmIDFamilyCamp1, 9001, 2025, unit, false)

	// A still-enrolled household keeps the session's enrolled set non-empty,
	// so the per-session reliability guard passes.
	hh2 := addHousehold(t, app, 9002, 2025)
	liam := addPerson(t, app, 5002, 9002, 2025, hh2)
	addAttendee(t, app, liam, sess, 5002, 2, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", staleRow); err == nil {
		t.Error("cancelled household's stale mirror row still exists")
	}
	if s.GetStats().Deleted != 1 {
		t.Errorf("Stats.Deleted = %d, want 1", s.GetStats().Deleted)
	}
}

// TestLodgingAssignmentsSyncKeepsMirrorRowForStillEnrolledHousehold is the
// obvious regression the sweep must not cause.
func TestLodgingAssignmentsSyncKeepsMirrorRowForStillEnrolledHousehold(t *testing.T) {
	app := newLodgingTestApp(t)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025") // orphan sweep only runs for the active season (#2028)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	unit := addUnit(t, app, "ridge-a", 2025)
	addAlias(t, app, "Ridge A", []string{unit}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2025) // still enrolled
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2025)
	staleRow := staleHouseholdAssignment(t, app, sess, cmIDFamilyCamp1, 9001, 2025, unit, false)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", staleRow); err != nil {
		t.Errorf("still-enrolled household's mirror row was deleted: %v", err)
	}
	if s.GetStats().Deleted != 0 {
		t.Errorf("Stats.Deleted = %d, want 0", s.GetStats().Deleted)
	}
}

// TestLodgingAssignmentsSyncSkipsMirrorDeletionWhenSessionHasZeroEnrolled pins
// the per-session reliability guard: a session with no actively-enrolled
// household of this grain at all is as likely to mean "attendees failed to
// sync" as "everyone cancelled" -- indistinguishable from inside this pass --
// so its placements are left untouched rather than swept.
func TestLodgingAssignmentsSyncSkipsMirrorDeletionWhenSessionHasZeroEnrolled(t *testing.T) {
	app := newLodgingTestApp(t)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025") // orphan sweep only runs for the active season (#2028)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	unit := addUnit(t, app, "ridge-a", 2025)

	// No attendee row at all for this session -- the enrolled set is empty.
	staleRow := staleHouseholdAssignment(t, app, sess, cmIDFamilyCamp1, 9001, 2025, unit, false)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", staleRow); err != nil {
		t.Errorf("zero-enrolled guard failed -- mirror row swept: %v", err)
	}
	if s.GetStats().Deleted != 0 {
		t.Errorf("Stats.Deleted = %d, want 0 (guard should skip)", s.GetStats().Deleted)
	}
}

// TestLodgingAssignmentsSyncDeletesOrphanedPersonGrainMirrorRow is the adult
// weekend twin: the sweep must treat person-grain rows the same way.
func TestLodgingAssignmentsSyncDeletesOrphanedPersonGrainMirrorRow(t *testing.T) {
	app := newLodgingTestApp(t)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025") // orphan sweep only runs for the active season (#2028)
	sess := addSession(t, app, cmIDWomensWeekend, "Women's Weekend", "adult",
		testAdultSessionStart, testAdultSessionEnd, 2025)
	unit := addUnit(t, app, "river-c", 2025)
	def := addFieldDef(t, app, cmIDReportableFamilyCampCabin, fieldNameReportableFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 32, 2025) // cancelled
	addPersonValue(t, app, emma, def, "River C", testLastUpdated, 2025)
	staleRow := stalePersonAssignment(t, app, sess, cmIDWomensWeekend, 5001, 2025, unit)

	// Keeps the session's enrolled set non-empty.
	liam := addPerson(t, app, 5002, 9001, 2025, hh)
	addAttendee(t, app, liam, sess, 5002, 2, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", staleRow); err == nil {
		t.Error("cancelled person's stale mirror row still exists")
	}
}

// TestLodgingAssignmentsSyncDeletesStaffTouchedOrphanedMirrorRow: unlike
// upsertAssignment's write-path skip -- which protects a staff move from a
// CONFLICTING campminder_sync value -- the orphan sweep is not gated on
// staff_touched. A cancelled household is gone whether or not staff moved it,
// matching the ruling #2028 makes for the draft-null pass in
// stranded_assignment_cleanup.go.
func TestLodgingAssignmentsSyncDeletesStaffTouchedOrphanedMirrorRow(t *testing.T) {
	app := newLodgingTestApp(t)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025") // orphan sweep only runs for the active season (#2028)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	unit := addUnit(t, app, "ridge-a", 2025)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 32, 2025) // cancelled
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2025)
	staleRow := staleHouseholdAssignment(t, app, sess, cmIDFamilyCamp1, 9001, 2025, unit, true) // staff_touched

	hh2 := addHousehold(t, app, 9002, 2025)
	liam := addPerson(t, app, 5002, 9002, 2025, hh2)
	addAttendee(t, app, liam, sess, 5002, 2, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", staleRow); err == nil {
		t.Error("staff-touched but cancelled household's row still exists -- staff_touched must not block the orphan sweep")
	}
}

// TestLodgingAssignmentsSyncDryRunDoesNotDeleteOrphans: DryRun computes but
// does not write, full stop -- including the delete path.
func TestLodgingAssignmentsSyncDryRunDoesNotDeleteOrphans(t *testing.T) {
	app := newLodgingTestApp(t)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025") // orphan sweep only runs for the active season (#2028)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	unit := addUnit(t, app, "ridge-a", 2025)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 32, 2025) // cancelled
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2025)
	staleRow := staleHouseholdAssignment(t, app, sess, cmIDFamilyCamp1, 9001, 2025, unit, false)

	hh2 := addHousehold(t, app, 9002, 2025)
	liam := addPerson(t, app, 5002, 9002, 2025, hh2)
	addAttendee(t, app, liam, sess, 5002, 2, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	s.DryRun = true
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", staleRow); err != nil {
		t.Errorf("dry run deleted a mirror row: %v", err)
	}
}

// TestLodgingAssignmentsSyncSkipsOrphanSweepForHistoricalYear pins #2028's
// data-loss fix directly: the orphan sweep must never run against a year
// other than the one this deployment is actively configured for
// (CAMPMINDER_SEASON_ID). handleLodgingAssignmentsSync's ?year= and the
// orchestrator's historical re-registration both drive Sync() through exactly
// this shape -- an explicit s.Year that differs from the active season -- so
// this test goes through the same Sync() entry point they use rather than
// reaching into deleteLodgingOrphans directly.
//
// Before the gate, this setup is byte-for-byte the "cancelled household"
// shape TestLodgingAssignmentsSyncDeletesOrphanedHouseholdMirrorRow proves
// gets deleted for the ACTIVE season -- the only variable here is that 2024 is
// not it. A stale/partial local attendees snapshot for a season that already
// happened must never read as "everyone cancelled".
func TestLodgingAssignmentsSyncSkipsOrphanSweepForHistoricalYear(t *testing.T) {
	app := newLodgingTestApp(t)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025") // the ACTIVE season is 2025...

	// ...but this sync targets 2024, a season that already happened.
	const historicalYear = 2024
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2024-05-24 07:00:00.000Z", "2024-05-27 07:00:00.000Z", historicalYear)
	unit := addUnit(t, app, "ridge-a", historicalYear)
	addAlias(t, app, "Ridge A", []string{unit}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, historicalYear)
	emma := addPerson(t, app, 5001, 9001, historicalYear, hh)
	addAttendee(t, app, emma, sess, 5001, 32, historicalYear) // cancelled
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, historicalYear)
	staleRow := staleHouseholdAssignment(t, app, sess, cmIDFamilyCamp1, 9001, historicalYear, unit, false)

	// A still-enrolled household keeps the session's enrolled set non-empty, so
	// a failure here can only be the year gate -- not the per-session guard
	// TestLodgingAssignmentsSyncSkipsMirrorDeletionWhenSessionHasZeroEnrolled
	// already covers.
	hh2 := addHousehold(t, app, 9002, historicalYear)
	liam := addPerson(t, app, 5002, 9002, historicalYear, hh2)
	addAttendee(t, app, liam, sess, 5002, 2, historicalYear)

	s := NewLodgingAssignmentsSync(app)
	s.Year = historicalYear // the orchestrator's historical path / API ?year=2024
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", staleRow); err != nil {
		t.Errorf("orphan sweep ran against a historical year -- real placement deleted: %v", err)
	}
	if got := s.GetStats().Deleted; got != 0 {
		t.Errorf("Stats.Deleted = %d, want 0 -- a historical sync must never lose rows to the orphan sweep", got)
	}
}

// TestLodgingAssignmentsSyncWritesHistoryOnOrphanDelete: every other way a
// lodging_assignments row changes is recorded in lodging_assignment_history
// (writeHistory, called from upsertAssignment/recordHistory above); a hard
// delete with no history row would be both unrecoverable and untraceable, so
// the orphan sweep must write one too.
func TestLodgingAssignmentsSyncWritesHistoryOnOrphanDelete(t *testing.T) {
	// unit's own code, not a repeated "ridge-a" literal -- keeps the addUnit
	// call and the history assertion below in step, and avoids adding a 3rd/4th
	// hardcoded occurrence of the string across this file (goconst).
	const unitCode = "ridge-a"
	app := newLodgingTestApp(t)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025") // orphan sweep only runs for the active season (#2028)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	unit := addUnit(t, app, unitCode, 2025)
	addAlias(t, app, "Ridge A", []string{unit}, 0, 0)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 32, 2025) // cancelled
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2025)
	staleHouseholdAssignment(t, app, sess, cmIDFamilyCamp1, 9001, 2025, unit, false)

	// Keeps the session's enrolled set non-empty (per-session guard).
	hh2 := addHousehold(t, app, 9002, 2025)
	liam := addPerson(t, app, 5002, 9002, 2025, hh2)
	addAttendee(t, app, liam, sess, 5002, 2, 2025)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if got := s.GetStats().Deleted; got != 1 {
		t.Fatalf("Stats.Deleted = %d, want 1", got)
	}

	hist, err := app.FindRecordsByFilter("lodging_assignment_history", "", "", 0, 0)
	if err != nil {
		t.Fatalf("querying history: %v", err)
	}
	var sweepRow *core.Record
	for _, h := range hist {
		if h.GetString("source_field") == sourceFieldOrphanSweep {
			sweepRow = h
		}
	}
	if sweepRow == nil {
		t.Fatalf("no lodging_assignment_history row with source_field=%q -- orphan delete left no audit trail",
			sourceFieldOrphanSweep)
	}
	if got := sweepRow.GetString("old_unit"); got != unitCode {
		t.Errorf("old_unit = %q, want %q", got, unitCode)
	}
	if got := sweepRow.GetString("new_unit"); got != "" {
		t.Errorf("new_unit = %q, want empty (row removed)", got)
	}
	if got := sweepRow.GetInt("household_cm_id"); got != 9001 {
		t.Errorf("household_cm_id = %d, want 9001", got)
	}
	if got := sweepRow.GetInt("year"); got != 2025 {
		t.Errorf("year = %d, want 2025", got)
	}
}

// TestFindAssignmentMatchesOnTheCampMinderSessionID pins kindred#2042: the
// mirror's upsert lookup keys on `session_cm_id`, not on the `session`
// relation.
//
// camp_sessions is unique on (cm_id, year), so its PocketBase record id is
// scoped to one season and is replaced outright if the record is ever
// RECREATED rather than updated -- a restore, a manual repair, a re-sync that
// deletes and re-adds. Migration 1500000124 already stopped that taking the
// lodging rows with it (`cascadeDelete: false`), so the placement SURVIVES;
// keyed on the relation it simply stops being found, and the next sync writes
// a duplicate beside it instead of updating it.
//
// The fixture keeps both camp_sessions rows because `session` is a REQUIRED
// relation on lodging_assignments and cannot point at a deleted record. In
// production the stale row is gone and the placement's relation dangles; here
// it stands in for the record the placement was written against.
func TestFindAssignmentMatchesOnTheCampMinderSessionID(t *testing.T) {
	app := newLodgingTestApp(t)
	sessOld := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	sessRecreated := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	unitID := addUnit(t, app, "ridge-a", 2025)

	existing := saveRecord(t, app, "lodging_assignments", map[string]any{
		"session": sessOld, "session_cm_id": cmIDFamilyCamp1, "year": 2025,
		"household_cm_id": 9001, "person_cm_id": 0, "units": []string{unitID},
		"source": "campminder_sync", "staff_touched": false,
	})

	s := NewLodgingAssignmentsSync(app)
	got, err := s.findAssignment(&assignmentInput{
		SessionID: sessRecreated, SessionCMID: cmIDFamilyCamp1, Year: 2025,
		HouseholdCMID: 9001, PersonCMID: 0,
	})
	if err != nil {
		t.Fatalf("findAssignment: %v", err)
	}
	if got == nil {
		t.Fatal("findAssignment returned nil -- the row is keyed on the stale session relation, " +
			"so the next sync writes a duplicate beside it")
	}
	if got.Id != existing {
		t.Errorf("findAssignment returned %q, want the existing row %q", got.Id, existing)
	}
}

// TestFindAssignmentStillSeparatesWeekends is the other half: re-keying must
// not widen the lookup. Two weekends in the same year hold a placement for the
// same household, and asking for one must never return the other's row.
func TestFindAssignmentStillSeparatesWeekends(t *testing.T) {
	app := newLodgingTestApp(t)
	sessA := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	sessB := addSession(t, app, cmIDFamilyCamp6, "Family Camp 6", "family",
		"2025-06-06 07:00:00.000Z", "2025-06-09 07:00:00.000Z", 2025)
	unitID := addUnit(t, app, "ridge-a", 2025)

	saveRecord(t, app, "lodging_assignments", map[string]any{
		"session": sessA, "session_cm_id": cmIDFamilyCamp1, "year": 2025,
		"household_cm_id": 9001, "units": []string{unitID},
		"source": "campminder_sync", "staff_touched": false,
	})
	wantB := saveRecord(t, app, "lodging_assignments", map[string]any{
		"session": sessB, "session_cm_id": cmIDFamilyCamp6, "year": 2025,
		"household_cm_id": 9001, "units": []string{unitID},
		"source": "campminder_sync", "staff_touched": false,
	})

	s := NewLodgingAssignmentsSync(app)
	got, err := s.findAssignment(&assignmentInput{
		SessionID: sessB, SessionCMID: cmIDFamilyCamp6, Year: 2025, HouseholdCMID: 9001,
	})
	if err != nil {
		t.Fatalf("findAssignment: %v", err)
	}
	if got == nil || got.Id != wantB {
		t.Fatalf("findAssignment returned %v, want the second weekend's row %q", got, wantB)
	}
}
