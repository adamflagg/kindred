package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// newCascadeProbeApp builds camp_sessions plus one placement table whose session
// relation is configured exactly as migration 1500000124 leaves it: required,
// with cascadeDelete off.
func newCascadeProbeApp(t *testing.T, cascade bool) (app core.App, sessionID, assignmentID string) {
	t.Helper()
	created, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	// Cleanup is on the concrete *tests.TestApp, not on the core.App interface
	// the named result is typed as.
	t.Cleanup(created.Cleanup)
	app = created

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("save camp_sessions: %v", err)
	}

	placements := core.NewBaseCollection("lodging_assignments")
	placements.Fields.Add(&core.RelationField{
		Name: "session", CollectionId: sessions.Id, MaxSelect: 1,
		Required: true, CascadeDelete: cascade,
	})
	placements.Fields.Add(&core.NumberField{Name: "session_cm_id", Required: true})
	placements.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	if err := app.Save(placements); err != nil {
		t.Fatalf("save lodging_assignments: %v", err)
	}

	sess := core.NewRecord(sessions)
	sess.Set("cm_id", 1309514)
	sess.Set("year", 2025)
	if err := app.Save(sess); err != nil {
		t.Fatalf("save session: %v", err)
	}

	assign := core.NewRecord(placements)
	assign.Set("session", sess.Id)
	assign.Set("session_cm_id", 1309514)
	assign.Set("household_cm_id", 9001)
	if err := app.Save(assign); err != nil {
		t.Fatalf("save assignment: %v", err)
	}
	return app, sess.Id, assign.Id
}

// TestSessionDeleteIsBlockedWhileAssignmentsExist is the kindred#1879 fix, proved
// rather than assumed.
//
// SessionsSync orphan-deletes camp_sessions rows CampMinder did not return this
// run. With cascadeDelete on, that quietly removed every assignment for the
// weekend. Because `session` is REQUIRED, turning the cascade off makes
// PocketBase refuse the parent delete instead -- the sync reports an error and
// no lodging row is lost.
func TestSessionDeleteIsBlockedWhileAssignmentsExist(t *testing.T) {
	app, sessionID, assignID := newCascadeProbeApp(t, false)

	sess, err := app.FindRecordById("camp_sessions", sessionID)
	if err != nil {
		t.Fatalf("find session: %v", err)
	}
	if delErr := app.Delete(sess); delErr == nil {
		t.Fatal("PocketBase allowed deleting a session that still has an assignment; " +
			"cascadeDelete=false on a REQUIRED relation is supposed to block it")
	}

	// The assignment must still be there, still pointing at its session.
	got, err := app.FindRecordById("lodging_assignments", assignID)
	if err != nil {
		t.Fatalf("assignment disappeared despite the delete being refused: %v", err)
	}
	if got.GetString("session") != sessionID {
		t.Errorf("assignment.session = %q, want %q", got.GetString("session"), sessionID)
	}
	if got.GetInt("session_cm_id") != 1309514 {
		t.Errorf("session_cm_id = %d, want 1309514", got.GetInt("session_cm_id"))
	}
}

// TestSessionDeleteCascadesWhenCascadeIsOn documents the behavior the migration
// moves away from. If this ever stops passing, PocketBase changed its cascade
// semantics and the reasoning behind 1500000124 needs revisiting.
func TestSessionDeleteCascadesWhenCascadeIsOn(t *testing.T) {
	app, sessionID, assignID := newCascadeProbeApp(t, true)

	sess, err := app.FindRecordById("camp_sessions", sessionID)
	if err != nil {
		t.Fatalf("find session: %v", err)
	}
	if err := app.Delete(sess); err != nil {
		t.Fatalf("delete session: %v", err)
	}

	if _, err := app.FindRecordById("lodging_assignments", assignID); err == nil {
		t.Error("expected the assignment to have been cascaded away; " +
			"if it survived, the premise of kindred#1879 no longer holds")
	}
}

// TestSessionCMIDSurvivesAcrossYears pins why the durable key exists at all.
//
// camp_sessions is unique on (cm_id, year), so a program that runs, skips a year
// and returns gets a DIFFERENT PocketBase record id each season. Any cross-year
// question -- "same cabin as last year" -- can only be joined on the CampMinder
// id, which is why session_cm_id sits beside the relation instead of replacing it.
func TestSessionCMIDSurvivesAcrossYears(t *testing.T) {
	app, _, _ := newCascadeProbeApp(t, false)

	sessions, err := app.FindCollectionByNameOrId("camp_sessions")
	if err != nil {
		t.Fatalf("find camp_sessions: %v", err)
	}
	// The same program, two seasons apart.
	revived := core.NewRecord(sessions)
	revived.Set("cm_id", 1309514)
	revived.Set("year", 2027)
	if saveErr := app.Save(revived); saveErr != nil {
		t.Fatalf("save revived session: %v", saveErr)
	}

	rows, err := app.FindRecordsByFilter("camp_sessions", "cm_id = 1309514", "year", 0, 0)
	if err != nil {
		t.Fatalf("find by cm_id: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows for one program across two years, got %d", len(rows))
	}
	if rows[0].Id == rows[1].Id {
		t.Fatal("the two seasons share a record id; the fixture is wrong")
	}
	// Same CampMinder identity, different PB ids: exactly the case a relation
	// cannot express and session_cm_id can.
	if rows[0].GetInt("cm_id") != rows[1].GetInt("cm_id") {
		t.Error("cm_id differs across years; it is supposed to be the stable identity")
	}
}
