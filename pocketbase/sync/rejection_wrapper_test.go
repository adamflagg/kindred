package sync

import (
	"errors"
	"fmt"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/campminder"
)

// The tests in this file pin kindred#2292: the five wrapper functions whose
// callee returns both a transform rejection and an infrastructure (App.Save)
// error through one return value now distinguish them with errRejectedRecord,
// so the call site's errors.Is check routes to the right Stats counter.
//
// Each wrapper gets two cases: a malformed-input case that must return an error
// satisfying errors.Is(err, errRejectedRecord), and a valid-input-but-failed-save
// case (via failingSaveApp) that must return an error that does NOT satisfy it.
// That is the classification the call site's errors.Is branch depends on --
// rejection_sites_test.go's structural census then pins that each call site
// routes the right literal message to the right counter.

// failingSaveApp wraps a core.App and fails every App.Save for one named
// collection, delegating everything else. Models an infrastructure (SQLite)
// failure the way flakyCollectionApp models one for FindRecordsByFilter.
type failingSaveApp struct {
	core.App
	collection string
}

func (a *failingSaveApp) Save(model core.Model) error {
	if record, ok := model.(*core.Record); ok && record.Collection().Name == a.collection {
		return fmt.Errorf("simulated save failure for %s", a.collection)
	}
	if err := a.App.Save(model); err != nil {
		return fmt.Errorf("delegating Save: %w", err)
	}
	return nil
}

// newRejectionTestClient returns a real *campminder.Client -- GetSeasonID is a
// pure getter, so a fake key is sufficient, matching attendees_dryrun_test.go.
func newRejectionTestClient(t *testing.T) *campminder.Client {
	t.Helper()
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")
	client, err := campminder.NewClient(&campminder.Config{APIKey: "test-key", ClientID: "test-client", SeasonID: 2026})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}
	return client
}

func assertRejected(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("got nil error, want an error wrapping errRejectedRecord")
	}
	if !errors.Is(err, errRejectedRecord) {
		t.Errorf("err = %v, want errors.Is(err, errRejectedRecord) == true", err)
	}
}

func assertInfraError(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("got nil error, want a non-rejection error")
	}
	if errors.Is(err, errRejectedRecord) {
		t.Errorf("err = %v, want errors.Is(err, errRejectedRecord) == false", err)
	}
}

// ---------------------------------------------------------------------------
// processEnrollment (attendees.go)
// ---------------------------------------------------------------------------

func newAttendeesTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(sessions); saveErr != nil {
		t.Fatalf("save camp_sessions: %v", saveErr)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(persons); saveErr != nil {
		t.Fatalf("save persons: %v", saveErr)
	}

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.NumberField{Name: "person_id"})
	attendees.Fields.Add(&core.TextField{Name: "status"})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	attendees.Fields.Add(&core.TextField{Name: "enrollment_date"})
	attendees.Fields.Add(&core.TextField{Name: "effective_date"})
	attendees.Fields.Add(&core.TextField{Name: "last_updated_utc"})
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	attendees.Fields.Add(&core.TextField{Name: "session"})
	attendees.Fields.Add(&core.TextField{Name: "person"})
	if saveErr := app.Save(attendees); saveErr != nil {
		t.Fatalf("save attendees: %v", saveErr)
	}

	return app
}

func TestProcessEnrollment_MissingSessionID_IsRejected(t *testing.T) {
	app := newAttendeesTestApp(t)
	s := NewAttendeesSync(app, newRejectionTestClient(t))

	err := s.processEnrollment(9001, map[string]any{}, map[string]*core.Record{})
	assertRejected(t, err)
}

func TestProcessEnrollment_SaveFailure_IsInfraError(t *testing.T) {
	app := newAttendeesTestApp(t)

	// Seed a session and a person so PopulateRelations succeeds.
	sessionsCol, err := app.FindCollectionByNameOrId("camp_sessions")
	if err != nil {
		t.Fatalf("find camp_sessions: %v", err)
	}
	sessionRec := core.NewRecord(sessionsCol)
	sessionRec.Set("cm_id", 501)
	sessionRec.Set("year", 2026)
	if saveErr := app.Save(sessionRec); saveErr != nil {
		t.Fatalf("seed session: %v", saveErr)
	}

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	personRec := core.NewRecord(personsCol)
	personRec.Set("cm_id", 9001)
	personRec.Set("year", 2026)
	if saveErr := app.Save(personRec); saveErr != nil {
		t.Fatalf("seed person: %v", saveErr)
	}

	failing := &failingSaveApp{App: app, collection: "attendees"}
	s := NewAttendeesSync(failing, newRejectionTestClient(t))
	s.sessionCMIDs = map[string]bool{"501": true}

	enrollment := map[string]any{"SessionID": float64(501), "StatusID": float64(2)}
	err = s.processEnrollment(9001, enrollment, map[string]*core.Record{})
	assertInfraError(t, err)
}

// ---------------------------------------------------------------------------
// processAssignment (bunk_assignments.go)
// ---------------------------------------------------------------------------

func newBunkAssignmentsTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	for _, name := range []string{"persons", "camp_sessions", "bunks"} {
		col := core.NewBaseCollection(name)
		col.Fields.Add(&core.NumberField{Name: "cm_id"})
		col.Fields.Add(&core.NumberField{Name: "year"})
		if saveErr := app.Save(col); saveErr != nil {
			t.Fatalf("save %s: %v", name, saveErr)
		}
	}

	assignments := core.NewBaseCollection("bunk_assignments")
	assignments.Fields.Add(&core.NumberField{Name: "year"})
	assignments.Fields.Add(&core.NumberField{Name: "cm_id"})
	assignments.Fields.Add(&core.TextField{Name: "person"})
	assignments.Fields.Add(&core.TextField{Name: "session"})
	assignments.Fields.Add(&core.TextField{Name: "bunk"})
	if saveErr := app.Save(assignments); saveErr != nil {
		t.Fatalf("save bunk_assignments: %v", saveErr)
	}

	return app
}

func TestProcessAssignment_MissingPersonID_IsRejected(t *testing.T) {
	app := newBunkAssignmentsTestApp(t)
	s := NewBunkAssignmentsSync(app, newRejectionTestClient(t))

	err := s.processAssignment(map[string]any{}, map[string]*core.Record{})
	assertRejected(t, err)
}

func TestProcessAssignment_SaveFailure_IsInfraError(t *testing.T) {
	app := newBunkAssignmentsTestApp(t)

	seed := func(collection string, cmID int) {
		t.Helper()
		col, colErr := app.FindCollectionByNameOrId(collection)
		if colErr != nil {
			t.Fatalf("find %s: %v", collection, colErr)
		}
		rec := core.NewRecord(col)
		rec.Set("cm_id", cmID)
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed %s: %v", collection, saveErr)
		}
	}
	seed("persons", 9001)
	seed("camp_sessions", 501)
	seed("bunks", 701)

	failing := &failingSaveApp{App: app, collection: "bunk_assignments"}
	s := NewBunkAssignmentsSync(failing, newRejectionTestClient(t))
	s.validPersonCMIDs = map[int]bool{9001: true}
	s.validSessionCMIDs = map[int]bool{501: true}
	s.validBunkCMIDs = map[int]bool{701: true}

	assignmentData := map[string]any{
		"PersonID":   float64(9001),
		"SessionID":  float64(501),
		"BunkID":     float64(701),
		"BunkPlanID": float64(0),
	}
	err := s.processAssignment(assignmentData, map[string]*core.Record{})
	assertInfraError(t, err)
}

// ---------------------------------------------------------------------------
// processRow (bunk_requests.go)
// ---------------------------------------------------------------------------

func newBunkRequestsTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("original_bunk_requests")
	col.Fields.Add(&core.TextField{Name: "requester"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	col.Fields.Add(&core.TextField{Name: "field"})
	col.Fields.Add(&core.TextField{Name: "content"})
	col.Fields.Add(&core.TextField{Name: "content_hash"})
	col.Fields.Add(&core.TextField{Name: "processed"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save original_bunk_requests: %v", saveErr)
	}

	return app
}

func TestProcessRow_MissingPersonID_IsRejected(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsTestApp(t)
	s := NewBunkRequestsSync(app, nil)

	columnIndex := map[string]int{"PersonID": 0}
	err := s.processRow([]string{""}, columnIndex, 2026)
	assertRejected(t, err)
}

func TestProcessRow_InvalidPersonID_IsRejected(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsTestApp(t)
	s := NewBunkRequestsSync(app, nil)

	columnIndex := map[string]int{"PersonID": 0}
	err := s.processRow([]string{"not-a-number"}, columnIndex, 2026)
	assertRejected(t, err)
}

func TestProcessRow_SaveFailure_IsInfraError(t *testing.T) {
	t.Parallel()
	app := newBunkRequestsTestApp(t)
	failing := &failingSaveApp{App: app, collection: "original_bunk_requests"}
	s := NewBunkRequestsSync(failing, nil)
	s.validPersonIDs = map[int]string{9001: "somepbid00000001"}

	columnIndex := map[string]int{"PersonID": 0, "Share Bunk With": 1}
	err := s.processRow([]string{"9001", "bunk with Emma Johnson"}, columnIndex, 2026)
	assertInfraError(t, err)
}

// ---------------------------------------------------------------------------
// processPerson (persons.go)
// ---------------------------------------------------------------------------

func newPersonsTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("persons")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "first_name"})
	col.Fields.Add(&core.TextField{Name: "last_name"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	col.Fields.Add(&core.BoolField{Name: "is_camper"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save persons: %v", saveErr)
	}

	return app
}

func validPersonData(id float64) map[string]any {
	return map[string]any{
		"ID":            id,
		"CamperDetails": map[string]any{},
		"Name":          map[string]any{"First": "Emma", "Last": "Johnson"},
	}
}

func TestProcessPerson_MissingID_IsRejected(t *testing.T) {
	t.Parallel()
	app := newPersonsTestApp(t)
	s := NewPersonsSync(app, nil)

	personData := map[string]any{
		"CamperDetails": map[string]any{},
		"Name":          map[string]any{"First": "Emma", "Last": "Johnson"},
	}
	err := s.processPerson(personData, true, map[int]*core.Record{}, map[string]string{}, map[int]string{}, 2026)
	assertRejected(t, err)
}

func TestProcessPerson_SaveFailure_IsInfraError(t *testing.T) {
	t.Parallel()
	app := newPersonsTestApp(t)
	failing := &failingSaveApp{App: app, collection: "persons"}
	s := NewPersonsSync(failing, nil)

	err := s.processPerson(
		validPersonData(9001), true, map[int]*core.Record{}, map[string]string{}, map[int]string{}, 2026)
	assertInfraError(t, err)
}

// ---------------------------------------------------------------------------
// ProcessSimpleRecord (base_sync.go)
// ---------------------------------------------------------------------------

func newSimpleRecordTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("simple_records")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "name"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save simple_records: %v", saveErr)
	}

	return app
}

func TestProcessSimpleRecord_MissingYear_IsRejected(t *testing.T) {
	t.Parallel()
	app := newSimpleRecordTestApp(t)
	b := BaseSyncService{App: app}

	recordData := map[string]any{"cm_id": 9001, "name": "widget"}
	err := b.ProcessSimpleRecord("simple_records", 9001, recordData, map[any]*core.Record{}, nil)
	assertRejected(t, err)
}

func TestProcessSimpleRecord_InvalidYearType_IsRejected(t *testing.T) {
	t.Parallel()
	app := newSimpleRecordTestApp(t)
	b := BaseSyncService{App: app}

	recordData := map[string]any{"cm_id": 9001, "name": "widget", "year": "not-a-number"}
	err := b.ProcessSimpleRecord("simple_records", 9001, recordData, map[any]*core.Record{}, nil)
	assertRejected(t, err)
}

func TestProcessSimpleRecord_SaveFailure_IsInfraError(t *testing.T) {
	t.Parallel()
	app := newSimpleRecordTestApp(t)
	failing := &failingSaveApp{App: app, collection: "simple_records"}
	b := BaseSyncService{App: failing}

	recordData := map[string]any{"cm_id": 9001, "name": "widget", "year": 2026}
	err := b.ProcessSimpleRecord("simple_records", 9001, recordData, map[any]*core.Record{}, nil)
	assertInfraError(t, err)
}
