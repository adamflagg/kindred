package sync

import (
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// ---------------------------------------------------------------------------
// kindred#2279 part (a) + (b) -- the shared guard
// ---------------------------------------------------------------------------

func TestOrphanSweepGuardCheck(t *testing.T) {
	tests := []struct {
		name       string
		computed   int
		existing   int
		wantRefuse bool
	}{
		{"nothing on disk is never a collapse", 0, 0, false},
		{"empty computed set against rows on disk refuses at any size", 0, 1, true},
		{"empty computed set against a full year refuses", 0, 5000, true},
		{"healthy full sweep passes", 5000, 5000, false},
		{"a computed set larger than disk passes", 6000, 5000, false},
		{"a small table is left to the empty-set arm alone", 1, 19, false},
		{"partial collapse at the floor boundary passes", 10, 20, false},
		{"partial collapse just under the floor refuses", 9, 20, true},
		{"the kindred#2279 case: 5 computed against 300 on disk refuses", 5, 300, true},
		{"a normal season's churn passes", 4800, 5000, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: tc.computed}
			err := g.Check(tc.existing)

			if tc.wantRefuse && err == nil {
				t.Fatalf("Check(%d) with computed=%d returned nil, want a refusal",
					tc.existing, tc.computed)
			}
			if !tc.wantRefuse && err != nil {
				t.Fatalf("Check(%d) with computed=%d refused: %v", tc.existing, tc.computed, err)
			}
			if err != nil && !strings.Contains(err.Error(), "2026") {
				t.Errorf("error %q does not name the year -- an operator cannot tell which season refused",
					err.Error())
			}
			if err != nil && !strings.Contains(err.Error(), "widgets") {
				t.Errorf("error %q does not name the entity", err.Error())
			}
		})
	}
}

// TestOrphanSweepGuardCheckCarriesTheHint proves a service can point the
// operator at its own upstream, which is what the two shipped guards do.
func TestOrphanSweepGuardCheckCarriesTheHint(t *testing.T) {
	g := OrphanSweepGuard{
		Entity:   "staff_vehicle_info",
		Year:     2026,
		Computed: 0,
		Hint:     "check the staff table for that year, and the SVI field routing warnings above",
	}

	err := g.Check(12)
	if err == nil {
		t.Fatal("expected a refusal on an empty computed set")
	}
	if !strings.Contains(err.Error(), "routing") {
		t.Errorf("error %q dropped the service hint", err.Error())
	}
}

// ---------------------------------------------------------------------------
// kindred#2279 Gap 1 -- partial collapse, on every guarded shape
// ---------------------------------------------------------------------------

// TestBaseDeleteOrphansGuardedRefusesPartialCollapse is the kindred#2279 case
// on the shared base sweep: the computed set comes back with a handful of
// entries when hundreds were expected, and the unwidened guard -- which only
// asked "is it empty?" -- waved it through and deleted the rest.
func TestBaseDeleteOrphansGuardedRefusesPartialCollapse(t *testing.T) {
	const (
		seeded   = 300
		computed = 5
	)

	app := newOrphanSweepTestApp(t, "widgets", "name")
	col, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}
	for i := 1; i <= seeded; i++ {
		rec := core.NewRecord(col)
		rec.Id = orphanTestID(i)
		rec.Set("name", fmt.Sprintf("widget-%03d", i))
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed widget %d: %v", i, saveErr)
		}
	}

	b := BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, SyncSuccessful: true}
	for i := 1; i <= computed; i++ {
		b.ProcessedKeys[fmt.Sprintf("%d|2026", i)] = true
	}

	err = b.DeleteOrphansGuarded(
		"widgets",
		func(record *core.Record) (string, bool) {
			var n int
			if _, scanErr := fmt.Sscanf(record.GetString("name"), "widget-%d", &n); scanErr != nil {
				return "", false
			}
			return fmt.Sprintf("%d|2026", n), true
		},
		"widget",
		"year = 2026",
		OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: computed},
	)

	if err == nil {
		t.Fatal("expected a refusal: 5 computed against 300 on disk is a collapsed mapping, " +
			"and sweeping it deletes 295 rows while reporting success")
	}
	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- nothing may be deleted on the refusal path", remaining, seeded)
	}
}

// TestBaseDeleteOrphansGuardedStillSweepsNormalChurn proves the widened guard
// did not turn ordinary attrition into a failed sync.
func TestBaseDeleteOrphansGuardedStillSweepsNormalChurn(t *testing.T) {
	const (
		seeded   = 300
		computed = 290
	)

	app := newOrphanSweepTestApp(t, "widgets", "name")
	col, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}
	for i := 1; i <= seeded; i++ {
		rec := core.NewRecord(col)
		rec.Id = orphanTestID(i)
		rec.Set("name", fmt.Sprintf("widget-%03d", i))
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed widget %d: %v", i, saveErr)
		}
	}

	b := BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, SyncSuccessful: true}
	for i := 1; i <= computed; i++ {
		b.ProcessedKeys[fmt.Sprintf("%d|2026", i)] = true
	}

	err = b.DeleteOrphansGuarded(
		"widgets",
		func(record *core.Record) (string, bool) {
			var n int
			if _, scanErr := fmt.Sscanf(record.GetString("name"), "widget-%d", &n); scanErr != nil {
				return "", false
			}
			return fmt.Sprintf("%d|2026", n), true
		},
		"widget",
		"year = 2026",
		OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: computed},
	)
	if err != nil {
		t.Fatalf("guard refused a healthy sweep (%d of %d): %v", computed, seeded, err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != computed {
		t.Fatalf("%d rows survived, want %d -- the guard must not block a genuine sweep", remaining, computed)
	}
}

func TestPersonCustomFieldValuesDeleteOrphansRefusesPartialCollapse(t *testing.T) {
	const seeded = 300

	app := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, app, "person_custom_values", "person", "pers_0000000001", 2026, seeded)

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	// A staff/person lookup that died partway: five keys where 300 were expected.
	for i := 1; i <= 5; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true})
	if err == nil {
		t.Fatal("expected a refusal on a collapsed computed set")
	}
	if !strings.Contains(err.Error(), "2026") {
		t.Errorf("error %q does not name the year", err.Error())
	}
	if remaining := countRows(t, app, "person_custom_values", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- nothing may be deleted on the refusal path", remaining, seeded)
	}
}

// TestPersonCustomFieldValuesDeleteOrphansIgnoresPersonsThisRunDidNotFetch is
// the hazard that uncapping the read creates. This service takes a ?session=
// filter, which narrows the run to the persons enrolled in that session, while
// the sweep's own filter is the whole year. Reading the whole year and judging
// it against one session's keys would delete every other session's values.
func TestPersonCustomFieldValuesDeleteOrphansIgnoresPersonsThisRunDidNotFetch(t *testing.T) {
	const perPerson = 40

	app := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, app, "person_custom_values", "person", "pers_0000000001", 2026, perPerson)
	bulkInsertRowsFrom(t, app, "person_custom_values", "person", "pers_0000000002", 2026, perPerson+1, perPerson*2)

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	// Person 1 was fetched this run and every one of their values came back
	// except the last, which CampMinder really did delete.
	for i := 1; i < perPerson; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	// Person 2 was never fetched -- a different session, or a failed fetch.
	if err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	survivors := countRows(t, app, "person_custom_values", "person = 'pers_0000000002'")
	if survivors != perPerson {
		t.Fatalf("%d of person 2's rows survived, want %d -- a run that never fetched a person "+
			"must not delete that person's values as orphans", survivors, perPerson)
	}

	swept := countRows(t, app, "person_custom_values", "person = 'pers_0000000001'")
	if swept != perPerson-1 {
		t.Fatalf("%d of person 1's rows survived, want %d -- the genuine orphan must still go",
			swept, perPerson-1)
	}
}

func TestHouseholdCustomFieldValuesDeleteOrphansRefusesPartialCollapse(t *testing.T) {
	const seeded = 300

	app := newOrphanSweepTestApp(t, "household_custom_values", "household", "field_definition", "value")
	bulkInsertRows(t, app, "household_custom_values", "household", "hh_00000000001", 2026, seeded)

	s := &HouseholdCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	for i := 1; i <= 5; i++ {
		s.ProcessedKeys[fmt.Sprintf("hh_00000000001:fd%06d|2026", i)] = true
	}

	err := s.deleteOrphans(2026, map[string]bool{"hh_00000000001": true})
	if err == nil {
		t.Fatal("expected a refusal on a collapsed computed set")
	}
	if remaining := countRows(t, app, "household_custom_values", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- nothing may be deleted on the refusal path", remaining, seeded)
	}
}

// TestHouseholdCustomFieldValuesDeleteOrphansIgnoresHouseholdsThisRunDidNotFetch
// mirrors the person case: getHouseholdIDsToSync takes the same ?session=
// filter.
func TestHouseholdCustomFieldValuesDeleteOrphansIgnoresHouseholdsThisRunDidNotFetch(t *testing.T) {
	const perHousehold = 40

	app := newOrphanSweepTestApp(t, "household_custom_values", "household", "field_definition", "value")
	bulkInsertRows(t, app, "household_custom_values", "household", "hh_00000000001", 2026, perHousehold)
	bulkInsertRowsFrom(t, app, "household_custom_values", "household", "hh_00000000002", 2026,
		perHousehold+1, perHousehold*2)

	s := &HouseholdCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	for i := 1; i < perHousehold; i++ {
		s.ProcessedKeys[fmt.Sprintf("hh_00000000001:fd%06d|2026", i)] = true
	}

	if err := s.deleteOrphans(2026, map[string]bool{"hh_00000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	survivors := countRows(t, app, "household_custom_values", "household = 'hh_00000000002'")
	if survivors != perHousehold {
		t.Fatalf("%d of household 2's rows survived, want %d", survivors, perHousehold)
	}
}
