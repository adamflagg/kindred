package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// The tests in this file pin kindred#2347's persons.go correction: the two
// updateRelationsAndCleanup call sites downgraded a real error from
// deleteOrphans / deleteHouseholdOrphans to slog.Warn and dropped it, so a
// query failure that aborted the sweep never touched Stats.Errors and the
// persons run still reported success. Each site is forced to fail by omitting
// the collection its query targets -- a real error from a real PocketBase
// call, not a mock.

// newMinimalPersonsTestApp returns a test app with only a "persons"
// collection, holding the fields the two queries this file drives touch:
// `year` (the sweep's filter) and the three relation-shaped fields
// updatePersonHouseholdRelations filters on. No "households" collection.
func newMinimalPersonsTestApp(t *testing.T) core.App {
	t.Helper()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("persons")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	for _, f := range []string{"household", "primary_childhood_household", "alternate_childhood_household"} {
		col.Fields.Add(&core.TextField{Name: f})
	}
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save persons: %v", saveErr)
	}

	return app
}

// TestUpdateRelationsAndCleanupCountsHouseholdSweepFailure drives
// updateRelationsAndCleanup with a "persons" collection but no "households"
// collection, so deleteHouseholdOrphans's own query fails for real
// (FindRecordsByFilter against a collection that does not exist).
func TestUpdateRelationsAndCleanupCountsHouseholdSweepFailure(t *testing.T) {
	t.Parallel()

	app := newMinimalPersonsTestApp(t)
	s := &PersonsSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}

	s.updateRelationsAndCleanup(2026, map[int]*core.Record{}, map[int]personHouseholdIDs{}, map[int]bool{})

	if s.Stats.Errors != 1 {
		t.Errorf("Stats.Errors = %d, want 1 -- deleteHouseholdOrphans's query failed for real "+
			"and must not be downgraded to a Warn that reaches nothing", s.Stats.Errors)
	}
}

// TestUpdateRelationsAndCleanupCountsPersonSweepFailure drives
// updateRelationsAndCleanup with a "households" collection but no "persons"
// collection, so deleteOrphans's underlying scan fails for real (the shared
// base_sync.go sweep queries "persons", which does not exist).
func TestUpdateRelationsAndCleanupCountsPersonSweepFailure(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t) // defined in orphan_rejection_test.go; no "persons" collection
	s := &PersonsSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}

	s.updateRelationsAndCleanup(2026, map[int]*core.Record{}, map[int]personHouseholdIDs{}, map[int]bool{})

	if s.Stats.Errors != 1 {
		t.Errorf("Stats.Errors = %d, want 1 -- deleteOrphans's scan failed for real "+
			"and must not be downgraded to a Warn that reaches nothing", s.Stats.Errors)
	}
}

// TestDeleteHouseholdOrphansCountsBlockedDeleteAsError drives the household
// sweep's own delete loop (persons.go's deleteHouseholdOrphans), not the
// wrapper -- a blocked App.Delete must increment Stats.Errors even though the
// function still returns nil (the row is a genuine orphan; only the delete
// failed). Same blocking mechanism as
// TestPerServiceDeleteOrphansCountsBlockedDeletesAsErrors.
func TestDeleteHouseholdOrphansCountsBlockedDeleteAsError(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t)
	col, err := app.FindCollectionByNameOrId("households")
	if err != nil {
		t.Fatalf("find households: %v", err)
	}

	seedHousehold(t, app, 900, 2026) // a genuine orphan -- not in processedIDs below
	orphan, findErr := app.FindFirstRecordByFilter("households", "cm_id = 900")
	if findErr != nil {
		t.Fatalf("find seeded household: %v", findErr)
	}
	blockDeleteWithRequiredRelation(t, app, col, orphan.Id)

	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}

	if err := s.deleteHouseholdOrphans(2026, map[int]bool{}); err != nil {
		t.Fatalf("deleteHouseholdOrphans: %v", err)
	}

	if s.Stats.Errors != 1 {
		t.Errorf("Stats.Errors = %d, want 1 -- a blocked household delete must count as a failure",
			s.Stats.Errors)
	}
}
