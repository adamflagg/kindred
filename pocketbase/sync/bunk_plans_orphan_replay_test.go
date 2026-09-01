package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// setupBunkPlansReplayCollections builds the three collections
// TestBunkPlansOrphanSweep_SurvivesReplay drives: bunks and camp_sessions
// (createBunkPlan's two REQUIRED relations, both resolved through
// LookupRelation), and bunk_plans itself carrying production's own UNIQUE index
// -- the one grain.go names for this collection, (year, bunk, session, cm_id),
// from migration 1500000017.
//
// A purpose-built setup rather than sync_testsupport_test.go's
// addBunkPlansCollection, for the index: that shared builder deliberately omits
// it, and without it a second run whose existing-plans map was rebuilt WRONG
// would quietly insert a duplicate row, failing the replay on a count that says
// nothing about the sweep. Every collection carries "created" because
// PaginateRecords (base_sync.go) hardcodes "-created" as its sort field and
// loadMappings walks all three.
func setupBunkPlansReplayCollections(t *testing.T, app core.App, grain *CollectionGrain) {
	t.Helper()

	bunks := core.NewBaseCollection("bunks")
	bunks.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	bunks.Fields.Add(&core.TextField{Name: "name"})
	bunks.Fields.Add(&core.NumberField{Name: "year"})
	bunks.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(bunks); err != nil {
		t.Fatalf("create bunks: %v", err)
	}

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.TextField{Name: "name"})
	sessions.Fields.Add(&core.TextField{Name: "session_type"})
	sessions.Fields.Add(&core.NumberField{Name: "year", Required: true})
	sessions.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	plans := core.NewBaseCollection("bunk_plans")
	plans.Fields.Add(&core.NumberField{Name: "cm_id"})
	plans.Fields.Add(&core.RelationField{Name: "bunk", CollectionId: bunks.Id, MaxSelect: 1})
	plans.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	plans.Fields.Add(&core.TextField{Name: "name"})
	plans.Fields.Add(&core.TextField{Name: "code"})
	plans.Fields.Add(&core.BoolField{Name: "is_active"})
	plans.Fields.Add(&core.NumberField{Name: "year", Required: true})
	plans.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	plans.Indexes = []string{fmt.Sprintf(
		"CREATE UNIQUE INDEX `%s` ON `bunk_plans` (`year`, `bunk`, `session`, `cm_id`)",
		grain.UniqueIndex)}
	if err := app.Save(plans); err != nil {
		t.Fatalf("create bunk_plans: %v", err)
	}
}

// TestBunkPlansOrphanSweep_SurvivesReplay applies the shared kindred#2626 replay
// guard (orphan_replay_test.go) to the REAL bunk_plans write path
// (createBunkPlan, which calls TrackProcessedCompositeKey) and the REAL
// bunk_plans orphan sweep (deleteOrphans, whose getIDFunc is the sweep's own key
// builder), driven twice over one unchanged plan. kindred#2643.
//
// The two key builders here are genuinely separate code -- createBunkPlan's
// fmt.Sprintf("%d:%d:%d", planID, bunkCMID, sessionCMID) against deleteOrphans's
// fmt.Sprintf("%d:%d:%d|%d", planCMID, bunkCMID, sessionCMID, year), the latter
// reading its three CampMinder ids back out of a STORED row through
// BuildRecordCMIDMappings. Nothing but this test makes them move together.
func TestBunkPlansOrphanSweep_SurvivesReplay(t *testing.T) {
	t.Parallel()

	grain := declaredFullGrain(t, "bunk_plans", "bunk_plans")

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupBunkPlansReplayCollections(t, app, &grain)

	const year = 2026
	const planCMID = 8301
	const sessionCMID = 5301
	const bunkACMID = 6301
	const bunkBCMID = 6302
	filter := fmt.Sprintf("year = %d", year)

	sessionPBID := saveRecord(t, app, "camp_sessions", map[string]any{
		"cm_id": sessionCMID, "name": "Session 1", "session_type": sessionTypeMain, "year": year})
	saveRecord(t, app, "bunks", map[string]any{"cm_id": bunkACMID, "name": "Cabin 1", "year": year})
	saveRecord(t, app, "bunks", map[string]any{"cm_id": bunkBCMID, "name": "Cabin 2", "year": year})
	// A third bunk, used only by the SeedOrphan control below.
	orphanBunkPBID := saveRecord(t, app, "bunks",
		map[string]any{"cm_id": 6303, "name": "Cabin 3", "year": year})

	// Two bunks under one plan and one session, not a single row: the write key
	// carries three components, and a key that dropped the bunk would leave one
	// of these two standing while a single-row fixture read as healthy.
	bunkCMIDs := []int{bunkACMID, bunkBCMID}

	client := newParallelTestCampMinderClient(t, year)

	// Shared across WriteFixture and Sweep within one run -- deleteOrphans reads
	// s.ProcessedKeys, which createBunkPlan (via TrackProcessedCompositeKey)
	// fills on the SAME *BunkPlansSync instance.
	var s *BunkPlansSync

	assertOrphanSweepSurvivesReplay(t, replayOrphanSweepConfig{
		// Positive control: a plan row on a third bunk that createBunkPlan is
		// never called for. Its cm_id and both relations resolve, so the
		// sweep's getIDFunc keys it, and nothing tracks that key -- a LIVE
		// sweep must delete it. Without this the test passes with the sweep
		// switched off; see SeedOrphan.
		SeedOrphan: func(_ replayT) error {
			saveRecord(t, app, "bunk_plans", map[string]any{
				"cm_id": planCMID, "bunk": orphanBunkPBID, "session": sessionPBID,
				"name": "Summer Plan", "code": "SP", "year": year})
			return nil
		},
		WriteFixture: func(t replayT) error {
			// A fresh service per run is what Sync()'s own reset block amounts
			// to. loadMappings is then the REAL rebuild of s.existingPlans from
			// what the previous run left on disk -- not the thing under test,
			// but the thing that makes run 2 an update rather than a second
			// create. Skipping it would trip the unique index above, a bug in
			// this harness rather than the key disagreement being hunted.
			s = NewBunkPlansSync(app, client)
			if err := s.loadMappings(); err != nil {
				return fmt.Errorf("loadMappings: %w", err)
			}

			for _, bunkCMID := range bunkCMIDs {
				if err := s.createBunkPlan(
					planCMID, bunkCMID, sessionCMID, "Summer Plan", "SP", true); err != nil {
					return fmt.Errorf("createBunkPlan(bunk=%d): %w", bunkCMID, err)
				}
			}
			s.SyncSuccessful = true
			return nil
		},
		Sweep: func(t replayT) error {
			if err := s.deleteOrphans(); err != nil {
				return fmt.Errorf("deleteOrphans: %w", err)
			}
			if s.Stats.Errors != 0 {
				return fmt.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
			}
			return nil
		},
		CountRows: func(t replayT) int {
			rows, err := app.FindRecordsByFilter("bunk_plans", filter, "", 0, 0)
			if err != nil {
				t.Fatalf("query bunk_plans: %v", err)
			}
			return len(rows)
		},
		WantRows: len(bunkCMIDs),
	})

	assertTrackedKeysMatchGrain(t, &grain, s.ProcessedKeys, year)
}
