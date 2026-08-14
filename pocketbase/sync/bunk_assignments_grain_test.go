package sync

import (
	"fmt"
	"os"
	"slices"
	"sort"
	"testing"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// newParallelTestCampMinderClient is newTestCampMinderClient
// (bunk_assignments_protection_test.go), adapted for a t.Parallel() caller.
// t.Setenv panics under Parallel because it cannot be safely undone once
// sibling tests are running concurrently; os.Setenv has no such restriction,
// and every caller wants the identical constant value, so leaving it set for
// the rest of the test binary's life is harmless.
func newParallelTestCampMinderClient(t *testing.T, year int) *campminder.Client {
	t.Helper()
	//nolint:usetesting // t.Setenv panics under t.Parallel(); every caller wants
	// this identical constant value, so os.Setenv with no cleanup is deliberate.
	if err := os.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key"); err != nil {
		t.Fatalf("os.Setenv: %v", err)
	}
	client, err := campminder.NewClient(&campminder.Config{APIKey: "test-key", ClientID: "test-client", SeasonID: year})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}
	return client
}

// setupBunkAssignmentGrainCollections builds the schema needed to drive
// processAssignment, preloadExistingAssignments and loadMappings directly
// against a live PocketBase app: persons, camp_sessions, bunks (all
// year-scoped, matching LookupRelation's year filter for these
// collections), bunk_plans (LookupBunkPlan queries it even when the
// optional bunk_plan relation cannot be resolved, and loadMappings walks it
// to build bunkPlanBunkToSession), bunk_assignments itself, attendees
// (loadMappings reads person enrollments from it) and staff
// (protectThenSweepOrphans's protection pass and loadMappings both need it
// to exist).
func setupBunkAssignmentGrainCollections(t *testing.T, app core.App) {
	t.Helper()

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	persons.Fields.Add(&core.NumberField{Name: "year", Required: true})
	persons.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	sessions.Fields.Add(&core.NumberField{Name: "year", Required: true})
	sessions.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	bunks := core.NewBaseCollection("bunks")
	bunks.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	bunks.Fields.Add(&core.NumberField{Name: "year", Required: true})
	bunks.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(bunks); err != nil {
		t.Fatalf("create bunks: %v", err)
	}

	bunkPlans := core.NewBaseCollection("bunk_plans")
	bunkPlans.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	bunkPlans.Fields.Add(&core.RelationField{Name: "bunk", CollectionId: bunks.Id, MaxSelect: 1})
	bunkPlans.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	bunkPlans.Fields.Add(&core.NumberField{Name: "year", Required: true})
	bunkPlans.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(bunkPlans); err != nil {
		t.Fatalf("create bunk_plans: %v", err)
	}

	assignments := core.NewBaseCollection("bunk_assignments")
	assignments.Fields.Add(&core.NumberField{Name: "cm_id"})
	assignments.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "bunk", CollectionId: bunks.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "bunk_plan", CollectionId: bunkPlans.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.NumberField{Name: "year", Required: true})
	assignments.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	// The widened unique index this PR's migration adds in production
	// (see pb_migrations/1500000155_bunk_assignments_bunk_grain.js). Pinned
	// here too so these tests exercise the same DB-level constraint, not
	// just the in-memory composite key -- confirmed load-bearing: reverting
	// this to the CURRENT unmigrated (year, person, session) shape makes
	// TestProcessAssignment_FamilyStylePlanPreservesBothRowsImprecisely fail
	// with a real uniqueness violation on the second assignment.
	assignments.Indexes = []string{
		"CREATE UNIQUE INDEX `idx_grain_test_person_session_bunk_year` " +
			"ON `bunk_assignments` (`year`, `person`, `session`, `bunk`)",
	}
	if err := app.Save(assignments); err != nil {
		t.Fatalf("create bunk_assignments: %v", err)
	}

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.NumberField{Name: "person_id", Required: true})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	attendees.Fields.Add(&core.NumberField{Name: "year", Required: true})
	attendees.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(attendees); err != nil {
		t.Fatalf("create attendees: %v", err)
	}

	staff := core.NewBaseCollection("staff")
	staff.Fields.Add(&core.NumberField{Name: "person_id", Required: true})
	staff.Fields.Add(&core.TextField{Name: "status"})
	staff.Fields.Add(&core.BoolField{Name: "bunk_staff"})
	staff.Fields.Add(&core.NumberField{Name: "year", Required: true})
	staff.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(staff); err != nil {
		t.Fatalf("create staff: %v", err)
	}
}

// bunkAssignmentsForYear returns every bunk_assignments row for the given
// year, sorted by nothing in particular -- tests key off count and content,
// not order.
func bunkAssignmentsForYear(t *testing.T, app core.App, year int) []*core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter("bunk_assignments", fmt.Sprintf("year = %d", year), "", 0, 0)
	if err != nil {
		t.Fatalf("query bunk_assignments: %v", err)
	}
	return rows
}

// TestProcessAssignment_MultiSessionPlanDisambiguatedByBunk is the
// regression test kindred#2259's acceptance checklist asks for: "a
// bunk_assignments sync test where one bunk plan covers two sessions, one
// person is enrolled in both, and CampMinder returns two assignments in two
// different bunks -- assert two rows survive, each with the correct
// session."
//
// The two bunks here are DISJOINT -- each is only ever listed under one of
// the plan's two sessions in bunk_plans, the same shape as a real main+AG
// plan (kindred#2264's Traps: "the three main+AG plans have as many
// distinct bunks as rows, so (plan,bunk) IS unique for them"). That is what
// makes "correct session" achievable at all: resolveViaBunk narrows using
// the SPECIFIC bunk on each assignment, not just the plan's whole session
// list, so the two assignments resolve to two DIFFERENT sessions even
// though they share a person and a plan.
//
// Before kindred#2259, the write key was (person, session, year) with no
// bunk. Both assignments here would resolve through the OLD plan-wide
// findMatchingSession to whichever session came first for BOTH of them,
// then collide on that identical key: the first process call would create
// the row, the second would find no match in the (stale, pre-loaded)
// existingAssignments map and attempt a second create, which the unique
// index rejects. Widening the key is what lets a second, distinct row
// exist at all; resolveViaBunk is what makes it land on the RIGHT session.
func TestProcessAssignment_MultiSessionPlanDisambiguatedByBunk(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentGrainCollections(t, app)

	const year = 2026
	const personCMID = 9000001
	const planCMID = 8001
	const sessionACMID = 5101 // main
	const sessionBCMID = 5102 // AG
	const bunkACMID = 6101    // only ever listed under session A
	const bunkBCMID = 6102    // only ever listed under session B

	saveRec(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionACMID, "year": year})
	saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionBCMID, "year": year})
	saveRec(t, app, "bunks", map[string]any{"cm_id": bunkACMID, "year": year})
	saveRec(t, app, "bunks", map[string]any{"cm_id": bunkBCMID, "year": year})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: app, Client: newParallelTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.personEnrollments = map[int][]int{personCMID: {sessionACMID, sessionBCMID}}
	s.bunkPlanSessionsList = map[int][]int{planCMID: {sessionACMID, sessionBCMID}}
	s.bunkPlanBunkToSession = map[string][]int{
		fmt.Sprintf("%d:%d", planCMID, bunkACMID): {sessionACMID},
		fmt.Sprintf("%d:%d", planCMID, bunkBCMID): {sessionBCMID},
	}
	s.validPersonCMIDs = map[int]bool{personCMID: true}
	s.validSessionCMIDs = map[int]bool{sessionACMID: true, sessionBCMID: true}
	s.validBunkCMIDs = map[int]bool{bunkACMID: true, bunkBCMID: true}

	existing, err := s.preloadExistingAssignments(year)
	if err != nil {
		t.Fatalf("preloadExistingAssignments: %v", err)
	}
	if len(existing) != 0 {
		t.Fatalf("existing = %d, want 0 on a first sync", len(existing))
	}

	for _, bunkCMID := range []int{bunkACMID, bunkBCMID} {
		sessionID, ambiguous := s.resolveAssignmentSession(personCMID, planCMID, bunkCMID, s.bunkPlanSessionsList[planCMID])
		if ambiguous {
			t.Fatalf("bunk %d: resolution reported ambiguous, want unambiguous", bunkCMID)
		}
		if sessionID == 0 {
			t.Fatalf("bunk %d: resolution reported no session", bunkCMID)
		}

		assignmentData := map[string]any{
			"PersonID":   float64(personCMID),
			"BunkID":     float64(bunkCMID),
			"BunkPlanID": float64(planCMID),
			"SessionID":  float64(sessionID),
			"ID":         float64(700000 + bunkCMID),
		}
		if err := s.processAssignment(assignmentData, existing); err != nil {
			t.Fatalf("processAssignment(bunk=%d): %v", bunkCMID, err)
		}
	}

	if s.Stats.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
	}
	if s.Stats.Created != 2 {
		t.Errorf("Stats.Created = %d, want 2 -- the second assignment must not collide with the first", s.Stats.Created)
	}

	rows := bunkAssignmentsForYear(t, app, year)
	if len(rows) != 2 {
		t.Fatalf("bunk_assignments rows = %d, want 2 -- kindred#2259: a multi-session plan must not collapse "+
			"two assignments for one person into one row", len(rows))
	}

	gotSessionByBunk := map[int]string{}
	for _, row := range rows {
		bunkRec, err := app.FindRecordById("bunks", row.GetString("bunk"))
		if err != nil {
			t.Fatalf("resolve bunk on row %s: %v", row.Id, err)
		}
		bunkCMID := int(bunkRec.GetFloat("cm_id"))
		gotSessionByBunk[bunkCMID] = row.GetString("session")
	}

	sessionARec, _ := app.FindFirstRecordByFilter("camp_sessions", fmt.Sprintf("cm_id = %d", sessionACMID))
	sessionBRec, _ := app.FindFirstRecordByFilter("camp_sessions", fmt.Sprintf("cm_id = %d", sessionBCMID))

	if gotSessionByBunk[bunkACMID] != sessionARec.Id {
		t.Errorf("bunk %d row's session = %q, want session A (%q) -- got the wrong session, not just a lost row",
			bunkACMID, gotSessionByBunk[bunkACMID], sessionARec.Id)
	}
	if gotSessionByBunk[bunkBCMID] != sessionBRec.Id {
		t.Errorf("bunk %d row's session = %q, want session B (%q) -- got the wrong session, not just a lost row",
			bunkBCMID, gotSessionByBunk[bunkBCMID], sessionBRec.Id)
	}
}

// TestProcessAssignment_FamilyStylePlanPreservesBothRowsImprecisely covers
// the case kindred#2259's Fix direction says per-bunk disambiguation
// "cannot be made to work for" -- a bunk shared across every session of its
// plan, the family-camp shape. Both assignments here use DIFFERENT bunk
// numbers, but each bunk is (like a real family bunk) listed under every
// session of the plan, so resolveViaBunk cannot narrow either one and both
// fall back to the plan-wide findMatchingSession -- which takes the same
// two arguments both times and therefore returns the same session both
// times.
//
// The point of this test is what the fix does NOT try to do: it does not
// make the two rows land on different, correct sessions (the issue's own
// Fix direction rules that out for this shape). What it must still do is
// keep BOTH rows -- widening the write key by bunk means the two
// assignments no longer share a key even though they share a resolved
// session, so the second write updates or creates a second record instead
// of colliding with the first. This is the primary hazard population from
// kindred#2259 (95 of 97 measured collisions): before the fix, this exact
// scenario silently dropped one of the two rows.
func TestProcessAssignment_FamilyStylePlanPreservesBothRowsImprecisely(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentGrainCollections(t, app)

	const year = 2026
	const personCMID = 9000002
	const planCMID = 8002
	const sessionACMID = 5201 // family weekend 1
	const sessionBCMID = 5202 // family weekend 2
	const bunkXCMID = 6201    // present under BOTH sessions of the plan
	const bunkYCMID = 6202    // also present under BOTH sessions of the plan

	saveRec(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionACMID, "year": year})
	saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionBCMID, "year": year})
	saveRec(t, app, "bunks", map[string]any{"cm_id": bunkXCMID, "year": year})
	saveRec(t, app, "bunks", map[string]any{"cm_id": bunkYCMID, "year": year})

	s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
		App: app, Client: newParallelTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
	}}
	s.personEnrollments = map[int][]int{personCMID: {sessionACMID, sessionBCMID}}
	s.bunkPlanSessionsList = map[int][]int{planCMID: {sessionACMID, sessionBCMID}}
	s.bunkPlanBunkToSession = map[string][]int{
		// family shape: each bunk spans every session of the plan.
		fmt.Sprintf("%d:%d", planCMID, bunkXCMID): {sessionACMID, sessionBCMID},
		fmt.Sprintf("%d:%d", planCMID, bunkYCMID): {sessionACMID, sessionBCMID},
	}
	s.validPersonCMIDs = map[int]bool{personCMID: true}
	s.validSessionCMIDs = map[int]bool{sessionACMID: true, sessionBCMID: true}
	s.validBunkCMIDs = map[int]bool{bunkXCMID: true, bunkYCMID: true}

	existing, err := s.preloadExistingAssignments(year)
	if err != nil {
		t.Fatalf("preloadExistingAssignments: %v", err)
	}

	resolvedSessions := make([]int, 0, 2)
	for _, bunkCMID := range []int{bunkXCMID, bunkYCMID} {
		sessionID, ambiguous := s.resolveAssignmentSession(personCMID, planCMID, bunkCMID, s.bunkPlanSessionsList[planCMID])
		if ambiguous {
			t.Fatalf("bunk %d: resolution reported ambiguous -- the camper path must fall back, not skip", bunkCMID)
		}
		if sessionID == 0 {
			t.Fatalf("bunk %d: resolution reported no session", bunkCMID)
		}
		resolvedSessions = append(resolvedSessions, sessionID)

		assignmentData := map[string]any{
			"PersonID":   float64(personCMID),
			"BunkID":     float64(bunkCMID),
			"BunkPlanID": float64(planCMID),
			"SessionID":  float64(sessionID),
			"ID":         float64(710000 + bunkCMID),
		}
		if err := s.processAssignment(assignmentData, existing); err != nil {
			t.Fatalf("processAssignment(bunk=%d): %v", bunkCMID, err)
		}
	}

	if s.Stats.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0 -- the widened key must not collide even though both "+
			"assignments resolve to the same session", s.Stats.Errors)
	}
	if s.Stats.Created != 2 {
		t.Errorf("Stats.Created = %d, want 2", s.Stats.Created)
	}

	rows := bunkAssignmentsForYear(t, app, year)
	if len(rows) != 2 {
		t.Fatalf("bunk_assignments rows = %d, want 2 -- kindred#2259's primary hazard population (a bunk shared "+
			"across every session of its plan) must not collapse to one row", len(rows))
	}

	// Documenting the accepted imprecision, not asserting it as a goal:
	// resolveAssignmentSession is deterministic given the same inputs, so
	// both calls above returned the same session.
	if resolvedSessions[0] != resolvedSessions[1] {
		t.Fatalf("test setup assumption violated: expected both resolutions to agree (imprecise but "+
			"deterministic), got %d and %d", resolvedSessions[0], resolvedSessions[1])
	}
}

// TestBunkAssignmentGrain_SecondSyncRunNeitherLosesNorDuplicates is the
// acceptance checklist's "second regression test at the orphan layer: run
// the sync twice over the widened data and assert the second run deletes
// nothing and records zero Stats.Errors." It exercises all four widened
// pieces of the grain together across two runs: the write key
// (processAssignment), the preload key (preloadExistingAssignments), the
// orphan key (deleteOrphans via protectThenSweepOrphans), and the widened
// unique index they all rely on the database enforcing (see the
// bunk_assignments migration for the index itself).
//
// Missing the preload key would make run 2 treat both rows as new
// (Stats.Created again, not Updated/Skipped -- harmless on its own).
// Missing the orphan key is the dangerous miss: run 2's ProcessedKeys would
// be tracked in the new 4-part shape while deleteOrphans rebuilt a key that
// does not match it, and the sweep would delete both rows the widening
// exists to keep, without reporting a single error.
func TestBunkAssignmentGrain_SecondSyncRunNeitherLosesNorDuplicates(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentGrainCollections(t, app)

	const year = 2026
	const personCMID = 9000003
	const planCMID = 8003
	const sessionACMID = 5301
	const sessionBCMID = 5302
	const bunkACMID = 6301
	const bunkBCMID = 6302

	saveRec(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})
	saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionACMID, "year": year})
	saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionBCMID, "year": year})
	saveRec(t, app, "bunks", map[string]any{"cm_id": bunkACMID, "year": year})
	saveRec(t, app, "bunks", map[string]any{"cm_id": bunkBCMID, "year": year})

	newSync := func() *BunkAssignmentsSync {
		s := &BunkAssignmentsSync{BaseSyncService: BaseSyncService{
			App: app, Client: newParallelTestCampMinderClient(t, year), ProcessedKeys: make(map[string]bool),
		}}
		s.personEnrollments = map[int][]int{personCMID: {sessionACMID, sessionBCMID}}
		s.bunkPlanSessionsList = map[int][]int{planCMID: {sessionACMID, sessionBCMID}}
		s.bunkPlanBunkToSession = map[string][]int{
			fmt.Sprintf("%d:%d", planCMID, bunkACMID): {sessionACMID},
			fmt.Sprintf("%d:%d", planCMID, bunkBCMID): {sessionBCMID},
		}
		s.validPersonCMIDs = map[int]bool{personCMID: true}
		s.validSessionCMIDs = map[int]bool{sessionACMID: true, sessionBCMID: true}
		s.validBunkCMIDs = map[int]bool{bunkACMID: true, bunkBCMID: true}
		return s
	}

	runOnce := func(t *testing.T) *BunkAssignmentsSync {
		t.Helper()
		s := newSync()

		existing, err := s.preloadExistingAssignments(year)
		if err != nil {
			t.Fatalf("preloadExistingAssignments: %v", err)
		}

		for _, bunkCMID := range []int{bunkACMID, bunkBCMID} {
			sessionID, ambiguous := s.resolveAssignmentSession(personCMID, planCMID, bunkCMID, s.bunkPlanSessionsList[planCMID])
			if ambiguous || sessionID == 0 {
				t.Fatalf("bunk %d: unexpected resolution (ambiguous=%v, sessionID=%d)", bunkCMID, ambiguous, sessionID)
			}
			assignmentData := map[string]any{
				"PersonID":   float64(personCMID),
				"BunkID":     float64(bunkCMID),
				"BunkPlanID": float64(planCMID),
				"SessionID":  float64(sessionID),
				"ID":         float64(720000 + bunkCMID),
			}
			if err := s.processAssignment(assignmentData, existing); err != nil {
				t.Fatalf("processAssignment(bunk=%d): %v", bunkCMID, err)
			}
		}

		s.SyncSuccessful = true // arms deleteOrphans, as Sync() sets after a successful first page fetch
		if err := s.protectThenSweepOrphans(year); err != nil {
			t.Fatalf("protectThenSweepOrphans: %v", err)
		}
		return s
	}

	run1 := runOnce(t)
	if run1.Stats.Errors != 0 {
		t.Fatalf("run 1: Stats.Errors = %d, want 0", run1.Stats.Errors)
	}
	if run1.Stats.Created != 2 {
		t.Fatalf("run 1: Stats.Created = %d, want 2", run1.Stats.Created)
	}
	if rows := bunkAssignmentsForYear(t, app, year); len(rows) != 2 {
		t.Fatalf("run 1: bunk_assignments rows = %d, want 2", len(rows))
	}

	run2 := runOnce(t)
	if run2.Stats.Errors != 0 {
		t.Errorf("run 2: Stats.Errors = %d, want 0 -- a widened preload/orphan key mismatch "+
			"surfaces here first", run2.Stats.Errors)
	}
	if run2.Stats.Created != 0 {
		t.Errorf("run 2: Stats.Created = %d, want 0 -- preloadExistingAssignments must find "+
			"both rows run 1 wrote", run2.Stats.Created)
	}

	rows := bunkAssignmentsForYear(t, app, year)
	if len(rows) != 2 {
		t.Fatalf("after run 2: bunk_assignments rows = %d, want 2 -- an unwidened orphan key would delete both "+
			"rows the widening exists to keep, silently", len(rows))
	}
}

// TestLoadMappings_KeepsEveryCandidateSessionForASharedBunk drives the
// PRODUCTION map-building path -- loadMappings walking real bunk_plans
// records -- rather than hand-assembling s.bunkPlanBunkToSession the way
// every other test in this package does.
//
// That distinction is the whole point of the test. kindred#2264's defect
// lived in the ASSIGNMENT in loadMappings, not in the read sites: two
// bunk_plans rows sharing a plan cm_id and a bunk cm_id but naming
// different sessions used to overwrite each other, so whichever row
// PaginateRecords visited last became the only surviving candidate. Every
// test that builds the map itself starts from candidates that already
// survived, so reverting that one line to an overwrite left the entire sync
// package green -- verified by mutation before this test was written. This
// is the acceptance checklist's "feed the map-building path two bunk_plans
// records sharing plan cm_id and bunk cm_id with different session cm_ids,
// and assert both survive".
func TestLoadMappings_KeepsEveryCandidateSessionForASharedBunk(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentGrainCollections(t, app)

	const year = 2026
	const planCMID = 8401
	const sessionACMID = 5401 // family weekend 1
	const sessionBCMID = 5402 // family weekend 2
	const sharedBunkCMID = 6401
	const soloBunkCMID = 6402

	sessionA := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionACMID, "year": year})
	sessionB := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionBCMID, "year": year})
	sharedBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": sharedBunkCMID, "year": year})
	soloBunk := saveRec(t, app, "bunks", map[string]any{"cm_id": soloBunkCMID, "year": year})

	// The family-camp shape: one plan, one bunk, listed under BOTH of the
	// plan's sessions. bunk_plans' own unique index is (year, bunk, session,
	// cm_id), so these two rows are legitimate, not duplicates.
	saveRec(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": sharedBunk.Id, "session": sessionA.Id, "year": year,
	})
	saveRec(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": sharedBunk.Id, "session": sessionB.Id, "year": year,
	})
	// A bunk of the same plan that appears under exactly one session -- the
	// main+AG shape -- so the test also pins that the unambiguous case is
	// still a single candidate and still resolves.
	saveRec(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": soloBunk.Id, "session": sessionA.Id, "year": year,
	})

	s := NewBunkAssignmentsSync(app, newParallelTestCampMinderClient(t, year))
	if err := s.loadMappings(); err != nil {
		t.Fatalf("loadMappings: %v", err)
	}

	sharedKey := fmt.Sprintf("%d:%d", planCMID, sharedBunkCMID)
	gotShared := append([]int(nil), s.bunkPlanBunkToSession[sharedKey]...)
	sort.Ints(gotShared)
	wantShared := []int{sessionACMID, sessionBCMID}
	if !slices.Equal(gotShared, wantShared) {
		t.Errorf("bunkPlanBunkToSession[%q] = %v, want %v -- kindred#2264: a bunk listed under several "+
			"sessions of one plan must keep EVERY candidate, not just the last bunk_plans row read",
			sharedKey, gotShared, wantShared)
	}

	soloKey := fmt.Sprintf("%d:%d", planCMID, soloBunkCMID)
	if got := s.bunkPlanBunkToSession[soloKey]; !slices.Equal(got, []int{sessionACMID}) {
		t.Errorf("bunkPlanBunkToSession[%q] = %v, want [%d] -- a bunk under one session must stay one candidate",
			soloKey, got, sessionACMID)
	}

	// The plan-level list is built by the sibling block that always appended;
	// pinning it here keeps a future "simplification" from collapsing it too.
	gotPlan := append([]int(nil), s.bunkPlanSessionsList[planCMID]...)
	sort.Ints(gotPlan)
	if !slices.Equal(gotPlan, []int{sessionACMID, sessionACMID, sessionBCMID}) {
		t.Errorf("bunkPlanSessionsList[%d] = %v, want one entry per bunk_plans row", planCMID, gotPlan)
	}

	// And the read site sees the ambiguity the build site preserved: this is
	// what turns the kept candidates into a skip-and-warn instead of a guess.
	if sessionCMID, ambiguous := s.resolveStaffSession(planCMID, sharedBunkCMID); !ambiguous || sessionCMID != 0 {
		t.Errorf("resolveStaffSession(shared bunk) = (%d, %v), want (0, true)", sessionCMID, ambiguous)
	}
	if sessionCMID, ambiguous := s.resolveStaffSession(planCMID, soloBunkCMID); ambiguous || sessionCMID != sessionACMID {
		t.Errorf("resolveStaffSession(solo bunk) = (%d, %v), want (%d, false)", sessionCMID, ambiguous, sessionACMID)
	}
}
