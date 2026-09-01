package sync

import (
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/campminder"
)

// setupAttendeesReplayCollections builds the minimal schema
// TestAttendeesOrphanSweep_SurvivesReplay drives: persons and camp_sessions
// (LookupRelation's targets), and attendees itself. Each carries a "created"
// AutodateField -- PaginateRecords (base_sync.go) hardcodes "-created" as its
// sort field, so any collection it walks needs one, the same reason
// setupBunkAssignmentGrainCollections (bunk_assignments_grain_test.go) adds
// it. A separate, purpose-built setup rather than reusing newSyncTestApp
// (sync_testsupport_test.go) because that fixture is shared by many other
// tests and lacks "created" on these collections; adding it there is a wider
// change than this issue's scope.
func setupAttendeesReplayCollections(t *testing.T, app core.App) {
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

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "person_id", Required: true})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.TextField{Name: "status"})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	attendees.Fields.Add(&core.TextField{Name: "enrollment_date"})
	attendees.Fields.Add(&core.TextField{Name: "effective_date"})
	attendees.Fields.Add(&core.TextField{Name: "last_updated_utc"})
	attendees.Fields.Add(&core.NumberField{Name: "year", Required: true})
	attendees.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(attendees); err != nil {
		t.Fatalf("create attendees: %v", err)
	}
}

// attendeesExistingForReplay duplicates the preload block AttendeesSync.Sync
// (attendees.go) runs at the top of every real sync -- a session-mapping
// lookup, then a composite-key preload over "attendees" -- so runOnce below
// can hand processEnrollment a correctly populated existingAttendees on every
// call, the same way Sync() does.
//
// This is NOT the thing under test. Skipping it (passing an empty map
// instead) would make run 2's processEnrollment treat the row runOnce#1
// already wrote as brand new: ProcessCompositeRecord would take the create
// branch again and, since the fixture's attendees collection here carries no
// unique index (newSyncTestApp's, unlike production's real
// idx_attendees_unique), silently write a SECOND row. That failure would be
// this test harness's own bug, not the write-key/orphan-key disagreement
// TestAttendeesOrphanSweep_SurvivesReplay exists to catch -- so it is
// deliberately kept correct rather than left out for brevity.
func attendeesExistingForReplay(t replayT, s *AttendeesSync, filter string) map[string]*core.Record {
	t.Helper()

	sessionMappings := make(map[string]int) // attendees.session (pbID) -> camp_sessions.cm_id
	if err := s.PaginateRecords("attendees", filter, func(record *core.Record) error {
		if sessionID := record.GetString("session"); sessionID != "" {
			sessions, err := s.App.FindRecordsByFilter("camp_sessions",
				fmt.Sprintf("id = '%s'", sessionID), "", 1, 0)
			if err == nil && len(sessions) > 0 {
				if cmID, ok := sessions[0].Get("cm_id").(float64); ok {
					sessionMappings[sessionID] = int(cmID)
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("PaginateRecords(attendees): %v", err)
	}

	existing, err := s.PreloadCompositeRecords("attendees", filter, func(record *core.Record) (string, bool) {
		personCMID, _ := record.Get("person_id").(float64)
		sessionID := record.GetString("session")
		sessionCMID := sessionMappings[sessionID]
		if personCMID > 0 && sessionCMID > 0 {
			return fmt.Sprintf("%d:%d", int(personCMID), sessionCMID), true
		}
		return "", false
	})
	if err != nil {
		t.Fatalf("PreloadCompositeRecords(attendees): %v", err)
	}
	return existing
}

// TestAttendeesOrphanSweep_SurvivesReplay applies the shared kindred#2626
// replay guard (orphan_replay_test.go) to the REAL attendees write path
// (processEnrollment, which calls TrackProcessedCompositeKey) and the REAL
// attendees orphan sweep (deleteOrphans, whose getIDFunc is the sweep's own
// key builder) -- driven twice over one unchanged enrollment.
//
// This is what closes kindred#2626's acceptance line "attendees' key
// disagreement is covered by [the shared helper] rather than by the #2263
// data measurement": #2263 measured ProgramID null on 2,904 of 2,904
// SessionProgramStatus entries in one real season, a fact about that season's
// data, not a property of the code. This test instead drives the actual
// key-building code on both sides (processEnrollment's
// fmt.Sprintf("%d:%d", personCMID, sessionCMID) and deleteOrphans's
// fmt.Sprintf("%d:%d|%d", personCMID, sessionCMID, year)) and fails the
// moment they stop agreeing, independent of what any particular CampMinder
// feed happens to contain.
func TestAttendeesOrphanSweep_SurvivesReplay(t *testing.T) {
	// Not t.Parallel(): t.Setenv below panics under Parallel (matches
	// attendees_dryrun_test.go's TestAttendeesLogStatusChangeDryRunWritesNothing).
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupAttendeesReplayCollections(t, app)

	const year = 2026
	const personCMID = 9100001
	const sessionCMID = 5501
	// A second person CM id, used only by the SeedOrphan control below --
	// distinct from personCMID so its key never lands in ProcessedKeys.
	const orphanPersonCMID = 9100002
	filter := fmt.Sprintf("year = %d", year)

	sessionPBID := saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": sessionCMID, "year": year})
	saveRecord(t, app, "persons", map[string]any{"cm_id": personCMID, "year": year})

	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")
	client, err := campminder.NewClient(&campminder.Config{APIKey: "test-key", ClientID: "test-client", SeasonID: year})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}

	enrollment := map[string]any{
		"SessionID": float64(sessionCMID),
		"StatusID":  float64(2), // enrolled
		"PostDate":  "2026-01-05T00:00:00Z",
	}

	// Shared across WriteFixture and Sweep within one run -- deleteOrphans
	// reads b.ProcessedKeys, which processEnrollment (via
	// TrackProcessedCompositeKey) fills on the SAME *AttendeesSync instance.
	var s *AttendeesSync

	assertOrphanSweepSurvivesReplay(t, replayOrphanSweepConfig{
		// Positive control: an attendee row for a DIFFERENT person in the
		// same session -- keyable by deleteOrphans' own getIDFunc
		// (person_id > 0, session resolves through sessionMappings to a real
		// camp_sessions cm_id) and absent from ProcessedKeys, since
		// processEnrollment below only ever processes personCMID, never
		// orphanPersonCMID. A LIVE sweep must delete it; without this
		// control the test passes even if the sweep never runs -- see
		// SeedOrphan's doc comment in orphan_replay_test.go.
		SeedOrphan: func(_ replayT) error {
			saveRecord(t, app, "attendees", map[string]any{
				"person_id": orphanPersonCMID, "session": sessionPBID,
				"status": "Enrolled", "status_id": float64(2), "year": year,
			})
			return nil
		},
		WriteFixture: func(t replayT) error {
			s = NewAttendeesSync(app, client)
			if err := s.loadSessionIDs(); err != nil {
				return fmt.Errorf("loadSessionIDs: %w", err)
			}
			existing := attendeesExistingForReplay(t, s, filter)
			if err := s.processEnrollment(personCMID, enrollment, existing); err != nil {
				return fmt.Errorf("processEnrollment: %w", err)
			}
			s.SyncSuccessful = true
			return nil
		},
		Sweep: func(t replayT) error {
			if err := s.deleteOrphans(); err != nil {
				return fmt.Errorf("deleteOrphans: %w", err)
			}
			if s.Stats.Errors != 0 {
				return fmt.Errorf("Stats.Errors = %d, want 0", s.Stats.Errors)
			}
			return nil
		},
		CountRows: func(t replayT) int {
			rows, err := app.FindRecordsByFilter("attendees", filter, "", 0, 0)
			if err != nil {
				t.Fatalf("query attendees: %v", err)
			}
			return len(rows)
		},
		WantRows: 1,
	})
}
