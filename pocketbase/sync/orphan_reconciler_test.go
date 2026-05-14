package sync

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

func TestFindStrandedAssignments(t *testing.T) {
	validPairs := map[string]bool{
		orphanPairKey("sess1", "bunkA"): true,
		orphanPairKey("sess1", "bunkB"): true,
	}
	candidates := []orphanCandidate{
		{RecordID: "r1", SessionID: "sess1", BunkID: "bunkA"}, // valid
		{RecordID: "r2", SessionID: "sess1", BunkID: "bunkZ"}, // stranded
		{RecordID: "r3", SessionID: "sess1", BunkID: ""},      // no bunk - skipped
		{RecordID: "r4", SessionID: "sess2", BunkID: "bunkA"}, // stranded (wrong session)
	}

	stranded := findStrandedAssignments(validPairs, candidates)

	if len(stranded) != 2 {
		t.Fatalf("want 2 stranded, got %d: %+v", len(stranded), stranded)
	}
	if stranded[0].RecordID != "r2" || stranded[1].RecordID != "r4" {
		t.Errorf("want [r2 r4], got [%s %s]", stranded[0].RecordID, stranded[1].RecordID)
	}
}

// setupOrphanCollections builds the minimal schema the reconciler touches.
func setupOrphanCollections(t *testing.T, app core.App) {
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

func TestOrphanReconciler_SweepsStrandedDraft(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupOrphanCollections(t, app)

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

	svc := NewOrphanReconcilerSync(app)
	svc.SetYear(2026)
	if err := svc.Sync(context.Background()); err != nil {
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

func TestOrphanReconciler_GateSkipsWhenNoBunkPlans(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupOrphanCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	// A draft exists, but NO bunk_plans rows at all for the year.
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": bunk.Id, "year": 2026,
	})

	svc := NewOrphanReconcilerSync(app)
	svc.SetYear(2026)
	if err := svc.Sync(context.Background()); err != nil {
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

func TestOrphanReconciler_LeavesValidDraftUntouched(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupOrphanCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	plan := saveRec(t, app, "bunk_plans", map[string]any{"bunk": bunk.Id, "session": sess.Id, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": bunk.Id, "bunk_plan": plan.Id, "year": 2026,
	})

	svc := NewOrphanReconcilerSync(app)
	svc.SetYear(2026)
	if err := svc.Sync(context.Background()); err != nil {
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

func TestOrphanReconciler_ProdAuditDoesNotDelete(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupOrphanCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	keptBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	goneBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "G-5", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": keptBunk.Id, "session": sess.Id, "year": 2026})
	// A stranded PRODUCTION assignment.
	prodRow := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": sess.Id, "bunk": goneBunk.Id, "year": 2026,
	})

	svc := NewOrphanReconcilerSync(app)
	svc.SetYear(2026)
	if err := svc.Sync(context.Background()); err != nil {
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

func TestOrphanReconciler_Idempotent(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupOrphanCollections(t, app)

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

	svc := NewOrphanReconcilerSync(app)
	svc.SetYear(2026)
	if err := svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync run 1: %v", err)
	}
	svc2 := NewOrphanReconcilerSync(app)
	svc2.SetYear(2026)
	if err := svc2.Sync(context.Background()); err != nil {
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
