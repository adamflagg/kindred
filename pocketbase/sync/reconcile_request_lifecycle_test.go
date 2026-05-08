package sync

import (
	"context"
	"sort"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

const (
	fixtureProcessed2024 = "processed_at_2024-01-01"
	fixtureProcessed2025 = "processed_at_2025-01-01"
)

// TestFindMovedRequesters tests the pure-function detection of requesters
// whose current attendees.session differs from the session_id stored on any
// of their existing bunk_requests rows.
func TestFindMovedRequesters(t *testing.T) {
	cases := []struct {
		name             string
		currentSessions  map[int]int
		storedBRSessions map[int][]int
		expectMovedCMIDs []int
	}{
		{
			name: "no moves — all sessions match",
			currentSessions: map[int]int{
				1001: 100,
				1002: 100,
			},
			storedBRSessions: map[int][]int{
				1001: {100},
				1002: {100},
			},
			expectMovedCMIDs: []int{},
		},
		{
			name: "one moved requester",
			currentSessions: map[int]int{
				1001: 200, // moved from 100 to 200
				1002: 100,
			},
			storedBRSessions: map[int][]int{
				1001: {100},
				1002: {100},
			},
			expectMovedCMIDs: []int{1001},
		},
		{
			name: "multiple moved requesters",
			currentSessions: map[int]int{
				1001: 200,
				1002: 200,
				1003: 100,
			},
			storedBRSessions: map[int][]int{
				1001: {100},
				1002: {100},
				1003: {100},
			},
			expectMovedCMIDs: []int{1001, 1002},
		},
		{
			name: "requester with stale rows in MULTIPLE old sessions still flagged once",
			currentSessions: map[int]int{
				1001: 300,
			},
			storedBRSessions: map[int][]int{
				1001: {100, 200, 300}, // some stale, some matching
			},
			expectMovedCMIDs: []int{1001},
		},
		{
			name: "requester not currently enrolled — skipped (handled by orphan purge)",
			currentSessions: map[int]int{
				1002: 100,
			},
			storedBRSessions: map[int][]int{
				1001: {100}, // 1001 not in currentSessions (cancelled)
				1002: {100},
			},
			expectMovedCMIDs: []int{},
		},
		{
			name: "no stored bunk_requests for requester — nothing to reconcile",
			currentSessions: map[int]int{
				1001: 200,
			},
			storedBRSessions: map[int][]int{},
			expectMovedCMIDs: []int{},
		},
		{
			name:             "empty inputs",
			currentSessions:  map[int]int{},
			storedBRSessions: map[int][]int{},
			expectMovedCMIDs: []int{},
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := findMovedRequesters(tt.currentSessions, tt.storedBRSessions)
			sort.Ints(got)
			want := append([]int{}, tt.expectMovedCMIDs...)
			sort.Ints(want)

			if len(got) != len(want) {
				t.Fatalf("got %d moved cm_ids, want %d: got=%v want=%v",
					len(got), len(want), got, want)
			}
			for i := range got {
				if got[i] != want[i] {
					t.Errorf("got[%d]=%d, want %d", i, got[i], want[i])
				}
			}
		})
	}
}

// setupReconcileCollections seeds minimal schema for an end-to-end test of
// reconcileRequestLifecycle against a real PocketBase test app.
func setupReconcileCollections(t *testing.T, app core.App) {
	t.Helper()

	personsCol := core.NewBaseCollection("persons")
	personsCol.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	if err := app.Save(personsCol); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	sessionsCol := core.NewBaseCollection("camp_sessions")
	sessionsCol.Fields.Add(&core.NumberField{Name: "cm_id", Required: true})
	if err := app.Save(sessionsCol); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	attendeesCol := core.NewBaseCollection("attendees")
	attendeesCol.Fields.Add(&core.NumberField{Name: "person_id", Required: true})
	attendeesCol.Fields.Add(&core.NumberField{Name: "status_id", Required: true})
	attendeesCol.Fields.Add(&core.NumberField{Name: "year", Required: true})
	attendeesCol.Fields.Add(&core.RelationField{
		Name:         "session",
		CollectionId: sessionsCol.Id,
		Required:     false,
		MaxSelect:    1,
	})
	if err := app.Save(attendeesCol); err != nil {
		t.Fatalf("create attendees: %v", err)
	}

	obrCol := core.NewBaseCollection("original_bunk_requests")
	obrCol.Fields.Add(&core.RelationField{
		Name:         "requester",
		CollectionId: personsCol.Id,
		Required:     true,
		MaxSelect:    1,
	})
	obrCol.Fields.Add(&core.NumberField{Name: "year", Required: true})
	obrCol.Fields.Add(&core.TextField{Name: "field"})
	obrCol.Fields.Add(&core.TextField{Name: "content"})
	obrCol.Fields.Add(&core.TextField{Name: "processed"})
	if err := app.Save(obrCol); err != nil {
		t.Fatalf("create original_bunk_requests: %v", err)
	}

	brCol := core.NewBaseCollection("bunk_requests")
	brCol.Fields.Add(&core.NumberField{Name: "requester_id", Required: true})
	brCol.Fields.Add(&core.NumberField{Name: "requestee_id"})
	brCol.Fields.Add(&core.NumberField{Name: "session_id", Required: true})
	brCol.Fields.Add(&core.NumberField{Name: "year", Required: true})
	brCol.Fields.Add(&core.SelectField{
		Name:      "status",
		Values:    []string{"pending", "resolved", "declined"},
		MaxSelect: 1,
	})
	if err := app.Save(brCol); err != nil {
		t.Fatalf("create bunk_requests: %v", err)
	}
}

func savePerson(t *testing.T, app core.App, cmID int) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("cm_id", cmID)
	if err := app.Save(r); err != nil {
		t.Fatalf("save person %d: %v", cmID, err)
	}
	return r
}

func saveSession(t *testing.T, app core.App, cmID int) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("camp_sessions")
	if err != nil {
		t.Fatalf("find camp_sessions: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("cm_id", cmID)
	if err := app.Save(r); err != nil {
		t.Fatalf("save session %d: %v", cmID, err)
	}
	return r
}

func saveAttendee(t *testing.T, app core.App, personCMID, statusID, year int, session *core.Record) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("attendees")
	if err != nil {
		t.Fatalf("find attendees: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("person_id", personCMID)
	r.Set("status_id", statusID)
	r.Set("year", year)
	if session != nil {
		r.Set("session", session.Id)
	}
	if err := app.Save(r); err != nil {
		t.Fatalf("save attendee %d: %v", personCMID, err)
	}
}

func saveOBR(t *testing.T, app core.App, requester *core.Record, year int, field, processed string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("original_bunk_requests")
	if err != nil {
		t.Fatalf("find OBR: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("requester", requester.Id)
	r.Set("year", year)
	r.Set("field", field)
	r.Set("content", "stub")
	r.Set("processed", processed)
	if err := app.Save(r); err != nil {
		t.Fatalf("save OBR: %v", err)
	}
	return r
}

func saveBR(t *testing.T, app core.App, requesterCMID, requesteeCMID, sessionCMID, year int, status string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("bunk_requests")
	if err != nil {
		t.Fatalf("find bunk_requests: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("requester_id", requesterCMID)
	r.Set("requestee_id", requesteeCMID)
	r.Set("session_id", sessionCMID)
	r.Set("year", year)
	r.Set("status", status)
	if err := app.Save(r); err != nil {
		t.Fatalf("save BR: %v", err)
	}
}

// TestReconcileRequestLifecycle_MarksMovedRequestersOBRsUnprocessed verifies the
// end-to-end behavior: a requester whose attendee.session no longer matches the
// session_id stored on their bunk_requests rows has all their OBRs flipped to
// processed=” so process_requests will re-build them.
func TestReconcileRequestLifecycle_MarksMovedRequestersOBRsUnprocessed(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setupReconcileCollections(t, app)

	const year = 2025
	session1 := saveSession(t, app, 100)
	session2 := saveSession(t, app, 200)

	// Liam Garcia (1001) moved from session 100 to 200
	liam := savePerson(t, app, 1001)
	saveAttendee(t, app, 1001, 2, year, session2) // currently in session 200
	liamOBR := saveOBR(t, app, liam, year, "bunk_with", fixtureProcessed2025)
	saveBR(t, app, 1001, 1002, 100, year, "resolved") // BR has stale session_id=100

	// Emma Johnson (1002) hasn't moved
	emma := savePerson(t, app, 1002)
	saveAttendee(t, app, 1002, 2, year, session1)
	emmaOBR := saveOBR(t, app, emma, year, "bunk_with", fixtureProcessed2025)
	saveBR(t, app, 1002, 1003, 100, year, "resolved")

	if _, reconcileErr := reconcileRequestLifecycle(app, year); reconcileErr != nil {
		t.Fatalf("reconcile: %v", reconcileErr)
	}

	// Liam's OBR should now be unprocessed
	liamReloaded, err := app.FindRecordById("original_bunk_requests", liamOBR.Id)
	if err != nil {
		t.Fatalf("reload liamOBR: %v", err)
	}
	if got := liamReloaded.GetString("processed"); got != "" {
		t.Errorf("Liam (moved) OBR processed = %q, want \"\"", got)
	}

	// Emma's OBR should be untouched
	emmaReloaded, err := app.FindRecordById("original_bunk_requests", emmaOBR.Id)
	if err != nil {
		t.Fatalf("reload emmaOBR: %v", err)
	}
	if got := emmaReloaded.GetString("processed"); got != fixtureProcessed2025 {
		t.Errorf("Emma (stable) OBR processed = %q, want preserved", got)
	}
}

// TestReconcileRequestLifecycle_IgnoresInactiveRequesters verifies that
// requesters whose status_id != 2 are NOT touched here — the orphan purge
// in bunk_requests sync handles their cleanup by deleting OBRs entirely.
func TestReconcileRequestLifecycle_IgnoresInactiveRequesters(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setupReconcileCollections(t, app)

	const year = 2025
	session1 := saveSession(t, app, 100)
	session2 := saveSession(t, app, 200)
	_ = session2 // session2 exists but unused for this test

	// Olivia Chen (1003) is cancelled; even with stale session, reconcile leaves her alone
	olivia := savePerson(t, app, 1003)
	saveAttendee(t, app, 1003, 3, year, session1) // status_id=3 (cancelled)
	oliviaOBR := saveOBR(t, app, olivia, year, "bunk_with", fixtureProcessed2025)
	saveBR(t, app, 1003, 1004, 999, year, "resolved")

	if _, reconcileErr := reconcileRequestLifecycle(app, year); reconcileErr != nil {
		t.Fatalf("reconcile: %v", reconcileErr)
	}

	// Olivia's OBR should be untouched (orphan purge in bunk_requests sync handles her later)
	oliviaReloaded, err := app.FindRecordById("original_bunk_requests", oliviaOBR.Id)
	if err != nil {
		t.Fatalf("reload oliviaOBR: %v", err)
	}
	if got := oliviaReloaded.GetString("processed"); got != fixtureProcessed2025 {
		t.Errorf("Olivia (cancelled) OBR processed = %q, want preserved", got)
	}
}

// TestReconcileRequestLifecycle_NoOpWhenNoStaleRows verifies that the function
// is a no-op when no requesters have moved.
func TestReconcileRequestLifecycle_NoOpWhenNoStaleRows(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setupReconcileCollections(t, app)

	const year = 2025
	session1 := saveSession(t, app, 100)

	noah := savePerson(t, app, 1005)
	saveAttendee(t, app, 1005, 2, year, session1)
	noahOBR := saveOBR(t, app, noah, year, "bunk_with", fixtureProcessed2025)
	saveBR(t, app, 1005, 1006, 100, year, "resolved")

	if _, reconcileErr := reconcileRequestLifecycle(app, year); reconcileErr != nil {
		t.Fatalf("reconcile: %v", reconcileErr)
	}

	noahReloaded, err := app.FindRecordById("original_bunk_requests", noahOBR.Id)
	if err != nil {
		t.Fatalf("reload noahOBR: %v", err)
	}
	if got := noahReloaded.GetString("processed"); got != fixtureProcessed2025 {
		t.Errorf("Noah (stable) OBR processed = %q, want preserved", got)
	}
}

// TestReconcileRequestLifecycle_YearScoped verifies that the function only
// touches OBRs in the requested year, not other years.
func TestReconcileRequestLifecycle_YearScoped(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setupReconcileCollections(t, app)

	session1 := saveSession(t, app, 100)
	session2 := saveSession(t, app, 200)

	riley := savePerson(t, app, 1007)
	// Riley is in session 100 in 2024 (last year), session 200 in 2025 (current)
	saveAttendee(t, app, 1007, 2, 2024, session1)
	saveAttendee(t, app, 1007, 2, 2025, session2)
	obr2024 := saveOBR(t, app, riley, 2024, "bunk_with", fixtureProcessed2024)
	obr2025 := saveOBR(t, app, riley, 2025, "bunk_with", fixtureProcessed2025)
	saveBR(t, app, 1007, 1008, 100, 2024, "resolved") // 2024: session matches
	saveBR(t, app, 1007, 1008, 100, 2025, "resolved") // 2025: session mismatch (Riley in 200 now)

	if _, reconcileErr := reconcileRequestLifecycle(app, 2025); reconcileErr != nil {
		t.Fatalf("reconcile: %v", reconcileErr)
	}

	// 2025 OBR should be unprocessed
	r2025, err := app.FindRecordById("original_bunk_requests", obr2025.Id)
	if err != nil {
		t.Fatalf("reload 2025 OBR: %v", err)
	}
	if got := r2025.GetString("processed"); got != "" {
		t.Errorf("2025 (moved) OBR processed = %q, want \"\"", got)
	}

	// 2024 OBR must NOT be touched
	r2024, err := app.FindRecordById("original_bunk_requests", obr2024.Id)
	if err != nil {
		t.Fatalf("reload 2024 OBR: %v", err)
	}
	if got := r2024.GetString("processed"); got != fixtureProcessed2024 {
		t.Errorf("2024 (other year) OBR processed = %q, want preserved", got)
	}
}

// TestReconcileLifecycleSync_FallsBackToSeasonEnv verifies that the daily-sync
// path (where InitializeSyncServices registers the service with Year==0) does
// not error out — it must read CAMPMINDER_SEASON_ID like every other yearless
// service in this package.
func TestReconcileLifecycleSync_FallsBackToSeasonEnv(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setupReconcileCollections(t, app)
	t.Setenv("CAMPMINDER_SEASON_ID", "2025")

	s := NewReconcileLifecycleSync(app) // Year remains 0
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync with Year=0 should fall back to env, got error: %v", err)
	}
	if s.Stats.Errors != 0 {
		t.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
	}
}

// TestReconcileLifecycleSync_RejectsMissingYearEnv verifies that when neither
// Year is set NOR CAMPMINDER_SEASON_ID is in the env, Sync returns a clear
// error rather than silently using a bogus year.
func TestReconcileLifecycleSync_RejectsMissingYearEnv(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setupReconcileCollections(t, app)
	t.Setenv("CAMPMINDER_SEASON_ID", "")

	s := NewReconcileLifecycleSync(app) // Year remains 0
	if err := s.Sync(context.Background()); err == nil {
		t.Fatal("Sync with Year=0 and no env should error, got nil")
	}
}

// TestReconcileRequestLifecycle_SuccessPathReturnsZeroMarkErrors verifies the
// new (markErrors, err) signature: when every per-cm save succeeds, the count
// is zero. The increment branch is covered by the inability path: if Save
// fails, markErrors gets incremented (covered by code-path correctness; the
// PB test harness does not have a clean way to force a per-record save error).
func TestReconcileRequestLifecycle_SuccessPathReturnsZeroMarkErrors(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	setupReconcileCollections(t, app)

	const year = 2025
	_ = saveSession(t, app, 100)
	session2 := saveSession(t, app, 200)

	liam := savePerson(t, app, 1001)
	saveAttendee(t, app, 1001, 2, year, session2)
	_ = saveOBR(t, app, liam, year, "bunk_with", fixtureProcessed2025)
	saveBR(t, app, 1001, 1002, 100, year, "resolved")

	markErrors, err := reconcileRequestLifecycle(app, year)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if markErrors != 0 {
		t.Errorf("markErrors = %d, want 0", markErrors)
	}
}
