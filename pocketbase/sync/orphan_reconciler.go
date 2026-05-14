// Package sync provides synchronization services between CampMinder and PocketBase.
package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
)

const serviceNameOrphanReconciler = "orphan_reconciler"

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
// Candidates with no bunk are skipped (already unassigned).
func findStrandedAssignments(validPairs map[string]bool, candidates []orphanCandidate) []orphanCandidate {
	stranded := []orphanCandidate{}
	for _, c := range candidates {
		if c.BunkID == "" {
			continue
		}
		if !validPairs[orphanPairKey(c.SessionID, c.BunkID)] {
			stranded = append(stranded, c)
		}
	}
	return stranded
}

// OrphanReconcilerSync silently auto-unassigns scenario draft assignments whose
// bunk no longer has a bunk_plan for their session — left stranded when staff
// reorganize a session's bunk plan — and audits production for the same.
// Runs as the final step of the sync orchestrator. PocketBase-only — no
// CampMinder client.
type OrphanReconcilerSync struct {
	App   core.App
	Year  int
	Debug bool
	Stats Stats
}

// NewOrphanReconcilerSync constructs the service.
func NewOrphanReconcilerSync(app core.App) *OrphanReconcilerSync {
	return &OrphanReconcilerSync{App: app}
}

// Name returns the orchestrator-facing service name.
func (s *OrphanReconcilerSync) Name() string { return serviceNameOrphanReconciler }

// GetStats returns the current stats snapshot.
func (s *OrphanReconcilerSync) GetStats() Stats { return s.Stats }

// SetDebug toggles verbose logging (orchestrator hook).
func (s *OrphanReconcilerSync) SetDebug(debug bool) { s.Debug = debug }

// SetYear sets the year for this run (orchestrator hook).
func (s *OrphanReconcilerSync) SetYear(year int) { s.Year = year }

// WasSuccessful indicates whether the last run encountered no errors.
func (s *OrphanReconcilerSync) WasSuccessful() bool { return s.Stats.Errors == 0 }

// Sync runs the reconciliation against the configured year. When Year is 0
// (the daily-sync registration path), falls back to CAMPMINDER_SEASON_ID via
// ParseSeasonYear, matching every other yearless service in this package.
func (s *OrphanReconcilerSync) Sync(_ context.Context) error {
	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			s.Stats.Errors++
			return fmt.Errorf("orphan_reconciler: year resolution failed: %w", err)
		}
	}
	return reconcileOrphanedAssignments(s.App, year, &s.Stats)
}

// reconcileOrphanedAssignments is the integration logic:
//  1. Build the valid (session, bunk) set from bunk_plans for the year.
//  2. GATE: if there are zero bunk_plans for the year, the plan set is
//     unreliable (bunk_plans sync failed or never ran) — skip entirely, since
//     sweeping against an empty set would null every valid draft.
//  3. Sweep bunk_assignments_draft: null bunk + bunk_plan on stranded rows so
//     the camper falls back into the Unassigned pool.
//  4. Audit bunk_assignments (production): count stranded rows, log — but do
//     NOT delete. The bunk_assignments sync's own deleteOrphans() owns prod.
func reconcileOrphanedAssignments(app core.App, year int, stats *Stats) error {
	yearFilter := fmt.Sprintf("year = %d", year)

	plans, err := app.FindRecordsByFilter("bunk_plans", yearFilter, "", 0, 0)
	if err != nil {
		stats.Errors++
		return fmt.Errorf("orphan_reconciler: query bunk_plans: %w", err)
	}
	// GATE.
	if len(plans) == 0 {
		slog.Warn("orphan_reconciler: skipping — no bunk_plans for year (sync may have failed)", "year", year)
		return nil
	}
	validPairs := make(map[string]bool, len(plans))
	for _, p := range plans {
		validPairs[orphanPairKey(p.GetString("session"), p.GetString("bunk"))] = true
	}

	// --- Draft sweep ---
	drafts, err := app.FindRecordsByFilter(
		"bunk_assignments_draft",
		fmt.Sprintf("%s && bunk != ''", yearFilter),
		"", 0, 0,
	)
	if err != nil {
		stats.Errors++
		return fmt.Errorf("orphan_reconciler: query bunk_assignments_draft: %w", err)
	}
	draftByID := make(map[string]*core.Record, len(drafts))
	draftCandidates := make([]orphanCandidate, 0, len(drafts))
	for _, d := range drafts {
		draftByID[d.Id] = d
		draftCandidates = append(draftCandidates, orphanCandidate{
			RecordID:  d.Id,
			SessionID: d.GetString("session"),
			BunkID:    d.GetString("bunk"),
		})
	}
	strandedDrafts := findStrandedAssignments(validPairs, draftCandidates)

	writes := 0
	for _, c := range strandedDrafts {
		rec := draftByID[c.RecordID]
		rec.Set("bunk", "")
		rec.Set("bunk_plan", "")
		if err := app.Save(rec); err != nil {
			stats.Errors++
			slog.Error("orphan_reconciler: save draft", "id", c.RecordID, "error", err)
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
		stats.Errors++
		slog.Error("orphan_reconciler: query bunk_assignments", "error", err)
	} else {
		prodCandidates := make([]orphanCandidate, 0, len(prod))
		for _, p := range prod {
			prodCandidates = append(prodCandidates, orphanCandidate{
				RecordID:  p.Id,
				SessionID: p.GetString("session"),
				BunkID:    p.GetString("bunk"),
			})
		}
		if strandedProd := findStrandedAssignments(validPairs, prodCandidates); len(strandedProd) > 0 {
			slog.Warn("orphan_reconciler: stranded production assignments detected (not deleted — bunk_assignments sync owns prod cleanup)",
				"year", year, "count", len(strandedProd))
		}
	}

	// WAL checkpoint after writes.
	if writes > 0 {
		if _, err := app.DB().NewQuery("PRAGMA wal_checkpoint(FULL)").Execute(); err != nil {
			slog.Warn("orphan_reconciler: WAL checkpoint failed", "error", err)
		}
	}

	slog.Info("orphan_reconciler complete",
		"year", year,
		"stranded_drafts", len(strandedDrafts),
		"drafts_swept", stats.Updated,
	)
	return nil
}
