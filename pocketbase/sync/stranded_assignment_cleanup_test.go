package sync

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

func TestFindStrandedAssignments(t *testing.T) {
	t.Parallel()
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

func TestFindEnrollmentOrphans(t *testing.T) {
	t.Parallel()
	enrolledPairs := map[string]bool{
		strandedPairKey("sess1", "p1"): true,
	}
	// Only sess1 has enrolled attendees; sess2 has none (its attendees failed to sync).
	enrolledSessions := map[string]bool{"sess1": true}
	candidates := []strandedCandidate{
		{RecordID: "r1", SessionID: "sess1", PersonID: "p1"}, // enrolled - kept
		{RecordID: "r2", SessionID: "sess1", PersonID: "p2"}, // cancelled - orphan
		{RecordID: "r3", SessionID: "sess1", PersonID: ""},   // no person - skipped
		{RecordID: "r4", SessionID: "sess2", PersonID: "p9"}, // session has zero enrolled - skipped
	}

	orphans := findEnrollmentOrphans(enrolledSessions, enrolledPairs, candidates)

	if len(orphans) != 1 {
		t.Fatalf("want 1 orphan, got %d: %+v", len(orphans), orphans)
	}
	if orphans[0].RecordID != "r2" {
		t.Errorf("want [r2], got [%s]", orphans[0].RecordID)
	}
}

// Both sides of the match are keyed on the weekend's CampMinder id since
// kindred#2042 -- the candidate's own session_cm_id against SessionWindow.CMID
// -- so that a camp_sessions record recreated rather than updated cannot turn
// the whole sweep into a silent no-op.
func TestFindLodgingEnrollmentOrphans(t *testing.T) {
	t.Parallel()
	householdIndex := map[int][]SessionWindow{
		9001: {{ID: "pb1", CMID: 101}}, // still enrolled in weekend 101
	}
	personIndex := map[int][]SessionWindow{
		7001: {{ID: "pb3", CMID: 103}}, // enrolled, but in a DIFFERENT weekend than the candidate names
		7099: {{ID: "pb1", CMID: 101}}, // keeps weekend 101 "reliable" for the person grain
	}
	candidates := []lodgingOrphanCandidate{
		{RecordID: "r1", SessionCMID: 101, HouseholdCMID: 9001},             // enrolled - kept
		{RecordID: "r2", SessionCMID: 101, HouseholdCMID: 9002},             // cancelled - orphan
		{RecordID: "r3", SessionCMID: 102, HouseholdCMID: 9003},             // weekend has zero enrolled - skipped
		{RecordID: "r4", SessionCMID: 101, PersonCMID: 7001},                // wrong weekend for this person - orphan
		{RecordID: "r5", SessionCMID: 101, HouseholdCMID: 0, PersonCMID: 0}, // grain-less - skipped
	}

	orphans := findLodgingEnrollmentOrphans(householdIndex, personIndex, candidates)

	got := make(map[string]bool, len(orphans))
	for _, o := range orphans {
		got[o.RecordID] = true
	}
	if len(got) != 2 || !got["r2"] || !got["r4"] {
		t.Fatalf("want orphans [r2 r4], got %+v", orphans)
	}
}

func TestReliableEnrolledSessions(t *testing.T) {
	t.Parallel()
	index := map[int][]SessionWindow{
		9001: {{ID: "pb1", CMID: 101}, {ID: "pb2", CMID: 102}},
		9002: {{ID: "pb1", CMID: 101}},
	}
	reliable := reliableEnrolledSessions(index)
	for _, cmID := range []int{101, 102} {
		if !reliable[cmID] {
			t.Errorf("reliable[%d] = false, want true", cmID)
		}
	}
	if reliable[103] {
		t.Error("reliable[103] = true, want false -- no party enrolled there")
	}
	// The PB record id must NOT be what keys the set: keyed on it, a recreated
	// camp_sessions record makes every lodging row's weekend look unreliable.
	if len(reliable) != 2 {
		t.Errorf("reliable has %d entries, want 2 (one per weekend, not per PB record)", len(reliable))
	}
}

func TestSessionIndexHasWindow(t *testing.T) {
	t.Parallel()
	windows := []SessionWindow{{ID: "pb-a", CMID: 101}, {ID: "pb-b", CMID: 102}}
	if !sessionIndexHasWindow(windows, 101) {
		t.Error("want true for a present window CampMinder id")
	}
	if sessionIndexHasWindow(windows, 999) {
		t.Error("want false for an absent window CampMinder id")
	}
	if sessionIndexHasWindow(nil, 101) {
		t.Error("want false against a nil slice")
	}
}

// setupStrandedCollections builds the minimal schema the reconciler touches.
func setupStrandedCollections(t *testing.T, app core.App) {
	t.Helper()

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	// Needed by BuildHouseholdSessionIndex/BuildPersonSessionIndex (the lodging
	// pass reuses them, see #2028) -- unset on the existing bunk-only fixtures,
	// which is fine: LoadSessionWindows' `session_type = 'family'`/`'adult'`
	// filter then matches nothing, so those tests' lodging pass is a no-op.
	sessions.Fields.Add(&core.TextField{Name: "session_type"})
	sessions.Fields.Add(&core.DateField{Name: "start_date"})
	sessions.Fields.Add(&core.DateField{Name: "end_date"})
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
	// household_id/year: BuildHouseholdSessionIndex's loadPersonHouseholdCMIDs
	// filters "year = %d && household_id > 0" on this collection.
	persons.Fields.Add(&core.NumberField{Name: "household_id"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
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

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	// BuildHouseholdSessionIndex/BuildPersonSessionIndex key off person_id (the
	// CampMinder id), not the `person` relation -- see buildSessionIndex.
	attendees.Fields.Add(&core.NumberField{Name: "person_id"})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(attendees); err != nil {
		t.Fatalf("create attendees: %v", err)
	}

	// --- lodging: #2028's tables, minimal shape (mirrors newSyncTestApp) ---

	units := core.NewBaseCollection("lodging_units")
	units.Fields.Add(&core.TextField{Name: "code"})
	if err := app.Save(units); err != nil {
		t.Fatalf("create lodging_units: %v", err)
	}

	lodgingAssignments := core.NewBaseCollection("lodging_assignments")
	lodgingAssignments.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	lodgingAssignments.Fields.Add(&core.NumberField{Name: "session_cm_id"})
	lodgingAssignments.Fields.Add(&core.NumberField{Name: "year"})
	lodgingAssignments.Fields.Add(&core.RelationField{Name: "units", CollectionId: units.Id, MaxSelect: 20})
	lodgingAssignments.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	lodgingAssignments.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	lodgingAssignments.Fields.Add(&core.TextField{Name: "source"})
	lodgingAssignments.Fields.Add(&core.BoolField{Name: "staff_touched"})
	if err := app.Save(lodgingAssignments); err != nil {
		t.Fatalf("create lodging_assignments: %v", err)
	}

	lodgingDraft := core.NewBaseCollection("lodging_assignments_draft")
	lodgingDraft.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	lodgingDraft.Fields.Add(&core.NumberField{Name: "session_cm_id"})
	lodgingDraft.Fields.Add(&core.NumberField{Name: "year"})
	lodgingDraft.Fields.Add(&core.RelationField{Name: "scenario", CollectionId: scenarios.Id, MaxSelect: 1})
	lodgingDraft.Fields.Add(&core.RelationField{Name: "units", CollectionId: units.Id, MaxSelect: 20})
	lodgingDraft.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	lodgingDraft.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	lodgingDraft.Fields.Add(&core.TextField{Name: "source"})
	lodgingDraft.Fields.Add(&core.BoolField{Name: "staff_touched"})
	if err := app.Save(lodgingDraft); err != nil {
		t.Fatalf("create lodging_assignments_draft: %v", err)
	}
}

// addLodgingSession seeds a camp_sessions row with the fields
// BuildHouseholdSessionIndex/BuildPersonSessionIndex need, which the bunk-only
// sessions above deliberately omit.
func addLodgingSession(t *testing.T, app core.App, cmID int, sessionType string, year int) *core.Record {
	t.Helper()
	return saveRec(t, app, "camp_sessions", map[string]any{
		"cm_id": cmID, "session_type": sessionType, "year": year,
		"start_date": "2026-05-23 07:00:00.000Z", "end_date": "2026-05-26 07:00:00.000Z",
	})
}

func addLodgingUnit(t *testing.T, app core.App, code string) *core.Record {
	t.Helper()
	return saveRec(t, app, "lodging_units", map[string]any{"code": code})
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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

func TestStrandedAssignmentCleanup_SweepsEnrollmentOrphanDraft(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "G-Bet", "year": 2026})
	cancelled := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	enrolled := saveRec(t, app, "persons", map[string]any{"cm_id": 9002})
	// Bunk IS planned for the session, so the draft is NOT bunk-stranded — the
	// only thing wrong is the camper's enrollment.
	plan := saveRec(t, app, "bunk_plans", map[string]any{"bunk": bunk.Id, "session": sess.Id, "year": 2026})
	// cancelled camper has a non-enrolled attendee row; an enrolled peer keeps
	// the session's enrolled set non-empty so the per-session guard passes.
	saveRec(t, app, "attendees", map[string]any{"person": cancelled.Id, "session": sess.Id, "status_id": 32, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{"person": enrolled.Id, "session": sess.Id, "status_id": 2, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	draft := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": cancelled.Id, "session": sess.Id,
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
	if got.GetString("bunk") != "" {
		t.Errorf("want bunk cleared for cancelled camper, got %q", got.GetString("bunk"))
	}
	if got.GetString("bunk_plan") != "" {
		t.Errorf("want bunk_plan cleared for cancelled camper, got %q", got.GetString("bunk_plan"))
	}
}

func TestStrandedAssignmentCleanup_EnrollmentGateSkipsPerSession(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	// Session A has enrolled attendees; session B has none (its attendees failed
	// to sync). The per-session guard must protect session B's drafts from being
	// nulled as "orphans" — a zero-enrolled session is unreliable, not authoritative.
	sessA := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	sessB := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 200, "year": 2026})
	bunkA := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "A-1", "year": 2026})
	bunkB := saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "B-1", "year": 2026})
	personA := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	personB := saveRec(t, app, "persons", map[string]any{"cm_id": 9002})
	// Both sessions have valid bunk plans, so neither draft is bunk-stranded.
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": bunkA.Id, "session": sessA.Id, "year": 2026})
	planB := saveRec(t, app, "bunk_plans", map[string]any{"bunk": bunkB.Id, "session": sessB.Id, "year": 2026})
	// Only session A has an enrolled attendee.
	saveRec(t, app, "attendees", map[string]any{"person": personA.Id, "session": sessA.Id, "status_id": 2, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sessB.Id, "year": 2026})
	// A draft in session B for a person with no enrolled attendee there. It must
	// NOT be swept — session B's empty enrolled set is unreliable.
	draftB := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": personB.Id, "session": sessB.Id,
		"bunk": bunkB.Id, "bunk_plan": planB.Id, "year": 2026,
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
		t.Errorf("per-session enrollment gate failed — session-B draft swept despite zero enrolled (bunk=%q)",
			got.GetString("bunk"))
	}
}

func TestStrandedAssignmentCleanup_EnrollmentOrphanProdAudit(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "G-Bet", "year": 2026})
	cancelled := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	enrolled := saveRec(t, app, "persons", map[string]any{"cm_id": 9002})
	// Bunk is planned (not bunk-stranded); the prod row is only enrollment-orphaned.
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": bunk.Id, "session": sess.Id, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{"person": cancelled.Id, "session": sess.Id, "status_id": 32, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{"person": enrolled.Id, "session": sess.Id, "status_id": 2, "year": 2026})
	prodRow := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": cancelled.Id, "session": sess.Id, "bunk": bunk.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if svc.Stats.ProdAuditWarnings != 1 {
		t.Errorf("want ProdAuditWarnings=1 for enrollment-orphaned prod row, got %d", svc.Stats.ProdAuditWarnings)
	}
	// Prod row must NOT be cleared (observe-only).
	got, err := app.FindRecordById("bunk_assignments", prodRow.Id)
	if err != nil {
		t.Fatalf("prod row was deleted by the reconciler: %v", err)
	}
	if got.GetString("bunk") != bunk.Id {
		t.Errorf("prod row bunk must not be cleared (observe-only), got %q", got.GetString("bunk"))
	}
}

// --- #2028: lodging enrollment-orphan pass ---
//
// The weekend mirror of the enrollment-orphan half above, built from
// BuildHouseholdSessionIndex/BuildPersonSessionIndex rather than a second
// attendees query (see #2028's insistence on reuse over re-derivation).

func TestStrandedAssignmentCleanup_SweepsLodgingEnrollmentOrphanDraftHousehold(t *testing.T) {
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
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("lodging_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if len(got.GetStringSlice("units")) != 0 {
		t.Errorf("want units cleared for cancelled household, got %v", got.GetStringSlice("units"))
	}
}

// TestStrandedAssignmentCleanup_LodgingDraftPreservesStaffTouchedAndSource pins
// the mechanism ruling: the null-out is unconditional (a cancelled household is
// gone whether or not staff moved them), but only `units` clears -- the flag
// and source survive, exactly like bunk+bunk_plan nulling leaves everything
// else on the row alone.
func TestStrandedAssignmentCleanup_LodgingDraftPreservesStaffTouchedAndSource(t *testing.T) {
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
	saveRec(t, app, "attendees", map[string]any{
		"person": enrolledPerson.Id, "person_id": 9002, "session": sess.Id, "status_id": 2, "year": 2026,
	})

	draft := saveRec(t, app, "lodging_assignments_draft", map[string]any{
		"session": sess.Id, "session_cm_id": 100, "year": 2026, "scenario": scenario.Id,
		"units": []string{unit.Id}, "household_cm_id": 5001, "source": "staff_manual", "staff_touched": true,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("lodging_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if len(got.GetStringSlice("units")) != 0 {
		t.Errorf("want units cleared, got %v", got.GetStringSlice("units"))
	}
	if !got.GetBool("staff_touched") {
		t.Error("staff_touched was cleared -- the flag must survive the sweep")
	}
	if got.GetString("source") != "staff_manual" {
		t.Errorf("source = %q, want unchanged %q", got.GetString("source"), "staff_manual")
	}
}

func TestStrandedAssignmentCleanup_LodgingEnrollmentGateSkipsPerSession(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sessA := addLodgingSession(t, app, 100, "family", 2026) // has an enrolled household
	sessB := addLodgingSession(t, app, 200, "family", 2026) // zero enrolled -- attendee sync may have failed
	unit := addLodgingUnit(t, app, "ridge-a")
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sessB.Id, "year": 2026})

	enrolledA := saveRec(t, app, "persons", map[string]any{"cm_id": 9001, "household_id": 5001, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{
		"person": enrolledA.Id, "person_id": 9001, "session": sessA.Id, "status_id": 2, "year": 2026,
	})

	// A draft in session B for a household with no enrolled attendee there. It
	// must NOT be swept -- session B's empty enrolled set is unreliable, not
	// authoritative (mirrors TestStrandedAssignmentCleanup_EnrollmentGateSkipsPerSession).
	draftB := saveRec(t, app, "lodging_assignments_draft", map[string]any{
		"session": sessB.Id, "session_cm_id": 200, "year": 2026, "scenario": scenario.Id,
		"units": []string{unit.Id}, "household_cm_id": 5099, "source": "campminder_sync", "staff_touched": false,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("lodging_assignments_draft", draftB.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if len(got.GetStringSlice("units")) == 0 {
		t.Error("per-session lodging gate failed -- session-B draft swept despite zero enrolled")
	}
}

// TestStrandedAssignmentCleanup_LodgingProdAuditDoesNotDelete pins the split of
// responsibility: this pass only audits lodging_assignments (the mirror) --
// deletion is LodgingAssignmentsSync.deleteLodgingOrphans' job (#2028).
func TestStrandedAssignmentCleanup_LodgingProdAuditDoesNotDelete(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := addLodgingSession(t, app, 100, "family", 2026)
	unit := addLodgingUnit(t, app, "ridge-a")

	cancelled := saveRec(t, app, "persons", map[string]any{"cm_id": 9001, "household_id": 5001, "year": 2026})
	enrolledPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 9002, "household_id": 5002, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{
		"person": cancelled.Id, "person_id": 9001, "session": sess.Id, "status_id": 32, "year": 2026,
	})
	saveRec(t, app, "attendees", map[string]any{
		"person": enrolledPerson.Id, "person_id": 9002, "session": sess.Id, "status_id": 2, "year": 2026,
	})

	prodRow := saveRec(t, app, "lodging_assignments", map[string]any{
		"session": sess.Id, "session_cm_id": 100, "year": 2026,
		"units": []string{unit.Id}, "household_cm_id": 5001, "source": "campminder_sync", "staff_touched": false,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if svc.Stats.LodgingProdAuditWarnings != 1 {
		t.Errorf("want LodgingProdAuditWarnings=1, got %d", svc.Stats.LodgingProdAuditWarnings)
	}
	got, err := app.FindRecordById("lodging_assignments", prodRow.Id)
	if err != nil {
		t.Fatalf("prod lodging row was deleted by the reconciler: %v", err)
	}
	if len(got.GetStringSlice("units")) == 0 {
		t.Error("prod lodging row units must not be cleared (observe-only)")
	}
}

// TestStrandedAssignmentCleanup_LodgingPersonGrainOrphanDraft is the adult
// weekend twin of the household-grain sweep.
func TestStrandedAssignmentCleanup_LodgingPersonGrainOrphanDraft(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := addLodgingSession(t, app, 300, "adult", 2026)
	unit := addLodgingUnit(t, app, "river-c")
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "October", "session": sess.Id, "year": 2026})

	cancelled := saveRec(t, app, "persons", map[string]any{"cm_id": 7001, "year": 2026})
	enrolled := saveRec(t, app, "persons", map[string]any{"cm_id": 7002, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{
		"person": cancelled.Id, "person_id": 7001, "session": sess.Id, "status_id": 32, "year": 2026,
	})
	saveRec(t, app, "attendees", map[string]any{
		"person": enrolled.Id, "person_id": 7002, "session": sess.Id, "status_id": 2, "year": 2026,
	})

	draft := saveRec(t, app, "lodging_assignments_draft", map[string]any{
		"session": sess.Id, "session_cm_id": 300, "year": 2026, "scenario": scenario.Id,
		"units": []string{unit.Id}, "person_cm_id": 7001, "source": "campminder_sync", "staff_touched": false,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("lodging_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if len(got.GetStringSlice("units")) != 0 {
		t.Errorf("want units cleared for cancelled person, got %v", got.GetStringSlice("units"))
	}
}

// TestStrandedAssignmentCleanup_LeavesEnrolledLodgingDraftUntouched is the
// obvious regression: a household still enrolled keeps its draft placement.
func TestStrandedAssignmentCleanup_LeavesEnrolledLodgingDraftUntouched(t *testing.T) {
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

	enrolled := saveRec(t, app, "persons", map[string]any{"cm_id": 9001, "household_id": 5001, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{
		"person": enrolled.Id, "person_id": 9001, "session": sess.Id, "status_id": 2, "year": 2026,
	})

	draft := saveRec(t, app, "lodging_assignments_draft", map[string]any{
		"session": sess.Id, "session_cm_id": 100, "year": 2026, "scenario": scenario.Id,
		"units": []string{unit.Id}, "household_cm_id": 5001, "source": "campminder_sync", "staff_touched": false,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("lodging_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if len(got.GetStringSlice("units")) == 0 {
		t.Error("still-enrolled household's lodging draft was swept")
	}
}

// TestStrandedAssignmentCleanup_StatsResetBetweenRuns pins the per-run contract
// of Stats on the single long-lived service instance the orchestrator registers
// (orchestrator.go registers one StrandedAssignmentCleanupSync for the process
// lifetime). Every counter must describe the run that just finished, not the
// sum of every run since boot — matching LodgingAssignmentsSync.Sync()'s
// `s.Stats = Stats{}`. Run 1 sweeps a stranded draft and warns on a stranded
// prod row; run 2 has nothing left to sweep, so Updated must be 0, and the
// still-present prod row must warn exactly once again — not twice.
func TestStrandedAssignmentCleanup_StatsResetBetweenRuns(t *testing.T) {
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
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": keptBunk.Id, "session": sess.Id, "year": 2026})
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})
	saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": scenario.Id, "person": person.Id, "session": sess.Id,
		"bunk": goneBunk.Id, "year": 2026,
	})
	// A stranded production row: observe-only, so it re-warns on every run.
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": sess.Id, "bunk": goneBunk.Id, "year": 2026,
	})

	// One instance, reused across runs — exactly how the orchestrator holds it.
	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)

	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync run 1: %v", err)
	}
	if svc.GetStats().Updated != 1 {
		t.Fatalf("run 1: want Updated=1, got %d", svc.GetStats().Updated)
	}
	if svc.GetStats().ProdAuditWarnings != 1 {
		t.Fatalf("run 1: want ProdAuditWarnings=1, got %d", svc.GetStats().ProdAuditWarnings)
	}

	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync run 2: %v", err)
	}
	if got := svc.GetStats().Updated; got != 0 {
		t.Errorf("run 2 swept nothing — want Updated=0, got %d (Stats accumulated across runs)", got)
	}
}

// TestStrandedAssignmentCleanup_ProdAuditWarningsClearWhenRunGatesOut covers the
// other half of the same reset contract: the audit counters are assigned (not
// incremented), so they look self-correcting — until a run short-circuits
// before the audit ever executes. Here run 2 hits the zero-bunk_plans gate and
// audits nothing at all; without a per-run reset it keeps reporting run 1's
// warning count, describing an audit that never happened.
func TestStrandedAssignmentCleanup_ProdAuditWarningsClearWhenRunGatesOut(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	plannedBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	strandedBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "G-5", "year": 2026})
	person := saveRec(t, app, "persons", map[string]any{"cm_id": 9001})
	plan := saveRec(t, app, "bunk_plans", map[string]any{"bunk": plannedBunk.Id, "session": sess.Id, "year": 2026})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": sess.Id, "bunk": strandedBunk.Id, "year": 2026,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)

	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync run 1: %v", err)
	}
	if svc.GetStats().ProdAuditWarnings != 1 {
		t.Fatalf("run 1: want ProdAuditWarnings=1, got %d", svc.GetStats().ProdAuditWarnings)
	}

	// Simulate a failed bunk_plans sync: run 2 gates out before the prod audit.
	if err = app.Delete(plan); err != nil {
		t.Fatalf("delete bunk_plan: %v", err)
	}
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync run 2: %v", err)
	}
	if got := svc.GetStats().ProdAuditWarnings; got != 0 {
		t.Errorf("run 2 audited nothing — want ProdAuditWarnings=0, got %d (stale value carried from run 1)", got)
	}
}

// TestStrandedAssignmentCleanup_LodgingOrphanPassKeysOnTheCampMinderSessionID
// pins kindred#2042 on the enrollment-orphan sweep.
//
// The candidate's session and the enrolled-party index are matched against each
// other, and both used to be keyed on the camp_sessions PocketBase record id.
// That id is replaced outright when the record is RECREATED rather than updated
// (a restore, a manual repair): the attendees re-sync onto the new record while
// the lodging rows keep the old one, so every candidate falls through the
// per-session reliability guard and the sweep silently becomes a no-op --
// fail-closed, but permanently off. `session_cm_id` is what both sides can
// still agree on.
//
// The draft below points at a STALE camp_sessions record, not at a blank
// relation. `lodging_assignments_draft.session` is `required: true`
// (1500000132:190), so PocketBase never leaves it empty and a fixture that
// blanked it would be testing a state production cannot reach. What production
// reaches is this: two records, same CampMinder id, different PocketBase id --
// the attendees on the new one, the placement still on the old.
func TestStrandedAssignmentCleanup_LodgingOrphanPassKeysOnTheCampMinderSessionID(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	// The record the placement was written against, replaced by `sess` when the
	// weekend was recreated. Same cm_id and year -- camp_sessions is unique on
	// that pair, so only one of these two can exist at a time in production;
	// keeping both here is what lets one fixture hold the before and the after.
	staleSess := addLodgingSession(t, app, 100, "family", 2026)
	sess := addLodgingSession(t, app, 100, "family", 2026)
	unit := addLodgingUnit(t, app, "ridge-a")
	scenario := saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": sess.Id, "year": 2026})

	cancelled := saveRec(t, app, "persons", map[string]any{"cm_id": 9001, "household_id": 5001, "year": 2026})
	enrolledPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 9002, "household_id": 5002, "year": 2026})
	saveRec(t, app, "attendees", map[string]any{
		"person": cancelled.Id, "person_id": 9001, "session": sess.Id, "status_id": 32, "year": 2026,
	})
	// Keeps the weekend's enrolled set non-empty so the per-session guard passes.
	saveRec(t, app, "attendees", map[string]any{
		"person": enrolledPerson.Id, "person_id": 9002, "session": sess.Id, "status_id": 2, "year": 2026,
	})

	draft := saveRec(t, app, "lodging_assignments_draft", map[string]any{
		"session": staleSess.Id, "session_cm_id": 100, "year": 2026, "scenario": scenario.Id,
		"units": []string{unit.Id}, "household_cm_id": 5001, "source": "campminder_sync", "staff_touched": false,
	})

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := app.FindRecordById("lodging_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("reload draft: %v", err)
	}
	if len(got.GetStringSlice("units")) != 0 {
		t.Errorf("want units cleared for the cancelled household, got %v -- the sweep is still keyed "+
			"on the session relation, so a recreated camp_sessions record turns it off", got.GetStringSlice("units"))
	}
}
