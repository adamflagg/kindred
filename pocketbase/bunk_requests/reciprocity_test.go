package bunkrequests

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// setupBunkRequestsCollection creates a minimal bunk_requests collection in
// the test app — only the fields the reciprocity hook reads/writes. The
// production schema has many more fields but they're irrelevant here.
func setupBunkRequestsCollection(t *testing.T, app core.App) {
	t.Helper()
	col := core.NewBaseCollection("bunk_requests")
	col.Fields.Add(&core.NumberField{Name: "requester_id", Required: true})
	col.Fields.Add(&core.NumberField{Name: "requestee_id"})
	col.Fields.Add(&core.SelectField{
		Name:      "request_type",
		Required:  true,
		Values:    []string{"bunk_with", "not_bunk_with", "age_preference"},
		MaxSelect: 1,
	})
	col.Fields.Add(&core.SelectField{
		Name:      "status",
		Required:  true,
		Values:    []string{"pending", "resolved", "declined"},
		MaxSelect: 1,
	})
	col.Fields.Add(&core.NumberField{Name: "year", Required: true})
	col.Fields.Add(&core.NumberField{Name: "session_id", Required: true})
	col.Fields.Add(&core.BoolField{Name: "is_reciprocal"})
	if err := app.Save(col); err != nil {
		t.Fatalf("setupBunkRequestsCollection: save: %v", err)
	}
}

// makeRequest creates and persists a bunk_request record with the given
// pair coords + status. Returns the saved record.
func makeRequest(t *testing.T, app core.App, requester, requestee int, rtype, status string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("bunk_requests")
	if err != nil {
		t.Fatalf("makeRequest: find collection: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("requester_id", requester)
	r.Set("requestee_id", requestee)
	r.Set("request_type", rtype)
	r.Set("status", status)
	r.Set("year", 2026)
	r.Set("session_id", 1235404)
	r.Set("is_reciprocal", false)
	if err := app.Save(r); err != nil {
		t.Fatalf("makeRequest: save: %v", err)
	}
	return r
}

// Test 1: Create resolved A→B and B→A, then call RecomputePairReciprocity
// directly. Both rows should end up with is_reciprocal=true.
func TestRecomputePairReciprocity_CreatesPair(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)

	// Insert pair as raw rows (is_reciprocal=false initially).
	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Call helper directly — it should fix both rows.
	err = RecomputePairReciprocity(app, 2026, 1235404, 100, 200, "bunk_with")
	if err != nil {
		t.Fatalf("RecomputePairReciprocity: %v", err)
	}

	// Reload from DB.
	gotAB, err := app.FindRecordById("bunk_requests", rowAB.Id)
	if err != nil {
		t.Fatalf("reload AB: %v", err)
	}
	gotBA, err := app.FindRecordById("bunk_requests", rowBA.Id)
	if err != nil {
		t.Fatalf("reload BA: %v", err)
	}

	if !gotAB.GetBool("is_reciprocal") {
		t.Errorf("A→B: expected is_reciprocal=true, got false")
	}
	if !gotBA.GetBool("is_reciprocal") {
		t.Errorf("B→A: expected is_reciprocal=true, got false")
	}
}

// Test 2: With the hook registered, inserting B→A on top of an existing
// resolved A→B should fire the hook and flip both rows' is_reciprocal=true.
func TestHook_FiresOnCreate(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)

	// NOTE: we can't pass *tests.TestApp to RegisterHooks (which expects
	// *pocketbase.PocketBase). Use the lower-level event API directly,
	// matching what RegisterHooks does.
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")

	// At this point only A→B exists; the hook fired but B→A doesn't exist
	// yet, so A→B's flag stays false.
	gotAB, _ := app.FindRecordById("bunk_requests", rowAB.Id)
	if gotAB.GetBool("is_reciprocal") {
		t.Errorf("after lone A→B insert: expected is_reciprocal=false, got true")
	}

	// Now insert B→A. Hook fires, recompute finds both rows resolved → both flip.
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	gotAB, _ = app.FindRecordById("bunk_requests", rowAB.Id)
	gotBA, _ := app.FindRecordById("bunk_requests", rowBA.Id)
	if !gotAB.GetBool("is_reciprocal") {
		t.Errorf("after pair complete: A→B expected is_reciprocal=true, got false")
	}
	if !gotBA.GetBool("is_reciprocal") {
		t.Errorf("after pair complete: B→A expected is_reciprocal=true, got false")
	}
}

// registerHooksOnApp wires the same hooks RegisterHooks does, but takes a
// core.App (which the *tests.TestApp implements). We can't pass *tests.TestApp
// to RegisterHooks because it expects *pocketbase.PocketBase.
func registerHooksOnApp(app core.App) {
	app.OnRecordUpdate("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		captureOldCoords(e)
		return e.Next()
	})
	app.OnRecordAfterCreateSuccess("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		runRecompute(e)
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		runRecompute(e)
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		runRecompute(e)
		return e.Next()
	})
}

// Test 3 — #1059 direct reproduction: pair both reciprocal=true, delete one,
// surviving partner's flag should flip to false.
func TestHook_DeletionFlipsPartner(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Sanity: both reciprocal after pair complete.
	gotBA, _ := app.FindRecordById("bunk_requests", rowBA.Id)
	if !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("setup precondition: expected B→A reciprocal=true, got false")
	}

	// Delete A→B; hook should fire and recompute B→A.
	err = app.Delete(rowAB)
	if err != nil {
		t.Fatalf("delete AB: %v", err)
	}

	gotBA, err = app.FindRecordById("bunk_requests", rowBA.Id)
	if err != nil {
		t.Fatalf("reload BA: %v", err)
	}
	if gotBA.GetBool("is_reciprocal") {
		t.Errorf("after A→B delete: B→A expected is_reciprocal=false, got true (#1059 bug)")
	}
}

// Test 4 — #1069 coverage: status flip resolved → declined on one row should
// flip the partner's is_reciprocal to false (declined doesn't count as
// reciprocal).
func TestHook_StatusFlipFlipsPartner(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Sanity check.
	gotBA, _ := app.FindRecordById("bunk_requests", rowBA.Id)
	if !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected B→A reciprocal=true")
	}

	// Flip A→B to declined; hook fires on update.
	rowAB.Set("status", "declined")
	if err := app.Save(rowAB); err != nil {
		t.Fatalf("save flipped AB: %v", err)
	}

	gotBA, _ = app.FindRecordById("bunk_requests", rowBA.Id)
	if gotBA.GetBool("is_reciprocal") {
		t.Errorf("after A→B flip to declined: B→A expected is_reciprocal=false, got true")
	}
	gotAB, _ := app.FindRecordById("bunk_requests", rowAB.Id)
	if gotAB.GetBool("is_reciprocal") {
		t.Errorf("after A→B flip to declined: A→B expected is_reciprocal=false, got true")
	}
}

// Test 5 — Cross-session: A→B in session 1, B→A in session 2 → neither reciprocal.
func TestHook_CrossSessionNotReciprocal(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	col, _ := app.FindCollectionByNameOrId("bunk_requests")
	rowAB := core.NewRecord(col)
	rowAB.Set("requester_id", 100)
	rowAB.Set("requestee_id", 200)
	rowAB.Set("request_type", "bunk_with")
	rowAB.Set("status", "resolved")
	rowAB.Set("year", 2026)
	rowAB.Set("session_id", 1235404)
	rowAB.Set("is_reciprocal", false)
	if err := app.Save(rowAB); err != nil {
		t.Fatal(err)
	}

	rowBA := core.NewRecord(col)
	rowBA.Set("requester_id", 200)
	rowBA.Set("requestee_id", 100)
	rowBA.Set("request_type", "bunk_with")
	rowBA.Set("status", "resolved")
	rowBA.Set("year", 2026)
	rowBA.Set("session_id", 9999999) // DIFFERENT session
	rowBA.Set("is_reciprocal", false)
	if err := app.Save(rowBA); err != nil {
		t.Fatal(err)
	}

	gotAB, _ := app.FindRecordById("bunk_requests", rowAB.Id)
	gotBA, _ := app.FindRecordById("bunk_requests", rowBA.Id)
	if gotAB.GetBool("is_reciprocal") || gotBA.GetBool("is_reciprocal") {
		t.Errorf("cross-session: expected both reciprocal=false, got AB=%v BA=%v",
			gotAB.GetBool("is_reciprocal"), gotBA.GetBool("is_reciprocal"))
	}
}

// Test 6 — Cross-type: A→B bunk_with, B→A not_bunk_with → neither reciprocal.
func TestHook_CrossTypeNotReciprocal(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "not_bunk_with", "resolved")

	gotAB, _ := app.FindRecordById("bunk_requests", rowAB.Id)
	gotBA, _ := app.FindRecordById("bunk_requests", rowBA.Id)
	if gotAB.GetBool("is_reciprocal") || gotBA.GetBool("is_reciprocal") {
		t.Errorf("cross-type: expected both reciprocal=false, got AB=%v BA=%v",
			gotAB.GetBool("is_reciprocal"), gotBA.GetBool("is_reciprocal"))
	}
}

// Test 7 — age_preference: hook is a no-op, no errors.
func TestHook_AgePreferenceNoop(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	col, _ := app.FindCollectionByNameOrId("bunk_requests")
	r := core.NewRecord(col)
	r.Set("requester_id", 100)
	r.Set("requestee_id", 0) // age_preference has no requestee
	r.Set("request_type", "age_preference")
	r.Set("status", "resolved")
	r.Set("year", 2026)
	r.Set("session_id", 1235404)
	r.Set("is_reciprocal", false)

	if err := app.Save(r); err != nil {
		t.Fatalf("age_preference save (with hook): %v", err)
	}
	got, _ := app.FindRecordById("bunk_requests", r.Id)
	if got.GetBool("is_reciprocal") {
		t.Errorf("age_preference: expected reciprocal=false, got true")
	}
}

// Test 8 — Self-referential row: hook is a no-op, no errors.
func TestHook_SelfReferentialNoop(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	r := makeRequest(t, app, 100, 100, "bunk_with", "resolved") // requester == requestee

	got, _ := app.FindRecordById("bunk_requests", r.Id)
	if got.GetBool("is_reciprocal") {
		t.Errorf("self-referential: expected reciprocal=false, got true")
	}
}

// Test 9 — Idempotency: invoking the helper directly on an already-correct
// pair should produce zero saves and not error.
func TestRecomputePairReciprocity_IdempotentOnAlreadyCorrect(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")

	// Both should already be reciprocal=true after hooks fire from Save.
	gotAB, _ := app.FindRecordById("bunk_requests", rowAB.Id)
	gotBA, _ := app.FindRecordById("bunk_requests", rowBA.Id)
	if !gotAB.GetBool("is_reciprocal") || !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("precondition: expected both reciprocal=true, got AB=%v BA=%v",
			gotAB.GetBool("is_reciprocal"), gotBA.GetBool("is_reciprocal"))
	}

	abUpdated := gotAB.GetDateTime("updated").Time()
	baUpdated := gotBA.GetDateTime("updated").Time()

	// Direct invocation on already-correct pair.
	if err := RecomputePairReciprocity(app, 2026, 1235404, 100, 200, "bunk_with"); err != nil {
		t.Fatalf("RecomputePairReciprocity: %v", err)
	}

	gotAB2, _ := app.FindRecordById("bunk_requests", rowAB.Id)
	gotBA2, _ := app.FindRecordById("bunk_requests", rowBA.Id)

	// updated timestamp should not have moved if no save happened.
	if !gotAB2.GetDateTime("updated").Time().Equal(abUpdated) {
		t.Errorf("idempotent call wrote A→B unnecessarily; updated changed")
	}
	if !gotBA2.GetDateTime("updated").Time().Equal(baUpdated) {
		t.Errorf("idempotent call wrote B→A unnecessarily; updated changed")
	}
}

// Test 10 — ID mutation orphans the old partner.
//
// If the requester_id (or requestee_id) on an existing row is mutated, the
// hook's post-update recompute targets only the NEW pair coords. The OLD
// partner row, whose pair is now broken (its mate's coords no longer match),
// is silently left with stale is_reciprocal=true. The fix is for runRecompute
// to also recompute the OLD coords (from e.Record.Original()) when they differ
// from the new coords.
func TestHook_RequesterIDMutationRecomputesOldPair(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)
	registerHooksOnApp(app)

	// Precondition: pair (100, 200) both resolved → both reciprocal=true.
	rowAB := makeRequest(t, app, 100, 200, "bunk_with", "resolved")
	rowBA := makeRequest(t, app, 200, 100, "bunk_with", "resolved")
	gotBA, _ := app.FindRecordById("bunk_requests", rowBA.Id)
	if !gotBA.GetBool("is_reciprocal") {
		t.Fatalf("precondition: B→A expected reciprocal=true, got false")
	}

	// Mutate A→B's requester_id from 100 → 300. The (100, 200) pair coords are
	// now orphaned: B→A still points at requester 100, but no row at (100, 200)
	// exists any more. B→A's is_reciprocal must flip to false.
	rowAB.Set("requester_id", 300)
	err = app.Save(rowAB)
	if err != nil {
		t.Fatalf("save mutated AB: %v", err)
	}

	gotBA, err = app.FindRecordById("bunk_requests", rowBA.Id)
	if err != nil {
		t.Fatalf("reload BA: %v", err)
	}
	if gotBA.GetBool("is_reciprocal") {
		t.Errorf("after requester_id mutation: B→A expected is_reciprocal=false (old pair orphaned), got true")
	}
}
