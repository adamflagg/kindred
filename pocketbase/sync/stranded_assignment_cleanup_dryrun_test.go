package sync

import (
	"context"
	"testing"

	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestStrandedAssignmentCleanupDryRunLeavesDraftUntouched proves both of
// reconcileStrandedAssignments' write sites are gated (kindred#2351): a
// draft that a wet run would null out survives a dry run byte-for-byte, and
// Stats.Updated still reports what WOULD have been swept so an operator's
// preview is accurate.
//
// Deliberately a new file rather than an addition to
// stranded_assignment_cleanup_test.go: that file's fixtures are being
// rewritten in a parallel branch (kindred#2300), so this test borrows its
// setupStrandedCollections/saveRec helpers rather than editing it.
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
