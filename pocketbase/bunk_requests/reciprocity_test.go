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
