// Package sync provides synchronization services between CampMinder and PocketBase.
package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
)

const serviceNameStrandedAssignmentCleanup = "stranded_assignment_cleanup"

// msgStrandedProd is the Warn message for the observe-only production audit.
// Hoisted to a const to keep the call site within the line-length limit.
const msgStrandedProd = "stranded_assignment_cleanup: stranded production assignments detected — " +
	"not deleted (bunk_assignments sync owns prod cleanup)"

// orphanCandidate is the minimal projection of an assignment row needed for
// stranded-detection — decoupled from *core.Record so the detection logic is
// unit-testable without a database.
type orphanCandidate struct {
	RecordID  string
	SessionID string
	BunkID    string
}

// orphanPairKey builds the composite key used to test whether a (session, bunk)
// pair has a surviving bunk_plan. Both args are PocketBase record IDs.
func orphanPairKey(sessionID, bunkID string) string {
	return sessionID + ":" + bunkID
}

// findStrandedAssignments returns the candidates whose (session, bunk) pair is
// absent from validPairs — i.e. the bunk has no bunk_plan for that session.
// Candidates with no bunk are skipped (already unassigned). Candidates whose
// session is absent from plannedSessions are also skipped: a session with zero
// bunk_plans is unreliable (that session's plans may have failed to sync), so
// sweeping its drafts would null every valid assignment for the session.
func findStrandedAssignments(
	validPairs, plannedSessions map[string]bool,
	candidates []orphanCandidate,
) []orphanCandidate {
	stranded := []orphanCandidate{}
	for _, c := range candidates {
		if c.BunkID == "" {
			continue
		}
		if !plannedSessions[c.SessionID] {
			continue
		}
		if !validPairs[orphanPairKey(c.SessionID, c.BunkID)] {
			stranded = append(stranded, c)
		}
	}
	return stranded
}

// StrandedAssignmentCleanupSync silently auto-unassigns scenario draft assignments whose
// bunk no longer has a bunk_plan for their session — left stranded when staff
// reorganize a session's bunk plan — and audits production for the same.
// Runs as the final step of the sync orchestrator. PocketBase-only — no
// CampMinder client.
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
	return reconcileOrphanedAssignments(s.App, year, &s.Stats)
}

// reconcileOrphanedAssignments is the integration logic:
//  1. Build the valid (session, bunk) set, plus the set of sessions that have
//     at least one bunk_plan, from bunk_plans for the year.
//  2. GATE: if there are zero bunk_plans for the year, the plan set is
//     unreliable (bunk_plans sync failed or never ran) — skip entirely. The
//     same guard applies per session: a session with zero bunk_plans is left
//     untouched, so a partial sync can't sweep an entire session's drafts.
//  3. Sweep bunk_assignments_draft: null bunk + bunk_plan on stranded rows so
//     the camper falls back into the Unassigned pool.
//  4. Audit bunk_assignments (production): log stranded rows — but do NOT
//     delete. The bunk_assignments sync's own deleteOrphans() owns prod.
func reconcileOrphanedAssignments(app core.App, year int, stats *Stats) error {
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
		validPairs[orphanPairKey(sessionID, p.GetString("bunk"))] = true
		plannedSessions[sessionID] = true
	}

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
	draftCandidates := make([]orphanCandidate, 0, len(drafts))
	// Validity is derived from the (session, bunk) pair, NOT the draft's own
	// bunk_plan relation: that relation is non-authoritative and may dangle
	// (point at a since-deleted plan) even when the bunk is still planned. A
	// draft whose bunk is still planned is left untouched here, stale
	// bunk_plan and all.
	for _, d := range drafts {
		draftByID[d.Id] = d
		draftCandidates = append(draftCandidates, orphanCandidate{
			RecordID:  d.Id,
			SessionID: d.GetString("session"),
			BunkID:    d.GetString("bunk"),
		})
	}
	strandedDrafts := findStrandedAssignments(validPairs, plannedSessions, draftCandidates)

	writes := 0
	for _, c := range strandedDrafts {
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
		prodCandidates := make([]orphanCandidate, 0, len(prod))
		for _, p := range prod {
			prodCandidates = append(prodCandidates, orphanCandidate{
				RecordID:  p.Id,
				SessionID: p.GetString("session"),
				BunkID:    p.GetString("bunk"),
			})
		}
		strandedProd := findStrandedAssignments(validPairs, plannedSessions, prodCandidates)
		stats.ProdAuditWarnings = len(strandedProd)
		if len(strandedProd) > 0 {
			pairs := make([]string, len(strandedProd))
			for i, c := range strandedProd {
				pairs[i] = fmt.Sprintf("%s(session=%s,bunk=%s)", c.RecordID, c.SessionID, c.BunkID)
			}
			slog.Warn(msgStrandedProd, "year", year, "count", len(strandedProd), "records", pairs)
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
		"stranded_drafts", len(strandedDrafts),
		"drafts_swept", stats.Updated,
		"errors", stats.Errors,
	)
	return nil
}
