package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// setupPersonsReplayCollections builds the one collection
// TestPersonsOrphanSweep_SurvivesReplay drives, shaped like production's:
// newPersonsTestApp (rejection_wrapper_test.go) already carries the five fields
// processPerson writes, and this adds the two things a REPLAY needs that a
// single-call test does not -- "created" (PaginateRecords hardcodes "-created"
// as its sort field) and production's own UNIQUE index, the one grain.go names
// for this collection.
//
// The index is the load-bearing addition. Without it, a second run whose
// existing-records map was rebuilt WRONG would quietly insert a duplicate row
// and the replay would fail on a row count that says nothing about the sweep.
// With it, that mistake is a uniqueness violation naming itself.
func setupPersonsReplayCollections(t *testing.T, app core.App, grain *CollectionGrain) {
	t.Helper()

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	persons.Fields.Add(&core.TextField{Name: "first_name"})
	persons.Fields.Add(&core.TextField{Name: "last_name"})
	persons.Fields.Add(&core.NumberField{Name: "year", Required: true})
	persons.Fields.Add(&core.BoolField{Name: "is_camper"})
	persons.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	persons.Indexes = []string{fmt.Sprintf(
		"CREATE UNIQUE INDEX `%s` ON `persons` (`cm_id`, `year`)", grain.UniqueIndex)}
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}
}

// TestPersonsOrphanSweep_SurvivesReplay applies the shared kindred#2626 replay
// guard (orphan_replay_test.go) to the REAL persons write path (processPerson,
// which calls TrackProcessedKey) and the REAL persons orphan sweep
// (deleteOrphans, whose getIDFunc is the sweep's own key builder), driven twice
// over one unchanged pair of people. kindred#2643.
//
// persons is the one of the six guarded services whose two key builders both go
// through CompositeKey -- grain.go says so at the declaration, "which is why
// this pair cannot drift the way the composite-key services can". That is a
// reason to wire it anyway rather than a reason to skip it: the claim is about
// today's code, this test is what keeps it true, and "both sides call the same
// helper" is exactly the property a future widening (a person key that grows a
// second component) would quietly end.
func TestPersonsOrphanSweep_SurvivesReplay(t *testing.T) {
	t.Parallel()

	grain := declaredFullGrain(t, "persons", "persons")

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupPersonsReplayCollections(t, app, &grain)

	const year = 2026
	filter := fmt.Sprintf("year = %d", year)

	// Two people, not one: a key that collapsed its identity component would
	// leave one row standing and a single-row fixture could not tell that from
	// a healthy run.
	people := []map[string]any{
		{
			"ID":            float64(9200001),
			"CamperDetails": map[string]any{},
			"Name":          map[string]any{"First": "Emma", "Last": "Johnson"},
		},
		{
			"ID":            float64(9200002),
			"CamperDetails": map[string]any{},
			"Name":          map[string]any{"First": "Liam", "Last": "Johnson"},
		},
	}

	// Shared across WriteFixture and Sweep within one run -- deleteOrphans reads
	// s.ProcessedKeys, which processPerson (via TrackProcessedKey) fills on the
	// SAME *PersonsSync instance.
	var s *PersonsSync

	assertOrphanSweepSurvivesReplay(t, replayOrphanSweepConfig{
		// Positive control: one person the fixture never processes. cm_id is
		// non-zero so the sweep's getIDFunc keys it, and nothing tracks that
		// key, so a LIVE sweep must delete it. Without this the whole test
		// passes with the sweep switched off -- see SeedOrphan.
		SeedOrphan: func(_ replayT) error {
			saveRecord(t, app, "persons", map[string]any{
				"cm_id": 9200003, "first_name": "Noah", "last_name": "Johnson", "year": year})
			return nil
		},
		WriteFixture: func(t replayT) error {
			// A fresh service per run is what Sync()'s own reset block amounts
			// to: cleared ProcessedKeys, zeroed Stats, and an existing-records
			// map re-derived from disk rather than carried over.
			s = NewPersonsSync(app, nil)

			// preloadExistingPersons is the REAL preload Sync runs, and it is
			// not the thing under test -- it is what makes run 2 an update
			// rather than a second create. Skipping it would trip the unique
			// index above, a bug in this harness rather than the key
			// disagreement the test exists to catch.
			existing := s.preloadExistingPersons(filter, year)

			for _, personData := range people {
				if err := s.processPerson(
					personData, true, existing, map[string]string{}, map[int]string{}, year); err != nil {
					return fmt.Errorf("processPerson(%v): %w", personData["ID"], err)
				}
			}
			s.SyncSuccessful = true
			return nil
		},
		Sweep: func(t replayT) error {
			if err := s.deleteOrphans(year); err != nil {
				return fmt.Errorf("deleteOrphans: %w", err)
			}
			if s.Stats.Errors != 0 {
				return fmt.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
			}
			return nil
		},
		CountRows: func(t replayT) int {
			rows, err := app.FindRecordsByFilter("persons", filter, "", 0, 0)
			if err != nil {
				t.Fatalf("query persons: %v", err)
			}
			return len(rows)
		},
		WantRows: len(people),
	})

	// Run 2's tracked keys are still in ProcessedKeys, so the shape check runs
	// against what the real write path actually built.
	assertTrackedKeysMatchGrain(t, &grain, s.ProcessedKeys, year)
}
