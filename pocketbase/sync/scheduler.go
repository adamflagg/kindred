package sync

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/robfig/cron/v3"
)

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

	// Add hourly schedule for bunk assignments
	_, err := s.cron.AddFunc("0 * * * *", func() {
		slog.Info("Starting scheduled hourly sync (bunk assignments)")
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

// runHourlySync runs the hourly sync tasks
func (s *Scheduler) runHourlySync() {
	// Use background context for scheduled jobs
	ctx := context.Background()

	// Run bunk assignments sync only
	if err := s.orchestrator.RunSingleSync(ctx, "bunk_assignments"); err != nil {
		slog.Error("Hourly sync failed", "error", err)
	} else {
		slog.Info("Hourly sync completed successfully")
	}
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
		fmt.Sprintf("created < '%s'", cutoffStr),
		"-created",
		1000, // Max records to delete at once
		0,
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
		return s.orchestrator.RunSingleSync(ctx, "bunk_assignments")
	case "daily":
		return s.orchestrator.RunDailySync(ctx)
	case "hourly":
		return s.orchestrator.RunSingleSync(ctx, "bunk_assignments")
	default:
		return fmt.Errorf("unknown sync type: %s", syncType)
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
	// For now, hourly sync only runs bunk_assignments
	return s.orchestrator.IsRunning("bunk_assignments")
}

// TriggerDailySync manually triggers the daily sync
func (s *Scheduler) TriggerDailySync() {
	go s.runDailySync()
}

// TriggerHourlySync manually triggers the hourly sync
func (s *Scheduler) TriggerHourlySync() {
	go s.runHourlySync()
}

// Global scheduler instance
var globalScheduler *Scheduler
var schedulerOnce sync.Once

// GetScheduler returns the global scheduler instance
func GetScheduler(app core.App) *Scheduler {
	schedulerOnce.Do(func() {
		globalScheduler = NewScheduler(app)
	})
	return globalScheduler
}

// StartSyncScheduler starts the global scheduler
func StartSyncScheduler(app core.App) error {
	scheduler := GetScheduler(app)
	return scheduler.Start()
}
