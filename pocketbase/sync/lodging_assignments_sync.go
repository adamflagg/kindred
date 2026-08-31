package sync

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const serviceNameLodgingAssignments = "lodging_assignments"

// sourceCampMinderSync labels rows this ingest wrote, so the Plan 3 board can
// distinguish them from staff placements.
const sourceCampMinderSync = "campminder_sync"

// sourceFieldOrphanSweep labels a lodging_assignment_history row written by
// deleteLodgingOrphans, so a hard delete driven by cancelled enrollment reads
// distinctly in the audit trail from a row driven by one of the CampMinder
// field names (fieldNameFamilyCampCabin / fieldNameReportableFamilyCampCabin).
const sourceFieldOrphanSweep = "orphan_sweep"

// LodgingAssignmentsSync derives lodging_assignments from the two CampMinder
// cabin custom fields.
//
// Like family_camp_derived it calls no external API: it reads
// household_custom_values / person_custom_values / attendees / persons /
// camp_sessions and the lodging registry, all from PocketBase.
type LodgingAssignmentsSync struct {
	App    core.App
	Year   int  // 0 = current year from env
	DryRun bool // compute but do not write
	Debug  bool
	// ActiveSeasonYear injects the value activeSeasonYear() returns, bypassing
	// CAMPMINDER_SEASON_ID entirely. 0 (the zero value) means "resolve from
	// the environment via ParseSeasonYear() at Sync time", matching Year's
	// existing convention. Set directly by tests exercising the #2028 orphan
	// sweep so they need not reach for t.Setenv, which cannot be combined with
	// t.Parallel() (#2289).
	ActiveSeasonYear int
	Stats            Stats
	SyncSuccessful   bool

	resolver *AliasResolver
	issues   *IssueRecorder

	// Party-size indexes, built once per run. partySize used to query per
	// household: a filtered scan of persons (28k rows) plus a full paged scan of
	// family_camp_adults (10k rows) for EVERY observed cabin value. At ~700
	// households a 2024 backfill did not finish inside a ten-minute timeout.
	// Three scans up front make it linear.
	personsByHouseholdCMID  map[int][]*core.Record
	enrolledByPersonSession map[string]int // "<personPBID>|<sessionPBID>" -> count
	adultsByHouseholdPBID   map[string]int

	// householdSessionIndex / personSessionIndex are the SAME indexes
	// syncHouseholdGrain / syncPersonGrain build to attribute values, captured
	// here so deleteLodgingOrphans can reuse them rather than re-deriving the
	// enrolled set (#2028).
	householdSessionIndex map[int][]SessionWindow
	personSessionIndex    map[int][]SessionWindow
}

// NewLodgingAssignmentsSync builds the service. Year 0 means "resolve from the
// CAMPMINDER_SEASON_ID env var at Sync time".
func NewLodgingAssignmentsSync(app core.App) *LodgingAssignmentsSync {
	return &LodgingAssignmentsSync{App: app}
}

// GetStats returns the counters from the most recent Sync.
func (s *LodgingAssignmentsSync) GetStats() Stats { return s.Stats }

// SetDebug enables verbose logging (the orchestrator's Debuggable interface).
func (s *LodgingAssignmentsSync) SetDebug(debug bool) { s.Debug = debug }

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2334) so a
// unified sync run with dry_run=true reaches the DryRun field that this service's
// Sync() already checks before it writes.
func (s *LodgingAssignmentsSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

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

	// A season with no lodging_units rows at all cannot resolve anything:
	// Resolve is all-or-nothing on (code, year), so every alias's stored
	// member id -- still pointing at whatever year it was last authored
	// against -- misses. Left unguarded that unresolves every cabin: each
	// distinct raw string queues an unresolved_alias work-queue item that
	// never self-clears (IssueRecorder.Flush only sets is_resolved on
	// create), and writeHistory on the unresolved path is unconditional, so
	// every run appends another lodging_assignment_history row per household.
	// Skip and return nil -- one unseeded season must not fail the whole sync
	// run. Two distinguishable messages, because they call for different
	// action: nothing has ever been loaded for this year, vs. a prior season
	// exists but this one has not been carried forward yet. See #2061.
	if !s.resolver.HasUnitsForYear(year) {
		if s.resolver.HasAnyUnits() {
			slog.Warn("lodging_assignments_sync: skipping -- registry has not been rolled forward to this season yet",
				"year", year)
		} else {
			slog.Warn("lodging_assignments_sync: skipping -- no lodging registry has ever been loaded for this season",
				"year", year)
		}
		s.SyncSuccessful = true
		return nil
	}

	s.issues = NewIssueRecorder(s.App, year)

	fieldTargets, err := LodgingFieldDefIDs(s.App)
	if err != nil {
		return fmt.Errorf("loading source field mappings: %w", err)
	}

	now := time.Now().UTC()
	counts := map[int]int{}

	if idxErr := s.buildPartySizeIndexes(year); idxErr != nil {
		return idxErr
	}

	if hhErr := s.syncHouseholdGrain(ctx, year, fieldTargets, counts, now); hhErr != nil {
		return hhErr
	}

	if personErr := s.syncPersonGrain(ctx, year, fieldTargets, counts, now); personErr != nil {
		return personErr
	}

	if s.DryRun {
		slog.Info("Dry run - computed but not writing", "year", year)
		s.SyncSuccessful = true
		return nil
	}

	// #2028: remove mirror rows for a party no longer actively enrolled in the
	// session they name -- e.g. a household that cancelled after being placed.
	// CampMinder never clears the source custom-field value on cancellation, so
	// the ingest above never revisits an existing row once its Candidates go
	// empty; this is the only pass that does.
	//
	// GATED to the season this deployment is actively configured for
	// (CAMPMINDER_SEASON_ID), never merely to whatever `year` this particular
	// call carries. handleLodgingAssignmentsSync's ?year= query param and the
	// orchestrator's historical re-registration (opts.Year) both drive this
	// Sync() with an arbitrary year, and s.householdSessionIndex /
	// s.personSessionIndex above are built from the LOCAL attendees table for
	// THAT year, not from CampMinder. Before this guard, a stale or partial
	// local snapshot for a season that already happened read as "nobody is
	// enrolled", and the sweep hard-deleted real historical placements with no
	// way back. Every year outside the active season keeps the pre-#2028
	// create/update-only behavior that was safe before this pass existed.
	// deleteLodgingOrphans repeats the SyncSuccessful half of this guard
	// itself, matching the idiom every other derived sync in this package
	// uses before its own orphan pass (e.g. FamilyCampDerivedSync.
	// deleteOrphanedAdults, NormalizeGeographicSync, StaffSkillsSync) -- so the
	// check travels with the delete even if this call site is ever moved.
	if active := s.activeSeasonYear(); year != active {
		slog.Info("lodging_assignments_sync: skipping orphan sweep -- year is not the actively configured season",
			"year", year, "configured_season", active)
	} else {
		s.SyncSuccessful = true
		if delErr := s.deleteLodgingOrphans(year, now); delErr != nil {
			return delErr
		}
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
	// Unconditional, unlike the sibling derived syncs that gate on
	// Stats.Created/Updated/Deleted. Those counters only track assignment rows,
	// and this job has three other writers that never touch them: writeHistory
	// for unresolved placements, the work-queue Flush above, and
	// UpsertFieldMappingStatus, which writes a row per source field on every run
	// whatever it found. Reaching this line therefore means the database changed.
	if err := s.forceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	slog.Info("Lodging assignment ingest completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
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
	s.householdSessionIndex = sessionIndex
	householdCMIDs, err := s.cmIDsByPBID("households", year)
	if err != nil {
		return err
	}

	defIDs := defIDsForTarget(fieldTargets, targetCabinAssignmentHousehold)
	if len(defIDs) == 0 {
		return nil // the field is unmapped or disabled; nothing to read
	}
	params := dbx.Params{}
	values, err := findAllRecords(s.App, "household_custom_values",
		fmt.Sprintf("year = %d && value != '' && %s", year, fieldDefClause(defIDs, params)), params)
	if err != nil {
		return err
	}

	for _, v := range values {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		counts[cmIDFamilyCampCabin]++

		hhCMID := householdCMIDs[v.GetString("household")]
		if hhCMID == 0 {
			// No CampMinder id to key a placement on. The value was still
			// observed, and counts[] above has already counted it, so dropping
			// it here would hide it from the field_zero_values warning too.
			s.issues.Record(Issue{
				Kind:        issueUnknownParty,
				RawValue:    v.GetString("value"),
				SourceField: fieldNameFamilyCampCabin,
				Year:        year,
			})
			continue
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

// syncPersonGrain ingests "Reportable Family Camp Cabin" -- partition
// ["Camper","Adult"], person_custom_values, adult weekends.
//
// Measured against 2024/2025: every one of these values whose person has an
// active enrollment is enrolled in an `adult` session and none in a `family` one,
// so the candidate set is adult sessions. The handful with no enrollment at all
// (5 in 2024, 4 in 2025) fall through to a no_session queue item.
func (s *LodgingAssignmentsSync) syncPersonGrain(
	ctx context.Context, year int, fieldTargets map[string]string, counts map[int]int, now time.Time,
) error {
	sessionIndex, err := BuildPersonSessionIndex(s.App, year, []string{sessionTypeAdult})
	if err != nil {
		return fmt.Errorf("building person session index: %w", err)
	}
	s.personSessionIndex = sessionIndex
	personCMIDs, err := s.cmIDsByPBID("persons", year)
	if err != nil {
		return err
	}

	defIDs := defIDsForTarget(fieldTargets, targetCabinAssignmentPerson)
	if len(defIDs) == 0 {
		return nil // the field is unmapped or disabled; nothing to read
	}
	params := dbx.Params{}
	values, err := findAllRecords(s.App, "person_custom_values",
		fmt.Sprintf("year = %d && value != '' && %s", year, fieldDefClause(defIDs, params)), params)
	if err != nil {
		return err
	}

	for _, v := range values {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		counts[cmIDReportableFamilyCampCabin]++

		personCMID := personCMIDs[v.GetString("person")]
		if personCMID == 0 {
			// See the household-grain twin above: counted, unkeyable, and so
			// invisible to every other signal unless it is queued here.
			s.issues.Record(Issue{
				Kind:        issueUnknownParty,
				RawValue:    v.GetString("value"),
				SourceField: fieldNameReportableFamilyCampCabin,
				Year:        year,
			})
			continue
		}

		lastUpdated, _ := ParseCampMinderTimestamp(v.GetString("last_updated"))
		s.ingestValue(&ingestContext{
			Year:        year,
			Raw:         v.GetString("value"),
			SourceField: fieldNameReportableFamilyCampCabin,
			PersonCMID:  personCMID,
			Candidates:  sessionIndex[personCMID],
			LastUpdated: lastUpdated,
			Now:         now,
		})
	}
	return nil
}

// defIDsForTarget returns the custom_field_defs PB ids mapped to one target
// column, sorted so the generated filter is deterministic.
func defIDsForTarget(fieldTargets map[string]string, target string) []string {
	out := make([]string, 0, 2)
	for defID, t := range fieldTargets {
		if t == target {
			out = append(out, defID)
		}
	}
	slices.Sort(out)
	return out
}

// fieldDefClause renders a parenthesised OR of field_definition equalities and
// registers the bound parameters.
//
// This filtering has to happen in SQL, not in Go. person_custom_values holds
// 1.6M rows -- 181k for a single year -- while at most two field definitions are
// ever mapped, so reading the year and discarding the rest paged through
// hundreds of thousands of rows via LIMIT/OFFSET, whose cost grows with the
// offset. Scoping the query to the mapped definitions turns that into a few
// hundred rows.
//
// The ids are PocketBase record ids rather than user input, but they stay
// parameterised anyway: the cost is nil and the habit is what keeps an
// apostrophe-bearing value from becoming a syntax error elsewhere in this file.
func fieldDefClause(defIDs []string, params dbx.Params) string {
	clauses := make([]string, 0, len(defIDs))
	for i, id := range defIDs {
		name := fmt.Sprintf("fd%d", i)
		params[name] = id
		clauses = append(clauses, "field_definition = {:"+name+"}")
	}
	return "(" + strings.Join(clauses, " || ") + ")"
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
		label = unitLabel(res.UnitCodes)
	}

	// Everything above this line computes; everything below it writes. The guard
	// belongs here and not further down because recordHistory -- one of the
	// write paths -- sits upstream of the placement itself, inserting into
	// lodging_assignment_history for a string no alias covers. A guard placed
	// just before upsertAssignment would honor DryRun for the placement table
	// and miss that one. The work queue is unaffected either way -- Record is
	// in-memory, and Sync returns before Flush on a dry run.
	if s.DryRun {
		return
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
		UnitIDs:       s.placementFor(res),
	}
	input.PartySize = s.partySize(in, attr.SessionID)

	if err := s.upsertAssignment(&input, in.Now); err != nil {
		slog.Error("Upserting lodging assignment", "raw", in.Raw, "error", err)
		s.Stats.Errors++
		s.recordWriteFailure(in)
	}
}

// recordWriteFailure queues a value the ingest resolved and attributed but could
// not persist.
//
// Stats.Errors and the log line already record it, but Stats is never written
// anywhere and the log rotates, so without this the value is accounted for
// nowhere the morning after -- the silent drop spec 6.2 rules out, arrived at by
// a different route than an unmapped string.
func (s *LodgingAssignmentsSync) recordWriteFailure(in *ingestContext) {
	s.issues.Record(Issue{
		Kind:          issueWriteFailed,
		RawValue:      in.Raw,
		SourceField:   in.SourceField,
		Year:          in.Year,
		HouseholdCMID: in.HouseholdCMID,
		PersonCMID:    in.PersonCMID,
	})
}

// placementFor turns a resolution into the units a placement occupies.
//
// One room or ten, the answer is the alias's own member set: a merged slot is
// the set, not a row naming it. EnsureMerge existed only because a placement
// could hold a single id.
//
// NOTHING JUDGES THE MEMBER SET HERE, deliberately. Every member_units set is
// hand-authored in the admin UI, the valid configurations are not enumerable as
// tree shape, and no consumer needs the set to match a container -- see
// docs/architecture/lodging-occupancy.md. The ingest records what CampMinder
// holds; constraints belong where a human is choosing, not here.
func (s *LodgingAssignmentsSync) placementFor(res AliasResolution) []string {
	return res.UnitIDs
}

// upsertAssignment writes the placement and appends a history row when the
// observed label differs from what is stored.
//
// A staff_touched row is left untouched: a human moved that party on the board
// and CampMinder must not undo it. staff_touched is one-way and GUI-written.
func (s *LodgingAssignmentsSync) upsertAssignment(in *assignmentInput, now time.Time) error {
	if err := ValidateAssignmentGrain(AssignmentGrain{
		HouseholdCMID: in.HouseholdCMID, PersonCMID: in.PersonCMID,
		UnitIDs: in.UnitIDs,
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

	// Snapshot BEFORE the rec.Set calls below. rec aliases existing on the update
	// path, so every Set mutates the record the comparison would read -- a
	// changed-check written against existing after the Sets compares the new
	// payload with itself and concludes nothing changed, every time.
	oldLabel, oldSource := "", ""
	var oldUnits []string
	oldPartySize := 0
	if existing != nil {
		oldLabel = s.labelOf(existing)
		oldUnits = existing.GetStringSlice("units")
		oldSource = existing.GetString("source")
		oldPartySize = existing.GetInt("party_size")
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
	rec.Set("units", in.UnitIDs)
	rec.Set("party_size", in.PartySize)
	rec.Set("source", sourceCampMinderSync)

	// The label answers "did this party MOVE"; it does not answer "did anything
	// change". party_size is recomputed every run from enrollment and the adults
	// table, both of which move independently of the cabin string, so skipping
	// on the label alone discards a corrected occupancy count for as long as the
	// household stays put -- and buildPartySizeIndexes exists precisely because
	// a wrong party size is a wrong cabin capacity.
	//
	// unitsChanged compares the member SET, not the slice -- see its own comment
	// for why a position-sensitive comparison is not safe here.
	changed := isNew ||
		oldLabel != in.NewUnitLabel ||
		unitsChanged(oldUnits, in.UnitIDs) ||
		oldPartySize != in.PartySize ||
		oldSource != sourceCampMinderSync
	if !changed {
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

	// History is a record of MOVES. A party-size correction in the same cabin is
	// not one, and appending a row for it would fill the audit trail with
	// old_unit == new_unit noise.
	if !isNew && oldLabel == in.NewUnitLabel {
		return nil
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
	UnitIDs       []string
	PartySize     int
	SourceField   string
	NewUnitLabel  string
}

func (s *LodgingAssignmentsSync) findAssignment(in *assignmentInput) (*core.Record, error) {
	// Keyed on session_cm_id, NOT the `session` relation (kindred#2042,
	// migration 1500000147 re-keys idx_lodging_assign_hh_live /
	// idx_lodging_assign_person_live to match). camp_sessions is unique on
	// (cm_id, year), so the two select the same row -- until the camp_sessions
	// record is RECREATED rather than updated, which replaces its PocketBase id
	// and leaves this lookup finding nothing while the row sits in the table.
	// The next sync then writes a duplicate beside it rather than updating it.
	//
	// No scenario clause: migration 1500000132 dropped that column. The ingest
	// owns this table outright and every row in it IS the live plan -- staff
	// planning happens in lodging_assignments_draft, which this sync never
	// touches. Filtering on the column now fails the whole upsert with
	// "unknown field \"scenario\"", so do not reinstate it.
	//
	// Note `> 0` is not used on the three number columns because each is
	// compared to a known value, but never write `!= ''` against any of them:
	// PocketBase numbers are NUMERIC DEFAULT 0 NOT NULL and SQLite treats
	// 0-vs-empty-string inequality as TRUE, which would match every row of the
	// other grain.
	const filter = "session_cm_id = {:sessionCMID} && year = {:year} && " +
		"household_cm_id = {:hh} && person_cm_id = {:person}"
	rows, err := s.App.FindRecordsByFilter("lodging_assignments", filter, "", 1, 0, dbx.Params{
		"sessionCMID": in.SessionCMID, "year": in.Year,
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
//
// AN ID THAT RESOLVES TO NOTHING CONTRIBUTES NOTHING. UnitCode returns the
// empty string for an id it cannot map, and 1500000134's backfill can leave
// exactly that behind -- it copies member_units across verbatim, because
// filtering against lodging_units would silently change what a placement
// points at. Appending the empty code anyway made unitLabel sort it FIRST and
// join it, so a set holding one dangling id and one real room rendered as
// "+<code>" -- an empty label glued to the real one with a leading "+". The
// observed label is only ever built from resolved ids, so the
// two could never match, and upsertAssignment's `oldLabel == in.NewUnitLabel`
// short-circuit failed to fire: writeHistory appended a row claiming the
// household moved out of a cabin whose name began with a "+".
//
// The re-save still happens -- unitsChanged sees the dangling id leave the set
// -- which is right. What must not happen is the history row, because the
// audit trail records MOVES and this party never left its cabin.
func (s *LodgingAssignmentsSync) labelOf(rec *core.Record) string {
	unitIDs := rec.GetStringSlice("units")
	if len(unitIDs) == 0 {
		return ""
	}
	codes := make([]string, 0, len(unitIDs))
	for _, id := range unitIDs {
		if code := s.resolver.UnitCode(id); code != "" {
			codes = append(codes, code)
		}
	}
	if len(codes) == 0 {
		return ""
	}
	return unitLabel(codes)
}

// unitLabel renders member unit codes as a placement label.
//
// The sort is what makes the label comparable. A placement is keyed on the
// member SET, not the slice -- PocketBase returns relation ids in storage
// order, which is not guaranteed stable, so joining in stored order would make
// the label of a multi-room placement depend on which order the ids happened to
// come back in. That would make the same placement read as a move on the next
// run: a re-save and a history row for a household that never left its cabin.
func unitLabel(codes []string) string {
	sorted := slices.Clone(codes)
	slices.Sort(sorted)
	return strings.Join(sorted, "+")
}

// unitsChanged reports whether two unit id lists name a different SET, ignoring
// storage order -- see unitLabel's comment on the same trap. Comparing the
// slices positionally would read a stored reordering as a move.
func unitsChanged(old, current []string) bool {
	a, b := slices.Clone(old), slices.Clone(current)
	slices.Sort(a)
	slices.Sort(b)
	return !slices.Equal(a, b)
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

// buildPartySizeIndexes loads everything partySize needs in three scans.
//
// persons and attendees are hard requirements -- a wrong party size is a wrong
// cabin capacity. The adults table is not: party_size is a display
// denormalisation, and a child count alone is more useful to the board than
// failing the whole ingest because that table is missing or unreadable, so a
// failure there warns and leaves the index empty.
func (s *LodgingAssignmentsSync) buildPartySizeIndexes(year int) error {
	persons, err := findAllRecords(s.App, "persons", fmt.Sprintf("year = %d", year))
	if err != nil {
		return fmt.Errorf("indexing persons for party size: %w", err)
	}
	s.personsByHouseholdCMID = make(map[int][]*core.Record)
	for _, p := range persons {
		if hh := p.GetInt("household_id"); hh > 0 {
			s.personsByHouseholdCMID[hh] = append(s.personsByHouseholdCMID[hh], p)
		}
	}

	attendees, err := findAllRecords(s.App, "attendees",
		fmt.Sprintf("year = %d && status_id = %d", year, statusIDActiveEnrolled))
	if err != nil {
		return fmt.Errorf("indexing attendees for party size: %w", err)
	}
	s.enrolledByPersonSession = make(map[string]int, len(attendees))
	for _, a := range attendees {
		s.enrolledByPersonSession[a.GetString("person")+"|"+a.GetString("session")]++
	}

	s.adultsByHouseholdPBID = make(map[string]int)
	adults, err := findAllRecords(s.App, "family_camp_adults", fmt.Sprintf("year = %d", year))
	if err != nil {
		slog.Warn("Adult index unavailable; party sizes will cover children only",
			"year", year, "error", err)
		return nil //nolint:nilerr // see the doc comment
	}
	for _, a := range adults {
		if hh := a.GetString("household"); hh != "" {
			s.adultsByHouseholdPBID[hh]++
		}
	}
	return nil
}

// partySize counts the people this placement has to hold: actively enrolled
// persons for the session plus, at household grain, the accompanying adults
// CampMinder does not enroll (they exist only as custom-field values, scraped
// into family_camp_adults).
func (s *LodgingAssignmentsSync) partySize(in *ingestContext, sessionID string) int {
	if in.PersonCMID > 0 {
		return 1
	}

	enrolled := 0
	householdPBIDs := make(map[string]bool, 1)
	for _, p := range s.personsByHouseholdCMID[in.HouseholdCMID] {
		// One bed per person: a duplicate attendee row for the same person and
		// weekend is a data anomaly, not a second occupant, so this counts people
		// with an enrollment rather than enrollment rows.
		if s.enrolledByPersonSession[p.Id+"|"+sessionID] > 0 {
			enrolled++
		}
		if hh := p.GetString("household"); hh != "" {
			householdPBIDs[hh] = true
		}
	}

	// Counted over the household's DISTINCT PocketBase ids, so an adult is
	// counted once however many enrolled children share that household.
	adultCount := 0
	for hh := range householdPBIDs {
		adultCount += s.adultsByHouseholdPBID[hh]
	}
	return enrolled + adultCount
}

// activeSeasonYear resolves the year this deployment is actively maintaining
// right now, independent of s.Year. deleteLodgingOrphans must run for THAT
// year alone; any other caller (an explicit ?year= sync, a historical
// re-registration) is asking this ingest to compute placements for a year it
// is not currently responsible for, and must get create/update only.
//
// s.ActiveSeasonYear, when set, is returned directly -- the injection point
// tests use instead of t.Setenv (#2289). When it is unset (the zero value),
// this falls back to CAMPMINDER_SEASON_ID via ParseSeasonYear(), same as
// before. Either way, a resolution failure fails closed: 0 can never equal a
// validated 2017-2050 year (Sync already rejected anything outside that
// range), so an unset/invalid season blocks the sweep rather than
// accidentally allowing it.
func (s *LodgingAssignmentsSync) activeSeasonYear() int {
	if s.ActiveSeasonYear != 0 {
		return s.ActiveSeasonYear
	}
	active, err := ParseSeasonYear()
	if err != nil {
		return 0
	}
	return active
}

// deleteLodgingOrphans removes lodging_assignments rows for a party no longer
// actively enrolled in the session the row names -- #2028's mirror-table half.
//
// Callers: Sync()'s year gate above is the only call site, and it never calls
// this function for a year other than the active season. SyncSuccessful is
// checked again here regardless, matching the shared idiom every other
// derived sync in this package uses before its own orphan pass
// (BaseSyncService.DeleteOrphans; FamilyCampDerivedSync.deleteOrphanedAdults;
// NormalizeGeographicSync; StaffSkillsSync) -- deletion only ever runs once the
// read it is trusting has actually completed, and the check travels with the
// delete rather than living only at one call site.
//
// Orphan detection reuses findLodgingEnrollmentOrphans (stranded_assignment_
// cleanup.go) -- the SAME predicate stranded_assignment_cleanup's production
// audit runs against lodging_assignments -- instead of a hand-rolled copy, so
// the audit log and the actual deletion can never silently disagree about
// which rows are orphaned. That function is driven by absence from
// s.householdSessionIndex / s.personSessionIndex, the SAME indexes
// syncHouseholdGrain / syncPersonGrain just built above, not re-derived --
// exactly as bunk_assignments.deleteOrphans() is driven by absence from its own
// CampMinder pull. A household that cancels after being placed keeps its cabin
// value in household_custom_values (CampMinder does not clear it), so
// ingestValue's Candidates go empty and the row is never revisited by the
// write path; this pass is the only thing that ever will revisit it. The same
// function also carries the per-session reliability guard: a session with zero
// reliably-enrolled parties of a grain is left untouched, so an attendee-sync
// hiccup can't read as "everyone cancelled" and empty the whole session.
//
// staff_touched is NOT a guard here, unlike upsertAssignment's write-path
// skip: that skip protects a staff move from being overwritten by a
// CONFLICTING campminder_sync value, but a cancelled household is not
// attending regardless of who last touched its placement -- the same ruling
// #2028 makes for the draft-null pass in stranded_assignment_cleanup.go.
//
// Every other way a lodging_assignments row changes is recorded in
// lodging_assignment_history (writeHistory, called from upsertAssignment and
// recordHistory above); a hard delete with no history row would be
// unrecoverable AND untraceable, so this writes one too -- OldUnit the
// placement's label just before removal, NewUnit empty, SourceField
// sourceFieldOrphanSweep so it reads distinctly from a CampMinder field name.
func (s *LodgingAssignmentsSync) deleteLodgingOrphans(year int, now time.Time) error {
	if !s.SyncSuccessful {
		slog.Info("lodging_assignments_sync: skipping orphan sweep -- sync not marked successful")
		return nil
	}

	rows, err := findAllRecords(s.App, "lodging_assignments", fmt.Sprintf("year = %d", year))
	if err != nil {
		return fmt.Errorf("querying lodging_assignments for orphan sweep: %w", err)
	}

	byID := make(map[string]*core.Record, len(rows))
	candidates := make([]lodgingOrphanCandidate, 0, len(rows))
	for _, rec := range rows {
		hhCMID := rec.GetInt("household_cm_id")
		personCMID := rec.GetInt("person_cm_id")
		if hhCMID == 0 && personCMID == 0 {
			continue // grain-less row -- not this pass's concern
		}
		byID[rec.Id] = rec
		candidates = append(candidates, lodgingOrphanCandidate{
			RecordID: rec.Id, SessionCMID: rec.GetInt("session_cm_id"),
			HouseholdCMID: hhCMID, PersonCMID: personCMID,
		})
	}

	orphans := findLodgingEnrollmentOrphans(s.householdSessionIndex, s.personSessionIndex, candidates)

	for _, c := range orphans {
		rec := byID[c.RecordID]
		// Snapshot before Delete for the same reason upsertAssignment snapshots
		// before its Sets: nothing guarantees a field read after the mutating
		// call still reflects the pre-delete row.
		oldLabel := s.labelOf(rec)
		// The history row keeps BOTH keys, exactly as writeHistory's own
		// comment explains: `session` so a live row joins, `session_cm_id` so a
		// row that outlives its session can still name the weekend. Read off
		// the record rather than the candidate, which since kindred#2042
		// carries only the CampMinder id.
		sessionID := rec.GetString("session")
		sessionCMID := rec.GetInt("session_cm_id")

		if delErr := s.App.Delete(rec); delErr != nil {
			s.Stats.Errors++
			slog.Error("lodging_assignments_sync: deleting cancelled-party mirror row",
				"id", rec.Id, "household_cm_id", c.HouseholdCMID, "person_cm_id", c.PersonCMID, "error", delErr)
			continue
		}
		s.Stats.Deleted++

		if histErr := s.writeHistory(&historyInput{
			HouseholdCMID: c.HouseholdCMID, PersonCMID: c.PersonCMID,
			SessionID: sessionID, SessionCMID: sessionCMID, Year: year,
			OldUnit: oldLabel, NewUnit: "",
			SourceField: sourceFieldOrphanSweep, Now: now,
		}); histErr != nil {
			s.Stats.Errors++
			slog.Error("lodging_assignments_sync: recording orphan-sweep history",
				"id", c.RecordID, "error", histErr)
		}
	}
	return nil
}

// cmIDsByPBID maps a collection's PB record id -> its CampMinder id for one
// year. Both custom-value tables address their party by PB relation
// (household_custom_values.household, person_custom_values.person) while every
// cross-table key in this project is a CampMinder id, so each grain needs this
// translation before it can key an assignment.
func (s *LodgingAssignmentsSync) cmIDsByPBID(collection string, year int) (map[string]int, error) {
	records, err := findAllRecords(s.App, collection, fmt.Sprintf("year = %d", year))
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

	// Scoped to the mapped definitions for the same reason as the grain scans:
	// counting a prior year must not page through 181k person_custom_values rows.
	defIDs := make([]string, 0, len(fieldTargets))
	for defID := range fieldTargets {
		defIDs = append(defIDs, defID)
	}
	if len(defIDs) == 0 {
		return out, nil
	}
	slices.Sort(defIDs)

	for _, collection := range []string{"household_custom_values", "person_custom_values"} {
		params := dbx.Params{}
		rows, findErr := findAllRecords(s.App, collection,
			fmt.Sprintf("year = %d && value != '' && %s", year, fieldDefClause(defIDs, params)), params)
		if findErr != nil {
			return out, findErr
		}
		for _, r := range rows {
			out[cmIDByPBID[r.GetString("field_definition")]]++
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
