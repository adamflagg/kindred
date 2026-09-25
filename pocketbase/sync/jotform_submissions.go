package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/camp/kindred/pocketbase/jotform"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const serviceNameJotformSubmissions = "jotform_submissions"

// jotformConfigured gates the daily Jotform pull: a deployment with no key
// (dev, CI, a fresh stack) skips it instead of failing it every night.
func jotformConfigured() bool { return strings.TrimSpace(os.Getenv("JOTFORM_API_KEY")) != "" }

const (
	jotformStatusDeleted  = "DELETED"
	matchStatusAuto       = "auto"
	matchStatusStaff      = "staff"
	matchStatusUnmatched  = "unmatched"
	matchStatusIgnored    = "ignored"
	matchStatusCancelled  = "cancelled"
	matchStatusWriteIn    = "write_in"
	jotformPullStatusMax  = 2000
	jotformEnrolledStatus = 2
)

// JotformFetcher is the slice of the Jotform client this job uses; tests fake it.
type JotformFetcher interface {
	FormSubmissions(ctx context.Context, formID string) ([]jotform.Submission, error)
	FormQuestions(ctx context.Context, formID string) ([]jotform.FormQuestion, error)
	FormTitle(ctx context.Context, formID string) (string, error)
}

// The wrong-guess guard (kindred#2828): with a GUESSED name role, a pull whose
// live, staff-untouched submissions number at least guardMinSubmissions and
// auto-match below half writes no match results. A name role that landed on
// the emergency-contact name would otherwise link people to the wrong guests.
const guardMinSubmissions = 10

// errFormRepointed: staff pointed the weekend at a different Jotform form
// while this pull ran, so what it read belongs to the old one.
var errFormRepointed = errors.New("the form link changed during the pull")

// JotformSubmissionsSync pulls every ENABLED adult-weekend form for the season
// (kindred#2759), stores every answered question generically, marks vanished
// submissions DELETED, and auto-matches with jotform.Match against the
// session's enrolled guests.
//
// Each pull first reads the form's DEFINITION (title and questions) from
// Jotform and resolves the field map itself (kindred#2828): staff roles are
// kept, a role whose wording matches one confirmed on an earlier year's form is
// carried, and the rest are guessed from the wording. So a freshly pasted form
// is stored, mapped and matched in one run.
//
// Rows staff linked or ignored are never re-matched: their Jotform content
// (answers, dates, status, a DELETED mark) still refreshes, but match_status,
// person_cm_id and match_tier stay as staff left them.
//
// Not CampMinder: it has its own key (JOTFORM_API_KEY) and base URL
// (JOTFORM_API_BASE). It runs daily when a key is configured, and on demand
// from the admin Jotform tab or the individual route.
type JotformSubmissionsSync struct {
	App        core.App
	Fetcher    JotformFetcher
	NewFetcher func() (JotformFetcher, error)
	Year       int
	Debug      bool
	Stats      Stats
}

// NewJotformSubmissionsSync builds the job with an env-configured client.
func NewJotformSubmissionsSync(app core.App) *JotformSubmissionsSync {
	return &JotformSubmissionsSync{
		App: app,
		NewFetcher: func() (JotformFetcher, error) {
			// Never return the *Client directly: a nil *Client in a non-nil
			// interface would pass the caller's nil check.
			client, err := jotform.NewClientFromEnv()
			if err != nil {
				return nil, fmt.Errorf("configuring the Jotform client: %w", err)
			}
			return client, nil
		},
	}
}

// GetStats returns the last run's stats.
func (s *JotformSubmissionsSync) GetStats() Stats { return s.Stats }

// SetDebug toggles debug logging.
func (s *JotformSubmissionsSync) SetDebug(debug bool) { s.Debug = debug }

// Sync pulls every enabled form for the season. One form failing does not stop
// the others; the job still returns the first error so the run reads failed.
func (s *JotformSubmissionsSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	year := s.Year
	if year == 0 {
		y, err := ParseSeasonYear()
		if err != nil {
			return err
		}
		year = y
	}
	fetcher := s.Fetcher
	if fetcher == nil {
		f, err := s.NewFetcher()
		if err != nil {
			return err
		}
		fetcher = f
	}

	forms, err := findAllRecords(s.App, "jotform_forms", "year = {:year} && enabled = true", dbx.Params{"year": year})
	if err != nil {
		return fmt.Errorf("loading jotform_forms: %w", err)
	}
	history, err := s.confirmedWordings(year)
	if err != nil {
		return err
	}
	var firstErr error
	for _, form := range forms {
		pullErr := s.pullForm(ctx, fetcher, form, year, history)
		if pullErr == nil {
			continue
		}
		s.Stats.Errors++
		s.recordStatus(form, "error: "+pullErr.Error())
		if firstErr == nil {
			firstErr = fmt.Errorf("jotform form %s: %w", form.GetString("form_id"), pullErr)
		}
	}
	if _, cpErr := s.App.DB().NewQuery("PRAGMA wal_checkpoint(FULL)").Execute(); cpErr != nil {
		slog.Warn("WAL checkpoint after the Jotform pull failed", "error", cpErr)
	}
	slog.Info("Jotform pull complete", "forms", len(forms), "created", s.Stats.Created,
		"updated", s.Stats.Updated, "skipped", s.Stats.Skipped, "deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors)
	return firstErr
}

func (s *JotformSubmissionsSync) pullForm(
	ctx context.Context, fetcher JotformFetcher, form *core.Record, year int, history []jotform.ConfirmedWording,
) error {
	formID := form.GetString("form_id")
	// The definition first: a failure here writes nothing at all.
	title, err := fetcher.FormTitle(ctx, formID)
	if err != nil {
		return fmt.Errorf("reading the form: %w", err)
	}
	questions, err := fetcher.FormQuestions(ctx, formID)
	if err != nil {
		return fmt.Errorf("reading the form's questions: %w", err)
	}
	subs, err := fetcher.FormSubmissions(ctx, formID)
	if err != nil {
		// Nothing written, nothing marked deleted.
		return fmt.Errorf("pulling submissions: %w", err)
	}
	existing, err := findAllRecords(s.App, "jotform_submissions", "form = {:form}", dbx.Params{"form": form.Id})
	if err != nil {
		return fmt.Errorf("loading stored submissions: %w", err)
	}
	byID := make(map[string]*core.Record, len(existing))
	for _, rec := range existing {
		byID[rec.GetString("submission_id")] = rec
	}

	seen := make(map[string]bool, len(subs))
	for i := range subs {
		sub := &subs[i]
		seen[sub.ID] = true
		if upsertErr := s.upsertSubmission(form, year, sub, byID[sub.ID]); upsertErr != nil {
			return upsertErr
		}
	}
	// Only after a COMPLETE pull: a submission Jotform no longer returns is marked.
	for id, rec := range byID {
		if seen[id] || rec.GetString("jotform_status") == jotformStatusDeleted {
			continue
		}
		if markErr := s.markDeleted(rec.Id); markErr != nil {
			return fmt.Errorf("marking submission %s deleted: %w", id, markErr)
		}
		s.Stats.Deleted++
	}

	fieldMap, meta, err := s.saveMapping(form, title, questions, history)
	if errors.Is(err, errFormRepointed) {
		s.recordStatus(form, fmt.Sprintf("ok · %d submissions stored · %s; pull again", len(subs), err))
		return nil
	}
	if err != nil {
		return err
	}
	mapping := meta.Summary()
	if !fieldMap.HasIdentity() {
		s.recordStatus(form, withMapping(fmt.Sprintf(
			"ok · %d submissions stored · matching skipped: map first and last name", len(subs)), mapping))
		return nil
	}
	plan, err := s.planMatches(form, fieldMap, year)
	if err != nil {
		return err
	}
	// A cancelled-registration match is a name match too: it counts as
	// matched for the guard, which polices a name role landing on the wrong
	// question.
	if matched, eligible := plan.auto+plan.cancelled, plan.auto+plan.cancelled+plan.unmatched; guessedNames(meta) &&
		eligible >= guardMinSubmissions && matched*2 < eligible {
		s.recordStatus(form, withMapping(fmt.Sprintf(
			"ok · %d submissions · matching held: the guessed name questions matched only %d of %d — check the mapping",
			len(subs), matched, eligible), mapping))
		return nil
	}
	if err := s.applyMatches(plan); err != nil {
		return err
	}
	status := fmt.Sprintf("ok · %d submissions · %d matched · %d unmatched",
		len(subs), plan.staff+plan.auto, plan.unmatched)
	if plan.cancelled > 0 {
		status += fmt.Sprintf(" · %d cancelled", plan.cancelled)
	}
	s.recordStatus(form, withMapping(status, mapping))
	return nil
}

func withMapping(status, mapping string) string {
	if mapping == "" {
		return status
	}
	return status + " · " + mapping
}

// guessedNames reports whether first or last name rests on the wording rules
// alone -- the only case the wrong-guess guard polices. A staff or carried
// name role is a human's (or a past human's) choice.
func guessedNames(meta jotform.FieldMapMeta) bool {
	return meta[jotform.RoleFirstName].Source == jotform.SourceGuessed ||
		meta[jotform.RoleLastName].Source == jotform.SourceGuessed
}

// saveMapping resolves the form's field map and stores it with the form's
// definition. It resolves from a FRESH copy of the form, inside the
// transaction that writes it: an admin save made while the pull ran is what
// it builds on, so a staff role is never overwritten (Save writes every
// column, and the copy Sync loaded predates the pull).
func (s *JotformSubmissionsSync) saveMapping(
	form *core.Record, title string, questions []jotform.FormQuestion, history []jotform.ConfirmedWording,
) (jotform.FieldMap, jotform.FieldMapMeta, error) {
	var fieldMap jotform.FieldMap
	var meta jotform.FieldMapMeta
	err := s.App.RunInTransaction(func(tx core.App) error {
		fresh, err := tx.FindRecordById("jotform_forms", form.Id)
		if err != nil {
			return fmt.Errorf("re-reading the form: %w", err)
		}
		if fresh.GetString("form_id") != form.GetString("form_id") {
			return errFormRepointed
		}
		stored, err := readFieldMap(fresh)
		if err != nil {
			return err
		}
		storedMeta, err := readFieldMapMeta(fresh)
		if err != nil {
			return err
		}
		fieldMap, meta = jotform.ResolveMapping(questions, jotform.StaffRoles(stored, storedMeta), history)

		changed := false
		for field, value := range map[string]any{"questions": questions, "field_map": fieldMap, "field_map_meta": meta} {
			raw, err := json.Marshal(value)
			if err != nil {
				return fmt.Errorf("encoding %s: %w", field, err)
			}
			if compactJSON(jsonFieldBytes(fresh.Get(field))) != compactJSON(raw) {
				fresh.Set(field, types.JSONRaw(raw))
				changed = true
			}
		}
		if fresh.GetString("form_title") != title {
			fresh.Set("form_title", title)
			changed = true
		}
		if !changed {
			return nil
		}
		if err := tx.Save(fresh); err != nil {
			return fmt.Errorf("saving the form's mapping: %w", err)
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errFormRepointed) {
			return nil, nil, errFormRepointed
		}
		return nil, nil, fmt.Errorf("resolving the field map: %w", err)
	}
	return fieldMap, meta, nil
}

// confirmedWordings collects, from every EARLIER year's form (any adult
// weekend: they share wording), the wording of each role a human confirmed --
// set by staff, or carried from such a confirmation. A role whose question was
// removed confirms nothing. Both the wording at confirmation and the
// question's last-seen wording count: either names that question.
func (s *JotformSubmissionsSync) confirmedWordings(year int) ([]jotform.ConfirmedWording, error) {
	rows, err := findAllRecords(s.App, "jotform_forms", "year < {:year}", dbx.Params{"year": year})
	if err != nil {
		return nil, fmt.Errorf("loading earlier years' forms: %w", err)
	}
	var out []jotform.ConfirmedWording
	for _, row := range rows {
		stored, fmErr := readFieldMap(row)
		meta, metaErr := readFieldMapMeta(row)
		questions, qErr := readQuestions(row)
		if fmErr != nil || metaErr != nil || qErr != nil {
			slog.Warn("Skipping an unreadable earlier Jotform form for carry-forward",
				"form", row.GetString("form_id"), "year", row.GetInt("year"))
			continue
		}
		textOf := make(map[string]string, len(questions))
		for _, q := range questions {
			textOf[q.QuestionID] = q.Text
		}
		confirmed := jotform.StaffRoles(stored, meta)
		for role, m := range meta {
			if m.Source == jotform.SourceCarried {
				confirmed[role] = m
			}
		}
		y := row.GetInt("year")
		for role, m := range confirmed {
			if m.QuestionID == "" || m.Flag == jotform.FlagMissing {
				continue
			}
			for _, text := range []string{m.Text, textOf[m.QuestionID]} {
				if strings.TrimSpace(text) != "" {
					out = append(out, jotform.ConfirmedWording{Year: y, Role: role, Text: text})
				}
			}
		}
	}
	return out, nil
}

// upsertSubmission creates or refreshes one submission row and its answers.
// The "changed?" check compares through PocketBase's typed getters: a number
// field reads back as float64, so a printed comparison (1.000002e+06 against
// 1000002) would rewrite every row on every pull.
//
// An existing row is re-read inside the transaction: Save writes every column,
// so saving the copy loaded before the loop would write back a stale
// match_status over a staff link made while this pull ran.
func (s *JotformSubmissionsSync) upsertSubmission(
	form *core.Record, year int, sub *jotform.Submission, rec *core.Record,
) error {
	status := strings.ToUpper(strings.TrimSpace(sub.Status))
	if status == "" {
		status = "ACTIVE"
	}
	err := s.App.RunInTransaction(func(tx core.App) error {
		created := rec == nil
		if !created {
			fresh, err := tx.FindRecordById("jotform_submissions", rec.Id)
			if err != nil {
				return fmt.Errorf("re-reading submission %s: %w", sub.ID, err)
			}
			rec = fresh
		}
		if created {
			col, err := tx.FindCollectionByNameOrId("jotform_submissions")
			if err != nil {
				return fmt.Errorf("finding jotform_submissions: %w", err)
			}
			rec = core.NewRecord(col)
			rec.Set("submission_id", sub.ID)
			rec.Set("match_status", matchStatusUnmatched)
		}
		changed := created
		for field, value := range map[string]string{
			"form": form.Id, "submitted_at": sub.CreatedAt, "updated_at": sub.UpdatedAt, "jotform_status": status,
		} {
			if rec.GetString(field) != value {
				rec.Set(field, value)
				changed = true
			}
		}
		for field, value := range map[string]int{"year": year, "session_cm_id": form.GetInt("session_cm_id")} {
			if rec.GetInt(field) != value {
				rec.Set(field, value)
				changed = true
			}
		}
		if changed {
			if err := tx.Save(rec); err != nil {
				return fmt.Errorf("saving submission %s: %w", sub.ID, err)
			}
		}
		answersChanged, err := syncAnswers(tx, rec.Id, jotform.FlattenAnswers(sub.Answers))
		if err != nil {
			return fmt.Errorf("saving answers of %s: %w", sub.ID, err)
		}
		switch {
		case created:
			s.Stats.Created++
		case changed || answersChanged:
			s.Stats.Updated++
		default:
			s.Stats.Skipped++
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("upserting submission %s: %w", sub.ID, err)
	}
	return nil
}

// syncAnswers makes the stored answers of one submission equal rows: creates,
// updates in place, and deletes answers no longer present.
func syncAnswers(tx core.App, submissionRecordID string, rows []jotform.AnswerRow) (bool, error) {
	stored, err := findAllRecords(tx, "jotform_answers", "submission = {:sub}", dbx.Params{"sub": submissionRecordID})
	if err != nil {
		return false, err
	}
	byQuestion := make(map[string]*core.Record, len(stored))
	for _, rec := range stored {
		byQuestion[rec.GetString("question_id")] = rec
	}
	col, err := tx.FindCollectionByNameOrId("jotform_answers")
	if err != nil {
		return false, fmt.Errorf("finding jotform_answers: %w", err)
	}
	changed := false
	keep := make(map[string]bool, len(rows))
	for i := range rows {
		row := &rows[i]
		keep[row.QuestionID] = true
		rec := byQuestion[row.QuestionID]
		if rec == nil {
			rec = core.NewRecord(col)
			rec.Set("submission", submissionRecordID)
			rec.Set("question_id", row.QuestionID)
		} else if answerUnchanged(rec, row) {
			continue
		}
		rec.Set("question_text", row.QuestionText)
		rec.Set("question_type", row.QuestionType)
		rec.Set("answer_text", row.AnswerText)
		rec.Set("order", row.Order)
		if row.AnswerJSON != nil {
			rec.Set("answer_json", types.JSONRaw(row.AnswerJSON))
		} else {
			rec.Set("answer_json", nil)
		}
		if err := tx.Save(rec); err != nil {
			return false, fmt.Errorf("saving answer %s: %w", row.QuestionID, err)
		}
		changed = true
	}
	for qid, rec := range byQuestion {
		if keep[qid] {
			continue
		}
		if err := tx.Delete(rec); err != nil {
			return false, fmt.Errorf("deleting answer %s: %w", qid, err)
		}
		changed = true
	}
	return changed, nil
}

func answerUnchanged(rec *core.Record, row *jotform.AnswerRow) bool {
	return rec.GetString("question_text") == row.QuestionText &&
		rec.GetString("question_type") == row.QuestionType &&
		rec.GetString("answer_text") == row.AnswerText &&
		rec.GetInt("order") == row.Order &&
		compactJSON(jsonFieldBytes(rec.Get("answer_json"))) == compactJSON(row.AnswerJSON)
}

func jsonFieldBytes(v any) []byte {
	switch x := v.(type) {
	case types.JSONRaw:
		return []byte(x)
	case []byte:
		return x
	case string:
		return []byte(x)
	case nil:
		return nil
	default:
		b, _ := json.Marshal(x)
		return b
	}
}

func compactJSON(raw []byte) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var buf bytes.Buffer
	if json.Compact(&buf, raw) != nil {
		return string(raw)
	}
	return buf.String()
}

func readFieldMap(form *core.Record) (jotform.FieldMap, error) {
	raw := jsonFieldBytes(form.Get("field_map"))
	fm := jotform.FieldMap{}
	if compactJSON(raw) == "" {
		return fm, nil
	}
	if err := json.Unmarshal(raw, &fm); err != nil {
		return nil, fmt.Errorf("field_map of form %s is not a role->question map: %w",
			form.GetString("form_id"), err)
	}
	return fm, nil
}

func readFieldMapMeta(form *core.Record) (jotform.FieldMapMeta, error) {
	raw := jsonFieldBytes(form.Get("field_map_meta"))
	meta := jotform.FieldMapMeta{}
	if compactJSON(raw) == "" {
		return meta, nil
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil, fmt.Errorf("field_map_meta of form %s is not a role->meta map: %w",
			form.GetString("form_id"), err)
	}
	return meta, nil
}

func readQuestions(form *core.Record) ([]jotform.FormQuestion, error) {
	raw := jsonFieldBytes(form.Get("questions"))
	var questions []jotform.FormQuestion
	if compactJSON(raw) == "" {
		return questions, nil
	}
	if err := json.Unmarshal(raw, &questions); err != nil {
		return nil, fmt.Errorf("questions of form %s are not a question list: %w", form.GetString("form_id"), err)
	}
	return questions, nil
}

// matchDecision is one submission's re-decided match, before it is written.
// registrationStatus is the matched registration's status text for a
// `cancelled` match. droppedKey names the dropped write-in link this decision
// replaces, so saving it can tell that link from one staff made mid-pull.
type matchDecision struct {
	recordID, submissionID, status string
	registrationStatus, droppedKey string
	result                         jotform.Result
}

// matchPlan is a whole form's re-decided matches: the counts decide whether
// the wrong-guess guard holds them, and only then are they written.
type matchPlan struct {
	writes                            []matchDecision
	staff, auto, cancelled, unmatched int
}

// planMatches re-evaluates every live, non-staff submission of one form. An
// auto match is re-decided each pull, so a guest who cancels drops out of it.
// A filer who matches no enrolled guest is tried against the weekend's other
// registrations and, on a unique hit, recorded `cancelled` (kindred#2759
// follow-up) -- re-decided every pull the same way, so a re-enrolment matches
// normally next time.
//
// A `write_in` link is a staff decision and is left alone while any write-in
// row of the weekend (live board or any scenario) still carries its key. A
// key nothing carries any more is a dropped link -- staff removed that
// write-in -- and the filing is re-decided like an unmatched one.
// Nothing is written here.
func (s *JotformSubmissionsSync) planMatches(form *core.Record, fm jotform.FieldMap, year int) (matchPlan, error) {
	var plan matchPlan
	sessionCMID := form.GetInt("session_cm_id")
	guests, err := s.enrolledGuests(year, sessionCMID)
	if err != nil {
		return plan, err
	}
	others, statusOf, err := s.otherRegistrations(year, sessionCMID, guests)
	if err != nil {
		return plan, err
	}
	liveKeys, err := s.writeInKeys(year, sessionCMID)
	if err != nil {
		return plan, err
	}
	subs, err := findAllRecords(s.App, "jotform_submissions",
		"form = {:form} && jotform_status != {:deleted}",
		dbx.Params{"form": form.Id, "deleted": jotformStatusDeleted})
	if err != nil {
		return plan, err
	}
	answers, err := findAllRecords(s.App, "jotform_answers", "submission.form = {:form}", dbx.Params{"form": form.Id})
	if err != nil {
		return plan, err
	}
	rowsBySub := map[string][]jotform.AnswerRow{}
	for _, a := range answers {
		subID := a.GetString("submission")
		rowsBySub[subID] = append(rowsBySub[subID], jotform.AnswerRow{
			QuestionID: a.GetString("question_id"), QuestionType: a.GetString("question_type"),
			AnswerText: a.GetString("answer_text"), AnswerJSON: jsonFieldBytes(a.Get("answer_json")),
		})
	}

	for _, rec := range subs {
		droppedKey := ""
		switch rec.GetString("match_status") {
		case matchStatusStaff:
			plan.staff++
			continue
		case matchStatusIgnored:
			continue
		case matchStatusWriteIn:
			key := rec.GetString("write_in_key")
			if key != "" && liveKeys[key] {
				continue
			}
			droppedKey = key
		}
		result, cancelled := jotform.MatchRegistration(jotform.ExtractIdentity(rowsBySub[rec.Id], fm), guests, others)
		status, registrationStatus := matchStatusUnmatched, ""
		switch {
		case cancelled:
			status, registrationStatus = matchStatusCancelled, statusOf[result.PersonCMID]
			plan.cancelled++
		case result.PersonCMID > 0:
			status = matchStatusAuto
			plan.auto++
		default:
			plan.unmatched++
		}
		if rec.GetString("match_status") == status && rec.GetInt("person_cm_id") == result.PersonCMID &&
			rec.GetInt("match_tier") == result.Tier && rec.GetString("registration_status") == registrationStatus &&
			rec.GetString("write_in_key") == "" {
			continue
		}
		plan.writes = append(plan.writes, matchDecision{
			recordID: rec.Id, submissionID: rec.GetString("submission_id"), status: status,
			registrationStatus: registrationStatus, droppedKey: droppedKey, result: result,
		})
	}
	return plan, nil
}

// writeInKeys is every write-in link key a row of this weekend still carries,
// on the live board or in any scenario.
func (s *JotformSubmissionsSync) writeInKeys(year, sessionCMID int) (map[string]bool, error) {
	keys := map[string]bool{}
	for _, table := range []string{"lodging_write_ins", "lodging_write_ins_draft"} {
		rows, err := findAllRecords(s.App, table,
			"year = {:year} && session_cm_id = {:session} && write_in_key != ''",
			dbx.Params{"year": year, "session": sessionCMID})
		if err != nil {
			return nil, fmt.Errorf("loading %s links: %w", table, err)
		}
		for _, row := range rows {
			keys[row.GetString("write_in_key")] = true
		}
	}
	return keys, nil
}

// applyMatches writes a plan's changed decisions.
func (s *JotformSubmissionsSync) applyMatches(plan matchPlan) error {
	for _, d := range plan.writes {
		if err := s.saveMatch(d); err != nil {
			return fmt.Errorf("saving match of %s: %w", d.submissionID, err)
		}
	}
	return nil
}

// markDeleted stamps jotform_status DELETED on a FRESH copy of the row, inside
// a transaction: the copy pullForm loaded predates the whole upsert loop, and
// Save writes every column, so marking it would revert a staff link made since.
func (s *JotformSubmissionsSync) markDeleted(recordID string) error {
	err := s.App.RunInTransaction(func(tx core.App) error {
		fresh, err := tx.FindRecordById("jotform_submissions", recordID)
		if err != nil {
			return fmt.Errorf("re-reading: %w", err)
		}
		fresh.Set("jotform_status", jotformStatusDeleted)
		if err := tx.Save(fresh); err != nil {
			return fmt.Errorf("saving: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("in transaction: %w", err)
	}
	return nil
}

// saveMatch writes one match decision onto a FRESH copy of the row, inside a
// transaction, and writes nothing if staff linked, ignored or wrote it in after
// planMatches loaded it: a staff decision is never overwritten, even mid-pull.
func (s *JotformSubmissionsSync) saveMatch(d matchDecision) error {
	err := s.App.RunInTransaction(func(tx core.App) error {
		fresh, err := tx.FindRecordById("jotform_submissions", d.recordID)
		if err != nil {
			return fmt.Errorf("re-reading: %w", err)
		}
		switch fresh.GetString("match_status") {
		case matchStatusStaff, matchStatusIgnored:
			return nil
		case matchStatusWriteIn:
			// Only the dropped link this decision was planned against: a
			// write-in link staff made (or re-made) mid-pull is theirs.
			if d.droppedKey == "" || fresh.GetString("write_in_key") != d.droppedKey {
				return nil
			}
		}
		fresh.Set("match_status", d.status)
		fresh.Set("person_cm_id", d.result.PersonCMID)
		fresh.Set("match_tier", d.result.Tier)
		fresh.Set("registration_status", d.registrationStatus)
		fresh.Set("write_in_key", "")
		if err := tx.Save(fresh); err != nil {
			return fmt.Errorf("saving: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("in transaction: %w", err)
	}
	return nil
}

func (s *JotformSubmissionsSync) enrolledGuests(year, sessionCMID int) ([]jotform.Guest, error) {
	attendees, err := findAllRecords(s.App, "attendees",
		"year = {:year} && status_id = {:status} && session.cm_id = {:session}",
		dbx.Params{"year": year, "status": jotformEnrolledStatus, "session": sessionCMID})
	if err != nil {
		return nil, fmt.Errorf("loading enrolled guests: %w", err)
	}
	return s.guestsOf(year, attendees)
}

// otherRegistrations is the weekend's NON-enrolled registrations (status_id
// != 2: cancelled, incomplete, applied, none...), minus anyone also enrolled,
// with each person's registration status text. A person with several such
// rows reports the first by the stable sort.
func (s *JotformSubmissionsSync) otherRegistrations(
	year, sessionCMID int, enrolled []jotform.Guest,
) ([]jotform.Guest, map[int]string, error) {
	attendees, err := findAllRecords(s.App, "attendees",
		"year = {:year} && status_id != {:status} && session.cm_id = {:session}",
		dbx.Params{"year": year, "status": jotformEnrolledStatus, "session": sessionCMID})
	if err != nil {
		return nil, nil, fmt.Errorf("loading the weekend's other registrations: %w", err)
	}
	isEnrolled := make(map[int]bool, len(enrolled))
	for _, g := range enrolled {
		isEnrolled[g.PersonCMID] = true
	}
	statusOf := map[int]string{}
	kept := make([]*core.Record, 0, len(attendees))
	for _, a := range attendees {
		id := a.GetInt("person_id")
		if id <= 0 || isEnrolled[id] {
			continue
		}
		if _, seen := statusOf[id]; !seen {
			status := strings.TrimSpace(a.GetString("status"))
			if status == "" {
				status = "not enrolled"
			}
			statusOf[id] = status
			kept = append(kept, a)
		}
	}
	guests, err := s.guestsOf(year, kept)
	if err != nil {
		return nil, nil, err
	}
	return guests, statusOf, nil
}

// guestsOf loads the persons behind a set of attendee rows.
func (s *JotformSubmissionsSync) guestsOf(year int, attendees []*core.Record) ([]jotform.Guest, error) {
	ids := make([]string, 0, len(attendees))
	for _, a := range attendees {
		if id := a.GetInt("person_id"); id > 0 {
			ids = append(ids, fmt.Sprint(id))
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	var guests []jotform.Guest
	err := forEachRosterIDChunk(ids, func(filter string, params dbx.Params) error {
		params["year"] = year
		persons, findErr := findAllRecords(s.App, "persons", "year = {:year} && ("+filter+")", params)
		if findErr != nil {
			return findErr
		}
		for _, p := range persons {
			guests = append(guests, jotform.Guest{
				PersonCMID: p.GetInt("cm_id"), First: p.GetString("first_name"),
				Preferred: p.GetString("preferred_name"), Last: p.GetString("last_name"),
				Emails: []string{p.GetString("primary_email"), p.GetString("secondary_email")},
			})
		}
		return nil
	}, "cm_id")
	if err != nil {
		return nil, fmt.Errorf("loading guest persons: %w", err)
	}
	return guests, nil
}

// recordStatus stamps the form's last-pull time and status line. The status is
// capped by RUNES, not bytes, so the cut never splits the UTF-8 "·".
//
// It stamps a FRESH copy of the form, inside a transaction: the copy Sync
// loaded is older than the pull, and Save writes every column, so stamping it
// would revert an admin's field_map or enabled edit made while the pull ran.
func (s *JotformSubmissionsSync) recordStatus(form *core.Record, status string) {
	if r := []rune(status); len(r) > jotformPullStatusMax {
		status = string(r[:jotformPullStatusMax])
	}
	err := s.App.RunInTransaction(func(tx core.App) error {
		fresh, err := tx.FindRecordById("jotform_forms", form.Id)
		if err != nil {
			return fmt.Errorf("re-reading the form: %w", err)
		}
		fresh.Set("last_pulled_at", types.NowDateTime())
		fresh.Set("last_pull_status", status)
		if err := tx.Save(fresh); err != nil {
			return fmt.Errorf("saving the form: %w", err)
		}
		return nil
	})
	if err != nil {
		slog.Warn("Could not record the Jotform pull status", "form", form.GetString("form_id"), "error", err)
	}
}
