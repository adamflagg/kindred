package sync

import (
	"context"
	"strings"
	"testing"

	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestStrandedAssignmentCleanupDryRunLeavesDraftUntouched proves both of
// reconcileStrandedAssignments' write sites are gated (kindred#2351): a
// draft that a wet run would null out survives a dry run byte-for-byte, and
// Stats.Updated still reports what WOULD have been swept so an operator's
// preview is accurate.
//
// reconcileStrandedAssignments is one of TWO functions StrandedAssignmentCleanupSync's
// DryRun guards -- see TestStrandedAssignmentCleanupDryRunLeavesLodgingDraftUntouched below
// for the second, reconcileLodgingOrphans' units write.
//
// Deliberately a new file rather than an addition to
// stranded_assignment_cleanup_test.go: that file's fixtures are being
// rewritten in a parallel branch (kindred#2300), so this test borrows its
// setupStrandedCollections/saveRec/addLodgingSession/addLodgingUnit helpers
// rather than editing it.
func TestStrandedAssignmentCleanupDryRunLeavesDraftUntouched(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	keptBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	goneBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "G-5", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	keptPlan := saveRec(t, app, "bunk_plans", map[string]any{"bunk": keptBunk.Id, "session": sess.Id, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": goneBunk.Id, "bunk_plan": keptPlan.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	svc.SetDryRun(true)
	if syncErr := svc.Sync(context.Background()); syncErr != nil {
		t.Fatalf("Sync: %v", syncErr)
	}

	got, err := app.FindRecordById("bunk_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if got.GetString("bunk") != goneBunk.Id {
		t.Errorf("dry run cleared bunk: got %q, want unchanged %q", got.GetString("bunk"), goneBunk.Id)
	}
	if got.GetString("bunk_plan") != keptPlan.Id {
		t.Errorf("dry run cleared bunk_plan: got %q, want unchanged %q", got.GetString("bunk_plan"), keptPlan.Id)
	}

	stats := svc.GetStats()
	if stats.Updated != 1 {
		t.Errorf("Stats.Updated = %d, want 1 (the sweep that would have happened)", stats.Updated)
	}
}

// TestStrandedAssignmentCleanupDryRunLeavesLodgingDraftUntouched proves the second of
// StrandedAssignmentCleanupSync's two write sites is gated: reconcileLodgingOrphans' `units`
// clear on a lodging_assignments_draft row for a household no longer enrolled (kindred#2028's
// weekend twin of the bunk sweep above). Fixture mirrors
// TestStrandedAssignmentCleanup_SweepsLodgingEnrollmentOrphanDraftHousehold in
// stranded_assignment_cleanup_test.go, the wet-run test that proves this same household would
// actually be swept -- this one proves a dry run leaves it alone.
func TestStrandedAssignmentCleanupDryRunLeavesLodgingDraftUntouched(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := addLodgingSession(t, app, 100, "family", 2026)
	unit := addLodgingUnit(t, app, "ridge-a")
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})

	cancelled := saveRec(t, app, "persons", map[string]any{"cm_id": 9001, "household_id": 5001, "year": 2026})
	enrolledPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 9002, "household_id": 5002, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{
		"person": cancelled.Id, "person_id": 9001, "session": sess.Id, "status_id": 32, "year": 2026,
	})
	// Keeps the session's enrolled set non-empty so the per-session guard passes.
	saveRec(t, app, "attendees", map[string]any{
		"person": enrolledPerson.Id, "person_id": 9002, "session": sess.Id, "status_id": 2, "year": 2026,
	})

	draft := saveRec(t, app, "lodging_assignments_draft", map[string]any{
		"session": sess.Id, "session_cm_id": 100, "year": 2026, "scenario": scenario.Id,
		"units": []string{unit.Id}, "household_cm_id": 5001, "source": "campminder_sync", "staff_touched": false,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	svc.SetDryRun(true)
	if syncErr := svc.Sync(context.Background()); syncErr != nil {
		t.Fatalf("Sync: %v", syncErr)
	}

	got, err := app.FindRecordById("lodging_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if len(got.GetStringSlice("units")) == 0 {
		t.Errorf("dry run cleared units for a cancelled household: got %v, want unchanged [%s]",
			got.GetStringSlice("units"), unit.Id)
	}

	stats := svc.GetStats()
	if stats.Updated != 1 {
		t.Errorf("Stats.Updated = %d, want 1 (the lodging sweep that would have happened)", stats.Updated)
	}
}

// TestStrandedAssignmentCleanupDryRunLodgingLogReportsSimulatedSweep proves
// reconcileLodgingOrphans' completion log tells an operator what a dry run
// WOULD sweep, not what it actually wrote (CodeRabbit finding on #2386):
// the log line's "drafts_swept" field used to read the local `writes`
// counter, which only increments on a real `app.Save`, so a dry run always
// logged `drafts_swept=0` even when `orphaned_drafts` was nonzero --
// silently contradicting the very household this test seeds as an orphan.
// reconcileStrandedAssignments' sibling log line (the bunk sweep, a few
// lines up in this same file) already gets this right by logging
// stats.Updated instead -- but that field accumulates across BOTH
// reconcile passes sharing one Stats struct (Sync() calls
// reconcileStrandedAssignments then reconcileLodgingOrphans with the same
// &s.Stats), so copying that exact fix here would double-count the bunk
// sweep into the lodging log line. This test seeds only a lodging orphan
// (no bunk_plans, so the bunk pass sweeps nothing), isolating the two.
//
// Not t.Parallel(): captureSweepLogs swaps the process-global slog default
// (see main_test_parallelism_test.go's serialTests entry for this test).
func TestStrandedAssignmentCleanupDryRunLodgingLogReportsSimulatedSweep(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := addLodgingSession(t, app, 100, "family", 2026)
	unit := addLodgingUnit(t, app, "ridge-a")
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})

	cancelled := saveRec(t, app, "persons", map[string]any{"cm_id": 9001, "household_id": 5001, "year": 2026})
	enrolledPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 9002, "household_id": 5002, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{
		"person": cancelled.Id, "person_id": 9001, "session": sess.Id, "status_id": 32, "year": 2026,
	})
	saveRec(t, app, "attendees", map[string]any{
		"person": enrolledPerson.Id, "person_id": 9002, "session": sess.Id, "status_id": 2, "year": 2026,
	})
	saveRec(t, app, "lodging_assignments_draft", map[string]any{
		"session": sess.Id, "session_cm_id": 100, "year": 2026, "scenario": scenario.Id,
		"units": []string{unit.Id}, "household_cm_id": 5001, "source": "campminder_sync", "staff_touched": false,
	})

	buf := captureSweepLogs(t)

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	svc.SetDryRun(true)
	if syncErr := svc.Sync(context.Background()); syncErr != nil {
		t.Fatalf("Sync: %v", syncErr)
	}

	logs := buf.String()
	if !strings.Contains(logs, "stranded_assignment_cleanup lodging pass complete") {
		t.Fatalf("lodging completion log not found; got:\n%s", logs)
	}
	if strings.Contains(logs, "drafts_swept=0") {
		t.Errorf("dry run logged drafts_swept=0 despite one simulated lodging sweep; got:\n%s", logs)
	}
	if !strings.Contains(logs, "drafts_swept=1") {
		t.Errorf("want drafts_swept=1 (the simulated sweep an operator would act on); got:\n%s", logs)
	}
}
