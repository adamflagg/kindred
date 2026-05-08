package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
)

const serviceNameReconcileLifecycle = "reconcile_request_lifecycle"

// ReconcileLifecycleSync detects requesters whose current attendees.session
// differs from the session_id stored on their bunk_requests rows, and marks
// their original_bunk_requests as processed=” so process_requests rebuilds
// them with the correct session.
//
// This complements the orphan-purge in bunk_requests sync (which handles
// cancellations by deleting OBRs/BRs for requesters no longer enrolled) and
// the Phase C target-decline sidecar in process_requests (which handles
// requestee-side stale rows by direct UPDATE).
type ReconcileLifecycleSync struct {
	App   core.App
	Year  int
	Debug bool
	Stats Stats
}

// NewReconcileLifecycleSync constructs the sync service.
func NewReconcileLifecycleSync(app core.App) *ReconcileLifecycleSync {
	return &ReconcileLifecycleSync{App: app}
}

// Name returns the orchestrator-facing service name.
func (s *ReconcileLifecycleSync) Name() string {
	return serviceNameReconcileLifecycle
}

// GetStats returns the current stats snapshot.
func (s *ReconcileLifecycleSync) GetStats() Stats {
	return s.Stats
}

// SetDebug toggles verbose logging (orchestrator hook).
func (s *ReconcileLifecycleSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetYear sets the year for this run (orchestrator hook).
func (s *ReconcileLifecycleSync) SetYear(year int) {
	s.Year = year
}

// WasSuccessful indicates whether the last run encountered no errors.
func (s *ReconcileLifecycleSync) WasSuccessful() bool {
	return s.Stats.Errors == 0
}

// Sync runs the reconciliation against the configured year. When Year is 0
// (the daily-sync registration path in InitializeSyncServices), falls back
// to CAMPMINDER_SEASON_ID via ParseSeasonYear, matching the convention used
// by every other yearless service in this package.
func (s *ReconcileLifecycleSync) Sync(_ context.Context) error {
	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			s.Stats.Errors++
			return fmt.Errorf("reconcile_request_lifecycle: year resolution failed: %w", err)
		}
	}
	markErrors, err := reconcileRequestLifecycle(s.App, year)
	s.Stats.Errors += markErrors
	if err != nil {
		s.Stats.Errors++
		return err
	}
	return nil
}

// findMovedRequesters returns the cm_ids of requesters with at least one
// bunk_requests row whose session_id differs from the requester's current
// attendees.session. Requesters absent from currentSessions (i.e. no longer
// enrolled) are skipped — those are handled by the existing orphan purge in
// bunk_requests sync, not here.
func findMovedRequesters(currentSessions map[int]int, storedBRSessions map[int][]int) []int {
	moved := []int{}
	for cmID, currentSession := range currentSessions {
		stored, ok := storedBRSessions[cmID]
		if !ok || len(stored) == 0 {
			continue
		}
		for _, s := range stored {
			if s != currentSession {
				moved = append(moved, cmID)
				break
			}
		}
	}
	return moved
}

// reconcileRequestLifecycle is the integration logic. It:
//  1. Loads currently-enrolled (status_id=2) attendees for the year and
//     their session cm_ids.
//  2. Loads bunk_requests for the year and groups session_ids by requester_id.
//  3. Calls findMovedRequesters to compute the cm_ids needing rebuild.
//  4. For each, marks all of their OBRs in the year as processed=”.
//
// Returns (markErrors, err) where markErrors counts per-cm save failures
// that did not fail the overall run (sidecar continues on partial failure
// but surfaces the count to Stats so WasSuccessful() reflects reality).
func reconcileRequestLifecycle(app core.App, year int) (int, error) {
	currentSessions, err := loadEnrolledRequesterSessions(app, year)
	if err != nil {
		return 0, fmt.Errorf("loading enrolled sessions: %w", err)
	}
	storedSessions, err := loadStoredBRSessions(app, year)
	if err != nil {
		return 0, fmt.Errorf("loading bunk_requests sessions: %w", err)
	}

	moved := findMovedRequesters(currentSessions, storedSessions)
	if len(moved) == 0 {
		slog.Debug("reconcile_request_lifecycle: no moved requesters", "year", year)
		return 0, nil
	}

	markErrors := 0
	for _, cmID := range moved {
		if err := markRequesterOBRsUnprocessed(app, cmID, year); err != nil {
			markErrors++
			slog.Error("reconcile_request_lifecycle: mark OBRs unprocessed",
				"cm_id", cmID, "year", year, "error", err)
		}
	}

	slog.Info("reconcile_request_lifecycle complete",
		"year", year, "moved_requesters", len(moved), "mark_errors", markErrors)
	return markErrors, nil
}

// loadEnrolledRequesterSessions returns a map of person cm_id -> session cm_id
// for attendees with status_id=2 in the given year.
func loadEnrolledRequesterSessions(app core.App, year int) (map[int]int, error) {
	attendees, err := app.FindRecordsByFilter(
		"attendees",
		fmt.Sprintf("year = %d && status_id = 2", year),
		"", 0, 0,
	)
	if err != nil {
		return nil, fmt.Errorf("query attendees: %w", err)
	}
	if errs := app.ExpandRecords(attendees, []string{"session"}, nil); len(errs) > 0 {
		slog.Warn("reconcile_request_lifecycle: some session expansions failed",
			"errors", errs)
	}

	out := make(map[int]int, len(attendees))
	for _, a := range attendees {
		personCMID, ok := a.Get("person_id").(float64)
		if !ok {
			continue
		}
		session := a.ExpandedOne("session")
		if session == nil {
			continue
		}
		sessionCMID, ok := session.Get("cm_id").(float64)
		if !ok {
			continue
		}
		out[int(personCMID)] = int(sessionCMID)
	}
	return out, nil
}

// loadStoredBRSessions returns a map of requester cm_id -> distinct
// session_ids stored on their bunk_requests rows for the year.
func loadStoredBRSessions(app core.App, year int) (map[int][]int, error) {
	rows, err := app.FindRecordsByFilter(
		"bunk_requests",
		fmt.Sprintf("year = %d", year),
		"", 0, 0,
	)
	if err != nil {
		return nil, fmt.Errorf("query bunk_requests: %w", err)
	}

	seen := make(map[int]map[int]bool)
	for _, r := range rows {
		requesterID, ok := r.Get("requester_id").(float64)
		if !ok {
			continue
		}
		sessionID, ok := r.Get("session_id").(float64)
		if !ok {
			continue
		}
		key := int(requesterID)
		if seen[key] == nil {
			seen[key] = make(map[int]bool)
		}
		seen[key][int(sessionID)] = true
	}

	out := make(map[int][]int, len(seen))
	for cmID, sessions := range seen {
		list := make([]int, 0, len(sessions))
		for s := range sessions {
			list = append(list, s)
		}
		out[cmID] = list
	}
	return out, nil
}

// markRequesterOBRsUnprocessed flips the `processed` flag to ” on every OBR
// for the given requester and year, so process_requests will re-evaluate
// them against current attendees state.
func markRequesterOBRsUnprocessed(app core.App, requesterCMID, year int) error {
	persons, err := app.FindRecordsByFilter(
		"persons",
		fmt.Sprintf("cm_id = %d", requesterCMID),
		"", 1, 0,
	)
	if err != nil {
		return fmt.Errorf("find person %d: %w", requesterCMID, err)
	}
	if len(persons) == 0 {
		return nil
	}
	personPBID := persons[0].Id

	obrs, err := app.FindRecordsByFilter(
		"original_bunk_requests",
		fmt.Sprintf("requester = '%s' && year = %d", personPBID, year),
		"", 0, 0,
	)
	if err != nil {
		return fmt.Errorf("find OBRs for person %d: %w", requesterCMID, err)
	}

	for _, obr := range obrs {
		obr.Set("processed", "")
		if err := app.Save(obr); err != nil {
			return fmt.Errorf("save OBR %s: %w", obr.Id, err)
		}
	}
	if len(obrs) > 0 {
		if _, err := app.DB().NewQuery("PRAGMA wal_checkpoint(FULL)").Execute(); err != nil {
			slog.Warn("reconcile_request_lifecycle: WAL checkpoint failed", "error", err)
		}
	}
	return nil
}
