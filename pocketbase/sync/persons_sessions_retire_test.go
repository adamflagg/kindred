package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The tests in this file pin owner ruling OD-05 = B (PM-7 = A): the persons and camp_sessions
// sweeps RETIRE a row CampMinder stops returning instead of deleting it, so the record and every
// link to it stay and staff can look back; a row CampMinder returns again is un-retired.
//
// They also pin the end of bug B1: a persons delete blanked staff.person on every staff row
// that pointed at the person, and the second blank in a season collided on staff's
// UNIQUE(year, person), failing the delete and leaving the season half-swept.

// newRetireTestApp builds persons and camp_sessions as production declares the fields these
// paths touch -- retired_at is a date field (migration 1500000252) -- and a staff collection
// whose person relation and UNIQUE(year, person) index are production's, the pair B1 broke on.
func newRetireTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	persons.Fields.Add(&core.TextField{Name: "first_name"})
	persons.Fields.Add(&core.TextField{Name: "last_name"})
	persons.Fields.Add(&core.NumberField{Name: "year", Required: true})
	persons.Fields.Add(&core.BoolField{Name: "is_camper"})
	persons.Fields.Add(&core.DateField{Name: retiredAtField})
	persons.Indexes = []string{"CREATE UNIQUE INDEX `idx_retire_persons` ON `persons` (`cm_id`, `year`)"}
	if err := app.Save(persons); err != nil {
		t.Fatalf("save persons: %v", err)
	}

	staff := core.NewBaseCollection("staff")
	staff.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	staff.Fields.Add(&core.NumberField{Name: "year", Required: true})
	staff.Fields.Add(&core.TextField{Name: "status"})
	staff.Indexes = []string{"CREATE UNIQUE INDEX `idx_retire_staff` ON `staff` (`year`, `person`)"}
	if err := app.Save(staff); err != nil {
		t.Fatalf("save staff: %v", err)
	}

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.TextField{Name: "name"})
	sessions.Fields.Add(&core.NumberField{Name: "year", Required: true})
	sessions.Fields.Add(&core.DateField{Name: retiredAtField})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("save camp_sessions: %v", err)
	}
	return app
}

func camperData(cmID int, first string) map[string]any {
	return map[string]any{
		"ID":            float64(cmID),
		"CamperDetails": map[string]any{},
		"Name":          map[string]any{"First": first, "Last": "Johnson"},
	}
}

func findByCMID(t *testing.T, app core.App, collection string, cmID, year int) *core.Record {
	t.Helper()
	rec, err := app.FindFirstRecordByFilter(collection, fmt.Sprintf("cm_id = %d && year = %d", cmID, year))
	if err != nil {
		t.Fatalf("%s cm_id %d (%d) is gone: %v", collection, cmID, year, err)
	}
	return rec
}

// TestPersonsSweepRetiresAndKeepsStaffLinks: two people CampMinder no longer returns, each the
// person of a staff row, are retired rather than deleted. Both rows stay, both staff rows keep
// their person, and nothing fails (B1).
func TestPersonsSweepRetiresAndKeepsStaffLinks(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2026

	gone := []int{9300101, 9300102}
	staffIDs := map[int]string{}
	for _, cmID := range gone {
		pid := saveRecord(t, app, "persons", map[string]any{"cm_id": cmID, "first_name": "Ava", "year": year})
		staffIDs[cmID] = saveRecord(t, app, "staff", map[string]any{"person": pid, "year": year, "status": "dismissed"})
	}

	s := NewPersonsSync(app, nil)
	existing := s.preloadExistingPersons(fmt.Sprintf("year = %d", year), year)
	for i, name := range []string{"Emma", "Liam", "Noah"} {
		if err := s.processPerson(camperData(9300001+i, name), true, existing,
			map[string]string{}, map[int]string{}, year); err != nil {
			t.Fatalf("processPerson: %v", err)
		}
	}
	s.SyncSuccessful = true

	if err := s.retireOrphans(year); err != nil {
		t.Fatalf("persons sweep: %v", err)
	}
	if s.Stats.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
	}
	if s.Stats.Deleted != 0 {
		t.Errorf("Stats.Deleted = %d, want 0: the persons sweep never deletes", s.Stats.Deleted)
	}

	for _, cmID := range gone {
		p := findByCMID(t, app, "persons", cmID, year)
		if p.GetDateTime(retiredAtField).IsZero() {
			t.Errorf("person %d: retired_at empty, want the sweep's stamp", cmID)
		}
		st, err := app.FindRecordById("staff", staffIDs[cmID])
		if err != nil {
			t.Fatalf("staff row for %d is gone: %v", cmID, err)
		}
		if st.GetString("person") != p.Id {
			t.Errorf("staff row for %d: person = %q, want %q (the link must survive)", cmID, st.GetString("person"), p.Id)
		}
	}
	for i := range 3 {
		if p := findByCMID(t, app, "persons", 9300001+i, year); !p.GetDateTime(retiredAtField).IsZero() {
			t.Errorf("person %d was processed this run but is retired", 9300001+i)
		}
	}
}

// TestPersonsSweepDoesNotRestampARetiredPerson: a person already retired keeps the date it was
// first retired; the sweep stamps only a live row.
func TestPersonsSweepDoesNotRestampARetiredPerson(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2026
	first, _ := types.ParseDateTime("2026-07-01 03:00:00.000Z")
	saveRecord(t, app, "persons", map[string]any{"cm_id": 9300201, "year": year, retiredAtField: first})

	s := NewPersonsSync(app, nil)
	existing := s.preloadExistingPersons(fmt.Sprintf("year = %d", year), year)
	if err := s.processPerson(camperData(9300202, "Emma"), true, existing,
		map[string]string{}, map[int]string{}, year); err != nil {
		t.Fatal(err)
	}
	s.SyncSuccessful = true
	if err := s.retireOrphans(year); err != nil {
		t.Fatal(err)
	}
	if got := findByCMID(t, app, "persons", 9300201, year).GetDateTime(retiredAtField); !got.Equal(first) {
		t.Errorf("retired_at = %v, want the first retirement %v", got, first)
	}
}

// TestPersonsUnretireWhenCampMinderReturnsThem: a retired person CampMinder sends again is live
// again, on any run that processes them.
func TestPersonsUnretireWhenCampMinderReturnsThem(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2026
	saveRecord(t, app, "persons", map[string]any{
		"cm_id": 9300301, "first_name": "Emma", "last_name": "Johnson", "year": year, "is_camper": true,
		retiredAtField: types.NowDateTime(),
	})

	s := NewPersonsSync(app, nil)
	existing := s.preloadExistingPersons(fmt.Sprintf("year = %d", year), year)
	if err := s.processPerson(camperData(9300301, "Emma"), true, existing,
		map[string]string{}, map[int]string{}, year); err != nil {
		t.Fatal(err)
	}
	if got := findByCMID(t, app, "persons", 9300301, year).GetDateTime(retiredAtField); !got.IsZero() {
		t.Errorf("retired_at = %v, want empty: CampMinder returned this person", got)
	}
}

// TestSessionsSweepRetiresInsteadOfDeleting: a session CampMinder stops returning is retired, so
// its season's bunk assignments, plans and lodging rows keep their session.
func TestSessionsSweepRetiresInsteadOfDeleting(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2026
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 1001, "name": "Session 1", "year": year})
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 1002, "name": "Session 2", "year": year})

	s := &SessionsSync{BaseSyncService: NewBaseSyncService(app, nil)}
	s.TrackProcessedKey(1001, year)
	s.SyncSuccessful = true
	if err := s.sweepOrphans(fmt.Sprintf("year = %d", year)); err != nil {
		t.Fatal(err)
	}
	if s.Stats.Deleted != 0 {
		t.Errorf("Stats.Deleted = %d, want 0", s.Stats.Deleted)
	}
	if got := findByCMID(t, app, "camp_sessions", 1002, year).GetDateTime(retiredAtField); got.IsZero() {
		t.Error("session 1002: retired_at empty, want the sweep's stamp")
	}
	if got := findByCMID(t, app, "camp_sessions", 1001, year).GetDateTime(retiredAtField); !got.IsZero() {
		t.Error("session 1001 was returned this run but is retired")
	}
}

// TestSessionsUnretireWhenCampMinderReturnsThem: a retired session CampMinder sends again is
// live again.
func TestSessionsUnretireWhenCampMinderReturnsThem(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2026
	saveRecord(t, app, "camp_sessions", map[string]any{
		"cm_id": 1003, "name": "Session 3", "year": year, retiredAtField: types.NowDateTime()})

	s := &SessionsSync{BaseSyncService: NewBaseSyncService(app, nil)}
	existing, err := s.PreloadRecords("camp_sessions", fmt.Sprintf("year = %d", year), func(r *core.Record) (any, bool) {
		return int(r.GetFloat("cm_id")), true
	})
	if err != nil {
		t.Fatal(err)
	}
	s.upsertSession(1003, year, map[string]any{"cm_id": 1003, "name": "Session 3", "year": year}, existing)
	if s.Stats.Errors != 0 || s.Stats.Rejected != 0 {
		t.Fatalf("errors=%d rejected=%d", s.Stats.Errors, s.Stats.Rejected)
	}
	if got := findByCMID(t, app, "camp_sessions", 1003, year).GetDateTime(retiredAtField); !got.IsZero() {
		t.Errorf("retired_at = %v, want empty: CampMinder returned this session", got)
	}
}

// TestKeptRunsNeitherDeleteNorRetire: the runs that keep their orphans -- the hourly run, a
// historical replay and the Saturday all-seasons pass -- still leave persons and sessions exactly
// as they are, retired_at included. Retiring is the nightly sweep's job, as deleting was.
func TestKeptRunsNeitherDeleteNorRetire(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2021
	saveRecord(t, app, "persons", map[string]any{"cm_id": 9300401, "year": year})
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 1004, "year": year})

	p := NewPersonsSync(app, nil)
	p.setKeepOrphans(true)
	p.SyncSuccessful = true
	p.TrackProcessedKey(9300499, year)
	if err := p.retireOrphans(year); err != nil {
		t.Fatal(err)
	}
	s := &SessionsSync{BaseSyncService: NewBaseSyncService(app, nil)}
	s.keepOrphansForReplay()
	s.SyncSuccessful = true
	if err := s.sweepOrphans(fmt.Sprintf("year = %d", year)); err != nil {
		t.Fatal(err)
	}
	if got := findByCMID(t, app, "persons", 9300401, year).GetDateTime(retiredAtField); !got.IsZero() {
		t.Error("a kept run retired a person")
	}
	if got := findByCMID(t, app, "camp_sessions", 1004, year).GetDateTime(retiredAtField); !got.IsZero() {
		t.Error("a kept run retired a session")
	}
}
