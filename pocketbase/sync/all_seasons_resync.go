package sync

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

// The weekly all-seasons re-sync (epic #3207 PR 16, decision 42).
//
// The scheduled runs cover only N and N-1, so every older season keeps whatever CampMinder said
// when Kindred last synced it: a camper missing from several seasons, a person CampMinder merged
// afterwards, year snapshots lagging gender and birthdate edits, sessions renamed or typed by an
// older rule (2021's Family Camp weekends still read `other`). Once a week this pass re-fetches
// the source tables for each of those seasons, so they converge on CampMinder.
//
// What it runs: session_groups, sessions, attendees and persons (persons writes households too),
// for 2017 (syncYearMin) through N-2, newest first, each season through runSeasonPass with its
// own year-scoped instances, so the registry is never swapped. Nothing derived runs: the derived
// tables of an older season are left as they are.
//
// What it deletes: only stale attendees rows. Every other job keeps its orphans
// (setKeepOrphans), because their deletes cascade into history an older season never rebuilds:
// a camp_sessions row takes that season's bunk_assignments, bunk_plans and lodging rows with it,
// a persons row its bunk_assignments, original_bunk_requests and aid applications, and a
// household its family_camp_registrations (the only pre-2026 placement history) and
// household_demographics. An attendees row has to go, or a person CampMinder merged into
// another would count twice; its cascade is that enrollment's own transportation and solver-lock
// rows. The attendees sweep keeps every guard it has (sync failure, rejections, collapse).
//
// When: Saturday 05:00 in the container's zone (scheduler.go). It also waits, before each
// season, while any other queue runs (the nightly, the weekly globals, a staff full run or
// replay, the hourly run), so it does not start a season under one of those. The hourly run
// yields to it from then on (RunHourlySync). The wait is a check, not a claim:
// the pass sets no flag the other queues or the API's admission checks read, so a staff run that
// lands in a gap between this pass's jobs starts at once, and a collision on a job id refuses one
// side with "sync already in progress" (runSeasonPass logs it; the next Saturday retries). It
// costs CampMinder about what one season of the nightly's source phase does, per season, run
// sequentially with the usual job spacing; the client's own 429 handling applies.
//
// Caches: every job it finishes asks FastAPI to clear the caches that job's tables feed, as any
// sync run does (notifyRunCompleted). That clear is scoped by job, not by season, so each of the
// pass's jobs clears the metrics, lodging, Camperships and social-graph caches of the live seasons
// too, and the coalesced background warms follow: four jobs a season, up to 36 clears a Saturday.

// allSeasonsResyncSchedule is Saturday 05:00. The nightly starts 03:00 and runs about an hour
// for two seasons; Sunday holds the weekly globals (02:00) and the long custom-values pass
// (04:00).
const allSeasonsResyncSchedule = "0 5 * * 6"

// allSeasonsQuietPoll is how often a waiting pass checks whether the other queues have finished.
const allSeasonsQuietPoll = 30 * time.Second

// allSeasonsResyncJobs is the pass, in source-phase order: sessions reads session_groups for its
// group mapping, and persons gathers its people from attendees.
var allSeasonsResyncJobs = []string{"session_groups", "sessions", "attendees", "persons"}

// allSeasonsSweepingJob is the one job whose orphan sweep runs in this pass.
const allSeasonsSweepingJob = "attendees"

// errAllSeasonsResyncRunning refuses a second pass while one is in flight.
var errAllSeasonsResyncRunning = errors.New("all-seasons re-sync already running")

// orphanKeeper is a service whose sweeps can be switched off for a run. BaseSyncService provides
// it; a service with a hand-rolled sweep must check keptOrphans there too (persons' households).
type orphanKeeper interface {
	setKeepOrphans(keep bool)
}

func (b *BaseSyncService) setKeepOrphans(keep bool) { b.keepOrphans = keep }

// keptOrphans reports, and logs, a sweep skipped because this run keeps its orphans.
func (b *BaseSyncService) keptOrphans(entityName string) bool {
	if !b.keepOrphans {
		return false
	}
	slog.Info("Keeping orphans: this run (the all-seasons re-sync, or an hourly run) deletes no rows of this kind",
		"entity", entityName)
	return true
}

// HistoricalSeasons is every season the scheduled runs no longer cover, newest first: N-2 back to
// syncYearMin.
func HistoricalSeasons(now time.Time) ([]int, error) {
	synced, err := SyncedSeasons(now)
	if err != nil {
		return nil, err
	}
	oldest := synced[len(synced)-1]
	// max(0, …): an override of syncYearMin makes the oldest synced season syncYearMin-1, and
	// a negative capacity would panic in the cron goroutine.
	seasons := make([]int, 0, max(0, oldest-syncYearMin))
	for year := oldest - 1; year >= syncYearMin; year-- {
		seasons = append(seasons, year)
	}
	return seasons, nil
}

// RunAllSeasonsResync runs the pass described at the top of this file. One season's failure is
// logged and the pass moves on, as the N-1 pass does; the error is only a refusal, an unresolved
// season, or ctx ending.
func (o *Orchestrator) RunAllSeasonsResync(ctx context.Context) error {
	o.mu.Lock()
	if o.allSeasonsResyncRunning {
		o.mu.Unlock()
		return errAllSeasonsResyncRunning
	}
	o.allSeasonsResyncRunning = true
	o.mu.Unlock()
	defer func() {
		o.mu.Lock()
		o.allSeasonsResyncRunning = false
		o.mu.Unlock()
	}()

	seasons, err := HistoricalSeasons(nowFn())
	if err != nil {
		return err
	}
	slog.Info("All-seasons re-sync starting", "seasons", seasons, "jobs", allSeasonsResyncJobs)

	keepOrphans := func(job string, svc Service) {
		if k, ok := svc.(orphanKeeper); ok {
			k.setKeepOrphans(job != allSeasonsSweepingJob)
		}
	}
	for _, year := range seasons {
		if err := o.waitForQuietQueues(ctx); err != nil {
			return err
		}
		slog.Info("All-seasons re-sync: season", "year", year)
		if err := o.runSeasonPassWith(ctx, year, allSeasonsResyncJobs, triggerHistorical, nil, keepOrphans); err != nil {
			return err
		}
	}
	slog.Info("All-seasons re-sync completed", "seasons", len(seasons))
	return nil
}

// waitForQuietQueues returns once no other queue is running: the nightly or a staff full run
// (dailySyncRunning), a replay or a manual N-1 run (historicalSyncRunning), the weekly globals,
// the custom-values queue, or the hourly run. The hourly run fires at 05:00 too, and it runs
// sessions, attendees and persons; it yields to this pass once the pass has started, so this
// wait is only ever for one hourly run that got there first.
func (o *Orchestrator) waitForQuietQueues(ctx context.Context) error {
	for {
		o.mu.RLock()
		busy := o.dailySyncRunning || o.historicalSyncRunning || o.weeklySyncRunning ||
			o.customValuesSyncRunning || o.hourlySyncRunning
		o.mu.RUnlock()
		if !busy {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(allSeasonsQuietPoll):
		}
	}
}
