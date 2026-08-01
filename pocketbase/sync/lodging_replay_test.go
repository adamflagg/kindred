package sync

import (
	"fmt"
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

// The discriminating case for the re-open rule: the pass records a blocker on a
// DIFFERENT dedup key from the row that was clicked. The clicked row stays
// ticked and the new blocker gets its own open row.
//
// Why that is the honest outcome: the row names illegal_merge, and this pass
// did not record one, so re-opening it would send staff to inspect a merge and
// find nothing wrong while the real blocker sits beside it. Nothing is lost --
// the new row carries the remaining work, and Placed still tells the caller the
// click did not finish the job.
//
// Note what this does NOT test, despite the fixture's shape: the container and
// parent links make the alias a legal merge, but ingestValue returns at the
// attribution check BEFORE merge judgement, so that repair is never exercised
// and the test passes identically with a still-illegal alias. The fixture is
// built that way to model a plausible history, not to cover JudgeMerge --
// TestReplayIssueMaterializesARepairedMerge does that.
func TestReplayIssueTicksARowWhoseBlockerIsGoneAndOpensTheNewOne(t *testing.T) {
	app := newLodgingTestApp(t)
	fc1 := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	fc6 := addSession(t, app, cmIDFamilyCamp6, "Family Camp 6", "family",
		"2025-09-18 07:00:00.000Z", "2025-09-21 07:00:00.000Z", 2025)

	// The repair staff just made: both rooms now hang off a container, so the
	// alias names a COMPLETE child set and the merge is legal.
	building := addContainerUnit(t, app, "ridge")
	r1 := addUnitWithParent(t, app, "ridge-1", building)
	r2 := addUnitWithParent(t, app, "ridge-2", building)
	addAlias(t, app, "Ridge 1and2", []string{r1, r2}, 0, 0)

	// ...but the household attends two weekends, and CampMinder holds one value
	// for the year, so the value is now blocked on attribution instead.
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, fc1, 5001, 2, 2025)
	addAttendee(t, app, emma, fc6, 5001, 2, 2025)
	addHouseholdValue(t, app, hh, cabinDef, "Ridge 1and2", testLastUpdated, 2025)

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

	if res.Placed {
		t.Error("result reports Placed, but an ambiguous session places nothing")
	}
	// Naming the OLD kind here would have the UI report the problem staff have
	// just finished fixing.
	if len(res.Blockers) != 1 || res.Blockers[0] != issueAmbiguousSession {
		t.Errorf("Blockers = %v, want [%s] -- the CURRENT blocker, not the row's kind",
			res.Blockers, issueAmbiguousSession)
	}

	original, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the original row: %v", err)
	}
	if !original.GetBool("is_resolved") {
		t.Error("the illegal_merge row was re-opened, but that blocker is gone; " +
			"staff would inspect the merge and find nothing wrong")
	}

	fresh, err := app.FindRecordsByFilter("lodging_ingest_issues",
		"kind = {:kind}", "", 0, 0, map[string]any{"kind": issueAmbiguousSession})
	if err != nil {
		t.Fatalf("looking up the new row: %v", err)
	}
	if len(fresh) != 1 {
		t.Fatalf("ambiguous_session rows = %d, want 1 carrying the remaining work", len(fresh))
	}
	if fresh[0].GetBool("is_resolved") {
		t.Error("the new blocker was created already ticked; nothing would surface it")
	}
	if fresh[0].GetInt("household_cm_id") != 9001 {
		t.Errorf("new row household_cm_id = %d, want 9001", fresh[0].GetInt("household_cm_id"))
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 0 {
		t.Errorf("assignments = %d, want 0", len(rows))
	}
}

// reopenRecorded finds the row to un-tick with findExisting, so what that
// lookup counts as "the same item" decides which row goes back into the open
// queue. It is the full dedup tuple, not the kind: the same kind for a
// different party is a different queue item, and matching one row against
// another party's would un-tick a stranger's work.
//
// ReplayIssue cannot currently produce a party mismatch -- it records against
// the party it read off the row -- but the alias kinds record with no party at
// all, so the party-less fan-out that will replay those can. This pins the rule
// directly rather than waiting for that caller to discover it.
func TestFindExistingMatchesOnTheWholeDedupTuple(t *testing.T) {
	app := newLodgingTestApp(t)
	stored := Issue{
		Kind: issueIllegalMerge, RawValue: "Ridge 1and2",
		SourceField: fieldNameFamilyCampCabin, Year: 2025, HouseholdCMID: 9001,
	}
	rowID := seedIssue(t, app, map[string]any{
		"kind": stored.Kind, "raw_value": stored.RawValue,
		"source_field": stored.SourceField, "year": stored.Year,
		"household_cm_id": stored.HouseholdCMID, "is_resolved": true,
	})
	recorder := NewIssueRecorder(app, 2025)

	vary := func(mutate func(*Issue)) Issue {
		other := stored
		mutate(&other)
		return other
	}

	cases := []struct {
		name    string
		lookup  Issue
		wantHit bool
	}{
		{"identical", stored, true},
		{"same kind, different household", vary(func(i *Issue) { i.HouseholdCMID = 9002 }), false},
		{"same kind, party dropped", vary(func(i *Issue) { i.HouseholdCMID = 0 }), false},
		{"same kind, person grain instead", vary(func(i *Issue) {
			i.HouseholdCMID, i.PersonCMID = 0, 5001
		}), false},
		{"different kind", vary(func(i *Issue) { i.Kind = issueAmbiguousSession }), false},
		{"different raw value", vary(func(i *Issue) { i.RawValue = "Ridge 1and3" }), false},
		{"different source field", vary(func(i *Issue) {
			i.SourceField = fieldNameReportableFamilyCampCabin
		}), false},
		{"different year", vary(func(i *Issue) { i.Year = 2024 }), false},
		// Advisory columns are not part of the identity: a re-observation that
		// gained a suggestion is still the same item.
		{"same item, new suggestion", vary(func(i *Issue) { i.SuggestedSession = "s1" }), true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := recorder.findExisting(&tc.lookup)
			if err != nil {
				t.Fatalf("findExisting: %v", err)
			}
			if tc.wantHit && (got == nil || got.Id != rowID) {
				t.Errorf("findExisting = %v, want the seeded row %s", got, rowID)
			}
			if !tc.wantHit && got != nil {
				t.Errorf("findExisting matched row %s on a different dedup tuple", got.Id)
			}
		})
	}
}

// The hole a re-open scoped to the replayed row leaves behind.
//
// Two ticked rows can exist for one party: a run with a single candidate
// weekend judges the merge and queues illegal_merge, then a later run with a
// second weekend enrolled returns at attribution and queues ambiguous_session.
// ingestValue cannot produce both in one pass -- it returns before merge
// judgement -- but they accumulate across runs, and staff tick both.
//
// Replaying the merge row then re-hits the ambiguous one. Flush matches it via
// findExisting and cannot un-tick it, because Flush writes is_resolved only on
// create. If the re-open only ever considers the replayed row, the outcome is
// no placement, no open row anywhere, and a nil error: the work item vanishes,
// which is the invariant this whole wave exists to establish.
func TestReplayIssueReopensAnotherTickedRowItRehit(t *testing.T) {
	app := newLodgingTestApp(t)
	fc1 := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		"2025-05-23 07:00:00.000Z", "2025-05-26 07:00:00.000Z", 2025)
	fc6 := addSession(t, app, cmIDFamilyCamp6, "Family Camp 6", "family",
		"2025-09-18 07:00:00.000Z", "2025-09-21 07:00:00.000Z", 2025)

	building := addContainerUnit(t, app, "ridge")
	r1 := addUnitWithParent(t, app, "ridge-1", building)
	r2 := addUnitWithParent(t, app, "ridge-2", building)
	addAlias(t, app, "Ridge 1and2", []string{r1, r2}, 0, 0)

	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2025)
	emma := addPerson(t, app, 5001, 9001, 2025, hh)
	addAttendee(t, app, emma, fc1, 5001, 2, 2025)
	addAttendee(t, app, emma, fc6, 5001, 2, 2025)
	addHouseholdValue(t, app, hh, cabinDef, "Ridge 1and2", testLastUpdated, 2025)

	// Both rows already ticked, same party and same value, differing only in kind.
	base := map[string]any{
		"raw_value":       "Ridge 1and2",
		"source_field":    fieldNameFamilyCampCabin,
		"year":            2025,
		"is_resolved":     true,
		"household_cm_id": 9001,
	}
	mergeRow := map[string]any{"kind": issueIllegalMerge}
	ambiguousRow := map[string]any{"kind": issueAmbiguousSession}
	for k, v := range base {
		mergeRow[k], ambiguousRow[k] = v, v
	}
	replayed := seedIssue(t, app, mergeRow)
	other := seedIssue(t, app, ambiguousRow)

	res, err := ReplayIssue(app, replayed)
	if err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}
	if res.Placed {
		t.Error("result reports Placed, but an ambiguous session places nothing")
	}

	// The row this pass actually re-hit must come back into the queue, whether or
	// not it is the row that was clicked.
	rehit, err := app.FindRecordById("lodging_ingest_issues", other)
	if err != nil {
		t.Fatalf("reloading the re-hit row: %v", err)
	}
	if rehit.GetBool("is_resolved") {
		t.Error("the ambiguous_session row this pass re-hit is still ticked: " +
			"nothing was placed and no open row survives, so the item has vanished")
	}

	// ...and the clicked row, whose own blocker did not recur, stays ticked.
	clicked, err := app.FindRecordById("lodging_ingest_issues", replayed)
	if err != nil {
		t.Fatalf("reloading the clicked row: %v", err)
	}
	if !clicked.GetBool("is_resolved") {
		t.Error("the illegal_merge row was re-opened, but its own blocker never recurred")
	}
}

// seededParty is one household the party-less fixtures built, with the ids the
// tests need to add a second weekend for it or assert on its placement.
type seededParty struct {
	HouseholdCMID int
	HouseholdPBID string
	PersonCMID    int
	PersonPBID    string
}

// seedTwoHouseholdsSharingACabinString builds the shape unresolved_alias exists
// for: two households that wrote the SAME cabin string, each enrolled in one
// family weekend, standing behind ONE queue row because the dedup key zeroes
// the party.
//
// It deliberately creates no alias. Creating one IS the staff repair a replay
// follows, so each test states that precondition itself in the line that models
// the repair -- and the tests where the string still does not resolve need it
// absent.
func seedTwoHouseholdsSharingACabinString(
	t *testing.T, app core.App, value string, year int,
) (sessionID string, parties []seededParty) {
	t.Helper()
	sessionID = addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		fmt.Sprintf("%d-05-23 07:00:00.000Z", year),
		fmt.Sprintf("%d-05-26 07:00:00.000Z", year), year)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)

	// Edited between the May weekend and any later one a caller adds, so a
	// replay reading the real timestamp suggests the NEXT weekend while one
	// attributing with now falls through to the last.
	lastUpdated := fmt.Sprintf("%d-06-10T09:00:00.0000000+00:00", year)

	for i, hhCMID := range []int{9001, 9002} {
		personCMID := 5001 + i
		hh := addHousehold(t, app, hhCMID, year)
		person := addPerson(t, app, personCMID, hhCMID, year, hh)
		addAttendee(t, app, person, sessionID, personCMID, 2, year)
		addHouseholdValue(t, app, hh, cabinDef, value, lastUpdated, year)
		parties = append(parties, seededParty{
			HouseholdCMID: hhCMID, HouseholdPBID: hh,
			PersonCMID: personCMID, PersonPBID: person,
		})
	}
	return sessionID, parties
}

// seedFanOutWithOneAmbiguousHousehold is the mixed outcome: of the two
// households that wrote the string, the second attends three weekends, so
// CampMinder's single value for the year cannot say which one it describes.
// One party places, one does not.
func seedFanOutWithOneAmbiguousHousehold(
	t *testing.T, app core.App, value string,
) (first, second, third string, parties []seededParty) {
	t.Helper()
	// 2025, not a future year: every weekend is in the past, so attributing with
	// now falls through to the LAST candidate -- the failure mode that moved a
	// real household's one-click confirmation forward by four months.
	first, parties = seedTwoHouseholdsSharingACabinString(t, app, value, 2025)
	second = addSession(t, app, cmIDFamilyCamp6, "Family Camp 6", "family",
		"2025-09-18 07:00:00.000Z", "2025-09-21 07:00:00.000Z", 2025)
	third = addSession(t, app, cmIDWinterFamily, "Winter Family Camp", "family",
		"2025-12-26 07:00:00.000Z", "2025-12-29 07:00:00.000Z", 2025)

	blocked := parties[1]
	addAttendee(t, app, blocked.PersonPBID, second, blocked.PersonCMID, 2, 2025)
	addAttendee(t, app, blocked.PersonPBID, third, blocked.PersonCMID, 2, 2025)
	return first, second, third, parties
}

// The rows the fan-out must refuse rather than quietly do nothing with.
//
// Silence is the failure mode worth guarding: every one of these returns zero
// placements, so without an error a caller cannot tell "there was nothing to
// place" from "this row was never replayable in the first place".
func TestReplayPartylessIssueRefusesRowsItCannotFanOut(t *testing.T) {
	app := newLodgingTestApp(t)

	cases := []struct {
		name   string
		values map[string]any
	}{
		// A party-scoped row belongs to ReplayIssue: it names one party, and
		// fanning out over everyone who wrote the string would replay strangers.
		{"party-scoped, household", map[string]any{
			"kind": issueIllegalMerge, "raw_value": "Ridge 1and2", "year": 2026,
			"is_resolved": true, "household_cm_id": 9001,
		}},
		{"party-scoped, person", map[string]any{
			"kind": issueIllegalMerge, "raw_value": "River C", "year": 2026,
			"is_resolved": true, "person_cm_id": 5001,
		}},
		// Replaying an open item re-runs the same failing resolution and bumps
		// occurrences: the queue looks busier and nothing was repaired.
		{"not resolved", map[string]any{
			"kind": issueUnresolvedAlias, "raw_value": "Nowhere Cabin", "year": 2026,
			"is_resolved": false,
		}},
		// Year 0 would build empty indexes and then queue the emptiness as a
		// fresh problem.
		{"no year", map[string]any{
			"kind": issueUnresolvedAlias, "raw_value": "Nowhere Cabin", "year": 0,
			"is_resolved": true,
		}},
		// field_zero_values is party-less too, but its raw_value names the FIELD,
		// not a cabin string. Fanning out on it searches for households whose
		// cabin answer is the literal text "Family Camp Cabin".
		{"field-level warning", map[string]any{
			"kind": issueFieldZeroValues, "raw_value": fieldNameFamilyCampCabin,
			"source_field": fieldNameFamilyCampCabin, "year": 2026, "is_resolved": true,
		}},
		// An empty raw value cannot be matched: a bound empty parameter matches
		// nothing, and the bare literal `value = ''` would match every party who
		// answered nothing at all.
		{"no raw value", map[string]any{
			"kind": issueUnresolvedAlias, "raw_value": "",
			"source_field": fieldNameFamilyCampCabin, "year": 2026, "is_resolved": true,
		}},
		// Without a known source field there is no grain, so no table to read.
		{"unknown source field", map[string]any{
			"kind": issueUnresolvedAlias, "raw_value": "Nowhere Cabin",
			"source_field": "Some Retired Field", "year": 2026, "is_resolved": true,
		}},
		// unknown_party is the third party-less kind and DOES name a cabin string,
		// so it routes here -- but the row exists because its party has no
		// CampMinder id, and those are exactly the value rows the fan-out skips.
		// The party the row is about could never be re-recorded, so the row could
		// never re-open; and if other households wrote the same string the click
		// would report placed=N while the named party stayed unplaced.
		{"unknown party", map[string]any{
			"kind": issueUnknownParty, "raw_value": "Nowhere Cabin",
			"source_field": fieldNameFamilyCampCabin, "year": 2026, "is_resolved": true,
		}},
		// No custom_field_defs row for the field, so no value can be read through
		// it. Reporting 0 placements would be indistinguishable from "the string
		// resolves and nobody writes it any more".
		{"source field absent from custom_field_defs", map[string]any{
			"kind": issueUnresolvedAlias, "raw_value": "Nowhere Cabin",
			"source_field": fieldNameFamilyCampCabin, "year": 2026, "is_resolved": true,
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id := seedIssue(t, app, tc.values)
			placed, err := ReplayPartylessIssue(app, id)
			if err == nil {
				t.Fatalf("expected a refusal; got placed = %d and no error", placed)
			}
			if placed != 0 {
				t.Errorf("placed = %d on a refused row, want 0", placed)
			}
		})
	}
}

// A hand-disabled source field is the same dead end as an absent one, and the
// realistic one: somebody turned the mapping off in lodging_field_mappings.
//
// Everything else here is in place -- the string resolves, both households
// wrote it, the placement would land -- so the off switch is the only thing
// stopping the replay. Reporting a quiet zero would tick the row on the
// strength of a mapping nobody restored.
func TestReplayPartylessIssueRefusesARowWhoseSourceFieldIsDisabled(t *testing.T) {
	app := newLodgingTestApp(t)
	seedTwoHouseholdsSharingACabinString(t, app, "Ridge Cabin 9", 2026)
	addAlias(t, app, "Ridge Cabin 9", []string{addUnit(t, app, "ridge-9")}, 0, 0)
	saveRecord(t, app, "lodging_field_mappings", map[string]any{
		"field_cm_id": cmIDFamilyCampCabin, "field_name": fieldNameFamilyCampCabin,
		"target": targetCabinAssignmentHousehold, "is_enabled": false,
	})

	id := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "Ridge Cabin 9",
		"source_field": fieldNameFamilyCampCabin,
		"year":         2026,
		"is_resolved":  true,
	})

	placed, err := ReplayPartylessIssue(app, id)
	if err == nil {
		t.Fatalf("expected a refusal; got placed = %d and no error", placed)
	}
	if placed != 0 {
		t.Errorf("placed = %d, want 0", placed)
	}
	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 0 {
		t.Errorf("assignments = %d, want 0 through a disabled field", len(rows))
	}
}

// The success shape, and the point of the whole task: one resolved row fans out
// to one placement per household that wrote the string. This is the assertion
// that fails if the function silently does nothing.
func TestReplayPartylessIssueFansOutToEveryPartyThatWroteTheString(t *testing.T) {
	app := newLodgingTestApp(t)
	sessionID, parties := seedTwoHouseholdsSharingACabinString(t, app, "Ridge Cabin 9", 2026)
	// The staff repair this replay follows: the string now has an alias.
	unitID := addUnit(t, app, "ridge-9")
	addAlias(t, app, "Ridge Cabin 9", []string{unitID}, 0, 0)

	id := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "Ridge Cabin 9",
		"source_field": fieldNameFamilyCampCabin,
		"year":         2026,
		"is_resolved":  true,
		"occurrences":  2,
	})

	placed, err := ReplayPartylessIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayPartylessIssue: %v", err)
	}
	if placed != 2 {
		t.Errorf("placed = %d, want 2 -- one per household that wrote the string", placed)
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "household_cm_id", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("assignments = %d, want one per household", len(rows))
	}
	for i, row := range rows {
		if row.GetInt("household_cm_id") != parties[i].HouseholdCMID {
			t.Errorf("assignment %d household_cm_id = %d, want %d",
				i, row.GetInt("household_cm_id"), parties[i].HouseholdCMID)
		}
		if row.GetString("unit") != unitID {
			t.Errorf("assignment %d unit = %q, want %q", i, row.GetString("unit"), unitID)
		}
		if row.GetString("session") != sessionID {
			t.Errorf("assignment %d session = %q, want %q", i, row.GetString("session"), sessionID)
		}
	}

	// Every party placed, so the row staff ticked stays ticked.
	queued, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the row: %v", err)
	}
	if !queued.GetBool("is_resolved") {
		t.Error("a fan-out that placed every party un-ticked the row it just repaired")
	}
}

// The invariant Task 4 established, on the fan-out: a string that still does not
// resolve leaves its row OPEN. Flush writes is_resolved only on create, so
// nothing but the explicit re-open can put it back.
//
// The occurrence count is the second assertion here, and it is not incidental:
// Flush SETS occurrences to what the pass observed, so a fan-out that visited
// only the first party would silently rewrite a 2-household string as a
// 1-household one.
func TestReplayPartylessIssueReopensARowWhoseStringStillDoesNotResolve(t *testing.T) {
	app := newLodgingTestApp(t)
	seedTwoHouseholdsSharingACabinString(t, app, "Nowhere Cabin", 2026)
	// A REAL mapping exists -- resolved_alias is set, as production always
	// sets it on a genuine map (#1899: mapUnresolvedAlias never leaves it
	// empty; only ignoreIngestIssue does, and an ignored row must never
	// reopen -- see TestReplayPartylessIssueDoesNotReopenAnIgnoredRow). But
	// the alias covers 2027 onward, not 2026, so this year's occurrence of
	// the string still does not resolve: reopening is the right outcome for
	// a stale mapping, unlike for an ignore.
	unit := addUnit(t, app, "gt-somewhere")
	aliasID := addAlias(t, app, "Nowhere Cabin", []string{unit}, 2027, 0)

	id := seedIssue(t, app, map[string]any{
		"kind":           issueUnresolvedAlias,
		"raw_value":      "Nowhere Cabin",
		"source_field":   fieldNameFamilyCampCabin,
		"year":           2026,
		"is_resolved":    true,
		"occurrences":    2,
		"resolved_alias": aliasID,
	})

	placed, err := ReplayPartylessIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayPartylessIssue: %v", err)
	}
	if placed != 0 {
		t.Errorf("placed = %d, want 0 -- the string resolves to nothing", placed)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 0 {
		t.Errorf("assignments = %d, want 0", len(rows))
	}

	issues, _ := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if len(issues) != 1 {
		t.Fatalf("queue rows = %d, want 1 (the same row, re-observed)", len(issues))
	}
	if issues[0].Id != id {
		t.Errorf("the fan-out queued a NEW row %q instead of updating %q", issues[0].Id, id)
	}
	if issues[0].GetBool("is_resolved") {
		t.Error("the row is still ticked after a fan-out that placed nothing; " +
			"it is invisible in the open queue and nothing will ever revisit it")
	}
	if got := issues[0].GetInt("occurrences"); got != 2 {
		t.Errorf("occurrences = %d, want 2 -- one per household that still writes the string", got)
	}
}

// #1899: the mirror of the test above. An unresolved_alias/ambiguous_alias
// row ticked with resolved_alias EMPTY is an ignore -- ignoreIngestIssue
// (frontend/src/services/lodgingCrud.ts) writes exactly this shape for "not a
// cabin name" -- and a fan-out that re-fails identically for every party who
// wrote the string must not undo that decision.
func TestReplayPartylessIssueDoesNotReopenAnIgnoredRow(t *testing.T) {
	app := newLodgingTestApp(t)
	seedTwoHouseholdsSharingACabinString(t, app, "Not A Cabin", 2026)
	// No alias, and none is coming: staff said this string is not a cabin
	// name, which is exactly what resolved_alias staying empty records.

	id := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "Not A Cabin",
		"source_field": fieldNameFamilyCampCabin,
		"year":         2026,
		"is_resolved":  true,
		"occurrences":  2,
		// resolved_alias intentionally omitted -- the ignore marker.
	})

	if _, err := ReplayPartylessIssue(app, id); err != nil {
		t.Fatalf("ReplayPartylessIssue: %v", err)
	}

	got, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the issue: %v", err)
	}
	if !got.GetBool("is_resolved") {
		t.Error("an ignored row must stay resolved after a fan-out that still " +
			"cannot resolve the string -- reopening it undoes the ignore")
	}
}

// #1899: the parked Task-4 item. unresolved_alias/ambiguous_alias collapse
// their dedup key across every party, so a party-SCOPED replay of a
// completely different issue can land on the exact same key if that party's
// OWN cabin string also fails to resolve -- and before this fix, reopenRecorded
// could not tell that collision apart from a genuine re-observation of the
// row it was meant to touch.
func TestReopenRecordedDoesNotReopenAnUnrelatedIgnoredRowDuringAPartyScopedReplay(t *testing.T) {
	app := newLodgingTestApp(t)
	_, parties := seedTwoHouseholdsSharingACabinString(t, app, "Not A Cabin", 2026)
	// Nobody ever mapped "Not A Cabin" -- staff ignored it once, and it is
	// exactly as unmapped now as it was then.

	ignoredID := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "Not A Cabin",
		"source_field": fieldNameFamilyCampCabin,
		"year":         2026,
		"is_resolved":  true,
		"occurrences":  2,
	})

	// A wholly separate, party-scoped row for parties[0] -- its own kind and
	// history do not matter here. What matters is that replaying IT calls
	// ingestValue for parties[0], whose own custom-field answer is the SAME
	// "Not A Cabin" string, which re-records the ignored row's exact
	// collapsed key as a side effect of a replay that was never about it.
	unrelatedID := seedIssue(t, app, map[string]any{
		"kind":            issueNoSession,
		"raw_value":       "Not A Cabin",
		"source_field":    fieldNameFamilyCampCabin,
		"year":            2026,
		"household_cm_id": parties[0].HouseholdCMID,
		"is_resolved":     true,
	})

	if _, err := ReplayIssue(app, unrelatedID); err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}

	got, err := app.FindRecordById("lodging_ingest_issues", ignoredID)
	if err != nil {
		t.Fatalf("reloading the ignored issue: %v", err)
	}
	if !got.GetBool("is_resolved") {
		t.Error("an unrelated party-scoped replay reopened an ignored row it " +
			"only shares a collapsed dedup key with")
	}
}

// placed counts PLACEMENTS, not parties. Returning the party count instead
// would report "placed 2" for a click that wrote one assignment and left a
// household in the queue.
func TestReplayPartylessIssueCountsOnlyThePartiesItPlaced(t *testing.T) {
	app := newLodgingTestApp(t)
	_, _, _, parties := seedFanOutWithOneAmbiguousHousehold(t, app, "Ridge Cabin 9")
	addAlias(t, app, "Ridge Cabin 9", []string{addUnit(t, app, "ridge-9")}, 0, 0)

	id := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "Ridge Cabin 9",
		"source_field": fieldNameFamilyCampCabin,
		"year":         2025,
		"is_resolved":  true,
	})

	placed, err := ReplayPartylessIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayPartylessIssue: %v", err)
	}
	if placed != 1 {
		t.Errorf("placed = %d, want 1 -- the second household is still ambiguous", placed)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1", len(rows))
	}
	if rows[0].GetInt("household_cm_id") != parties[0].HouseholdCMID {
		t.Errorf("the placed household is %d, want the unambiguous one %d",
			rows[0].GetInt("household_cm_id"), parties[0].HouseholdCMID)
	}

	// The blocked party gets its own row, carrying its own party -- unlike the
	// alias row it came from, an attribution failure IS specific to one household.
	blocked, err := app.FindRecordsByFilter("lodging_ingest_issues",
		"kind = {:kind}", "", 0, 0, map[string]any{"kind": issueAmbiguousSession})
	if err != nil {
		t.Fatalf("looking up the new row: %v", err)
	}
	if len(blocked) != 1 {
		t.Fatalf("ambiguous_session rows = %d, want 1 carrying the remaining work", len(blocked))
	}
	if blocked[0].GetInt("household_cm_id") != parties[1].HouseholdCMID {
		t.Errorf("the blocked row names household %d, want %d",
			blocked[0].GetInt("household_cm_id"), parties[1].HouseholdCMID)
	}
	if blocked[0].GetBool("is_resolved") {
		t.Error("the new blocker was created already ticked; nothing would surface it")
	}

	// The alias really was created, so the clicked row's own blocker is gone.
	clicked, _ := app.FindRecordById("lodging_ingest_issues", id)
	if !clicked.GetBool("is_resolved") {
		t.Error("the unresolved_alias row was re-opened, but the string resolves now; " +
			"staff would go looking for a mapping that already exists")
	}
}

// The other half of the re-open rule: a household the fan-out never reached
// keeps its tick, even though its row names this same string.
//
// Scope, stated honestly: this does NOT discriminate a party-blind re-open
// lookup, though the shape invites the reading. Probed -- with the party
// columns dropped from reopenRecorded's filter both rows here still match, and
// a party-blind filter is a left prefix of idx_lodging_issues_dedup, so the
// scan comes back ordered by household_cm_id and the stranger at 9003 sorts
// AFTER the recorded party at 9002; the blind lookup gets the right row by
// accident of index order. TestReplayPartylessIssueReopensEveryBlockedPartysRow
// is the case that does discriminate, and
// TestFindExistingMatchesOnTheWholeDedupTuple pins the lookup itself.
func TestReplayPartylessIssueLeavesAnotherHouseholdsTickedRowAlone(t *testing.T) {
	app := newLodgingTestApp(t)
	_, _, _, parties := seedFanOutWithOneAmbiguousHousehold(t, app, "Ridge Cabin 9")
	addAlias(t, app, "Ridge Cabin 9", []string{addUnit(t, app, "ridge-9")}, 0, 0)

	// A third household worked and ticked its own ambiguous_session row for this
	// same string in an earlier season's shape. It no longer writes the value, so
	// the fan-out never reaches it -- and it is seeded first, so a lookup that
	// ignored the party would find IT rather than the row this pass records.
	stranger := seedIssue(t, app, map[string]any{
		"kind":            issueAmbiguousSession,
		"raw_value":       "Ridge Cabin 9",
		"source_field":    fieldNameFamilyCampCabin,
		"year":            2025,
		"is_resolved":     true,
		"household_cm_id": 9003,
	})

	id := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "Ridge Cabin 9",
		"source_field": fieldNameFamilyCampCabin,
		"year":         2025,
		"is_resolved":  true,
	})

	if _, err := ReplayPartylessIssue(app, id); err != nil {
		t.Fatalf("ReplayPartylessIssue: %v", err)
	}

	untouched, err := app.FindRecordById("lodging_ingest_issues", stranger)
	if err != nil {
		t.Fatalf("reloading the other household's row: %v", err)
	}
	if !untouched.GetBool("is_resolved") {
		t.Error("household 9003's ticked row was re-opened, but 9003 does not write " +
			"this string and was never replayed; the re-open matched on kind alone")
	}

	blocked, err := app.FindRecordsByFilter("lodging_ingest_issues",
		"kind = {:kind} && household_cm_id = {:hh}", "", 0, 0,
		map[string]any{"kind": issueAmbiguousSession, "hh": parties[1].HouseholdCMID})
	if err != nil {
		t.Fatalf("looking up the blocked household's row: %v", err)
	}
	if len(blocked) != 1 {
		t.Fatalf("rows for the blocked household = %d, want 1", len(blocked))
	}
	if blocked[0].GetBool("is_resolved") {
		t.Error("the blocked household's row is ticked; its work would surface nowhere")
	}
}

// The party dimension of the re-open lookup, and the first case that can
// discriminate it.
//
// Two households wrote the string and BOTH are blocked on attribution, so
// reopenRecorded holds two recorded items whose dedup tuples differ in nothing
// but the party. A party-blind findExisting is LIMIT 1, so it returns the SAME
// row for both: the first call un-ticks it, and the second finds that row
// already open and takes the `if !row.GetBool("is_resolved") { continue }`
// early-out. Exactly one row ends open where the rule requires two -- and that
// holds whichever of the two the scan returns first, which is what makes this
// order-independent where a stranger row is not.
func TestReplayPartylessIssueReopensEveryBlockedPartysRow(t *testing.T) {
	app := newLodgingTestApp(t)
	_, parties := seedTwoHouseholdsSharingACabinString(t, app, "Ridge Cabin 9", 2025)
	// The string resolves, so the alias row's own blocker is genuinely gone and
	// the only thing this pass can record is the two attribution failures.
	addAlias(t, app, "Ridge Cabin 9", []string{addUnit(t, app, "ridge-9")}, 0, 0)

	// Both households attend a second weekend, so CampMinder's single value for
	// the year cannot say which one it describes -- for either of them.
	second := addSession(t, app, cmIDFamilyCamp6, "Family Camp 6", "family",
		"2025-09-18 07:00:00.000Z", "2025-09-21 07:00:00.000Z", 2025)
	for _, p := range parties {
		addAttendee(t, app, p.PersonPBID, second, p.PersonCMID, 2, 2025)
	}

	// Staff worked and ticked both blockers before clicking the alias row.
	ticked := make([]string, 0, len(parties))
	for _, p := range parties {
		ticked = append(ticked, seedIssue(t, app, map[string]any{
			"kind":            issueAmbiguousSession,
			"raw_value":       "Ridge Cabin 9",
			"source_field":    fieldNameFamilyCampCabin,
			"year":            2025,
			"is_resolved":     true,
			"household_cm_id": p.HouseholdCMID,
		}))
	}

	id := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "Ridge Cabin 9",
		"source_field": fieldNameFamilyCampCabin,
		"year":         2025,
		"is_resolved":  true,
	})

	placed, err := ReplayPartylessIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayPartylessIssue: %v", err)
	}
	if placed != 0 {
		t.Errorf("placed = %d, want 0 -- both households are ambiguous", placed)
	}

	for i, rowID := range ticked {
		row, findErr := app.FindRecordById("lodging_ingest_issues", rowID)
		if findErr != nil {
			t.Fatalf("reloading household %d's row: %v", parties[i].HouseholdCMID, findErr)
		}
		if row.GetBool("is_resolved") {
			t.Errorf("household %d's row is still ticked after the pass re-hit it; "+
				"the re-open matched on something coarser than the party",
				parties[i].HouseholdCMID)
		}
	}

	// The alias row's own blocker really is gone, so it stays ticked.
	clicked, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the clicked row: %v", err)
	}
	if !clicked.GetBool("is_resolved") {
		t.Error("the unresolved_alias row was re-opened, but the string resolves now")
	}
}

// Each party is attributed with the timestamp on ITS OWN value row, never with
// now.
//
// AttributeSession walks the candidates for the first weekend starting on or
// after the observation and otherwise falls through to the LAST one. For a past
// season now is after every window, so attributing with it rewrites
// suggested_session -- the one-click confirmation the queue offers staff -- to
// the final weekend of the year. Flush overwrites a non-empty suggestion, so
// the damage lands in the database.
func TestReplayPartylessIssueAttributesWithTheObservationTimestamp(t *testing.T) {
	app := newLodgingTestApp(t)
	_, second, third, _ := seedFanOutWithOneAmbiguousHousehold(t, app, "Ridge Cabin 9")
	addAlias(t, app, "Ridge Cabin 9", []string{addUnit(t, app, "ridge-9")}, 0, 0)

	id := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "Ridge Cabin 9",
		"source_field": fieldNameFamilyCampCabin,
		"year":         2025,
		"is_resolved":  true,
	})

	if _, err := ReplayPartylessIssue(app, id); err != nil {
		t.Fatalf("ReplayPartylessIssue: %v", err)
	}

	rows, err := app.FindRecordsByFilter("lodging_ingest_issues",
		"kind = {:kind}", "", 0, 0, map[string]any{"kind": issueAmbiguousSession})
	if err != nil {
		t.Fatalf("looking up the ambiguous row: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("ambiguous_session rows = %d, want 1", len(rows))
	}
	switch rows[0].GetString("suggested_session") {
	case second: // the sync's answer: the first weekend starting after the edit
	case third:
		t.Error("suggested_session is the LAST weekend of the year: the fan-out " +
			"attributed with now instead of the party's own observation timestamp")
	default:
		t.Errorf("suggested_session = %q, want the second weekend %q",
			rows[0].GetString("suggested_session"), second)
	}
}

// The person grain reads a different table through a different field, so the
// source field on the row -- not a guess -- has to pick it. A fan-out that
// always read household_custom_values would find nobody here and report a
// successful replay of nothing.
func TestReplayPartylessIssueFansOutAcrossThePersonGrain(t *testing.T) {
	app := newLodgingTestApp(t)
	womens := addSession(t, app, cmIDWomensWeekend, "Women's Weekend", "adult",
		testAdultSessionStart, testAdultSessionEnd, 2025)
	unitID := addUnit(t, app, "river-c")
	addAlias(t, app, "River C", []string{unitID}, 0, 0)
	def := addFieldDef(t, app, cmIDReportableFamilyCampCabin, fieldNameReportableFamilyCampCabin)

	hh := addHousehold(t, app, 9001, 2025)
	for _, personCMID := range []int{5001, 5002} {
		person := addPerson(t, app, personCMID, 9001, 2025, hh)
		addAttendee(t, app, person, womens, personCMID, 2, 2025)
		addPersonValue(t, app, person, def, "River C", testLastUpdated, 2025)
	}

	id := seedIssue(t, app, map[string]any{
		"kind":         issueUnresolvedAlias,
		"raw_value":    "River C",
		"source_field": fieldNameReportableFamilyCampCabin,
		"year":         2025,
		"is_resolved":  true,
	})

	placed, err := ReplayPartylessIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayPartylessIssue: %v", err)
	}
	if placed != 2 {
		t.Errorf("placed = %d, want 2 -- one per person who wrote the string", placed)
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "person_cm_id", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("assignments = %d, want 2", len(rows))
	}
	for i, want := range []int{5001, 5002} {
		if rows[i].GetInt("person_cm_id") != want {
			t.Errorf("assignment %d person_cm_id = %d, want %d", i, rows[i].GetInt("person_cm_id"), want)
		}
		if rows[i].GetInt("household_cm_id") != 0 {
			t.Errorf("assignment %d household_cm_id = %d, want 0 on the person grain",
				i, rows[i].GetInt("household_cm_id"))
		}
		if rows[i].GetString("session") != womens {
			t.Errorf("assignment %d session = %q, want the adult weekend %q",
				i, rows[i].GetString("session"), womens)
		}
	}
}
