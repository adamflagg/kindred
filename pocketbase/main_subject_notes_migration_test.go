package main

import (
	"fmt"
	"regexp"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// Board notes (1500000189). Two halves, as main_attendees_session_year_index_test.go
// does it: the migration FILE is asserted as text (JS migrations cannot be
// applied from a Go test -- tests.NewTestApp() does not bootstrap jsvm against
// pb_migrations/), and the index statements the file declares are installed
// on a collection shaped like subject_notes to prove what SQLite does with
// them. The load-bearing fact: PocketBase stores an EMPTY single relation as
// an empty string (not NULL), so the unique index covers the standard note
// (scenario = empty string).
const subjectNotesMigration = "pb_migrations/1500000189_subject_notes.js"

var subjectNotesIndexStatement = regexp.MustCompile("CREATE (?:UNIQUE )?INDEX `[a-z_]+` ON `subject_notes` \\([^)]*\\)")

// The scenario field's object literal inside the up path.
var subjectNotesScenarioField = regexp.MustCompile(`\{[^{}]*name: 'scenario'[^{}]*\}`)

// The year field's object literal inside the up path.
var subjectNotesYearField = regexp.MustCompile(`\{[^{}]*name: 'year'[^{}]*\}`)

func TestSubjectNotesMigrationShape(t *testing.T) {
	body := readMigration(t, subjectNotesMigration)
	up, down := migrationHalves(t, body)

	// VERBATIM from 1500000161:114-115. A paraphrase silently denies everything.
	if !strings.Contains(constValue(t, body, "BUNKING_MANAGE"),
		`'@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'`) {
		t.Errorf("%s must declare the canonical BUNKING_MANAGE rule verbatim", subjectNotesMigration)
	}
	// LITERAL name, so scripts/dev/verify-migration-history.sh can see the create.
	if !strings.Contains(up, "name: 'subject_notes'") {
		t.Errorf("%s must create subject_notes with a literal name", subjectNotesMigration)
	}
	// Reading is gated too (owner, 2026-09-25): all five rules, none AUTHED_READ.
	for _, rule := range []string{"listRule", "viewRule", "createRule", "updateRule", "deleteRule"} {
		if !strings.Contains(up, rule+": BUNKING_MANAGE") {
			t.Errorf("%s: %s must be BUNKING_MANAGE", subjectNotesMigration, rule)
		}
	}
	if strings.Contains(up, "options: {") {
		t.Errorf("%s nests field properties in options: {}, which v0.23 silently ignores", subjectNotesMigration)
	}
	field := subjectNotesScenarioField.FindString(up)
	if field == "" {
		t.Fatalf("%s declares no scenario field", subjectNotesMigration)
	}
	for _, want := range []string{"type: 'relation'", "required: false", "cascadeDelete: true", "maxSelect: 1"} {
		if !strings.Contains(field, want) {
			t.Errorf("scenario field must carry %q, got %s", want, field)
		}
	}
	// The migration's year floor must match SubjectNoteKey.year's ge=2000 in
	// api/schemas/subject_notes.py. A tighter PB floor lets a 2000-2009 year
	// pass Pydantic validation and then fail the PocketBase create with a raw
	// 400 -- which _write's race-recovery path (api/services/subject_note_service.py)
	// mistakes for a lost unique-index race, finds nothing, and re-raises --
	// instead of the intended 422.
	yearField := subjectNotesYearField.FindString(up)
	if yearField == "" {
		t.Fatalf("%s declares no year field", subjectNotesMigration)
	}
	if !strings.Contains(yearField, "min: 2000") {
		t.Errorf("%s: year field must carry min: 2000 to match the API schema, got %s", subjectNotesMigration, yearField)
	}
	if !strings.Contains(down, "app.delete(") {
		t.Errorf("%s's down path must delete the collection", subjectNotesMigration)
	}
}

// subjectNotesApp builds saved_scenarios and a subject_notes shaped like the
// migration's, carrying the index statements the migration FILE declares and
// the scenario cascade flag the file declares.
func subjectNotesApp(t *testing.T) (app *tests.TestApp, scenarios, notes *core.Collection) {
	t.Helper()
	body := readMigration(t, subjectNotesMigration)
	up, _ := migrationHalves(t, body)
	indexes := subjectNotesIndexStatement.FindAllString(body, -1)
	if len(indexes) != 3 {
		t.Fatalf("%s declares %d subject_notes indexes, this test was written against 3: %v",
			subjectNotesMigration, len(indexes), indexes)
	}
	cascade := strings.Contains(subjectNotesScenarioField.FindString(up), "cascadeDelete: true")

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("new test app: %v", err)
	}
	t.Cleanup(app.Cleanup)

	scenarios = core.NewBaseCollection("saved_scenarios")
	scenarios.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(scenarios); err != nil {
		t.Fatalf("save saved_scenarios: %v", err)
	}
	notes = core.NewBaseCollection("subject_notes")
	notes.Fields.Add(
		&core.TextField{Name: "subject_kind"},
		&core.NumberField{Name: "subject_cm_id"},
		&core.NumberField{Name: "session_cm_id"},
		&core.NumberField{Name: "year"},
		&core.RelationField{Name: "scenario", CollectionId: scenarios.Id, MaxSelect: 1, CascadeDelete: cascade},
		&core.TextField{Name: "body"},
	)
	notes.Indexes = indexes
	if err := app.Save(notes); err != nil {
		t.Fatalf("save subject_notes: %v", err)
	}
	return app, scenarios, notes
}

func saveNote(
	app *tests.TestApp, notes *core.Collection, kind string, cmID int, scenario string,
) (*core.Record, error) {
	rec := core.NewRecord(notes)
	rec.Set("subject_kind", kind)
	rec.Set("subject_cm_id", cmID)
	rec.Set("session_cm_id", 1000001)
	rec.Set("year", 2026)
	rec.Set("scenario", scenario)
	rec.Set("body", "Arriving late Friday.")
	if err := app.Save(rec); err != nil {
		return nil, fmt.Errorf("save subject note: %w", err)
	}
	return rec, nil
}

func saveScenario(t *testing.T, app *tests.TestApp, scenarios *core.Collection) *core.Record {
	t.Helper()
	rec := core.NewRecord(scenarios)
	rec.Set("name", "Draft A")
	if err := app.Save(rec); err != nil {
		t.Fatalf("save scenario: %v", err)
	}
	return rec
}

func TestSubjectNotesUniqueIndexRefusesASecondStandardNote(t *testing.T) {
	app, _, notes := subjectNotesApp(t)

	first, err := saveNote(app, notes, "person", 1000101, "")
	if err != nil {
		t.Fatalf("first standard note: %v", err)
	}
	if got := first.GetString("scenario"); got != "" {
		t.Fatalf("an empty relation must be stored as '', got %q", got)
	}
	if _, err := saveNote(app, notes, "person", 1000101, ""); err == nil {
		t.Fatal("a second standard note for the same subject/session/year was accepted")
	}
	// The kind is part of the key: a household and a person may share a cm id.
	if _, err := saveNote(app, notes, "household", 1000101, ""); err != nil {
		t.Fatalf("a household with the same cm id must not collide with a person: %v", err)
	}
}

func TestSubjectNotesUniqueIndexAllowsOnePlanNotePerScenario(t *testing.T) {
	app, scenarios, notes := subjectNotesApp(t)
	a := saveScenario(t, app, scenarios)
	b := saveScenario(t, app, scenarios)

	for _, scenario := range []string{"", a.Id, b.Id} {
		if _, err := saveNote(app, notes, "person", 1000101, scenario); err != nil {
			t.Fatalf("note for scenario %q: %v", scenario, err)
		}
	}
	if _, err := saveNote(app, notes, "person", 1000101, a.Id); err == nil {
		t.Fatal("a second plan-only note for the same scenario was accepted")
	}
}

func TestDeletingAScenarioCascadesItsPlanNotes(t *testing.T) {
	app, scenarios, notes := subjectNotesApp(t)
	scenario := saveScenario(t, app, scenarios)
	standard, _ := saveNote(app, notes, "person", 1000101, "")
	plan, err := saveNote(app, notes, "person", 1000101, scenario.Id)
	if err != nil {
		t.Fatalf("plan note: %v", err)
	}

	if err := app.Delete(scenario); err != nil {
		t.Fatalf("delete scenario: %v", err)
	}
	if _, err := app.FindRecordById("subject_notes", plan.Id); err == nil {
		t.Error("the plan-only note survived its scenario's deletion")
	}
	if _, err := app.FindRecordById("subject_notes", standard.Id); err != nil {
		t.Errorf("the standard note must survive a scenario deletion: %v", err)
	}
}
