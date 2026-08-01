package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// seedIssue writes one work-queue row directly, standing in for a row an
// earlier sync queued and staff have since worked on. Replay reads that row's
// columns and nothing else, so building it is enough to drive the function --
// no sync run has to have happened first, which is the whole point.
func seedIssue(t *testing.T, app core.App, values map[string]any) string {
	t.Helper()
	return saveRecord(t, app, "lodging_ingest_issues", values)
}

// Replay must refuse a row that is not resolved. Replaying an open queue item
// would re-run the same failing resolution and bump occurrences, making the
// queue look busier while nothing was repaired.
func TestReplayIssueRefusesAnUnresolvedRow(t *testing.T) {
	app := newLodgingTestApp(t)
	id := seedIssue(t, app, map[string]any{
		"kind":            issueIllegalMerge,
		"raw_value":       "Ridge 1and2",
		"year":            2026,
		"is_resolved":     false,
		"household_cm_id": 9001,
	})

	_, err := ReplayIssue(app, id)
	if err == nil {
		t.Fatal("expected replay to refuse an unresolved row")
	}
}

// The grain guard: a row carrying neither a household nor a person cannot be
// replayed, because ingestValue has nothing to attribute the placement to.
func TestReplayIssueRefusesARowWithNoParty(t *testing.T) {
	app := newLodgingTestApp(t)
	id := seedIssue(t, app, map[string]any{
		"kind":            issueIllegalMerge,
		"raw_value":       "Ridge 1and2",
		"year":            2026,
		"is_resolved":     true,
		"household_cm_id": 0,
		"person_cm_id":    0,
	})

	if _, err := ReplayIssue(app, id); err == nil {
		t.Fatal("expected replay to refuse a row with no household and no person")
	}
}

// A row with no year cannot be replayed either: every index replay rebuilds is
// scoped to one season, and year 0 would silently build empty ones and then
// queue a no_session item -- a repair that reports itself as a fresh problem.
func TestReplayIssueRefusesARowWithNoYear(t *testing.T) {
	app := newLodgingTestApp(t)
	id := seedIssue(t, app, map[string]any{
		"kind":            issueIllegalMerge,
		"raw_value":       "Ridge 1and2",
		"year":            0,
		"is_resolved":     true,
		"household_cm_id": 9001,
	})

	if _, err := ReplayIssue(app, id); err == nil {
		t.Fatal("expected replay to refuse a row with no year")
	}
}

// The point of the whole task: a resolved row materializes its placement now,
// with no sync run anywhere in the test. Everything the sync would have built
// per run -- resolver, unit tree, party-size indexes, session windows -- is
// rebuilt here for one household.
func TestReplayIssuePlacesAHouseholdWithoutASync(t *testing.T) {
	app := newLodgingTestApp(t)
	sessionID, unitID := seedOneWeekendHousehold(t, app)

	id := seedIssue(t, app, map[string]any{
		"kind":            issueIllegalMerge,
		"raw_value":       "Ridge A",
		"source_field":    fieldNameFamilyCampCabin,
		"year":            2025,
		"is_resolved":     true,
		"household_cm_id": 9001,
	})

	res, err := ReplayIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}
	if !res.Placed || len(res.Blockers) != 0 {
		t.Errorf("result = %+v, want Placed with no blockers", res)
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1 written by the replay alone", len(rows))
	}
	got := rows[0]
	if got.GetString("unit") != unitID {
		t.Errorf("unit = %q, want %q", got.GetString("unit"), unitID)
	}
	if got.GetString("session") != sessionID {
		t.Errorf("session = %q, want %q", got.GetString("session"), sessionID)
	}
	if got.GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Errorf("session_cm_id = %d, want %d", got.GetInt("session_cm_id"), cmIDFamilyCamp1)
	}
	if got.GetInt("household_cm_id") != 9001 || got.GetInt("person_cm_id") != 0 {
		t.Errorf("party = (hh %d, person %d), want (9001, 0)",
			got.GetInt("household_cm_id"), got.GetInt("person_cm_id"))
	}
	// 2 enrolled children + 2 accompanying adults -- the same count the sync
	// computes, which is the evidence that replay reuses its party-size path
	// rather than a scoped copy of it.
	if got.GetInt("party_size") != 4 {
		t.Errorf("party_size = %d, want 4 (2 children + 2 adults)", got.GetInt("party_size"))
	}
	if got.GetString("source") != sourceCampMinderSync {
		t.Errorf("source = %q, want %q", got.GetString("source"), sourceCampMinderSync)
	}
}

// The person grain has to reach ADULT sessions, not family ones. A replay that
// asked for family weekends would find no candidate for an adult-weekend person
// and queue a no_session item -- the repair reporting itself as a new problem.
func TestReplayIssuePlacesAPersonOnAnAdultWeekend(t *testing.T) {
	app := newLodgingTestApp(t)
	womens := addSession(t, app, cmIDWomensWeekend, "Women's Weekend", "adult",
		testAdultSessionStart, testAdultSessionEnd, 2025)
	unit := addUnit(t, app, "river-c")
	addAlias(t, app, "River C", []string{unit}, 0, 0)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, womens, 5001, 2, 2025)

	id := seedIssue(t, app, map[string]any{
		"kind":         issueIllegalMerge,
		"raw_value":    "River C",
		"source_field": fieldNameReportableFamilyCampCabin,
		"year":         2025,
		"is_resolved":  true,
		"person_cm_id": 5001,
	})

	res, err := ReplayIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}
	if !res.Placed {
		t.Errorf("result = %+v, want Placed", res)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1", len(rows))
	}
	if rows[0].GetString("session") != womens {
		t.Errorf("session = %q, want the adult weekend %q", rows[0].GetString("session"), womens)
	}
	if rows[0].GetInt("person_cm_id") != 5001 || rows[0].GetInt("household_cm_id") != 0 {
		t.Errorf("party = (hh %d, person %d), want (0, 5001)",
			rows[0].GetInt("household_cm_id"), rows[0].GetInt("person_cm_id"))
	}
	if rows[0].GetInt("party_size") != 1 {
		t.Errorf("party_size = %d, want 1 for an individual", rows[0].GetInt("party_size"))
	}
}

// The motivating repair for the illegal_merge kind: staff correct the unit
// registry so the alias now names a container's complete child set, tick the
// row, and the merge materializes on the click rather than 8-10 minutes later.
func TestReplayIssueMaterializesARepairedMerge(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	building := addContainerUnit(t, app, "ridge")
	r1 := addUnitWithParent(t, app, "ridge-1", building)
	r2 := addUnitWithParent(t, app, "ridge-2", building)
	addAlias(t, app, "Ridge 1and2", []string{r1, r2}, 0, 0)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2025)

	id := seedIssue(t, app, map[string]any{
		"kind":            issueIllegalMerge,
		"raw_value":       "Ridge 1and2",
		"source_field":    fieldNameFamilyCampCabin,
		"year":            2025,
		"is_resolved":     true,
		"household_cm_id": 9001,
	})

	res, err := ReplayIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}
	if !res.Placed {
		t.Errorf("result = %+v, want Placed", res)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1", len(rows))
	}
	if rows[0].GetString("merge") == "" {
		t.Error("a two-room placement must point at a merge, not a unit")
	}
	if rows[0].GetString("unit") != "" {
		t.Errorf("unit = %q on a merged placement; the grain XOR requires it empty",
			rows[0].GetString("unit"))
	}

	merges, _ := app.FindRecordsByFilter("lodging_merges", "", "", 0, 0)
	if len(merges) != 1 {
		t.Fatalf("lodging_merges rows = %d, want 1", len(merges))
	}
	if merges[0].GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Errorf("merge session_cm_id = %d, want %d",
			merges[0].GetInt("session_cm_id"), cmIDFamilyCamp1)
	}
}

// A repair that did not in fact repair anything must leave the queue honest.
//
// IssueRecorder.Flush writes is_resolved only on CREATE -- deliberately, so a
// nightly sync cannot un-tick what staff ticked. A replay is a different actor:
// it IS the click, and if the click placed nothing then the item is not done.
// Without the re-open below, a half-finished repair writes no placement,
// reports success, and leaves the row ticked and invisible in the open queue --
// the "queue is a log, not a work queue" failure this whole task removes,
// reintroduced on the failure path.
func TestReplayIssueReopensARowItCouldNotPlace(t *testing.T) {
	app := newLodgingTestApp(t)
	sess := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2025)
	building := addContainerUnit(t, app, "ridge")
	r1 := addUnitWithParent(t, app, "ridge-1", building)
	addUnitWithParent(t, app, "ridge-2", building)
	// A third child nobody named: the alias below is still a PARTIAL child set.
	r3 := addUnitWithParent(t, app, "ridge-3", building)
	addAlias(t, app, "Ridge 1and3", []string{r1, r3}, 0, 0)

	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, sess, 5001, 2, 2025)

	id := seedIssue(t, app, map[string]any{
		"kind":            issueIllegalMerge,
		"raw_value":       "Ridge 1and3",
		"source_field":    fieldNameFamilyCampCabin,
		"year":            2025,
		"is_resolved":     true,
		"household_cm_id": 9001,
	})

	res, err := ReplayIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}

	if res.Placed {
		t.Error("result reports Placed, but an illegal merge places nothing")
	}
	if len(res.Blockers) != 1 || res.Blockers[0] != issueIllegalMerge {
		t.Errorf("Blockers = %v, want [%s]", res.Blockers, issueIllegalMerge)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 0 {
		t.Errorf("assignments = %d, want 0; an illegal merge places nothing", len(rows))
	}
	// Flush upserts onto the same dedup key, so the row staff already ticked is
	// the row that gets refreshed -- no second copy appears.
	issues, _ := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if len(issues) != 1 {
		t.Fatalf("queue rows = %d, want 1 (the same row, re-observed)", len(issues))
	}
	if issues[0].Id != id {
		t.Errorf("replay queued a NEW row %q instead of updating %q", issues[0].Id, id)
	}
	if issues[0].GetBool("is_resolved") {
		t.Error("the row is still ticked after a replay that placed nothing; " +
			"it is invisible in the open queue and nothing will ever revisit it")
	}
}

// A replay that DOES place must leave the row ticked. The re-open above is
// conditional on failure; a blanket un-tick would bounce every repaired item
// straight back into the queue.
func TestReplayIssueLeavesAPlacedRowResolved(t *testing.T) {
	app := newLodgingTestApp(t)
	seedOneWeekendHousehold(t, app)

	id := seedIssue(t, app, map[string]any{
		"kind":            issueIllegalMerge,
		"raw_value":       "Ridge A",
		"source_field":    fieldNameFamilyCampCabin,
		"year":            2025,
		"is_resolved":     true,
		"household_cm_id": 9001,
	})

	if _, err := ReplayIssue(app, id); err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}

	row, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the row: %v", err)
	}
	if !row.GetBool("is_resolved") {
		t.Error("a successful replay un-ticked the row it just repaired")
	}
}

// seedThreeWeekendHousehold builds an ambiguous household: enrolled in three
// family weekends with CampMinder's single cabin value for the year, which is
// the shape spec 3.6 refuses to guess at. Returns the three sessions in date
// order.
func seedThreeWeekendHousehold(
	t *testing.T, app core.App, cabinValue, lastUpdated string,
) (first, second, third string) {
	t.Helper()
	first = addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	second = addSession(t, app, cmIDFamilyCamp6, "Family Camp 6", "family",
		"2025-09-18 07:00:00.000Z", "2025-09-21 07:00:00.000Z", 2025)
	third = addSession(t, app, cmIDWinterFamily, "Winter Family Camp", "family",
		"2025-12-26 07:00:00.000Z", "2025-12-29 07:00:00.000Z", 2025)

	unit := addUnit(t, app, "ridge-a")
	addAlias(t, app, "Ridge A", []string{unit}, 0, 0)
	unitB := addUnit(t, app, "ridge-b")
	addAlias(t, app, "Ridge B", []string{unitB}, 0, 0)

	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	for _, s := range []string{first, second, third} {
		addAttendee(t, app, emma, s, 5001, 2, 2025)
	}
	addHouseholdValue(t, app, hh, cabinDef, cabinValue, lastUpdated, 2025)
	return first, second, third
}

// suggested_session is the one-click confirmation the queue offers staff on an
// ambiguous row, and AttributeSession derives it by walking the candidates for
// the first weekend starting on or after the observation's timestamp.
//
// Replaying with time.Now() therefore does NOT merely "break ties": for any
// past season now is after every window, so the walk falls through to the LAST
// candidate and Flush -- which overwrites a non-empty suggestion -- replaces a
// correct guess with the final weekend of the year. This asserts replay
// reproduces the sync's answer: the weekend the real last_updated points at.
func TestReplayIssueKeepsTheSuggestionTheSyncWouldHaveMade(t *testing.T) {
	app := newLodgingTestApp(t)
	// Edited between the first and second weekends, so the sync suggests the
	// second. Now would suggest the third; a zero timestamp would suggest none.
	first, second, third := seedThreeWeekendHousehold(t, app,
		"Ridge A", "2025-06-10T09:00:00.0000000+00:00")

	id := seedIssue(t, app, map[string]any{
		"kind":              issueAmbiguousSession,
		"raw_value":         "Ridge A",
		"source_field":      fieldNameFamilyCampCabin,
		"year":              2025,
		"is_resolved":       true,
		"household_cm_id":   9001,
		"suggested_session": first,
	})

	if _, err := ReplayIssue(app, id); err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}

	row, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the row: %v", err)
	}
	switch row.GetString("suggested_session") {
	case second: // the sync's answer
	case third:
		t.Error("suggested_session was rewritten to the LAST weekend of the year: " +
			"replay attributed with now instead of the observation's timestamp")
	default:
		t.Errorf("suggested_session = %q, want the second weekend %q",
			row.GetString("suggested_session"), second)
	}
}

// When the observation cannot be found -- staff edited the CampMinder value
// after the row was queued, so nothing matches the raw string -- replay has no
// timestamp and must manufacture no guess. Flush then preserves the stored one
// rather than blanking it, which is the same contract a re-run of the sync has
// when last_updated stops parsing.
func TestReplayIssuePreservesTheSuggestionWhenTheObservationIsGone(t *testing.T) {
	app := newLodgingTestApp(t)
	first, _, _ := seedThreeWeekendHousehold(t, app,
		"Ridge A", "2025-06-10T09:00:00.0000000+00:00")

	// The queue row names a value the household no longer holds.
	id := seedIssue(t, app, map[string]any{
		"kind":              issueAmbiguousSession,
		"raw_value":         "Ridge B",
		"source_field":      fieldNameFamilyCampCabin,
		"year":              2025,
		"is_resolved":       true,
		"household_cm_id":   9001,
		"suggested_session": first,
	})

	if _, err := ReplayIssue(app, id); err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}

	row, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the row: %v", err)
	}
	if row.GetString("suggested_session") != first {
		t.Errorf("suggested_session = %q, want the stored %q left alone",
			row.GetString("suggested_session"), first)
	}
}
