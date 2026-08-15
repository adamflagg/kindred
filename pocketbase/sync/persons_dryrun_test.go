package sync

// This file proves DryRun gates all five of persons.go's own write sites
// (kindred#2351) -- the ones outside BaseSyncService's eight already-covered
// call sites: the person upsert (processPerson), the household upsert
// (processHouseholdRecord), the attendee-relation backfill
// (updateAttendeeRelations), the household-relation backfill
// (updatePersonHouseholdRelations), and the household-orphan delete
// (deleteHouseholdOrphans). It reuses newHouseholdsTestApp/seedHousehold from
// orphan_rejection_test.go and newMinimalPersonsTestApp from
// persons_delete_orphans_wrapper_test.go where their shape fits, rather than
// redefining fixtures.

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestDeleteHouseholdOrphansDryRunDeletesNothing proves the delete site is
// gated: a household that would be swept as an orphan survives a dry run.
func TestDeleteHouseholdOrphansDryRunDeletesNothing(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t)
	seedHousehold(t, app, 900, 2026) // not in processedIDs below -- a genuine orphan

	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}
	s.SetDryRun(true)

	if sweepErr := s.deleteHouseholdOrphans(2026, map[int]bool{}); sweepErr != nil {
		t.Fatalf("deleteHouseholdOrphans: %v", sweepErr)
	}

	rows, queryErr := app.FindRecordsByFilter("households", "", "", 0, 0)
	if queryErr != nil {
		t.Fatalf("re-query: %v", queryErr)
	}
	if len(rows) != 1 {
		t.Errorf("dry run deleted %d households; want 1 (the orphan survives)", len(rows))
	}
}

// TestProcessHouseholdRecordDryRunWritesNothing proves processHouseholdRecord's
// own two App.Save call sites are gated.
func TestProcessHouseholdRecordDryRunWritesNothing(t *testing.T) {
	t.Parallel()

	app := newHouseholdsTestApp(t)
	seedHousehold(t, app, 900, 2026)
	existing, findErr := app.FindFirstRecordByFilter("households", "cm_id = 900")
	if findErr != nil {
		t.Fatalf("find seeded household: %v", findErr)
	}

	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}
	s.SetDryRun(true)
	stats := &Stats{}

	// Update branch.
	if updateErr := s.processHouseholdRecord(900,
		map[string]any{"greeting": "changed this run"},
		map[int]*core.Record{900: existing},
		[]string{"greeting"}, stats); updateErr != nil {
		t.Fatalf("processHouseholdRecord (update): %v", updateErr)
	}
	reloaded, reloadErr := app.FindRecordById("households", existing.Id)
	if reloadErr != nil {
		t.Fatalf("reload: %v", reloadErr)
	}
	if reloaded.GetString("greeting") != "stored last run" {
		t.Errorf("dry run persisted a greeting change: got %q, want unchanged %q",
			reloaded.GetString("greeting"), "stored last run")
	}
	if stats.Updated != 1 {
		t.Errorf("Stats.Updated = %d, want 1", stats.Updated)
	}

	// Create branch: a household ID not in existingHouseholds.
	if createErr := s.processHouseholdRecord(901,
		map[string]any{"greeting": "brand new", "cm_id": 901, "year": 2026},
		map[int]*core.Record{900: existing},
		[]string{"greeting"}, stats); createErr != nil {
		t.Fatalf("processHouseholdRecord (create): %v", createErr)
	}
	rows, queryErr := app.FindRecordsByFilter("households", "", "", 0, 0)
	if queryErr != nil {
		t.Fatalf("re-query: %v", queryErr)
	}
	if len(rows) != 1 {
		t.Errorf("dry run wrote %d households; want 1 (only the seeded one)", len(rows))
	}
	if stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1", stats.Created)
	}
}

// TestProcessPersonDryRunWritesNothing proves processPerson's own two
// App.Save call sites -- the main person upsert -- are gated.
func TestProcessPersonDryRunWritesNothing(t *testing.T) {
	t.Parallel()

	app, appErr := pbtests.NewTestApp()
	if appErr != nil {
		t.Fatalf("NewTestApp: %v", appErr)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("persons")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "first_name"})
	col.Fields.Add(&core.TextField{Name: "last_name"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	col.Fields.Add(&core.BoolField{Name: "is_camper"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("create persons: %v", saveErr)
	}

	existingPerson := core.NewRecord(col)
	existingPerson.Set("cm_id", 5001)
	existingPerson.Set("first_name", testFirstName) // "Emma" -- shared with persons_test.go
	existingPerson.Set("last_name", "Johnson")
	existingPerson.Set("year", 2026)
	if seedErr := app.Save(existingPerson); seedErr != nil {
		t.Fatalf("seed existing person: %v", seedErr)
	}

	s := &PersonsSync{
		BaseSyncService:  BaseSyncService{App: app, ProcessedKeys: map[string]bool{}},
		missingDataStats: make(map[string]int),
	}
	s.SetDryRun(true)

	personData := func(id float64, first string) map[string]any {
		return map[string]any{
			"ID":            id,
			"CamperDetails": map[string]any{},
			"Name":          map[string]any{"First": first, "Last": "Johnson"},
		}
	}

	// Update branch.
	if updateErr := s.processPerson(personData(5001, "Emmaline"), true,
		map[int]*core.Record{5001: existingPerson}, map[string]string{}, map[int]string{}, 2026); updateErr != nil {
		t.Fatalf("processPerson (update): %v", updateErr)
	}
	reloaded, reloadErr := app.FindRecordById("persons", existingPerson.Id)
	if reloadErr != nil {
		t.Fatalf("reload: %v", reloadErr)
	}
	if reloaded.GetString("first_name") != testFirstName {
		t.Errorf("dry run persisted a name change: got %q, want unchanged %q",
			reloaded.GetString("first_name"), testFirstName)
	}
	if s.Stats.Updated != 1 {
		t.Errorf("Stats.Updated = %d, want 1", s.Stats.Updated)
	}

	// Create branch: a person ID not in existingPersons.
	if createErr := s.processPerson(personData(5002, "Liam"), true,
		map[int]*core.Record{5001: existingPerson}, map[string]string{}, map[int]string{}, 2026); createErr != nil {
		t.Fatalf("processPerson (create): %v", createErr)
	}
	rows, queryErr := app.FindRecordsByFilter("persons", "", "", 0, 0)
	if queryErr != nil {
		t.Fatalf("re-query: %v", queryErr)
	}
	if len(rows) != 1 {
		t.Errorf("dry run wrote %d persons; want 1 (only the seeded one)", len(rows))
	}
	if s.Stats.Created != 1 {
		t.Errorf("Stats.Created = %d, want 1", s.Stats.Created)
	}
}

// TestUpdatePersonHouseholdRelationsDryRunWritesNothing proves the
// household-relation backfill's App.Save call is gated: a person eligible for
// the backfill is left with its household relation unset by a dry run.
func TestUpdatePersonHouseholdRelationsDryRunWritesNothing(t *testing.T) {
	t.Parallel()

	app := newMinimalPersonsTestApp(t)

	personsCol, findErr := app.FindCollectionByNameOrId("persons")
	if findErr != nil {
		t.Fatalf("find persons: %v", findErr)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 5001)
	person.Set("year", 2026)
	if saveErr := app.Save(person); saveErr != nil {
		t.Fatalf("seed person: %v", saveErr)
	}

	householdsCol := core.NewBaseCollection("households")
	householdsCol.Fields.Add(&core.NumberField{Name: "cm_id"})
	if createErr := app.Save(householdsCol); createErr != nil {
		t.Fatalf("create households: %v", createErr)
	}
	household := core.NewRecord(householdsCol)
	household.Set("cm_id", 7001)
	if seedErr := app.Save(household); seedErr != nil {
		t.Fatalf("seed household: %v", seedErr)
	}

	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}
	s.SetDryRun(true)

	householdsByID := map[int]*core.Record{7001: household}
	personHouseholdMap := map[int]personHouseholdIDs{5001: {PrincipalID: 7001}}

	if updateErr := s.updatePersonHouseholdRelations(2026, householdsByID, personHouseholdMap); updateErr != nil {
		t.Fatalf("updatePersonHouseholdRelations: %v", updateErr)
	}

	reloaded, reloadErr := app.FindRecordById("persons", person.Id)
	if reloadErr != nil {
		t.Fatalf("reload: %v", reloadErr)
	}
	if reloaded.GetString("household") != "" {
		t.Errorf("dry run persisted the household relation: got %q, want unset",
			reloaded.GetString("household"))
	}
}

// TestUpdateAttendeeRelationsDryRunWritesNothing proves the attendee-relation
// backfill's App.Save call is gated: an attendee eligible for the backfill is
// left with its person relation unset by a dry run.
func TestUpdateAttendeeRelationsDryRunWritesNothing(t *testing.T) {
	t.Parallel()

	app, appErr := pbtests.NewTestApp()
	if appErr != nil {
		t.Fatalf("NewTestApp: %v", appErr)
	}
	t.Cleanup(app.Cleanup)

	personsCol := core.NewBaseCollection("persons")
	personsCol.Fields.Add(&core.NumberField{Name: "cm_id"})
	personsCol.Fields.Add(&core.NumberField{Name: "year"})
	if createErr := app.Save(personsCol); createErr != nil {
		t.Fatalf("create persons: %v", createErr)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 5001)
	person.Set("year", 2026)
	if seedErr := app.Save(person); seedErr != nil {
		t.Fatalf("seed person: %v", seedErr)
	}

	attendeesCol := core.NewBaseCollection("attendees")
	attendeesCol.Fields.Add(&core.NumberField{Name: "person_id"})
	attendeesCol.Fields.Add(&core.TextField{Name: "person"})
	attendeesCol.Fields.Add(&core.NumberField{Name: "year"})
	if createAttendeesErr := app.Save(attendeesCol); createAttendeesErr != nil {
		t.Fatalf("create attendees: %v", createAttendeesErr)
	}
	attendee := core.NewRecord(attendeesCol)
	attendee.Set("person_id", 5001)
	attendee.Set("year", 2026)
	if seedAttendeeErr := app.Save(attendee); seedAttendeeErr != nil {
		t.Fatalf("seed attendee: %v", seedAttendeeErr)
	}

	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}
	s.SetDryRun(true)

	if updateErr := s.updateAttendeeRelations(2026); updateErr != nil {
		t.Fatalf("updateAttendeeRelations: %v", updateErr)
	}

	reloaded, reloadErr := app.FindRecordById("attendees", attendee.Id)
	if reloadErr != nil {
		t.Fatalf("reload: %v", reloadErr)
	}
	if reloaded.GetString("person") != "" {
		t.Errorf("dry run persisted the person relation: got %q, want unset",
			reloaded.GetString("person"))
	}
}
