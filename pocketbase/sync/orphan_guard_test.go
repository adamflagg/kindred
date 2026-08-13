package sync

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// ---------------------------------------------------------------------------
// kindred#2279 part (a) + (b) -- the shared guard
// ---------------------------------------------------------------------------

func TestOrphanSweepGuardCheck(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	// Person 2 holds far fewer rows than person 1 on purpose: dropping the
	// scoping has to fail THIS test on the surviving-row count, not by tripping
	// the collapse guard, or the test would not be pinning the scoping at all.
	const (
		person1Rows = 40
		person2Rows = 10
	)

	app := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, app, "person_custom_values", "person", "pers_0000000001", 2026, person1Rows)
	bulkInsertRowsFrom(t, app, "person_custom_values", "person", "pers_0000000002", 2026,
		person1Rows+1, person1Rows+person2Rows)

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	// Person 1 was fetched this run and every one of their values came back
	// except the last, which CampMinder really did delete.
	for i := 1; i < person1Rows; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	// Person 2 was never fetched -- a different session, or a failed fetch.
	if err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	survivors := countRows(t, app, "person_custom_values", "person = 'pers_0000000002'")
	if survivors != person2Rows {
		t.Fatalf("%d of person 2's rows survived, want %d -- a run that never fetched a person "+
			"must not delete that person's values as orphans", survivors, person2Rows)
	}

	swept := countRows(t, app, "person_custom_values", "person = 'pers_0000000001'")
	if swept != person1Rows-1 {
		t.Fatalf("%d of person 1's rows survived, want %d -- the genuine orphan must still go",
			swept, person1Rows-1)
	}
}

func TestHouseholdCustomFieldValuesDeleteOrphansRefusesPartialCollapse(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
	const (
		household1Rows = 40
		household2Rows = 10
	)

	app := newOrphanSweepTestApp(t, "household_custom_values", "household", "field_definition", "value")
	bulkInsertRows(t, app, "household_custom_values", "household", "hh_00000000001", 2026, household1Rows)
	bulkInsertRowsFrom(t, app, "household_custom_values", "household", "hh_00000000002", 2026,
		household1Rows+1, household1Rows+household2Rows)

	s := &HouseholdCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	for i := 1; i < household1Rows; i++ {
		s.ProcessedKeys[fmt.Sprintf("hh_00000000001:fd%06d|2026", i)] = true
	}

	if err := s.deleteOrphans(2026, map[string]bool{"hh_00000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	survivors := countRows(t, app, "household_custom_values", "household = 'hh_00000000002'")
	if survivors != household2Rows {
		t.Fatalf("%d of household 2's rows survived, want %d", survivors, household2Rows)
	}

	swept := countRows(t, app, "household_custom_values", "household = 'hh_00000000001'")
	if swept != household1Rows-1 {
		t.Fatalf("%d of household 1's rows survived, want %d -- the genuine orphan must still go",
			swept, household1Rows-1)
	}
}

// ---------------------------------------------------------------------------
// kindred#2283 row 2 -- classifying a sweep failure
// ---------------------------------------------------------------------------

// TestWrapOrphanSweepError pins the distinction kindred#2280 settled on
// staff_vehicle_info.go and staff_applications.go: a guard refusal and a
// cancelled context are different operational facts and must not share a
// message. "Refused" tells an operator the CampMinder feed is not to be
// trusted; "interrupted" tells them the run ran out of time. Reporting the
// second as the first sends them to look at data that is fine.
//
// The wording here is copied from those two files deliberately -- the value is
// that every guarded sweep in the package reads the same, so this helper is the
// one place the phrasing lives rather than a seventh hand-written copy.
func TestWrapOrphanSweepError(t *testing.T) {
	t.Parallel()

	guardErr := OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: 0}.Check(50)
	if guardErr == nil {
		t.Fatal("fixture is wrong: an empty computed set against 50 rows must refuse")
	}

	tests := []struct {
		name       string
		in         error
		wantPrefix string
	}{
		{"a guard refusal is a refusal", guardErr, "orphan sweep refused: "},
		{"a cancelled context is an interruption", context.Canceled, "orphan sweep interrupted: "},
		{"an expired deadline is an interruption", context.DeadlineExceeded, "orphan sweep interrupted: "},
		{
			"a wrapped cancellation is still an interruption",
			fmt.Errorf("deleting row 12: %w", context.Canceled),
			"orphan sweep interrupted: ",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := wrapOrphanSweepError(tc.in)
			if got == nil {
				t.Fatalf("wrapOrphanSweepError(%v) = nil, want an error", tc.in)
			}
			if !strings.HasPrefix(got.Error(), tc.wantPrefix) {
				t.Errorf("wrapOrphanSweepError(%v) = %q, want prefix %q", tc.in, got.Error(), tc.wantPrefix)
			}
			// The cause must survive wrapping, or callers upstream lose the
			// ability to tell cancellation from refusal themselves.
			if !errors.Is(got, tc.in) {
				t.Errorf("wrapOrphanSweepError(%v) does not unwrap to its cause", tc.in)
			}
		})
	}

	t.Run("nil in, nil out", func(t *testing.T) {
		t.Parallel()
		if got := wrapOrphanSweepError(nil); got != nil {
			t.Errorf("wrapOrphanSweepError(nil) = %v, want nil", got)
		}
	})
}

// ---------------------------------------------------------------------------
// kindred#2283 row 1 -- caller propagation for the person_custom_values syncs
// ---------------------------------------------------------------------------

// newCustomValuesSyncTestApp builds the collections the four
// person_custom_values-driven syncs read on their way to the orphan sweep.
// Shared because those four load the same shape: a field definition, the values
// pointing at it, the persons those values belong to, and an attendee row per
// person to hang the relation on.
func newCustomValuesSyncTestApp(t *testing.T, target string, targetFields ...string) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	created := func(col *core.Collection) {
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	for _, f := range []string{"first_name", "last_name"} {
		persons.Fields.Add(&core.TextField{Name: f})
	}
	created(persons)
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.NumberField{Name: "person_id"})
	attendees.Fields.Add(&core.NumberField{Name: "session_id"})
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	created(attendees)
	if err := app.Save(attendees); err != nil {
		t.Fatalf("create attendees: %v", err)
	}

	defs := core.NewBaseCollection("custom_field_defs")
	defs.Fields.Add(&core.TextField{Name: "name"})
	defs.Fields.Add(&core.TextField{Name: "partition"})
	// staff_skills skips any definition whose cm_id is 0, so the fixture needs
	// a real one or its Sync() bails before it ever reaches the sweep.
	defs.Fields.Add(&core.NumberField{Name: "cm_id"})
	defs.Fields.Add(&core.NumberField{Name: "year"})
	created(defs)
	if err := app.Save(defs); err != nil {
		t.Fatalf("create custom_field_defs: %v", err)
	}

	values := core.NewBaseCollection("person_custom_values")
	values.Fields.Add(&core.TextField{Name: "person"})
	values.Fields.Add(&core.TextField{Name: "field_definition"})
	values.Fields.Add(&core.TextField{Name: "value"})
	values.Fields.Add(&core.NumberField{Name: "year"})
	created(values)
	if err := app.Save(values); err != nil {
		t.Fatalf("create person_custom_values: %v", err)
	}

	col := core.NewBaseCollection(target)
	col.Fields.Add(&core.NumberField{Name: "person_id"})
	col.Fields.Add(&core.NumberField{Name: "session_id"})
	col.Fields.Add(&core.NumberField{Name: "skill_cm_id"})
	// Required, per the year invariant every CampMinder-derived table carries.
	col.Fields.Add(&core.NumberField{Name: "year", Required: true})
	for _, f := range targetFields {
		col.Fields.Add(&core.TextField{Name: f})
	}
	col.Fields.Add(&core.TextField{Name: "person"})
	col.Fields.Add(&core.TextField{Name: "attendee"})
	created(col)
	if err := app.Save(col); err != nil {
		t.Fatalf("create %s: %v", target, err)
	}

	return app
}

// seedCustomValuesRun writes `computed` campers who each answered `fieldName`
// this year, plus `existing` rows already stored in `target` that this run does
// not account for. The ratio is what trips OrphanSweepGuard.
func seedCustomValuesRun(t *testing.T, app core.App, target, fieldName, partition string, computed, existing int) {
	t.Helper()

	defs, err := app.FindCollectionByNameOrId("custom_field_defs")
	if err != nil {
		t.Fatalf("find custom_field_defs: %v", err)
	}
	def := core.NewRecord(defs)
	def.Set("name", fieldName)
	def.Set("partition", partition)
	def.Set("cm_id", 77)
	def.Set("year", 2026)
	if saveErr := app.Save(def); saveErr != nil {
		t.Fatalf("save field def: %v", saveErr)
	}

	personsCol, _ := app.FindCollectionByNameOrId("persons")
	attendeesCol, _ := app.FindCollectionByNameOrId("attendees")
	valuesCol, _ := app.FindCollectionByNameOrId("person_custom_values")
	for i := range computed {
		cmID := 101 + i
		p := core.NewRecord(personsCol)
		p.Set("cm_id", cmID)
		p.Set("year", 2026)
		if saveErr := app.Save(p); saveErr != nil {
			t.Fatalf("save person %d: %v", cmID, saveErr)
		}
		a := core.NewRecord(attendeesCol)
		a.Set("person_id", cmID)
		a.Set("session_id", 200)
		a.Set("year", 2026)
		if saveErr := app.Save(a); saveErr != nil {
			t.Fatalf("save attendee %d: %v", cmID, saveErr)
		}
		v := core.NewRecord(valuesCol)
		v.Set("person", p.Id)
		v.Set("field_definition", def.Id)
		v.Set("value", "Yes")
		v.Set("year", 2026)
		if saveErr := app.Save(v); saveErr != nil {
			t.Fatalf("save custom value %d: %v", cmID, saveErr)
		}
	}

	targetCol, err := app.FindCollectionByNameOrId(target)
	if err != nil {
		t.Fatalf("find %s: %v", target, err)
	}
	for i := range existing {
		rec := core.NewRecord(targetCol)
		rec.Set("person_id", 900+i)
		rec.Set("session_id", 200)
		rec.Set("skill_cm_id", 300+i)
		rec.Set("year", 2026)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save existing row %d: %v", i, err)
		}
	}
}

// assertSweepRefusalReachesCaller runs syncFn and requires the sweep refusal to
// come back out of it, with nothing deleted. This is the kindred#2294 gap: the
// guard tests prove deleteOrphans REFUSES, and prove nothing about whether the
// caller listens.
func assertSweepRefusalReachesCaller(t *testing.T, app core.App, target string, wantRows int, syncErr error) {
	t.Helper()

	if syncErr == nil {
		t.Fatal("Sync returned nil on a refused sweep -- the refusal never reached the caller")
	}
	if !strings.Contains(syncErr.Error(), "orphan sweep refused") {
		t.Errorf("Sync error = %q, want it to carry the sweep refusal", syncErr.Error())
	}
	remaining, err := app.FindRecordsByFilter(target, "year = 2026 && person_id >= 900", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query %s: %v", target, err)
	}
	if len(remaining) != wantRows {
		t.Errorf("%d seeded rows survived, want %d -- a refused sweep must delete nothing",
			len(remaining), wantRows)
	}
}

func TestCamperDietarySyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_dietary", "allergy_info")
	seedCustomValuesRun(t, app, "camper_dietary", "Family Medical-Allergy Info", "", 3, OrphanSweepMinRows+5)

	s := NewCamperDietarySync(app)
	s.Year = 2026
	assertSweepRefusalReachesCaller(t, app, "camper_dietary", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

func TestCamperTransportationSyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_transportation", "to_camp_method")
	seedCustomValuesRun(t, app, "camper_transportation", "BUS-To Camp", "", 3, OrphanSweepMinRows+5)

	s := NewCamperTransportationSync(app)
	s.Year = 2026
	assertSweepRefusalReachesCaller(t, app, "camper_transportation", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

func TestQuestRegistrationsSyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "quest_registrations", "quest_status")
	seedCustomValuesRun(t, app, "quest_registrations", "Quest-Status", "", 3, OrphanSweepMinRows+5)

	s := NewQuestRegistrationsSync(app)
	s.Year = 2026
	assertSweepRefusalReachesCaller(t, app, "quest_registrations", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

func TestStaffSkillsSyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "staff_skills", "skill_name", "raw_value")
	seedCustomValuesRun(t, app, "staff_skills", "Skills-Archery", partitionStaff, 3, OrphanSweepMinRows+5)

	s := NewStaffSkillsSync(app)
	s.Year = 2026
	assertSweepRefusalReachesCaller(t, app, "staff_skills", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

// TestDeleteOrphansReturnsContextErrorOnCancellation closes the loop on the
// classification above. wrapOrphanSweepError only reports "interrupted" if what
// reaches it is genuinely a context error, so this pins the other half: a
// cancelled sweep returns ctx.Err() rather than a nil error and a short count.
// Together the two mean a cancelled run cannot be reported as a data refusal.
func TestDeleteOrphansReturnsContextErrorOnCancellation(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_dietary", "allergy_info")
	col, err := app.FindCollectionByNameOrId("camper_dietary")
	if err != nil {
		t.Fatalf("find camper_dietary: %v", err)
	}

	// Enough rows on disk, and a computed set large enough to clear the guard,
	// so the only thing that can stop the sweep is the cancellation.
	existing := make(map[string]string, OrphanSweepMinRows+5)
	computed := make(map[string]*camperDietaryRecord, OrphanSweepMinRows+5)
	for i := range OrphanSweepMinRows + 5 {
		rec := core.NewRecord(col)
		rec.Set("person_id", 900+i)
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("save row %d: %v", i, saveErr)
		}
		existing[makeCamperDietaryKey(900+i, 2026)] = rec.Id
		computed[makeCamperDietaryKey(900+i, 2026)] = &camperDietaryRecord{personID: 900 + i}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	s := NewCamperDietarySync(app)
	deleted, err := s.deleteOrphans(ctx, computed, existing, 2026)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("deleteOrphans on a cancelled context returned %v, want context.Canceled", err)
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- a cancelled sweep should stop before deleting", deleted)
	}
	// And the caller's wrapping must call that an interruption, not a refusal.
	if got := wrapOrphanSweepError(err).Error(); !strings.HasPrefix(got, "orphan sweep interrupted: ") {
		t.Errorf("a cancelled sweep is reported as %q, want it classified as interrupted", got)
	}
}
