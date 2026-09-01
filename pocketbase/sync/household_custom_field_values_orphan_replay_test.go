//nolint:dupl // Deliberate twin of person_custom_field_values_orphan_replay_test.go; the test's doc comment says why.
package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestHouseholdCustomFieldValuesOrphanSweep_SurvivesReplay applies the shared
// kindred#2626 replay guard (orphan_replay_test.go) to the REAL
// household_custom_values write path (processHouseholdCustomFieldValue, which
// calls TrackProcessedCompositeKey) and the REAL sweep (deleteOrphans, whose
// getIDFunc is the sweep's own key builder), driven twice over one unchanged
// pair of values. kindred#2643.
//
// The household twin of TestPersonCustomFieldValuesOrphanSweep_SurvivesReplay,
// and wired separately rather than shared with it on purpose: the two services
// keep two independent copies of the same key pair, in two files
// (kindred#2270's own comment at processHouseholdCustomFieldValue calls them
// twins), and a guard that only ran against one of them would leave the other
// exactly as unpinned as it was before. Folding both into one table-driven test
// would additionally make each failure name a table row instead of the service
// whose key pair actually broke. Same shape, same sweptOwners narrowing,
// different code -- hence the file-level nolint:dupl above.
func TestHouseholdCustomFieldValuesOrphanSweep_SurvivesReplay(t *testing.T) {
	t.Parallel()

	grain := declaredFullGrain(t, "household_custom_values", "household_custom_values")

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupCustomValuesReplayCollection(t, app, "household_custom_values", "household", &grain)

	const year = 2026
	const householdCMID = 9500001
	const fieldDefAPBID = "pb_field_300"
	const fieldDefBPBID = "pb_field_400"
	filter := fmt.Sprintf("year = %d", year)

	// Two field definitions for one household, not one: the write key's identity
	// half is (household, field_definition), so a key that dropped either
	// component collapses these two onto one and the sweep deletes the loser.
	fieldDefMapping := map[int]string{300: fieldDefAPBID, 400: fieldDefBPBID}
	entries := []map[string]any{
		{"id": float64(300), "value": "Two nights"},
		{"id": float64(400), "value": "Lower Meadow"},
	}

	// sweptOwners as Sync builds it: the owners this run actually fetched.
	sweptOwners := map[string]bool{testHouseholdPBID: true}

	// preloadFn is syncHouseholdCustomFieldValues' own preload key builder,
	// repeated here for the same reason its person twin is: it is NOT the thing
	// under test, it is what makes run 2 an update rather than a second create,
	// and leaving it out would trip the unique index -- a bug in this harness
	// rather than the key disagreement being hunted.
	preloadFn := func(record *core.Record) (string, bool) {
		householdPBId := record.GetString("household")
		fieldDefPBId := record.GetString("field_definition")
		if householdPBId != "" && fieldDefPBId != "" {
			return fmt.Sprintf("%s:%s", householdPBId, fieldDefPBId), true
		}
		return "", false
	}

	// Shared across WriteFixture and Sweep within one run -- deleteOrphans reads
	// s.ProcessedKeys, which processHouseholdCustomFieldValue (via
	// TrackProcessedCompositeKey) fills on the SAME service instance.
	var s *HouseholdCustomFieldValuesSync

	assertOrphanSweepSurvivesReplay(t, replayOrphanSweepConfig{
		// Positive control: a value for a THIRD field definition this run never
		// processes, on an owner that IS in sweptOwners -- so the sweep's
		// getIDFunc keys it rather than skipping it, and nothing tracks that
		// key. A LIVE sweep must delete it. Without this the test passes with
		// the sweep switched off; see SeedOrphan.
		SeedOrphan: func(_ replayT) error {
			saveRecord(t, app, "household_custom_values", map[string]any{
				"household": testHouseholdPBID, "field_definition": "pb_field_999",
				"value": "swept", "year": year})
			return nil
		},
		WriteFixture: func(t replayT) error {
			// A fresh service per run is what Sync()'s own reset amounts to.
			s = &HouseholdCustomFieldValuesSync{BaseSyncService: BaseSyncService{
				App: app, ProcessedKeys: map[string]bool{},
			}}

			existingRecords, err := s.PreloadCompositeRecords("household_custom_values", filter, preloadFn)
			if err != nil {
				return fmt.Errorf("PreloadCompositeRecords: %w", err)
			}

			for _, entry := range entries {
				if err := s.processHouseholdCustomFieldValue(
					entry, householdCMID, testHouseholdPBID, year, fieldDefMapping, existingRecords); err != nil {
					return fmt.Errorf("processHouseholdCustomFieldValue(field=%v): %w", entry["id"], err)
				}
			}
			if s.Stats.Rejected != 0 {
				return fmt.Errorf("Stats.Rejected = %d, want 0 -- a rejection abandons the sweep "+
					"outright (skipSweepForRejections), which would make this replay vacuous",
					s.Stats.Rejected)
			}
			s.SyncSuccessful = true
			return nil
		},
		Sweep: func(t replayT) error {
			if err := s.deleteOrphans(year, sweptOwners); err != nil {
				return fmt.Errorf("deleteOrphans: %w", err)
			}
			if s.Stats.Errors != 0 {
				return fmt.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
			}
			return nil
		},
		CountRows: func(t replayT) int {
			rows, err := app.FindRecordsByFilter("household_custom_values", filter, "", 0, 0)
			if err != nil {
				t.Fatalf("query household_custom_values: %v", err)
			}
			return len(rows)
		},
		WantRows: len(entries),
	})

	assertTrackedKeysMatchGrain(t, &grain, s.ProcessedKeys, year)
}
