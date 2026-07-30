package sync

import (
	"context"
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
	unitID = addUnit(t, app, "ridge-a")
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
	if got.GetString("unit") != unitID {
		t.Errorf("unit = %q, want %q", got.GetString("unit"), unitID)
	}
	if got.GetString("merge") != "" {
		t.Error("merge is set on a single-room placement")
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
	ridgeB := addUnit(t, app, "ridge-b")
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
	if rows[0].GetString("unit") != ridgeB {
		t.Error("assignment did not move to ridge-b")
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
	ridgeB := addUnit(t, app, "ridge-b")
	addAlias(t, app, "Ridge B", []string{ridgeB}, 0, 0)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("first sync: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	rows[0].Set("staff_touched", true)
	rows[0].Set("unit", ridgeB)
	if err := app.Save(rows[0]); err != nil {
		t.Fatalf("simulate staff move: %v", err)
	}

	s2 := NewLodgingAssignmentsSync(app)
	s2.Year = 2025
	if err := s2.Sync(context.Background()); err != nil {
		t.Fatalf("second sync: %v", err)
	}

	after, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if after[0].GetString("unit") != ridgeB {
		t.Error("the sync reverted a staff-touched placement")
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
	unit := addUnit(t, app, "ridge-a")
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

// TestLodgingAssignmentsSyncMaterialisesMerges: "Golden Triangle - Tioga 1and2"
// resolves to two units, so the placement points at a merge, never at one room.
func TestLodgingAssignmentsSyncMaterialisesMerges(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	t1 := addUnit(t, app, "gt-tioga-1")
	t2 := addUnit(t, app, "gt-tioga-2")
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
	if rows[0].GetString("merge") == "" {
		t.Error("merge is empty on a two-room placement")
	}
	if rows[0].GetString("unit") != "" {
		t.Error("unit is set alongside merge; the XOR forbids that")
	}

	merges, _ := app.FindRecordsByFilter("lodging_merges", "", "", 0, 0)
	if len(merges) != 1 {
		t.Fatalf("merges = %d, want 1", len(merges))
	}
	if len(merges[0].GetStringSlice("member_units")) != 2 {
		t.Errorf("merge has %d members, want 2", len(merges[0].GetStringSlice("member_units")))
	}
	// lodging_merges.session_cm_id is required too, so a merge materialized
	// without it never saves at all -- this asserts the value, not just the save.
	if merges[0].GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Errorf("merge session_cm_id = %d, want %d", merges[0].GetInt("session_cm_id"), cmIDFamilyCamp1)
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
	unit := addUnit(t, app, "river-c")
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
	unit := addUnit(t, app, "river-c")
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
	unit := addUnit(t, app, "river-c")
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
