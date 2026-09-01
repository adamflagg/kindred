package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestBunkAssignmentsOrphanSweep_SurvivesReplay applies the shared kindred#2626
// replay guard (orphan_replay_test.go) to the REAL bunk_assignments write path
// (processAssignment, which calls TrackProcessedCompositeKey) and the REAL
// bunk_assignments orphan sweep (deleteOrphans, whose getIDFunc is the sweep's
// own key builder), driven twice over one unchanged pair of assignments.
// kindred#2643.
//
// This is the service with the most copies of one key format in the tree: FOUR
// sites build "person:session:bunk", as processAssignment's own comment says --
// itself, deleteOrphans's orphan key, protectNonActiveStaffAssignments, and the
// values preloadExistingAssignments indexes for kindred#2465's unresolved-session
// branch. This test pins the pair that DELETES when they disagree.
//
// The fixture is deliberately the family-style shape (one person, one session,
// two bunks): the two write keys then differ ONLY in the bunk component, so a
// key that dropped bunk -- the exact widening kindred#2259 added and the exact
// thing an un-widened orphan key would undo -- collapses them onto one, and one
// of the two rows is deleted in the run that wrote it.
//
// It reuses setupBunkAssignmentGrainCollections (bunk_assignments_grain_test.go)
// rather than building a fourth copy: that fixture already carries every
// collection loadMappings walks, plus production's post-kindred#2259 unique
// index (year, person, session, bunk) -- grain.go's declared
// idx_bunk_assignments_person_session_bunk_year -- which is what makes a wrongly
// rebuilt existing-records map fail loudly instead of silently double-inserting.
func TestBunkAssignmentsOrphanSweep_SurvivesReplay(t *testing.T) {
	t.Parallel()

	grain := declaredFullGrain(t, "bunk_assignments", "bunk_assignments")

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupBunkAssignmentGrainCollections(t, app)

	const year = 2026
	const personCMID = 9300001
	const planCMID = 8401
	const sessionCMID = 5401
	const bunkACMID = 6401
	const bunkBCMID = 6402
	filter := fmt.Sprintf("year = %d", year)

	saveRecord(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	sessionPBID := saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": sessionCMID, "year": year})
	bunkAPBID := saveRecord(t, app, "bunks", map[string]any{"cm_id": bunkACMID, "name": "Cabin 1", "year": year})
	bunkBPBID := saveRecord(t, app, "bunks", map[string]any{"cm_id": bunkBCMID, "name": "Cabin 2", "year": year})

	// loadMappings derives validPersonCMIDs and personEnrollments from attendees,
	// and bunkPlanBunkToSession from bunk_plans -- so both are seeded rather than
	// hand-set, and the run below builds its maps the way production does.
	saveRecord(t, app, "attendees", map[string]any{
		"person_id": personCMID, "session": sessionPBID, "status_id": 2, "year": year})
	saveRecord(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": bunkAPBID, "session": sessionPBID, "year": year})
	saveRecord(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": bunkBPBID, "session": sessionPBID, "year": year})

	assignments := []map[string]any{
		{
			"PersonID": float64(personCMID), "BunkID": float64(bunkACMID),
			"BunkPlanID": float64(planCMID), "SessionID": float64(sessionCMID),
			"ID": float64(740001),
		},
		{
			"PersonID": float64(personCMID), "BunkID": float64(bunkBCMID),
			"BunkPlanID": float64(planCMID), "SessionID": float64(sessionCMID),
			"ID": float64(740002),
		},
	}

	client := newParallelTestCampMinderClient(t, year)

	// Shared across WriteFixture and Sweep within one run -- deleteOrphans reads
	// s.ProcessedKeys, which processAssignment (via TrackProcessedCompositeKey)
	// fills on the SAME *BunkAssignmentsSync instance.
	var s *BunkAssignmentsSync

	assertOrphanSweepSurvivesReplay(t, replayOrphanSweepConfig{
		WriteFixture: func(t replayT) error {
			// A fresh service per run is what Sync()'s own reset block amounts
			// to -- and loadMappings rebuilds its eight maps from scratch for
			// the same reason (kindred#2465: the orchestrator reuses one
			// instance, and append-shaped maps that survived a run made run 2
			// read one bunk_plans row as two candidates).
			s = NewBunkAssignmentsSync(app, client)
			if err := s.loadMappings(); err != nil {
				return fmt.Errorf("loadMappings: %w", err)
			}

			// The REAL preload, not the thing under test: it is what makes run 2
			// an update rather than a second create. Skipping it would trip the
			// unique index, a bug in this harness rather than the key
			// disagreement being hunted.
			existing, _, err := s.preloadExistingAssignments(year)
			if err != nil {
				return fmt.Errorf("preloadExistingAssignments: %w", err)
			}

			for _, assignment := range assignments {
				if err := s.processAssignment(assignment, existing); err != nil {
					return fmt.Errorf("processAssignment(bunk=%v): %w", assignment["BunkID"], err)
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
			rows, err := app.FindRecordsByFilter("bunk_assignments", filter, "", 0, 0)
			if err != nil {
				t.Fatalf("query bunk_assignments: %v", err)
			}
			return len(rows)
		},
		WantRows: len(assignments),
	})

	assertTrackedKeysMatchGrain(t, &grain, s.ProcessedKeys, year)
}

// bunkAssignmentReplayRelation is a tiny readability helper for the assertion
// below: it resolves one relation field on a stored bunk_assignments row back to
// the related record's cm_id.
func bunkAssignmentReplayRelation(t *testing.T, app core.App, row *core.Record, field, collection string) int {
	t.Helper()
	related, err := app.FindRecordById(collection, row.GetString(field))
	if err != nil {
		t.Fatalf("resolve %s on row %s: %v", field, row.Id, err)
	}
	return int(related.GetFloat("cm_id"))
}

// TestBunkAssignmentsOrphanSweep_ReplayKeepsBothBunks names the SURVIVORS rather
// than counting them. The replay guard above asserts a row count, which answers
// "the sweep deleted the right NUMBER"; this answers "the right ROWS" -- both
// bunks are still there after two runs, so a collapse that deleted one and left
// the other cannot pass as a healthy count of two.
func TestBunkAssignmentsOrphanSweep_ReplayKeepsBothBunks(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupBunkAssignmentGrainCollections(t, app)

	const year = 2026
	const personCMID = 9300002
	const planCMID = 8402
	const sessionCMID = 5402
	const bunkACMID = 6403
	const bunkBCMID = 6404

	saveRecord(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	sessionPBID := saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": sessionCMID, "year": year})
	bunkAPBID := saveRecord(t, app, "bunks", map[string]any{"cm_id": bunkACMID, "name": "Cabin 3", "year": year})
	bunkBPBID := saveRecord(t, app, "bunks", map[string]any{"cm_id": bunkBCMID, "name": "Cabin 4", "year": year})
	saveRecord(t, app, "attendees", map[string]any{
		"person_id": personCMID, "session": sessionPBID, "status_id": 2, "year": year})
	saveRecord(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": bunkAPBID, "session": sessionPBID, "year": year})
	saveRecord(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": bunkBPBID, "session": sessionPBID, "year": year})

	client := newParallelTestCampMinderClient(t, year)

	for run := 1; run <= 2; run++ {
		s := NewBunkAssignmentsSync(app, client)
		if mapErr := s.loadMappings(); mapErr != nil {
			t.Fatalf("run %d: loadMappings: %v", run, mapErr)
		}
		existing, _, preloadErr := s.preloadExistingAssignments(year)
		if preloadErr != nil {
			t.Fatalf("run %d: preloadExistingAssignments: %v", run, preloadErr)
		}
		for i, bunkCMID := range []int{bunkACMID, bunkBCMID} {
			assignment := map[string]any{
				"PersonID": float64(personCMID), "BunkID": float64(bunkCMID),
				"BunkPlanID": float64(planCMID), "SessionID": float64(sessionCMID),
				"ID": float64(750000 + i),
			}
			if processErr := s.processAssignment(assignment, existing); processErr != nil {
				t.Fatalf("run %d: processAssignment(bunk=%d): %v", run, bunkCMID, processErr)
			}
		}
		s.SyncSuccessful = true
		if sweepErr := s.deleteOrphans(); sweepErr != nil {
			t.Fatalf("run %d: deleteOrphans: %v", run, sweepErr)
		}
	}

	rows, err := app.FindRecordsByFilter("bunk_assignments", fmt.Sprintf("year = %d", year), "", 0, 0)
	if err != nil {
		t.Fatalf("query bunk_assignments: %v", err)
	}
	survivors := make(map[int]bool, len(rows))
	for _, row := range rows {
		survivors[bunkAssignmentReplayRelation(t, app, row, "bunk", "bunks")] = true
	}
	for _, bunkCMID := range []int{bunkACMID, bunkBCMID} {
		if !survivors[bunkCMID] {
			t.Errorf("bunk %d's assignment did not survive the replay -- the sweep's own getIDFunc "+
				"built a key TrackProcessedCompositeKey never recorded, so it read a row this run "+
				"wrote as an orphan (kindred#2626)", bunkCMID)
		}
	}
}
