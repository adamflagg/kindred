package sync

import (
	"fmt"
	"testing"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// flakyCollectionApp wraps a core.App and fails the first failuresLeft calls to
// FindRecordsByFilter for one named collection, delegating everything else.
//
// It models a TRANSIENT database error, which is the only shape in which the
// session-lookup hazard is observable. A permanent camp_sessions failure cannot
// demonstrate it: deleteOrphans resolves session relations through the same
// collection, so a still-failing lookup leaves the assignment unkeyable and the
// sweep skips it anyway -- the row survives for the wrong reason and the test
// would pass against the bug. Failing exactly the one lookup protection makes,
// then healing, is what separates "protection dropped it" from "the sweep could
// not see it". Deleting the session record instead would not work either: that
// yields an empty result, not an error, which is the deliberate non-destructive
// skip path.
type flakyCollectionApp struct {
	core.App
	collection   string
	failuresLeft int
}

func (a *flakyCollectionApp) FindRecordsByFilter(
	collectionModelOrIdentifier any,
	filter string,
	sort string,
	limit int,
	offset int,
	params ...dbx.Params,
) ([]*core.Record, error) {
	if name, ok := collectionModelOrIdentifier.(string); ok && name == a.collection && a.failuresLeft > 0 {
		a.failuresLeft--
		return nil, fmt.Errorf("simulated transient database failure querying %s", name)
	}
	records, err := a.App.FindRecordsByFilter(collectionModelOrIdentifier, filter, sort, limit, offset, params...)
	if err != nil {
		return nil, fmt.Errorf("delegating FindRecordsByFilter: %w", err)
	}
	return records, nil
}

// setupBunkAssignmentProtectionCollections builds the minimal schema needed
// to exercise protectNonActiveStaffAssignments against a real PocketBase app:
// persons, camp_sessions, bunk_assignments (linked via the `person` relation,
// not a person_id column -- see docs/reference/sync-id-conventions.md), and
// staff.
func setupBunkAssignmentProtectionCollections(t *testing.T, app core.App) {
	t.Helper()

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.NumberField{Name: "year", Required: true})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	persons.Fields.Add(&core.NumberField{Name: "year", Required: true})
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	// bunk is part of the bunk_assignments grain alongside person and
	// session (kindred#2259) -- protectNonActiveStaffAssignments and
	// deleteOrphans both resolve it into their composite keys.
	bunks := core.NewBaseCollection("bunks")
	bunks.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	if err := app.Save(bunks); err != nil {
		t.Fatalf("create bunks: %v", err)
	}

	assignments := core.NewBaseCollection("bunk_assignments")
	assignments.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "bunk", CollectionId: bunks.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.NumberField{Name: "year", Required: true})
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
	staff.Fields.Add(&core.NumberField{Name: "year", Required: true})
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
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app)

	const year = 2025
	const personCMID = 3000001
	const sessionCMID = 5001
	const bunkCMID = 7001

	person := saveRec(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	session := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionCMID, "year": year})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": bunkCMID})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": session.Id, "bunk": bunk.Id, "year": year,
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

	wantKey := fmt.Sprintf("%d:%d:%d|%d", personCMID, sessionCMID, bunkCMID, year)
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
// Everything else matches setupBunkAssignmentProtectionCollections, `created`
// autodate field included -- deleteOrphans's call to BuildRecordCMIDMappings
// goes through PaginateRecords, which sorts by "-created" unconditionally, so
// both copies need it. The absent `staff` collection is the only difference,
// and it is the whole point of this helper.
func setupBunkAssignmentSweepCollections(t *testing.T, app core.App) {
	t.Helper()

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.NumberField{Name: "year", Required: true})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	persons.Fields.Add(&core.NumberField{Name: "year", Required: true})
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	bunks := core.NewBaseCollection("bunks")
	bunks.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	if err := app.Save(bunks); err != nil {
		t.Fatalf("create bunks: %v", err)
	}

	assignments := core.NewBaseCollection("bunk_assignments")
	assignments.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "bunk", CollectionId: bunks.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.NumberField{Name: "year", Required: true})
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
	keptBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 7101})
	keptPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000001, "year": year})
	keptSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6001, "year": year})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": keptPerson.Id, "session": keptSession.Id, "bunk": keptBunk.Id, "year": year,
	})

	// An orphan: NOT in ProcessedKeys. If the sweep runs, this gets deleted.
	orphanBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 7102})
	orphanPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000002, "year": year})
	orphanSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6002, "year": year})
	orphanAssignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": orphanPerson.Id, "session": orphanSession.Id, "bunk": orphanBunk.Id, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: app, Client: newTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.SyncSuccessful = true // arms deleteOrphans; otherwise it no-ops regardless of ordering
	s.TrackProcessedCompositeKey(fmt.Sprintf("%d:%d:%d", 4000001, 6001, 7101), year)

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

	keptBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 7103})
	keptPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000003, "year": year})
	keptSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6003, "year": year})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": keptPerson.Id, "session": keptSession.Id, "bunk": keptBunk.Id, "year": year,
	})

	orphanBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 7104})
	orphanPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000004, "year": year})
	orphanSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6004, "year": year})
	orphanAssignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": orphanPerson.Id, "session": orphanSession.Id, "bunk": orphanBunk.Id, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: app, Client: newTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.SyncSuccessful = true
	s.TrackProcessedCompositeKey(fmt.Sprintf("%d:%d:%d", 4000003, 6003, 7103), year)

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
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app)

	const year = 2025
	const personCMID = 3000002
	const sessionCMID = 5002
	const bunkCMID = 7002

	person := saveRec(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	session := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionCMID, "year": year})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": bunkCMID})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": session.Id, "bunk": bunk.Id, "year": year,
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

// TestProtectThenSweepOrphans_DismissedStaffAssignmentSurvivesSweep is the
// end-to-end guarantee kindred#2287 actually asked for, and the one the other
// tests in this file each prove only half of: _ProtectsDismissedStaff shows
// protection writes the key but never runs the sweep, and
// _ProtectionSuccessStillSweeps runs the sweep but against an empty staff
// collection, so nothing is ever protected in the same pass that deletes.
//
// Here one call to protectThenSweepOrphans must do both: keep the dismissed
// staff member's assignment and delete a genuine orphan beside it. That is what
// pins the composite-key format across the seam -- protection builds keys with
// TrackProcessedCompositeKey and deleteOrphans rebuilds them from stored
// records, and nothing but this test fails if the two formats drift apart.
func TestProtectThenSweepOrphans_DismissedStaffAssignmentSurvivesSweep(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app)

	const year = 2025
	const dismissedCMID = 3000004
	const dismissedSessionCMID = 5004
	const dismissedBunkCMID = 7004

	// The dismissed staff member: CampMinder has stopped reporting the
	// assignment, so nothing in this run marks it processed. Only protection
	// can save it.
	dismissedPerson := saveRec(t, app, "persons", map[string]any{"cm_id": dismissedCMID, "year": year})
	dismissedSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": dismissedSessionCMID, "year": year})
	dismissedBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": dismissedBunkCMID})
	dismissedAssignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": dismissedPerson.Id, "session": dismissedSession.Id, "bunk": dismissedBunk.Id, "year": year,
	})
	saveRec(t, app, "staff", map[string]any{
		"person_id": dismissedCMID, "status": "dismissed", "bunk_staff": true, "year": year,
	})

	// A genuine orphan: nobody's staff record, never marked processed. The
	// sweep must still delete this, or the test would pass simply because the
	// sweep did nothing at all.
	orphanBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 7005})
	orphanPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000005, "year": year})
	orphanSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6005, "year": year})
	orphanAssignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": orphanPerson.Id, "session": orphanSession.Id, "bunk": orphanBunk.Id, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: app, Client: newTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.SyncSuccessful = true // arms deleteOrphans

	if err := s.protectThenSweepOrphans(year); err != nil {
		t.Fatalf("protectThenSweepOrphans: %v", err)
	}

	if s.Stats.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0 -- nothing failed on this path", s.Stats.Errors)
	}

	// protectedCount > 0, observed through the key protection wrote.
	wantKey := fmt.Sprintf("%d:%d:%d|%d", dismissedCMID, dismissedSessionCMID, dismissedBunkCMID, year)
	if !s.ProcessedKeys[wantKey] {
		t.Errorf("ProcessedKeys[%q] missing -- protection did not run or used a different key format", wantKey)
	}

	if _, err := app.FindRecordById("bunk_assignments", dismissedAssignment.Id); err != nil {
		t.Errorf("dismissed staff assignment was deleted by the sweep it was supposed to be protected from: %v", err)
	}

	if _, err := app.FindRecordById("bunk_assignments", orphanAssignment.Id); err == nil {
		t.Error("genuine orphan still exists -- the sweep did not run, so this test proves nothing about protection")
	}
}

// TestProtectThenSweepOrphans_SessionLookupFailureAbortsSweep covers the second
// instance of the kindred#2295 class found inside this very function: the
// per-assignment camp_sessions lookup treated a query error and a genuinely
// missing session identically, with `if err != nil || len(sessions) == 0 {
// continue }`.
//
// A transient failure there was silent and destructive in combination: the
// assignment never reached TrackProcessedCompositeKey, protection still
// returned nil, so protectThenSweepOrphans ran the sweep and deleted the very
// row the dismissed-staff protection exists to keep. The abort-on-failure gate
// added for #2287 did not help, because protection never reported a failure.
//
// A missing session record must remain a non-destructive skip -- that is a real
// state, not an error, and the sweep cannot derive a composite key for such a
// record anyway.
func TestProtectThenSweepOrphans_SessionLookupFailureAbortsSweep(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app)

	const year = 2025
	const dismissedCMID = 3000005
	const dismissedSessionCMID = 5005
	const dismissedBunkCMID = 7006

	dismissedPerson := saveRec(t, app, "persons", map[string]any{"cm_id": dismissedCMID, "year": year})
	dismissedSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": dismissedSessionCMID, "year": year})
	dismissedBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": dismissedBunkCMID})
	dismissedAssignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": dismissedPerson.Id, "session": dismissedSession.Id, "bunk": dismissedBunk.Id, "year": year,
	})
	saveRec(t, app, "staff", map[string]any{
		"person_id": dismissedCMID, "status": "dismissed", "bunk_staff": true, "year": year,
	})

	// A second assignment whose key IS tracked, so the computed set is
	// non-empty and OrphanSweepGuard does not refuse the sweep as a total
	// collapse -- which would make this test pass without proving anything.
	keptBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 7007})
	keptPerson := saveRec(t, app, "persons", map[string]any{"cm_id": 4000006, "year": year})
	keptSession := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6006, "year": year})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": keptPerson.Id, "session": keptSession.Id, "bunk": keptBunk.Id, "year": year,
	})

	// Fail exactly one camp_sessions lookup: the single one protection makes
	// for the single dismissed staff member. Every later lookup -- including
	// every one deleteOrphans makes to rebuild composite keys -- succeeds, so
	// the dismissed assignment is fully keyable by the sweep and would be
	// deleted if protection let it through.
	flaky := &flakyCollectionApp{App: app, collection: "camp_sessions", failuresLeft: 1}

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: flaky, Client: newTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.SyncSuccessful = true
	s.TrackProcessedCompositeKey(fmt.Sprintf("%d:%d:%d", 4000006, 6006, 7007), year)

	err = s.protectThenSweepOrphans(year)
	if err == nil {
		t.Error("protectThenSweepOrphans returned nil -- a failed session lookup must be reported, not swallowed")
	}

	if s.Stats.Errors == 0 {
		t.Error("Stats.Errors = 0, want > 0 -- a failed database query is an infrastructure failure and must be counted")
	}

	if flaky.failuresLeft != 0 {
		t.Fatal("the injected camp_sessions failure never fired -- this test did not exercise the path it claims to")
	}

	if _, err := app.FindRecordById("bunk_assignments", dismissedAssignment.Id); err != nil {
		t.Errorf("dismissed staff assignment was swept after a transient session-lookup failure -- "+
			"protection dropped it silently and the sweep ran anyway: %v", err)
	}
}

// TestProtectThenSweepOrphans_SweepRefusalIsCountedAndReturned pins the second
// of protectThenSweepOrphans's two failure branches.
//
// Protection succeeding and the sweep then refusing is the same event to an
// operator as protection failing outright -- an upstream step came back
// untrustworthy and rows were not swept -- but the two branches sat side by
// side treating it differently: one counted and returned, the other only
// logged. A refusal that is merely logged leaves Sync() returning nil, so the
// run reports success having swept nothing.
//
// The refusal here is a real OrphanSweepGuard total collapse (kindred#2279),
// not a stub: an empty computed set against rows on disk.
func TestProtectThenSweepOrphans_SweepRefusalIsCountedAndReturned(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app) // empty staff -- protection succeeds with nothing to do

	const year = 2025

	person := saveRec(t, app, "persons", map[string]any{"cm_id": 4000007, "year": year})
	session := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 6007, "year": year})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 7008})
	assignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": person.Id, "session": session.Id, "bunk": bunk.Id, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: app, Client: newTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.SyncSuccessful = true
	// ProcessedKeys deliberately left empty: rows on disk, nothing computed,
	// which is exactly what OrphanSweepGuard refuses.

	err = s.protectThenSweepOrphans(year)
	if err == nil {
		t.Error("protectThenSweepOrphans returned nil -- a refused sweep must be reported, not just logged")
	}

	if s.Stats.Errors == 0 {
		t.Error("Stats.Errors = 0, want > 0 -- a refused sweep is counted like any other infrastructure failure")
	}

	if _, err := app.FindRecordById("bunk_assignments", assignment.Id); err != nil {
		t.Errorf("the guard refused the sweep but records were deleted anyway: %v", err)
	}
}

// TestProtectNonActiveStaffAssignments_MissingBunkIsNonDestructiveSkip is the
// bunk-shaped twin of the session case below, added when bunk joined the
// bunk_assignments grain (kindred#2259): protection now has to resolve a bunk
// as well as a session before it can build a composite key, which is a second
// place the function can fail to protect a row.
//
// A row with no bunk relation is a skip and NOT an error, for the same reason a
// missing session is: deleteOrphans cannot derive a composite key for such a
// record either (its keyFunc requires bunkCMID > 0), so the sweep will not
// touch it and there is nothing to protect it from. What must not happen is an
// abort, which would take protection down for every other non-active staff
// member in the year.
//
// The row is asserted to still exist afterwards so the test cannot pass
// vacuously by the assignment having disappeared.
func TestProtectNonActiveStaffAssignments_MissingBunkIsNonDestructiveSkip(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app)

	const year = 2025
	const dismissedCMID = 3000007

	dismissedPerson := saveRec(t, app, "persons", map[string]any{"cm_id": dismissedCMID, "year": year})
	session := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 5007, "year": year})
	assignment := saveRec(t, app, "bunk_assignments", map[string]any{
		"person": dismissedPerson.Id, "session": session.Id, "year": year,
	})
	saveRec(t, app, "staff", map[string]any{
		"person_id": dismissedCMID, "status": "dismissed", "bunk_staff": true, "year": year,
	})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{App: app, ProcessedKeys: make(map[string]bool)}}

	protectedCount, err := s.protectNonActiveStaffAssignments(year)
	if err != nil {
		t.Fatalf("a missing bunk must be a skip, not an error: %v", err)
	}
	if protectedCount != 0 {
		t.Errorf("protectedCount = %d, want 0 -- there is no bunk to build a composite key from", protectedCount)
	}
	if len(s.ProcessedKeys) != 0 {
		t.Errorf("ProcessedKeys = %v, want empty -- a key that omits bunk would never match deleteOrphans", s.ProcessedKeys)
	}
	if _, findErr := app.FindRecordById("bunk_assignments", assignment.Id); findErr != nil {
		t.Fatalf("the assignment row must still exist for this test to mean anything: %v", findErr)
	}
}

// TestProtectNonActiveStaffAssignments_MissingSessionIsNonDestructiveSkip is the
// other half of the test above: a session record that is genuinely absent is not
// an error, and must not abort protection or the sweep for everyone else.
func TestProtectNonActiveStaffAssignments_MissingSessionIsNonDestructiveSkip(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentProtectionCollections(t, app)

	const year = 2025
	const dismissedCMID = 3000006

	dismissedPerson := saveRec(t, app, "persons", map[string]any{"cm_id": dismissedCMID, "year": year})
	session := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": 5006, "year": year})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": 7009})
	saveRec(t, app, "bunk_assignments", map[string]any{
		"person": dismissedPerson.Id, "session": session.Id, "bunk": bunk.Id, "year": year,
	})
	saveRec(t, app, "staff", map[string]any{
		"person_id": dismissedCMID, "status": "resigned", "bunk_staff": true, "year": year,
	})

	// Remove the session the assignment points at, leaving a dangling relation.
	if delErr := app.Delete(session); delErr != nil {
		t.Fatalf("delete session: %v", delErr)
	}

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{App: app, ProcessedKeys: make(map[string]bool)}}

	protectedCount, err := s.protectNonActiveStaffAssignments(year)
	if err != nil {
		t.Fatalf("a missing session must be a skip, not an error: %v", err)
	}
	if protectedCount != 0 {
		t.Errorf("protectedCount = %d, want 0 -- there is no session to build a composite key from", protectedCount)
	}
}
