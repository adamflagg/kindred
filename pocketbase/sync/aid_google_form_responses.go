package sync

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/camp/kindred/pocketbase/aidform"
	"github.com/camp/kindred/pocketbase/google"
	"github.com/camp/kindred/pocketbase/jotform"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The adult aid Google Form ingest, PR 1 of the adult-aid form design: from
// 2027, adult-only Family Camp attendees and adult-weekend guests ask for aid
// on a Google Form instead of CampMinder's. This job reads that form into a
// locked mirror (aid_google_forms, aid_form_responses) and matches each
// response to a 2027 person. Nothing reads the mirror yet: requests come in
// PR 2. No CampMinder call is made anywhere here.

const (
	serviceNameAidGoogleFormResponses = "aid_google_form_responses"
	// envAidGoogleFormIDs names each season's form: "2027:<formId>", several
	// comma-separated. The id lives ONLY here, in the private .env: a migration
	// is public, and the form is the camp's live aid form.
	envAidGoogleFormIDs = "AID_GOOGLE_FORM_IDS"

	aidFormStatusLive      = "live"
	aidFormStatusDeleted   = "deleted"
	aidFormMatchStaff      = "staff"
	aidFormMatchIgnored    = "ignored"
	aidFormMatchSuperseded = "superseded"

	// The mass-vanish guard (design §3.4), copied from Jotform's wrong-guess
	// guard: with at least this many live rows, a pull returning fewer than
	// half of them marks nothing deleted.
	aidFormVanishGuardMin = 5
	aidFormPullStatusMax  = 2000
)

// aidFormRegisteredStatuses are the attendee statuses that count as a 2027
// registration for matching: enrolled, applied, waitlisted, incomplete.
var aidFormRegisteredStatuses = []int{2, 4, 8, 512}

// aidGoogleFormConfigured gates the hourly pull: Google must be enabled and a
// form named. Dev, CI and a fresh stack skip it.
func aidGoogleFormConfigured() bool {
	return google.IsEnabled() && strings.TrimSpace(os.Getenv(envAidGoogleFormIDs)) != ""
}

var aidFormIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ParseAidGoogleFormIDs reads AID_GOOGLE_FORM_IDS: "YEAR:formId" entries
// separated by commas, semicolons or spaces. A malformed entry or a year named
// twice is an error, never a guess. The error never quotes an id.
func ParseAidGoogleFormIDs(raw string) (map[int]string, error) {
	out := map[int]string{}
	for _, entry := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' || r == ' ' }) {
		yearText, id, ok := strings.Cut(strings.TrimSpace(entry), ":")
		year, err := strconv.Atoi(yearText)
		if !ok || err != nil || !ValidSyncYear(year) || len(yearText) != 4 {
			return nil, fmt.Errorf("%s: an entry is not YEAR:formId", envAidGoogleFormIDs)
		}
		if !aidFormIDPattern.MatchString(id) {
			return nil, fmt.Errorf("%s: the %d form id is not a Google form id", envAidGoogleFormIDs, year)
		}
		if _, dup := out[year]; dup {
			return nil, fmt.Errorf("%s names %d twice", envAidGoogleFormIDs, year)
		}
		out[year] = id
	}
	return out, nil
}

func aidGoogleFormIDsFromEnv() (map[int]string, error) {
	return ParseAidGoogleFormIDs(os.Getenv(envAidGoogleFormIDs))
}

// GoogleFormFetcher is the slice of the Forms client this job uses; tests fake it.
type GoogleFormFetcher interface {
	Form(ctx context.Context, formID string) (google.FormDefinition, error)
	Responses(ctx context.Context, formID string) ([]google.FormResponse, error)
}

// AidGoogleFormResponsesSync pulls the season's adult aid Google Form.
//
// Each run reads the definition (question map by normalised title, choice map
// by the date in each program label) and every response, upserts one row per
// responseId, marks a response Google no longer returns `deleted` (behind the
// mass-vanish guard), and matches each live row to a 2027 person (GF-1 = A).
// Rows staff linked or ignored are never re-matched; their answers still
// refresh. An unchanged pull writes nothing and does not trigger intake.
//
// It runs only for a season AID_GOOGLE_FORM_IDS names, and only when that
// season is the primary: 2026 has no form and stays untouched, and the hourly
// queue's N-1 pass finds nothing to do.
type AidGoogleFormResponsesSync struct {
	App        core.App
	Fetcher    GoogleFormFetcher
	NewFetcher func(ctx context.Context) (GoogleFormFetcher, error)
	// FormIDs and PrimarySeason default to the environment and the season
	// rule; tests set them.
	FormIDs       func() (map[int]string, error)
	PrimarySeason func() (int, error)
	// IntakeTrigger rebuilds campership intake after a run that changed a
	// row (TriggerFinancialAidIntake in production; nil in tests by default).
	IntakeTrigger func(ctx context.Context, year int) error
	Year          int
	Debug         bool
	Stats         Stats
}

// NewAidGoogleFormResponsesSync builds the job with the service-account client.
func NewAidGoogleFormResponsesSync(app core.App) *AidGoogleFormResponsesSync {
	return &AidGoogleFormResponsesSync{
		App: app,
		NewFetcher: func(ctx context.Context) (GoogleFormFetcher, error) {
			client, err := google.NewFormsClient(ctx)
			if err != nil {
				return nil, fmt.Errorf("configuring the Google Forms client: %w", err)
			}
			// Never return a nil *FormsClient inside a non-nil interface.
			if client == nil {
				return nil, errors.New("google is not enabled (GOOGLE_SHEETS_ENABLED)")
			}
			return client, nil
		},
		FormIDs:       aidGoogleFormIDsFromEnv,
		PrimarySeason: ParseSeasonYear,
	}
}

// GetStats returns the last run's stats.
func (s *AidGoogleFormResponsesSync) GetStats() Stats { return s.Stats }

// SetDebug toggles debug logging.
func (s *AidGoogleFormResponsesSync) SetDebug(debug bool) { s.Debug = debug }

// Sync runs one pull for the season.
func (s *AidGoogleFormResponsesSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	primary, err := s.PrimarySeason()
	if err != nil {
		return err
	}
	year := s.Year
	if year == 0 {
		year = primary
	}
	if year != primary {
		slog.Info("Adult aid form pull skipped: not the primary season", "year", year, "primary", primary)
		return nil
	}
	ids, err := s.FormIDs()
	if err != nil {
		return err
	}
	formID, ok := ids[year]
	if !ok {
		slog.Info("Adult aid form pull skipped: no form configured for the season", "year", year)
		return nil
	}
	fetcher := s.Fetcher
	if fetcher == nil {
		f, err := s.NewFetcher(ctx)
		if err != nil {
			return err
		}
		fetcher = f
	}

	pullErr := s.pull(ctx, fetcher, year, formID)
	if pullErr != nil {
		s.Stats.Errors++
		s.recordForm(year, formID, nil, "error: "+pullErr.Error())
	}
	if s.Stats.Created+s.Stats.Updated+s.Stats.Deleted > 0 {
		if _, cpErr := s.App.DB().NewQuery("PRAGMA wal_checkpoint(FULL)").Execute(); cpErr != nil {
			slog.Warn("WAL checkpoint after the adult aid form pull failed", "error", cpErr)
		}
		s.runIntakeTrigger(ctx, year)
	}
	slog.Info("Adult aid form pull complete", "year", year, "created", s.Stats.Created,
		"updated", s.Stats.Updated, "skipped", s.Stats.Skipped, "deleted", s.Stats.Deleted, "errors", s.Stats.Errors)
	return pullErr
}

// runIntakeTrigger rebuilds intake after a run that changed something. A
// failure does not fail the mirror, which did write; it is counted and logged.
func (s *AidGoogleFormResponsesSync) runIntakeTrigger(ctx context.Context, year int) {
	if s.IntakeTrigger == nil {
		return
	}
	if err := s.IntakeTrigger(ctx, year); err != nil {
		s.Stats.Errors++
		slog.Error("Financial-aid intake rebuild failed after the adult aid form pull wrote", "year", year, "error", err)
	}
}

// aidFormPull is one pull's decided state, before anything is written.
type aidFormPull struct {
	year      int
	formID    string
	revision  string
	qm        aidform.QuestionMap
	choices   map[string]aidFormChoice
	roster    *aidFormRoster
	rows      []*aidFormRow
	refused   string // the guard's refusal, "" when deletes are allowed
	problems  []string
	responses int
}

// aidFormRow is one response row: the stored record (nil for a new response),
// the fields this pull wants it to hold, and how the match was decided.
type aidFormRow struct {
	responseID string
	rec        *core.Record
	// parsed is the response's parse-owned fields; nil when Google did not
	// return it this pull (its stored answers stand).
	parsed  map[string]any
	deleted bool // to be marked deleted this pull
	match   map[string]any
	// What matching reads, from parsed or the stored record.
	identity      aidform.Identity
	choice        string
	lastSubmitted string
	staffOwned    bool
}

func (r *aidFormRow) get(field string) any {
	if r.parsed != nil {
		if v, ok := r.parsed[field]; ok {
			return v
		}
	}
	if r.rec != nil {
		return r.rec.Get(field)
	}
	return nil
}

func (s *AidGoogleFormResponsesSync) pull(ctx context.Context, fetcher GoogleFormFetcher, year int, formID string) error {
	// The definition and every response first: a failure writes nothing.
	def, err := fetcher.Form(ctx, formID)
	if err != nil {
		return fmt.Errorf("reading the form: %w", err)
	}
	responses, err := fetcher.Responses(ctx, formID)
	if err != nil {
		return fmt.Errorf("reading the responses: %w", err)
	}
	questions := make([]aidform.Question, 0, len(def.Questions))
	for _, q := range def.Questions {
		questions = append(questions, aidform.Question{
			QuestionID: q.QuestionID, Title: q.Title, Kind: q.Kind, Required: q.Required, Options: q.Options,
		})
	}
	qm, problems := aidform.MapQuestions(questions)
	if missing := aidform.MissingRequired(qm); len(missing) > 0 {
		msg := "refused: the form has no single question for " + strings.Join(missing, ", ")
		if len(problems) > 0 {
			msg += " (" + strings.Join(problems, "; ") + ")"
		}
		return errors.New(msg)
	}

	p := &aidFormPull{
		year: year, formID: formID, revision: def.RevisionID, qm: qm, problems: problems, responses: len(responses),
	}
	if p.roster, err = loadAidFormRoster(s.App, year); err != nil {
		return err
	}
	existing, err := findAllRecords(s.App, "aid_form_responses", "year = {:year}", dbx.Params{"year": year})
	if err != nil {
		return fmt.Errorf("loading stored responses: %w", err)
	}
	stored, err := s.storedChoiceLabels(year)
	if err != nil {
		return err
	}
	labels := slices.Clone(stored)
	for _, q := range questions {
		if q.QuestionID == qm[aidform.RoleProgram] {
			labels = append(labels, q.Options...)
		}
	}
	for i := range responses {
		labels = append(labels, responses[i].Answer(qm[aidform.RoleProgram]))
	}
	for _, rec := range existing {
		labels = append(labels, rec.GetString("program_choice"))
	}
	p.choices = mapAidFormChoices(labels, year, p.roster)

	p.rows = s.planRows(p, responses, existing)
	planAidFormMatches(p)
	if err := s.writeRows(p); err != nil {
		return err
	}
	s.recordForm(year, formID, p, aidFormPullStatus(p))
	return nil
}

// planRows builds every row's parsed state and applies the mass-vanish guard.
func (s *AidGoogleFormResponsesSync) planRows(
	p *aidFormPull, responses []google.FormResponse, existing []*core.Record,
) []*aidFormRow {
	byID := make(map[string]*core.Record, len(existing))
	for _, rec := range existing {
		byID[rec.GetString("response_id")] = rec
	}
	seen := make(map[string]bool, len(responses))
	var rows []*aidFormRow
	for i := range responses {
		r := &responses[i]
		if r.ResponseID == "" || seen[r.ResponseID] {
			continue
		}
		seen[r.ResponseID] = true
		parsed := parseAidFormResponse(r, p.qm, p.year, p.formID)
		parsed["program_key"] = ""
		if choice := parsed["program_choice"].(string); choice != "" {
			parsed["program_key"] = aidform.ChoiceBucket(choice)
		}
		rows = append(rows, &aidFormRow{responseID: r.ResponseID, rec: byID[r.ResponseID], parsed: parsed})
	}

	var missing []*aidFormRow
	live := 0
	for _, rec := range existing {
		if rec.GetString("form_status") != aidFormStatusLive {
			continue
		}
		live++
		if !seen[rec.GetString("response_id")] {
			missing = append(missing, &aidFormRow{responseID: rec.GetString("response_id"), rec: rec})
		}
	}
	if len(missing) > 0 && (len(responses) == 0 || live >= aidFormVanishGuardMin && (live-len(missing))*2 < live) {
		p.refused = fmt.Sprintf("refused: %d of %d responses missing", len(missing), live)
		slog.Warn("Adult aid form pull: deletes refused by the mass-vanish guard",
			"missing", len(missing), "live", live, "returned", len(responses))
	} else {
		for _, row := range missing {
			row.deleted = true
		}
	}
	rows = append(rows, missing...)

	for _, row := range rows {
		row.identity = aidform.Identity{
			Name: stringOf(row.get("name_typed")), Birthdate: stringOf(row.get("birthdate_typed")),
			Email: stringOf(row.get("respondent_email")),
		}
		row.choice = stringOf(row.get("program_choice"))
		row.lastSubmitted = stringOf(row.get("last_submitted_at"))
		if row.rec != nil {
			switch row.rec.GetString("match_status") {
			case aidFormMatchStaff, aidFormMatchIgnored:
				row.staffOwned = true
			}
		}
	}
	return rows
}

func stringOf(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return ""
	default:
		return fmt.Sprint(x)
	}
}

// The text columns' maxima, as the migration declares them. A longer answer is
// cut (with a note for the narrative) so a save is never refused.
var aidFormTextMax = map[string]int{
	"respondent_email": 320, "name_typed": 300, "birthdate_typed": 50, "program_choice": 500,
	"agreement_date": 50, "special_circumstances": 10000, "county": 200, "poc": 100,
	"race_ethnicity": 500, "gender_identity": 100, "signature_typed": 500,
}

// aidFormParseNote is one parse_notes entry: what was typed, what Kindred read
// (null when unknown) and the note staff see.
type aidFormParseNote struct {
	Typed string   `json:"typed"`
	Read  *float64 `json:"read"`
	Note  string   `json:"note"`
}

// The figure roles, with what a blank means for each (design §7).
var aidFormFigures = []struct {
	role string
	kind aidform.FigureKind
}{
	{aidform.RoleAsk, aidform.FigureRequired},
	{aidform.RoleGross, aidform.FigureRequired},
	{aidform.RoleGrossConfirm, aidform.FigureRequired},
	{aidform.RoleAGI, aidform.FigureRequired},
	{aidform.RoleExpected, aidform.FigureRequired},
	{aidform.RoleMortgage, aidform.FigureOptionalHousing},
	{aidform.RoleSavings, aidform.FigureRequired},
	{aidform.RoleRent, aidform.FigureOptionalHousing},
	{aidform.RoleMedical, aidform.FigureRequired},
	{aidform.RoleStudentLoan, aidform.FigureRequired},
}

// aidFormIncomeColumns are the income answers whose blank must stay
// distinguishable from a reported 0 -- the CampMinder mirror's
// reported_income_fields contract (faReportedIncomeColumns).
var aidFormIncomeColumns = []string{
	aidform.RoleGross, aidform.RoleExpected, aidform.RoleAGI, aidform.RoleGrossConfirm,
}

// parseAidFormResponse is the response's parse-owned fields: a pure function of
// what was typed (and the season, for a note's wording).
func parseAidFormResponse(r *google.FormResponse, qm aidform.QuestionMap, year int, formID string) map[string]any {
	answer := func(role string) string {
		if qid := qm[role]; qid != "" {
			return strings.TrimSpace(r.Answer(qid))
		}
		return ""
	}
	notes := map[string]aidFormParseNote{}
	text := func(column, value string) string {
		if limit := aidFormTextMax[column]; limit > 0 && len([]rune(value)) > limit {
			if column == aidform.RoleCircumstances {
				notes[column] = aidFormParseNote{Note: fmt.Sprintf("longer than %d characters: the rest is on the form", limit)}
			}
			return truncateRunes(value, limit)
		}
		return value
	}
	out := map[string]any{
		"year": year, "form_id": formID, "response_id": r.ResponseID,
		"created_at_google": r.CreateTime, "last_submitted_at": r.LastSubmittedTime,
		"form_status":      aidFormStatusLive,
		"respondent_email": text("respondent_email", strings.TrimSpace(r.RespondentEmail)),
	}
	for _, column := range []string{
		aidform.RoleName, aidform.RoleBirthdate, aidform.RoleProgram, aidform.RoleAgreementDate,
		aidform.RoleCircumstances, aidform.RoleCounty, aidform.RolePOC, aidform.RoleRace,
		aidform.RoleGender, aidform.RoleSignature,
	} {
		out[column] = text(column, answer(column))
	}

	figures := map[string]aidform.Figure{}
	var reported []string
	for _, f := range aidFormFigures {
		typed := answer(f.role)
		fig := aidform.ParseFigure(typed, f.kind)
		figures[f.role] = fig
		out[f.role] = fig.Value
		if fig.Note != "" {
			note := aidFormParseNote{Typed: typed, Note: fig.Note}
			if fig.Known {
				v := fig.Value
				note.Read = &v
			}
			notes[f.role] = note
		}
		if fig.Reported && slices.Contains(aidFormIncomeColumns, f.role) {
			reported = append(reported, f.role)
		}
	}
	slices.Sort(reported)
	out["reported_income_fields"] = reported

	// Items 6 and 7: both stored; a difference is noted, never resolved here.
	gross, confirm := figures[aidform.RoleGross], figures[aidform.RoleGrossConfirm]
	if gross.Known && confirm.Known && gross.Value != confirm.Value {
		note := notes[aidform.RoleGrossConfirm]
		differ := fmt.Sprintf("the two %d gross figures differ: %s / %s",
			year-1, aidform.Money(gross.Value), aidform.Money(confirm.Value))
		if note.Note != "" {
			note.Note += "; " + differ
		} else {
			v := confirm.Value
			note = aidFormParseNote{Typed: answer(aidform.RoleGrossConfirm), Read: &v, Note: differ}
		}
		notes[aidform.RoleGrossConfirm] = note
	}

	children, known, note := aidform.ParseCount(answer(aidform.RoleChildren))
	out[aidform.RoleChildren] = children
	if !known {
		notes[aidform.RoleChildren] = aidFormParseNote{Typed: answer(aidform.RoleChildren), Note: note}
	}
	for _, role := range []string{aidform.RoleUnemployment, aidform.RoleGovSubsidies} {
		value, ok := aidform.ParseYesNo(answer(role))
		out[role] = value
		if !ok {
			n := aidform.NoteBlank
			if answer(role) != "" {
				n = "not Yes or No"
			}
			notes[role] = aidFormParseNote{Typed: answer(role), Note: n}
		}
	}
	out["parse_notes"] = notes
	return out
}

// aidFormChoice is one program label's mapping, as stored in choice_map.
type aidFormChoice struct {
	ProgramKey string `json:"program_key"`
	StartDate  string `json:"start_date,omitempty"`
	// Status: mapped (one weekend), unclear (several start that day) or
	// unmapped (none, or no readable date).
	Status             string `json:"status"`
	WeekendSessionCMID int    `json:"weekend_session_cm_id"`
	Weekends           []int  `json:"weekend_session_cm_ids,omitempty"`
	// SessionCMIDs is the weekend set: the weekend(s) plus every Adult Reg
	// (family_adult) session paired to one by the sessions sync's parent_id.
	SessionCMIDs []int `json:"session_cm_ids,omitempty"`
	// DateMismatch: the label's date (StartDate) is not the mapped weekend's
	// start (SessionStartDate). Noted for staff; the mapping stands.
	DateMismatch     bool   `json:"date_mismatch,omitempty"`
	SessionStartDate string `json:"session_start_date,omitempty"`
}

const (
	aidChoiceMapped   = "mapped"
	aidChoiceUnclear  = "unclear"
	aidChoiceUnmapped = "unmapped"
)

// mapAidFormChoices maps every label ever seen (design §6, owner ruling 10-29).
// The bucket comes from the label. The weekend comes from the label's FAMILY
// CAMP NUMBER ("Family Camp 5: ..." -> the one 2027 family session whose name
// says Family Camp 5), or, for a weekend without one, from its NAME (the text
// before " (" or ":", folded, equal to a 2027 family -- or for an adult weekend,
// adult -- session's whole name). Never by date: CampMinder has given an Adult
// Reg session the following weekend's dates (D6). The label's date is only a
// cross-check, noted as date_mismatch when it disagrees with the weekend's
// start; it never changes the mapping. Two candidates is unclear, never a first
// match. The Adult Reg sessions come from the sessions sync's parent_id, which
// pairs them by name too, so they are never re-derived here.
func mapAidFormChoices(labels []string, year int, roster *aidFormRoster) map[string]aidFormChoice {
	out := map[string]aidFormChoice{}
	for _, label := range labels {
		label = strings.TrimSpace(label)
		if label == "" {
			continue
		}
		if _, done := out[label]; done {
			continue
		}
		c := aidFormChoice{ProgramKey: aidform.ChoiceBucket(label), Status: aidChoiceUnmapped}
		c.StartDate = aidform.ChoiceStartDate(label, year)
		want := sessionTypeFamily
		if c.ProgramKey == aidform.BucketAdultWeekend {
			want = sessionTypeAdult
		}
		c.Weekends = choiceWeekends(label, want, roster)
		switch len(c.Weekends) {
		case 0:
		case 1:
			c.Status, c.WeekendSessionCMID = aidChoiceMapped, c.Weekends[0]
			if start := roster.session(c.Weekends[0]).startDate; c.StartDate != "" && start != c.StartDate {
				c.DateMismatch, c.SessionStartDate = true, start
			}
		default:
			c.Status = aidChoiceUnclear
		}
		if len(c.Weekends) > 0 {
			c.SessionCMIDs = slices.Clone(c.Weekends)
			for _, sess := range roster.sessions {
				if sess.kind == sessionTypeFamilyAdult && slices.Contains(c.Weekends, sess.parentID) {
					c.SessionCMIDs = append(c.SessionCMIDs, sess.cmID)
				}
			}
			slices.Sort(c.SessionCMIDs)
		}
		out[label] = c
	}
	return out
}

// choiceWeekends is every session of kind `want` a label names: by its Family
// Camp number when it carries one, otherwise by its name part. Sorted.
func choiceWeekends(label, want string, roster *aidFormRoster) []int {
	var hits []int
	if m := familyCampNumberPattern.FindStringSubmatch(strings.ToLower(label)); m != nil {
		for _, sess := range roster.sessions {
			sm := familyCampNumberPattern.FindStringSubmatch(strings.ToLower(sess.name))
			if sess.kind == want && len(sm) > 1 && sm[1] == m[1] {
				hits = append(hits, sess.cmID)
			}
		}
		slices.Sort(hits)
		return hits
	}
	name := label
	if i := strings.IndexAny(name, "(:"); i >= 0 {
		name = name[:i]
	}
	name = jotform.Fold(name)
	if name == "" {
		return nil
	}
	for _, sess := range roster.sessions {
		if sess.kind == want && jotform.Fold(sess.name) == name {
			hits = append(hits, sess.cmID)
		}
	}
	slices.Sort(hits)
	return hits
}

// storedChoiceLabels are the labels on the season's stored choice_map: Google
// never rewrites an old response's label, so the map keeps every one seen.
func (s *AidGoogleFormResponsesSync) storedChoiceLabels(year int) ([]string, error) {
	rec, err := s.formRecord(s.App, year)
	if err != nil || rec == nil {
		return nil, err
	}
	var stored map[string]json.RawMessage
	if raw := jsonFieldBytes(rec.Get("choice_map")); compactJSON(raw) != "" {
		if err := json.Unmarshal(raw, &stored); err != nil {
			slog.Warn("Adult aid form: the stored choice_map is unreadable; re-mapping from scratch", "year", year)
			return nil, nil
		}
	}
	return slices.Sorted(maps.Keys(stored)), nil
}

// aidFormSession is one 2027 adult or family weekend session.
type aidFormSession struct {
	cmID, parentID int
	name, kind     string
	startDate      string // camp-local YYYY-MM-DD
}

// aidFormRoster is the season's adult and family weekend registrations.
type aidFormRoster struct {
	sessions []aidFormSession
	// people registered (2/4/8/512) in any adult or family weekend session,
	// with every such session.
	people []aidform.Person
	// households' persons, for the email tie-break.
	households map[int][]aidform.Member
}

// session is the season's session with that CampMinder id (zero when none).
func (r *aidFormRoster) session(cmID int) aidFormSession {
	for _, s := range r.sessions {
		if s.cmID == cmID {
			return s
		}
	}
	return aidFormSession{}
}

// weekendOf is the weekend a session counts as: itself, or an Adult Reg
// session's paired weekend.
func (r *aidFormRoster) weekendOf(cmID int) int {
	if s := r.session(cmID); s.kind == sessionTypeFamilyAdult && s.parentID > 0 {
		return s.parentID
	}
	return cmID
}

// split is the chosen weekend set's pool and everyone registered elsewhere,
// each carrying only their registrations on that side.
func (r *aidFormRoster) split(set []int) (pool, elsewhere []aidform.Person) {
	for _, p := range r.people {
		in, out := p, p
		in.Sessions, out.Sessions = nil, nil
		for _, sid := range p.Sessions {
			if slices.Contains(set, sid) {
				in.Sessions = append(in.Sessions, sid)
			} else {
				out.Sessions = append(out.Sessions, sid)
			}
		}
		if len(in.Sessions) > 0 {
			pool = append(pool, in)
		} else if len(out.Sessions) > 0 {
			elsewhere = append(elsewhere, out)
		}
	}
	return pool, elsewhere
}

func loadAidFormRoster(app core.App, year int) (*aidFormRoster, error) {
	roster := &aidFormRoster{households: map[int][]aidform.Member{}}
	sessionRecs, err := findAllRecords(app, "camp_sessions",
		"year = {:year} && (session_type = {:family} || session_type = {:familyAdult} || session_type = {:adult})",
		dbx.Params{"year": year, "family": sessionTypeFamily, "familyAdult": sessionTypeFamilyAdult,
			"adult": sessionTypeAdult})
	if err != nil {
		return nil, fmt.Errorf("loading the season's weekends: %w", err)
	}
	loc := campLocation()
	byPBID := map[string]int{}
	for _, rec := range sessionRecs {
		start := ""
		if dt := rec.GetDateTime("start_date"); !dt.IsZero() {
			start = dt.Time().In(loc).Format(time.DateOnly)
		}
		sess := aidFormSession{cmID: rec.GetInt("cm_id"), parentID: rec.GetInt("parent_id"),
			name: rec.GetString("name"), kind: rec.GetString("session_type"), startDate: start}
		roster.sessions = append(roster.sessions, sess)
		byPBID[rec.Id] = sess.cmID
	}
	if len(byPBID) == 0 {
		return roster, nil
	}

	statusClauses := make([]string, 0, len(aidFormRegisteredStatuses))
	params := dbx.Params{"year": year}
	for i, st := range aidFormRegisteredStatuses {
		key := fmt.Sprintf("st%d", i)
		statusClauses = append(statusClauses, fmt.Sprintf("status_id = {:%s}", key))
		params[key] = st
	}
	sessionClauses := make([]string, 0, len(byPBID))
	i := 0
	for _, pbID := range slices.Sorted(maps.Keys(byPBID)) {
		key := fmt.Sprintf("s%d", i)
		sessionClauses = append(sessionClauses, fmt.Sprintf("session = {:%s}", key))
		params[key] = pbID
		i++
	}
	attendees, err := findAllRecords(app, "attendees", "year = {:year} && ("+strings.Join(statusClauses, " || ")+
		") && ("+strings.Join(sessionClauses, " || ")+")", params)
	if err != nil {
		return nil, fmt.Errorf("loading the season's weekend registrations: %w", err)
	}
	regs := map[int][]int{}
	for _, a := range attendees {
		pid := a.GetInt("person_id")
		if sid, ok := byPBID[a.GetString("session")]; ok && pid > 0 && !slices.Contains(regs[pid], sid) {
			regs[pid] = append(regs[pid], sid)
		}
	}
	if len(regs) == 0 {
		return roster, nil
	}

	ids := make([]string, 0, len(regs))
	for _, pid := range slices.Sorted(maps.Keys(regs)) {
		ids = append(ids, strconv.Itoa(pid))
	}
	householdSet := map[int]bool{}
	err = forEachRosterIDChunk(ids, func(filter string, params dbx.Params) error {
		params["year"] = year
		persons, findErr := findAllRecords(app, "persons", "year = {:year} && ("+filter+")", params)
		if findErr != nil {
			return findErr
		}
		for _, rec := range persons {
			cmID := rec.GetInt("cm_id")
			sessions := slices.Clone(regs[cmID])
			slices.Sort(sessions)
			p := aidform.Person{
				PersonCMID: cmID, HouseholdCMID: rec.GetInt("household_id"),
				First: rec.GetString("first_name"), Preferred: rec.GetString("preferred_name"),
				Last: rec.GetString("last_name"), Birthdate: rec.GetString("birthdate"),
				Emails:   []string{rec.GetString("primary_email"), rec.GetString("secondary_email")},
				Sessions: sessions,
			}
			roster.people = append(roster.people, p)
			if p.HouseholdCMID > 0 {
				householdSet[p.HouseholdCMID] = true
			}
		}
		return nil
	}, "cm_id")
	if err != nil {
		return nil, fmt.Errorf("loading registered persons: %w", err)
	}
	slices.SortFunc(roster.people, func(a, b aidform.Person) int { return cmp.Compare(a.PersonCMID, b.PersonCMID) })

	householdIDs := make([]string, 0, len(householdSet))
	for _, h := range slices.Sorted(maps.Keys(householdSet)) {
		householdIDs = append(householdIDs, strconv.Itoa(h))
	}
	err = forEachRosterIDChunk(householdIDs, func(filter string, params dbx.Params) error {
		params["year"] = year
		members, findErr := findAllRecords(app, "persons", "year = {:year} && ("+filter+")", params)
		if findErr != nil {
			return findErr
		}
		for _, rec := range members {
			h := rec.GetInt("household_id")
			roster.households[h] = append(roster.households[h], aidform.Member{
				PersonCMID: rec.GetInt("cm_id"),
				Emails:     []string{rec.GetString("primary_email"), rec.GetString("secondary_email")},
			})
		}
		return nil
	}, "household_id")
	if err != nil {
		return nil, fmt.Errorf("loading household members: %w", err)
	}
	return roster, nil
}

// planAidFormMatches decides each live, staff-untouched row's match, then
// marks older responses from one person for one weekend superseded.
func planAidFormMatches(p *aidFormPull) {
	type keyed struct {
		row  *aidFormRow
		key  string
		when time.Time
	}
	groups := map[string][]keyed{}
	for _, row := range p.rows {
		if row.deleted || (row.parsed == nil && row.rec != nil && row.rec.GetString("form_status") != aidFormStatusLive) {
			continue
		}
		choice := p.choices[strings.TrimSpace(row.choice)]
		weekend := choice.WeekendSessionCMID
		person := 0
		if row.staffOwned {
			person = row.rec.GetInt("person_cm_id")
			if row.rec.GetString("match_status") == aidFormMatchIgnored {
				person = 0
			}
			if weekend == 0 {
				weekend = row.rec.GetInt("weekend_session_cm_id")
			}
		} else {
			row.match = decideAidFormMatch(row.identity, choice, p.roster)
			person, _ = row.match["person_cm_id"].(int)
			weekend, _ = row.match["weekend_session_cm_id"].(int)
		}
		if person == 0 {
			continue
		}
		key := fmt.Sprintf("%d|%d", person, weekend)
		if weekend == 0 {
			key = fmt.Sprintf("%d|choice:%s", person, jotform.Fold(row.choice))
		}
		when, _ := time.Parse(time.RFC3339Nano, row.lastSubmitted)
		groups[key] = append(groups[key], keyed{row: row, key: key, when: when})
	}
	for _, group := range groups {
		if len(group) < 2 {
			continue
		}
		slices.SortFunc(group, func(a, b keyed) int {
			if c := b.when.Compare(a.when); c != 0 {
				return c
			}
			return cmp.Compare(b.row.responseID, a.row.responseID)
		})
		newest := group[0].row.responseID
		for _, k := range group[1:] {
			if k.row.staffOwned {
				continue // a staff decision stands; PR 2 sees both
			}
			k.row.match["match_status"] = aidFormMatchSuperseded
			k.row.match["superseded_by"] = newest
		}
	}
}

// decideAidFormMatch is one row's match-owned fields.
func decideAidFormMatch(id aidform.Identity, choice aidFormChoice, roster *aidFormRoster) map[string]any {
	var d aidform.Decision
	if len(choice.SessionCMIDs) == 0 {
		// No weekend set: nothing to match against. Where they are registered
		// is kept as evidence for staff.
		_, elsewhere := roster.split(nil)
		away := aidform.Match(id, nil, elsewhere, nil)
		d = aidform.Decision{Status: aidform.StatusUnmatched}
		if away.Status == aidform.StatusRegisteredElsewhere {
			d.Candidates, d.Signals = away.Candidates, away.Signals
		}
	} else {
		pool, elsewhere := roster.split(choice.SessionCMIDs)
		d = aidform.Match(id, pool, elsewhere, roster.households)
	}
	weekend, registered := choice.WeekendSessionCMID, 0
	if d.Status == aidform.StatusAuto && len(d.Candidates) == 1 {
		sessions := d.Candidates[0].SessionCMIDs
		if len(sessions) == 1 {
			registered = sessions[0]
		}
		if weekend == 0 {
			// An unclear choice: registration decides when it names one weekend.
			var weekends []int
			for _, sid := range sessions {
				if w := roster.weekendOf(sid); !slices.Contains(weekends, w) {
					weekends = append(weekends, w)
				}
			}
			if len(weekends) == 1 {
				weekend = weekends[0]
			}
		}
	}
	candidates := d.Candidates
	if candidates == nil {
		candidates = []aidform.Candidate{}
	}
	return map[string]any{
		"match_status": d.Status, "match_tier": d.Signals, "match_candidates": candidates,
		"person_cm_id": d.PersonCMID, "household_cm_id": d.HouseholdCMID,
		"registered_session_cm_id": registered, "weekend_session_cm_id": weekend, "superseded_by": "",
	}
}

// writeRows writes every row whose stored state differs from the decided one.
// Each write re-reads the row inside its transaction: if staff linked or
// ignored it after this pull loaded it, the match fields are left alone.
func (s *AidGoogleFormResponsesSync) writeRows(p *aidFormPull) error {
	col, err := s.App.FindCollectionByNameOrId("aid_form_responses")
	if err != nil {
		return fmt.Errorf("finding aid_form_responses: %w", err)
	}
	for _, row := range p.rows {
		if row.parsed == nil && !row.deleted && row.match == nil {
			continue // a staff-owned row Google did not return, guard holding: nothing to do
		}
		err := s.App.RunInTransaction(func(tx core.App) error {
			rec := row.rec
			created := rec == nil
			if created {
				rec = core.NewRecord(col)
			} else {
				fresh, err := tx.FindRecordById("aid_form_responses", rec.Id)
				if err != nil {
					return fmt.Errorf("re-reading: %w", err)
				}
				rec = fresh
			}
			want := map[string]any{}
			maps.Copy(want, row.parsed)
			switch rec.GetString("match_status") {
			case aidFormMatchStaff, aidFormMatchIgnored:
				// Staff own the match. The weekend still follows a choice that maps
				// to exactly one weekend; otherwise it stays as staff left it.
				if choice := p.choices[strings.TrimSpace(row.choice)]; choice.WeekendSessionCMID > 0 {
					want["weekend_session_cm_id"] = choice.WeekendSessionCMID
				}
			default:
				maps.Copy(want, row.match)
			}
			wasLive := rec.GetString("form_status") == aidFormStatusLive
			if row.deleted {
				want["form_status"] = aidFormStatusDeleted
			}
			changed := created
			for field, value := range want {
				if setAidFormField(rec, field, value) {
					changed = true
				}
			}
			if !changed {
				s.Stats.Skipped++
				return nil
			}
			if err := tx.Save(rec); err != nil {
				return fmt.Errorf("saving: %w", err)
			}
			switch {
			case created:
				s.Stats.Created++
			case row.deleted && wasLive:
				s.Stats.Deleted++
			default:
				s.Stats.Updated++
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("writing response row %s: %w", row.responseID, err)
		}
	}
	return nil
}

// setAidFormField sets one field when it differs, comparing through
// PocketBase's typed getters (a number reads back as float64, JSON as raw
// bytes), so an unchanged pull writes nothing.
func setAidFormField(rec *core.Record, field string, value any) bool {
	switch v := value.(type) {
	case string:
		if rec.GetString(field) == v {
			return false
		}
	case int:
		if rec.GetFloat(field) == float64(v) {
			return false
		}
	case float64:
		if rec.GetFloat(field) == v {
			return false
		}
	case bool:
		if rec.GetBool(field) == v {
			return false
		}
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return false
		}
		if compactJSON(jsonFieldBytes(rec.Get(field))) == compactJSON(raw) {
			return false
		}
		rec.Set(field, types.JSONRaw(raw))
		return true
	}
	rec.Set(field, value)
	return true
}

// aidFormPullStatus is the form row's status line.
func aidFormPullStatus(p *aidFormPull) string {
	linked, toLink := 0, 0
	for _, row := range p.rows {
		if row.deleted {
			continue
		}
		status := ""
		if row.match != nil {
			status, _ = row.match["match_status"].(string)
		} else if row.rec != nil {
			status = row.rec.GetString("match_status")
		}
		switch status {
		case aidform.StatusAuto, aidFormMatchStaff:
			linked++
		case aidform.StatusSuggested, aidform.StatusRegisteredElsewhere, aidform.StatusNotRegistered,
			aidform.StatusUnmatched:
			toLink++
		}
	}
	parts := []string{fmt.Sprintf("ok · %d responses · %d linked · %d to link", p.responses, linked, toLink)}
	if p.refused != "" {
		parts = append([]string{p.refused}, fmt.Sprintf("%d responses · %d linked · %d to link", p.responses, linked, toLink))
	}
	for _, label := range slices.Sorted(maps.Keys(p.choices)) {
		switch c := p.choices[label]; c.Status {
		case aidChoiceUnmapped:
			parts = append(parts, fmt.Sprintf("choice '%s' matches no %d session", label, p.year))
		case aidChoiceUnclear:
			parts = append(parts, fmt.Sprintf("choice '%s' matches %d %d sessions", label, len(c.Weekends), p.year))
		case aidChoiceMapped:
			if c.DateMismatch {
				parts = append(parts, fmt.Sprintf("choice '%s' says %s, but session %d starts %s",
					label, c.StartDate, c.WeekendSessionCMID, c.SessionStartDate))
			}
		}
	}
	parts = append(parts, p.problems...)
	return strings.Join(parts, " · ")
}

func (s *AidGoogleFormResponsesSync) formRecord(app core.App, year int) (*core.Record, error) {
	recs, err := app.FindRecordsByFilter("aid_google_forms", "year = {:year}", "", 1, 0, dbx.Params{"year": year})
	if err != nil {
		return nil, fmt.Errorf("loading aid_google_forms: %w", err)
	}
	if len(recs) == 0 {
		return nil, nil
	}
	return recs[0], nil
}

// recordForm stamps the season's form row (creating it on the first pull)
// with the pull's maps, time and status. Not counted in Stats: it is the
// pull's own bookkeeping, and stamping last_pulled_at every hour must not
// read as a change that rebuilds intake.
func (s *AidGoogleFormResponsesSync) recordForm(year int, formID string, p *aidFormPull, status string) {
	status = truncateRunes(status, aidFormPullStatusMax)
	err := s.App.RunInTransaction(func(tx core.App) error {
		rec, err := s.formRecord(tx, year)
		if err != nil {
			return err
		}
		if rec == nil {
			col, err := tx.FindCollectionByNameOrId("aid_google_forms")
			if err != nil {
				return fmt.Errorf("finding aid_google_forms: %w", err)
			}
			rec = core.NewRecord(col)
			rec.Set("year", year)
		}
		rec.Set("form_id", formID)
		if p != nil {
			rec.Set("revision_id", p.revision)
			setAidFormField(rec, "question_map", map[string]string(p.qm))
			setAidFormField(rec, "choice_map", p.choices)
		}
		rec.Set("last_pulled_at", types.NowDateTime())
		rec.Set("last_pull_status", status)
		return tx.Save(rec)
	})
	if err != nil {
		slog.Warn("Could not record the adult aid form pull status", "year", year, "error", err)
	}
}
