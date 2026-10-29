package sync

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/camp/kindred/pocketbase/google"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The adult aid Google Form ingest, PR 1 (adult-aid form design). Every name,
// figure and id below is fictional; session ids are generic.

const (
	gfYear       = 2027
	gfFormID     = "test-form-0001"
	gfFC1        = 1000101 // Family Camp 1, starts 2027-05-28
	gfFC1Adults  = 1000111 // its Adult Reg session (family_adult, parent gfFC1)
	gfFC3a       = 1000103 // two family sessions start 2027-08-26
	gfFC3b       = 1000104
	gfFC3aAdults = 1000113 // Adult Reg paired to gfFC3a
	gfWW         = 1000201 // Women's Weekend (adult), starts 2027-10-14
)

const (
	gfChoiceFC1 = "Family Camp 1: Memorial Day Weekend (May 28- 31)"
	gfChoiceFC3 = "Family Camp 3 (August 26 - 29)"
	gfChoiceWW  = "Women's Weekend (October 14 - 17)"
	gfChoiceFC9 = "Family Camp 9 (June 3 - 6)" // no 2027 session starts that day
)

// aidFormField is one column of the two new tables, as the migration declares
// it. The fixture is built from this list, and
// TestAidGoogleFormFixtureMatchesTheMigration holds the list to the migration,
// so the tests cannot drift from the real schema.
type aidFormField struct{ name, kind string }

var aidGoogleFormsFields = []aidFormField{
	{"year", "number"}, {"form_id", "text"}, {"revision_id", "text"}, {"question_map", "json"},
	{"choice_map", "json"}, {"last_pulled_at", "date"}, {"last_pull_status", "text"},
	{"created", "autodate"}, {"updated", "autodate"},
}

var aidFormResponsesFields = []aidFormField{
	{"year", "number"}, {"form_id", "text"}, {"response_id", "text"},
	{"created_at_google", "text"}, {"last_submitted_at", "text"}, {"form_status", "select"},
	{"respondent_email", "text"}, {"name_typed", "text"}, {"birthdate_typed", "text"}, {"program_choice", "text"},
	{"program_key", "select"}, {"weekend_session_cm_id", "number"}, {"registered_session_cm_id", "number"},
	{"person_cm_id", "number"}, {"household_cm_id", "number"}, {"match_status", "select"},
	{"match_tier", "number"}, {"match_candidates", "json"}, {"superseded_by", "text"},
	{"linked_by", "text"}, {"linked_at", "date"}, {"ignored_reason", "text"},
	{"ask", "number"}, {"total_gross_income", "number"}, {"income_confirmed", "number"},
	{"total_adjusted_income", "number"}, {"expected_gross_income", "number"},
	{"total_housing_expenses", "number"}, {"non_retirement_savings", "number"}, {"total_rent", "number"},
	{"total_medical_expenses", "number"}, {"student_debt", "number"}, {"unemployment", "bool"},
	{"gov_subsidies", "bool"}, {"num_children", "number"}, {"special_circumstances", "text"},
	{"reported_income_fields", "json"}, {"parse_notes", "json"},
	{"poc", "text"}, {"race_ethnicity", "text"}, {"gender_identity", "text"},
	{"county", "text"}, {"signature_typed", "text"}, {"agreement_date", "text"},
	{"created", "autodate"}, {"updated", "autodate"},
}

func addAidFormFields(col *core.Collection, fields []aidFormField) {
	for _, f := range fields {
		switch f.kind {
		case "number":
			col.Fields.Add(&core.NumberField{Name: f.name})
		case "text":
			col.Fields.Add(&core.TextField{Name: f.name})
		case "json":
			col.Fields.Add(&core.JSONField{Name: f.name})
		case "date":
			col.Fields.Add(&core.DateField{Name: f.name})
		case "bool":
			col.Fields.Add(&core.BoolField{Name: f.name})
		case "autodate":
			col.Fields.Add(&core.AutodateField{Name: f.name, OnCreate: true, OnUpdate: f.name == "updated"})
		case "select":
			col.Fields.Add(&core.SelectField{Name: f.name, MaxSelect: 1, Values: aidFormSelectValues[f.name]})
		}
	}
}

var aidFormSelectValues = map[string][]string{
	"form_status": {"live", "deleted"},
	"program_key": {"family_camp", "adult_weekend"},
	"match_status": {"auto", "suggested", "staff", "unmatched", "registered_elsewhere", "not_registered",
		"ignored", "superseded"},
}

// TestAidGoogleFormFixtureMatchesTheMigration: the fixture's columns are the
// migration's columns, name for name and type for type, and every select
// carries the same values.
func TestAidGoogleFormFixtureMatchesTheMigration(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("../pb_migrations/1500000255_aid_google_form.js")
	if err != nil {
		t.Fatal(err)
	}
	up, _, ok := strings.Cut(string(raw), "}, (app) => {")
	if !ok {
		t.Fatal("no up/down boundary")
	}
	_, rest, ok := strings.Cut(up, `name: "aid_google_forms"`)
	if !ok {
		t.Fatal("no aid_google_forms collection")
	}
	formsPart, responsesPart, ok := strings.Cut(rest, `name: "aid_form_responses"`)
	if !ok {
		t.Fatal("no aid_form_responses collection")
	}
	fieldLine := regexp.MustCompile(`\{ type: "(\w+)", name: "(\w+)"[^\n]*`)
	valuesOf := regexp.MustCompile(`values: \[([^\]]*)\]`)
	check := func(name, part string, want []aidFormField) {
		var got []aidFormField
		for _, m := range fieldLine.FindAllStringSubmatch(part, -1) {
			got = append(got, aidFormField{m[2], m[1]})
			if m[1] == "select" {
				vm := valuesOf.FindStringSubmatch(m[0])
				if vm == nil {
					t.Errorf("%s.%s declares no values", name, m[2])
					continue
				}
				var vals []string
				for _, v := range strings.Split(vm[1], ",") {
					vals = append(vals, strings.Trim(strings.TrimSpace(v), `"`))
				}
				if !slices.Equal(vals, aidFormSelectValues[m[2]]) {
					t.Errorf("%s.%s values = %v, fixture %v", name, m[2], vals, aidFormSelectValues[m[2]])
				}
			}
		}
		if !slices.Equal(got, want) {
			t.Errorf("%s fields =\n%v\nfixture\n%v", name, got, want)
		}
	}
	check("aid_google_forms", formsPart, aidGoogleFormsFields)
	check("aid_form_responses", responsesPart, aidFormResponsesFields)
}

func newAidFormTestApp(t *testing.T) core.App {
	t.Helper()
	app := newSyncTestApp(t)
	sessions, err := app.FindCollectionByNameOrId("camp_sessions")
	if err != nil {
		t.Fatal(err)
	}
	sessions.Fields.Add(&core.NumberField{Name: "parent_id"})
	saveCollection(t, app, sessions)
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

	forms := core.NewBaseCollection("aid_google_forms")
	addAidFormFields(forms, aidGoogleFormsFields)
	saveCollection(t, app, forms)
	responses := core.NewBaseCollection("aid_form_responses")
	addAidFormFields(responses, aidFormResponsesFields)
	saveCollection(t, app, responses)
	return app
}

// seedAidFormWeekends creates the 2027 adult and family weekends, a 2026
// look-alike that must never be read, and the registrations.
func seedAidFormWeekends(t *testing.T, app core.App) {
	t.Helper()
	session := func(cmID int, name, kind, start string, parent int, year int) string {
		return saveRecord(t, app, "camp_sessions", map[string]any{
			"cm_id": cmID, "name": name, "session_type": kind, "start_date": start + " 07:00:00.000Z",
			"end_date": start + " 07:00:00.000Z", "parent_id": parent, "year": year,
		})
	}
	ids := map[int]string{
		gfFC1:        session(gfFC1, "Family Camp 1", "family", "2027-05-28", 0, gfYear),
		gfFC1Adults:  session(gfFC1Adults, "Adult Reg: Family Camp 1", "family_adult", "2027-06-04", gfFC1, gfYear),
		gfFC3a:       session(gfFC3a, "Family Camp 3", "family", "2027-08-26", 0, gfYear),
		gfFC3b:       session(gfFC3b, "Family Camp 3 (second)", "family", "2027-08-26", 0, gfYear),
		gfFC3aAdults: session(gfFC3aAdults, "Adult Reg: Family Camp 3", "family_adult", "2027-08-26", gfFC3a, gfYear),
		gfWW:         session(gfWW, "Women's Weekend", "adult", "2027-10-14", 0, gfYear),
	}
	// The 2026 Women's Weekend: same kind of session, a prior season. Never in a 2027 pool.
	old := session(1000901, "Women's Weekend", "adult", "2026-10-15", 0, 2026)

	person := func(cmID, household int, first, last, birth, email string, year int) string {
		return saveRecord(t, app, "persons", map[string]any{
			"cm_id": cmID, "household_id": household, "first_name": first, "last_name": last,
			"birthdate": birth, "primary_email": email, "year": year,
		})
	}
	register := func(pid string, cmID int, sessionPB string, status, year int) {
		saveRecord(t, app, "attendees", map[string]any{
			"person": pid, "person_id": cmID, "session": sessionPB, "status_id": status, "year": year,
		})
	}
	register(person(1000001, 2000001, "Rachel", "Garcia", "1971-04-02", "rgarcia@example.com", gfYear),
		1000001, ids[gfWW], 2, gfYear)
	register(person(1000002, 2000002, "Grace", "Chen-Whitfield", "1980-06-15", "grace@example.com", gfYear),
		1000002, ids[gfFC1Adults], 4, gfYear) // applied, in the Adult Reg session
	register(person(1000003, 2000003, "Emma", "Johnson", "1975-07-07", "emma@example.com", gfYear),
		1000003, ids[gfFC3aAdults], 2, gfYear)
	person(1000004, 2000004, "Liam", "Garcia", "1999-09-09", "liam@example.com", gfYear) // no registration
	register(person(1000005, 2000005, "Olivia", "Chen", "1985-03-09", "olivia@example.com", gfYear),
		1000005, ids[gfFC1], 3, gfYear) // cancelled: not in any pool
	// A 2026 person who matches a 2027 response perfectly, registered in 2026 only.
	register(person(1000006, 2000006, "Samuel", "Johnson", "1968-12-12", "sam@example.com", 2026),
		1000006, old, 2, 2026)
}

// The live form's questions (titles verbatim) under fictional ids.
var gfQuestionIDs = map[string]string{
	"agreement_date": "q00", "name_typed": "q01", "program_choice": "q02", "birthdate_typed": "q03", "ask": "q04",
	"total_gross_income": "q06", "income_confirmed": "q07", "total_adjusted_income": "q08",
	"expected_gross_income": "q09", "total_housing_expenses": "q10", "non_retirement_savings": "q11",
	"total_rent": "q12", "total_medical_expenses": "q13", "student_debt": "q14", "special_circumstances": "q16",
	"county": "q17", "unemployment": "q18", "gov_subsidies": "q19", "poc": "q20", "race_ethnicity": "q21",
	"num_children": "q22", "gender_identity": "q23", "signature_typed": "q24",
}

func gfDefinition() google.FormDefinition {
	q := func(id, title, kind string, required bool, options ...string) google.FormQuestion {
		return google.FormQuestion{QuestionID: id, Title: title, Kind: kind, Required: required, Options: options}
	}
	return google.FormDefinition{RevisionID: "00000031", Questions: []google.FormQuestion{
		q("q00", "Applicant Agreement Date", "date", true),
		q("q01", "Name (First and Last):", "text", true),
		q("q02", "Program", "choice", true, gfChoiceFC1, gfChoiceFC3, gfChoiceFC9, gfChoiceWW),
		q("q03", "Birthdate", "date", true),
		q("q04", "Amount of Assistance Requested", "text", true),
		q("q06", "Total 2026 Gross Pre-Tax Household Income:", "text", true),
		q("q07", "Confirm Total 2026 Gross Pre-Tax Household Income:", "text", true),
		q("q08", "Total 2026 Adjusted Gross Income", "text", true),
		q("q09", "Total 2027 Expected Pre-Tax Household Income:", "text", true),
		q("q10", "If you own a home, fill in how much your total 2027 mortgage expense is. If you do not own a home, please leave blank.", "text", false),
		q("q11", "Total 2027 Estimated Funds in savings and investment accounts (include all checking, savings, stocks, securities, mutual funds, crypto, etc.) Sept 2026 or most recent end quarter. Exclude IRAs and 401k/403b/457 retirement accounts.", "text", true),
		q("q12", "If rent a home, apartment, condo, etc., fill in how much your total 2027 rent expense is. If you do not rent a home, apartment, condo, etc., please leave blank.", "text", false),
		q("q13", "Total 2027 Expected Out of Pocket Medical Expenses (note - this also includes any expenses associated with outside services for children with special needs)", "text", true),
		q("q14", "Total 2027 Student Loan Repayment Expenses (note - this does NOT include any tuition or school fees you may pay)", "text", true),
		q("q16", "Please include anything in the space below that you think would be important for us to know about your family’s financial situation.", "paragraph", false),
		q("q17", "County", "text", true),
		q("q18", "Have you experienced unemployment within the last two years and/or are you currently unemployed?", "choice", true, "Yes", "No"),
		q("q19", "OPTIONAL - Is your family receiving any form of government subsidies such as SSI, food stamps, housing assistance, etc.?", "choice", false, "Yes", "No"),
		q("q20", "Do you identify as a person of color?", "choice", true, "Yes", "No", "Prefer not to answer"),
		q("q21", "What race/ethnicity best describes you?", "text", false),
		q("q22", "How many total children and/or dependents live in your household?", "text", true),
		q("q23", "Gender Identity", "choice", true, "Girl/woman", "Prefer not to answer"),
		q("q24", "Applicant Agreement Signature", "text", true),
	}}
}

// gfResponse builds a response from role -> typed answer, over a full set of clean defaults.
func gfResponse(id, submitted, email string, answers map[string]string) google.FormResponse {
	base := map[string]string{
		"agreement_date": "2026-11-05", "ask": "400", "total_gross_income": "80000", "income_confirmed": "80000",
		"total_adjusted_income": "76000", "expected_gross_income": "72000", "non_retirement_savings": "5000",
		"total_medical_expenses": "0", "student_debt": "0", "county": "Riverside County", "unemployment": "No",
		"poc": "Prefer not to answer", "num_children": "0", "gender_identity": "Girl/woman",
	}
	for k, v := range answers {
		base[k] = v
	}
	r := google.FormResponse{ResponseID: id, CreateTime: submitted, LastSubmittedTime: submitted,
		RespondentEmail: email, Answers: map[string][]string{}}
	for role, v := range base {
		if v != "" {
			r.Answers[gfQuestionIDs[role]] = []string{v}
		}
	}
	return r
}

func gfRachel() google.FormResponse {
	return gfResponse("resp-rachel", "2026-11-05T17:00:00.000Z", "rgarcia@example.com", map[string]string{
		"name_typed": "Rachel Garcia", "birthdate_typed": "1971-04-02", "program_choice": gfChoiceWW,
		"ask": "$400", "total_gross_income": "approx 85k", "income_confirmed": "85000",
		"total_adjusted_income": "80,000", "expected_gross_income": "$72,000", "non_retirement_savings": "12000",
		"total_rent": "$1,500/month", "total_medical_expenses": "none", "student_debt": "0",
		"special_circumstances": "A fictional note about the household.", "num_children": "two",
		"signature_typed": "Rachel Garcia",
	})
}

func gfGrace() google.FormResponse {
	return gfResponse("resp-grace", "2026-11-06T18:30:00.000Z", "partner@example.com", map[string]string{
		"name_typed": "Grace Whitfield", "birthdate_typed": "1980-06-15", "program_choice": gfChoiceFC1,
	})
}

type fakeGoogleForm struct {
	def      google.FormDefinition
	resp     []google.FormResponse
	defErr   error
	respErr  error
	gotForms []string
}

func (f *fakeGoogleForm) Form(_ context.Context, formID string) (google.FormDefinition, error) {
	f.gotForms = append(f.gotForms, formID)
	return f.def, f.defErr
}

func (f *fakeGoogleForm) Responses(_ context.Context, _ string) ([]google.FormResponse, error) {
	if f.respErr != nil {
		return nil, f.respErr
	}
	return slices.Clone(f.resp), nil
}

type gfRun struct {
	sync    *AidGoogleFormResponsesSync
	intakes []int
}

func runAidForm(t *testing.T, app core.App, fake *fakeGoogleForm) (*gfRun, error) {
	t.Helper()
	run := &gfRun{}
	s := NewAidGoogleFormResponsesSync(app)
	s.Year = gfYear
	s.Fetcher = fake
	s.FormIDs = func() (map[int]string, error) { return map[int]string{gfYear: gfFormID}, nil }
	s.PrimarySeason = func() (int, error) { return gfYear, nil }
	s.IntakeTrigger = func(_ context.Context, year int) error { run.intakes = append(run.intakes, year); return nil }
	run.sync = s
	err := s.Sync(context.Background())
	return run, err
}

func gfRow(t *testing.T, app core.App, responseID string) *core.Record {
	t.Helper()
	rec, err := app.FindFirstRecordByFilter("aid_form_responses", "response_id = {:id}", dbx.Params{"id": responseID})
	if err != nil {
		t.Fatalf("row %s: %v", responseID, err)
	}
	return rec
}

func gfFormRow(t *testing.T, app core.App) *core.Record {
	t.Helper()
	rec, err := app.FindFirstRecordByFilter("aid_google_forms", "year = {:y}", dbx.Params{"y": gfYear})
	if err != nil {
		t.Fatalf("form row: %v", err)
	}
	return rec
}

func gfJSON(t *testing.T, rec *core.Record, field string) string {
	t.Helper()
	return compactJSON(jsonFieldBytes(rec.Get(field)))
}

func TestAidFormPullStoresParsesAndMatches(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	run, err := runAidForm(t, app, &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel(), gfGrace()}})
	if err != nil {
		t.Fatal(err)
	}
	if st := run.sync.GetStats(); st.Created != 2 || st.Updated != 0 || st.Errors != 0 {
		t.Errorf("stats = %+v, want 2 created", st)
	}
	if !slices.Equal(run.intakes, []int{gfYear}) {
		t.Errorf("intake triggered for %v, want once for %d", run.intakes, gfYear)
	}

	r := gfRow(t, app, "resp-rachel")
	for field, want := range map[string]string{
		"form_id": gfFormID, "form_status": "live", "created_at_google": "2026-11-05T17:00:00.000Z",
		"last_submitted_at": "2026-11-05T17:00:00.000Z", "respondent_email": "rgarcia@example.com",
		"name_typed": "Rachel Garcia", "birthdate_typed": "1971-04-02", "program_choice": gfChoiceWW,
		"program_key": "adult_weekend", "match_status": "auto", "county": "Riverside County",
		"poc": "Prefer not to answer", "gender_identity": "Girl/woman", "signature_typed": "Rachel Garcia",
		"agreement_date": "2026-11-05", "special_circumstances": "A fictional note about the household.",
		"superseded_by": "",
	} {
		if got := r.GetString(field); got != want {
			t.Errorf("rachel.%s = %q, want %q", field, got, want)
		}
	}
	for field, want := range map[string]float64{
		"year": gfYear, "weekend_session_cm_id": gfWW, "registered_session_cm_id": gfWW, "person_cm_id": 1000001,
		"household_cm_id": 2000001, "match_tier": 3, "ask": 400, "total_gross_income": 85000,
		"income_confirmed": 85000, "total_adjusted_income": 80000, "expected_gross_income": 72000,
		"total_housing_expenses": 0, "non_retirement_savings": 12000, "total_rent": 18000,
		"total_medical_expenses": 0, "student_debt": 0, "num_children": 2,
	} {
		if got := r.GetFloat(field); got != want {
			t.Errorf("rachel.%s = %v, want %v", field, got, want)
		}
	}
	if r.GetBool("unemployment") || r.GetBool("gov_subsidies") {
		t.Error("rachel answered No / left subsidies blank")
	}
	if got := gfJSON(t, r, "reported_income_fields"); got !=
		`["expected_gross_income","income_confirmed","total_adjusted_income","total_gross_income"]` {
		t.Errorf("reported_income_fields = %s", got)
	}
	wantNotes := `{"gov_subsidies":{"typed":"","read":null,"note":"left blank"},` +
		`"total_gross_income":{"typed":"approx 85k","read":85000,"note":"read 'approx 85k' as $85,000"},` +
		`"total_rent":{"typed":"$1,500/month","read":18000,"note":"monthly: ×12 = $18,000"}}`
	if got := gfJSON(t, r, "parse_notes"); got != wantNotes {
		t.Errorf("parse_notes =\n%s\nwant\n%s", got, wantNotes)
	}
	if got := gfJSON(t, r, "match_candidates"); got !=
		`[{"person_cm_id":1000001,"household_cm_id":2000001,"signals":["name","birthdate","email"],"session_cm_ids":[1000201]}]` {
		t.Errorf("match_candidates = %s", got)
	}

	// Grace chose Family Camp 1 and is registered (applied) in its Adult Reg session:
	// the weekend is Family Camp 1, the registered session the Adult Reg one.
	g := gfRow(t, app, "resp-grace")
	if g.GetString("match_status") != "auto" || g.GetInt("person_cm_id") != 1000002 ||
		g.GetInt("weekend_session_cm_id") != gfFC1 || g.GetInt("registered_session_cm_id") != gfFC1Adults ||
		g.GetString("program_key") != "family_camp" || g.GetInt("match_tier") != 2 {
		t.Errorf("grace = status %s person %d weekend %d registered %d key %s tier %d",
			g.GetString("match_status"), g.GetInt("person_cm_id"), g.GetInt("weekend_session_cm_id"),
			g.GetInt("registered_session_cm_id"), g.GetString("program_key"), g.GetInt("match_tier"))
	}

	f := gfFormRow(t, app)
	if f.GetString("form_id") != gfFormID || f.GetString("revision_id") != "00000031" {
		t.Errorf("form row = %s %s", f.GetString("form_id"), f.GetString("revision_id"))
	}
	if !strings.HasPrefix(f.GetString("last_pull_status"), "ok · 2 responses · 2 linked · 0 to link") {
		t.Errorf("last_pull_status = %q", f.GetString("last_pull_status"))
	}
	if f.GetDateTime("last_pulled_at").IsZero() {
		t.Error("last_pulled_at not stamped")
	}
	var qm map[string]string
	if err := json.Unmarshal(jsonFieldBytes(f.Get("question_map")), &qm); err != nil || len(qm) != len(gfQuestionIDs) {
		t.Errorf("question_map = %v (%v)", qm, err)
	}
	var cm map[string]map[string]any
	if err := json.Unmarshal(jsonFieldBytes(f.Get("choice_map")), &cm); err != nil {
		t.Fatal(err)
	}
	if cm[gfChoiceFC1]["status"] != "mapped" || cm[gfChoiceFC1]["weekend_session_cm_id"] != float64(gfFC1) ||
		cm[gfChoiceWW]["weekend_session_cm_id"] != float64(gfWW) {
		t.Errorf("choice_map = %v", cm)
	}
	if got := cm[gfChoiceFC1]["session_cm_ids"]; !jsonInts(got, gfFC1, gfFC1Adults) {
		t.Errorf("FC1 session set = %v, want the weekend and its Adult Reg session", got)
	}
}

func jsonInts(v any, want ...int) bool {
	list, ok := v.([]any)
	if !ok || len(list) != len(want) {
		return false
	}
	for i, x := range list {
		if x != float64(want[i]) {
			return false
		}
	}
	return true
}

func TestAidFormSecondRunWritesNothing(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	fake := &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel(), gfGrace()}}
	if _, err := runAidForm(t, app, fake); err != nil {
		t.Fatal(err)
	}
	before := gfRow(t, app, "resp-rachel").GetDateTime("updated")
	run, err := runAidForm(t, app, fake)
	if err != nil {
		t.Fatal(err)
	}
	if st := run.sync.GetStats(); st.Created != 0 || st.Updated != 0 || st.Deleted != 0 || st.Skipped != 2 {
		t.Errorf("second run stats = %+v, want 2 skipped and nothing written", st)
	}
	if len(run.intakes) != 0 {
		t.Errorf("a 0-change run triggered intake: %v", run.intakes)
	}
	if after := gfRow(t, app, "resp-rachel").GetDateTime("updated"); !after.Equal(before) {
		t.Error("the unchanged row was rewritten")
	}
}

// GF-4: an edit keeps the responseId and moves last_submitted_at. It is
// re-parsed and re-matched, and created_at_google keeps the first submission,
// which is how PR 2 tells an edit.
func TestAidFormEditIsReparsedAndKeepsItsFirstSubmission(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	fake := &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel()}}
	if _, err := runAidForm(t, app, fake); err != nil {
		t.Fatal(err)
	}
	edited := gfRachel()
	edited.LastSubmittedTime = "2026-11-20T09:00:00.000Z"
	edited.Answers[gfQuestionIDs["total_gross_income"]] = []string{"88000"}
	fake.resp = []google.FormResponse{edited}
	run, err := runAidForm(t, app, fake)
	if err != nil {
		t.Fatal(err)
	}
	if st := run.sync.GetStats(); st.Updated != 1 || st.Created != 0 {
		t.Errorf("stats = %+v, want 1 updated", st)
	}
	r := gfRow(t, app, "resp-rachel")
	if r.GetString("created_at_google") != "2026-11-05T17:00:00.000Z" ||
		r.GetString("last_submitted_at") != "2026-11-20T09:00:00.000Z" || r.GetFloat("total_gross_income") != 88000 {
		t.Errorf("edit = created %s last %s gross %v", r.GetString("created_at_google"),
			r.GetString("last_submitted_at"), r.GetFloat("total_gross_income"))
	}
	if strings.Contains(gfJSON(t, r, "parse_notes"), "total_gross_income") {
		t.Errorf("a cleanly read figure kept its old note: %s", gfJSON(t, r, "parse_notes"))
	}
	if !slices.Equal(run.intakes, []int{gfYear}) {
		t.Errorf("intakes = %v", run.intakes)
	}
}

// A staff link or ignore is never undone by a pull: the answers refresh, the
// match stays exactly as staff left it.
func TestAidFormNeverRematchesStaffOrIgnoredRows(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	fake := &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel(), gfGrace()}}
	if _, err := runAidForm(t, app, fake); err != nil {
		t.Fatal(err)
	}
	for id, status := range map[string]string{"resp-rachel": "staff", "resp-grace": "ignored"} {
		r := gfRow(t, app, id)
		r.Set("match_status", status)
		r.Set("person_cm_id", 1000004)
		r.Set("household_cm_id", 2000004)
		r.Set("match_tier", 0)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	rachel := gfRachel()
	rachel.LastSubmittedTime = "2026-11-21T09:00:00.000Z"
	rachel.Answers[gfQuestionIDs["ask"]] = []string{"500"}
	fake.resp = []google.FormResponse{rachel, gfGrace()}
	if _, err := runAidForm(t, app, fake); err != nil {
		t.Fatal(err)
	}
	for id, status := range map[string]string{"resp-rachel": "staff", "resp-grace": "ignored"} {
		r := gfRow(t, app, id)
		if r.GetString("match_status") != status || r.GetInt("person_cm_id") != 1000004 ||
			r.GetInt("household_cm_id") != 2000004 {
			t.Errorf("%s re-matched: %s %d", id, r.GetString("match_status"), r.GetInt("person_cm_id"))
		}
	}
	if gfRow(t, app, "resp-rachel").GetFloat("ask") != 500 {
		t.Error("the staff-linked row's answers did not refresh")
	}
}

// A response Google no longer returns is marked deleted, never removed.
func TestAidFormMarksAVanishedResponseDeleted(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	fake := &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel(), gfGrace()}}
	if _, err := runAidForm(t, app, fake); err != nil {
		t.Fatal(err)
	}
	fake.resp = []google.FormResponse{gfRachel()}
	run, err := runAidForm(t, app, fake)
	if err != nil {
		t.Fatal(err)
	}
	if st := run.sync.GetStats(); st.Deleted != 1 || st.Updated != 0 {
		t.Errorf("stats = %+v, want 1 deleted", st)
	}
	g := gfRow(t, app, "resp-grace")
	if g.GetString("form_status") != "deleted" || g.GetInt("person_cm_id") != 1000002 {
		t.Errorf("grace = %s %d, want deleted with the match kept", g.GetString("form_status"), g.GetInt("person_cm_id"))
	}
	if !slices.Equal(run.intakes, []int{gfYear}) {
		t.Errorf("a delete must trigger intake: %v", run.intakes)
	}
	// It comes back if Google returns it again.
	fake.resp = []google.FormResponse{gfRachel(), gfGrace()}
	if _, err := runAidForm(t, app, fake); err != nil {
		t.Fatal(err)
	}
	if gfRow(t, app, "resp-grace").GetString("form_status") != "live" {
		t.Error("a returned response stayed deleted")
	}
}

func gfFiller(n int) []google.FormResponse {
	var out []google.FormResponse
	for i := range n {
		out = append(out, gfResponse("resp-fill-"+string(rune('a'+i)), "2026-11-07T10:00:00.000Z", "", map[string]string{
			"name_typed": "Riley Sam", "birthdate_typed": "1990-01-0" + string(rune('1'+i)), "program_choice": gfChoiceWW,
		}))
	}
	return out
}

// The mass-vanish guard: "Delete all responses", a permissions change or a
// repointed form id must not mark every row deleted.
func TestAidFormMassVanishGuardRefusesDeletes(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	fake := &fakeGoogleForm{def: gfDefinition(), resp: gfFiller(6)}
	if _, err := runAidForm(t, app, fake); err != nil {
		t.Fatal(err)
	}
	fake.resp = gfFiller(2) // 4 of 6 missing: fewer than half remain
	run, err := runAidForm(t, app, fake)
	if err != nil {
		t.Fatal(err)
	}
	if st := run.sync.GetStats(); st.Deleted != 0 {
		t.Errorf("guard wrote %d deletes", st.Deleted)
	}
	live, err := app.CountRecords("aid_form_responses", dbx.HashExp{"form_status": "live"})
	if err != nil || live != 6 {
		t.Errorf("live rows = %d (%v), want 6", live, err)
	}
	if got := gfFormRow(t, app).GetString("last_pull_status"); !strings.HasPrefix(got, "refused: 4 of 6 responses missing") {
		t.Errorf("last_pull_status = %q", got)
	}

	// Zero responses back, even with fewer than 5 rows, is refused too.
	app2 := newAidFormTestApp(t)
	seedAidFormWeekends(t, app2)
	fake2 := &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel()}}
	if _, err := runAidForm(t, app2, fake2); err != nil {
		t.Fatal(err)
	}
	fake2.resp = nil
	run, err = runAidForm(t, app2, fake2)
	if err != nil {
		t.Fatal(err)
	}
	if run.sync.GetStats().Deleted != 0 || gfRow(t, app2, "resp-rachel").GetString("form_status") != "live" {
		t.Error("an empty pull marked the row deleted")
	}
	if got := gfFormRow(t, app2).GetString("last_pull_status"); !strings.HasPrefix(got, "refused: 1 of 1 responses missing") {
		t.Errorf("last_pull_status = %q", got)
	}
}

// A form that lost a required question writes nothing and says why.
func TestAidFormMissingRequiredQuestionWritesNothing(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	def := gfDefinition()
	def.Questions = slices.DeleteFunc(def.Questions, func(q google.FormQuestion) bool { return q.QuestionID == "q04" })
	run, err := runAidForm(t, app, &fakeGoogleForm{def: def, resp: []google.FormResponse{gfRachel()}})
	if err == nil {
		t.Fatal("want an error naming the missing question")
	}
	if n, _ := app.CountRecords("aid_form_responses"); n != 0 {
		t.Errorf("%d rows written", n)
	}
	if st := run.sync.GetStats(); st.Created != 0 || st.Errors != 1 {
		t.Errorf("stats = %+v", st)
	}
	if got := gfFormRow(t, app).GetString("last_pull_status"); !strings.Contains(got, "ask") ||
		!strings.HasPrefix(got, "error: ") {
		t.Errorf("last_pull_status = %q, want the missing role named", got)
	}
	if len(run.intakes) != 0 {
		t.Error("a refused pull triggered intake")
	}
}

func TestAidFormFetchErrorWritesNothing(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	if _, err := runAidForm(t, app, &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel()}}); err != nil {
		t.Fatal(err)
	}
	for _, fake := range []*fakeGoogleForm{
		{defErr: errors.New("403"), resp: nil},
		{def: gfDefinition(), respErr: errors.New("quota")},
	} {
		run, err := runAidForm(t, app, fake)
		if err == nil {
			t.Error("want the fetch error")
		}
		if run.sync.GetStats().Deleted != 0 || gfRow(t, app, "resp-rachel").GetString("form_status") != "live" {
			t.Error("a failed fetch marked rows deleted")
		}
	}
}

// Unmapped and unclear choices (§6): the row still lands; the weekend is 0
// unless registration decides; the status line names the choice.
func TestAidFormChoiceMapping(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	unmapped := gfResponse("resp-fc9", "2026-11-08T10:00:00.000Z", "liam@example.com", map[string]string{
		"name_typed": "Liam Garcia", "birthdate_typed": "1999-09-09", "program_choice": gfChoiceFC9,
	})
	// Emma is registered in exactly one of the two sessions starting Aug 26 (via its Adult Reg).
	unclearDecided := gfResponse("resp-emma", "2026-11-08T11:00:00.000Z", "emma@example.com", map[string]string{
		"name_typed": "Emma Johnson", "birthdate_typed": "1975-07-07", "program_choice": gfChoiceFC3,
	})
	// Nobody registered: the weekend stays unclear.
	unclearOpen := gfResponse("resp-fc3-open", "2026-11-08T12:00:00.000Z", "liam@example.com", map[string]string{
		"name_typed": "Liam Garcia", "birthdate_typed": "1999-09-09", "program_choice": gfChoiceFC3,
	})
	if _, err := runAidForm(t, app, &fakeGoogleForm{def: gfDefinition(),
		resp: []google.FormResponse{unmapped, unclearDecided, unclearOpen}}); err != nil {
		t.Fatal(err)
	}
	u := gfRow(t, app, "resp-fc9")
	if u.GetString("program_key") != "family_camp" || u.GetInt("weekend_session_cm_id") != 0 ||
		u.GetString("match_status") != "unmatched" {
		t.Errorf("unmapped = %s %d %s", u.GetString("program_key"), u.GetInt("weekend_session_cm_id"),
			u.GetString("match_status"))
	}
	e := gfRow(t, app, "resp-emma")
	if e.GetString("match_status") != "auto" || e.GetInt("weekend_session_cm_id") != gfFC3a ||
		e.GetInt("registered_session_cm_id") != gfFC3aAdults {
		t.Errorf("unclear, decided by registration = %s weekend %d registered %d", e.GetString("match_status"),
			e.GetInt("weekend_session_cm_id"), e.GetInt("registered_session_cm_id"))
	}
	o := gfRow(t, app, "resp-fc3-open")
	if o.GetInt("weekend_session_cm_id") != 0 || o.GetString("match_status") != "not_registered" {
		t.Errorf("unclear, undecided = weekend %d %s", o.GetInt("weekend_session_cm_id"), o.GetString("match_status"))
	}
	status := gfFormRow(t, app).GetString("last_pull_status")
	for _, want := range []string{
		"choice '" + gfChoiceFC9 + "' matches no 2027 session",
		"choice '" + gfChoiceFC3 + "' matches 2 2027 sessions",
	} {
		if !strings.Contains(status, want) {
			t.Errorf("last_pull_status %q lacks %q", status, want)
		}
	}
}

// Several responses from one person for one weekend: the newest wins, the
// older is superseded and points at it. A different weekend is its own row.
func TestAidFormNewestResponseSupersedesOlderOnes(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	older := gfRachel()
	older.ResponseID, older.CreateTime, older.LastSubmittedTime = "resp-rachel-old", "2026-11-01T08:00:00Z", "2026-11-01T08:00:00Z"
	if _, err := runAidForm(t, app, &fakeGoogleForm{def: gfDefinition(),
		resp: []google.FormResponse{older, gfRachel()}}); err != nil {
		t.Fatal(err)
	}
	old := gfRow(t, app, "resp-rachel-old")
	if old.GetString("match_status") != "superseded" || old.GetString("superseded_by") != "resp-rachel" ||
		old.GetInt("person_cm_id") != 1000001 {
		t.Errorf("older = %s by %q person %d", old.GetString("match_status"), old.GetString("superseded_by"),
			old.GetInt("person_cm_id"))
	}
	if gfRow(t, app, "resp-rachel").GetString("match_status") != "auto" {
		t.Error("the newest response is not the live match")
	}
}

// Registered elsewhere and not registered (§5), at the job level; a 2026
// registration never counts.
func TestAidFormRegisteredElsewhereAndNotRegistered(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	elsewhere := gfResponse("resp-elsewhere", "2026-11-09T10:00:00.000Z", "emma@example.com", map[string]string{
		"name_typed": "Emma Johnson", "birthdate_typed": "1975-07-07", "program_choice": gfChoiceWW,
	})
	lastYear := gfResponse("resp-2026-only", "2026-11-09T11:00:00.000Z", "sam@example.com", map[string]string{
		"name_typed": "Samuel Johnson", "birthdate_typed": "1968-12-12", "program_choice": gfChoiceWW,
	})
	if _, err := runAidForm(t, app, &fakeGoogleForm{def: gfDefinition(),
		resp: []google.FormResponse{elsewhere, lastYear}}); err != nil {
		t.Fatal(err)
	}
	e := gfRow(t, app, "resp-elsewhere")
	if e.GetString("match_status") != "registered_elsewhere" || e.GetInt("person_cm_id") != 0 ||
		!strings.Contains(gfJSON(t, e, "match_candidates"), `"person_cm_id":1000003`) {
		t.Errorf("elsewhere = %s %d %s", e.GetString("match_status"), e.GetInt("person_cm_id"),
			gfJSON(t, e, "match_candidates"))
	}
	if got := gfRow(t, app, "resp-2026-only").GetString("match_status"); got != "not_registered" {
		t.Errorf("a 2026-only person = %s, want not_registered", got)
	}
}

// 2026 is frozen: the job runs only for a season AID_GOOGLE_FORM_IDS names, and
// only when that season is the primary -- never in the N-1 pass.
func TestAidFormRunsOnlyForTheConfiguredPrimarySeason(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		year    int
		primary int
		ids     map[int]string
	}{
		{"prior season, not configured", 2026, 2027, map[int]string{2027: gfFormID}},
		{"configured but not the primary", 2027, 2028, map[int]string{2027: gfFormID}},
		{"nothing configured", 2027, 2027, map[int]string{}},
	}
	for _, tc := range cases {
		app := newAidFormTestApp(t)
		fake := &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel()}}
		s := NewAidGoogleFormResponsesSync(app)
		s.Year, s.Fetcher = tc.year, fake
		s.FormIDs = func() (map[int]string, error) { return tc.ids, nil }
		s.PrimarySeason = func() (int, error) { return tc.primary, nil }
		triggered := false
		s.IntakeTrigger = func(context.Context, int) error { triggered = true; return nil }
		if err := s.Sync(context.Background()); err != nil {
			t.Errorf("%s: %v", tc.name, err)
		}
		if len(fake.gotForms) != 0 || triggered {
			t.Errorf("%s: the form was read (%v) or intake triggered (%v)", tc.name, fake.gotForms, triggered)
		}
		if n, _ := app.CountRecords("aid_google_forms"); n != 0 {
			t.Errorf("%s: wrote a form row", tc.name)
		}
	}
}

func TestAidFormIntakeFailureCountsAsAnError(t *testing.T) {
	t.Parallel()
	app := newAidFormTestApp(t)
	seedAidFormWeekends(t, app)
	s := NewAidGoogleFormResponsesSync(app)
	s.Year, s.Fetcher = gfYear, &fakeGoogleForm{def: gfDefinition(), resp: []google.FormResponse{gfRachel()}}
	s.FormIDs = func() (map[int]string, error) { return map[int]string{gfYear: gfFormID}, nil }
	s.PrimarySeason = func() (int, error) { return gfYear, nil }
	s.IntakeTrigger = func(context.Context, int) error { return errors.New("api down") }
	if err := s.Sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	if st := s.GetStats(); st.Created != 1 || st.Errors != 1 {
		t.Errorf("stats = %+v, want the row written and the intake failure counted", st)
	}
}

func TestParseAidGoogleFormIDs(t *testing.T) {
	t.Parallel()
	cases := []struct {
		raw     string
		want    map[int]string
		wantErr bool
	}{
		{"", map[int]string{}, false},
		{"2027:abc_DEF-123", map[int]string{2027: "abc_DEF-123"}, false},
		{" 2027:aaa , 2028:bbb ", map[int]string{2027: "aaa", 2028: "bbb"}, false},
		{"2027:aaa;2028:bbb", map[int]string{2027: "aaa", 2028: "bbb"}, false},
		{"2027", nil, true},
		{"2027:", nil, true},
		{"27:aaa", nil, true},
		{"2027:aaa,2027:bbb", nil, true},
		{"2027:has space", nil, true},
		{"2027:https://example.com/x", nil, true},
	}
	for _, tc := range cases {
		got, err := ParseAidGoogleFormIDs(tc.raw)
		if (err != nil) != tc.wantErr {
			t.Errorf("ParseAidGoogleFormIDs(%q) error = %v, wantErr %v", tc.raw, err, tc.wantErr)
			continue
		}
		if err == nil && len(got) != len(tc.want) {
			t.Errorf("ParseAidGoogleFormIDs(%q) = %v, want %v", tc.raw, got, tc.want)
		}
		for y, id := range tc.want {
			if got[y] != id {
				t.Errorf("ParseAidGoogleFormIDs(%q)[%d] = %q, want %q", tc.raw, y, got[y], id)
			}
		}
	}
}

// Owner ruling 10-29: a choice maps to its weekend by the Family Camp NUMBER
// (or, for a weekend without one, by NAME), never by date. The date in the
// label only cross-checks: a disagreement is noted, the mapping stands. Shaped
// like D6: an Adult Reg session carrying the following weekend's start date.
func TestAidFormChoicesMapByNumberOrNameNotDate(t *testing.T) {
	t.Parallel()
	const (
		fc5, fc6, ar5, ar6, pfw, ww, ww2 = 1000305, 1000306, 1000315, 1000316, 1000307, 1000308, 1000309
	)
	roster := &aidFormRoster{sessions: []aidFormSession{
		{cmID: fc5, name: "Family Camp 5", kind: sessionTypeFamily, startDate: "2027-09-09"},
		{cmID: fc6, name: "Family Camp 6", kind: sessionTypeFamily, startDate: "2027-09-16"},
		{cmID: ar5, name: "Adult Reg: Family Camp 5", kind: sessionTypeFamilyAdult, startDate: "2027-09-16", parentID: fc5},
		{cmID: ar6, name: "Adult Reg: Family Camp 6", kind: sessionTypeFamilyAdult, startDate: "2027-09-16", parentID: fc6},
		{cmID: pfw, name: "Prospective Families Weekend", kind: sessionTypeFamily, startDate: "2027-09-24"},
		{cmID: ww, name: "Women's Weekend", kind: sessionTypeAdult, startDate: "2027-10-14"},
		// Starts the same day as Family Camp 6: a date match would make FC6 unclear.
		{cmID: ww2, name: "Mystery Weekend", kind: sessionTypeFamily, startDate: "2027-09-16"},
	}}
	fc5Label := "Family Camp 5: Jewish Families of Color Weekend (September 9 - 12)"
	fc6Label := "Family Camp 6 (September 16 - 19)"
	moved := "Family Camp 6 (September 23 - 26)" // the label's date disagrees with FC6's start
	pfwLabel := "Prospective Families Weekend (September 24 - 26)"
	wwLabel := "Women's Weekend (October 14 - 17)"
	noName := "Fall Gathering (September 9 - 12)" // FC5's date, but no number and no name match
	got := mapAidFormChoices([]string{fc5Label, fc6Label, moved, pfwLabel, wwLabel, noName}, 2027, roster)

	check := func(label string, weekend int, set []int, mismatch bool) {
		t.Helper()
		c := got[label]
		if c.Status != aidChoiceMapped || c.WeekendSessionCMID != weekend || !slices.Equal(c.SessionCMIDs, set) ||
			c.DateMismatch != mismatch {
			t.Errorf("%q = %+v, want weekend %d set %v mismatch %v", label, c, weekend, set, mismatch)
		}
	}
	check(fc5Label, fc5, []int{fc5, ar5}, false)
	check(fc6Label, fc6, []int{fc6, ar6}, false)
	check(moved, fc6, []int{fc6, ar6}, true)
	check(pfwLabel, pfw, []int{pfw}, false)
	check(wwLabel, ww, []int{ww}, false)
	if c := got[noName]; c.Status != aidChoiceUnmapped || c.WeekendSessionCMID != 0 {
		t.Errorf("a date alone mapped %q: %+v", noName, c)
	}

	status := aidFormPullStatus(&aidFormPull{year: 2027, choices: got})
	if want := "choice '" + moved + "' says 2027-09-23, but session 1000306 starts 2027-09-16"; !strings.Contains(status, want) {
		t.Errorf("status %q lacks the cross-check note %q", status, want)
	}
	if strings.Contains(status, fc6Label+"' says") {
		t.Errorf("a matching date was flagged: %q", status)
	}
}
