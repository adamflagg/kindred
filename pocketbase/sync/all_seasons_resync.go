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
// When: Saturday 05:00 in the container's zone (scheduler.go). It first waits while any other
// queue or job runs (the nightly, the weekly globals, a staff full run or replay, the hourly
// run), then HOLDS the queues until its last season is done (holdQueuesForAllSeasons). The check
// and the hold are one critical section, and every queue that claims a running flag goes through
// claimQueue, which waits while the hold is taken; the hourly run yields to it (RunHourlySync)
// and the API queues a staff press (IsAnyQueueBusy), which the scheduler starts when the pass
// ends. So a staff run can no longer land in a gap between the pass's jobs, collide on a job id
// and be refused "sync already in progress", and a season no longer finishes half-refreshed
// (PM-7 = A, the CodeRabbit Major on #3240). It costs CampMinder about what one season of the
// nightly's source phase does, per season, run sequentially with the usual job spacing; the
// client's own 429 handling applies.
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

// keptOrphans reports, and logs, a sweep skipped because this run keeps its orphans. orphans
// counts the rows the sweep would have deleted. keptOrphans calls it only on a historical replay
// (countKeptOrphans, set by keepOrphansForReplay in replay_orphans.go), because the count costs
// the sweep's read-only scan and the hourly run must not pay that every hour.
func (b *BaseSyncService) keptOrphans(entityName string, orphans func() (int, error)) bool {
	if !b.keepOrphans {
		return false
	}
	if b.countKeptOrphans {
		logReplayKeptOrphans(entityName, b.SyncSuccessful, orphans)
		return true
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
	release, err := o.holdQueuesForAllSeasons(ctx)
	if err != nil {
		return err
	}
	defer release()
	for _, year := range seasons {
		slog.Info("All-seasons re-sync: season", "year", year)
		if err := o.runSeasonPassWith(ctx, year, allSeasonsResyncJobs, triggerHistorical, nil, keepOrphans); err != nil {
			return err
		}
	}
	slog.Info("All-seasons re-sync completed", "seasons", len(seasons))
	return nil
}

// holdQueuesForAllSeasons waits until no other queue and no job is running, then takes the hold
// on the sync queues in the same critical section as that check, so nothing can claim a queue in
// between: the nightly or a staff full run (dailySyncRunning), a replay or a manual N-1 run
// (historicalSyncRunning), the weekly globals, the custom-values queue, the hourly run, a phase
// run (claimPhaseRun), or a job started on its own. While the hold is taken those queues wait
// in claimQueue, the hourly run yields (hourlyBlockerLocked), and the API queues a staff press
// (IsAnyQueueBusy). The caller lets go with the returned func, once.
//
// The hourly run fires at 05:00 too; it yields to this pass once the pass has started, so this
// wait is only ever for one hourly run that got there first.
func (o *Orchestrator) holdQueuesForAllSeasons(ctx context.Context) (release func(), err error) {
	for {
		o.mu.Lock()
		busy := o.dailySyncRunning || o.historicalSyncRunning || o.weeklySyncRunning ||
			o.customValuesSyncRunning || o.hourlySyncRunning || o.phaseRuns > 0 ||
			o.anyJobRunningLocked()
		if !busy {
			hold := make(chan struct{})
			o.allSeasonsHold = hold
			o.mu.Unlock()
			return func() {
				o.mu.Lock()
				o.allSeasonsHold = nil
				o.mu.Unlock()
				close(hold)
			}, nil
		}
		o.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(allSeasonsQuietPoll):
		}
	}
}

// claimQueue runs claim, which sets a queue's running flag, under o.mu, once the all-seasons
// re-sync does not hold the queues; while it does, the caller waits for it to let go. Checking
// the hold and setting the flag in one critical section is what makes the two exclusive: the
// pass takes the hold only while no flag is set, and no flag is set while the pass holds.
//
// Waiting rather than refusing is deliberate. The pass is a few minutes of CampMinder calls, and
// the callers are the nightly, the weekly queues and a staff run the API already accepted, none
// of which should be lost to it.
func (o *Orchestrator) claimQueue(ctx context.Context, who string, claim func()) error {
	logged := false
	for {
		o.mu.Lock()
		hold := o.allSeasonsHold
		if hold == nil {
			claim()
			o.mu.Unlock()
			return nil
		}
		o.mu.Unlock()
		if !logged {
			slog.Info("Waiting for the all-seasons re-sync to release the sync queues", "run", who)
			logged = true
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-hold:
		}
	}
}

// dropBatch forgets a batch that never ran (its queue gave up waiting in claimQueue).
func (o *Orchestrator) dropBatch(batchID string) {
	o.mu.Lock()
	delete(o.batchChanged, batchID)
	o.mu.Unlock()
}

// IsAnyQueueBusy is the API's admission check: true while any queue or job runs, or the
// all-seasons re-sync holds the queues (gaps between its jobs included). A staff press that
// lands then is queued, and starts when the running queue ends.
func (o *Orchestrator) IsAnyQueueBusy() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.dailySyncRunning || o.weeklySyncRunning || o.historicalSyncRunning ||
		o.customValuesSyncRunning || o.hourlySyncRunning || o.allSeasonsHold != nil ||
		o.phaseRuns > 0 || o.anyJobRunningLocked()
}

// claimPhaseRun holds a queue slot for one phase run (Run Phase, immediate or dequeued) for its
// whole length, through claimQueue: it waits while the all-seasons re-sync holds the queues, and
// the pass and the API's admission check count it until the returned func lets go.
func (o *Orchestrator) claimPhaseRun(ctx context.Context) (release func(), err error) {
	if err := o.claimQueue(ctx, "a phase run", func() { o.phaseRuns++ }); err != nil {
		return nil, err
	}
	return func() {
		o.mu.Lock()
		if o.phaseRuns > 0 { // ClearSyncFlags may have zeroed it under a live run
			o.phaseRuns--
		}
		o.mu.Unlock()
	}, nil
}
