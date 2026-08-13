package sync

import (
	"fmt"
	"testing"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// setupBunkAssignmentProtectionCollections builds the minimal schema needed
// to exercise protectNonActiveStaffAssignments against a real PocketBase app:
// persons, camp_sessions, bunk_assignments (linked via the `person` relation,
// not a person_id column -- see docs/reference/sync-id-conventions.md), and
// staff.
func setupBunkAssignmentProtectionCollections(t *testing.T, app core.App) {
	t.Helper()

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	assignments := core.NewBaseCollection("bunk_assignments")
	assignments.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.NumberField{Name: "year"})
	// PaginateRecords sorts by "-created" unconditionally, and deleteOrphans's
	// call to BuildRecordCMIDMappings goes through it.
	assignments.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(assignments); err != nil {
		t.Fatalf("create bunk_assignments: %v", err)
	}

	staff := core.NewBaseCollection("staff")
	staff.Fields.Add(&core.NumberField{Name: "person_id", Required: true})
	staff.Fields.Add(&core.TextField{Name: "status"})
	staff.Fields.Add(&core.BoolField{Name: "bunk_staff"})
	staff.Fields.Add(&core.NumberField{Name: "year"})
	// PaginateRecords sorts by "-created" unconditionally, so the staff
	// collection needs it even though nothing else in this test reads it.
	staff.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(staff); err != nil {
		t.Fatalf("create staff: %v", err)
	}
}

// TestProtectNonActiveStaffAssignments_ProtectsDismissedStaff is a regression
// test for kindred#2287: protectNonActiveStaffAssignments filtered
// bunk_assignments on a "person_id" column that does not exist (the person
// link is the `person` relation; bunk_assignments has no person_id field).
// FindRecordsByFilter errored on every iteration, protectedCount stayed 0,
// and the error was swallowed by a slog.Warn -- so the function reported
// success while protecting nothing. This exercises the real function against
// a live PocketBase app, unlike the local-logic simulation in
// TestBunkAssignmentsSync_NonActiveStaffOrphanProtection above.
func TestProtectNonActiveStaffAssignments_ProtectsDismissedStaff(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app)

	const year = 2025
	const personCMID = 3000001
	const sessionCMID = 5001

	person := saveRec(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	session := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionCMID, "year": year})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": session.Id, "year": year,
	})
	saveRec(t, app, "staff", map[string]any{
		"person_id": personCMID, "status": "dismissed", "bunk_staff": true, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{App: app, ProcessedKeys: make(map[string]bool)}}

	protectedCount, err := s.protectNonActiveStaffAssignments(year)
	if err != nil {
		t.Fatalf("protectNonActiveStaffAssignments: %v", err)
	}
	if protectedCount == 0 {
		t.Fatal("protectedCount = 0, want > 0 for a year with a known non-active bunk staff assignment")
	}

	wantKey := fmt.Sprintf("%d:%d|%d", personCMID, sessionCMID, year)
	if !s.ProcessedKeys[wantKey] {
		t.Errorf("ProcessedKeys[%q] missing -- assignment was not protected from orphan deletion", wantKey)
	}
}

// setupBunkAssignmentSweepCollections builds persons/camp_sessions/bunk_assignments
// only -- deliberately no "staff" collection. protectNonActiveStaffAssignments's
// PaginateRecords("staff", ...) call then fails with a real "missing collection"
// error, the same class of infrastructure failure a broken filter produces: a
// legitimate way to force protectThenSweepOrphans down its failure path without
// re-breaking production code to do it.
//
// bunk_assignments carries a `created` autodate field here (unlike
// setupBunkAssignmentProtectionCollections' copy) because deleteOrphans's call
// to BuildRecordCMIDMappings goes through PaginateRecords, which sorts by
// "-created" unconditionally.
func setupBunkAssignmentSweepCollections(t *testing.T, app core.App) {
	t.Helper()

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	assignments := core.NewBaseCollection("bunk_assignments")
	assignments.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.NumberField{Name: "year"})
	assignments.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(assignments); err != nil {
		t.Fatalf("create bunk_assignments: %v", err)
	}
}

// newTestCampMinderClient builds a real *campminder.Client for tests that only
// need GetSeasonID() -- a pure getter, no network call -- so deleteOrphans can
// run against a live PocketBase app without mocking CampMinder's HTTP API.
func newTestCampMinderClient(t *testing.T, year int) *campminder.Client {
	t.Helper()
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")
	client, err := campminder.NewClient(&campminder.Config{APIKey: "test-key", ClientID: "test-client", SeasonID: year})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}
	return client
}

// TestProtectThenSweepOrphans_ProtectionFailureAbortsSweep is a regression test
// for the ordering half of kindred#2287: protectNonActiveStaffAssignments used
// to run, its error get counted, and then deleteOrphans run anyway in the same
// Sync() call -- so a protection failure meant the sweep deleted precisely the
// assignments protection existed to save, and only THEN did the run report a
// failure. That reports the damage instead of preventing it. The fix is that a
// protection failure must abort the sweep, not just get logged next to it.
func TestProtectThenSweepOrphans_ProtectionFailureAbortsSweep(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentSweepCollections(t, app)

	const year = 2025

	// A "kept" assignment: its key will be marked processed, as the normal
	// sync loop would have done for a live camper/staff record. Needed so the
	// orphan-sweep guard sees a non-empty computed set and does not refuse the
	// sweep as a total collapse (which would pass this test for the wrong
	// reason).
	keptPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000001, "year": year})
	keptSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6001, "year": year})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": keptPerson.Id, "session": keptSession.Id, "year": year,
	})

	// An orphan: NOT in ProcessedKeys. If the sweep runs, this gets deleted.
	orphanPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000002, "year": year})
	orphanSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6002, "year": year})
	orphanAssignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": orphanPerson.Id, "session": orphanSession.Id, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: app, Client: newTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.SyncSuccessful = true // arms deleteOrphans; otherwise it no-ops regardless of ordering
	s.TrackProcessedCompositeKey(fmt.Sprintf("%d:%d", 4000001, 6001), year)

	s.protectThenSweepOrphans(year)

	if s.Stats.Errors == 0 {
		t.Error("Stats.Errors = 0, want > 0 -- the missing staff collection is an infrastructure failure and must be counted")
	}

	if _, err := app.FindRecordById("bunk_assignments", orphanAssignment.Id); err != nil {
		t.Errorf("orphan bunk_assignment was deleted despite a protection failure -- "+
			"the sweep ran when it must not have: %v", err)
	}
}

// TestProtectThenSweepOrphans_ProtectionSuccessStillSweeps is the mirror check:
// the abort-on-failure guard above must not also block the sweep on a normal,
// successful run.
func TestProtectThenSweepOrphans_ProtectionSuccessStillSweeps(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app) // includes an empty "staff" collection

	const year = 2025

	keptPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000003, "year": year})
	keptSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6003, "year": year})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": keptPerson.Id, "session": keptSession.Id, "year": year,
	})

	orphanPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000004, "year": year})
	orphanSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6004, "year": year})
	orphanAssignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": orphanPerson.Id, "session": orphanSession.Id, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: app, Client: newTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.SyncSuccessful = true
	s.TrackProcessedCompositeKey(fmt.Sprintf("%d:%d", 4000003, 6003), year)

	s.protectThenSweepOrphans(year)

	if s.Stats.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0 -- protection had nothing to fail on", s.Stats.Errors)
	}

	if _, err := app.FindRecordById("bunk_assignments", orphanAssignment.Id); err == nil {
		t.Error("orphan bunk_assignment still exists -- the sweep did not run on a successful protection pass")
	}
}

// TestProtectNonActiveStaffAssignments_ActiveStaffUntouched verifies active
// bunk staff are left alone -- their assignments come fresh from the
// CampMinder API each sync and must not be pre-tracked as processed.
func TestProtectNonActiveStaffAssignments_ActiveStaffUntouched(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app)

	const year = 2025
	const personCMID = 3000002
	const sessionCMID = 5002

	person := saveRec(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	session := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionCMID, "year": year})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": session.Id, "year": year,
	})
	saveRec(t, app, "staff", map[string]any{
		"person_id": personCMID, "status": "active", "bunk_staff": true, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{App: app, ProcessedKeys: make(map[string]bool)}}

	protectedCount, err := s.protectNonActiveStaffAssignments(year)
	if err != nil {
		t.Fatalf("protectNonActiveStaffAssignments: %v", err)
	}
	if protectedCount != 0 {
		t.Errorf("protectedCount = %d, want 0 -- active staff assignments should not be pre-tracked", protectedCount)
	}
}
