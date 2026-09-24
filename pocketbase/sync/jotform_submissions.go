package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/camp/kindred/pocketbase/jotform"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const serviceNameJotformSubmissions = "jotform_submissions"

const (
	jotformStatusDeleted  = "DELETED"
	matchStatusAuto       = "auto"
	matchStatusStaff      = "staff"
	matchStatusUnmatched  = "unmatched"
	matchStatusIgnored    = "ignored"
	jotformPullStatusMax  = 2000
	jotformEnrolledStatus = 2
)

// JotformFetcher is the slice of the Jotform client this job uses; tests fake it.
type JotformFetcher interface {
	FormSubmissions(ctx context.Context, formID string) ([]jotform.Submission, error)
}

// JotformSubmissionsSync pulls every ENABLED adult-weekend form for the season
// (kindred#2759), stores every answered question generically, marks vanished
// submissions DELETED, and auto-matches with jotform.Match against the
// session's enrolled guests. Rows staff linked or ignored are never touched.
//
// Not CampMinder: it has its own key (JOTFORM_API_KEY) and base URL
// (JOTFORM_API_BASE). Until the enterprise-account move it runs only on an
// explicit trigger (admin "Pull now" / the individual route); P2 adds the
// daily cadence.
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
	var firstErr error
	for _, form := range forms {
		pullErr := s.pullForm(ctx, fetcher, form, year)
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
	ctx context.Context, fetcher JotformFetcher, form *core.Record, year int,
) error {
	fieldMap, err := readFieldMap(form)
	if err != nil {
		return err
	}
	subs, err := fetcher.FormSubmissions(ctx, form.GetString("form_id"))
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
		rec.Set("jotform_status", jotformStatusDeleted)
		if saveErr := s.App.Save(rec); saveErr != nil {
			return fmt.Errorf("marking submission %s deleted: %w", id, saveErr)
		}
		s.Stats.Deleted++
	}

	if !fieldMap.HasIdentity() {
		s.recordStatus(form, fmt.Sprintf(
			"ok · %d submissions stored · matching skipped: map first and last name", len(subs)))
		return nil
	}
	matched, unmatched, err := s.matchForm(form, fieldMap, year)
	if err != nil {
		return err
	}
	s.recordStatus(form, fmt.Sprintf("ok · %d submissions · %d matched · %d unmatched",
		len(subs), matched, unmatched))
	return nil
}

// upsertSubmission creates or refreshes one submission row and its answers.
// The "changed?" check compares through PocketBase's typed getters: a number
// field reads back as float64, so a printed comparison (1.000002e+06 against
// 1000002) would rewrite every row on every pull.
func (s *JotformSubmissionsSync) upsertSubmission(
	form *core.Record, year int, sub *jotform.Submission, rec *core.Record,
) error {
	status := strings.ToUpper(strings.TrimSpace(sub.Status))
	if status == "" {
		status = "ACTIVE"
	}
	err := s.App.RunInTransaction(func(tx core.App) error {
		created := rec == nil
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

// matchForm re-evaluates every live, non-staff submission of one form. An auto
// match is re-decided each pull, so a guest who cancels drops back to staff.
func (s *JotformSubmissionsSync) matchForm(
	form *core.Record, fm jotform.FieldMap, year int,
) (matched, unmatched int, err error) {
	guests, err := s.enrolledGuests(year, form.GetInt("session_cm_id"))
	if err != nil {
		return 0, 0, err
	}
	subs, err := findAllRecords(s.App, "jotform_submissions",
		"form = {:form} && jotform_status != {:deleted}",
		dbx.Params{"form": form.Id, "deleted": jotformStatusDeleted})
	if err != nil {
		return 0, 0, err
	}
	answers, err := findAllRecords(s.App, "jotform_answers", "submission.form = {:form}", dbx.Params{"form": form.Id})
	if err != nil {
		return 0, 0, err
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
		switch rec.GetString("match_status") {
		case matchStatusStaff:
			matched++
			continue
		case matchStatusIgnored:
			continue
		}
		result := jotform.Match(jotform.ExtractIdentity(rowsBySub[rec.Id], fm), guests)
		status := matchStatusUnmatched
		if result.PersonCMID > 0 {
			status = matchStatusAuto
			matched++
		} else {
			unmatched++
		}
		if rec.GetString("match_status") == status && rec.GetInt("person_cm_id") == result.PersonCMID &&
			rec.GetInt("match_tier") == result.Tier {
			continue
		}
		rec.Set("match_status", status)
		rec.Set("person_cm_id", result.PersonCMID)
		rec.Set("match_tier", result.Tier)
		if err := s.App.Save(rec); err != nil {
			return 0, 0, fmt.Errorf("saving match of %s: %w", rec.GetString("submission_id"), err)
		}
	}
	return matched, unmatched, nil
}

func (s *JotformSubmissionsSync) enrolledGuests(year, sessionCMID int) ([]jotform.Guest, error) {
	attendees, err := findAllRecords(s.App, "attendees",
		"year = {:year} && status_id = {:status} && session.cm_id = {:session}",
		dbx.Params{"year": year, "status": jotformEnrolledStatus, "session": sessionCMID})
	if err != nil {
		return nil, fmt.Errorf("loading enrolled guests: %w", err)
	}
	ids := make([]string, 0, len(attendees))
	for _, a := range attendees {
		if id := a.GetInt("person_id"); id > 0 {
			ids = append(ids, fmt.Sprint(id))
		}
	}
	var guests []jotform.Guest
	err = forEachRosterIDChunk(ids, func(filter string, params dbx.Params) error {
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
func (s *JotformSubmissionsSync) recordStatus(form *core.Record, status string) {
	if r := []rune(status); len(r) > jotformPullStatusMax {
		status = string(r[:jotformPullStatusMax])
	}
	form.Set("last_pulled_at", types.NowDateTime())
	form.Set("last_pull_status", status)
	if err := s.App.Save(form); err != nil {
		slog.Warn("Could not record the Jotform pull status", "form", form.GetString("form_id"), "error", err)
	}
}
