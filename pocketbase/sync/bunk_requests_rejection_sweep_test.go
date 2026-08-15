package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// This file pins the kindred#2295 safety precondition against
// BunkRequestsSync's two hand-rolled sweeps.
//
// purgeOrphanedRequests / purgeZombieBRs predate kindred#2292 and were never
// migrated onto BaseSyncService.DeleteOrphansGuarded, so they never picked up
// OrphanSweepGuard's Rejected arm. Before #2292, a malformed CSV row bumped
// Stats.Errors, which fails the whole run via applyCompletionStatus -- so an
// operator saw the deletion. #2292 reclassifies that same row into
// Stats.Rejected (warn-only, deliberately absent from applyCompletionStatus),
// which means the same person's real, still-valid original_bunk_requests rows
// now get silently purged as "orphaned" (their PersonID never made it into
// s.csvPersonIDs) and the run reports success. orphan_guard.go's own doc
// predicted exactly this: "a future reclassification into one of [the
// hand-rolled sweeps] gets ... no rejection protection and no warning."

// newBunkRequestsPurgeTestApp builds persons + a real relation-typed
// original_bunk_requests.requester (unlike newBunkRequestsTestApp's plain
// TextField, which purgeOrphanedRequests' ExpandedOne("requester") can't
// read) + bunk_requests, the three collections the two sweeps touch.
func newBunkRequestsPurgeTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	if saveErr := app.Save(persons); saveErr != nil {
		t.Fatalf("save persons: %v", saveErr)
	}

	obr := core.NewBaseCollection("original_bunk_requests")
	obr.Fields.Add(&core.RelationField{Name: "requester", CollectionId: persons.Id, MaxSelect: 1})
	obr.Fields.Add(&core.NumberField{Name: "year"})
	obr.Fields.Add(&core.TextField{Name: "field"})
	obr.Fields.Add(&core.TextField{Name: "content"})
	if saveErr := app.Save(obr); saveErr != nil {
		t.Fatalf("save original_bunk_requests: %v", saveErr)
	}

	brs := core.NewBaseCollection("bunk_requests")
	brs.Fields.Add(&core.NumberField{Name: "requester_id"})
	brs.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(brs); saveErr != nil {
		t.Fatalf("save bunk_requests: %v", saveErr)
	}

	return app
}

// seedOBR writes one original_bunk_requests row for personCMID, relating it
// to a freshly created persons row.
func seedOBR(t *testing.T, app core.App, personCMID, year int) {
	t.Helper()

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", personCMID)
	if saveErr := app.Save(person); saveErr != nil {
		t.Fatalf("seed person %d: %v", personCMID, saveErr)
	}

	obrCol, err := app.FindCollectionByNameOrId("original_bunk_requests")
	if err != nil {
		t.Fatalf("find original_bunk_requests: %v", err)
	}
	obr := core.NewRecord(obrCol)
	obr.Set("requester", person.Id)
	obr.Set("year", year)
	obr.Set("field", "bunk_request_form")
	obr.Set("content", "wants to bunk with Olivia Martinez")
	if saveErr := app.Save(obr); saveErr != nil {
		t.Fatalf("seed OBR for person %d: %v", personCMID, saveErr)
	}
}

// TestPurgeOrphanedRequests_SkipsWhenRunHadRejections is the failing-first
// test for the fix: a run that rejected at least one CSV row must not treat
// that row's absence from csvPersonIDs as proof the person left camp.
func TestPurgeOrphanedRequests_SkipsWhenRunHadRejections(t *testing.T) {
	t.Parallel()

	app := newBunkRequestsPurgeTestApp(t)
	seedOBR(t, app, 9001, 2026)

	s := NewBunkRequestsSync(app, nil)
	// 9001's row is real and current, but its own CSV row was rejected this run
	// (e.g. an Excel-mangled PersonID cell), so it never reached csvPersonIDs --
	// even though other rows in the same CSV processed fine (9002).
	s.csvPersonIDs = map[int]bool{9002: true}
	s.Stats.Rejected = 1

	if _, err := s.purgeOrphanedRequests(2026); err != nil {
		t.Fatalf("purgeOrphanedRequests: %v", err)
	}

	rows, findErr := app.FindRecordsByFilter("original_bunk_requests", "", "", 0, 0)
	if findErr != nil {
		t.Fatalf("re-query OBRs: %v", findErr)
	}
	if len(rows) != 1 {
		t.Errorf("purgeOrphanedRequests deleted the row of a run that had rejections: got %d OBRs, want 1", len(rows))
	}
}

// TestPurgeOrphanedRequests_StillPurgesWithoutRejections is the regression
// guard: a clean run (Rejected == 0) with a genuinely orphaned person must
// still purge, so the fix cannot be a blanket "never delete".
func TestPurgeOrphanedRequests_StillPurgesWithoutRejections(t *testing.T) {
	t.Parallel()

	app := newBunkRequestsPurgeTestApp(t)
	seedOBR(t, app, 9001, 2026)

	s := NewBunkRequestsSync(app, nil)
	// 9001 genuinely absent from this year's CSV; 9002 is present so the
	// pre-existing "empty CSV" fresh-deploy guard doesn't also explain a pass.
	s.csvPersonIDs = map[int]bool{9002: true}
	s.Stats.Rejected = 0

	if _, err := s.purgeOrphanedRequests(2026); err != nil {
		t.Fatalf("purgeOrphanedRequests: %v", err)
	}

	rows, findErr := app.FindRecordsByFilter("original_bunk_requests", "", "", 0, 0)
	if findErr != nil {
		t.Fatalf("re-query OBRs: %v", findErr)
	}
	if len(rows) != 0 {
		t.Errorf("a clean run's genuine orphan survived: got %d OBRs, want 0", len(rows))
	}
}
