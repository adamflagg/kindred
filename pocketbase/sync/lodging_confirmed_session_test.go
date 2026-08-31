package sync

import (
	"context"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// cmIDFamilyCamp2 is a weekend that EXISTS in these fixtures but that household
// 9001 never enrolls in. Every "not a candidate" case below confirms against a
// real session rather than an invented number, so the test proves the check is
// membership of Candidates and not merely "the id resolves to a session".
const cmIDFamilyCamp2 = 1309515

// addNonCandidateWeekend adds a real family weekend nobody in these fixtures
// attends, so a confirmation can name it.
func addNonCandidateWeekend(t *testing.T, app core.App) string {
	t.Helper()
	return addSession(t, app, cmIDFamilyCamp2, "Family Camp 2", "family",
		"2025-06-20 07:00:00.000Z", "2025-06-23 07:00:00.000Z", 2025)
}

// seedConfirmedIssue writes the queue row staff have confirmed: the ambiguity
// the sync recorded, ticked, and stamped with the weekend a human picked.
func seedConfirmedIssue(t *testing.T, app core.App, confirmedCMID int) string {
	t.Helper()
	return seedIssue(t, app, map[string]any{
		"kind":                    issueAmbiguousSession,
		"raw_value":               "Ridge A",
		"source_field":            fieldNameFamilyCampCabin,
		"year":                    2025,
		"is_resolved":             true,
		"household_cm_id":         9001,
		"confirmed_session_cm_id": confirmedCMID,
		"occurrences":             1,
	})
}

// The point of the feature: a confirmed weekend places the household through
// the sync's own transform path.
//
// The confirmation names the FIRST weekend deliberately. AttributeSession's
// advisory BestGuess for this fixture is the SECOND (the value was edited
// 10 June, between the first and second weekends), and its fall-through answer
// is the LAST. Confirming the first therefore cannot be produced by either
// branch of the heuristic -- only by honouring the human's choice.
func TestIngestPlacesTheConfirmedWeekend(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	first, _, _ := seedThreeWeekendHousehold(t, app,
		"Ridge A", "2025-06-10T09:00:00.0000000+00:00")
	seedConfirmedIssue(t, app, cmIDFamilyCamp1)

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
		t.Fatalf("assignments = %d, want 1 placed by the confirmation", len(rows))
	}
	if rows[0].GetString("session") != first {
		t.Errorf("session = %q, want the confirmed first weekend %q",
			rows[0].GetString("session"), first)
	}
	if rows[0].GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Errorf("session_cm_id = %d, want %d",
			rows[0].GetInt("session_cm_id"), cmIDFamilyCamp1)
	}
	if rows[0].GetString("source") != sourceCampMinderSync {
		t.Errorf("source = %q, want %q -- a confirmation must write through the "+
			"transform path, not as a hand-stamped row",
			rows[0].GetString("source"), sourceCampMinderSync)
	}
}

// GUARD 1. The stored number is never trusted on its own: it is resolved
// against the party's own Candidates, and a miss leaves the row unplaced.
//
// Two independent reasons this must hold, either of which alone would justify
// it. Attribution.SessionCMID() resolves the CampMinder id by scanning
// Candidates and returns 0 for a non-member, and session_cm_id is required by
// migration 1500000124 -- so a non-candidate confirmation would fail inside
// upsertAssignment rather than place anything. And Candidates IS the household's
// slice of the session index the orphan sweep reads, so staying inside it is
// what makes the write key and the orphan key agree (see the sweep test below).
func TestIngestRefusesAConfirmedWeekendThatIsNotACandidate(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	seedThreeWeekendHousehold(t, app, "Ridge A", "2025-06-10T09:00:00.0000000+00:00")
	addNonCandidateWeekend(t, app)
	seedConfirmedIssue(t, app, cmIDFamilyCamp2)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("assignments = %d, want 0 -- a weekend the household does not "+
			"attend is not a placement staff confirmed", len(rows))
	}

	issues, err := app.FindRecordsByFilter("lodging_ingest_issues", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find issues: %v", err)
	}
	if len(issues) != 1 || issues[0].GetString("kind") != issueAmbiguousSession {
		t.Fatalf("issues = %d, want the one ambiguous_session row still standing",
			len(issues))
	}
}

// GUARD 2, the measured failure class (kindred#2626 / #2641): a widened write
// key whose orphan key did not move deleted the very rows the widening created,
// and the run reported SUCCESS.
//
// Agreement holds here by construction -- the confirmed session comes out of
// Candidates, which IS sessionIndex[householdCMID], the same index
// deleteLodgingOrphans reads -- but "by construction" is exactly what #2626
// also believed, so it is pinned rather than argued.
//
// deleteLodgingOrphans is hand-rolled and is NOT a DeleteOrphansGuarded caller,
// so it inherits none of that helper's protections; this is the only thing
// standing between a confirmed placement and its own sweep.
//
// The decoy row is load-bearing. Without a placement the sweep MUST delete, a
// green here is indistinguishable from a sweep that never ran: the year gate
// skips it unless ActiveSeasonYear matches, and Stats.Deleted == 0 reads the
// same either way.
func TestConfirmedPlacementSurvivesItsOwnOrphanSweep(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	first, _, _ := seedThreeWeekendHousehold(t, app,
		"Ridge A", "2025-06-10T09:00:00.0000000+00:00")
	seedConfirmedIssue(t, app, cmIDFamilyCamp1)

	// A genuinely orphaned mirror row: household 9100 holds a placement on a
	// weekend it is not enrolled in. The sweep must take this one, which is what
	// proves the sweep ran at all.
	unit := addUnit(t, app, "ridge-c", 2025)
	decoy := saveRecord(t, app, "lodging_assignments", map[string]any{
		"session":         first,
		"session_cm_id":   cmIDFamilyCamp1,
		"year":            2025,
		"household_cm_id": 9100,
		"units":           []string{unit},
		"source":          sourceCampMinderSync,
	})

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	s.ActiveSeasonYear = 2025 // so the sweep is not skipped by the year gate
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", decoy); err == nil {
		t.Fatal("the decoy orphan survived -- the sweep did not run, so this test " +
			"proves nothing about write-key/orphan-key agreement")
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 1 || rows[0].GetInt("household_cm_id") != 9001 {
		t.Fatalf("assignments = %d, want the confirmed household's row alone -- "+
			"the sweep deleted the row the confirmation had just written", len(rows))
	}
	if rows[0].GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Errorf("session_cm_id = %d, want %d",
			rows[0].GetInt("session_cm_id"), cmIDFamilyCamp1)
	}

	// A second run: the row must be found, not re-created, and never swept.
	s2 := NewLodgingAssignmentsSync(app)
	s2.Year = 2025
	s2.ActiveSeasonYear = 2025
	if err := s2.Sync(context.Background()); err != nil {
		t.Fatalf("second Sync: %v", err)
	}
	if s2.Stats.Deleted != 0 {
		t.Errorf("second run deleted %d rows, want 0", s2.Stats.Deleted)
	}
	rows, err = app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments after the second run: %v", err)
	}
	if len(rows) != 1 || rows[0].GetInt("session_cm_id") != cmIDFamilyCamp1 {
		t.Fatalf("assignments after a re-sync = %d, want the same single confirmed row",
			len(rows))
	}
}

// GUARD 3. IssueRecorder.Flush sets occurrences, last_seen and -- conditionally
// -- suggested_session/candidate_session_cm_ids, and deliberately never
// is_resolved, resolution_note or resolved_alias, so a later sync cannot un-tick
// staff work. confirmed_session_cm_id belongs to that second list.
//
// Written against the non-candidate case on purpose: it is the one shape where
// the sync is guaranteed to re-record the ambiguity and so guaranteed to make
// Flush write to the very row holding the confirmation.
func TestFlushNeverOverwritesTheConfirmedWeekend(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	seedThreeWeekendHousehold(t, app, "Ridge A", "2025-06-10T09:00:00.0000000+00:00")
	addNonCandidateWeekend(t, app)
	id := seedConfirmedIssue(t, app, cmIDFamilyCamp2)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2025
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	row, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the queue row: %v", err)
	}
	if row.GetInt("confirmed_session_cm_id") != cmIDFamilyCamp2 {
		t.Errorf("confirmed_session_cm_id = %d, want %d left alone -- a sync must "+
			"not overwrite the weekend a human picked",
			row.GetInt("confirmed_session_cm_id"), cmIDFamilyCamp2)
	}
	if !row.GetBool("is_resolved") {
		t.Error("is_resolved was un-ticked by a re-sync")
	}
	// Flush did touch this row, which is what makes the assertions above mean
	// something: last_seen moves on every run.
	if row.GetString("last_seen") == "" {
		t.Error("Flush never reached this row, so it cannot have been protected from it")
	}
}

// GUARD 4, end to end. Without the confirmation, ticking a row does the OPPOSITE
// of what staff intend: replayOnResolve fires on the false -> true transition,
// ReplayIssue re-hits the same ambiguity, Flush re-records it and
// reopenRecorded flips is_resolved back to false. The confirmation is what makes
// the replay succeed.
//
// ReplayIssue is called directly rather than through the hook because the hook
// is a two-line router already pinned by lodging/hooks_test.go, while the
// placement it routes to needs the full sync schema this package's fixture
// builds.
func TestReplayIssuePlacesTheConfirmedWeekend(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	first, _, _ := seedThreeWeekendHousehold(t, app,
		"Ridge A", "2025-06-10T09:00:00.0000000+00:00")
	id := seedConfirmedIssue(t, app, cmIDFamilyCamp1)

	res, err := ReplayIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}
	if !res.Placed || len(res.Blockers) != 0 {
		t.Fatalf("result = %+v, want Placed with no blockers", res)
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("assignments = %d, want 1 written by the confirmed replay", len(rows))
	}
	if rows[0].GetString("session") != first {
		t.Errorf("session = %q, want the confirmed weekend %q",
			rows[0].GetString("session"), first)
	}

	row, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the queue row: %v", err)
	}
	if !row.GetBool("is_resolved") {
		t.Error("the row was re-opened after a replay that placed the value -- " +
			"reopenRecorded fired, so ingestValue recorded a blocker it should not have")
	}
}

// GUARD 1 on the replay path. A confirmation the party's candidates do not
// contain places nothing AND leaves the queue item open, which is the honest
// outcome: staff picked a weekend this household is no longer attending, and a
// ticked row with no placement behind it is the log-not-a-work-queue failure
// lodging_replay.go exists to remove.
func TestReplayIssueReopensARowWhoseConfirmationIsNotACandidate(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	seedThreeWeekendHousehold(t, app, "Ridge A", "2025-06-10T09:00:00.0000000+00:00")
	addNonCandidateWeekend(t, app)
	id := seedConfirmedIssue(t, app, cmIDFamilyCamp2)

	res, err := ReplayIssue(app, id)
	if err != nil {
		t.Fatalf("ReplayIssue: %v", err)
	}
	if res.Placed {
		t.Fatal("a confirmation naming a weekend the household does not attend was placed")
	}
	if !slices.Contains(res.Blockers, issueAmbiguousSession) {
		t.Errorf("blockers = %v, want the ambiguity still reported", res.Blockers)
	}

	rows, err := app.FindRecordsByFilter("lodging_assignments", "", "", 0, 0)
	if err != nil {
		t.Fatalf("find assignments: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("assignments = %d, want 0", len(rows))
	}

	row, err := app.FindRecordById("lodging_ingest_issues", id)
	if err != nil {
		t.Fatalf("reloading the queue row: %v", err)
	}
	if row.GetBool("is_resolved") {
		t.Error("the row stayed ticked with no placement behind it")
	}
}
