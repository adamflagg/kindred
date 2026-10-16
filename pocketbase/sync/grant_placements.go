package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// grantPlacementsPath is FastAPI's grant placement recorder (campership 3c-2). The grants register
// places each grant line and commitment on aid requests from undated records, so where it placed
// them is logged (aid_grant_placements) for a past date to replay. Owner ruling 2026-10-16: the
// log is recorded by this step and by FastAPI's warm after each staff write, never by an
// interactive read. The register reads the aid ledger, so this step runs after aid_postings.
const grantPlacementsPath = "/api/internal/financial-aid/grant-placements"

// firstPlacementSeason is the first season with aid requests (FIRST_REQUEST_SEASON in the
// Camperships services, FIRST_PLACEMENT_SEASON in financial_aid_grant_placements.py). A historical
// replay of an earlier season records nothing: the register has no request to place a grant on.
const firstPlacementSeason = 2026

var grantPlacementsClient = &http.Client{Timeout: 10 * time.Minute}

// GrantPlacementCounts is FastAPI's record report: how many place and remove rows it appended.
type GrantPlacementCounts struct {
	Placed  int `json:"placed"`
	Removed int `json:"removed"`
}

// TriggerGrantPlacements asks FastAPI to record one season's grant placements. It is set as
// GrantPlacementsSync.Record at every production construction site; tests set their own.
func TriggerGrantPlacements(ctx context.Context, year int) (GrantPlacementCounts, error) {
	return postGrantPlacements(ctx, getAPIURL(), year)
}

// postGrantPlacements runs the record and reads its counts. A 200 whose body cannot be read is
// still a record that ran: it returns zero counts and a warning, never an error.
func postGrantPlacements(ctx context.Context, apiURL string, year int) (GrantPlacementCounts, error) {
	raw, err := postFinancialAidSeason(ctx, grantPlacementsClient, apiURL+grantPlacementsPath, "grant placements", year)
	if err != nil || raw == nil {
		return GrantPlacementCounts{}, err
	}
	var counts GrantPlacementCounts
	if err := json.Unmarshal(raw, &counts); err != nil {
		slog.Warn("Grant placement report could not be read", "year", year, "error", err)
		return GrantPlacementCounts{}, nil
	}
	return counts, nil
}

// GrantPlacementsSync is the grant_placements job: a Go step that only calls Python, as
// process_requests is. It writes nothing itself; FastAPI appends the aid_grant_placements rows.
type GrantPlacementsSync struct {
	// Year is the season to record; 0 means the primary, resolved at Sync time.
	Year   int
	DryRun bool
	Stats  Stats
	// Record asks FastAPI to record a season (TriggerGrantPlacements in production).
	Record func(ctx context.Context, year int) (GrantPlacementCounts, error)
}

// NewGrantPlacementsSync builds the step. Every production site then sets Record.
func NewGrantPlacementsSync() *GrantPlacementsSync {
	return &GrantPlacementsSync{}
}

// SetYear implements YearSetter.
func (s *GrantPlacementsSync) SetYear(year int) { s.Year = year }

// SetDryRun implements DryRunnable: a dry run never asks FastAPI to write.
func (s *GrantPlacementsSync) SetDryRun(dryRun bool) { s.DryRun = dryRun }

// GetStats returns this run's stats.
func (s *GrantPlacementsSync) GetStats() Stats { return s.Stats }

// WasSuccessful reports whether the last run recorded without error.
func (s *GrantPlacementsSync) WasSuccessful() bool { return s.Stats.Errors == 0 }

// Sync records the season's grant placements. A dry run, and a season before the log, ask for
// nothing. A failed record is an error, so this job's own card in Manage › Sync goes FAILED: a
// placement the log missed leaves that day's past Camperships views stale until the next run.
func (s *GrantPlacementsSync) Sync(ctx context.Context) error {
	// Stats describe THIS run: the orchestrator holds one long-lived instance.
	s.Stats = Stats{}
	year := s.Year
	if year == 0 {
		var err error
		if year, err = ParseSeasonYear(); err != nil {
			s.Stats.Errors++
			return fmt.Errorf("grant_placements: year resolution failed: %w", err)
		}
	}
	if s.DryRun {
		slog.Info("Grant placements not recorded: dry run", "year", year)
		return nil
	}
	if year < firstPlacementSeason {
		slog.Info("Grant placements not recorded: the season has no aid requests", "year", year)
		return nil
	}
	if s.Record == nil {
		s.Stats.Errors++
		return fmt.Errorf("grant_placements: no recorder wired")
	}
	counts, err := s.Record(ctx, year)
	if err != nil {
		s.Stats.Errors++
		slog.Error("Recording grant placements failed", "year", year, "error", err)
		return fmt.Errorf("recording grant placements for %d: %w", year, err)
	}
	s.Stats.Created = counts.Placed + counts.Removed
	slog.Info("Grant placements recorded", "year", year, "placed", counts.Placed, "removed", counts.Removed)
	return nil
}
