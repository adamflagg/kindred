// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/camp/kindred/pocketbase/google"
	"github.com/pocketbase/pocketbase/core"
)

const (
	// statusFailed indicates a sync job has failed
	statusFailed = "failed"
	// statusRunning indicates a sync job is currently running
	statusRunning = "running"
	// statusPending indicates a sync job is queued
	statusPending = "pending"
	// statusSuccess indicates a sync job finished successfully
	statusSuccess = "success"
	// statusCompleted indicates a sync job has completed successfully
	statusCompleted = "completed"

	// Run type constants for GetCurrentRunProgress
	runTypeDaily        = "daily"
	runTypeHistorical   = "historical"
	runTypeWeekly       = "weekly"
	runTypeCustomValues = "custom_values"
)

// Phase represents a category of sync jobs
type Phase string

const (
	// PhaseSource - CampMinder API → PocketBase
	PhaseSource Phase = "source"
	// PhaseExpensive - CampMinder API (1 call/entity, rate limited)
	PhaseExpensive Phase = "expensive"
	// PhaseTransform - PocketBase → PocketBase (no API)
	PhaseTransform Phase = "transform"
	// PhaseProcess - CSV import + AI processing
	PhaseProcess Phase = "process"
	// PhaseExport - PocketBase → Google Sheets
	PhaseExport Phase = "export"
)

// JobMeta contains metadata about a sync job
type JobMeta struct {
	ID          string
	Phase       Phase
	Description string
}

// syncJobMeta defines the phase and metadata for all sync jobs
// Jobs are listed in execution order within their phase
var syncJobMeta = []JobMeta{
	// Source phase - CampMinder API calls
	{"session_groups", PhaseSource, "Session groups from CampMinder"},
	{"sessions", PhaseSource, "Sessions from CampMinder"},
	{"attendees", PhaseSource, "Attendees from CampMinder"},
	{"persons", PhaseSource, "Persons + households from CampMinder"},
	{"bunks", PhaseSource, "Bunks from CampMinder"},
	{"bunk_plans", PhaseSource, "Bunk plans from CampMinder"},
	{"bunk_assignments", PhaseSource, "Bunk assignments from CampMinder"},
	{"staff", PhaseSource, "Staff from CampMinder"},
	{"financial_transactions", PhaseSource, "Financial transactions from CampMinder"},

	// Expensive phase - Custom values (on-demand, rate limited)
	{"person_custom_values", PhaseExpensive, "Person custom field values"},
	{"household_custom_values", PhaseExpensive, "Household custom field values"},

	// Transform phase - PocketBase → PocketBase
	{"camper_history", PhaseTransform, "Compute camper history from attendees"},
	{"family_camp_derived", PhaseTransform, "Compute family camp tables from custom values"},
	{"staff_skills", PhaseTransform, "Extract staff skills from person_custom_values"},
	{"financial_aid_applications", PhaseTransform, "Extract FA applications from person_custom_values"},
	{"household_demographics", PhaseTransform, "Compute household demographics from custom values"},
	{"camper_dietary", PhaseTransform, "Extract camper dietary/allergy info from custom values"},
	{"camper_transportation", PhaseTransform, "Extract camper transportation info from custom values"},
	{"quest_registrations", PhaseTransform, "Extract Quest program registration info from custom values"},
	{"staff_applications", PhaseTransform, "Extract staff application info from custom values"},
	{"staff_vehicle_info", PhaseTransform, "Extract staff vehicle info from custom values"},
	{"normalize_geographic", PhaseTransform, "Normalize geographic data (cities, schools, congregations)"},
	{"enrollment_snapshots", PhaseTransform, "Capture daily enrollment counts per session"},
	{"orphan_reconciler", PhaseTransform, "Auto-unassign scenario drafts stranded by bunk-plan changes"},

	// Process phase - CSV + AI
	{"reconcile_request_lifecycle", PhaseProcess, "Mark moved-requester OBRs for reprocessing"},
	{"bunk_requests", PhaseProcess, "Import bunk request CSV"},
	{"process_requests", PhaseProcess, "AI processing of bunk requests"},

	// Export phase - Google Sheets
	{"multi_workbook_export", PhaseExport, "Export to Google Sheets"},
}

// GetJobMeta returns the sync job metadata array
func GetJobMeta() []JobMeta {
	return syncJobMeta
}

// GetJobsForPhase returns job IDs for a specific phase
func GetJobsForPhase(phase Phase) []string {
	var jobs []string
	for _, meta := range syncJobMeta {
		if meta.Phase == phase {
			jobs = append(jobs, meta.ID)
		}
	}
	return jobs
}

// GetAllPhases returns all phases in execution order
func GetAllPhases() []Phase {
	return []Phase{
		PhaseSource,
		PhaseExpensive,
		PhaseTransform,
		PhaseProcess,
		PhaseExport,
	}
}

// GetPhaseForJob returns the phase for a given job ID
func GetPhaseForJob(jobID string) Phase {
	for _, meta := range syncJobMeta {
		if meta.ID == jobID {
			return meta.Phase
		}
	}
	return ""
}

// GetDefaultUnifiedSyncJobs returns the default job list for a unified sync
// (when no specific services are requested). The includeCustomValues flag
// controls whether expensive custom values API syncs are included.
// Transform phase jobs always run using existing custom values data.
func GetDefaultUnifiedSyncJobs(includeCustomValues bool) []string {
	// Source phase: CampMinder API syncs
	jobs := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"staff",
		"financial_transactions",
	}

	// Expensive phase: Custom values (1 API call per entity)
	if includeCustomValues {
		jobs = append(jobs,
			"person_custom_values", "household_custom_values")
	}

	// Transform phase: Always run using existing custom values data
	// (same as daily sync behavior)
	jobs = append(jobs,
		"camper_history", "family_camp_derived", "staff_skills",
		"financial_aid_applications", "household_demographics",
		"camper_dietary", "camper_transportation", "quest_registrations",
		"staff_applications", "staff_vehicle_info", "normalize_geographic",
		"enrollment_snapshots", "orphan_reconciler")

	return jobs
}

// Service defines the interface for sync services
type Service interface {
	Sync(ctx context.Context) error
	Name() string
	GetStats() Stats
}

// Debuggable is an optional interface for services that support debug logging
type Debuggable interface {
	SetDebug(debug bool)
}

// YearSetter is an optional interface for services that need year configuration.
// Services that query year-scoped data should implement this to receive the
// correct year from handleRunPhase before execution.
type YearSetter interface {
	SetYear(year int)
}

// Status represents the status of a sync operation
type Status struct {
	Type      string     `json:"type"`
	Status    string     `json:"status"`
	StartTime time.Time  `json:"start_time"`
	EndTime   *time.Time `json:"end_time,omitempty"`
	Error     string     `json:"error,omitempty"`
	Summary   Stats      `json:"summary"`
	Year      int        `json:"year,omitempty"`      // Year being synced (0 = current year)
	RunToken  string     `json:"run_token,omitempty"` // Unique token per run to prevent cross-run confusion
}

// QueuedSync represents a sync request waiting in the queue
type QueuedSync struct {
	ID                  string         `json:"id"`
	Year                int            `json:"year"`
	Type                string         `json:"type"`    // "unified", "phase", "individual"
	Service             string         `json:"service"` // unified: "all"; phase: phase name; individual: job name
	IncludeCustomValues bool           `json:"include_custom_values"`
	Debug               bool           `json:"debug"`
	Options             map[string]any `json:"options,omitempty"`
	QueuedAt            time.Time      `json:"queued_at"`
	RequestedBy         string         `json:"requested_by"`
}

// MaxQueueSize is the maximum number of syncs that can be queued (0 = unlimited)
const MaxQueueSize = 0

// Stats holds statistics for a sync operation
type Stats struct {
	Created int `json:"created"`
	Updated int `json:"updated"`
	Deleted int `json:"deleted,omitempty"` // For tracking deletions (e.g., removed bunk requests)
	Skipped int `json:"skipped"`
	Errors  int `json:"errors"`
	// Expanded tracks many-to-many expansions (e.g., bunk plans)
	Expanded int `json:"expanded,omitempty"`
	// AlreadyProcessed tracks records already processed (for process_requests)
	AlreadyProcessed int `json:"already_processed,omitempty"`
	// ProdAuditWarnings counts bunk_assignments rows found stranded but not cleared (observe-only).
	ProdAuditWarnings int `json:"prod_audit_warnings,omitempty"`
	// Duration in seconds
	Duration int `json:"duration"`
	// SubStats for combined syncs (e.g., persons includes households)
	SubStats map[string]Stats `json:"sub_stats,omitempty"`
}

// IsNoOp returns true if the sync made no changes to the database.
// A sync is a no-op when Created, Updated, Deleted, and Errors are all zero.
// Skipped records don't affect the data, so they're not considered changes.
func (s Stats) IsNoOp() bool {
	return s.Created == 0 && s.Updated == 0 && s.Deleted == 0 && s.Errors == 0
}

// Options configures how syncs are executed
type Options struct {
	Year                int      // Override year (0 = use default from env)
	Services            []string // Specific services to run (empty = all)
	Concurrent          bool     // Run services in parallel
	IncludeCustomValues bool     // Include custom field values in historical sync
	Debug               bool     // Enable debug logging for custom values sync
}

// Orchestrator manages sync service execution
type Orchestrator struct {
	app                     core.App
	services                map[string]Service
	mu                      sync.RWMutex
	runningJobs             map[string]*Status
	lastCompletedStatus     map[string]*Status // Store last completed status for each job
	jobSpacing              time.Duration
	baseClient              *campminder.Client // Base client for year overrides
	currentSyncYear         int                // Year being synced (0 = current year from env)
	dailySyncRunning        bool               // Track if daily sync sequence is in progress
	dailySyncQueue          []string           // Services queued for daily sync
	historicalSyncRunning   bool               // Track if historical sync sequence is in progress
	historicalSyncQueue     []string           // Services queued for historical sync
	historicalSyncYear      int                // Year being synced in historical sync
	weeklySyncRunning       bool               // Track if weekly sync sequence is in progress
	weeklySyncQueue         []string           // Services queued for weekly sync
	customValuesSyncRunning bool               // Track if custom values sync sequence is in progress
	customValuesSyncQueue   []string           // Services queued for custom values sync
	pendingUnifiedSyncs     []QueuedSync       // Queue of pending unified sync requests (FIFO)
	activeSyncCancel        context.CancelFunc // Cancel function for the currently running sync
	currentRunIndex         int                // 0-based index of currently running job in active queue
}

// NewOrchestrator creates a new orchestrator
func NewOrchestrator(app core.App) *Orchestrator {
	return &Orchestrator{
		app:                 app,
		services:            make(map[string]Service),
		runningJobs:         make(map[string]*Status),
		lastCompletedStatus: make(map[string]*Status),
		jobSpacing:          2 * time.Second, // Default 2 seconds between jobs
	}
}

// RegisterService registers a sync service
func (o *Orchestrator) RegisterService(name string, service Service) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.services[name] = service
	slog.Info("Registered sync service", "name", name)
}

// GetService returns a registered sync service by name
func (o *Orchestrator) GetService(name string) Service {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.services[name]
}

// IsRunning checks if a sync type is currently running
func (o *Orchestrator) IsRunning(syncType string) bool {
	o.mu.RLock()
	defer o.mu.RUnlock()

	status, exists := o.runningJobs[syncType]
	return exists && status.Status == statusRunning
}

// GetRunningJobs returns all currently running jobs
func (o *Orchestrator) GetRunningJobs() []string {
	o.mu.RLock()
	defer o.mu.RUnlock()

	var running []string
	for name, status := range o.runningJobs {
		if status.Status == statusRunning {
			running = append(running, name)
		}
	}
	return running
}

// IsDailySyncRunning returns whether a daily sync sequence is in progress
func (o *Orchestrator) IsDailySyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.dailySyncRunning
}

// IsHistoricalSyncRunning returns whether a historical sync sequence is in progress
func (o *Orchestrator) IsHistoricalSyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.historicalSyncRunning
}

// GetHistoricalSyncYear returns the year being synced in historical sync
func (o *Orchestrator) GetHistoricalSyncYear() int {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.historicalSyncYear
}

// IsWeeklySyncRunning returns whether a weekly sync sequence is in progress
func (o *Orchestrator) IsWeeklySyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.weeklySyncRunning
}

// GetChangedCollections returns a set of collections that had changes in the last sync run.
// Collections not in the returned map should skip export since their data hasn't changed.
// The mapping uses SyncJobToCollections to translate sync job names to collection names.
func (o *Orchestrator) GetChangedCollections() map[string]bool {
	o.mu.RLock()
	defer o.mu.RUnlock()

	changed := make(map[string]bool)
	for syncType, status := range o.lastCompletedStatus {
		if !status.Summary.IsNoOp() {
			if collections, ok := SyncJobToCollections[syncType]; ok {
				for _, col := range collections {
					changed[col] = true
				}
			}
		}
	}
	return changed
}

// IsCustomValuesSyncRunning returns whether a custom values sync sequence is in progress
func (o *Orchestrator) IsCustomValuesSyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.customValuesSyncRunning
}

// GetCurrentRunProgress returns progress information for the currently running sync sequence.
// Returns:
//   - runType: "daily", "historical", "weekly", "custom_values", or "" if nothing running
//   - remaining: slice of job IDs that will run after the current job
//   - total: total number of jobs in the current sequence
//   - completed: number of jobs completed so far (currentRunIndex)
func (o *Orchestrator) GetCurrentRunProgress() (runType string, remaining []string, total, completed int) {
	o.mu.RLock()
	defer o.mu.RUnlock()

	// Determine which queue is active and return its remaining jobs
	var queue []string
	switch {
	case o.dailySyncRunning:
		runType = runTypeDaily
		queue = o.dailySyncQueue
	case o.historicalSyncRunning:
		runType = runTypeHistorical
		queue = o.historicalSyncQueue
	case o.weeklySyncRunning:
		runType = runTypeWeekly
		queue = o.weeklySyncQueue
	case o.customValuesSyncRunning:
		runType = runTypeCustomValues
		queue = o.customValuesSyncQueue
	default:
		return "", nil, 0, 0
	}

	total = len(queue)
	completed = o.currentRunIndex
	// Jobs after current one (currentRunIndex points to currently running job)
	if completed+1 < total {
		remaining = queue[completed+1:]
	} else {
		remaining = []string{} // Ensure JSON serializes as [] not null
	}
	return runType, remaining, total, completed
}

// IsAnyJobRunning returns true if any sync job is currently running.
// This is used to queue individual sync requests when another job is already active.
func (o *Orchestrator) IsAnyJobRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	for _, status := range o.runningJobs {
		if status.Status == statusRunning {
			return true
		}
	}
	return false
}

// GetWeeklySyncJobs returns the list of services that run in the weekly sync.
// These are global definition tables that rarely change and don't need daily updates.
func GetWeeklySyncJobs() []string {
	return []string{
		"person_tag_defs",
		"custom_field_defs",
		"staff_lookups",     // Global: positions, org_categories, program_areas
		"financial_lookups", // Global: financial_categories, payment_methods
		"divisions",         // Global: division definitions (no year field)
	}
}

// GetRefreshBunkingJobs returns the services needed for a full bunking refresh.
// Runs in order: bunks (fetch latest bunk list), bunk_plans (update plans),
// bunk_assignments (update assignments), then orphan_reconciler — the bunk_plans
// rewrite is exactly what strands scenario drafts, so they must be swept in the
// same run rather than left until the next daily sync.
func GetRefreshBunkingJobs() []string {
	return []string{
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"orphan_reconciler",
	}
}

// GetCustomValuesSyncJobs returns the list of services that run in the custom values sync.
// These are expensive syncs (1 API call per entity) that run weekly after the main weekly sync.
func GetCustomValuesSyncJobs() []string {
	return []string{
		"person_custom_values",
		"household_custom_values",
	}
}

// RunSyncSequence runs multiple sync services sequentially, waiting for each
// to complete before starting the next. Unlike RunSyncWithOptions, this is
// lightweight — no global table checks, no year override, no daily/historical
// tracking. Used for targeted refreshes like bunking (bunks -> bunk_plans ->
// bunk_assignments).
func (o *Orchestrator) RunSyncSequence(ctx context.Context, services []string) error {
	for _, svc := range services {
		if err := o.runSyncAndWait(ctx, svc); err != nil {
			return fmt.Errorf("sync sequence failed on %s: %w", svc, err)
		}
	}
	return nil
}

// RunSingleSync runs a single sync service
func (o *Orchestrator) RunSingleSync(parentCtx context.Context, syncType string) error {
	_, err := o.runSingleSyncInternal(parentCtx, syncType)
	return err
}

// runSingleSyncInternal runs a single sync service and returns the run token.
func (o *Orchestrator) runSingleSyncInternal(parentCtx context.Context, syncType string) (string, error) {
	// Check if service exists
	o.mu.RLock()
	service, exists := o.services[syncType]
	existingStatus := o.runningJobs[syncType]
	o.mu.RUnlock()

	if !exists {
		return "", fmt.Errorf("sync service not found: %s", syncType)
	}

	// Generate a unique token for this run
	runToken := generateRunToken()

	// Check if status was pre-marked by MarkSyncRunning
	// If so, reuse it; otherwise create a new status
	var status *Status
	if existingStatus != nil {
		// Reuse pre-marked status (set by MarkSyncRunning before goroutine started)
		status = existingStatus
		// Overwrite the token so runSyncAndWait can track this specific execution
		o.mu.Lock()
		status.RunToken = runToken
		o.mu.Unlock()
	} else {
		// No pre-marked status - check if something else is running
		if o.IsRunning(syncType) {
			return "", fmt.Errorf("sync already in progress: %s", syncType)
		}

		// Create status entry
		status = &Status{
			Type:      syncType,
			Status:    statusRunning,
			StartTime: time.Now(),
			Summary:   Stats{},
			Year:      o.currentSyncYear,
			RunToken:  runToken,
		}

		o.mu.Lock()
		o.runningJobs[syncType] = status
		o.mu.Unlock()
	}

	// Run sync with panic recovery
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("Sync panicked", "syncType", syncType, "panic", r)
				endTime := time.Now()
				panicStatus := *status
				panicStatus.Status = statusFailed
				panicStatus.Error = fmt.Sprintf("panic: %v", r)
				panicStatus.EndTime = &endTime

				o.mu.Lock()
				o.lastCompletedStatus[syncType] = &panicStatus
				delete(o.runningJobs, syncType)
				o.mu.Unlock()
			}
		}()

		// Create sync context with independent timeout (NOT derived from parent).
		// This fixes the "context canceled" race condition where:
		// 1. API handler spawns goroutine with ctx + defer cancel()
		// 2. RunSingleSync spawns THIS goroutine and returns immediately
		// 3. Handler goroutine exits -> defer cancel() fires -> cascades to derived ctx
		// Solution: Always use context.Background() to avoid parent cancellation cascade.
		// Use the longer of parent's remaining time or 2 hours for adequate timeout.
		var syncCtx context.Context
		var cancel context.CancelFunc

		timeout := 2 * time.Hour
		if parentDeadline, hasDeadline := parentCtx.Deadline(); hasDeadline {
			remaining := time.Until(parentDeadline)
			timeout = max(timeout, remaining)
		}
		syncCtx, cancel = context.WithTimeout(context.Background(), timeout)
		defer cancel()

		// Execute sync with the appropriately-configured context
		err := service.Sync(syncCtx)

		// Build completed status as a copy — never mutate the shared pointer
		endTime := time.Now()
		completed := *status
		completed.EndTime = &endTime

		duration := int(endTime.Sub(completed.StartTime).Seconds())
		stats := service.GetStats()
		stats.Duration = duration
		completed.Summary = stats

		if err != nil {
			completed.Status = statusFailed
			completed.Error = err.Error()
			if completed.Year == 0 {
				slog.Error("Sync failed", "syncType", syncType, "error", err)
			}
		} else {
			completed.Status = statusSuccess
			if completed.Year == 0 {
				slog.Info("Sync completed successfully", "syncType", syncType)
			}
		}

		// Atomic swap: store completed copy before removing from running
		o.mu.Lock()
		o.lastCompletedStatus[syncType] = &completed
		delete(o.runningJobs, syncType)
		o.mu.Unlock()
	}()

	return runToken, nil
}

// MarkSyncRunning sets a sync's status to "running" without starting it.
// Used by API handlers to ensure status is visible before the goroutine executes.
// This prevents the race condition where the frontend polls before the status is set.
func (o *Orchestrator) MarkSyncRunning(syncType string) error {
	// Check if service exists
	o.mu.RLock()
	_, exists := o.services[syncType]
	o.mu.RUnlock()
	if !exists {
		return fmt.Errorf("sync service not found: %s", syncType)
	}

	// Check if already running
	if o.IsRunning(syncType) {
		return fmt.Errorf("sync already in progress: %s", syncType)
	}

	// Create status entry with a unique run token
	status := &Status{
		Type:      syncType,
		Status:    statusRunning,
		StartTime: time.Now(),
		Summary:   Stats{},
		Year:      o.currentSyncYear,
		RunToken:  generateRunToken(),
	}

	o.mu.Lock()
	o.runningJobs[syncType] = status
	o.mu.Unlock()

	return nil
}

// FinalizeSyncStatus updates a sync's status after completion.
// Sets end time, stats, and status (success/failed), then moves from
// runningJobs to lastCompletedStatus. No-ops if syncType is not tracked.
// Used by handlers that manage their own Service instances (e.g., process_requests)
// rather than routing through RunSingleSync.
func (o *Orchestrator) FinalizeSyncStatus(syncType string, stats Stats, err error) {
	endTime := time.Now()

	o.mu.Lock()
	status, exists := o.runningJobs[syncType]
	if !exists {
		o.mu.Unlock()
		return
	}

	// Copy struct so readers of the old pointer see a consistent snapshot
	completed := *status
	completed.EndTime = &endTime
	stats.Duration = int(endTime.Sub(completed.StartTime).Seconds())
	completed.Summary = stats
	if err != nil {
		completed.Status = statusFailed
		completed.Error = err.Error()
	} else {
		completed.Status = statusSuccess
		completed.Error = ""
	}

	o.lastCompletedStatus[syncType] = &completed
	delete(o.runningJobs, syncType)
	o.mu.Unlock()

	if err != nil {
		slog.Error("Sync failed", "syncType", syncType, "error", err)
	} else {
		slog.Info("Sync completed successfully", "syncType", syncType)
	}
}

// checkGlobalTablesEmpty checks if essential global tables have been synced.
// Returns true if global tables are empty and weekly sync should run first.
func (o *Orchestrator) checkGlobalTablesEmpty() bool {
	// Quick check on person_tag_defs - if empty, globals haven't run
	records, _ := o.app.FindRecordsByFilter("person_tag_defs", "", "", 1, 0)
	return len(records) == 0
}

// getDailySyncJobs returns the ordered list of jobs the daily sync runs,
// respecting inter-job dependencies. orphan_reconciler is always appended last:
// it must run after bunk_plans is final so it can sweep scenario drafts left
// stranded by bunk-plan reorganizations (#1416, #1417). Extracted from
// RunDailySync so the ordering can be asserted in tests.
func getDailySyncJobs() []string {
	// Define sync order (respecting dependencies)
	// Note: person_tag_defs, custom_field_defs, and divisions run in weekly sync
	// since they're global definitions that rarely change
	// Note: "persons" is a combined sync that populates persons and households
	// tables from a single API call (tags are stored as multi-select relation on persons)
	orderedJobs := []string{
		"session_groups",         // No dependencies - sync first for group data
		"sessions",               // Depends on session_groups (for session_group relation)
		"attendees",              // Depends on sessions
		"persons",                // Depends on attendees and divisions (combined sync: persons + households)
		"bunks",                  // No dependencies
		"bunk_plans",             // Depends on sessions and bunks
		"bunk_assignments",       // Depends on sessions, persons, bunks
		"staff",                  // Staff sync: depends on divisions, bunks, persons
		"financial_transactions", // Source data: depends on sessions, persons, households, divisions
		// Transform phase: derived tables run daily using latest source data
		// and existing custom values from the most recent weekly sync.
		// New enrollments, session changes, etc. are reflected immediately.
		"camper_history",
		"family_camp_derived",
		"staff_skills",
		"financial_aid_applications",
		"household_demographics",
		"camper_dietary",
		"camper_transportation",
		"quest_registrations",
		"staff_applications",
		"staff_vehicle_info",
		"normalize_geographic",
		"enrollment_snapshots",
		"reconcile_request_lifecycle", // Detect session moves; marks OBRs for reprocessing
		"bunk_requests",               // CSV import, depends on persons
	}

	// Only include process_requests in production (Docker) mode
	// In development, skip AI processing to avoid unnecessary API costs
	// Process requests can be triggered manually when needed
	if os.Getenv("IS_DOCKER") == boolTrueStr {
		orderedJobs = append(orderedJobs, "process_requests")
	} else {
		slog.Info("Skipping process_requests in development mode (set IS_DOCKER=true to enable)")
	}

	// Add Google Sheets multi-workbook export if enabled (runs after all data syncs complete)
	if google.IsEnabled() {
		orderedJobs = append(orderedJobs, "multi_workbook_export")
	}

	// Orphan reconciliation runs last — after bunk_plans is final, it sweeps
	// scenario drafts left stranded by bunk-plan reorganizations (#1416, #1417).
	orderedJobs = append(orderedJobs, "orphan_reconciler")

	return orderedJobs
}

// RunDailySync runs all base data syncs in the correct order
func (o *Orchestrator) RunDailySync(ctx context.Context) error {
	// Check if global tables are empty - if so, run weekly sync first
	// This ensures fresh DB setups have required global definitions before daily sync
	if o.checkGlobalTablesEmpty() {
		slog.Info("Global tables empty - running weekly sync first")
		if err := o.RunWeeklySync(ctx); err != nil {
			slog.Error("Weekly sync failed, continuing with daily", "error", err)
		}
	}

	orderedJobs := getDailySyncJobs()

	// Set daily sync flag and queue
	o.mu.Lock()
	o.dailySyncRunning = true
	o.dailySyncQueue = orderedJobs
	o.currentRunIndex = 0 // Reset index at start
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.dailySyncRunning = false
		o.dailySyncQueue = nil
		o.currentRunIndex = 0
		o.mu.Unlock()
	}()

	slog.Info("Starting daily sync sequence")

	for i, jobName := range orderedJobs {
		// Update current run index
		o.mu.Lock()
		o.currentRunIndex = i
		o.mu.Unlock()

		// Check if context is canceled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Add spacing between jobs (except for the first one)
		if i > 0 {
			slog.Info("Waiting before next sync", "duration", o.jobSpacing)
			time.Sleep(o.jobSpacing)
		}

		slog.Info("Daily sync: Starting service", "service", jobName, "progress", fmt.Sprintf("%d/%d", i+1, len(orderedJobs)))

		// Run sync and wait for completion
		if err := o.runSyncAndWait(ctx, jobName); err != nil {
			slog.Error("Daily sync: service failed", "service", jobName, "error", err)
			// Continue with other syncs even if one fails
		} else {
			slog.Info("Daily sync: service completed", "service", jobName)
		}
	}

	slog.Info("Daily sync sequence completed")
	return nil
}

// RunWeeklySync runs global data syncs that are too expensive for daily sync.
// These services require N API calls (one per entity) and run once per week.
//
//nolint:dupl // Similar pattern to RunCustomValuesSync, intentional for sync orchestration
func (o *Orchestrator) RunWeeklySync(ctx context.Context) error {
	// Get the weekly sync jobs
	weeklyJobs := GetWeeklySyncJobs()

	// Set weekly sync flag and queue
	o.mu.Lock()
	o.weeklySyncRunning = true
	o.weeklySyncQueue = weeklyJobs
	o.currentRunIndex = 0 // Reset index at start
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.weeklySyncRunning = false
		o.weeklySyncQueue = nil
		o.currentRunIndex = 0
		o.mu.Unlock()
	}()

	slog.Info("Starting weekly sync sequence", "services", weeklyJobs)

	for i, jobName := range weeklyJobs {
		// Update current run index
		o.mu.Lock()
		o.currentRunIndex = i
		o.mu.Unlock()

		// Check if context is canceled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Add spacing between jobs (except for the first one)
		if i > 0 {
			slog.Info("Waiting before next sync", "duration", o.jobSpacing)
			time.Sleep(o.jobSpacing)
		}

		slog.Info("Weekly sync: Starting service", "service", jobName, "progress", fmt.Sprintf("%d/%d", i+1, len(weeklyJobs)))

		// Run sync and wait for completion
		if err := o.runSyncAndWait(ctx, jobName); err != nil {
			slog.Error("Weekly sync: service failed", "service", jobName, "error", err)
			// Continue with other syncs even if one fails
		} else {
			slog.Info("Weekly sync: service completed", "service", jobName)
		}
	}

	slog.Info("Weekly sync sequence completed")
	return nil
}

// RunCustomValuesSync runs custom field values syncs for person and household entities in parallel.
// These are expensive syncs (1 API call per entity) that run weekly after the main weekly sync.
// Running in parallel is safe because they sync independent tables (person_custom_values vs
// household_custom_values) using different CampMinder API endpoints.
func (o *Orchestrator) RunCustomValuesSync(ctx context.Context) error {
	// Get the custom values sync jobs
	customValuesJobs := GetCustomValuesSyncJobs()

	// Set custom values sync flag and queue
	// Note: currentRunIndex is 0 for parallel syncs (all jobs run simultaneously)
	o.mu.Lock()
	o.customValuesSyncRunning = true
	o.customValuesSyncQueue = customValuesJobs
	o.currentRunIndex = 0
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.customValuesSyncRunning = false
		o.customValuesSyncQueue = nil
		o.currentRunIndex = 0
		o.mu.Unlock()
	}()

	slog.Info("Starting custom values sync sequence (parallel)", "services", customValuesJobs)

	var wg sync.WaitGroup
	errChan := make(chan error, len(customValuesJobs))

	for _, jobName := range customValuesJobs {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()

			// Check if context is canceled before starting
			select {
			case <-ctx.Done():
				errChan <- ctx.Err()
				return
			default:
			}

			slog.Info("Custom values sync: Starting service", "service", name)

			if err := o.runSyncAndWait(ctx, name); err != nil {
				slog.Error("Custom values sync: service failed", "service", name, "error", err)
				errChan <- err
			} else {
				slog.Info("Custom values sync: service completed", "service", name)
			}
		}(jobName)
	}

	wg.Wait()
	close(errChan)

	// Collect any errors
	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	slog.Info("Custom values sync sequence completed")
	return errors.Join(errs...)
}

// runSyncAndWait runs a sync and waits for it to complete
func (o *Orchestrator) runSyncAndWait(ctx context.Context, syncType string) error {
	// Start the sync and capture the token directly from the return value.
	// This eliminates the race where the goroutine completes before we can
	// read the token from runningJobs (issue #789).
	expectedToken, err := o.runSingleSyncInternal(ctx, syncType)
	if err != nil {
		return err
	}

	// Wait for completion
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if !o.IsRunning(syncType) {
				// Check final status — only accept if the token matches this run
				o.mu.RLock()
				status := o.lastCompletedStatus[syncType]
				o.mu.RUnlock()

				if status != nil && status.RunToken == expectedToken {
					if status.Status == statusFailed {
						return fmt.Errorf("%s", status.Error)
					}
					return nil
				}
				// Token doesn't match — a stale completion; keep waiting
			}
		}
	}
}

// GetStatus returns the status of a sync job
func (o *Orchestrator) GetStatus(syncType string) *Status {
	o.mu.RLock()
	defer o.mu.RUnlock()

	// Check running jobs first
	if status, exists := o.runningJobs[syncType]; exists {
		// Return a copy to avoid race conditions
		statusCopy := *status
		return &statusCopy
	}

	// If daily sync is running and this service is queued, return pending status
	if o.dailySyncRunning {
		for _, queuedService := range o.dailySyncQueue {
			if queuedService == syncType {
				// This service is part of the daily sync sequence
				// Check if it has already completed in this sequence
				if status, exists := o.lastCompletedStatus[syncType]; exists {
					// If the status is from the current year (Year == 0), it might be from this sequence
					// Check if it was completed very recently (within the last hour)
					if status.Year == 0 && status.EndTime != nil {
						if time.Since(*status.EndTime) < time.Hour {
							statusCopy := *status
							return &statusCopy
						}
					}
				}
				// Otherwise, it's pending
				return &Status{
					Type:   syncType,
					Status: statusPending,
					Year:   0, // Current year
				}
			}
		}
	}

	// If historical sync is running and this service is queued, return pending status
	if o.historicalSyncRunning {
		for _, queuedService := range o.historicalSyncQueue {
			if queuedService == syncType {
				// This service is part of the historical sync sequence
				// Check if it has already completed in this sequence
				if status, exists := o.lastCompletedStatus[syncType]; exists {
					// If the status year matches the historical sync year, it's from this sequence
					if status.Year == o.historicalSyncYear {
						statusCopy := *status
						return &statusCopy
					}
				}
				// Otherwise, it's pending
				return &Status{
					Type:   syncType,
					Status: statusPending,
					Year:   o.historicalSyncYear,
				}
			}
		}
	}

	// If weekly sync is running and this service is queued, return pending status
	if o.weeklySyncRunning {
		for _, queuedService := range o.weeklySyncQueue {
			if queuedService == syncType {
				// Check if it has already completed in this sequence
				if status, exists := o.lastCompletedStatus[syncType]; exists {
					// If completed very recently (within the last hour), show that status
					if status.EndTime != nil && time.Since(*status.EndTime) < time.Hour {
						statusCopy := *status
						return &statusCopy
					}
				}
				// Otherwise, it's pending
				return &Status{
					Type:   syncType,
					Status: statusPending,
					Year:   0, // Global sync (no year)
				}
			}
		}
	}

	// If custom values sync is running and this service is queued, return pending status
	if o.customValuesSyncRunning {
		for _, queuedService := range o.customValuesSyncQueue {
			if queuedService == syncType {
				// Check if it has already completed in this sequence
				if status, exists := o.lastCompletedStatus[syncType]; exists {
					// If completed very recently (within the last hour), show that status
					if status.EndTime != nil && time.Since(*status.EndTime) < time.Hour {
						statusCopy := *status
						return &statusCopy
					}
				}
				// Otherwise, it's pending
				return &Status{
					Type:   syncType,
					Status: statusPending,
					Year:   o.currentSyncYear, // Custom values sync uses current sync year
				}
			}
		}
	}

	// Check last completed status
	if status, exists := o.lastCompletedStatus[syncType]; exists {
		// Return a copy to avoid race conditions
		statusCopy := *status
		return &statusCopy
	}

	return nil
}

// SetJobSpacing sets the time to wait between jobs in a sequence
func (o *Orchestrator) SetJobSpacing(duration time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.jobSpacing = duration
}

// RunSyncWithOptions runs syncs with custom options including year override
func (o *Orchestrator) RunSyncWithOptions(ctx context.Context, opts Options) error {
	// Set the current sync year
	o.mu.Lock()
	o.currentSyncYear = opts.Year
	o.mu.Unlock()

	// Reset to 0 when done
	defer func() {
		o.mu.Lock()
		o.currentSyncYear = 0
		o.mu.Unlock()
	}()

	// Check if global tables are empty - if so, run weekly sync first
	// This ensures fresh DB setups have required global definitions before any sync
	// The check is quick (1 DB query) so we do it regardless of year
	if o.checkGlobalTablesEmpty() {
		slog.Info("Global tables empty - running weekly sync first")
		if err := o.RunWeeklySync(ctx); err != nil {
			slog.Error("Weekly sync failed, continuing with sync", "error", err)
		}
	}

	// Determine which services to run
	servicesToRun := opts.Services
	if len(servicesToRun) == 0 {
		// Run all services in dependency order (source → [CV] → transform)
		// Same order as RunDailySync, with optional CV phase inserted before transform
		servicesToRun = GetDefaultUnifiedSyncJobs(opts.IncludeCustomValues)

		// Only include bunk_requests and process_requests for current year syncs (not historical)
		// Bunk requests are populated during the current year's processing
		// and there's no need to re-process them for historical years
		// opts.Year > 0 means this is a historical sync with a specific year
		if opts.Year == 0 {
			servicesToRun = append(servicesToRun, "reconcile_request_lifecycle", "bunk_requests")
			// Only include process_requests in production (Docker) mode
			// In development, skip AI processing to avoid unnecessary API costs
			if os.Getenv("IS_DOCKER") == boolTrueStr {
				servicesToRun = append(servicesToRun, "process_requests")
			}
		}
	}

	// Set up sync tracking based on year mode
	if opts.Year > 0 {
		// Historical sync tracking
		o.mu.Lock()
		o.historicalSyncRunning = true
		o.historicalSyncQueue = servicesToRun
		o.historicalSyncYear = opts.Year
		o.currentRunIndex = 0 // Reset index at start
		o.mu.Unlock()

		defer func() {
			o.mu.Lock()
			o.historicalSyncRunning = false
			o.historicalSyncQueue = nil
			o.historicalSyncYear = 0
			o.currentRunIndex = 0
			o.mu.Unlock()
		}()
	} else {
		// Current year sync - use daily sync tracking so UI shows progress
		o.mu.Lock()
		o.dailySyncRunning = true
		o.dailySyncQueue = servicesToRun
		o.currentRunIndex = 0 // Reset index at start
		o.mu.Unlock()

		defer func() {
			o.mu.Lock()
			o.dailySyncRunning = false
			o.dailySyncQueue = nil
			o.currentRunIndex = 0
			o.mu.Unlock()
		}()
	}

	// If year override is specified, we need to re-register services with a cloned client
	if opts.Year > 0 {
		if o.baseClient == nil {
			slog.Error("Cannot run historical sync - baseClient is nil")
			return fmt.Errorf("baseClient not initialized")
		}

		// Create a client with the specified year
		yearClient := o.baseClient.CloneWithYear(opts.Year)

		// Temporarily re-register services with year-specific client
		// Store original services
		originalServices := make(map[string]Service)
		o.mu.Lock()
		for name, svc := range o.services {
			originalServices[name] = svc
		}
		o.mu.Unlock()

		// Re-register with year client
		// Note: person_tag_defs, custom_field_defs, and divisions are NOT re-registered
		// because they are global (not year-specific) and shouldn't run in historical syncs
		// Note: "persons" is a combined sync that populates persons and households
		o.RegisterService("session_groups", NewSessionGroupsSync(o.app, yearClient))
		o.RegisterService("sessions", NewSessionsSync(o.app, yearClient))
		// Note: divisions is global (no year field) - not re-registered for historical sync
		o.RegisterService("attendees", NewAttendeesSync(o.app, yearClient))
		o.RegisterService("persons", NewPersonsSync(o.app, yearClient)) // Combined: persons + households
		o.RegisterService("bunks", NewBunksSync(o.app, yearClient))
		o.RegisterService("bunk_plans", NewBunkPlansSync(o.app, yearClient))
		o.RegisterService("bunk_assignments", NewBunkAssignmentsSync(o.app, yearClient))
		yearReconcileSync := NewReconcileLifecycleSync(o.app)
		yearReconcileSync.Year = opts.Year
		o.RegisterService("reconcile_request_lifecycle", yearReconcileSync)
		o.RegisterService("bunk_requests", NewBunkRequestsSync(o.app, yearClient))
		yearProcessor := NewRequestProcessor(o.app)
		yearProcessor.CollectTraces = true // Always collect traces for scheduled/automated runs
		o.RegisterService("process_requests", yearProcessor)
		o.RegisterService("staff", NewStaffSync(o.app, yearClient))

		// Camper history computation (no CampMinder client needed - reads from PocketBase)
		camperHistorySync := NewCamperHistorySync(o.app)
		camperHistorySync.Year = opts.Year
		o.RegisterService("camper_history", camperHistorySync)

		o.RegisterService("financial_transactions", NewFinancialTransactionsSync(o.app, yearClient))

		// Family camp derived tables (computed from custom values)
		familyCampDerivedSync := NewFamilyCampDerivedSync(o.app)
		familyCampDerivedSync.Year = opts.Year
		o.RegisterService("family_camp_derived", familyCampDerivedSync)

		// Staff skills (derived from person_custom_values Skills- fields)
		staffSkillsSync := NewStaffSkillsSync(o.app)
		staffSkillsSync.Year = opts.Year
		o.RegisterService("staff_skills", staffSkillsSync)

		// Financial aid applications (derived from person_custom_values FA- fields)
		faApplicationsSync := NewFinancialAidApplicationsSync(o.app)
		faApplicationsSync.Year = opts.Year
		o.RegisterService("financial_aid_applications", faApplicationsSync)

		// Household demographics (computed from HH- fields + household custom values)
		householdDemographicsSync := NewHouseholdDemographicsSync(o.app)
		householdDemographicsSync.Year = opts.Year
		o.RegisterService("household_demographics", householdDemographicsSync)

		// Camper dietary (derived from Family Medical-* fields)
		camperDietarySync := NewCamperDietarySync(o.app)
		camperDietarySync.Year = opts.Year
		o.RegisterService("camper_dietary", camperDietarySync)

		// Camper transportation (derived from BUS-* fields)
		camperTransportationSync := NewCamperTransportationSync(o.app)
		camperTransportationSync.Year = opts.Year
		o.RegisterService("camper_transportation", camperTransportationSync)

		// Quest registrations (derived from Quest-*/Q-* fields)
		questRegistrationsSync := NewQuestRegistrationsSync(o.app)
		questRegistrationsSync.Year = opts.Year
		o.RegisterService("quest_registrations", questRegistrationsSync)

		// Staff applications (derived from App-* fields)
		staffApplicationsSync := NewStaffApplicationsSync(o.app)
		staffApplicationsSync.Year = opts.Year
		o.RegisterService("staff_applications", staffApplicationsSync)

		// Staff vehicle info (derived from SVI-* fields)
		staffVehicleInfoSync := NewStaffVehicleInfoSync(o.app)
		staffVehicleInfoSync.Year = opts.Year
		o.RegisterService("staff_vehicle_info", staffVehicleInfoSync)

		// Geographic normalization (depends on camper_history)
		normalizeGeographicSync := NewNormalizeGeographicSync(o.app)
		normalizeGeographicSync.Year = opts.Year
		o.RegisterService("normalize_geographic", normalizeGeographicSync)

		// Enrollment snapshots (captures daily enrollment counts per session)
		enrollmentSnapshotsSync := NewEnrollmentSnapshotsSync(o.app)
		enrollmentSnapshotsSync.Year = opts.Year
		o.RegisterService("enrollment_snapshots", enrollmentSnapshotsSync)

		// Orphan reconciler: sweeps scenario drafts stranded by bunk-plan changes.
		// Year-scoped so a historical sync reconciles the correct year's drafts.
		orphanReconcilerSync := NewOrphanReconcilerSync(o.app)
		orphanReconcilerSync.Year = opts.Year
		o.RegisterService("orphan_reconciler", orphanReconcilerSync)

		// Custom value services for historical sync support
		// These use GetSeasonID() to determine the year, so they need year-specific client
		personCustomValuesSync := NewPersonCustomFieldValuesSync(o.app, yearClient)
		personCustomValuesSync.SetDebug(opts.Debug)
		personCustomValuesSync.SetSession("all") // Historical syncs all sessions
		o.RegisterService("person_custom_values", personCustomValuesSync)

		householdCustomValuesSync := NewHouseholdCustomFieldValuesSync(o.app, yearClient)
		householdCustomValuesSync.SetDebug(opts.Debug)
		householdCustomValuesSync.SetSession("all") // Historical syncs all sessions
		o.RegisterService("household_custom_values", householdCustomValuesSync)

		// Restore original services after sync completes
		defer func() {
			o.mu.Lock()
			for name, svc := range originalServices {
				o.services[name] = svc
			}
			o.mu.Unlock()
		}()

		slog.Info("Running sync with year override", "year", opts.Year)
	}

	// Run services
	if opts.Concurrent {
		// Run concurrently (for future implementation)
		// For now, fall back to sequential
		slog.Info("Concurrent sync not yet implemented, running sequentially")
	}

	// Apply debug flag to all services if enabled
	if opts.Debug {
		for _, serviceName := range servicesToRun {
			if svc := o.GetService(serviceName); svc != nil {
				if debuggable, ok := svc.(Debuggable); ok {
					debuggable.SetDebug(true)
				}
			}
		}
		// Reset debug flag after sync completes
		defer func() {
			for _, serviceName := range servicesToRun {
				if svc := o.GetService(serviceName); svc != nil {
					if debuggable, ok := svc.(Debuggable); ok {
						debuggable.SetDebug(false)
					}
				}
			}
		}()
	}

	// Run sequentially - custom values syncs run in order to prevent context deadline issues
	// from concurrent API rate limiting during historical syncs
	for i, serviceName := range servicesToRun {
		// Update current run index
		o.mu.Lock()
		o.currentRunIndex = i
		o.mu.Unlock()

		// Check if context is canceled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Add spacing between jobs (except for the first one)
		if i > 0 {
			slog.Info("Waiting before next sync", "duration", o.jobSpacing)
			time.Sleep(o.jobSpacing)
		}

		progress := fmt.Sprintf("%d/%d", i+1, len(servicesToRun))
		if opts.Year > 0 {
			slog.Info("Historical sync: Starting service",
				"year", opts.Year, "service", serviceName, "progress", progress)
		} else {
			slog.Info("Sync with options: Starting service",
				"service", serviceName, "progress", progress)
		}

		// Run sync and wait for completion
		if err := o.runSyncAndWait(ctx, serviceName); err != nil {
			if opts.Year > 0 {
				slog.Error("Historical sync: service failed", "year", opts.Year, "service", serviceName, "error", err)
			} else {
				slog.Error("Sync with options: service failed", "service", serviceName, "error", err)
			}
			// Continue with other syncs even if one fails
		} else {
			if opts.Year > 0 {
				slog.Info("Historical sync: service completed", "year", opts.Year, "service", serviceName)
			} else {
				slog.Info("Sync with options: service completed", "service", serviceName)
			}
		}
	}

	// After historical sync completes, trigger Google Sheets export for that year only (no globals)
	if opts.Year > 0 && google.IsEnabled() {
		o.mu.RLock()
		sheetsService := o.services["multi_workbook_export"]
		o.mu.RUnlock()

		if sheetsService != nil {
			if exporter, ok := sheetsService.(*MultiWorkbookExport); ok {
				// Get collections that had changes to skip unchanged exports
				changedCollections := o.GetChangedCollections()
				slog.Info("Historical sync: Exporting to Google Sheets",
					"year", opts.Year,
					"changed_collections", len(changedCollections))
				if err := exporter.SyncForYears(ctx, []int{opts.Year}, false, changedCollections); err != nil {
					slog.Error("Historical sync: Google Sheets export failed", "year", opts.Year, "error", err)
				} else {
					slog.Info("Historical sync: Google Sheets export completed", "year", opts.Year)
				}
			}
		}
	}

	// After current year sync completes, trigger Google Sheets export (globals + current year)
	if opts.Year == 0 && google.IsEnabled() {
		o.mu.RLock()
		sheetsService := o.services["multi_workbook_export"]
		o.mu.RUnlock()

		if sheetsService != nil {
			if exporter, ok := sheetsService.(*MultiWorkbookExport); ok {
				// Get collections that had changes to skip unchanged exports
				changedCollections := o.GetChangedCollections()
				slog.Info("Sync with options: Exporting to Google Sheets",
					"changed_collections", len(changedCollections))
				// Use SyncForYears with exporter's year to benefit from skip optimization
				// exporter.year is already resolved from CAMPMINDER_SEASON_ID env var
				if err := exporter.SyncForYears(ctx, []int{exporter.year}, true, changedCollections); err != nil {
					slog.Error("Sync with options: Google Sheets export failed", "error", err)
				} else {
					slog.Info("Sync with options: Google Sheets export completed")
				}
			}
		}
	}

	return nil
}

// =============================================================================
// Unified Sync Queue Methods
// =============================================================================

// generateRunToken generates a unique token for tracking a sync run.
// Used by runSingleSyncInternal and MarkSyncRunning.
func generateRunToken() string {
	return fmt.Sprintf("%d-%04x", time.Now().UnixNano(), rand.IntN(0xFFFF)) //nolint:gosec // uniqueness, not crypto
}

// generateQueueID generates a unique ID for a queued sync.
// Uses random suffix for collision resistance (same pattern as generateRunToken, see #853).
func generateQueueID() string {
	return fmt.Sprintf("%d-%04x", time.Now().UnixNano(), rand.IntN(0xFFFF)) //nolint:gosec // uniqueness, not crypto
}

// EnqueueUnifiedSync adds a unified sync request to the queue.
// If a sync with the same year+type+service is already queued, returns the existing item.
func (o *Orchestrator) EnqueueUnifiedSync(
	year int, service string, includeCustomValues, debug bool, requestedBy string,
) (*QueuedSync, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Check for duplicate (same year + type + service + includeCustomValues already queued)
	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].Year == year &&
			o.pendingUnifiedSyncs[i].Type == "unified" &&
			o.pendingUnifiedSyncs[i].Service == service &&
			o.pendingUnifiedSyncs[i].IncludeCustomValues == includeCustomValues {
			// Return existing item instead of creating duplicate
			return &o.pendingUnifiedSyncs[i], nil
		}
	}

	// Create new queued sync
	qs := QueuedSync{
		ID:                  generateQueueID(),
		Year:                year,
		Type:                "unified",
		Service:             service,
		IncludeCustomValues: includeCustomValues,
		Debug:               debug,
		QueuedAt:            time.Now(),
		RequestedBy:         requestedBy,
	}

	// Append to queue (FIFO)
	o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, qs)

	slog.Info("Enqueued unified sync",
		"id", qs.ID, "year", year, "service", service, "position", len(o.pendingUnifiedSyncs))

	return &qs, nil
}

// EnqueuePhaseSync adds a phase sync request to the queue.
// If a sync with the same year+phase is already queued, returns the existing item.
func (o *Orchestrator) EnqueuePhaseSync(year int, phase Phase, debug bool, requestedBy string) (*QueuedSync, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Check for duplicate (same year + type + service already queued)
	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].Year == year &&
			o.pendingUnifiedSyncs[i].Type == "phase" &&
			o.pendingUnifiedSyncs[i].Service == string(phase) {
			// Return existing item instead of creating duplicate
			return &o.pendingUnifiedSyncs[i], nil
		}
	}

	// Create new queued sync
	qs := QueuedSync{
		ID:          generateQueueID(),
		Year:        year,
		Type:        "phase",
		Service:     string(phase),
		Debug:       debug,
		QueuedAt:    time.Now(),
		RequestedBy: requestedBy,
	}

	// Append to queue (FIFO)
	o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, qs)

	slog.Info("Enqueued phase sync",
		"id", qs.ID, "year", year, "phase", phase, "debug", debug, "position", len(o.pendingUnifiedSyncs))

	return &qs, nil
}

// EnqueueIndividualSync adds an individual job sync request to the queue.
// If a sync with the same year+job is already queued, returns the existing item.
func (o *Orchestrator) EnqueueIndividualSync(
	year int, jobID string, options map[string]any, debug bool, requestedBy string,
) (*QueuedSync, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	// Check for duplicate (same year + type + service already queued)
	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].Year == year &&
			o.pendingUnifiedSyncs[i].Type == "individual" &&
			o.pendingUnifiedSyncs[i].Service == jobID {
			// Return existing item instead of creating duplicate
			return &o.pendingUnifiedSyncs[i], nil
		}
	}

	// Create new queued sync
	qs := QueuedSync{
		ID:          generateQueueID(),
		Year:        year,
		Type:        "individual",
		Service:     jobID,
		Options:     options,
		Debug:       debug,
		QueuedAt:    time.Now(),
		RequestedBy: requestedBy,
	}

	// Append to queue (FIFO)
	o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, qs)

	slog.Info("Enqueued individual sync",
		"id", qs.ID, "year", year, "job", jobID, "debug", debug, "position", len(o.pendingUnifiedSyncs))

	return &qs, nil
}

// DequeueUnifiedSync removes and returns the first item from the queue.
// Returns nil if the queue is empty.
func (o *Orchestrator) DequeueUnifiedSync() *QueuedSync {
	o.mu.Lock()
	defer o.mu.Unlock()

	if len(o.pendingUnifiedSyncs) == 0 {
		return nil
	}

	// Get first item (FIFO)
	qs := o.pendingUnifiedSyncs[0]

	// Remove from queue
	o.pendingUnifiedSyncs = o.pendingUnifiedSyncs[1:]

	slog.Info("Dequeued unified sync", "id", qs.ID, "year", qs.Year, "service", qs.Service)

	return &qs
}

// CancelQueuedSync removes a queued sync by ID.
// Returns true if the item was found and removed, false otherwise.
func (o *Orchestrator) CancelQueuedSync(id string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()

	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].ID == id {
			// Remove item
			o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs[:i], o.pendingUnifiedSyncs[i+1:]...)
			slog.Info("Canceled queued sync", "id", id)
			return true
		}
	}

	return false
}

// GetQueuedSyncs returns a copy of the pending unified syncs queue.
func (o *Orchestrator) GetQueuedSyncs() []QueuedSync {
	o.mu.RLock()
	defer o.mu.RUnlock()

	// Return a copy to avoid race conditions
	result := make([]QueuedSync, len(o.pendingUnifiedSyncs))
	copy(result, o.pendingUnifiedSyncs)
	return result
}

// GetQueuePositionByID returns the 1-based position of a queued sync.
// Returns 0 if the ID is not found.
func (o *Orchestrator) GetQueuePositionByID(id string) int {
	o.mu.RLock()
	defer o.mu.RUnlock()

	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].ID == id {
			return i + 1 // 1-based position
		}
	}

	return 0
}

// GetQueueLength returns the number of items in the queue.
func (o *Orchestrator) GetQueueLength() int {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return len(o.pendingUnifiedSyncs)
}

// SetActiveSyncCancel stores the cancel function for the currently running sync.
func (o *Orchestrator) SetActiveSyncCancel(cancel context.CancelFunc) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.activeSyncCancel = cancel
}

// ClearActiveSyncCancel clears the stored cancel function.
func (o *Orchestrator) ClearActiveSyncCancel() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.activeSyncCancel = nil
}

// CancelRunningSync cancels the currently running sync if one exists.
// Returns true if a sync was canceled, false if no sync was running.
func (o *Orchestrator) CancelRunningSync() bool {
	o.mu.Lock()
	defer o.mu.Unlock()

	if o.activeSyncCancel != nil {
		o.activeSyncCancel()
		o.activeSyncCancel = nil
		slog.Info("Canceled running sync")
		return true
	}
	return false
}

// ClearSyncFlags resets all sync running flags.
// Used for panic recovery to ensure stuck syncs don't block future syncs.
func (o *Orchestrator) ClearSyncFlags() {
	o.mu.Lock()
	defer o.mu.Unlock()

	o.dailySyncRunning = false
	o.dailySyncQueue = nil
	o.historicalSyncRunning = false
	o.historicalSyncQueue = nil
	o.historicalSyncYear = 0
	o.weeklySyncRunning = false
	o.weeklySyncQueue = nil
	o.customValuesSyncRunning = false
	o.customValuesSyncQueue = nil
	o.activeSyncCancel = nil

	slog.Warn("Cleared all sync flags (panic recovery)")
}

// IsUnifiedSyncQueued checks if a sync with the given year and service is already queued.
func (o *Orchestrator) IsUnifiedSyncQueued(year int, service string) bool {
	o.mu.RLock()
	defer o.mu.RUnlock()

	for i := range o.pendingUnifiedSyncs {
		if o.pendingUnifiedSyncs[i].Year == year && o.pendingUnifiedSyncs[i].Service == service {
			return true
		}
	}

	return false
}

// InitializeSyncServices creates and registers all sync services
func (o *Orchestrator) InitializeSyncServices() error {
	// Create CampMinder client from environment
	cfg := &campminder.Config{
		APIKey:   os.Getenv("CAMPMINDER_API_KEY"),
		ClientID: os.Getenv("CAMPMINDER_CLIENT_ID"),
		SeasonID: 0, // Will be parsed below
	}

	// Parse season ID
	if seasonStr := os.Getenv("CAMPMINDER_SEASON_ID"); seasonStr != "" {
		if seasonID, err := strconv.Atoi(seasonStr); err == nil {
			cfg.SeasonID = seasonID
		} else {
			slog.Error("Failed to parse CAMPMINDER_SEASON_ID", "value", seasonStr, "error", err)
		}
	}

	// Validate configuration with detailed errors
	if cfg.APIKey == "" || cfg.ClientID == "" || cfg.SeasonID == 0 {
		missingVars := []string{}
		if cfg.APIKey == "" {
			missingVars = append(missingVars, "CAMPMINDER_API_KEY")
		}
		if cfg.ClientID == "" {
			missingVars = append(missingVars, "CAMPMINDER_CLIENT_ID")
		}
		if cfg.SeasonID == 0 {
			missingVars = append(missingVars, "CAMPMINDER_SEASON_ID")
		}
		return fmt.Errorf("missing required CampMinder configuration: %v", missingVars)
	}

	// Create CampMinder client
	client, err := campminder.NewClient(cfg)
	if err != nil {
		return fmt.Errorf("creating CampMinder client: %w", err)
	}

	// Store base client for year overrides
	o.baseClient = client

	// Register sync services in dependency order
	o.RegisterService("session_groups", NewSessionGroupsSync(o.app, client))
	o.RegisterService("sessions", NewSessionsSync(o.app, client))
	o.RegisterService("attendees", NewAttendeesSync(o.app, client))
	o.RegisterService("person_tag_defs", NewPersonTagDefinitionsSync(o.app, client))
	o.RegisterService("custom_field_defs", NewCustomFieldDefinitionsSync(o.app, client))
	// Global lookups: positions, org_categories, program_areas
	o.RegisterService("staff_lookups", NewStaffLookupsSync(o.app, client))
	// Global lookups: financial_categories, payment_methods
	o.RegisterService("financial_lookups", NewFinancialLookupsSync(o.app, client))
	o.RegisterService("divisions", NewDivisionsSync(o.app, client)) // Division definitions
	// "persons" is a combined sync that populates persons and households tables
	// from a single API call (tags are stored as multi-select relation on persons)
	// Division relation on persons is set during persons sync (derived from persons API)
	o.RegisterService("persons", NewPersonsSync(o.app, client))
	o.RegisterService("bunks", NewBunksSync(o.app, client))
	o.RegisterService("bunk_plans", NewBunkPlansSync(o.app, client))
	o.RegisterService("bunk_assignments", NewBunkAssignmentsSync(o.app, client))
	o.RegisterService("reconcile_request_lifecycle", NewReconcileLifecycleSync(o.app))
	o.RegisterService("orphan_reconciler", NewOrphanReconcilerSync(o.app))
	o.RegisterService("bunk_requests", NewBunkRequestsSync(o.app, client))
	// Register the request processor (no CampMinder client needed)
	processor := NewRequestProcessor(o.app)
	processor.CollectTraces = true // Always collect traces for scheduled/automated runs
	o.RegisterService("process_requests", processor)
	// Camper history computation (no CampMinder client needed - reads from PocketBase)
	o.RegisterService("camper_history", NewCamperHistorySync(o.app))
	// Staff sync: year-scoped staff records (depends on staff_lookups running in weekly sync)
	o.RegisterService("staff", NewStaffSync(o.app, client))
	// Financial transactions: year-scoped transaction data (depends on financial_lookups running in weekly sync)
	o.RegisterService("financial_transactions", NewFinancialTransactionsSync(o.app, client))

	// Register Google Sheets multi-workbook export (optional, requires configuration)
	if google.IsEnabled() {
		ctx := context.Background()
		sheetsClient, err := google.NewSheetsClient(ctx)
		if err != nil {
			slog.Warn("Google Sheets disabled due to client error", "error", err)
		} else if sheetsClient != nil {
			sheetsWriter := NewRateLimitedSheetsWriter(NewRealSheetsWriter(sheetsClient), nil)
			// Use DefaultDriveSearcher to enable automatic recovery of existing workbooks
			// when the database is cleared but sheets still exist in Drive
			driveSearcher := &DefaultDriveSearcher{}
			workbookManager := NewWorkbookManagerWithSearcher(o.app, sheetsWriter, driveSearcher)
			exporter, err := NewMultiWorkbookExport(o.app, sheetsWriter, workbookManager, 0)
			if err != nil {
				slog.Warn("Multi-workbook export disabled: year resolution failed", "error", err)
			} else {
				o.RegisterService("multi_workbook_export", exporter)
				slog.Info("Multi-workbook export service registered")
			}
		}
	}

	// Register on-demand sync services (NOT part of daily sync)
	// These require N API calls (one per entity) so are triggered manually
	o.RegisterService("person_custom_values", NewPersonCustomFieldValuesSync(o.app, client))
	o.RegisterService("household_custom_values", NewHouseholdCustomFieldValuesSync(o.app, client))

	// Family camp derived tables (computes from custom values - on-demand)
	o.RegisterService("family_camp_derived", NewFamilyCampDerivedSync(o.app))

	// Staff skills (derived from person_custom_values Skills- fields)
	o.RegisterService("staff_skills", NewStaffSkillsSync(o.app))

	// Financial aid applications (derived from person_custom_values FA- fields)
	o.RegisterService("financial_aid_applications", NewFinancialAidApplicationsSync(o.app))

	// Household demographics (computes from HH- fields + household custom values - on-demand)
	o.RegisterService("household_demographics", NewHouseholdDemographicsSync(o.app))

	// Camper dietary (computes from Family Medical-* fields)
	o.RegisterService("camper_dietary", NewCamperDietarySync(o.app))

	// Camper transportation (computes from BUS-* fields)
	o.RegisterService("camper_transportation", NewCamperTransportationSync(o.app))

	// Quest registrations (computes from Quest-*/Q-* fields)
	o.RegisterService("quest_registrations", NewQuestRegistrationsSync(o.app))

	// Staff applications (computes from App-* fields)
	o.RegisterService("staff_applications", NewStaffApplicationsSync(o.app))

	// Staff vehicle info (computes from SVI-* fields)
	o.RegisterService("staff_vehicle_info", NewStaffVehicleInfoSync(o.app))

	// Geographic normalization (computes from camper_history)
	o.RegisterService("normalize_geographic", NewNormalizeGeographicSync(o.app))

	// Enrollment snapshots (captures daily enrollment counts per session)
	o.RegisterService("enrollment_snapshots", NewEnrollmentSnapshotsSync(o.app))

	slog.Info("All sync services registered")
	return nil
}
