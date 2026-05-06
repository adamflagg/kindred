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
	col.Fields.Add(&core.NumberField{Name: "session_id"})
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
	if err := RecomputePairReciprocity(app, 2026, 1235404, 100, 200, "bunk_with"); err != nil {
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

// registerHooksOnApp wires the same three success hooks RegisterHooks does,
// but takes a core.App (which the *tests.TestApp implements). We can't pass
// *tests.TestApp to RegisterHooks because it expects *pocketbase.PocketBase.
func registerHooksOnApp(app core.App) {
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
	if err := app.Delete(rowAB); err != nil {
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
