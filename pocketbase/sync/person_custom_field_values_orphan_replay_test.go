package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// setupCustomValuesReplayCollection builds one custom-values collection --
// person_custom_values or household_custom_values -- shaped the way the write
// path and the sweep actually read it: an owner relation column, a
// field_definition column, value/last_updated, and production's own UNIQUE
// index, the one grain.go names for that collection.
//
// A purpose-built setup rather than newOrphanSweepTestApp (orphan_sweep_test.go)
// for two reasons: that fixture carries no unique index, and a REPLAY is exactly
// where one earns its keep -- a second run whose existing-records map was
// rebuilt WRONG would quietly insert a duplicate row and fail the replay on a
// count that says nothing about the sweep. "created" is present because
// PaginateRecords (base_sync.go) hardcodes "-created" as its sort field.
//
// owner is "person" or "household"; the index column order matches the
// migrations exactly (1500000028 and 1500000029).
func setupCustomValuesReplayCollection(
	t *testing.T, app core.App, collection, owner string, grain *CollectionGrain,
) {
	t.Helper()

	col := core.NewBaseCollection(collection)
	col.Fields.Add(&core.TextField{Name: owner})
	col.Fields.Add(&core.TextField{Name: "field_definition"})
	col.Fields.Add(&core.TextField{Name: "value"})
	col.Fields.Add(&core.TextField{Name: "last_updated"})
	col.Fields.Add(&core.NumberField{Name: "year", Required: true})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	col.Indexes = []string{fmt.Sprintf(
		"CREATE UNIQUE INDEX `%s` ON `%s` (`year`, `%s`, `field_definition`)",
		grain.UniqueIndex, collection, owner)}
	if err := app.Save(col); err != nil {
		t.Fatalf("create %s: %v", collection, err)
	}
}

// TestPersonCustomFieldValuesOrphanSweep_SurvivesReplay applies the shared
// kindred#2626 replay guard (orphan_replay_test.go) to the REAL
// person_custom_values write path (processPersonCustomFieldValue, which calls
// TrackProcessedCompositeKey) and the REAL sweep (deleteOrphans, whose getIDFunc
// is the sweep's own key builder), driven twice over one unchanged pair of
// values. kindred#2643.
//
// Two things make this service's pair worth pinning specifically. Its identity
// half is POCKETBASE ids, not CampMinder ids -- the sweep reads relation columns
// straight off the stored row while the write path is handed the ids by its
// caller, so the two never touch the same variable. And its sweep is narrowed by
// sweptOwners, the set kindred#2266 added so a session-scoped run cannot judge
// the rest of the year: a row whose owner is in that set IS a deletion candidate,
// which is precisely the state this replay puts the fixture in.
func TestPersonCustomFieldValuesOrphanSweep_SurvivesReplay(t *testing.T) {
	t.Parallel()

	grain := declaredFullGrain(t, "person_custom_values", "person_custom_values")

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupCustomValuesReplayCollection(t, app, "person_custom_values", "person", &grain)

	const year = 2026
	const personCMID = 9400001
	const otherFieldDefPBID = "pb_field_200"
	filter := fmt.Sprintf("year = %d", year)

	// Two field definitions for one person, not one: the write key's identity
	// half is (person, field_definition), so a key that dropped either component
	// collapses these two onto one and the sweep deletes the loser.
	fieldDefMapping := map[int]string{100: testFieldDefPBIDPerson, 200: otherFieldDefPBID}
	entries := []map[string]any{
		{"id": float64(100), "value": "Vegetarian"},
		{"id": float64(200), "value": "Upper Meadow"},
	}

	// sweptOwners as Sync builds it: the owners this run actually fetched.
	sweptOwners := map[string]bool{testPersonPBID: true}

	// preloadFn is syncPersonCustomFieldValues' own preload key builder, repeated
	// here for the same reason attendeesExistingForReplay repeats attendees'
	// (attendees_orphan_replay_test.go): it is NOT the thing under test, it is
	// what makes run 2 an update rather than a second create, and leaving it out
	// would trip the unique index -- a bug in this harness rather than the key
	// disagreement being hunted.
	preloadFn := func(record *core.Record) (string, bool) {
		personPBId := record.GetString("person")
		fieldDefPBId := record.GetString("field_definition")
		if personPBId != "" && fieldDefPBId != "" {
			return fmt.Sprintf("%s:%s", personPBId, fieldDefPBId), true
		}
		return "", false
	}

	// Shared across WriteFixture and Sweep within one run -- deleteOrphans reads
	// s.ProcessedKeys, which processPersonCustomFieldValue (via
	// TrackProcessedCompositeKey) fills on the SAME service instance.
	var s *PersonCustomFieldValuesSync

	assertOrphanSweepSurvivesReplay(t, replayOrphanSweepConfig{
		// Positive control: a value for a THIRD field definition this run never
		// processes, on an owner that IS in sweptOwners -- so the sweep's
		// getIDFunc keys it rather than skipping it, and nothing tracks that
		// key. A LIVE sweep must delete it. Without this the test passes with
		// the sweep switched off; see SeedOrphan.
		SeedOrphan: func(_ replayT) error {
			saveRecord(t, app, "person_custom_values", map[string]any{
				"person": testPersonPBID, "field_definition": "pb_field_999",
				"value": "swept", "year": year})
			return nil
		},
		WriteFixture: func(t replayT) error {
			// A fresh service per run is what Sync()'s own reset amounts to.
			s = &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
				App: app, ProcessedKeys: map[string]bool{},
			}}

			existingRecords, err := s.PreloadCompositeRecords("person_custom_values", filter, preloadFn)
			if err != nil {
				return fmt.Errorf("PreloadCompositeRecords: %w", err)
			}

			for _, entry := range entries {
				if err := s.processPersonCustomFieldValue(
					entry, personCMID, testPersonPBID, year, fieldDefMapping, existingRecords); err != nil {
					return fmt.Errorf("processPersonCustomFieldValue(field=%v): %w", entry["id"], err)
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
			rows, err := app.FindRecordsByFilter("person_custom_values", filter, "", 0, 0)
			if err != nil {
				t.Fatalf("query person_custom_values: %v", err)
			}
			return len(rows)
		},
		WantRows: len(entries),
	})

	assertTrackedKeysMatchGrain(t, &grain, s.ProcessedKeys, year)
}
