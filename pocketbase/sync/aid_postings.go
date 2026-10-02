package sync

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"slices"
	"sort"
	"strconv"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// CampMinder financial categories that carry aid (analysis §4.2). 3840 and
// 19616 are SP1's aidCategoryFinancialAssistance and aidCategoryJFAM
// (aid_cohort.go). 3839 (Adjustments) is mostly staff discounts and work
// exchange; a 3839 row counts only when aid_sources classifies its description
// as aid (2017's grants).
const (
	aidCategoryAdjustments = 3839

	colAidPostings       = "aid_postings"
	colAidSources        = "aid_sources"
	colAidHouseholdLinks = "aid_household_links"
	colAidOverrides      = "aid_attribution_overrides"

	// aidBlankDescriptionKey keeps an aid row with no description visible.
	aidBlankDescriptionKey = "(blank description)"
)

// financial_transactions field names added by sub-project 1 (migration
// 1500000183, verified). If they ever change, change them here only.
const (
	txnPersonCMID    = "person_cm_id"
	txnHouseholdCMID = "household_cm_id"
	txnCategoryCMID  = "financial_category_cm_id"
)

// AidPostingsSync materializes aid_postings: one row per aid posting (live, or
// the credit leg of a reversed pair kept as history), classified through
// aid_sources and any per-posting reclassification, and attributed by
// aidAttributionContext.
//
// Writes three collections (grain.go): aid_postings (upsert + guarded,
// year-scoped sweep), aid_sources (create only, never updated or swept: a new
// description arrives unclassified or seeded from the private file, D105) and the
// source = "auto" rows of aid_household_links (upsert + sweep; staff rows are
// never touched).
type AidPostingsSync struct {
	App    core.App
	Year   int
	DryRun bool
	Debug  bool
	Stats  Stats
	// ConfigPath pins the aid_sources config file; "" searches ConfigRoots, then
	// ConfigBase's config/ and ../config/. nil roots mean the production defaults
	// and "" base means the working directory.
	ConfigPath  string
	ConfigRoots []string
	ConfigBase  string
	// Season is the live season the daily window (Year 0) is built around; 0 reads
	// CAMPMINDER_SEASON_ID. Tests set it rather than the environment.
	Season int
	// Decisions is sub-project 11's hook. noAidDecisionMatch until then.
	Decisions aidDecisionMatcher
	// LedgerTickTrigger runs campership sub-project 10b's automatic Posted tick for each season this
	// run wrote (TriggerFinancialAidLedgerTicks in production; nil in tests).
	LedgerTickTrigger func(ctx context.Context, year int) error
}

// NewAidPostingsSync returns the service with sub-project 11's decision hook
// unset (noAidDecisionMatch) and the daily season window (Year 0).
func NewAidPostingsSync(app core.App) *AidPostingsSync {
	return &AidPostingsSync{App: app, Decisions: noAidDecisionMatch{}}
}

// GetStats returns the last run's counts.
func (s *AidPostingsSync) GetStats() Stats { return s.Stats }

// SetDebug turns on verbose logging.
func (s *AidPostingsSync) SetDebug(debug bool) { s.Debug = debug }

// SetDryRun makes the next run compute everything and write nothing.
func (s *AidPostingsSync) SetDryRun(dryRun bool) { s.DryRun = dryRun }

// SetYear pins one season; 0 means the daily window N-1..N+1.
func (s *AidPostingsSync) SetYear(year int) { s.Year = year }

// UsesSeasonWindow keeps a current-season queue on the N-1..N+1 window (SeasonWindowed):
// without it, runSyncAndWait would pin the daily run to season N alone.
func (s *AidPostingsSync) UsesSeasonWindow() bool { return true }

// Sync seeds any description the private file names that has no aid_sources row
// yet (D105), then materializes each target season's aid_postings (and the auto
// household links).
func (s *AidPostingsSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	years, err := s.targetYears()
	if err != nil {
		return err
	}
	roots, base := s.ConfigRoots, s.ConfigBase
	if roots == nil {
		roots = defaultAidSourcesConfigRoots
	}
	if base == "" {
		base = "."
	}
	classes, path, candidates, err := loadAidSourcesConfig(s.ConfigPath, roots, base)
	if err != nil {
		return err
	}
	sources, err := s.loadSources()
	if err != nil {
		return err
	}
	if classes != nil {
		slog.Info("Seeding new aid source descriptions from the file", "path", path, "entries", len(classes))
		if err := s.seedSourceClasses(sources, classes); err != nil {
			return err
		}
	} else {
		// F1: prod ran a whole season with the file simply absent from the config mount and
		// nothing said so -- every source stayed unclassified and the budget/level-share view
		// went empty with a clean "success". AidLedgerWarnings is non-fatal but reaches
		// sync_runs (recordSyncRun), unlike Stats.Rejected, which rejection_sites_test.go pins
		// to per-record transform rejections and which also suppresses the collection's orphan
		// sweep -- neither fits a config problem.
		slog.Warn("No aid_sources classification file found; every source stays unclassified",
			"searched", candidates)
		s.Stats.AidLedgerWarnings++
	}
	if stale, asOf := s.staleInputAsOf(); stale {
		// F2: financial_transactions failed last night for both seasons and aid_postings ran
		// anyway, from the previous day's rows, reporting clean success. It still should run
		// (yesterday's data beats none), but the run must say so.
		slog.Warn("aid_postings input may be stale: financial_transactions' last run did not succeed",
			"last_successful_transactions_sync", asOf)
		s.Stats.AidLedgerWarnings++
	}
	// A failed season is logged and the next one still runs; the returned error
	// joins every failure. Matches financial_transactions.go's syncSeasons: a
	// sweep-guard refusal on one season (order N-1, N, N+1) must not stop the
	// live season that follows it.
	var errs []error
	var wrote []int
	for _, year := range years {
		if err := ctx.Err(); err != nil {
			errs = append(errs, err)
			break
		}
		if err := s.syncYear(ctx, year, sources); err != nil {
			slog.Error("Aid postings season failed; continuing with the next",
				"year", year, "error", err)
			errs = append(errs, fmt.Errorf("aid_postings %d: %w", year, err))
			continue
		}
		wrote = append(wrote, year)
	}
	runErr := errors.Join(errs...)
	if !s.DryRun && (s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0) {
		if _, err := s.App.DB().NewQuery("PRAGMA wal_checkpoint(FULL)").Execute(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}
	// The tick runs even when nothing new was written: pricing can change without the ledger. A season
	// whose transactions input is stale is skipped (tickFreshSeasons).
	s.tickFreshSeasons(ctx, wrote)
	slog.Info("Aid postings sync finished", "years", years, "created", s.Stats.Created,
		"updated", s.Stats.Updated, "skipped", s.Stats.Skipped, "deleted", s.Stats.Deleted, "errors", s.Stats.Errors)
	return runErr
}

// targetYears: the explicit year, or N-1..N+1 around the live season, the
// window SP1 re-syncs transactions over every day.
func (s *AidPostingsSync) targetYears() ([]int, error) {
	if s.Year != 0 {
		if !ValidSyncYear(s.Year) {
			return nil, fmt.Errorf("invalid year %d", s.Year)
		}
		return []int{s.Year}, nil
	}
	season := s.Season
	if season == 0 {
		parsed, err := ParseSeasonYear()
		if err != nil {
			return nil, fmt.Errorf("year resolution failed: %w", err)
		}
		season = parsed
	}
	var years []int
	for _, y := range []int{season - 1, season, season + 1} {
		if ValidSyncYear(y) {
			years = append(years, y)
		}
	}
	return years, nil
}

// ------------------------------------------------------------------ sources

type aidSourceView struct {
	Record             *core.Record
	ClassifiedBy       string
	CountsAsAid        bool
	Implied            []string
	SourceFamily       string
	FunderType         string
	CountsTowardBudget bool
}

func aidSourceViewFromRecord(r *core.Record) *aidSourceView {
	var implied []string
	if err := r.UnmarshalJSONField("implied_program_families", &implied); err != nil {
		slog.Warn("aid source implied_program_families unreadable",
			"description_key", r.GetString("description_key"), "error", err)
	}
	return &aidSourceView{Record: r, ClassifiedBy: r.GetString("classified_by"),
		CountsAsAid: r.GetBool("counts_as_aid"), Implied: implied, SourceFamily: r.GetString("source_family"),
		FunderType: r.GetString("funder_type"), CountsTowardBudget: r.GetBool("counts_toward_budget")}
}

// aidEffectiveSource is a posting's classification after any per-posting
// reclassification (aid_attribution_overrides.source_key_override, spec §5).
type aidEffectiveSource struct {
	Key                string
	Family             string
	FunderType         string
	CountsTowardBudget bool
}

// effectiveAidSource applies an override's source_key_override when it names a
// classified source; otherwise the posting keeps its own description's
// classification. A missing or unclassified target is logged, never guessed:
// FastAPI's loader refuses such a target, so this only fires if a source row
// was changed by hand afterwards.
func effectiveAidSource(
	ownKey string, own *aidSourceView, overrideKey string, sources map[string]*aidSourceView,
) aidEffectiveSource {
	if overrideKey != "" {
		if target := sources[overrideKey]; target != nil && target.ClassifiedBy != aidClassifiedUnclassified {
			return aidEffectiveSource{Key: overrideKey, Family: target.SourceFamily, FunderType: target.FunderType,
				CountsTowardBudget: target.CountsTowardBudget}
		}
		slog.Warn("Aid override names a missing or unclassified source; keeping the posting's own",
			"source_key_override", overrideKey, "source_key", ownKey)
	}
	return aidEffectiveSource{Key: ownKey, Family: own.SourceFamily, FunderType: own.FunderType,
		CountsTowardBudget: own.CountsTowardBudget}
}

func (s *AidPostingsSync) loadSources() (map[string]*aidSourceView, error) {
	rows, err := findAllRecords(s.App, colAidSources, "")
	if err != nil {
		return nil, err
	}
	out := make(map[string]*aidSourceView, len(rows))
	for _, r := range rows {
		out[r.GetString("description_key")] = aidSourceViewFromRecord(r)
	}
	return out, nil
}

// seedSourceClasses inserts the config file's classification for each description
// that has no aid_sources row yet. D105: the file is SEED-ONLY. A row that exists --
// unclassified, config_file or staff -- is never written, so a file edit can never
// fight an edit made in the app (FastAPI's PATCH /sources, logged with who and why).
// The file still pre-loads a description before its first posting, and seeds a fresh
// database: Sync calls this before any season, so a file-named description is seeded
// before syncYear could create it unclassified.
func (s *AidPostingsSync) seedSourceClasses(
	sources map[string]*aidSourceView, classes map[string]aidSourceClass,
) error {
	col, err := s.App.FindCollectionByNameOrId(colAidSources)
	if err != nil {
		return fmt.Errorf("finding %s: %w", colAidSources, err)
	}
	keys := make([]string, 0, len(classes))
	for k := range classes {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var namedButUnclassified []string
	for _, key := range keys {
		if view := sources[key]; view != nil {
			// An existing row is an unchanged row: Skipped, like every other one this
			// sync leaves alone (the no-op rerun contract).
			s.Stats.Skipped++
			if view.ClassifiedBy == aidClassifiedUnclassified {
				namedButUnclassified = append(namedButUnclassified, key)
			}
			continue
		}
		c := classes[key]
		if s.DryRun {
			sources[key] = &aidSourceView{ClassifiedBy: aidClassifiedConfigFile, CountsAsAid: c.CountsAsAid,
				Implied: c.ImpliedFamilies, SourceFamily: c.SourceFamily, FunderType: c.FunderType,
				CountsTowardBudget: c.CountsTowardBudget}
			continue
		}
		rec := core.NewRecord(col)
		for k, v := range map[string]any{
			"description_key": key, "description": c.Description, "source_name": c.SourceName,
			"source_family": c.SourceFamily, "funder_type": c.FunderType, "counts_as_aid": c.CountsAsAid,
			"counts_toward_budget": c.CountsTowardBudget, "implied_program_families": c.ImpliedFamilies,
			"classified_by": aidClassifiedConfigFile,
			// The incentive flag starts from the funder type (owner ruling 2026-10-02); staff change it afterwards.
			"incentive": c.FunderType == "incentive",
		} {
			rec.Set(k, v)
		}
		if err := s.App.Save(rec); err != nil {
			return fmt.Errorf("seeding aid source %q: %w", key, err)
		}
		s.Stats.Created++
		sources[key] = aidSourceViewFromRecord(rec)
	}
	if len(namedButUnclassified) > 0 {
		// The file came too late for these: each posted before the file named it, so the
		// sync already holds an unclassified row. Only the app classifies an existing row.
		slog.Warn("aid_sources file names descriptions that already exist unclassified; "+
			"the file only adds new descriptions (D105), so classify these in the app (PATCH /sources)",
			"description_keys", namedButUnclassified)
	}
	return nil
}

func (s *AidPostingsSync) ensureUnclassifiedSource(
	sources map[string]*aidSourceView, key, description string,
) (*aidSourceView, error) {
	view := &aidSourceView{ClassifiedBy: aidClassifiedUnclassified, Implied: []string{},
		SourceFamily: aidSourceFamilyUnclassified, FunderType: aidFunderUnknown}
	if !s.DryRun {
		col, err := s.App.FindCollectionByNameOrId(colAidSources)
		if err != nil {
			return nil, fmt.Errorf("finding %s: %w", colAidSources, err)
		}
		rec := core.NewRecord(col)
		rec.Set("description_key", key)
		rec.Set("description", description)
		rec.Set("source_family", aidSourceFamilyUnclassified)
		rec.Set("funder_type", aidFunderUnknown)
		rec.Set("classified_by", aidClassifiedUnclassified)
		rec.Set("implied_program_families", []string{})
		if err := s.App.Save(rec); err != nil {
			return nil, fmt.Errorf("creating unclassified aid source %q: %w", key, err)
		}
		view.Record = rec
		s.Stats.Created++
	}
	sources[key] = view
	return view, nil
}

// includeAidRow decides whether a live row is aid.
func includeAidRow(category int, amount float64, src *aidSourceView) bool {
	if amount == 0 || src == nil {
		return false
	}
	primary := category == aidCategoryFinancialAssistance || category == aidCategoryJFAM
	if src.ClassifiedBy == aidClassifiedUnclassified {
		return primary
	}
	return src.CountsAsAid && (primary || category == aidCategoryAdjustments)
}

// --------------------------------------------------------------------- year

func (s *AidPostingsSync) syncYear(ctx context.Context, year int, sources map[string]*aidSourceView) error {
	// Live rows, plus the credit leg of every reversed pair (spec §5: reversed
	// rows are kept with their reversal date, so as-of totals work). Both legs of
	// a pair carry is_reversed = true and share the transaction id; the positive
	// reversing leg adds nothing an as-of read needs.
	txns, err := findAllRecords(s.App, "financial_transactions",
		"year = {:year} && (is_reversed = false || amount < 0) && ("+txnCategoryCMID+" = {:fa} || "+
			txnCategoryCMID+" = {:inc} || "+txnCategoryCMID+" = {:adj})",
		dbx.Params{"year": year, "fa": aidCategoryFinancialAssistance, "inc": aidCategoryJFAM, "adj": aidCategoryAdjustments})
	if err != nil {
		return err
	}
	actx, statuses, err := s.buildAttributionContext(year)
	if err != nil {
		return err
	}

	drafts := make([]*aidPostingDraft, 0, len(txns))
	for _, t := range txns {
		category := t.GetInt(txnCategoryCMID)
		amount := t.GetFloat("amount")
		description := t.GetString("description")
		key := normalizeAidLabel(description)
		if key == "" {
			key = aidBlankDescriptionKey
		}
		src := sources[key]
		if src == nil && (category == aidCategoryFinancialAssistance || category == aidCategoryJFAM) {
			if src, err = s.ensureUnclassifiedSource(sources, key, description); err != nil {
				return err
			}
		}
		if !includeAidRow(category, amount, src) {
			continue
		}
		in := aidPostingInput{TransactionCMID: t.GetInt("cm_id"), HouseholdCMID: t.GetInt(txnHouseholdCMID),
			PersonCMID: t.GetInt(txnPersonCMID), ImpliedFamilies: src.Implied}
		class := effectiveAidSource(key, src, actx.Overrides[in.TransactionCMID].SourceKey, sources)
		drafts = append(drafts, &aidPostingDraft{
			Year: year, TransactionCMID: in.TransactionCMID, CategoryCMID: category, HouseholdCMID: in.HouseholdCMID,
			PersonCMID: in.PersonCMID, Amount: amount, SourceKey: key,
			SourceUnclassified: src.ClassifiedBy == aidClassifiedUnclassified, ImpliedFamilies: src.Implied,
			EffectiveSourceKey: class.Key, SourceFamily: class.Family, FunderType: class.FunderType,
			CountsTowardBudget: class.CountsTowardBudget, IsReversed: t.GetBool("is_reversed"),
			PostDate: t.GetDateTime("post_date"), EffectiveDate: t.GetDateTime("effective_date"),
			ReversalDate: t.GetDateTime("reversal_date"), TransactionNote: t.GetString("transaction_note"),
			Attribution: actx.attribute(in),
		})
	}
	computeAidFlags(drafts, statuses)
	s.warnIfMostlyUnclassified(year, drafts)

	if s.DryRun {
		s.Stats.Created += len(drafts)
		return nil
	}
	existing, err := s.loadExistingPostings(year)
	if err != nil {
		return err
	}
	if err := s.upsertPostings(ctx, drafts, existing); err != nil {
		return err
	}
	return s.sweepPostings(ctx, year, drafts, existing)
}

// staleInputAsOf reports whether financial_transactions' most recent recorded run did not
// succeed and, if so, the as-of time (sync_runs.ended) of its last successful run (empty if
// none is on record) -- F2's stale-input guard. Reads sync_runs directly rather than coupling
// to the orchestrator's in-memory state, so this works the same for a manual run and the
// nightly cron. A missing table or empty history is swallowed to "nothing to warn about",
// matching loadAidSourcesConfig's own posture: this check must never fail a run over its own
// telemetry query.
func (s *AidPostingsSync) staleInputAsOf() (stale bool, asOf string) {
	latest, err := s.App.FindRecordsByFilter(syncRunsCollection, "service = {:svc}", "-started", 1, 0,
		dbx.Params{"svc": serviceNameFinancialTransactions})
	if err != nil || len(latest) == 0 || latest[0].GetString("status") == statusSuccess {
		return false, ""
	}
	lastGood, err := s.App.FindRecordsByFilter(syncRunsCollection, "service = {:svc} && status = {:success}",
		"-started", 1, 0, dbx.Params{"svc": serviceNameFinancialTransactions, "success": statusSuccess})
	if err != nil || len(lastGood) == 0 {
		return true, ""
	}
	return true, lastGood[0].GetString("ended")
}

// warnIfMostlyUnclassified logs and counts a warning when more than half of a season's LIVE
// aid postings carry SourceUnclassified (F1): the budget/level-share view goes quietly empty
// well before every source is unclassified, so a strict majority is the loud-enough signal,
// not "any at all" (a single always-unclassified description is normal and not a warning).
func (s *AidPostingsSync) warnIfMostlyUnclassified(year int, drafts []*aidPostingDraft) {
	live, unclassified := 0, 0
	for _, d := range drafts {
		if d.IsReversed {
			continue
		}
		live++
		if d.SourceUnclassified {
			unclassified++
		}
	}
	if live == 0 || unclassified*2 <= live {
		return
	}
	slog.Warn("More than half of this season's live aid postings are unclassified_source",
		"year", year, "unclassified", unclassified, "live", live)
	s.Stats.AidLedgerWarnings++
}

// ------------------------------------------------------------ context build

func (s *AidPostingsSync) buildAttributionContext(year int) (*aidAttributionContext, map[aidPersonSession]int, error) {
	params := dbx.Params{"year": year}
	sessions, err := findAllRecords(s.App, "camp_sessions", "year = {:year}", params)
	if err != nil {
		return nil, nil, err
	}
	sessionCM := map[string]int{}
	sessionType := map[int]string{}
	c := &aidAttributionContext{
		PersonsByHousehold: map[int][]int{}, EnrollmentsByPerson: map[int][]aidEnrollment{},
		SessionFamily: map[int]string{}, SessionByLabel: map[string]int{}, FAAnswersByPerson: map[int][]string{},
		Decisions: s.Decisions,
	}
	for _, r := range sessions {
		cm := r.GetInt("cm_id")
		sessionCM[r.Id] = cm
		sessionType[cm] = r.GetString("session_type")
		c.SessionFamily[cm] = programFamilyForSessionType(sessionType[cm])
		if label := normalizeAidLabel(r.GetString("name")); label != "" {
			c.SessionByLabel[label] = cm
		}
	}

	personHouseholds, ownHouseholds, err := s.loadPersonHouseholds(year)
	if err != nil {
		return nil, nil, err
	}

	attendees, err := findAllRecords(s.App, "attendees", "year = {:year}", params)
	if err != nil {
		return nil, nil, err
	}
	statuses := map[aidPersonSession]int{}
	var linkGroups [][]int
	grouped := map[int]bool{}
	// hasActiveNonAdult and hasActive drive the PersonsByHousehold build below
	// (fix round 1, task review): a guest whose active (status_id = 2)
	// enrollments this season are ALL in adult sessions is indexed only under
	// their own household, never their childhood households, so a posting on
	// the parents' home cannot land on them. Reuses the same session-type test
	// the link-group exclusion below already applies.
	hasActive := map[int]bool{}
	hasActiveNonAdult := map[int]bool{}
	for _, a := range attendees {
		person := a.GetInt("person_id")
		session, ok := sessionCM[a.GetString("session")]
		if person <= 0 || !ok {
			continue
		}
		status := a.GetInt("status_id")
		c.EnrollmentsByPerson[person] = append(c.EnrollmentsByPerson[person], aidEnrollment{
			PersonCMID: person, SessionCMID: session, Family: c.SessionFamily[session], StatusID: status})
		key := aidPersonSession{Person: person, Session: session}
		if prev, seen := statuses[key]; !seen || prev != aidActiveStatusID {
			statuses[key] = status
		}
		if status == aidActiveStatusID {
			hasActive[person] = true
			if sessionType[session] != sessionTypeAdult {
				hasActiveNonAdult[person] = true
			}
		}
		// An adult guest's childhood household is their parents' home, not a
		// second home of the guest's own family (Review Focus 2).
		if sessionType[session] != sessionTypeAdult && !grouped[person] {
			grouped[person] = true
			linkGroups = append(linkGroups, personHouseholds[person])
		}
	}
	for person, households := range personHouseholds {
		if hasActive[person] && !hasActiveNonAdult[person] {
			households = ownHouseholds[person]
		}
		for _, h := range households {
			c.PersonsByHousehold[h] = append(c.PersonsByHousehold[h], person)
		}
	}

	links, err := s.syncHouseholdLinks(year, computeAutoHouseholdLinks(linkGroups))
	if err != nil {
		return nil, nil, err
	}
	c.Families = newAidFamilyIndex(links)

	if c.FAAnswersByPerson, err = s.loadFAAnswers(year); err != nil {
		return nil, nil, err
	}
	if c.Overrides, err = s.loadOverrides(year); err != nil {
		return nil, nil, err
	}
	return c, statuses, nil
}

// loadPersonHouseholds maps each person to their own household plus their
// primary and alternate childhood households, as CampMinder ids (all), and
// separately to just their own household (own) -- what an adult-only guest is
// indexed under instead (fix round 1, task review).
func (s *AidPostingsSync) loadPersonHouseholds(year int) (all, own map[int][]int, err error) {
	params := dbx.Params{"year": year}
	households, err := findAllRecords(s.App, "households", "year = {:year}", params)
	if err != nil {
		return nil, nil, err
	}
	householdCM := make(map[string]int, len(households))
	for _, h := range households {
		householdCM[h.Id] = h.GetInt("cm_id")
	}
	persons, err := findAllRecords(s.App, "persons", "year = {:year}", params)
	if err != nil {
		return nil, nil, err
	}
	all = make(map[int][]int, len(persons))
	own = make(map[int][]int, len(persons))
	for _, p := range persons {
		cm := p.GetInt("cm_id")
		own[cm] = positiveUnique([]int{p.GetInt("household_id"), householdCM[p.GetString("household")]})
		all[cm] = positiveUnique([]int{
			p.GetInt("household_id"),
			householdCM[p.GetString("household")],
			householdCM[p.GetString("primary_childhood_household")],
			householdCM[p.GetString("alternate_childhood_household")],
		})
	}
	return all, own, nil
}

// syncHouseholdLinks writes missing auto rows, sweeps stale auto rows, and
// returns the season's effective links (staff rows plus unshadowed auto rows).
func (s *AidPostingsSync) syncHouseholdLinks(year int, auto []aidHouseholdLink) ([]aidHouseholdLink, error) {
	rows, err := findAllRecords(s.App, colAidHouseholdLinks, "year = {:year}", dbx.Params{"year": year})
	if err != nil {
		return nil, err
	}
	existingAuto := map[string]*core.Record{}
	var staff []aidHouseholdLink
	staffKeys := map[string]bool{}
	for _, r := range rows {
		l := aidHouseholdLink{HouseholdCMID: r.GetInt("household_cm_id"), FamilyKey: r.GetString("family_key"),
			Source: r.GetString("source"), Excluded: r.GetBool("excluded")}
		key := aidLinkKey(l.HouseholdCMID, l.FamilyKey)
		if l.Source == aidLinkSourceStaff {
			staff = append(staff, l)
			staffKeys[key] = true
			continue
		}
		existingAuto[key] = r
	}
	effective := mergeHouseholdLinks(auto, staff)
	if s.DryRun {
		return effective, nil
	}
	col, err := s.App.FindCollectionByNameOrId(colAidHouseholdLinks)
	if err != nil {
		return nil, fmt.Errorf("finding %s: %w", colAidHouseholdLinks, err)
	}
	wanted := map[string]bool{}
	for _, l := range auto {
		key := aidLinkKey(l.HouseholdCMID, l.FamilyKey)
		if staffKeys[key] {
			continue
		}
		wanted[key] = true
		if existingAuto[key] != nil {
			s.Stats.Skipped++
			continue
		}
		rec := core.NewRecord(col)
		rec.Set("year", year)
		rec.Set("household_cm_id", l.HouseholdCMID)
		rec.Set("family_key", l.FamilyKey)
		rec.Set("source", aidLinkSourceAuto)
		rec.Set("excluded", false)
		if err := s.App.Save(rec); err != nil {
			return nil, fmt.Errorf("saving household link %s: %w", key, err)
		}
		s.Stats.Created++
	}
	// An empty computed set is a season with no multi-household family, not a
	// collapse to refuse on; skip the sweep then, as camper_dietary does.
	if len(wanted) == 0 {
		return effective, nil
	}
	guard := OrphanSweepGuard{Entity: colAidHouseholdLinks, Year: year, Computed: len(wanted),
		Hint: "check that persons and households synced for this season"}
	if err := guard.Check(len(existingAuto)); err != nil {
		return nil, wrapOrphanSweepError(err)
	}
	for key, rec := range existingAuto {
		if wanted[key] {
			continue
		}
		deleted, err := s.deleteIfStillAuto(rec.Id)
		if err != nil {
			slog.Error("Error deleting stale household link", "key", key, "error", err)
			s.Stats.Errors++
			continue
		}
		if !deleted {
			s.Stats.Skipped++
			continue
		}
		s.Stats.Deleted++
	}
	return effective, nil
}

// deleteIfStillAuto deletes a stale automatic link on a FRESH copy of the row,
// inside a transaction, and only while it is still automatic. The sweep's copy
// was read before the loop, and a person may have turned that very row into a
// staff exclusion since (FastAPI's create_link updates it in place to source
// "staff"): deleting by the old copy's id would delete the exclusion
// (Ruling 2026-10-01 (plan review), campership G6). A row already gone is not
// an error: there is nothing left to sweep.
func (s *AidPostingsSync) deleteIfStillAuto(recordID string) (bool, error) {
	deleted := false
	err := s.App.RunInTransaction(func(tx core.App) error {
		fresh, err := tx.FindRecordById(colAidHouseholdLinks, recordID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("re-reading: %w", err)
		}
		if fresh.GetString("source") != aidLinkSourceAuto {
			return nil
		}
		if err := tx.Delete(fresh); err != nil {
			return fmt.Errorf("deleting: %w", err)
		}
		deleted = true
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("in transaction: %w", err)
	}
	return deleted, nil
}

func (s *AidPostingsSync) loadFAAnswers(year int) (map[int][]string, error) {
	rows, err := findAllRecords(s.App, "financial_aid_applications", "year = {:year}", dbx.Params{"year": year})
	if err != nil {
		return nil, err
	}
	out := map[int][]string{}
	for _, r := range rows {
		person := r.GetInt("person_id")
		for _, field := range []string{"summer_program", "fc_program", "tbm_program"} {
			if v := r.GetString(field); v != "" && person > 0 {
				out[person] = append(out[person], v)
			}
		}
	}
	return out, nil
}

func (s *AidPostingsSync) loadOverrides(year int) (map[int]aidOverride, error) {
	rows, err := findAllRecords(s.App, colAidOverrides, "year = {:year}", dbx.Params{"year": year})
	if err != nil {
		return nil, err
	}
	out := make(map[int]aidOverride, len(rows))
	for _, r := range rows {
		out[r.GetInt("transaction_cm_id")] = aidOverride{PersonCMID: r.GetInt("attributed_person_cm_id"),
			SessionCMID: r.GetInt("attributed_session_cm_id"), Family: r.GetString("program_family"),
			Source: r.GetString("source"), SourceKey: r.GetString("source_key_override")}
	}
	return out, nil
}

// ----------------------------------------------------------------- postings

// aidPostingKey is the ONE key builder for both the write and the sweep, so
// the two cannot disagree (grain.go's concern).
func aidPostingKey(transactionCMID int, amount float64, year int) string {
	return fmt.Sprintf("%d|%s|%d", transactionCMID, strconv.FormatFloat(amount, 'f', 2, 64), year)
}

func (d *aidPostingDraft) data() map[string]any {
	a := d.Attribution
	candidates := a.CandidateFamilies
	if candidates == nil {
		candidates = []string{}
	}
	flags := d.Flags
	if flags == nil {
		flags = []string{}
	}
	return map[string]any{
		"year": d.Year, "transaction_cm_id": d.TransactionCMID, "amount": d.Amount,
		"financial_category_cm_id": d.CategoryCMID, "household_cm_id": d.HouseholdCMID,
		"person_cm_id": d.PersonCMID, "source_key": d.SourceKey, "effective_source_key": d.EffectiveSourceKey,
		"source_family": d.SourceFamily, "funder_type": d.FunderType, "counts_toward_budget": d.CountsTowardBudget,
		"is_reversed": d.IsReversed, "reversal_date": d.ReversalDate, "transaction_note": d.TransactionNote,
		"post_date": d.PostDate, "effective_date": d.EffectiveDate,
		"attributed_person_cm_id": a.PersonCMID, "attributed_session_cm_id": a.SessionCMID,
		"program_family": a.Family, "attribution_level": a.Level, "attribution_method": a.Method,
		"candidate_program_families": candidates, "request_id": a.RequestID, "flags": flags,
	}
}

func (s *AidPostingsSync) loadExistingPostings(year int) (map[string]*core.Record, error) {
	rows, err := findAllRecords(s.App, colAidPostings, "year = {:year}", dbx.Params{"year": year})
	if err != nil {
		return nil, err
	}
	out := make(map[string]*core.Record, len(rows))
	for _, r := range rows {
		out[aidPostingKey(r.GetInt("transaction_cm_id"), r.GetFloat("amount"), r.GetInt("year"))] = r
	}
	return out, nil
}

func (s *AidPostingsSync) upsertPostings(
	ctx context.Context, drafts []*aidPostingDraft, existing map[string]*core.Record,
) error {
	col, err := s.App.FindCollectionByNameOrId(colAidPostings)
	if err != nil {
		return fmt.Errorf("finding %s: %w", colAidPostings, err)
	}
	for _, d := range drafts {
		if err := ctx.Err(); err != nil {
			return err
		}
		data := d.data()
		rec := existing[aidPostingKey(d.TransactionCMID, d.Amount, d.Year)]
		isNew := rec == nil
		if isNew {
			rec = core.NewRecord(col)
		} else if !aidRecordNeedsUpdate(rec, data) {
			s.Stats.Skipped++
			continue
		}
		for k, v := range data {
			rec.Set(k, v)
		}
		if err := s.App.Save(rec); err != nil {
			slog.Error("Error saving aid posting", "transaction_cm_id", d.TransactionCMID, "year", d.Year, "error", err)
			s.Stats.Errors++
			continue
		}
		if isNew {
			s.Stats.Created++
		} else {
			s.Stats.Updated++
		}
	}
	return nil
}

// sweepPostings deletes this season's postings that no aid row produced (live
// or a reversed credit leg). A reversal is an update, not a sweep: the row keeps
// its key. What gets swept is a row CampMinder no longer returns, or one whose
// description is no longer classified as aid.
// Skipped when the season has no financial_transactions at all (not synced
// yet, or a failed first sync): that is missing input, not an empty ledger.
func (s *AidPostingsSync) sweepPostings(
	ctx context.Context, year int, drafts []*aidPostingDraft, existing map[string]*core.Record,
) error {
	total, err := s.App.CountRecords("financial_transactions", dbx.HashExp{"year": year})
	if err != nil {
		return fmt.Errorf("counting financial_transactions: %w", err)
	}
	if total == 0 {
		slog.Info("Skipping aid_postings sweep: the season has no financial_transactions", "year", year)
		return nil
	}
	computed := make(map[string]bool, len(drafts))
	for _, d := range drafts {
		computed[aidPostingKey(d.TransactionCMID, d.Amount, d.Year)] = true
	}
	guard := OrphanSweepGuard{Entity: colAidPostings, Year: year, Computed: len(computed),
		Hint: "check that financial_transactions synced this season and that aid_sources " +
			"still classifies its descriptions as aid"}
	if err := guard.Check(len(existing)); err != nil {
		return wrapOrphanSweepError(err)
	}
	for key, rec := range existing {
		if err := ctx.Err(); err != nil {
			return wrapOrphanSweepError(err)
		}
		if computed[key] {
			continue
		}
		if err := s.App.Delete(rec); err != nil {
			slog.Error("Error deleting orphan aid posting", "key", key, "error", err)
			s.Stats.Errors++
			continue
		}
		s.Stats.Deleted++
	}
	return nil
}

// aidRecordNeedsUpdate compares by the type of the NEW value. JSON arrays are
// compared as decoded slices and dates as their string form, so a re-run with
// no upstream change writes nothing (Review Focus 4).
func aidRecordNeedsUpdate(rec *core.Record, data map[string]any) bool {
	for field, want := range data {
		switch v := want.(type) {
		case []string:
			var have []string
			if err := rec.UnmarshalJSONField(field, &have); err != nil || !slices.Equal(have, v) {
				return true
			}
		case types.DateTime:
			if rec.GetDateTime(field).String() != v.String() {
				return true
			}
		case string:
			if rec.GetString(field) != v {
				return true
			}
		case bool:
			if rec.GetBool(field) != v {
				return true
			}
		case int:
			if rec.GetInt(field) != v {
				return true
			}
		case float64:
			if math.Abs(rec.GetFloat(field)-v) > 1e-6 {
				return true
			}
		default:
			return true
		}
	}
	return false
}
