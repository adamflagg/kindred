// Package sync provides synchronization services between CampMinder and PocketBase.
package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
)

const serviceNameStrandedAssignmentCleanup = "stranded_assignment_cleanup"

// msgOrphanProd is the Warn message for the observe-only production audit.
// Hoisted to a const to keep the call site within the line-length limit.
const msgOrphanProd = "stranded_assignment_cleanup: orphaned production assignments detected " +
	"(bunk lost its plan or camper no longer enrolled) — not deleted (bunk_assignments sync owns prod cleanup)"

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

// StrandedAssignmentCleanupSync silently auto-unassigns scenario draft assignments
// that no longer make sense, for either of two reasons:
//   - the bunk no longer has a bunk_plan for their session (staff reorganized
//     the session's bunk plan), or
//   - the camper is no longer actively enrolled (status_id=2) in that session
//     (they cancelled/withdrew after the scenario was built).
//
// It nulls bunk + bunk_plan on those drafts and audits production for the same
// (observe-only). Runs as the final step of the sync orchestrator — after
// attendees sync, so enrollment is current. PocketBase-only — no CampMinder client.
type StrandedAssignmentCleanupSync struct {
	App   core.App
	Year  int
	Debug bool
	Stats Stats
}

// NewStrandedAssignmentCleanupSync constructs the service.
func NewStrandedAssignmentCleanupSync(app core.App) *StrandedAssignmentCleanupSync {
	return &StrandedAssignmentCleanupSync{App: app}
}

// Name returns the orchestrator-facing service name.
func (s *StrandedAssignmentCleanupSync) Name() string { return serviceNameStrandedAssignmentCleanup }

// GetStats returns the current stats snapshot.
func (s *StrandedAssignmentCleanupSync) GetStats() Stats { return s.Stats }

// SetDebug toggles verbose logging (orchestrator hook).
func (s *StrandedAssignmentCleanupSync) SetDebug(debug bool) { s.Debug = debug }

// SetYear sets the year for this run (orchestrator hook).
func (s *StrandedAssignmentCleanupSync) SetYear(year int) { s.Year = year }

// WasSuccessful indicates whether the last run encountered no errors.
func (s *StrandedAssignmentCleanupSync) WasSuccessful() bool { return s.Stats.Errors == 0 }

// Sync runs the reconciliation against the configured year. When Year is 0
// (the daily-sync registration path), falls back to CAMPMINDER_SEASON_ID via
// ParseSeasonYear, matching every other yearless service in this package.
func (s *StrandedAssignmentCleanupSync) Sync(_ context.Context) error {
	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			s.Stats.Errors++
			return fmt.Errorf("stranded_assignment_cleanup: year resolution failed: %w", err)
		}
	}
	return reconcileStrandedAssignments(s.App, year, &s.Stats)
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
func reconcileStrandedAssignments(app core.App, year int, stats *Stats) error {
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
