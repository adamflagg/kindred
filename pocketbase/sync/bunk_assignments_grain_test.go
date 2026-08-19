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

	// bunks, bunk_plans, bunk_assignments and staff are kindred#2300's shared
	// fixture builder (sync_testsupport_test.go) -- widened there so this
	// file's copies didn't keep drifting from production on their own.
	// addBunkAssignmentsCollection pins production's post-kindred#2259
	// widened unique index (year, person, session, bunk; migration
	// 1500000155) -- confirmed still load-bearing here: reverting it to the
	// old (year, person, session) shape makes
	// TestProcessAssignment_FamilyStylePlanPreservesBothRowsImprecisely fail
	// with a real uniqueness violation on the second assignment.
	bunks := addBunksCollection(t, app)
	bunkPlans := addBunkPlansCollection(t, app, bunks, sessions)
	addBunkAssignmentsCollection(t, app, persons, sessions, bunks, bunkPlans)

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.NumberField{Name: "person_id", Required: true})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	attendees.Fields.Add(&core.NumberField{Name: "year", Required: true})
	attendees.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(attendees); err != nil {
		t.Fatalf("create attendees: %v", err)
	}

	addStaffCollection(t, app)
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

	existing, _, err := s.preloadExistingAssignments(year)
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

	existing, _, err := s.preloadExistingAssignments(year)
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

		existing, _, err := s.preloadExistingAssignments(year)
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

// TestBunkAssignment_StaffRowSurvivesASecondRunOnTheSameInstance pins
// kindred#2465: the orchestrator constructs ONE BunkAssignmentsSync at boot
// and dispatches every scheduled run to it, but loadMappings only ever
// APPENDED to bunkPlanSessionsList and bunkPlanBunkToSession. Run 2 therefore
// read run 1's candidates still sitting in the map plus its own fresh copy,
// so a (bunkPlan, bunk) pair with exactly ONE session in the database
// presented as two candidates, resolveStaffSession called it ambiguous, the
// assignment was skipped without ever being tracked as processed, and
// deleteOrphans read "untracked" as "CampMinder dropped it" and deleted the
// row. In production that was 262 rows for 70 active bunk staff, deleted
// every hour, restored only by a container restart.
//
// Why TestBunkAssignmentGrain_SecondSyncRunNeitherLosesNorDuplicates does not
// catch it, and what this test does differently: that test's newSync() closure
// builds a FRESH instance per run AND hand-assigns the maps, so the real
// loadMappings never executes at all. This one uses a single instance across
// both runs and drives the production loadMappings, which is the only place
// the accumulation is observable.
//
// The tightest assertion is the map one -- two loadMappings() calls over one
// bunk_plans row must leave one candidate, not two. The run-2 resolution and
// surviving-row assertions are what make the consequence legible.
func TestBunkAssignment_StaffRowSurvivesASecondRunOnTheSameInstance(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentGrainCollections(t, app)

	const year = 2026
	const staffPersonCMID = 9000005
	const planCMID = 8005
	const sessionCMID = 5501
	const bunkCMID = 6501

	// Three campers share the bunk with the counselor. They are not decoration:
	// OrphanSweepGuard refuses a sweep whose computed set is under half of what
	// is on disk, so a fixture holding ONLY the staff row would have the guard
	// stop the deletion and hide the bug. Production has no such luck -- the 262
	// staff rows sat inside a table whose camper rows still resolved and still
	// tracked, so the guard's floor was met and the sweep ran. This fixture is
	// that shape in miniature: 3 of 4 rows keep tracking, 1 does not.
	camperCMIDs := []int{9000006, 9000007, 9000008}

	saveRec(t, app, "persons", map[string]any{"cm_id": staffPersonCMID, "year": year})
	session := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionCMID, "year": year})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": bunkCMID, "year": year})
	for _, camperCMID := range camperCMIDs {
		saveRec(t, app, "persons", map[string]any{"cm_id": camperCMID, "year": year})
		saveRec(t, app, "attendees", map[string]any{
			"person_id": camperCMID, "session": session.Id, "status_id": 2, "year": year,
		})
	}
	// Exactly ONE bunk_plans row: this (plan, bunk) pair is unambiguous in the
	// database. Any ambiguity a run reports is manufactured in memory.
	saveRec(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": bunk.Id, "session": session.Id, "year": year,
	})
	// A bunk staffer: active, bunk_staff, and NOT in attendees -- which is why
	// resolveAssignmentSession falls all the way through to resolveStaffSession
	// for them (staff have no enrollment to intersect).
	saveRec(t, app, "staff", map[string]any{
		"person_id": staffPersonCMID, "bunk_staff": true, "status": "active", "year": year,
	})

	// ONE instance, reused across both runs -- the orchestrator's actual shape.
	s := NewBunkAssignmentsSync(app, newParallelTestCampMinderClient(t, year))

	// runOnce mirrors Sync()'s body over the four assignments CampMinder returns
	// for this bunk: the same per-run reset Sync() performs at its top, the real
	// loadMappings, the real preload, the real resolution ladder, and -- on the
	// skip branch -- exactly what Sync()'s loop does today, which is to count a
	// Skipped and continue WITHOUT tracking the key. That last detail is the
	// whole mechanism: the untracked key is what deleteOrphans then deletes.
	runOnce := func(t *testing.T) (staffSession int, staffAmbiguous bool) {
		t.Helper()

		s.Stats = Stats{}
		s.SyncSuccessful = false
		s.ClearProcessedKeys()

		if err := s.loadMappings(); err != nil {
			t.Fatalf("loadMappings: %v", err)
		}

		existing, _, err := s.preloadExistingAssignments(year)
		if err != nil {
			t.Fatalf("preloadExistingAssignments: %v", err)
		}

		for _, personCMID := range append([]int{staffPersonCMID}, camperCMIDs...) {
			sessionID, ambiguous := s.resolveAssignmentSession(
				personCMID, planCMID, bunkCMID, s.bunkPlanSessionsList[planCMID])
			if personCMID == staffPersonCMID {
				staffSession, staffAmbiguous = sessionID, ambiguous
			}
			if ambiguous || sessionID == 0 {
				s.Stats.Skipped++
				continue
			}
			assignmentData := map[string]any{
				"PersonID":   float64(personCMID),
				"BunkID":     float64(bunkCMID),
				"BunkPlanID": float64(planCMID),
				"SessionID":  float64(sessionID),
				"ID":         float64(730000 + personCMID),
			}
			if err := s.processAssignment(assignmentData, existing); err != nil {
				t.Fatalf("processAssignment(person=%d): %v", personCMID, err)
			}
		}

		s.SyncSuccessful = true // Sync() sets this after a successful first page fetch
		if err := s.protectThenSweepOrphans(year); err != nil {
			t.Fatalf("protectThenSweepOrphans: %v", err)
		}
		return staffSession, staffAmbiguous
	}

	if sessionID, ambiguous := runOnce(t); ambiguous || sessionID != sessionCMID {
		t.Fatalf("run 1: staff resolution = (%d, ambiguous=%v), want (%d, false)", sessionID, ambiguous, sessionCMID)
	}
	if rows := bunkAssignmentsForYear(t, app, year); len(rows) != 4 {
		t.Fatalf("run 1: bunk_assignments rows = %d, want 4 (3 campers + 1 counselor)", len(rows))
	}

	sessionID, ambiguous := runOnce(t)

	bunkKey := fmt.Sprintf("%d:%d", planCMID, bunkCMID)
	if got := s.bunkPlanBunkToSession[bunkKey]; len(got) != 1 {
		t.Errorf("after two loadMappings() calls on one instance, bunkPlanBunkToSession[%q] = %v "+
			"(%d candidates), want exactly 1 -- the maps must be rebuilt per run, not appended to",
			bunkKey, got, len(got))
	}
	if ambiguous {
		t.Errorf("run 2: staff resolution reported ambiguous for a (plan, bunk) pair with ONE bunk_plans " +
			"row -- candidateCount is counting runs since boot, not sessions in the database")
	}
	if sessionID != sessionCMID {
		t.Errorf("run 2: staff resolved session = %d, want %d", sessionID, sessionCMID)
	}
	// Deliberately NOT asserted here: Stats.Skipped. On this run it reads 4 --
	// three legitimate no-change skips from base_sync's ProcessCompositeRecord
	// for the campers, plus the one ambiguous staff skip -- and it read 4 before
	// the sweep destroyed anything too. That indistinguishability is the reason
	// kindred#2465 ran for 119 hourly syncs reporting status='success' with a
	// flat skipped_count. The counter that CAN see it is asserted in
	// TestBunkAssignment_UnresolvedAssignmentIsCountedAndKeptFromTheSweep.

	if rows := bunkAssignmentsForYear(t, app, year); len(rows) != 4 {
		t.Errorf("after run 2: bunk_assignments rows = %d, want 4 -- the staff assignment must survive the "+
			"hourly sync, not be swept as an orphan the run never tracked", len(rows))
	}
}

// TestResolveViaBunk_DecidesOnDISTINCTSessions pins the camper-side half of
// kindred#2465. resolveViaBunk counted matches per candidate OCCURRENCE, so
// once the accumulated map held the same session twice, matches == 2 and the
// kindred#2264 bunk-specific narrowing silently reverted to the plan-wide
// findMatchingSession fallback from run 2 onward.
//
// The decision belongs at the READ site, not the build site: duplicates within
// a single run are legitimate (one entry per bunk_plans row -- see
// TestLoadMappings_KeepsEveryCandidateSessionForASharedBunk, which pins
// [A, A, B] deliberately), so what must change is what "ambiguous" counts.
func TestResolveViaBunk_DecidesOnDISTINCTSessions(t *testing.T) {
	t.Parallel()

	const planCMID = 8006
	const sessionACMID = 5601
	const sessionBCMID = 5602
	const bunkCMID = 6601
	key := fmt.Sprintf("%d:%d", planCMID, bunkCMID)

	t.Run("one session listed twice still narrows", func(t *testing.T) {
		t.Parallel()
		s := &BunkAssignmentsSync{}
		s.bunkPlanBunkToSession = map[string][]int{key: {sessionACMID, sessionACMID}}

		got, ok := s.resolveViaBunk([]int{sessionACMID}, planCMID, bunkCMID)
		if !ok || got != sessionACMID {
			t.Errorf("resolveViaBunk = (%d, %v), want (%d, true) -- two entries naming ONE session "+
				"are one candidate, not two", got, ok, sessionACMID)
		}
	})

	t.Run("two genuinely different sessions still refuse to narrow", func(t *testing.T) {
		t.Parallel()
		s := &BunkAssignmentsSync{}
		s.bunkPlanBunkToSession = map[string][]int{key: {sessionACMID, sessionBCMID}}

		got, ok := s.resolveViaBunk([]int{sessionACMID, sessionBCMID}, planCMID, bunkCMID)
		if ok || got != 0 {
			t.Errorf("resolveViaBunk = (%d, %v), want (0, false) -- a bunk shared across two sessions "+
				"the person is enrolled in must fall back to findMatchingSession (kindred#2264)", got, ok)
		}
	})
}

// TestResolveStaffSession_DecidesOnDISTINCTSessions pins the staff-side half
// of kindred#2465: switching on len(candidates) made the RUN COUNT the
// ambiguity signal. It must switch on the number of distinct sessions, while
// keeping the kindred#2264 behavior for a bunk genuinely shared across two
// sessions of one plan.
func TestResolveStaffSession_DecidesOnDISTINCTSessions(t *testing.T) {
	t.Parallel()

	const planCMID = 8007
	const sessionACMID = 5701
	const sessionBCMID = 5702
	const bunkCMID = 6701
	key := fmt.Sprintf("%d:%d", planCMID, bunkCMID)

	t.Run("one session listed twice is not ambiguous", func(t *testing.T) {
		t.Parallel()
		s := &BunkAssignmentsSync{}
		s.bunkPlanBunkToSession = map[string][]int{key: {sessionACMID, sessionACMID}}

		got, ambiguous := s.resolveStaffSession(planCMID, bunkCMID)
		if ambiguous || got != sessionACMID {
			t.Errorf("resolveStaffSession = (%d, %v), want (%d, false) -- one session listed twice "+
				"is one candidate", got, ambiguous, sessionACMID)
		}
	})

	t.Run("two distinct sessions stay ambiguous", func(t *testing.T) {
		t.Parallel()
		s := &BunkAssignmentsSync{}
		s.bunkPlanBunkToSession = map[string][]int{key: {sessionACMID, sessionACMID, sessionBCMID}}

		got, ambiguous := s.resolveStaffSession(planCMID, bunkCMID)
		if !ambiguous || got != 0 {
			t.Errorf("resolveStaffSession = (%d, %v), want (0, true) -- a bunk under two sessions of "+
				"one plan is genuinely ambiguous and must still be skipped (kindred#2264)", got, ambiguous)
		}
	})

	t.Run("no candidates is not ambiguous", func(t *testing.T) {
		t.Parallel()
		s := &BunkAssignmentsSync{}
		s.bunkPlanBunkToSession = map[string][]int{}

		got, ambiguous := s.resolveStaffSession(planCMID, bunkCMID)
		if ambiguous || got != 0 {
			t.Errorf("resolveStaffSession = (%d, %v), want (0, false)", got, ambiguous)
		}
	})
}

// TestBunkAssignment_UnresolvedAssignmentIsCountedAndKeptFromTheSweep pins the
// two halves of kindred#2465 that are correct on their own terms even with the
// map accumulation fixed, because a (plan, bunk) pair CAN be genuinely
// ambiguous (kindred#2264: a family-camp bunk listed under every session of
// its plan) and a run can genuinely fail to resolve a session:
//
//  1. An unresolved assignment gets its own counter. Folded into Stats.Skipped
//     it is invisible -- base_sync's ProcessCompositeRecord increments the same
//     field for every unchanged row, so on a steady-state run Skipped is
//     roughly the whole table. That is why 119 destructive hourly runs all read
//     status='success' with a flat skipped_count.
//
//  2. An unresolved assignment does NOT hand its existing row to deleteOrphans.
//     The run SAW this person in this bunk; it just could not name the session.
//     Absence from ProcessedKeys means "CampMinder no longer returns this",
//     which is the opposite of what happened. This is persons.go:487-508's
//     kindred#2394 patch applied to the same symptom: "Skipped and orphaned are
//     different facts, and this branch only ever meant the first one."
//
// Skipped keeps incrementing alongside the new counter: no row was written, and
// that is what Skipped has always counted here. The new field is a named subset
// of it, not a replacement -- unlike Stats.DuplicateStaffStatus, whose branch
// never touched Skipped in the first place.
func TestBunkAssignment_UnresolvedAssignmentIsCountedAndKeptFromTheSweep(t *testing.T) {
	t.Parallel()

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	setupBunkAssignmentGrainCollections(t, app)

	const year = 2026
	const staffPersonCMID = 9000009
	const planCMID = 8008
	const sessionACMID = 5801
	const sessionBCMID = 5802
	const bunkCMID = 6801

	saveRec(t, app, "persons", map[string]any{"cm_id": staffPersonCMID, "year": year})
	sessionA := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionACMID, "year": year})
	sessionB := saveRec(t, app, "camp_sessions", map[string]any{"cm_id": sessionBCMID, "year": year})
	bunk := saveRec(t, app, "bunks", map[string]any{"cm_id": bunkCMID, "year": year})
	// The family-camp shape: ONE bunk under TWO sessions of one plan. Genuinely
	// ambiguous in the database, not an artifact of a reused instance.
	saveRec(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": bunk.Id, "session": sessionA.Id, "year": year,
	})
	saveRec(t, app, "bunk_plans", map[string]any{
		"cm_id": planCMID, "bunk": bunk.Id, "session": sessionB.Id, "year": year,
	})
	saveRec(t, app, "staff", map[string]any{
		"person_id": staffPersonCMID, "bunk_staff": true, "status": "active", "year": year,
	})

	s := NewBunkAssignmentsSync(app, newParallelTestCampMinderClient(t, year))
	if loadErr := s.loadMappings(); loadErr != nil {
		t.Fatalf("loadMappings: %v", loadErr)
	}

	// A row already on disk from a run that COULD name the session -- e.g. the
	// historical backfill, or a season before the bunk was shared. Its survival
	// is the whole point: nothing upstream said this staffer left.
	person, err := app.FindFirstRecordByFilter("persons", fmt.Sprintf("cm_id = %d", staffPersonCMID))
	if err != nil {
		t.Fatalf("find person: %v", err)
	}
	saveRec(t, app, "bunk_assignments", map[string]any{
		"cm_id": 740001, "person": person.Id, "session": sessionA.Id, "bunk": bunk.Id, "year": year,
	})

	existing, existingByPersonBunk, err := s.preloadExistingAssignments(year)
	if err != nil {
		t.Fatalf("preloadExistingAssignments: %v", err)
	}
	if len(existing) != 1 {
		t.Fatalf("existing = %d, want 1", len(existing))
	}

	sessionID, unresolved := s.resolveSessionOrTrackUnresolved(
		staffPersonCMID, planCMID, bunkCMID, s.bunkPlanSessionsList[planCMID], existingByPersonBunk, year)
	if !unresolved || sessionID != 0 {
		t.Fatalf("resolveSessionOrTrackUnresolved = (%d, %v), want (0, true) -- a bunk under two sessions "+
			"of one plan is genuinely ambiguous for staff (kindred#2264)", sessionID, unresolved)
	}

	if s.Stats.UnresolvedSession != 1 {
		t.Errorf("Stats.UnresolvedSession = %d, want 1 -- an unresolved assignment needs a counter of its "+
			"own, or it hides inside Skipped alongside every unchanged row", s.Stats.UnresolvedSession)
	}
	if s.Stats.Skipped != 1 {
		t.Errorf("Stats.Skipped = %d, want 1 -- the new counter is a named subset of Skipped, not a "+
			"replacement for it", s.Stats.Skipped)
	}

	// The row the run could not resolve must be tracked as processed, so the
	// sweep reads it as "seen, could not key" rather than "gone from CampMinder".
	s.SyncSuccessful = true
	if err := s.protectThenSweepOrphans(year); err != nil {
		t.Fatalf("protectThenSweepOrphans: %v", err)
	}
	if rows := bunkAssignmentsForYear(t, app, year); len(rows) != 1 {
		t.Errorf("after the sweep: bunk_assignments rows = %d, want 1 -- an assignment the run SAW but "+
			"could not resolve is not an orphan (kindred#2394)", len(rows))
	}
}
