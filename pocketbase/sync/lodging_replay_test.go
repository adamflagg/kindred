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

	err := ReplayIssue(app, id)
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

	if err := ReplayIssue(app, id); err == nil {
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

	if err := ReplayIssue(app, id); err == nil {
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

	if err := ReplayIssue(app, id); err != nil {
		t.Fatalf("ReplayIssue: %v", err)
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

	if err := ReplayIssue(app, id); err != nil {
		t.Fatalf("ReplayIssue: %v", err)
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

	if err := ReplayIssue(app, id); err != nil {
		t.Fatalf("ReplayIssue: %v", err)
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

// A repair that did not in fact repair anything must leave the queue honest:
// the row is still illegal, so it is re-queued rather than silently dropped.
func TestReplayIssueRequeuesAStillIllegalMerge(t *testing.T) {
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

	if err := ReplayIssue(app, id); err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}

	rows, _ := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if len(rows) != 0 {
		t.Errorf("assignments = %d, want 0; an illegal merge places nothing", len(rows))
	}
	// Flush upserts onto the same dedup key, so the row staff already ticked is
	// the row that gets its last_seen refreshed -- no second copy appears.
	issues, _ := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if len(issues) != 1 {
		t.Fatalf("queue rows = %d, want 1 (the same row, re-observed)", len(issues))
	}
	if issues[0].Id != id {
		t.Errorf("replay queued a NEW row %q instead of updating %q", issues[0].Id, id)
	}
}
