package main

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	bunkrequests "github.com/camp/kindred/pocketbase/bunk_requests"
)

func setupBunkRequestsCollection(t *testing.T, app core.App) {
	t.Helper()
	col := core.NewBaseCollection("bunk_requests")
	col.Fields.Add(&core.NumberField{Name: "requester_id", Required: true})
	col.Fields.Add(&core.NumberField{Name: "requestee_id"})
	col.Fields.Add(&core.SelectField{
		Name: "request_type", Required: true,
		Values: []string{"bunk_with", "not_bunk_with", "age_preference"}, MaxSelect: 1,
	})
	col.Fields.Add(&core.SelectField{
		Name: "status", Required: true,
		Values: []string{"pending", "resolved", "declined"}, MaxSelect: 1,
	})
	col.Fields.Add(&core.NumberField{Name: "year", Required: true})
	col.Fields.Add(&core.NumberField{Name: "session_id", Required: true})
	col.Fields.Add(&core.BoolField{Name: "is_reciprocal"})
	if err := app.Save(col); err != nil {
		t.Fatalf("setup: %v", err)
	}
}

func TestBackfill_FixesStaleRow(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setupBunkRequestsCollection(t, app)

	// Insert a row that's intentionally stale: is_reciprocal=true on a row
	// whose partner does NOT exist. Mirrors the production bug pattern.
	col, err := app.FindCollectionByNameOrId("bunk_requests")
	if err != nil {
		t.Fatalf("find collection: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("requester_id", 100)
	r.Set("requestee_id", 200)
	r.Set("request_type", "bunk_with")
	r.Set("status", "resolved")
	r.Set("year", 2026)
	r.Set("session_id", 1235404)
	r.Set("is_reciprocal", true) // <-- STALE
	if err = app.Save(r); err != nil {
		t.Fatal(err)
	}

	if _, err = bunkrequests.BackfillAll(app); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	got, err := app.FindRecordById("bunk_requests", r.Id)
	if err != nil {
		t.Fatalf("reload row: %v", err)
	}
	if got.GetBool("is_reciprocal") {
		t.Errorf("backfill failed to fix stale row: still is_reciprocal=true")
	}
}
