package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// repointFixture seeds one person (CampMinder id 5001, year 2026) and two
// households (7001 = A, 7002 = B), returning the app, the person and both households.
func repointFixture(t *testing.T) (core.App, *core.Record, map[int]*core.Record) {
	t.Helper()
	app := newMinimalPersonsTestApp(t)

	householdsCol := core.NewBaseCollection("households")
	householdsCol.Fields.Add(&core.NumberField{Name: "cm_id"})
	if err := app.Save(householdsCol); err != nil {
		t.Fatalf("create households: %v", err)
	}
	byID := map[int]*core.Record{}
	for _, id := range []int{7001, 7002} {
		hh := core.NewRecord(householdsCol)
		hh.Set("cm_id", id)
		if err := app.Save(hh); err != nil {
			t.Fatalf("seed household: %v", err)
		}
		byID[id] = hh
	}

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 5001)
	person.Set("year", 2026)
	person.Set("household", byID[7001].Id)
	person.Set("primary_childhood_household", byID[7001].Id)
	person.Set("alternate_childhood_household", byID[7001].Id)
	if err := app.Save(person); err != nil {
		t.Fatalf("seed person: %v", err)
	}
	return app, person, byID
}

func reload(t *testing.T, app core.App, id string) *core.Record {
	t.Helper()
	r, err := app.FindRecordById("persons", id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	return r
}

func TestUpdatePersonHouseholdRelationsRepointsChangedHousehold(t *testing.T) {
	t.Parallel()
	app, person, hh := repointFixture(t)
	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}

	ids := map[int]personHouseholdIDs{5001: {PrincipalID: 7002, PrimaryChildhoodID: 7002, AlternateChildhoodID: 7002}}
	if err := s.updatePersonHouseholdRelations(2026, hh, ids); err != nil {
		t.Fatalf("update: %v", err)
	}

	got := reload(t, app, person.Id)
	for _, f := range []string{"household", "primary_childhood_household", "alternate_childhood_household"} {
		if got.GetString(f) != hh[7002].Id {
			t.Errorf("%s = %q, want household B %q", f, got.GetString(f), hh[7002].Id)
		}
	}
}

func TestUpdatePersonHouseholdRelationsPayloadWithoutIDsKeepsRelations(t *testing.T) {
	t.Parallel()
	app, person, hh := repointFixture(t)
	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}

	// Fetched this run, but the payload carried no Households object; and an id
	// that resolves to no household record must not clear anything either.
	unresolved := personHouseholdIDs{PrincipalID: 9999, PrimaryChildhoodID: 9999, AlternateChildhoodID: 9999}
	for _, ids := range []personHouseholdIDs{{}, unresolved} {
		if err := s.updatePersonHouseholdRelations(2026, hh, map[int]personHouseholdIDs{5001: ids}); err != nil {
			t.Fatalf("update: %v", err)
		}
		got := reload(t, app, person.Id)
		for _, f := range []string{"household", "primary_childhood_household", "alternate_childhood_household"} {
			if got.GetString(f) != hh[7001].Id {
				t.Errorf("%s = %q, want unchanged %q", f, got.GetString(f), hh[7001].Id)
			}
		}
	}
}

func TestUpdatePersonHouseholdRelationsLeavesUnfetchedPersonAlone(t *testing.T) {
	t.Parallel()
	app, person, hh := repointFixture(t)
	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}

	// Person 5001 is not in this run's map: untouched even though another person is.
	ids := map[int]personHouseholdIDs{5002: {PrincipalID: 7002}}
	if err := s.updatePersonHouseholdRelations(2026, hh, ids); err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := reload(t, app, person.Id).GetString("household"); got != hh[7001].Id {
		t.Errorf("household = %q, want unchanged %q", got, hh[7001].Id)
	}
}

func TestUpdatePersonHouseholdRelationsUnchangedPersonIsNotSaved(t *testing.T) {
	t.Parallel()
	app, person, hh := repointFixture(t)
	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}

	saves := 0
	app.OnRecordUpdate("persons").BindFunc(func(e *core.RecordEvent) error {
		saves++
		return e.Next()
	})

	ids := map[int]personHouseholdIDs{5001: {PrincipalID: 7001, PrimaryChildhoodID: 7001, AlternateChildhoodID: 7001}}
	if err := s.updatePersonHouseholdRelations(2026, hh, ids); err != nil {
		t.Fatalf("update: %v", err)
	}
	if saves != 0 {
		t.Errorf("unchanged person was saved %d times, want 0", saves)
	}
	if got := reload(t, app, person.Id).GetString("household"); got != hh[7001].Id {
		t.Errorf("household changed to %q", got)
	}
}

func TestUpdatePersonHouseholdRelationsFillsEmptyFromLegacyHouseholdID(t *testing.T) {
	t.Parallel()
	app, person, hh := repointFixture(t)
	s := &PersonsSync{BaseSyncService: BaseSyncService{App: app}}

	// Empty household, no principal id in the payload: falls back to household_id.
	col, _ := app.FindCollectionByNameOrId("persons")
	col.Fields.Add(&core.NumberField{Name: "household_id"})
	if err := app.Save(col); err != nil {
		t.Fatalf("add household_id: %v", err)
	}
	p := reload(t, app, person.Id)
	p.Set("household", "")
	p.Set("household_id", 7002)
	if err := app.Save(p); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := s.updatePersonHouseholdRelations(2026, hh, map[int]personHouseholdIDs{5001: {}}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := reload(t, app, person.Id).GetString("household"); got != hh[7002].Id {
		t.Errorf("household = %q, want fallback %q", got, hh[7002].Id)
	}
}
