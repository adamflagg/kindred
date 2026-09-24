package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/camp/kindred/pocketbase/jotform"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const jfYear = 2026
const jfSession = 1000002 // a fictional adult weekend

// fakeJotform serves canned submissions per form id, or an error.
type fakeJotform struct {
	subs map[string][]jotform.Submission
	err  error
	// onFetch, when set, runs inside the pull after the job loaded its forms:
	// the seam for an admin edit made while a pull is in flight.
	onFetch func()
}

func (f *fakeJotform) FormSubmissions(_ context.Context, formID string) ([]jotform.Submission, error) {
	if f.onFetch != nil {
		f.onFetch()
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.subs[formID], nil
}

// newJotformTestApp extends the sync package's shared fixture with the three
// Jotform tables (shaped like migration 1500000180) and the persons email
// columns the email tiebreak reads.
func newJotformTestApp(t *testing.T) core.App {
	t.Helper()
	app := newSyncTestApp(t)

	persons, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"primary_email", "secondary_email"} {
		if persons.Fields.GetByName(name) == nil {
			persons.Fields.Add(&core.TextField{Name: name})
		}
	}
	saveCollection(t, app, persons)

	forms := core.NewBaseCollection("jotform_forms")
	forms.Fields.Add(&core.NumberField{Name: "year"})
	forms.Fields.Add(&core.NumberField{Name: "session_cm_id"})
	forms.Fields.Add(&core.TextField{Name: "form_id"})
	forms.Fields.Add(&core.JSONField{Name: "field_map"})
	forms.Fields.Add(&core.BoolField{Name: "enabled"})
	forms.Fields.Add(&core.DateField{Name: "last_pulled_at"})
	forms.Fields.Add(&core.TextField{Name: "last_pull_status"})
	saveCollection(t, app, forms)

	subs := core.NewBaseCollection("jotform_submissions")
	subs.Fields.Add(&core.TextField{Name: "submission_id"})
	subs.Fields.Add(&core.RelationField{Name: "form", CollectionId: forms.Id, MaxSelect: 1})
	subs.Fields.Add(&core.NumberField{Name: "year"})
	subs.Fields.Add(&core.NumberField{Name: "session_cm_id"})
	subs.Fields.Add(&core.TextField{Name: "submitted_at"})
	subs.Fields.Add(&core.TextField{Name: "updated_at"})
	subs.Fields.Add(&core.TextField{Name: "jotform_status"})
	subs.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	subs.Fields.Add(&core.SelectField{
		Name: "match_status", Values: []string{"auto", "staff", "unmatched", "ignored"}, MaxSelect: 1,
	})
	subs.Fields.Add(&core.NumberField{Name: "match_tier"})
	subs.Fields.Add(&core.TextField{Name: "linked_by"})
	subs.Fields.Add(&core.DateField{Name: "linked_at"})
	saveCollection(t, app, subs)

	answers := core.NewBaseCollection("jotform_answers")
	answers.Fields.Add(&core.RelationField{Name: "submission", CollectionId: subs.Id, MaxSelect: 1, CascadeDelete: true})
	answers.Fields.Add(&core.TextField{Name: "question_id"})
	answers.Fields.Add(&core.TextField{Name: "question_text"})
	answers.Fields.Add(&core.TextField{Name: "question_type"})
	answers.Fields.Add(&core.TextField{Name: "answer_text"})
	answers.Fields.Add(&core.JSONField{Name: "answer_json"})
	answers.Fields.Add(&core.NumberField{Name: "order"})
	saveCollection(t, app, answers)
	return app
}

// seedWeekend creates the adult session, two enrolled guests and one cancelled
// guest, and one enabled form mapped fullname(4) + nametag(5) + email(40).
func seedWeekend(t *testing.T, app core.App) (formRecordID string) {
	t.Helper()
	sessionID := saveRecord(t, app, "camp_sessions", map[string]any{
		"cm_id": jfSession, "name": "Women's Weekend", "session_type": "adult", "year": jfYear,
	})
	guest := func(cmID int, first, last string, status int) {
		pid := saveRecord(t, app, "persons", map[string]any{
			"cm_id": cmID, "year": jfYear, "first_name": first, "last_name": last,
		})
		saveRecord(t, app, "attendees", map[string]any{
			"person": pid, "person_id": cmID, "session": sessionID, "status_id": status, "year": jfYear,
		})
	}
	guest(1000004, "Olivia", "Chen", 2)
	guest(1000005, "Emma", "Johnson", 2)
	guest(1000006, "Liam", "Garcia", 4) // not enrolled
	return saveRecord(t, app, "jotform_forms", map[string]any{
		"year": jfYear, "session_cm_id": jfSession, "form_id": "261700000000001", "enabled": true,
		"field_map": map[string]string{
			"first_name": "4", "last_name": "4", "nametag_name": "5", "respondent_email": "40", "bunking_request": "21",
		},
	})
}

func submission(id, created, first, last, bunk string) jotform.Submission {
	name, _ := json.Marshal(map[string]string{"first": first, "last": last})
	req, _ := json.Marshal(bunk)
	return jotform.Submission{
		ID: id, FormID: "261700000000001", CreatedAt: created, Status: "ACTIVE",
		Answers: map[string]jotform.Answer{
			"4":  {Order: "4", Text: "Name", Type: "control_fullname", Answer: name},
			"21": {Order: "21", Text: "Bunking request", Type: "control_textarea", Answer: req},
		},
	}
}

func runJotform(t *testing.T, app core.App, fake *fakeJotform) (*JotformSubmissionsSync, error) {
	t.Helper()
	s := NewJotformSubmissionsSync(app)
	s.Year = jfYear
	s.Fetcher = fake
	err := s.Sync(context.Background())
	return s, err
}

func subRecord(t *testing.T, app core.App, submissionID string) *core.Record {
	t.Helper()
	rec, err := app.FindFirstRecordByFilter("jotform_submissions", "submission_id = {:id}",
		map[string]any{"id": submissionID})
	if err != nil {
		t.Fatalf("find submission %s: %v", submissionID, err)
	}
	return rec
}

func TestJotformPullStoresEveryAnswerAndMatches(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	fake := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", "Emma Johnson"),
		submission("6600000000000000002", "2026-08-04 09:00:00", "Olivia", "Chenn", ""),
		submission("6600000000000000003", "2026-08-05 09:00:00", "Liam", "Garcia", "Olivia Chen"),
	}}}

	s, err := runJotform(t, app, fake)
	if err != nil {
		t.Fatal(err)
	}
	if s.Stats.Created != 3 {
		t.Errorf("Created = %d, want 3", s.Stats.Created)
	}
	if got := subRecord(t, app, "6600000000000000001"); got.GetString("match_status") != "auto" ||
		got.GetInt("person_cm_id") != 1000004 || got.GetInt("match_tier") != 1 {
		t.Errorf("exact name must auto-match tier 1: %v", got.PublicExport())
	}
	if got := subRecord(t, app, "6600000000000000002"); got.GetString("match_status") != "unmatched" ||
		got.GetInt("person_cm_id") != 0 {
		t.Errorf("a typo goes to staff: %v", got.PublicExport())
	}
	// Liam Garcia's attendee row is cancelled (status 4): not a candidate.
	if got := subRecord(t, app, "6600000000000000003"); got.GetString("match_status") != "unmatched" {
		t.Errorf("a non-enrolled person must not match: %v", got.PublicExport())
	}
	answers, _ := app.FindRecordsByFilter("jotform_answers", "", "", 0, 0)
	// 3 names + 2 non-blank bunking answers; the blank one is not stored.
	if len(answers) != 5 {
		t.Errorf("stored %d answers, want 5", len(answers))
	}
	form, _ := app.FindFirstRecordByFilter("jotform_forms", "form_id = '261700000000001'")
	if !strings.HasPrefix(form.GetString("last_pull_status"), "ok · 3 submissions · 1 matched · 2 unmatched") {
		t.Errorf("last_pull_status = %q", form.GetString("last_pull_status"))
	}
}

func TestJotformPullIsIdempotent(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	fake := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", "Emma Johnson"),
	}}}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	s, err := runJotform(t, app, fake)
	if err != nil {
		t.Fatal(err)
	}
	if s.Stats.Created != 0 || s.Stats.Updated != 0 || s.Stats.Skipped != 1 {
		t.Errorf("a re-pull of unchanged data must write nothing: %+v", s.Stats)
	}
	answers, _ := app.FindRecordsByFilter("jotform_answers", "", "", 0, 0)
	if len(answers) != 2 {
		t.Errorf("answers duplicated on re-pull: %d", len(answers))
	}
}

func TestJotformPullUpdatesAnEditedAnswerAndDropsAClearedOne(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	first := submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", "Emma Johnson")
	if _, err := runJotform(t, app,
		&fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {first}}}); err != nil {
		t.Fatal(err)
	}
	edited := submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", "")
	s, err := runJotform(t, app, &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {edited}}})
	if err != nil {
		t.Fatal(err)
	}
	if s.Stats.Updated != 1 {
		t.Errorf("Updated = %d, want 1", s.Stats.Updated)
	}
	if rows, _ := app.FindRecordsByFilter("jotform_answers", "question_id = '21'", "", 0, 0); len(rows) != 0 {
		t.Error("an answer cleared on Jotform must be removed, not left stale")
	}
}

func TestJotformDeletedSubmissionIsMarkedNotDeleted(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	both := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", "Emma Johnson"),
		submission("6600000000000000002", "2026-08-04 09:00:00", "Emma", "Johnson", ""),
	}}}
	if _, err := runJotform(t, app, both); err != nil {
		t.Fatal(err)
	}
	one := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {both.subs["261700000000001"][0]}}}
	s, err := runJotform(t, app, one)
	if err != nil {
		t.Fatal(err)
	}
	if s.Stats.Deleted != 1 {
		t.Errorf("Deleted = %d, want 1", s.Stats.Deleted)
	}
	if got := subRecord(t, app, "6600000000000000002"); got.GetString("jotform_status") != "DELETED" {
		t.Errorf("vanished submission must be MARKED, got %q", got.GetString("jotform_status"))
	}
}

// Review Focus 2.
func TestJotformPullErrorMarksNothingDeleted(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	if _, err := runJotform(t, app, &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", "Emma Johnson"),
	}}}); err != nil {
		t.Fatal(err)
	}
	s, err := runJotform(t, app, &fakeJotform{err: errors.New("HTTP 500")})
	if err == nil {
		t.Fatal("a failed pull must fail the job")
	}
	if s.Stats.Deleted != 0 || subRecord(t, app, "6600000000000000001").GetString("jotform_status") == "DELETED" {
		t.Error("a failed pull must never mark anything deleted")
	}
	form, _ := app.FindFirstRecordByFilter("jotform_forms", "form_id = '261700000000001'")
	if !strings.HasPrefix(form.GetString("last_pull_status"), "error: ") {
		t.Errorf("last_pull_status = %q, want an error: prefix", form.GetString("last_pull_status"))
	}
}

// Review Focus 3.
func TestJotformStaffLinkSurvivesRepull(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	fake := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", ""),
		submission("6600000000000000002", "2026-08-04 09:00:00", "Olivia", "Chenn", ""),
	}}}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	// Staff link the exact-name submission to someone ELSE, and ignore the typo.
	linked := subRecord(t, app, "6600000000000000001")
	linked.Set("match_status", "staff")
	linked.Set("person_cm_id", 1000005)
	linked.Set("linked_by", "staff@example.com")
	if err := app.Save(linked); err != nil {
		t.Fatal(err)
	}
	ignored := subRecord(t, app, "6600000000000000002")
	ignored.Set("match_status", "ignored")
	if err := app.Save(ignored); err != nil {
		t.Fatal(err)
	}

	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	if got := subRecord(t, app, "6600000000000000001"); got.GetString("match_status") != "staff" ||
		got.GetInt("person_cm_id") != 1000005 {
		t.Errorf("a staff link was overwritten: %v", got.PublicExport())
	}
	if got := subRecord(t, app, "6600000000000000002"); got.GetString("match_status") != "ignored" {
		t.Errorf("an ignore was overwritten: %v", got.PublicExport())
	}
}

// Review Focus 5.
func TestJotformAutoMatchIsReevaluatedEachPull(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	fake := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", ""),
	}}}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	// Olivia cancels.
	att, err := app.FindFirstRecordByFilter("attendees", "person_id = 1000004")
	if err != nil {
		t.Fatal(err)
	}
	att.Set("status_id", 4)
	if err := app.Save(att); err != nil {
		t.Fatal(err)
	}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	if got := subRecord(t, app, "6600000000000000001"); got.GetString("match_status") != "unmatched" ||
		got.GetInt("person_cm_id") != 0 {
		t.Errorf("an auto match to a no-longer-enrolled guest must be withdrawn: %v", got.PublicExport())
	}
}

func TestJotformUnmappedFormStoresButSkipsMatching(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	form, _ := app.FindFirstRecordByFilter("jotform_forms", "form_id = '261700000000001'")
	form.Set("field_map", types.JSONRaw(`{}`))
	if err := app.Save(form); err != nil {
		t.Fatal(err)
	}
	if _, err := runJotform(t, app, &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", ""),
	}}}); err != nil {
		t.Fatal(err)
	}
	if got := subRecord(t, app, "6600000000000000001"); got.GetString("match_status") != "unmatched" {
		t.Errorf("no mapping, no match: %v", got.PublicExport())
	}
	form, _ = app.FindFirstRecordByFilter("jotform_forms", "form_id = '261700000000001'")
	if !strings.Contains(form.GetString("last_pull_status"), "matching skipped") {
		t.Errorf("last_pull_status = %q", form.GetString("last_pull_status"))
	}
}

func TestJotformSyncWithoutAKeyFailsLoudly(t *testing.T) {
	// Not t.Parallel(): t.Setenv panics if the test may run in parallel.
	app := newJotformTestApp(t)
	t.Setenv("JOTFORM_API_KEY", "")
	s := NewJotformSubmissionsSync(app)
	s.Year = jfYear
	if err := s.Sync(context.Background()); !errors.Is(err, jotform.ErrNoAPIKey) {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
	}
}

// A staff link made WHILE a pull runs must survive it too, not only one made
// between pulls: the job saves whole records, so a save built from a copy
// loaded before the link would write the stale match back (#2824 review).
func TestJotformStaffLinkMadeDuringThePullSurvives(t *testing.T) {
	t.Parallel()
	for _, phase := range []string{"upsert", "match"} {
		t.Run(phase, func(t *testing.T) {
			t.Parallel()
			app := newJotformTestApp(t)
			seedWeekend(t, app)
			ids := []string{"6600000000000000001", "6600000000000000002"}
			typo := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
				submission(ids[0], "2026-08-03 09:00:00", "Olivia", "Chenn", ""),
				submission(ids[1], "2026-08-04 09:00:00", "Emma", "Johnsonn", ""),
			}}}
			if _, err := runJotform(t, app, typo); err != nil {
				t.Fatal(err)
			}

			// Second pull: both guests fixed their names (so matching would now
			// auto-match both) and Jotform stamped an edit (so both rows re-save).
			fixed := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
				submission(ids[0], "2026-08-03 09:00:00", "Olivia", "Chen", ""),
				submission(ids[1], "2026-08-04 09:00:00", "Emma", "Johnson", ""),
			}}}
			for i := range fixed.subs["261700000000001"] {
				fixed.subs["261700000000001"][i].UpdatedAt = "2026-08-06 09:00:00"
			}

			// The first time the job saves one of the two rows in this phase,
			// a staff member links the OTHER one, which the job has not saved yet.
			var linkedID string
			app.OnRecordUpdate("jotform_submissions").BindFunc(func(e *core.RecordEvent) error {
				inPhase := e.Record.GetString("match_status") == matchStatusAuto
				if phase == "upsert" {
					inPhase = e.Record.GetString("updated_at") != ""
				}
				if linkedID != "" || !inPhase {
					return e.Next()
				}
				linkedID = ids[0]
				if e.Record.GetString("submission_id") == ids[0] {
					linkedID = ids[1]
				}
				other, err := e.App.FindFirstRecordByFilter("jotform_submissions",
					"submission_id = {:id}", map[string]any{"id": linkedID})
				if err != nil {
					return fmt.Errorf("finding the row to link: %w", err)
				}
				other.Set("match_status", matchStatusStaff)
				other.Set("person_cm_id", 1000006)
				if err := e.App.Save(other); err != nil {
					return fmt.Errorf("linking: %w", err)
				}
				return e.Next()
			})

			if _, err := runJotform(t, app, fixed); err != nil {
				t.Fatal(err)
			}
			if linkedID == "" {
				t.Fatal("the hook never fired, so this test exercised nothing")
			}
			if got := subRecord(t, app, linkedID); got.GetString("match_status") != matchStatusStaff ||
				got.GetInt("person_cm_id") != 1000006 {
				t.Errorf("a staff link made during the %s phase was overwritten: %v", phase, got.PublicExport())
			}
		})
	}
}

// An admin edit to a form made while a pull runs must survive the job's
// last-pull stamp, which is the only thing the job writes on jotform_forms.
func TestJotformPullStatusDoesNotRevertAConcurrentFormEdit(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	formID := seedWeekend(t, app)
	fake := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", ""),
	}}}
	fake.onFetch = func() {
		form, err := app.FindRecordById("jotform_forms", formID)
		if err != nil {
			t.Error(err)
			return
		}
		form.Set("field_map", types.JSONRaw(
			`{"first_name":"4","last_name":"4","nametag_name":"5","respondent_email":"40","cpap":"77"}`))
		if err := app.Save(form); err != nil {
			t.Error(err)
		}
	}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	form, err := app.FindRecordById("jotform_forms", formID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(jsonFieldBytes(form.Get("field_map"))), `"cpap"`) {
		t.Errorf("the pull reverted a field_map edit made while it ran: %s", jsonFieldBytes(form.Get("field_map")))
	}
	if !strings.HasPrefix(form.GetString("last_pull_status"), "ok · ") {
		t.Errorf("last_pull_status = %q, want the ok stamp", form.GetString("last_pull_status"))
	}
}

// Marking a vanished submission DELETED must not revert a staff edit made to
// that row while the pull ran: the mark is written on a fresh copy too.
func TestJotformDeletedMarkKeepsAStaffEditMadeDuringThePull(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	kept, vanished := "6600000000000000001", "6600000000000000002"
	if _, err := runJotform(t, app, &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": {
		submission(kept, "2026-08-03 09:00:00", "Olivia", "Chen", ""),
		submission(vanished, "2026-08-04 09:00:00", "Emma", "Johnsonn", ""),
	}}}); err != nil {
		t.Fatal(err)
	}

	// Second pull: the kept row was edited on Jotform (so the job re-saves it),
	// and the other vanished. While the kept row saves, staff link the other.
	edited := submission(kept, "2026-08-03 09:00:00", "Olivia", "Chen", "")
	edited.UpdatedAt = "2026-08-06 09:00:00"
	fired := false
	app.OnRecordUpdate("jotform_submissions").BindFunc(func(e *core.RecordEvent) error {
		if fired || e.Record.GetString("submission_id") != kept {
			return e.Next()
		}
		fired = true
		other, err := e.App.FindFirstRecordByFilter("jotform_submissions",
			"submission_id = {:id}", map[string]any{"id": vanished})
		if err != nil {
			return fmt.Errorf("finding the row to link: %w", err)
		}
		other.Set("match_status", matchStatusStaff)
		other.Set("person_cm_id", 1000005)
		if err := e.App.Save(other); err != nil {
			return fmt.Errorf("linking: %w", err)
		}
		return e.Next()
	})
	if _, err := runJotform(t, app, &fakeJotform{subs: map[string][]jotform.Submission{
		"261700000000001": {edited},
	}}); err != nil {
		t.Fatal(err)
	}
	if !fired {
		t.Fatal("the hook never fired, so this test exercised nothing")
	}
	got := subRecord(t, app, vanished)
	if got.GetString("jotform_status") != jotformStatusDeleted {
		t.Errorf("the vanished row must still be marked DELETED: %v", got.PublicExport())
	}
	if got.GetString("match_status") != matchStatusStaff || got.GetInt("person_cm_id") != 1000005 {
		t.Errorf("marking it DELETED reverted a staff link made during the pull: %v", got.PublicExport())
	}
}
