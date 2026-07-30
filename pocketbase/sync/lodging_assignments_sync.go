package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const serviceNameLodgingAssignments = "lodging_assignments"

// sourceCampMinderSync labels rows this ingest wrote, so the Plan 3 board can
// distinguish them from staff placements.
const sourceCampMinderSync = "campminder_sync"

// LodgingAssignmentsSync derives lodging_assignments from the two CampMinder
// cabin custom fields.
//
// Like family_camp_derived it calls no external API: it reads
// household_custom_values / person_custom_values / attendees / persons /
// camp_sessions and the lodging registry, all from PocketBase.
type LodgingAssignmentsSync struct {
	App            core.App
	Year           int  // 0 = current year from env
	DryRun         bool // compute but do not write
	Debug          bool
	Stats          Stats
	SyncSuccessful bool

	resolver *AliasResolver
	issues   *IssueRecorder
}

// NewLodgingAssignmentsSync builds the service. Year 0 means "resolve from the
// CAMPMINDER_SEASON_ID env var at Sync time".
func NewLodgingAssignmentsSync(app core.App) *LodgingAssignmentsSync {
	return &LodgingAssignmentsSync{App: app}
}

// Name returns the orchestrator's identifier for this job.
func (s *LodgingAssignmentsSync) Name() string { return serviceNameLodgingAssignments }

// GetStats returns the counters from the most recent Sync.
func (s *LodgingAssignmentsSync) GetStats() Stats { return s.Stats }

// SetDebug enables verbose logging (the orchestrator's Debuggable interface).
func (s *LodgingAssignmentsSync) SetDebug(debug bool) { s.Debug = debug }

// SetYear sets the year to compute (the orchestrator's YearSetter interface).
func (s *LodgingAssignmentsSync) SetYear(year int) { s.Year = year }

func (s *LodgingAssignmentsSync) debugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
}

// Sync computes and writes lodging assignments for one year.
func (s *LodgingAssignmentsSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	s.SyncSuccessful = false

	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			return fmt.Errorf("year resolution failed: %w", err)
		}
	}
	if year < 2017 || year > 2050 {
		return fmt.Errorf("invalid year %d: must be between 2017 and 2050", year)
	}

	slog.Info("Starting lodging assignment ingest", "year", year, "dry_run", s.DryRun)

	var err error
	if s.resolver, err = NewAliasResolver(s.App); err != nil {
		return fmt.Errorf("building alias resolver: %w", err)
	}
	s.issues = NewIssueRecorder(s.App, year)

	fieldTargets, err := LodgingFieldDefIDs(s.App)
	if err != nil {
		return fmt.Errorf("loading source field mappings: %w", err)
	}

	now := time.Now().UTC()
	counts := map[int]int{}

	if hhErr := s.syncHouseholdGrain(ctx, year, fieldTargets, counts, now); hhErr != nil {
		return hhErr
	}

	if s.DryRun {
		slog.Info("Dry run - computed but not writing", "year", year)
		s.SyncSuccessful = true
		return nil
	}

	priorCounts, err := s.valueCountsByCMID(year-1, fieldTargets)
	if err != nil {
		return err
	}

	// Spec 4.4's passive warning: a mapped field that saw values last year and
	// none this year. It is a warning and never an auto-disable -- a form that
	// has not been sent yet looks exactly like a retired field, and inferring
	// retirement would have silently dropped FAM CAMP-Share Comments.
	for _, f := range lodgingSourceFields {
		if counts[f.CMID] == 0 && priorCounts[f.CMID] > 0 {
			s.issues.Record(Issue{
				Kind:        issueFieldZeroValues,
				RawValue:    f.Name,
				SourceField: f.Name,
				Year:        year,
			})
		}
	}

	issuesCreated, issuesUpdated, err := s.issues.Flush(now)
	if err != nil {
		return fmt.Errorf("flushing ingest issues: %w", err)
	}
	s.debugLog("Work queue flushed", "created", issuesCreated, "updated", issuesUpdated)

	if err := UpsertFieldMappingStatus(s.App, year, counts, priorCounts); err != nil {
		return fmt.Errorf("updating field mapping status: %w", err)
	}

	s.SyncSuccessful = true
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	slog.Info("Lodging assignment ingest completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"skipped", s.Stats.Skipped,
		"errors", s.Stats.Errors,
		"queued_issues", issuesCreated+issuesUpdated,
	)
	return nil
}

// syncHouseholdGrain ingests "Family Camp Cabin" -- partition ["Family"], one
// value per household per YEAR, family sessions only.
func (s *LodgingAssignmentsSync) syncHouseholdGrain(
	ctx context.Context, year int, fieldTargets map[string]string, counts map[int]int, now time.Time,
) error {
	sessionIndex, err := BuildHouseholdSessionIndex(s.App, year, []string{sessionTypeFamily})
	if err != nil {
		return fmt.Errorf("building household session index: %w", err)
	}
	householdCMIDs, err := s.householdCMIDsByPBID(year)
	if err != nil {
		return err
	}

	values, err := findAllRecords(s.App, "household_custom_values",
		fmt.Sprintf("year = %d && value != ''", year))
	if err != nil {
		return err
	}

	for _, v := range values {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if fieldTargets[v.GetString("field_definition")] != targetCabinAssignmentHousehold {
			continue
		}
		counts[cmIDFamilyCampCabin]++

		hhCMID := householdCMIDs[v.GetString("household")]
		if hhCMID == 0 {
			continue // household row missing for this year; nothing to key on
		}

		lastUpdated, _ := ParseCampMinderTimestamp(v.GetString("last_updated"))
		s.ingestValue(&ingestContext{
			Year:          year,
			Raw:           v.GetString("value"),
			SourceField:   fieldNameFamilyCampCabin,
			HouseholdCMID: hhCMID,
			Candidates:    sessionIndex[hhCMID],
			LastUpdated:   lastUpdated,
			Now:           now,
		})
	}
	return nil
}

// ingestContext is one observed cabin value, ready to resolve and attribute.
type ingestContext struct {
	Year          int
	Raw           string
	SourceField   string
	HouseholdCMID int
	PersonCMID    int
	Candidates    []SessionWindow
	LastUpdated   time.Time
	Now           time.Time
}

// ingestValue resolves, attributes, and writes one observed cabin value.
// Every failure path queues a work item; none drops the value and none errors
// out of the run.
func (s *LodgingAssignmentsSync) ingestValue(in *ingestContext) {
	res := s.resolver.Resolve(in.Raw, in.Year)
	if !res.Resolved {
		kind := issueUnresolvedAlias
		if res.Ambiguous {
			kind = issueAmbiguousAlias
		}
		s.issues.Record(Issue{
			Kind: kind, RawValue: in.Raw, SourceField: in.SourceField, Year: in.Year,
		})
	}

	attr := AttributeSession(in.Candidates, in.LastUpdated)
	if attr.Reason != attrSingleSession {
		s.issues.Record(Issue{
			Kind:             attr.Reason,
			RawValue:         in.Raw,
			SourceField:      in.SourceField,
			Year:             in.Year,
			HouseholdCMID:    in.HouseholdCMID,
			PersonCMID:       in.PersonCMID,
			SuggestedSession: attr.BestGuess,
			CandidateCMIDs:   attr.CandidateCMIDs(),
		})
		return // flag, do not guess (spec 3.6)
	}

	// History records the OBSERVED label whether or not it resolved --
	// old_unit / new_unit are TEXT for exactly this reason.
	label := in.Raw
	if res.Resolved {
		label = strings.Join(res.UnitCodes, "+")
	}

	if !res.Resolved {
		// Nothing to point a placement at, but the observation is preserved in
		// history and the string is already in the work queue.
		if err := s.recordHistory(in, attr.SessionID, attr.SessionCMID(), label); err != nil {
			slog.Error("Recording unresolved-placement history", "raw", in.Raw, "error", err)
			s.Stats.Errors++
		}
		return
	}

	input := assignmentInput{
		SessionID:     attr.SessionID,
		SessionCMID:   attr.SessionCMID(),
		Year:          in.Year,
		HouseholdCMID: in.HouseholdCMID,
		PersonCMID:    in.PersonCMID,
		SourceField:   in.SourceField,
		NewUnitLabel:  label,
	}
	unitID, mergeID, err := s.placementFor(res, input.SessionID, input.SessionCMID, in.Year, in.Raw)
	if err != nil {
		slog.Error("Materializing merge", "raw", in.Raw, "error", err)
		s.Stats.Errors++
		return
	}
	input.UnitID, input.MergeID = unitID, mergeID

	size, err := s.partySize(in, attr.SessionID)
	if err != nil {
		slog.Error("Computing party size", "raw", in.Raw, "error", err)
	}
	input.PartySize = size

	if s.DryRun {
		return
	}
	if err := s.upsertAssignment(&input, in.Now); err != nil {
		slog.Error("Upserting lodging assignment", "raw", in.Raw, "error", err)
		s.Stats.Errors++
	}
}

// placementFor turns a resolution into the one placement column it belongs in.
// A multi-room alias is materialized as a merge row; a single room points
// straight at the unit. Exactly one of the two is ever non-empty, which is what
// ValidateAssignmentGrain then checks.
func (s *LodgingAssignmentsSync) placementFor(
	res AliasResolution, sessionID string, sessionCMID, year int, raw string,
) (unitID, mergeID string, err error) {
	if !res.IsMerge() {
		return res.UnitIDs[0], "", nil
	}
	mergeID, err = EnsureMerge(s.App, sessionID, sessionCMID, year, "", res.UnitIDs, raw)
	if err != nil {
		return "", "", err
	}
	return "", mergeID, nil
}

// upsertAssignment writes the placement and appends a history row when the
// observed label differs from what is stored.
//
// A staff_touched row is left untouched: a human moved that party on the board
// and CampMinder must not undo it. staff_touched is one-way and GUI-written.
func (s *LodgingAssignmentsSync) upsertAssignment(in *assignmentInput, now time.Time) error {
	if err := ValidateAssignmentGrain(AssignmentGrain{
		HouseholdCMID: in.HouseholdCMID, PersonCMID: in.PersonCMID,
		UnitID: in.UnitID, MergeID: in.MergeID,
	}); err != nil {
		return fmt.Errorf("refusing to write an illegal assignment: %w", err)
	}

	existing, err := s.findAssignment(in)
	if err != nil {
		return err
	}

	if existing != nil && existing.GetBool("staff_touched") {
		s.Stats.Skipped++
		return nil
	}

	oldLabel := ""
	if existing != nil {
		oldLabel = s.labelOf(existing)
	}

	rec := existing
	isNew := rec == nil
	if isNew {
		col, findErr := s.App.FindCollectionByNameOrId("lodging_assignments")
		if findErr != nil {
			return fmt.Errorf("finding lodging_assignments: %w", findErr)
		}
		rec = core.NewRecord(col)
		rec.Set("session", in.SessionID)
		// Required (migration 1500000124). PocketBase's Set on a column that does
		// not exist is a silent no-op, so a schema that has not caught up shows up
		// as a required-field validation error here rather than as a wrong row.
		rec.Set("session_cm_id", in.SessionCMID)
		rec.Set("year", in.Year)
		rec.Set("household_cm_id", in.HouseholdCMID)
		rec.Set("person_cm_id", in.PersonCMID)
		rec.Set("staff_touched", false)
	}
	rec.Set("unit", in.UnitID)
	rec.Set("merge", in.MergeID)
	rec.Set("party_size", in.PartySize)
	rec.Set("source", sourceCampMinderSync)

	if oldLabel == in.NewUnitLabel && !isNew {
		s.Stats.Skipped++
		return nil
	}
	if err := s.App.Save(rec); err != nil {
		return fmt.Errorf("saving assignment: %w", err)
	}
	if isNew {
		s.Stats.Created++
	} else {
		s.Stats.Updated++
	}

	return s.writeHistory(&historyInput{
		HouseholdCMID: in.HouseholdCMID, PersonCMID: in.PersonCMID,
		SessionID: in.SessionID, SessionCMID: in.SessionCMID, Year: in.Year,
		OldUnit: oldLabel, NewUnit: in.NewUnitLabel,
		SourceField: in.SourceField, Now: now,
	})
}

// assignmentInput is one resolved placement ready to write.
type assignmentInput struct {
	SessionID     string
	SessionCMID   int
	Year          int
	HouseholdCMID int
	PersonCMID    int
	UnitID        string
	MergeID       string
	PartySize     int
	SourceField   string
	NewUnitLabel  string
}

func (s *LodgingAssignmentsSync) findAssignment(in *assignmentInput) (*core.Record, error) {
	// scenario = the empty string is the live plan, written as a literal: a BOUND
	// empty parameter matches nothing in PocketBase, so binding it here would miss
	// the row every run and insert a duplicate. Note `> 0` is not used on the party
	// ids because both are compared to a known value, but never write `!= ''`
	// against these columns: PocketBase numbers are NUMERIC DEFAULT 0 NOT NULL and
	// SQLite treats 0-vs-empty-string inequality as TRUE, which would match every
	// row of the other grain.
	const filter = "session = {:session} && year = {:year} && scenario = '' && " +
		"household_cm_id = {:hh} && person_cm_id = {:person}"
	rows, err := s.App.FindRecordsByFilter("lodging_assignments", filter, "", 1, 0, dbx.Params{
		"session": in.SessionID, "year": in.Year,
		"hh": in.HouseholdCMID, "person": in.PersonCMID,
	})
	if err != nil {
		return nil, fmt.Errorf("looking up assignment: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// labelOf renders an existing assignment's placement the same way ingestValue
// renders an observed one, so the two are comparable.
func (s *LodgingAssignmentsSync) labelOf(rec *core.Record) string {
	if unitID := rec.GetString("unit"); unitID != "" {
		return s.resolver.UnitCode(unitID)
	}
	mergeID := rec.GetString("merge")
	if mergeID == "" {
		return ""
	}
	merge, err := s.App.FindRecordById("lodging_merges", mergeID)
	if err != nil {
		return ""
	}
	codes := make([]string, 0, 2)
	for _, id := range merge.GetStringSlice("member_units") {
		codes = append(codes, s.resolver.UnitCode(id))
	}
	return strings.Join(codes, "+")
}

type historyInput struct {
	HouseholdCMID int
	PersonCMID    int
	SessionID     string
	SessionCMID   int
	Year          int
	OldUnit       string
	NewUnit       string
	SourceField   string
	Now           time.Time
}

func (s *LodgingAssignmentsSync) writeHistory(in *historyInput) error {
	col, err := s.App.FindCollectionByNameOrId("lodging_assignment_history")
	if err != nil {
		return fmt.Errorf("finding lodging_assignment_history: %w", err)
	}
	rec := core.NewRecord(col)
	rec.Set("household_cm_id", in.HouseholdCMID)
	rec.Set("person_cm_id", in.PersonCMID)
	rec.Set("session", in.SessionID)
	// Optional here, unlike the placement tables, because a history row is meant
	// to outlive its session with `session` blanked. This is the column that lets
	// such a row still name the weekend it described.
	rec.Set("session_cm_id", in.SessionCMID)
	rec.Set("year", in.Year)
	rec.Set("old_unit", in.OldUnit)
	rec.Set("new_unit", in.NewUnit)
	rec.Set("detected_at", in.Now.Format("2006-01-02 15:04:05.000Z"))
	rec.Set("source_field", in.SourceField)
	if err := s.App.Save(rec); err != nil {
		return fmt.Errorf("saving history: %w", err)
	}
	return nil
}

// recordHistory logs an observation that has no resolvable placement.
func (s *LodgingAssignmentsSync) recordHistory(
	in *ingestContext, sessionID string, sessionCMID int, label string,
) error {
	return s.writeHistory(&historyInput{
		HouseholdCMID: in.HouseholdCMID, PersonCMID: in.PersonCMID,
		SessionID: sessionID, SessionCMID: sessionCMID, Year: in.Year,
		OldUnit: "", NewUnit: label,
		SourceField: in.SourceField, Now: in.Now,
	})
}

// partySize counts the people this placement has to hold: actively enrolled
// persons for the session plus, at household grain, the accompanying adults
// CampMinder does not enroll (they exist only as custom-field values, scraped
// into family_camp_adults).
func (s *LodgingAssignmentsSync) partySize(in *ingestContext, sessionID string) (int, error) {
	if in.PersonCMID > 0 {
		return 1, nil
	}
	persons, err := findAllRecords(s.App, "persons",
		fmt.Sprintf("year = %d && household_id = %d", in.Year, in.HouseholdCMID))
	if err != nil {
		return 0, err
	}
	enrolled := 0
	for _, p := range persons {
		rows, findErr := s.App.FindRecordsByFilter("attendees",
			"person = {:p} && session = {:s} && status_id = {:st}", "", 1, 0, dbx.Params{
				"p": p.Id, "s": sessionID, "st": statusIDActiveEnrolled,
			})
		if findErr != nil {
			return 0, fmt.Errorf("counting attendees: %w", findErr)
		}
		enrolled += len(rows)
	}

	adults, err := findAllRecords(s.App, "family_camp_adults",
		fmt.Sprintf("year = %d", in.Year))
	if err != nil {
		// Deliberate swallow: party_size is a display denormalisation, and a
		// child count alone is more useful to the board than failing the whole
		// ingest because the adults table is missing or unreadable.
		slog.Warn("Adult count unavailable; party size covers children only",
			"household_cm_id", in.HouseholdCMID, "error", err)
		return enrolled, nil //nolint:nilerr // see above
	}
	adultCount := 0
	for _, a := range adults {
		for _, p := range persons {
			if a.GetString("household") == p.GetString("household") && p.GetString("household") != "" {
				adultCount++
				break
			}
		}
	}
	return enrolled + adultCount, nil
}

// householdCMIDsByPBID maps households PB record id -> CampMinder id, because
// household_custom_values.household is a PB relation while every cross-table
// key in this project is a CampMinder id.
func (s *LodgingAssignmentsSync) householdCMIDsByPBID(year int) (map[string]int, error) {
	records, err := findAllRecords(s.App, "households", fmt.Sprintf("year = %d", year))
	if err != nil {
		return nil, err
	}
	out := make(map[string]int, len(records))
	for _, r := range records {
		out[r.Id] = r.GetInt("cm_id")
	}
	return out, nil
}

// valueCountsByCMID counts observed values per source field for a year, feeding
// spec 4.4's passive "0 values in 2026, 171 in 2025" warning.
func (s *LodgingAssignmentsSync) valueCountsByCMID(year int, fieldTargets map[string]string) (map[int]int, error) {
	out := map[int]int{}
	defs, err := findAllRecords(s.App, "custom_field_defs", "")
	if err != nil {
		return out, err
	}
	cmIDByPBID := make(map[string]int, len(defs))
	for _, d := range defs {
		cmIDByPBID[d.Id] = d.GetInt("cm_id")
	}

	for _, collection := range []string{"household_custom_values", "person_custom_values"} {
		rows, findErr := findAllRecords(s.App, collection, fmt.Sprintf("year = %d && value != ''", year))
		if findErr != nil {
			return out, findErr
		}
		for _, r := range rows {
			defPBID := r.GetString("field_definition")
			if _, mapped := fieldTargets[defPBID]; !mapped {
				continue
			}
			out[cmIDByPBID[defPBID]]++
		}
	}
	return out, nil
}

func (s *LodgingAssignmentsSync) forceWALCheckpoint() error {
	db := s.App.DB()
	if db == nil {
		return fmt.Errorf("unable to get database connection")
	}
	if _, err := db.NewQuery("PRAGMA wal_checkpoint(FULL)").Execute(); err != nil {
		return fmt.Errorf("WAL checkpoint failed: %w", err)
	}
	return nil
}
