package sync

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/camp/kindred/pocketbase/jotform"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// kindred#2828: the pull reads the form's definition from Jotform and
// resolves the mapping itself, so setup is one step.

const jfFormID = "261700000000001"

func jfForm(t *testing.T, app core.App) *core.Record {
	t.Helper()
	form, err := app.FindFirstRecordByFilter("jotform_forms", "form_id = {:id} && year = {:year}",
		map[string]any{"id": jfFormID, "year": jfYear})
	if err != nil {
		t.Fatal(err)
	}
	return form
}

func jfMeta(t *testing.T, form *core.Record) jotform.FieldMapMeta {
	t.Helper()
	meta := jotform.FieldMapMeta{}
	if raw := jsonFieldBytes(form.Get("field_map_meta")); compactJSON(raw) != "" {
		if err := json.Unmarshal(raw, &meta); err != nil {
			t.Fatalf("field_map_meta: %v", err)
		}
	}
	return meta
}

func jfFieldMap(t *testing.T, form *core.Record) jotform.FieldMap {
	t.Helper()
	fm, err := readFieldMap(form)
	if err != nil {
		t.Fatal(err)
	}
	return fm
}

// clearMapping makes seedWeekend's form a freshly pasted one: no mapping yet.
func clearMapping(t *testing.T, app core.App) {
	t.Helper()
	form := jfForm(t, app)
	form.Set("field_map", types.JSONRaw(`{}`))
	if err := app.Save(form); err != nil {
		t.Fatal(err)
	}
}

func setMapping(t *testing.T, app core.App, fieldMap, meta string) {
	t.Helper()
	form := jfForm(t, app)
	form.Set("field_map", types.JSONRaw(fieldMap))
	form.Set("field_map_meta", types.JSONRaw(meta))
	if err := app.Save(form); err != nil {
		t.Fatal(err)
	}
}

func fullname(first, last string) json.RawMessage {
	b, _ := json.Marshal(map[string]string{"first": first, "last": last})
	return b
}

func textAnswer(s string) json.RawMessage {
	b, _ := json.Marshal(s)
	return b
}

func submissionWith(id string, answers map[string]jotform.Answer) jotform.Submission {
	return jotform.Submission{
		ID: id, FormID: jfFormID, CreatedAt: "2026-08-03 09:00:00", Status: "ACTIVE", Answers: answers,
	}
}

func TestJotformPullReadsTheFormDefinitionBeforeAnySubmission(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	clearMapping(t, app)
	fake := &fakeJotform{titles: map[string]string{jfFormID: "Women's Weekend 2026"}}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	form := jfForm(t, app)
	if form.GetString("form_title") != "Women's Weekend 2026" {
		t.Errorf("form_title = %q", form.GetString("form_title"))
	}
	var stored []jotform.FormQuestion
	if err := json.Unmarshal(jsonFieldBytes(form.Get("questions")), &stored); err != nil {
		t.Fatalf("questions: %v", err)
	}
	if fmt.Sprint(stored) != fmt.Sprint(defaultQuestions()) {
		t.Errorf("questions snapshot = %+v", stored)
	}
	fm := jfFieldMap(t, form)
	if fm["first_name"] != "4" || fm["last_name"] != "4" || fm["bunking_request"] != "21" {
		t.Errorf("with zero submissions the mapping must still resolve: %v", fm)
	}
	meta := jfMeta(t, form)
	if meta["first_name"] != (jotform.RoleMeta{QuestionID: "4", Text: "Name", Source: jotform.SourceGuessed}) {
		t.Errorf("meta[first_name] = %+v", meta["first_name"])
	}
	if meta["coming_with"].Flag != jotform.FlagNeedsPick {
		t.Errorf("meta[coming_with] = %+v", meta["coming_with"])
	}
	want := "ok · 0 submissions · 0 matched · 0 unmatched · mapping: 6 guessed, 6 needs a pick"
	if got := form.GetString("last_pull_status"); got != want {
		t.Errorf("last_pull_status = %q\nwant              %q", got, want)
	}
}

func TestJotformFreshlyPastedFormMatchesInTheSameRun(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	clearMapping(t, app)
	if _, err := runJotform(t, app, &fakeJotform{subs: map[string][]jotform.Submission{jfFormID: {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", ""),
	}}}); err != nil {
		t.Fatal(err)
	}
	if got := subRecord(t, app, "6600000000000000001"); got.GetString("match_status") != matchStatusAuto ||
		got.GetInt("person_cm_id") != 1000004 {
		t.Errorf("one pull must store, map and match: %v", got.PublicExport())
	}
}

func TestJotformDefinitionFetchFailureWritesNothing(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	_, err := runJotform(t, app, &fakeJotform{
		defErr: errors.New("HTTP 500"),
		subs: map[string][]jotform.Submission{jfFormID: {
			submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", ""),
		}},
	})
	if err == nil {
		t.Fatal("a failed definition read must fail the pull")
	}
	if rows, _ := app.FindRecordsByFilter("jotform_submissions", "", "", 0, 0); len(rows) != 0 {
		t.Errorf("stored %d submissions after a failed definition read", len(rows))
	}
	form := jfForm(t, app)
	if fm := jfFieldMap(t, form); fm["first_name"] != "4" || len(jfMeta(t, form)) != 0 {
		t.Errorf("a failed pull must leave the mapping alone: %v %v", fm, jfMeta(t, form))
	}
	if !strings.HasPrefix(form.GetString("last_pull_status"), "error: ") {
		t.Errorf("last_pull_status = %q", form.GetString("last_pull_status"))
	}
}

func TestJotformStaffRolesAreKeptFlaggedOrDroppedNeverRepointed(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	setMapping(t, app,
		`{"first_name":"4","last_name":"4","bunking_request":"21","cpap":"88"}`,
		`{"first_name":{"question_id":"4","text":"Name","source":"staff"},
		  "last_name":{"question_id":"4","text":"Name","source":"staff"},
		  "bunking_request":{"question_id":"21","text":"Who would you like to room with?","source":"staff"},
		  "cpap":{"question_id":"88","text":"CPAP?","source":"staff"}}`)
	if _, err := runJotform(t, app, &fakeJotform{}); err != nil {
		t.Fatal(err)
	}
	form := jfForm(t, app)
	fm, meta := jfFieldMap(t, form), jfMeta(t, form)
	if fm["bunking_request"] != "21" {
		t.Errorf("a reworded staff question must still be used: %v", fm)
	}
	if meta["bunking_request"] != (jotform.RoleMeta{
		QuestionID: "21", Text: "Who would you like to room with?", Source: jotform.SourceStaff,
		Flag: jotform.FlagWordingChanged,
	}) {
		t.Errorf("meta[bunking_request] = %+v", meta["bunking_request"])
	}
	// Question 77 is a CPAP question the guesser would pick, but staff chose 88.
	if _, ok := fm["cpap"]; ok {
		t.Errorf("a removed staff question must leave the role unset, never repointed: %v", fm)
	}
	if meta["cpap"].Flag != jotform.FlagMissing || meta["cpap"].Source != jotform.SourceStaff {
		t.Errorf("meta[cpap] = %+v", meta["cpap"])
	}
}

func TestJotformCarriesTheMappingForwardByWordingAcrossYears(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	clearMapping(t, app)
	// Last year's Men's Weekend form, confirmed by staff: WW and MW share wording.
	saveRecord(t, app, "jotform_forms", map[string]any{
		"year": jfYear - 1, "session_cm_id": 1000003, "form_id": "251700000000009", "enabled": false,
		"field_map": map[string]string{"first_name": "8", "last_name": "9"},
		"field_map_meta": map[string]any{
			"first_name": map[string]string{"question_id": "8", "text": "Your given name", "source": "staff"},
			"last_name":  map[string]string{"question_id": "9", "text": "Your family name", "source": "carried"},
		},
	})
	fake := &fakeJotform{
		questions: map[string][]jotform.FormQuestion{jfFormID: {
			{QuestionID: "31", Text: "Your given name:", Type: "control_textbox", Order: 1},
			{QuestionID: "32", Text: "YOUR FAMILY NAME", Type: "control_textbox", Order: 2},
		}},
		subs: map[string][]jotform.Submission{jfFormID: {
			submissionWith("6600000000000000001", map[string]jotform.Answer{
				"31": {Order: "1", Text: "Your given name:", Type: "control_textbox", Answer: textAnswer("Emma")},
				"32": {Order: "2", Text: "YOUR FAMILY NAME", Type: "control_textbox", Answer: textAnswer("Johnson")},
			}),
		}},
	}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	form := jfForm(t, app)
	meta := jfMeta(t, form)
	if meta["first_name"].Source != jotform.SourceCarried || meta["first_name"].QuestionID != "31" ||
		meta["last_name"].Source != jotform.SourceCarried || meta["last_name"].QuestionID != "32" {
		t.Errorf("meta = %+v", meta)
	}
	if got := subRecord(t, app, "6600000000000000001"); got.GetInt("person_cm_id") != 1000005 {
		t.Errorf("carried names must match in the same run: %v", got.PublicExport())
	}
	if !strings.Contains(form.GetString("last_pull_status"), "2 same as last year") {
		t.Errorf("last_pull_status = %q", form.GetString("last_pull_status"))
	}
}

// The wrong-guess guard: a guessed name role landing on the wrong question
// (a roommate's name here; the emergency contact's in the case it exists for)
// would link submissions to the wrong guests, or unlink right ones.
func TestJotformGuessedNamesThatMatchTooFewHoldMatching(t *testing.T) {
	t.Parallel()
	roommateFirst := jotform.FormQuestion{QuestionID: "2", Text: "Roommate's name", Type: "control_fullname", Order: 2}
	subs := func(n int) []jotform.Submission {
		out := make([]jotform.Submission, 0, n)
		for i := range n {
			first, last := "Olivia", "Chen"
			if i%2 == 1 {
				first, last = "Emma", "Johnson"
			}
			out = append(out, submissionWith(fmt.Sprintf("66000000000000001%02d", i), map[string]jotform.Answer{
				"2": {Order: "2", Text: roommateFirst.Text, Type: "control_fullname", Answer: fullname("Riley", "Sam")},
				"4": {Order: "4", Text: "Name", Type: "control_fullname", Answer: fullname(first, last)},
			}))
		}
		return out
	}
	for _, tc := range []struct {
		name       string
		n          int
		staffNames bool
		wantHeld   bool
	}{
		{"ten guessed submissions below half are held", 10, false, true},
		{"fewer than ten are written", 9, false, false},
		{"staff-mapped names are trusted", 10, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			app := newJotformTestApp(t)
			seedWeekend(t, app)
			clearMapping(t, app)
			// First pull: the form has only the right name question.
			first := &fakeJotform{subs: map[string][]jotform.Submission{jfFormID: subs(tc.n)}}
			if _, err := runJotform(t, app, first); err != nil {
				t.Fatal(err)
			}
			if got := subRecord(t, app, "6600000000000000100"); got.GetString("match_status") != matchStatusAuto {
				t.Fatalf("setup: the first pull must auto-match: %v", got.PublicExport())
			}
			if tc.staffNames {
				setMapping(t, app, `{"first_name":"2","last_name":"2"}`,
					`{"first_name":{"question_id":"2","text":"Roommate's name","source":"staff"},
					  "last_name":{"question_id":"2","text":"Roommate's name","source":"staff"}}`)
			}
			// Second pull: a roommate-name question now comes first, so the
			// guess moves onto it and nobody matches.
			fake := &fakeJotform{
				subs: map[string][]jotform.Submission{jfFormID: subs(tc.n)},
				questions: map[string][]jotform.FormQuestion{
					jfFormID: append([]jotform.FormQuestion{roommateFirst}, defaultQuestions()...),
				},
			}
			if _, err := runJotform(t, app, fake); err != nil {
				t.Fatal(err)
			}
			got := subRecord(t, app, "6600000000000000100")
			status := jfForm(t, app).GetString("last_pull_status")
			if tc.wantHeld {
				if got.GetString("match_status") != matchStatusAuto || got.GetInt("person_cm_id") != 1000004 {
					t.Errorf("a held pull must leave prior matches alone: %v", got.PublicExport())
				}
				want := fmt.Sprintf("matching held: the guessed name questions matched only 0 of %d — check the mapping", tc.n)
				if !strings.Contains(status, want) {
					t.Errorf("last_pull_status = %q, want it to contain %q", status, want)
				}
				return
			}
			if got.GetString("match_status") != matchStatusUnmatched {
				t.Errorf("below the guard's floor the results are written: %v", got.PublicExport())
			}
			if strings.Contains(status, "held") {
				t.Errorf("last_pull_status = %q", status)
			}
		})
	}
}

func TestJotformGuessedNamesThatMatchHalfAreWritten(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	clearMapping(t, app)
	subs := make([]jotform.Submission, 0, 10)
	for i := range 10 {
		first, last := "Olivia", "Chen"
		if i >= 5 {
			first, last = "Riley", "Sam" // not enrolled
		}
		subs = append(subs, submission(fmt.Sprintf("66000000000000002%02d", i), "2026-08-03 09:00:00", first, last, ""))
	}
	if _, err := runJotform(t, app, &fakeJotform{subs: map[string][]jotform.Submission{jfFormID: subs}}); err != nil {
		t.Fatal(err)
	}
	if got := subRecord(t, app, "6600000000000000200"); got.GetString("match_status") != matchStatusAuto {
		t.Errorf("5 of 10 is not below half; the results must be written: %v", got.PublicExport())
	}
}

// An admin save made while the pull runs wins: the job resolves from a fresh
// read inside its write, so it never overwrites a staff role.
func TestJotformPullNeverOverwritesAStaffRoleSavedDuringIt(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	formID := seedWeekend(t, app)
	clearMapping(t, app)
	fake := &fakeJotform{subs: map[string][]jotform.Submission{jfFormID: {
		submission("6600000000000000001", "2026-08-03 09:00:00", "Olivia", "Chen", ""),
	}}}
	fake.onFetch = func() {
		form, err := app.FindRecordById("jotform_forms", formID)
		if err != nil {
			t.Error(err)
			return
		}
		form.Set("field_map", types.JSONRaw(`{"nametag_name":"21"}`))
		form.Set("field_map_meta", types.JSONRaw(
			`{"nametag_name":{"question_id":"21","text":"Bunking request","source":"staff"}}`))
		if err := app.Save(form); err != nil {
			t.Error(err)
		}
	}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
	form := jfForm(t, app)
	if fm := jfFieldMap(t, form); fm["nametag_name"] != "21" || fm["first_name"] != "4" {
		t.Errorf("field_map = %v: the staff role must survive and the rest resolve", fm)
	}
	if m := jfMeta(t, form)["nametag_name"]; m.Source != jotform.SourceStaff {
		t.Errorf("meta[nametag_name] = %+v, want the staff role kept", m)
	}
}

// A form repointed at a different Jotform form while the pull ran must not
// receive the OLD form's questions or mapping.
func TestJotformPullWritesNoMappingOntoAFormRepointedDuringIt(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	formID := seedWeekend(t, app)
	fake := &fakeJotform{}
	fake.onFetch = func() {
		form, err := app.FindRecordById("jotform_forms", formID)
		if err != nil {
			t.Error(err)
			return
		}
		form.Set("form_id", "261700000000002")
		form.Set("field_map", types.JSONRaw(`{}`))
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
	if compactJSON(jsonFieldBytes(form.Get("questions"))) != "" || len(jfFieldMap(t, form)) != 0 ||
		len(jfMeta(t, form)) != 0 {
		t.Errorf("the old form's definition was written onto the new one: questions %s map %v",
			jsonFieldBytes(form.Get("questions")), jfFieldMap(t, form))
	}
}
