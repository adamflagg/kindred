package sync

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// TestPerServiceDeleteOrphansCountsBlockedDeletesAsErrors pins the convention
// settled by kindred#2284/#2285/#2296 and shipped for base_sync.go's shared
// sweep by PR #2341 (kindred#2302): a delete that FAILS must increment
// Stats.Errors, not just get logged. kindred#2347 found ten per-service sites
// that logged the failure, `continue`d, and left the counter untouched, so a
// run that failed to delete a row still reported success.
//
// One case per representative service is enough to pin the shape -- see
// kindred#2347's "one test per file is overkill" note -- rather than
// duplicating this across all eight files it touches. camper_dietary and
// quest_registrations cover the simple map[string]string existing-set shape;
// household_demographics covers the composite-key shape.
func TestPerServiceDeleteOrphansCountsBlockedDeletesAsErrors(t *testing.T) {
	t.Parallel()

	t.Run("camper_dietary", func(t *testing.T) {
		t.Parallel()
		app := newOrphanSweepTestApp(t, "camper_dietary", "person_id")
		col, err := app.FindCollectionByNameOrId("camper_dietary")
		if err != nil {
			t.Fatalf("find camper_dietary: %v", err)
		}
		orphan := core.NewRecord(col)
		orphan.Set("person_id", 8002)
		orphan.Set("year", 2026)
		if saveErr := app.Save(orphan); saveErr != nil {
			t.Fatalf("save orphan: %v", saveErr)
		}
		blockDeleteWithRequiredRelation(t, app, col, orphan.Id)

		s := NewCamperDietarySync(app)
		s.SyncSuccessful = true
		records := map[string]*camperDietaryRecord{
			makeCamperDietaryKey(8001, 2026): {personID: 8001, year: 2026},
		}
		existing := map[string]string{makeCamperDietaryKey(8002, 2026): orphan.Id}

		deleted, err := s.deleteOrphans(context.Background(), records, existing, 2026)
		if err != nil {
			t.Fatalf("deleteOrphans: %v", err)
		}
		if deleted != 0 {
			t.Errorf("deleted = %d, want 0 -- the delete was blocked", deleted)
		}
		if s.Stats.Errors != 1 {
			t.Errorf("Stats.Errors = %d, want 1 -- a blocked delete must count as a failure", s.Stats.Errors)
		}
	})

	t.Run("quest_registrations", func(t *testing.T) {
		t.Parallel()
		app := newOrphanSweepTestApp(t, "quest_registrations", "person_id")
		col, err := app.FindCollectionByNameOrId("quest_registrations")
		if err != nil {
			t.Fatalf("find quest_registrations: %v", err)
		}
		orphan := core.NewRecord(col)
		orphan.Set("person_id", 9002)
		orphan.Set("year", 2026)
		if saveErr := app.Save(orphan); saveErr != nil {
			t.Fatalf("save orphan: %v", saveErr)
		}
		blockDeleteWithRequiredRelation(t, app, col, orphan.Id)

		s := NewQuestRegistrationsSync(app)
		s.SyncSuccessful = true
		records := map[string]*questRegistrationRecord{
			makeQuestRegistrationKey(9001, 2026): {personID: 9001, year: 2026},
		}
		existing := map[string]string{makeQuestRegistrationKey(9002, 2026): orphan.Id}

		deleted, err := s.deleteOrphans(context.Background(), records, existing, 2026)
		if err != nil {
			t.Fatalf("deleteOrphans: %v", err)
		}
		if deleted != 0 {
			t.Errorf("deleted = %d, want 0 -- the delete was blocked", deleted)
		}
		if s.Stats.Errors != 1 {
			t.Errorf("Stats.Errors = %d, want 1 -- a blocked delete must count as a failure", s.Stats.Errors)
		}
	})

	t.Run("household_demographics", func(t *testing.T) {
		t.Parallel()
		app := newOrphanSweepTestApp(t, "household_demographics", "household", "person_id")
		col, err := app.FindCollectionByNameOrId("household_demographics")
		if err != nil {
			t.Fatalf("find household_demographics: %v", err)
		}
		orphan := core.NewRecord(col)
		orphan.Set("household", "hh_fixed")
		orphan.Set("person_id", 2)
		orphan.Set("year", 2026)
		if saveErr := app.Save(orphan); saveErr != nil {
			t.Fatalf("save orphan: %v", saveErr)
		}
		blockDeleteWithRequiredRelation(t, app, col, orphan.Id)

		s := NewHouseholdDemographicsSync(app)
		s.SyncSuccessful = true
		records := map[string]*householdDemographicsRecord{
			MakeCompositeKey("hh_fixed", 1, 2026): {householdPBID: "hh_fixed", personCMID: 1, year: 2026},
		}
		existing := map[string]string{MakeCompositeKey("hh_fixed", 2, 2026): orphan.Id}

		deleted, err := s.deleteOrphans(context.Background(), records, existing, 2026)
		if err != nil {
			t.Fatalf("deleteOrphans: %v", err)
		}
		if deleted != 0 {
			t.Errorf("deleted = %d, want 0 -- the delete was blocked", deleted)
		}
		if s.Stats.Errors != 1 {
			t.Errorf("Stats.Errors = %d, want 1 -- a blocked delete must count as a failure", s.Stats.Errors)
		}
	})
}

// blockDeleteWithRequiredRelation adds a collection holding a required,
// non-cascading relation into `collection` and points it at `targetID`, so
// App.Delete(targetID) fails for real rather than via a mock. Modeled on
// TestBaseDeleteOrphansCountsOnlyCompletedDeletes in orphan_sweep_test.go.
func blockDeleteWithRequiredRelation(t *testing.T, app core.App, collection *core.Collection, targetID string) {
	t.Helper()

	holders := core.NewBaseCollection(collection.Name + "_holders")
	holders.Fields.Add(&core.RelationField{
		Name: "target", CollectionId: collection.Id, CascadeDelete: false, Required: true,
	})
	if err := app.Save(holders); err != nil {
		t.Fatalf("save %s_holders: %v", collection.Name, err)
	}

	holder := core.NewRecord(holders)
	holder.Set("target", targetID)
	if err := app.Save(holder); err != nil {
		t.Fatalf("seed holder for %s: %v", collection.Name, err)
	}
}
