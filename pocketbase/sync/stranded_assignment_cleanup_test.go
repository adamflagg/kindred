package sync

import (
	"context"
	"fmt"
	"strings"
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

	// bunks and bunk_plans are kindred#2300's shared fixture builder
	// (sync_testsupport_test.go) -- widened there so this file's copies
	// didn't keep drifting from production on their own.
	bunks := addBunksCollection(t, app)

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	// household_id/year: BuildHouseholdSessionIndex's loadPersonHouseholdCMIDs
	// filters "year = %d && household_id > 0" on this collection.
	persons.Fields.Add(&core.NumberField{Name: "household_id"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	plans := addBunkPlansCollection(t, app, bunks, sessions)

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

	// bunk_assignments too -- see the addBunksCollection comment above.
	addBunkAssignmentsCollection(t, app, persons, sessions, bunks, plans)

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

// TestStrandedAssignmentCleanup_ProdAuditLogCapsTheRecordSample: F8 -- prod hit 262 orphaned
// production bunk_assignments and the WARN line dumped all 262 record triplets into one
// ~30 KB log line. The log must still say how many (the true count), but the record sample
// itself is capped, matching the precedent financial_transactions.go's logCrossSeason already
// set for an unbounded per-run list. captureSweepLogs swaps the process-global slog default
// (registered in pocketbase/main_test_parallelism_test.go's serial list).
func TestStrandedAssignmentCleanup_ProdAuditLogCapsTheRecordSample(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	// otherBunk has a plan → the session IS in plannedSessions (a year with zero bunk_plans
	// at all is read as "sync may have failed" and the whole reconciler skips).
	otherBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	saveRec(t, app, "bunk_plans", map[string]any{"bunk": otherBunk.Id, "session": sess.Id, "year": 2026})
	// strandedBunk has no plan for this session → every assignment on it is stranded.
	strandedBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "G-5", "year": 2026})
	const seeded = 15 // more than the 10-record sample cap
	for i := range seeded {
		person := saveRec(t, app, "persons", map[string]any{"cm_id": 9000 + i})
		saveRec(t, app, "bunk_assignments", map[string]any{
			"person": person.Id, "session": sess.Id, "bunk": strandedBunk.Id, "year": 2026,
		})
	}

	logs := captureSweepLogs(t)
	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	if err = svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if svc.Stats.ProdAuditWarnings != seeded {
		t.Fatalf("want ProdAuditWarnings=%d, got %d", seeded, svc.Stats.ProdAuditWarnings)
	}
	if got := strings.Count(logs.String(), "(session="); got > 10 {
		t.Errorf("log sample has %d record entries, want at most 10; log:\n%s", got, logs.String())
	}
	if !strings.Contains(logs.String(), fmt.Sprintf("count=%d", seeded)) {
		t.Errorf("log must still carry the true count (%d) even though the sample is capped, got:\n%s",
			seeded, logs.String())
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

	// Owner ruling 2026-10-29: "if someone moves from enrolled to another status? we can kill
	// their draft placements." The row goes, not just its bunk.
	if recordExists(t, app, "bunk_assignments_draft", draft.Id) {
		t.Error("cancelled camper's draft row survived -- want it deleted, not unassigned")
	}
	if svc.Stats.Deleted != 1 || svc.Stats.Updated != 0 {
		t.Errorf("Stats Deleted=%d Updated=%d, want 1 and 0", svc.Stats.Deleted, svc.Stats.Updated)
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

	if recordExists(t, app, "lodging_assignments_draft", draft.Id) {
		t.Error("cancelled household's lodging draft survived -- want it deleted, as summer's is")
	}
	if svc.Stats.Deleted != 1 || svc.Stats.Updated != 0 {
		t.Errorf("Stats Deleted=%d Updated=%d, want 1 and 0", svc.Stats.Deleted, svc.Stats.Updated)
	}
}

// TestStrandedAssignmentCleanup_LodgingDraftDeletedEvenWhenStaffTouched pins
// that staff_touched is not a skip guard: a cancelled household is gone whether
// or not staff moved them, so a hand-placed draft goes too, as summer's
// hand-placed drafts do.
func TestStrandedAssignmentCleanup_LodgingDraftDeletedEvenWhenStaffTouched(t *testing.T) {
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

	if recordExists(t, app, "lodging_assignments_draft", draft.Id) {
		t.Error("staff-touched lodging draft for a cancelled household survived -- staff_touched is not a skip guard")
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

	if recordExists(t, app, "lodging_assignments_draft", draft.Id) {
		t.Error("cancelled adult's lodging draft survived -- want it deleted")
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

	if recordExists(t, app, "lodging_assignments_draft", draft.Id) {
		t.Error("cancelled household's lodging draft survived -- the sweep is still keyed " +
			"on the session relation, so a recreated camp_sessions record turns it off")
	}
}

// --- Owner ruling 2026-10-29: a camper no longer enrolled loses their draft rows ---
//
// "if someone moves from enrolled to another status? we can kill their draft placements."
// Reason (b), the camper is no longer enrolled in that session, now DELETES the draft row.
// Reason (a), the bunk lost its plan while the camper is still enrolled, still only unassigns.

// recordExists reports whether a record with this id is still in the collection.
func recordExists(t *testing.T, app core.App, collection, id string) bool {
	t.Helper()
	return countRows(t, app, collection, fmt.Sprintf("id = '%s'", id)) > 0
}

// strandedFixture seeds one session with a planned bunk, a bunk that lost its plan, a
// scenario, and one enrolled peer so the per-session enrollment guard passes.
type strandedFixture struct {
	sess, plannedBunk, planlessBunk, plan, scenario *core.Record
}

func newStrandedFixture(t *testing.T, app core.App) strandedFixture {
	t.Helper()
	var f strandedFixture
	f.sess = saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 100, "year": 2026})
	f.plannedBunk = saveRec(t, app, "bunks", map[string]any{"cm_id": 1, "name": "B-1", "year": 2026})
	f.planlessBunk = saveRec(t, app, "bunks", map[string]any{"cm_id": 2, "name": "G-5", "year": 2026})
	f.plan = saveRec(t, app, "bunk_plans", map[string]any{"bunk": f.plannedBunk.Id, "session": f.sess.Id, "year": 2026})
	f.scenario = saveRec(t, app, "saved_scenarios", map[string]any{"name": "April", "session": f.sess.Id, "year": 2026})
	peer := saveRec(t, app, "persons", map[string]any{"cm_id": 9900})
	saveRec(t, app, "attendees", map[string]any{"person": peer.Id, "session": f.sess.Id, "status_id": 2, "year": 2026})
	return f
}

// camper seeds a person with an attendee row of the given status in the fixture's session.
func (f strandedFixture) camper(t *testing.T, app core.App, cmID, statusID int) *core.Record {
	t.Helper()
	p := saveRec(t, app, "persons", map[string]any{"cm_id": cmID})
	saveRec(t, app, "attendees", map[string]any{"person": p.Id, "session": f.sess.Id, "status_id": statusID, "year": 2026})
	return p
}

func (f strandedFixture) draft(t *testing.T, app core.App, person, bunk *core.Record) *core.Record {
	t.Helper()
	data := map[string]any{"scenario": f.scenario.Id, "person": person.Id, "session": f.sess.Id, "year": 2026}
	if bunk != nil {
		data["bunk"] = bunk.Id
	}
	return saveRec(t, app, "bunk_assignments_draft", data)
}

func runStrandedCleanup(t *testing.T, app core.App, dryRun bool) *StrandedAssignmentCleanupSync {
	t.Helper()
	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	svc.SetDryRun(dryRun)
	if err := svc.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	return svc
}

// A draft the old code already unassigned (bunk null) still belongs to a camper who left:
// it is deleted too, not left behind as an empty row.
func TestStrandedAssignmentCleanup_DeletesAlreadyUnassignedEnrollmentOrphanDraft(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)
	f := newStrandedFixture(t, app)

	cancelled := f.camper(t, app, 9001, 32)
	draft := f.draft(t, app, cancelled, nil)

	svc := runStrandedCleanup(t, app, false)

	if recordExists(t, app, "bunk_assignments_draft", draft.Id) {
		t.Error("already-unassigned draft of a camper no longer enrolled survived -- want it deleted")
	}
	if svc.Stats.Deleted != 1 {
		t.Errorf("Stats.Deleted = %d, want 1", svc.Stats.Deleted)
	}
}

// Reason (a) alone: the camper is still enrolled, only the bunk lost its plan. Unassigned, kept.
func TestStrandedAssignmentCleanup_EnrolledCamperInPlanlessBunkIsOnlyUnassigned(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)
	f := newStrandedFixture(t, app)

	enrolled := f.camper(t, app, 9001, 2)
	draft := f.draft(t, app, enrolled, f.planlessBunk)

	svc := runStrandedCleanup(t, app, false)

	got, err := app.FindRecordById("bunk_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("enrolled camper's draft was deleted -- a planless bunk only unassigns: %v", err)
	}
	if got.GetString("bunk") != "" {
		t.Errorf("want bunk cleared, got %q", got.GetString("bunk"))
	}
	if svc.Stats.Updated != 1 || svc.Stats.Deleted != 0 {
		t.Errorf("Stats Updated=%d Deleted=%d, want 1 and 0", svc.Stats.Updated, svc.Stats.Deleted)
	}
}

// Both reasons at once: the bunk lost its plan AND the camper left. Deleted, counted once.
func TestStrandedAssignmentCleanup_DraftFlaggedByBothReasonsIsDeleted(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)
	f := newStrandedFixture(t, app)

	cancelled := f.camper(t, app, 9001, 32)
	draft := f.draft(t, app, cancelled, f.planlessBunk)

	svc := runStrandedCleanup(t, app, false)

	if recordExists(t, app, "bunk_assignments_draft", draft.Id) {
		t.Error("draft flagged by both reasons survived -- the enrollment reason deletes")
	}
	if svc.Stats.Deleted != 1 || svc.Stats.Updated != 0 {
		t.Errorf("Stats Deleted=%d Updated=%d, want 1 and 0 (deleted once, never also unassigned)",
			svc.Stats.Deleted, svc.Stats.Updated)
	}
}

// Enrollment is judged against the draft's OWN session, never the scenario's. One camper, one
// scenario, two sessions: still enrolled in the second (an AG session folded into a main-session
// scenario, say) but cancelled in the first. Only the first session's draft goes; the draft in the
// session they are still enrolled in is untouched, so a camper enrolled elsewhere in the same
// scenario is never deleted on the strength of a different session's status.
func TestStrandedAssignmentCleanup_EnrollmentJudgedPerDraftSession(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)
	f := newStrandedFixture(t, app)

	other := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 101, "year": 2026})
	moved := f.camper(t, app, 9001, 32) // cancelled in f.sess
	saveRec(t, app, "attendees", map[string]any{"person": moved.Id, "session": other.Id, "status_id": 2, "year": 2026})

	gone := f.draft(t, app, moved, nil)
	kept := saveRec(t, app, "bunk_assignments_draft", map[string]any{
		"scenario": f.scenario.Id, "person": moved.Id, "session": other.Id, "year": 2026,
	})

	svc := runStrandedCleanup(t, app, false)

	if recordExists(t, app, "bunk_assignments_draft", gone.Id) {
		t.Error("draft in the session the camper cancelled survived -- want it deleted")
	}
	if !recordExists(t, app, "bunk_assignments_draft", kept.Id) {
		t.Error("draft in the session the camper is still enrolled in was deleted")
	}
	if svc.Stats.Deleted != 1 {
		t.Errorf("Stats.Deleted = %d, want 1", svc.Stats.Deleted)
	}
}

// A dry run deletes nothing but counts what it would have deleted.
func TestStrandedAssignmentCleanup_DryRunCountsButKeepsEnrollmentOrphanDraft(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)
	f := newStrandedFixture(t, app)

	cancelled := f.camper(t, app, 9001, 32)
	draft := f.draft(t, app, cancelled, f.plannedBunk)

	svc := runStrandedCleanup(t, app, true)

	got, err := app.FindRecordById("bunk_assignments_draft", draft.Id)
	if err != nil {
		t.Fatalf("dry run deleted the draft: %v", err)
	}
	if got.GetString("bunk") != f.plannedBunk.Id {
		t.Errorf("dry run changed bunk to %q", got.GetString("bunk"))
	}
	if svc.Stats.Deleted != 1 || svc.Stats.Updated != 0 {
		t.Errorf("Stats Deleted=%d Updated=%d, want 1 and 0 (the delete that would have happened)",
			svc.Stats.Deleted, svc.Stats.Updated)
	}
}

// Fail closed: enrollment that cannot be read deletes nothing.
func TestStrandedAssignmentCleanup_UnreadableEnrollmentDeletesNothing(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)
	f := newStrandedFixture(t, app)

	cancelled := f.camper(t, app, 9001, 32)
	draft := f.draft(t, app, cancelled, f.plannedBunk)

	attendees, err := app.FindCollectionByNameOrId("attendees")
	if err != nil {
		t.Fatalf("find attendees: %v", err)
	}
	if err = app.Delete(attendees); err != nil {
		t.Fatalf("drop attendees: %v", err)
	}

	svc := NewStrandedAssignmentCleanupSync(app)
	svc.SetYear(2026)
	_ = svc.Sync(context.Background()) // the lodging index build fails too; only the draft matters here

	if !recordExists(t, app, "bunk_assignments_draft", draft.Id) {
		t.Error("draft deleted although enrollment could not be read")
	}
	if svc.Stats.Errors == 0 {
		t.Error("the unreadable enrollment should count an error")
	}
}

// The lodging twin of the already-unassigned case: a party no longer enrolled loses its draft
// row even when the old code had already cleared its units.
func TestStrandedAssignmentCleanup_DeletesUnplacedLodgingEnrollmentOrphanDraft(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupStrandedCollections(t, app)

	sess := addLodgingSession(t, app, 100, "family", 2026)
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
		"household_cm_id": 5001, "source": "campminder_sync", "staff_touched": false,
	})

	svc := runStrandedCleanup(t, app, false)

	if recordExists(t, app, "lodging_assignments_draft", draft.Id) {
		t.Error("unplaced lodging draft of a household no longer enrolled survived -- want it deleted")
	}
	if svc.Stats.Deleted != 1 {
		t.Errorf("Stats.Deleted = %d, want 1", svc.Stats.Deleted)
	}
}
