package sync

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

func TestFindStrandedAssignments(t *testing.T) {
	validPairs := map[string]bool{
		strandedPairKey("sess1", "bunkA"): true,
		strandedPairKey("sess1", "bunkB"): true,
	}
	// Only sess1 has bunk_plans; sess2 has none (its plans failed to sync).
	plannedSessions := map[string]bool{"sess1": true}
	candidates := []strandedCandidate{
		{RecordID: "r1", SessionID: "sess1", BunkID: "bunkA"}, // valid pair - kept
		{RecordID: "r2", SessionID: "sess1", BunkID: "bunkZ"}, // stranded - bunk not planned
		{RecordID: "r3", SessionID: "sess1", BunkID: ""},      // no bunk - skipped
		{RecordID: "r4", SessionID: "sess2", BunkID: "bunkA"}, // session has zero plans - skipped
	}

	stranded := findStrandedAssignments(validPairs, plannedSessions, candidates)

	if len(stranded) != 1 {
		t.Fatalf("want 1 stranded, got %d: %+v", len(stranded), stranded)
	}
	if stranded[0].RecordID != "r2" {
		t.Errorf("want [r2], got [%s]", stranded[0].RecordID)
	}
}

// setupStrandedCollections builds the minimal schema the reconciler touches.
func setupStrandedCollections(t *testing.T, app core.App) {
	t.Helper()

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	bunks := core.NewBaseCollection("bunks")
	bunks.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	bunks.Fields.Add(&core.TextField{Name: "name"})
	bunks.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(bunks); err != nil {
		t.Fatalf("create bunks: %v", err)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	plans := core.NewBaseCollection("bunk_plans")
	plans.Fields.Add(&core.RelationField{Name: "bunk", CollectionId: bunks.Id, MaxSelect: 1})
	plans.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	plans.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(plans); err != nil {
		t.Fatalf("create bunk_plans: %v", err)
	}

	scenarios := core.NewBaseCollection("saved_scenarios")
	scenarios.Fields.Add(&core.TextField{Name: "name"})
	scenarios.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	scenarios.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(scenarios); err != nil {
		t.Fatalf("create saved_scenarios: %v", err)
	}

	drafts := core.NewBaseCollection("bunk_assignments_draft")
	drafts.Fields.Add(&core.RelationField{Name: "scenario", CollectionId: scenarios.Id, MaxSelect: 1})
	drafts.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	drafts.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	drafts.Fields.Add(&core.RelationField{Name: "bunk", CollectionId: bunks.Id, MaxSelect: 1})
	drafts.Fields.Add(&core.RelationField{Name: "bunk_plan", CollectionId: plans.Id, MaxSelect: 1})
	drafts.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(drafts); err != nil {
		t.Fatalf("create bunk_assignments_draft: %v", err)
	}

	prod := core.NewBaseCollection("bunk_assignments")
	prod.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	prod.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	prod.Fields.Add(&core.RelationField{Name: "bunk", CollectionId: bunks.Id, MaxSelect: 1})
	prod.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(prod); err != nil {
		t.Fatalf("create bunk_assignments: %v", err)
	}
}

func saveRec(t *testing.T, app core.App, collection string, data map[string]any) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find %s: %v", collection, err)
	}
	r := core.NewRecord(col)
	for k, v := range data {
		r.Set(k, v)
	}
	if err := app.Save(r); err != nil {
		t.Fatalf("save %s: %v", collection, err)
	}
	return r
}

func TestStrandedAssignmentCleanup_SweepsStrandedDraft(t *testing.T) {
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
	// Only keptBunk has a plan for the session.
	keptPlan := saveRec(t, app, "bunk_plans", map[string]any{"bunk": keptBunk.Id, "session": sess.Id, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	// Draft assigned to the now-planless bunk, with a (now stale) bunk_plan ref.
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": goneBunk.Id, "bunk_plan": keptPlan.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("bunk_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if got.GetString("bunk") != "" {
		t.Errorf("want bunk cleared, got %q", got.GetString("bunk"))
	}
	if got.GetString("bunk_plan") != "" {
		t.Errorf("want bunk_plan cleared, got %q", got.GetString("bunk_plan"))
	}
}

func TestStrandedAssignmentCleanup_GateSkipsWhenNoBunkPlans(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	// A draft exists, but NO bunk_plans rows at all for the year.
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": bunk.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	// Gate must have skipped: the draft must be untouched.
	got, err := app.FindRecordById("bunk_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if got.GetString("bunk") != bunk.Id {
		t.Errorf("gate failed — draft was swept despite zero bunk_plans (bunk=%q)", got.GetString("bunk"))
	}
}

func TestStrandedAssignmentCleanup_GateSkipsPerSession(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	// Session A has a bunk_plan; session B has none (its plans failed to sync).
	// The global gate passes because plans exist overall — only the per-session
	// gate protects session B's drafts.
	sessA := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	sessB := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 200, "year": 2026})
	bunkA := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "A-1", "year": 2026})
	bunkB := saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "B-1", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": bunkA.Id, "session": sessA.Id, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sessB.Id, "year": 2026})
	// A draft in session B, which has zero bunk_plans. It must NOT be swept —
	// session B's empty plan set is unreliable, not authoritative.
	draftB := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sessB.Id,
		"bunk": bunkB.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("bunk_assignments_draft", draftB.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if got.GetString("bunk") != bunkB.Id {
		t.Errorf("per-session gate failed — session-B draft swept despite session B having zero bunk_plans (bunk=%q)",
			got.GetString("bunk"))
	}
}

func TestStrandedAssignmentCleanup_LeavesValidDraftUntouched(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	plan := saveRec(t, app, "bunk_plans", map[string]any{"bunk": bunk.Id, "session": sess.Id, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": bunk.Id, "bunk_plan": plan.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("bunk_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if got.GetString("bunk") != bunk.Id {
		t.Errorf("valid draft was swept — bunk=%q", got.GetString("bunk"))
	}
	if got.GetString("bunk_plan") != plan.Id {
		t.Errorf("valid draft's bunk_plan was modified — got %q", got.GetString("bunk_plan"))
	}
}

func TestStrandedAssignmentCleanup_ProdAuditDoesNotDelete(t *testing.T) {
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
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": keptBunk.Id, "session": sess.Id, "year": 2026})
	// A stranded PRODUCTION assignment.
	prodRow := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": sess.Id, "bunk": goneBunk.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	// Prod row must still exist and be untouched — reconciler only audits prod.
	got, err := app.FindRecordById("bunk_assignments", prodRow.Id)
	if err != nil {
		t.Fatalf("prod row was deleted/altered by the reconciler: %v", err)
	}
	if got.GetString("bunk") != goneBunk.Id {
		t.Errorf("prod row bunk was modified — got %q", got.GetString("bunk"))
	}
}

func TestStrandedAssignmentCleanup_Idempotent(t *testing.T) {
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
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": keptBunk.Id, "session": sess.Id, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": goneBunk.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync run 1: %v", err)
	}
	svc2 := NewStrandedAssignmentCleanupSync(app)
	svc2.SetYear(2026)
	if err = svc2.Sync(context.Background()); err != nil {
		t.Fatalf("Sync run 2: %v", err)
	}

	got, err := app.FindRecordById("bunk_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if got.GetString("bunk") != "" {
		t.Errorf("not idempotent — second run changed state: bunk=%q", got.GetString("bunk"))
	}
}

func TestStrandedAssignmentCleanup_ProdAuditWarnings(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	// otherBunk has a plan → session IS in plannedSessions
	otherBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": otherBunk.Id, "session": sess.Id, "year": 2026})
	// strandedBunk has no plan for this session → prod assignment is stranded
	strandedBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "G-5", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": sess.Id, "bunk": strandedBunk.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if svc.Stats.ProdAuditWarnings != 1 {
		t.Errorf("want ProdAuditWarnings=1, got %d", svc.Stats.ProdAuditWarnings)
	}
	// Prod assignment must NOT be cleared (observe-only).
	prods, err := app.FindRecordsByFilter("bunk_assignments", "year = 2026", "", 0, 0)
	if err != nil || len(prods) != 1 {
		t.Fatalf("prod assignment should still exist, got %d err=%v", len(prods), err)
	}
	if prods[0].GetString("bunk") != strandedBunk.Id {
		t.Errorf("prod assignment bunk must not be cleared (observe-only)")
	}
}

// TestStrandedAssignmentCleanup_ProdQueryErrorIsCountedNotFatal verifies that a failure
// querying production bunk_assignments is recorded in Stats.Errors — so
// WasSuccessful() reports false — but does NOT abort the run: the draft sweep
// that already succeeded must still stand.
func TestStrandedAssignmentCleanup_ProdQueryErrorIsCountedNotFatal(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	// Drop bunk_assignments so the production-audit query fails. The draft
	// sweep (bunk_assignments_draft) is unaffected.
	prodCol, err := app.FindCollectionByNameOrId("bunk_assignments")
	if err != nil {
		t.Fatalf("find bunk_assignments: %v", err)
	}
	if err = app.Delete(prodCol); err != nil {
		t.Fatalf("delete bunk_assignments: %v", err)
	}

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	keptBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	goneBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "G-5", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	// Only keptBunk has a plan for the session — the draft below is stranded.
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": keptBunk.Id, "session": sess.Id, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": goneBunk.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync must not return an error on a prod-query failure: %v", err)
	}

	// The draft sweep still ran despite the prod-query failure.
	got, err := app.FindRecordById("bunk_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if got.GetString("bunk") != "" {
		t.Errorf("stranded draft bunk should be cleared, got %q", got.GetString("bunk"))
	}

	// ...but the prod-query failure is recorded and surfaced.
	if svc.Stats.Errors == 0 {
		t.Error("Stats.Errors should be > 0 after a production-query failure")
	}
	if svc.WasSuccessful() {
		t.Error("WasSuccessful() should be false when Stats.Errors > 0")
	}
}
