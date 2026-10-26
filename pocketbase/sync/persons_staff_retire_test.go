package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The tests in this file pin owner ruling C (2026-10-26), the narrowed form of OD-05 = B and
// PM-7 = A: the persons sweep RETIRES a person CampMinder stops returning only when that person
// has a staff record, so the record and staff.person survive and fired staff stay in Staff
// Analysis. Every other orphan person is deleted exactly as before, and the camp_sessions sweep
// still deletes. A retired person CampMinder returns again is un-retired.
//
// They also pin the end of bug B1: a persons delete blanked staff.person on every staff row
// that pointed at the person, and the second blank in a season collided on staff's
// UNIQUE(year, person), failing the delete and leaving the season half-swept.

// newRetireTestApp builds persons as production declares the fields these paths touch --
// retired_at is a date field (migration 1500000252) -- a staff collection whose person relation
// and UNIQUE(year, person) index are production's, the pair B1 broke on, and camp_sessions
// WITHOUT retired_at, as production keeps it.
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

func existsByCMID(t *testing.T, app core.App, collection string, cmID, year int) bool {
	t.Helper()
	return countRows(t, app, collection, fmt.Sprintf("cm_id = %d && year = %d", cmID, year)) > 0
}

// processThreeCampers runs three campers through the real write path, so the sweep's collapse
// guard sees a believable computed set.
func processThreeCampers(t *testing.T, s *PersonsSync, year int) {
	t.Helper()
	existing := s.preloadExistingPersons(fmt.Sprintf("year = %d", year), year)
	for i, name := range []string{"Emma", "Liam", "Noah"} {
		if err := s.processPerson(camperData(9300001+i, name), true, existing,
			map[string]string{}, map[int]string{}, year); err != nil {
			t.Fatalf("processPerson: %v", err)
		}
	}
	s.SyncSuccessful = true
}

// TestPersonsSweepRetiresStaffLinkedPersonsAndKeepsTheirLinks: two people CampMinder no longer
// returns, each the person of a staff row, are retired rather than deleted. Both rows stay, both
// staff rows keep their person, and nothing fails (B1).
func TestPersonsSweepRetiresStaffLinkedPersonsAndKeepsTheirLinks(t *testing.T) {
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
	processThreeCampers(t, s, year)
	if err := s.deleteOrphans(year); err != nil {
		t.Fatalf("persons sweep: %v", err)
	}
	if s.Stats.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
	}
	if s.Stats.Deleted != 0 {
		t.Errorf("Stats.Deleted = %d, want 0: a staff-linked person is never deleted", s.Stats.Deleted)
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

// TestPersonsSweepDeletesAnOrphanWithNoStaffRecord: an orphan person with no staff record is
// deleted exactly as before ruling C -- beside a staff-linked orphan the same sweep retires.
// A staff row of ANOTHER season pointing at the person does not count: only the same year does.
func TestPersonsSweepDeletesAnOrphanWithNoStaffRecord(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2026

	saveRecord(t, app, "persons", map[string]any{"cm_id": 9300151, "first_name": "Mia", "year": year})
	otherSeason := saveRecord(t, app, "persons", map[string]any{"cm_id": 9300152, "first_name": "Ava", "year": year})
	saveRecord(t, app, "staff", map[string]any{"person": otherSeason, "year": year - 1})
	linked := saveRecord(t, app, "persons", map[string]any{"cm_id": 9300153, "first_name": "Ava", "year": year})
	saveRecord(t, app, "staff", map[string]any{"person": linked, "year": year})

	s := NewPersonsSync(app, nil)
	processThreeCampers(t, s, year)
	if err := s.deleteOrphans(year); err != nil {
		t.Fatalf("persons sweep: %v", err)
	}
	if s.Stats.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
	}
	if s.Stats.Deleted != 2 {
		t.Errorf("Stats.Deleted = %d, want 2 (the two orphans with no staff record this season)", s.Stats.Deleted)
	}
	for _, cmID := range []int{9300151, 9300152} {
		if existsByCMID(t, app, "persons", cmID, year) {
			t.Errorf("person %d has no staff record this season but was kept: it must be deleted as before", cmID)
		}
	}
	if findByCMID(t, app, "persons", 9300153, year).GetDateTime(retiredAtField).IsZero() {
		t.Error("the staff-linked orphan was not retired")
	}
}

// TestPersonsSweepDoesNotRestampARetiredPerson: a person already retired keeps the date it was
// first retired; the sweep reads only live rows.
func TestPersonsSweepDoesNotRestampARetiredPerson(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2026
	first, _ := types.ParseDateTime("2026-07-01 03:00:00.000Z")
	pid := saveRecord(t, app, "persons", map[string]any{"cm_id": 9300201, "year": year, retiredAtField: first})
	saveRecord(t, app, "staff", map[string]any{"person": pid, "year": year})

	s := NewPersonsSync(app, nil)
	processThreeCampers(t, s, year)
	if err := s.deleteOrphans(year); err != nil {
		t.Fatal(err)
	}
	if got := findByCMID(t, app, "persons", 9300201, year).GetDateTime(retiredAtField); !got.Equal(first) {
		t.Errorf("retired_at = %v, want the first retirement %v", got, first)
	}
}

// TestPersonsUnretireWhenCampMinderReturnsThem: a retired staff-linked person CampMinder sends
// again is live again, on any run that processes them, and keeps the staff link.
func TestPersonsUnretireWhenCampMinderReturnsThem(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2026
	pid := saveRecord(t, app, "persons", map[string]any{
		"cm_id": 9300301, "first_name": "Emma", "last_name": "Johnson", "year": year, "is_camper": true,
		retiredAtField: types.NowDateTime(),
	})
	staffID := saveRecord(t, app, "staff", map[string]any{"person": pid, "year": year})

	s := NewPersonsSync(app, nil)
	existing := s.preloadExistingPersons(fmt.Sprintf("year = %d", year), year)
	if err := s.processPerson(camperData(9300301, "Emma"), true, existing,
		map[string]string{}, map[int]string{}, year); err != nil {
		t.Fatal(err)
	}
	if got := findByCMID(t, app, "persons", 9300301, year).GetDateTime(retiredAtField); !got.IsZero() {
		t.Errorf("retired_at = %v, want empty: CampMinder returned this person", got)
	}
	if st, err := app.FindRecordById("staff", staffID); err != nil || st.GetString("person") != pid {
		t.Errorf("staff row lost its person on un-retire (err %v)", err)
	}
}

// TestSessionsSweepStillDeletes: ruling C leaves camp_sessions exactly as before -- an orphan
// session is deleted, on a schema with no retired_at field.
func TestSessionsSweepStillDeletes(t *testing.T) {
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
	if s.Stats.Deleted != 1 {
		t.Errorf("Stats.Deleted = %d, want 1", s.Stats.Deleted)
	}
	if existsByCMID(t, app, "camp_sessions", 1002, year) {
		t.Error("orphan session 1002 survived the sweep: sessions are deleted under ruling C")
	}
	if !existsByCMID(t, app, "camp_sessions", 1001, year) {
		t.Error("session 1001 was returned this run but is gone")
	}
}

// TestKeptRunsNeitherDeleteNorRetire: the runs that keep their orphans -- the hourly run, a
// historical replay and the Saturday all-seasons pass -- still leave persons (staff-linked or not)
// and sessions exactly as they are, retired_at included. Retiring is the nightly sweep's job, as
// deleting is.
func TestKeptRunsNeitherDeleteNorRetire(t *testing.T) {
	t.Parallel()
	app := newRetireTestApp(t)
	const year = 2021
	saveRecord(t, app, "persons", map[string]any{"cm_id": 9300401, "year": year})
	linked := saveRecord(t, app, "persons", map[string]any{"cm_id": 9300402, "year": year})
	saveRecord(t, app, "staff", map[string]any{"person": linked, "year": year})
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 1004, "year": year})

	p := NewPersonsSync(app, nil)
	p.setKeepOrphans(true)
	p.SyncSuccessful = true
	p.TrackProcessedKey(9300499, year)
	if err := p.deleteOrphans(year); err != nil {
		t.Fatal(err)
	}
	s := &SessionsSync{BaseSyncService: NewBaseSyncService(app, nil)}
	s.keepOrphansForReplay()
	s.SyncSuccessful = true
	if err := s.sweepOrphans(fmt.Sprintf("year = %d", year)); err != nil {
		t.Fatal(err)
	}
	for _, cmID := range []int{9300401, 9300402} {
		if got := findByCMID(t, app, "persons", cmID, year).GetDateTime(retiredAtField); !got.IsZero() {
			t.Errorf("a kept run retired person %d", cmID)
		}
	}
	if !existsByCMID(t, app, "camp_sessions", 1004, year) {
		t.Error("a kept run deleted a session")
	}
}
