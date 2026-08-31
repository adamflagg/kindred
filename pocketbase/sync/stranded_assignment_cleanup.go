// Package sync provides synchronization services between CampMinder and PocketBase.
package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
)

// msgOrphanProd is the Warn message for the observe-only production audit.
// Hoisted to a const to keep the call site within the line-length limit.
const msgOrphanProd = "stranded_assignment_cleanup: orphaned production assignments detected " +
	"(bunk lost its plan or camper no longer enrolled) — not deleted (bunk_assignments sync owns prod cleanup)"

// msgOrphanLodgingProd is the Warn message for the lodging mirror's
// observe-only audit -- lodging_assignments' actual deletion is
// LodgingAssignmentsSync.deleteLodgingOrphans' job (#2028), driven by absence
// from the CampMinder cabin value, the same split of responsibility
// bunk_assignments has with msgOrphanProd above.
const msgOrphanLodgingProd = "stranded_assignment_cleanup: orphaned production lodging_assignments detected " +
	"(party no longer enrolled) — not deleted (lodging_assignments_sync owns prod cleanup)"

// strandedCandidate is the minimal projection of an assignment row needed for
// orphan-detection — decoupled from *core.Record so the detection logic is
// unit-testable without a database. BunkID drives bunk-stranding (the bunk lost
// its plan); PersonID drives enrollment-orphaning (the camper cancelled).
type strandedCandidate struct {
	RecordID  string
	SessionID string
	BunkID    string
	PersonID  string
}

// strandedPairKey builds the composite key used to test membership of a
// (session, X) pair — X is a bunk for plan validity, or a person for enrollment.
// Both args are PocketBase record IDs.
func strandedPairKey(sessionID, otherID string) string {
	return sessionID + ":" + otherID
}

// findStrandedAssignments returns the candidates whose (session, bunk) pair is
// absent from validPairs — i.e. the bunk has no bunk_plan for that session.
// Candidates with no bunk are skipped (already unassigned). Candidates whose
// session is absent from plannedSessions are also skipped: a session with zero
// bunk_plans is unreliable (that session's plans may have failed to sync), so
// sweeping its drafts would null every valid assignment for the session.
func findStrandedAssignments(
	validPairs, plannedSessions map[string]bool,
	candidates []strandedCandidate,
) []strandedCandidate {
	stranded := []strandedCandidate{}
	for _, c := range candidates {
		if c.BunkID == "" {
			continue
		}
		if !plannedSessions[c.SessionID] {
			continue
		}
		if !validPairs[strandedPairKey(c.SessionID, c.BunkID)] {
			stranded = append(stranded, c)
		}
	}
	return stranded
}

// findEnrollmentOrphans returns the candidates whose (session, person) pair is
// absent from enrolledPairs — i.e. the camper is no longer actively enrolled
// (status_id=2) in that session. Candidates with no person are skipped.
// Candidates whose session is absent from enrolledSessions are also skipped: a
// session with zero enrolled attendees is unreliable (attendees may have failed
// to sync), so sweeping its drafts would null every assignment for the session.
// Mirrors findStrandedAssignments — the same guard shape, keyed on the camper
// instead of the bunk.
func findEnrollmentOrphans(
	enrolledSessions, enrolledPairs map[string]bool,
	candidates []strandedCandidate,
) []strandedCandidate {
	orphans := []strandedCandidate{}
	for _, c := range candidates {
		if c.PersonID == "" {
			continue
		}
		if !enrolledSessions[c.SessionID] {
			continue
		}
		if !enrolledPairs[strandedPairKey(c.SessionID, c.PersonID)] {
			orphans = append(orphans, c)
		}
	}
	return orphans
}

// dedupeByRecordID merges candidate slices, keeping the first occurrence of each
// RecordID — a row flagged by both passes (bunk gone AND camper cancelled) is
// handled once.
func dedupeByRecordID(groups ...[]strandedCandidate) []strandedCandidate {
	seen := make(map[string]bool)
	merged := []strandedCandidate{}
	for _, g := range groups {
		for _, c := range g {
			if seen[c.RecordID] {
				continue
			}
			seen[c.RecordID] = true
			merged = append(merged, c)
		}
	}
	return merged
}

// loadEnrolledAttendeeSets returns (enrolledSessions, enrolledPairs) built from
// status_id=2 attendees for the year. On query failure it records the error and
// returns empty maps — the enrollment-orphan pass then becomes a no-op via its
// per-session guard (fail closed: never sweep on enrollment we couldn't read).
func loadEnrolledAttendeeSets(app core.App, year int, stats *Stats) (enrolledSessions, enrolledPairs map[string]bool) {
	enrolledSessions = make(map[string]bool)
	enrolledPairs = make(map[string]bool)
	attendees, err := app.FindRecordsByFilter("attendees", fmt.Sprintf("year = %d && status_id = 2", year), "", 0, 0)
	if err != nil {
		stats.Errors++
		slog.Error("stranded_assignment_cleanup: query attendees (enrollment pass skipped)", "error", err)
		return enrolledSessions, enrolledPairs
	}
	for _, a := range attendees {
		sessionID := a.GetString("session")
		enrolledSessions[sessionID] = true
		enrolledPairs[strandedPairKey(sessionID, a.GetString("person"))] = true
	}
	return enrolledSessions, enrolledPairs
}

// lodgingOrphanCandidate is the minimal projection of a lodging placement row
// (draft or mirror) needed for enrollment-orphan detection. Dual grain: at
// most one of HouseholdCMID / PersonCMID is set, matching lodging_assignments'
// own dual-grain rule (1500000119).
type lodgingOrphanCandidate struct {
	RecordID string
	// The weekend's CampMinder id, read off the row's own `session_cm_id`
	// rather than its `session` relation (kindred#2042). The relation's PB id
	// is replaced when a camp_sessions record is recreated rather than
	// updated, which re-points the attendees but not the lodging rows -- and
	// every candidate then falls through the per-session reliability guard, so
	// the sweep silently becomes a permanent no-op.
	SessionCMID   int
	HouseholdCMID int
	PersonCMID    int
}

// findLodgingEnrollmentOrphans returns the candidates whose party (household or
// person, by CampMinder id) is absent from its named session in
// householdIndex / personIndex -- the household/person-grain analog of
// findEnrollmentOrphans above, built from BuildHouseholdSessionIndex /
// BuildPersonSessionIndex rather than a second attendees query, per #2028's
// insistence on reuse over re-derivation. A candidate naming neither id is
// skipped (grain-less); a session with zero reliably-enrolled parties of that
// grain is skipped entirely, mirroring findEnrollmentOrphans' own per-session
// guard.
// lodgingCandidatesFromRecords projects placed lodging_assignments /
// lodging_assignments_draft rows into candidates for
// findLodgingEnrollmentOrphans, skipping rows already unplaced (nothing to
// sweep). Shared by the draft-sweep and prod-audit halves of
// reconcileLodgingOrphans below, which otherwise duplicate this loop verbatim
// except for the by-id index the draft half needs to write its updates back.
func lodgingCandidatesFromRecords(records []*core.Record) (map[string]*core.Record, []lodgingOrphanCandidate) {
	byID := make(map[string]*core.Record, len(records))
	candidates := make([]lodgingOrphanCandidate, 0, len(records))
	for _, r := range records {
		if len(r.GetStringSlice("units")) == 0 {
			continue // already unplaced -- nothing to sweep
		}
		byID[r.Id] = r
		candidates = append(candidates, lodgingOrphanCandidate{
			RecordID: r.Id, SessionCMID: r.GetInt("session_cm_id"),
			HouseholdCMID: r.GetInt("household_cm_id"), PersonCMID: r.GetInt("person_cm_id"),
		})
	}
	return byID, candidates
}

func findLodgingEnrollmentOrphans(
	householdIndex, personIndex map[int][]SessionWindow,
	candidates []lodgingOrphanCandidate,
) []lodgingOrphanCandidate {
	householdReliable := reliableEnrolledSessions(householdIndex)
	personReliable := reliableEnrolledSessions(personIndex)

	orphans := []lodgingOrphanCandidate{}
	for _, c := range candidates {
		switch {
		case c.HouseholdCMID > 0:
			if !householdReliable[c.SessionCMID] {
				continue
			}
			if !sessionIndexHasWindow(householdIndex[c.HouseholdCMID], c.SessionCMID) {
				orphans = append(orphans, c)
			}
		case c.PersonCMID > 0:
			if !personReliable[c.SessionCMID] {
				continue
			}
			if !sessionIndexHasWindow(personIndex[c.PersonCMID], c.SessionCMID) {
				orphans = append(orphans, c)
			}
		}
	}
	return orphans
}

// StrandedAssignmentCleanupSync silently auto-unassigns scenario draft assignments
// that no longer make sense, for either of two reasons:
//   - the bunk no longer has a bunk_plan for their session (staff reorganized
//     the session's bunk plan), or
//   - the camper is no longer actively enrolled (status_id=2) in that session
//     (they cancelled/withdrew after the scenario was built).
//
// It nulls bunk + bunk_plan on those drafts and audits production for the same
// (observe-only). It also runs #2028's lodging twin: nulling `units` on
// lodging_assignments_draft rows for a household/person no longer enrolled,
// and auditing (never deleting) lodging_assignments the same way. Runs as the
// final step of the sync orchestrator — after attendees sync, so enrollment is
// current. PocketBase-only — no CampMinder client.
type StrandedAssignmentCleanupSync struct {
	App   core.App
	Year  int
	Debug bool
	Stats Stats
	// DryRun, when true, computes the same stranded/orphan sets and updates
	// Stats exactly as a normal run would, but skips both app.Save calls in
	// reconcileStrandedAssignments/reconcileLodgingOrphans that null bunk/units
	// on a draft (kindred#2351). The two production audits are read-only
	// already and are unaffected either way.
	DryRun bool
}

// NewStrandedAssignmentCleanupSync constructs the service.
func NewStrandedAssignmentCleanupSync(app core.App) *StrandedAssignmentCleanupSync {
	return &StrandedAssignmentCleanupSync{App: app}
}

// Name returns the orchestrator-facing service name.

// GetStats returns the current stats snapshot.
func (s *StrandedAssignmentCleanupSync) GetStats() Stats { return s.Stats }

// SetDebug toggles verbose logging (orchestrator hook).
func (s *StrandedAssignmentCleanupSync) SetDebug(debug bool) { s.Debug = debug }

// SetYear sets the year for this run (orchestrator hook).
func (s *StrandedAssignmentCleanupSync) SetYear(year int) { s.Year = year }

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2351).
func (s *StrandedAssignmentCleanupSync) SetDryRun(dryRun bool) { s.DryRun = dryRun }

// WasSuccessful indicates whether the last run encountered no errors.
func (s *StrandedAssignmentCleanupSync) WasSuccessful() bool { return s.Stats.Errors == 0 }

// Sync runs the reconciliation against the configured year. When Year is 0
// (the daily-sync registration path), falls back to CAMPMINDER_SEASON_ID via
// ParseSeasonYear, matching every other yearless service in this package.
func (s *StrandedAssignmentCleanupSync) Sync(_ context.Context) error {
	// Stats describe THIS run, not every run since boot. The orchestrator holds
	// one instance for the process lifetime, so without this the counters climb
	// forever and GetStats() reports a sweep that happened days ago (matching
	// LodgingAssignmentsSync.Sync()'s reset).
	s.Stats = Stats{}

	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			s.Stats.Errors++
			return fmt.Errorf("stranded_assignment_cleanup: year resolution failed: %w", err)
		}
	}
	if err := reconcileStrandedAssignments(s.App, year, &s.Stats, s.DryRun); err != nil {
		return err
	}
	return reconcileLodgingOrphans(s.App, year, &s.Stats, s.DryRun)
}

// reconcileStrandedAssignments is the integration logic:
//  1. Build the valid (session, bunk) set + planned-session set from bunk_plans,
//     and the enrolled (session, person) set + enrolled-session set from
//     status_id=2 attendees, for the year.
//  2. GATE: if there are zero bunk_plans for the year, the plan set is
//     unreliable (bunk_plans sync failed or never ran) — skip entirely. The
//     same per-session guard protects both passes: a session with zero
//     bunk_plans (or zero enrolled attendees) is left untouched, so a partial
//     sync can't sweep an entire session's drafts.
//  3. Sweep bunk_assignments_draft: null bunk + bunk_plan on rows that are
//     bunk-stranded OR enrollment-orphaned, so the camper falls back into the
//     Unassigned pool (a cancelled camper falls out of the scenario entirely).
//  4. Audit bunk_assignments (production): log flagged rows — but do NOT
//     delete. The bunk_assignments sync's own deleteOrphans() owns prod.
func reconcileStrandedAssignments(app core.App, year int, stats *Stats, dryRun bool) error {
	yearFilter := fmt.Sprintf("year = %d", year)

	plans, err := app.FindRecordsByFilter("bunk_plans", yearFilter, "", 0, 0)
	if err != nil {
		stats.Errors++
		return fmt.Errorf("stranded_assignment_cleanup: query bunk_plans: %w", err)
	}
	// GATE.
	if len(plans) == 0 {
		slog.Warn("stranded_assignment_cleanup: skipping — no bunk_plans for year (sync may have failed)", "year", year)
		return nil
	}
	validPairs := make(map[string]bool, len(plans))
	plannedSessions := make(map[string]bool)
	for _, p := range plans {
		sessionID := p.GetString("session")
		validPairs[strandedPairKey(sessionID, p.GetString("bunk"))] = true
		plannedSessions[sessionID] = true
	}

	enrolledSessions, enrolledPairs := loadEnrolledAttendeeSets(app, year, stats)

	// --- Draft sweep ---
	drafts, err := app.FindRecordsByFilter(
		"bunk_assignments_draft",
		fmt.Sprintf("%s && bunk != ''", yearFilter),
		"", 0, 0,
	)
	if err != nil {
		stats.Errors++
		return fmt.Errorf("stranded_assignment_cleanup: query bunk_assignments_draft: %w", err)
	}
	draftByID := make(map[string]*core.Record, len(drafts))
	draftCandidates := make([]strandedCandidate, 0, len(drafts))
	// Bunk validity is derived from the (session, bunk) pair, NOT the draft's own
	// bunk_plan relation: that relation is non-authoritative and may dangle
	// (point at a since-deleted plan) even when the bunk is still planned. A
	// draft whose bunk is still planned and whose camper is still enrolled is
	// left untouched here, stale bunk_plan and all.
	for _, d := range drafts {
		draftByID[d.Id] = d
		draftCandidates = append(draftCandidates, strandedCandidate{
			RecordID:  d.Id,
			SessionID: d.GetString("session"),
			BunkID:    d.GetString("bunk"),
			PersonID:  d.GetString("person"),
		})
	}
	strandedDrafts := findStrandedAssignments(validPairs, plannedSessions, draftCandidates)
	orphanDrafts := findEnrollmentOrphans(enrolledSessions, enrolledPairs, draftCandidates)
	// Deduplicated once so the sweep count and the log agree: a draft flagged by
	// both passes is swept once, not double-counted.
	draftsToSweep := dedupeByRecordID(strandedDrafts, orphanDrafts)

	writes := 0
	for _, c := range draftsToSweep {
		rec := draftByID[c.RecordID]
		rec.Set("bunk", "")
		rec.Set("bunk_plan", "")
		if dryRun {
			stats.Updated++
			continue
		}
		if saveErr := app.Save(rec); saveErr != nil {
			stats.Errors++
			slog.Error("stranded_assignment_cleanup: save draft", "id", c.RecordID, "error", saveErr)
			continue
		}
		writes++
		stats.Updated++
	}

	// --- Production audit (observe only — bunk_assignments sync owns prod deletion) ---
	prod, err := app.FindRecordsByFilter(
		"bunk_assignments",
		fmt.Sprintf("%s && bunk != ''", yearFilter),
		"", 0, 0,
	)
	if err != nil {
		// Audit-only failure: the draft sweep above already succeeded, so we
		// log + flag it (WasSuccessful() will report false) but do NOT return —
		// a prod-query hiccup must not abort the run or roll back the sweep.
		stats.Errors++
		slog.Error("stranded_assignment_cleanup: query bunk_assignments", "error", err)
	} else {
		prodCandidates := make([]strandedCandidate, 0, len(prod))
		for _, p := range prod {
			prodCandidates = append(prodCandidates, strandedCandidate{
				RecordID:  p.Id,
				SessionID: p.GetString("session"),
				BunkID:    p.GetString("bunk"),
				PersonID:  p.GetString("person"),
			})
		}
		strandedProd := findStrandedAssignments(validPairs, plannedSessions, prodCandidates)
		orphanProd := findEnrollmentOrphans(enrolledSessions, enrolledPairs, prodCandidates)
		flaggedProd := dedupeByRecordID(strandedProd, orphanProd)
		stats.ProdAuditWarnings = len(flaggedProd)
		if len(flaggedProd) > 0 {
			recs := make([]string, len(flaggedProd))
			for i, c := range flaggedProd {
				recs[i] = fmt.Sprintf("%s(session=%s,bunk=%s,person=%s)", c.RecordID, c.SessionID, c.BunkID, c.PersonID)
			}
			slog.Warn(msgOrphanProd, "year", year,
				"count", len(flaggedProd), "stranded", len(strandedProd), "orphaned", len(orphanProd), "records", recs)
		}
	}

	// WAL checkpoint after writes.
	if writes > 0 {
		if _, err := app.DB().NewQuery("PRAGMA wal_checkpoint(FULL)").Execute(); err != nil {
			slog.Warn("stranded_assignment_cleanup: WAL checkpoint failed", "error", err)
		}
	}

	slog.Info("stranded_assignment_cleanup complete",
		"year", year,
		"flagged_drafts", len(draftsToSweep),
		"stranded_drafts", len(strandedDrafts),
		"orphaned_drafts", len(orphanDrafts),
		"drafts_swept", stats.Updated,
		"errors", stats.Errors,
	)
	return nil
}

// reconcileLodgingOrphans is #2028's weekend mirror of the enrollment-orphan
// half of reconcileStrandedAssignments above. Lodging has no analog of the
// OTHER summer orphan class (a bunk losing its plan): guardUnitDelete
// (lodging/hooks.go) already refuses to delete a unit still held by a
// placement, so there is no equivalent "stranded" state for a unit to fall
// into -- only the enrollment-orphan pass applies here.
//
//  1. lodging_assignments_draft: null `units` on rows whose party is no longer
//     enrolled, across every scenario for the year. staff_touched and source
//     are left exactly as they are -- only the placement clears, mirroring
//     the bunk + bunk_plan nulling above. staff_touched is NOT a skip guard
//     here: a cancelled household is gone whether or not staff moved it.
//  2. lodging_assignments (the mirror): audit only. Logs and counts; never
//     deletes. Deletion belongs to LodgingAssignmentsSync.deleteLodgingOrphans,
//     driven by absence from the CampMinder cabin value -- the same split of
//     responsibility bunk_assignments already has with the pass above.
func reconcileLodgingOrphans(app core.App, year int, stats *Stats, dryRun bool) error {
	householdIndex, err := BuildHouseholdSessionIndex(app, year, []string{sessionTypeFamily})
	if err != nil {
		stats.Errors++
		return fmt.Errorf("stranded_assignment_cleanup: building household session index: %w", err)
	}
	personIndex, err := BuildPersonSessionIndex(app, year, []string{sessionTypeAdult})
	if err != nil {
		stats.Errors++
		return fmt.Errorf("stranded_assignment_cleanup: building person session index: %w", err)
	}

	yearFilter := fmt.Sprintf("year = %d", year)

	// --- Draft sweep ---
	drafts, err := app.FindRecordsByFilter("lodging_assignments_draft", yearFilter, "", 0, 0)
	if err != nil {
		stats.Errors++
		return fmt.Errorf("stranded_assignment_cleanup: query lodging_assignments_draft: %w", err)
	}
	draftByID, draftCandidates := lodgingCandidatesFromRecords(drafts)
	orphanDrafts := findLodgingEnrollmentOrphans(householdIndex, personIndex, draftCandidates)

	// writes counts only persisted App.Save calls (gates the WAL checkpoint below,
	// which has nothing to flush on a dry run). swept counts what this pass DID or
	// WOULD sweep -- real or simulated -- and is what the completion log reports,
	// so an operator previewing a dry run sees the household this pass found, not
	// a misleading 0. Deliberately local rather than stats.Updated: Sync() runs
	// reconcileStrandedAssignments before this function against the same shared
	// *Stats, so stats.Updated already carries the bunk pass's own count by the
	// time this one logs -- reading it here would double-count that into this
	// pass's number.
	writes := 0
	swept := 0
	for _, c := range orphanDrafts {
		rec := draftByID[c.RecordID]
		rec.Set("units", []string{})
		if dryRun {
			stats.Updated++
			swept++
			continue
		}
		if saveErr := app.Save(rec); saveErr != nil {
			stats.Errors++
			slog.Error("stranded_assignment_cleanup: save lodging draft", "id", c.RecordID, "error", saveErr)
			continue
		}
		writes++
		swept++
		stats.Updated++
	}

	// --- Production audit (observe only — LodgingAssignmentsSync owns prod deletion) ---
	prod, err := app.FindRecordsByFilter("lodging_assignments", yearFilter, "", 0, 0)
	if err != nil {
		// Audit-only failure, same convention as the bunk pass: the draft sweep
		// above already succeeded, so this is logged + flagged but must not
		// abort the run or roll back the sweep.
		stats.Errors++
		slog.Error("stranded_assignment_cleanup: query lodging_assignments", "error", err)
	} else {
		_, prodCandidates := lodgingCandidatesFromRecords(prod)
		orphanProd := findLodgingEnrollmentOrphans(householdIndex, personIndex, prodCandidates)
		stats.LodgingProdAuditWarnings = len(orphanProd)
		if len(orphanProd) > 0 {
			recs := make([]string, len(orphanProd))
			for i, c := range orphanProd {
				recs[i] = fmt.Sprintf("%s(session_cm_id=%d,household_cm_id=%d,person_cm_id=%d)",
					c.RecordID, c.SessionCMID, c.HouseholdCMID, c.PersonCMID)
			}
			slog.Warn(msgOrphanLodgingProd, "year", year, "count", len(orphanProd), "records", recs)
		}
	}

	if writes > 0 {
		if _, err := app.DB().NewQuery("PRAGMA wal_checkpoint(FULL)").Execute(); err != nil {
			slog.Warn("stranded_assignment_cleanup: WAL checkpoint failed (lodging)", "error", err)
		}
	}

	slog.Info("stranded_assignment_cleanup lodging pass complete",
		"year", year,
		"orphaned_drafts", len(orphanDrafts),
		"drafts_swept", swept,
		"lodging_prod_audit_warnings", stats.LodgingProdAuditWarnings,
		"errors", stats.Errors,
	)
	return nil
}
