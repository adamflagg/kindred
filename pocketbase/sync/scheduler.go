package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/robfig/cron/v3"
)

// ErrUnknownSyncType is returned by TriggerSync when the sync type is not recognized.
var ErrUnknownSyncType = errors.New("unknown sync type")

// LogRetentionDays is the number of days to keep solver_runs logs before auto-pruning
// This is hardcoded as it's an infrastructure setting, not a business rule
const LogRetentionDays = 7

// Scheduler manages cron-based sync scheduling
type Scheduler struct {
	app          core.App
	cron         *cron.Cron
	orchestrator *Orchestrator
	mu           sync.Mutex
	running      bool
}

// NewScheduler creates a new scheduler
func NewScheduler(app core.App) *Scheduler {
	return &Scheduler{
		app:          app,
		cron:         cron.New(),
		orchestrator: NewOrchestrator(app),
	}
}

// Start initializes and starts the scheduler
func (s *Scheduler) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return fmt.Errorf("scheduler already running")
	}

	// Initialize sync services
	if err := s.orchestrator.InitializeSyncServices(); err != nil {
		return fmt.Errorf("initializing sync services: %w", err)
	}

	// Hourly: sessions, attendees, persons and bunk assignments, both synced seasons. It skips
	// the nightly's window and yields to any queue running the same jobs (runHourlySync).
	_, err := s.cron.AddFunc("0 * * * *", func() {
		slog.Info("Starting scheduled hourly sync (enrollments, people, sessions, bunk assignments)")
		s.runHourlySync()
	})
	if err != nil {
		return fmt.Errorf("adding hourly schedule: %w", err)
	}

	// Add daily schedule for all base data
	_, err = s.cron.AddFunc("0 3 * * *", func() {
		slog.Info("Starting scheduled daily sync (all base data)")
		s.runDailySync()
	})
	if err != nil {
		return fmt.Errorf("adding daily schedule: %w", err)
	}

	// Add weekly schedule for global data (runs Sunday at 2am, before daily sync)
	// These are expensive syncs (N API calls per entity) not suitable for daily runs
	// Currently includes: person_tag_defs, custom_field_defs
	_, err = s.cron.AddFunc("0 2 * * 0", func() {
		slog.Info("Starting scheduled weekly sync (global data)")
		s.runWeeklySync()
	})
	if err != nil {
		return fmt.Errorf("adding weekly schedule: %w", err)
	}

	// Add weekly schedule for custom values sync (runs Sunday at 4am, after weekly globals)
	// These are expensive syncs (1 API call per entity) - person + household custom field values
	_, err = s.cron.AddFunc("0 4 * * 0", func() {
		slog.Info("Starting scheduled custom values sync")
		s.runCustomValuesSync()
	})
	if err != nil {
		return fmt.Errorf("adding custom values schedule: %w", err)
	}

	// Weekly all-seasons re-sync of sessions, attendees and persons for every season older than
	// N-1 (all_seasons_resync.go). Saturday 05:00, clear of the nightly and of Sunday's passes.
	_, err = s.cron.AddFunc(allSeasonsResyncSchedule, func() {
		slog.Info("Starting scheduled all-seasons re-sync")
		s.runAllSeasonsResync()
	})
	if err != nil {
		return fmt.Errorf("adding all-seasons re-sync schedule: %w", err)
	}

	// Start the cron scheduler
	s.cron.Start()
	s.running = true

	slog.Info("Sync scheduler started")
	return nil
}

// Stop gracefully stops the scheduler
func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return
	}

	slog.Info("Stopping sync scheduler")
	ctx := s.cron.Stop()
	<-ctx.Done()
	s.running = false
	slog.Info("Sync scheduler stopped")
}

// The nightly's window, as offsets from local midnight in the container's zone (the cron's zone).
// The nightly starts at 03:00 and runs about an hour for two seasons. The hourly cron fires on
// the hour, so the ticks this removes are 03:00, which races the nightly's own start (two cron
// goroutines with no order between them, so the nightly's running flag may not be set yet), and
// 04:00, inside its N-1 pass. A nightly that overruns 04:30 still holds its flag, and the hourly
// run yields to that (RunHourlySync).
const (
	nightlyWindowStart = 2*time.Hour + 55*time.Minute
	nightlyWindowEnd   = 4*time.Hour + 30*time.Minute
)

// inNightlyWindow reports whether t falls in the nightly's window, 02:55 to 04:30 local time.
func inNightlyWindow(t time.Time) bool {
	local := t.In(time.Local)
	sinceMidnight := time.Duration(local.Hour())*time.Hour + time.Duration(local.Minute())*time.Minute
	return sinceMidnight >= nightlyWindowStart && sinceMidnight < nightlyWindowEnd
}

// runHourlySync runs the hourly sync (sessions, attendees, persons, bunk assignments, for both
// synced seasons), except in the nightly's window, where the nightly syncs the same jobs. A staff
// run that arrived meanwhile was queued (the API's admission checks count the hourly run), so it
// starts here once the hourly run ends: nothing else drains the queue but an API-started run.
func (s *Scheduler) runHourlySync() {
	if inNightlyWindow(nowFn()) {
		slog.Info("Hourly sync skipped: the nightly sync runs the same jobs in this window")
		return
	}
	switch err := s.orchestrator.RunHourlySync(context.Background()); {
	case errors.Is(err, errHourlySyncYielded):
		// Logged by RunHourlySync. The running queue drains the staff queue itself, or will
		// leave it to the next hour.
		return
	case err != nil:
		slog.Error("Hourly sync failed", "error", err)
	default:
		slog.Info("Hourly sync completed successfully")
	}
	processQueuedSyncs(s.orchestrator)
}

// runDailySync runs the daily sync tasks
func (s *Scheduler) runDailySync() {
	// Use background context for scheduled jobs
	ctx := context.Background()

	// Prune old solver run logs before starting sync
	if err := s.pruneOldSolverRuns(); err != nil {
		slog.Warn("Failed to prune old solver runs", "error", err)
		// Don't fail the sync, just warn
	}

	// Run full daily sync
	if err := s.orchestrator.RunDailySync(ctx); err != nil {
		slog.Error("Daily sync failed", "error", err)
	} else {
		slog.Info("Daily sync completed successfully")
	}
	processQueuedSyncs(s.orchestrator) // a staff press during the run was queued
}

// runWeeklySync runs the weekly sync tasks (global data)
func (s *Scheduler) runWeeklySync() {
	// Use background context for scheduled jobs
	ctx := context.Background()

	// Run weekly sync
	if err := s.orchestrator.RunWeeklySync(ctx); err != nil {
		slog.Error("Weekly sync failed", "error", err)
	} else {
		slog.Info("Weekly sync completed successfully")
	}
	processQueuedSyncs(s.orchestrator) // a staff press during the run was queued
}

const (
	// customValuesWaitForNightlyMax bounds the wait for a nightly that is still in its N-1 pass at 04:00.
	customValuesWaitForNightlyMax  = 45 * time.Minute
	customValuesWaitForNightlyPoll = 5 * time.Second
)

// runCustomValuesSync runs the weekly custom field values sync for current year.
// Each sync runs sequentially to prevent doubling API load and hitting rate limits.
// This fixes the "rate limiter wait: context deadline exceeded" issue.
func (s *Scheduler) runCustomValuesSync() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	// Sunday 04:00 lands inside the nightly's N-1 pass; the nightly has priority at the
	// CampMinder rate limit, so this pass starts when it ends (or after the bound).
	if err := s.orchestrator.waitWhile(ctx, "custom values", "the nightly", customValuesWaitForNightlyMax,
		customValuesWaitForNightlyPoll, func() bool { return s.orchestrator.dailySyncRunning }); err != nil {
		slog.Error("Custom values sync abandoned while waiting for the nightly", "error", err)
		return
	}

	// The orchestrator's own RunCustomValuesSync is not used here (it runs the jobs in
	// parallel), so the batch has to be minted directly or these runs would be recorded as
	// manual.
	batch := newBatch(triggerCustomValues)

	jobs := GetCustomValuesSyncJobs()
	slog.Info("Custom values sync starting (sequential)", "services", jobs)

	for _, job := range jobs {
		// Use runSyncAndWait to ensure each sync completes before starting the next.
		// This prevents concurrent API calls that would double rate limiter pressure.
		if err := s.orchestrator.runSyncAndWait(ctx, job, batch); err != nil {
			slog.Error("Custom values sync failed", "job", job, "error", err)
		} else {
			slog.Info("Custom values sync completed", "job", job)
		}
	}
	slog.Info("Custom values sync sequence completed")
	processQueuedSyncs(s.orchestrator) // a staff press during the run was queued
}

// runAllSeasonsResync runs the weekly all-seasons re-sync. The bound is generous: the pass is a
// few minutes of CampMinder calls, but it may wait for a nightly that overran first.
func (s *Scheduler) runAllSeasonsResync() {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	defer cancel()
	if err := s.orchestrator.RunAllSeasonsResync(ctx); err != nil {
		slog.Error("All-seasons re-sync failed", "error", err)
	}
	processQueuedSyncs(s.orchestrator) // a staff press during the run was queued
}

// TriggerCustomValuesSync manually triggers the custom values sync
func (s *Scheduler) TriggerCustomValuesSync() {
	go s.runCustomValuesSync()
}

// IsCustomValuesSyncRunning checks if custom values sync is currently running
func (s *Scheduler) IsCustomValuesSyncRunning() bool {
	return s.orchestrator.IsCustomValuesSyncRunning()
}

// pruneOldSolverRuns deletes solver_runs records older than LogRetentionDays
func (s *Scheduler) pruneOldSolverRuns() error {
	cutoff := time.Now().AddDate(0, 0, -LogRetentionDays)
	cutoffStr := cutoff.UTC().Format(time.RFC3339)

	slog.Info("Pruning old solver_runs", "cutoff", cutoffStr, "retentionDays", LogRetentionDays)

	collection, err := s.app.FindCollectionByNameOrId("solver_runs")
	if err != nil {
		return fmt.Errorf("finding solver_runs collection: %w", err)
	}

	// Find old records
	records, err := s.app.FindRecordsByFilter(
		collection,
		"created < {:cutoff}",
		"-created",
		1000, // Max records to delete at once
		0,
		dbx.Params{"cutoff": cutoffStr},
	)
	if err != nil {
		return fmt.Errorf("finding old solver runs: %w", err)
	}

	if len(records) == 0 {
		slog.Info("No old solver runs to prune")
		return nil
	}

	// Delete in transaction
	deleteCount := 0
	for _, record := range records {
		if err := s.app.Delete(record); err != nil {
			slog.Warn("Failed to delete solver_run", "recordId", record.Id, "error", err)
		} else {
			deleteCount++
		}
	}

	slog.Info("Pruned old solver runs", "deleted", deleteCount, "found", len(records))
	return nil
}

// TriggerSync manually triggers a sync
func (s *Scheduler) TriggerSync(ctx context.Context, syncType string) error {
	slog.Info("Manual sync triggered", "syncType", syncType)

	switch syncType {
	case "refresh-bunking":
		return s.orchestrator.RunSyncSequence(ctx, GetRefreshBunkingJobs())
	case runTypeDaily:
		return s.orchestrator.RunDailySync(ctx)
	case triggerHourly:
		return s.orchestrator.RunHourlySync(ctx)
	case runTypeWeekly:
		return s.orchestrator.RunWeeklySync(ctx)
	case "custom-values":
		return s.orchestrator.RunCustomValuesSync(ctx)
	default:
		return fmt.Errorf("unknown sync type %q: %w", syncType, ErrUnknownSyncType)
	}
}

// GetOrchestrator returns the orchestrator instance
func (s *Scheduler) GetOrchestrator() *Orchestrator {
	return s.orchestrator
}

// IsDailySyncRunning checks if daily sync is currently running
func (s *Scheduler) IsDailySyncRunning() bool {
	return s.orchestrator.IsDailySyncRunning()
}

// IsHourlySyncRunning checks if hourly sync is currently running
func (s *Scheduler) IsHourlySyncRunning() bool {
	return s.orchestrator.IsHourlySyncRunning()
}

// IsWeeklySyncRunning checks if weekly sync is currently running
func (s *Scheduler) IsWeeklySyncRunning() bool {
	return s.orchestrator.IsWeeklySyncRunning()
}

// TriggerDailySync manually triggers the daily sync
func (s *Scheduler) TriggerDailySync() {
	go s.runDailySync()
}

// TriggerHourlySync manually triggers the hourly sync
func (s *Scheduler) TriggerHourlySync() {
	go s.runHourlySync()
}

// TriggerWeeklySync manually triggers the weekly sync
func (s *Scheduler) TriggerWeeklySync() {
	go s.runWeeklySync()
}

// Global scheduler instance
var globalScheduler *Scheduler
var schedulerOnce sync.Once

// GetScheduler returns the global scheduler instance
func GetScheduler(app core.App) *Scheduler {
	schedulerOnce.Do(func() {
		globalScheduler = NewScheduler(app)
		// The one production orchestrator tells FastAPI about every finished run. Wired here
		// rather than in NewOrchestrator so no test orchestrator makes the HTTP call.
		globalScheduler.orchestrator.runCompletedNotifier = notifyAPIRunCompleted
	})
	return globalScheduler
}

// StartSyncScheduler starts the global scheduler
func StartSyncScheduler(app core.App) error {
	scheduler := GetScheduler(app)
	return scheduler.Start()
}
