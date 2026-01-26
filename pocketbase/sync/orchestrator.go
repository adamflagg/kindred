// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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
)

// Service defines the interface for sync services
type Service interface {
	Sync(ctx context.Context) error
	Name() string
	GetStats() Stats
}

// Status represents the status of a sync operation
type Status struct {
	Type      string     `json:"type"`
	Status    string     `json:"status"`
	StartTime time.Time  `json:"start_time"`
	EndTime   *time.Time `json:"end_time,omitempty"`
	Error     string     `json:"error,omitempty"`
	Summary   Stats      `json:"summary"`
	Year      int        `json:"year,omitempty"` // Year being synced (0 = current year)
}

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
	// Duration in seconds
	Duration int `json:"duration"`
	// SubStats for combined syncs (e.g., persons includes households)
	SubStats map[string]Stats `json:"sub_stats,omitempty"`
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

// IsCustomValuesSyncRunning returns whether a custom values sync sequence is in progress
func (o *Orchestrator) IsCustomValuesSyncRunning() bool {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.customValuesSyncRunning
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

// GetCustomValuesSyncJobs returns the list of services that run in the custom values sync.
// These are expensive syncs (1 API call per entity) that run weekly after the main weekly sync.
func GetCustomValuesSyncJobs() []string {
	return []string{
		"person_custom_values",
		"household_custom_values",
	}
}

// RunSingleSync runs a single sync service
func (o *Orchestrator) RunSingleSync(_ context.Context, syncType string) error {
	// Check if service exists
	o.mu.RLock()
	service, exists := o.services[syncType]
	existingStatus := o.runningJobs[syncType]
	o.mu.RUnlock()

	if !exists {
		return fmt.Errorf("sync service not found: %s", syncType)
	}

	// Check if status was pre-marked by MarkSyncRunning
	// If so, reuse it; otherwise create a new status
	var status *Status
	if existingStatus != nil {
		// Reuse pre-marked status (set by MarkSyncRunning before goroutine started)
		status = existingStatus
	} else {
		// No pre-marked status - check if something else is running
		if o.IsRunning(syncType) {
			return fmt.Errorf("sync already in progress: %s", syncType)
		}

		// Create status entry
		status = &Status{
			Type:      syncType,
			Status:    statusRunning,
			StartTime: time.Now(),
			Summary:   Stats{},
			Year:      o.currentSyncYear,
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
				status.Status = statusFailed
				status.Error = fmt.Sprintf("panic: %v", r)
				endTime := time.Now()
				status.EndTime = &endTime
			}
		}()

		// Create a background context with generous timeout for sync operations
		// This prevents HTTP handler timeouts from canceling long-running syncs
		syncCtx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		// Execute sync with independent context
		err := service.Sync(syncCtx)

		// Update status
		endTime := time.Now()
		status.EndTime = &endTime

		// Calculate duration in seconds
		duration := int(endTime.Sub(status.StartTime).Seconds())

		// Get stats from the service
		stats := service.GetStats()
		stats.Duration = duration
		status.Summary = stats

		if err != nil {
			status.Status = statusFailed
			status.Error = err.Error()
			// Only log for current year syncs (historical syncs log in RunSyncWithOptions)
			if status.Year == 0 {
				slog.Error("Sync failed", "syncType", syncType, "error", err)
			}
		} else {
			status.Status = "success"
			// Only log for current year syncs (historical syncs log in RunSyncWithOptions)
			if status.Year == 0 {
				slog.Info("Sync completed successfully", "syncType", syncType)
			}
		}

		// Store completed status before removing from runningJobs
		o.mu.Lock()
		o.lastCompletedStatus[syncType] = status
		delete(o.runningJobs, syncType)
		o.mu.Unlock()
	}()

	return nil
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

	// Create status entry
	status := &Status{
		Type:      syncType,
		Status:    statusRunning,
		StartTime: time.Now(),
		Summary:   Stats{},
		Year:      o.currentSyncYear,
	}

	o.mu.Lock()
	o.runningJobs[syncType] = status
	o.mu.Unlock()

	return nil
}

// checkGlobalTablesEmpty checks if essential global tables have been synced.
// Returns true if global tables are empty and weekly sync should run first.
func (o *Orchestrator) checkGlobalTablesEmpty() bool {
	// Quick check on person_tag_defs - if empty, globals haven't run
	records, _ := o.app.FindRecordsByFilter("person_tag_defs", "", "", 1, 0)
	return len(records) == 0
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
		"camper_history",         // Computed table: depends on attendees
		"financial_transactions", // Financial data: depends on sessions, persons, households, divisions
		"family_camp_derived",    // Computed table: depends on custom values (uses existing data in daily)
		"bunk_requests",          // CSV import, depends on persons
	}

	// Only include process_requests in production (Docker) mode
	// In development, skip AI processing to avoid unnecessary API costs
	// Process requests can be triggered manually when needed
	if os.Getenv("IS_DOCKER") == boolTrueStr {
		orderedJobs = append(orderedJobs, "process_requests")
	} else {
		slog.Info("Skipping process_requests in development mode (set IS_DOCKER=true to enable)")
	}

	// Add Google Sheets export if enabled (runs after all data syncs complete)
	if google.IsEnabled() && google.GetSpreadsheetID() != "" {
		orderedJobs = append(orderedJobs, "google_sheets_export")
	}

	// Set daily sync flag and queue
	o.mu.Lock()
	o.dailySyncRunning = true
	o.dailySyncQueue = orderedJobs
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.dailySyncRunning = false
		o.dailySyncQueue = nil
		o.mu.Unlock()
	}()

	slog.Info("Starting daily sync sequence")

	for i, jobName := range orderedJobs {
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
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.weeklySyncRunning = false
		o.weeklySyncQueue = nil
		o.mu.Unlock()
	}()

	slog.Info("Starting weekly sync sequence", "services", weeklyJobs)

	for i, jobName := range weeklyJobs {
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
	o.mu.Lock()
	o.customValuesSyncRunning = true
	o.customValuesSyncQueue = customValuesJobs
	o.mu.Unlock()

	// Ensure flag and queue are cleared on exit
	defer func() {
		o.mu.Lock()
		o.customValuesSyncRunning = false
		o.customValuesSyncQueue = nil
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

// contains checks if a string is present in a slice
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// runCustomValuesSyncsInParallel runs both custom values syncs in parallel
// and returns any errors that occurred
func (o *Orchestrator) runCustomValuesSyncsInParallel(ctx context.Context, opts Options) error {
	customValuesJobs := GetCustomValuesSyncJobs()

	slog.Info("Running custom values syncs in parallel", "year", opts.Year, "services", customValuesJobs)

	var wg sync.WaitGroup
	errChan := make(chan error, len(customValuesJobs))

	for _, jobName := range customValuesJobs {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()

			select {
			case <-ctx.Done():
				errChan <- ctx.Err()
				return
			default:
			}

			if opts.Year > 0 {
				slog.Info("Historical sync: Starting custom values service (parallel)",
					"year", opts.Year, "service", name)
			} else {
				slog.Info("Sync with options: Starting custom values service (parallel)",
					"service", name)
			}

			if err := o.runSyncAndWait(ctx, name); err != nil {
				if opts.Year > 0 {
					slog.Error("Historical sync: custom values service failed",
						"year", opts.Year, "service", name, "error", err)
				} else {
					slog.Error("Sync with options: custom values service failed",
						"service", name, "error", err)
				}
				errChan <- err
			} else {
				if opts.Year > 0 {
					slog.Info("Historical sync: custom values service completed",
						"year", opts.Year, "service", name)
				} else {
					slog.Info("Sync with options: custom values service completed",
						"service", name)
				}
			}
		}(jobName)
	}

	wg.Wait()
	close(errChan)

	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	return errors.Join(errs...)
}

// runSyncAndWait runs a sync and waits for it to complete
func (o *Orchestrator) runSyncAndWait(ctx context.Context, syncType string) error {
	// Start the sync
	if err := o.RunSingleSync(ctx, syncType); err != nil {
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
				// Check final status
				o.mu.RLock()
				status := o.runningJobs[syncType]
				o.mu.RUnlock()

				if status != nil && status.Status == statusFailed {
					return fmt.Errorf("%s", status.Error)
				}
				return nil
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
					Status: "pending",
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
					Status: "pending",
					Year:   o.historicalSyncYear,
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

	// Determine which services to run
	servicesToRun := opts.Services
	if len(servicesToRun) == 0 {
		// Run all services in dependency order
		// Note: person_tag_defs, custom_field_defs, and divisions are NOT included here -
		// they run in the weekly sync since they're global definitions that rarely change.
		// They can still be run explicitly via opts.Services if needed.
		// Note: "persons" is a combined sync that populates persons and households
		servicesToRun = []string{
			"session_groups",
			"sessions",
			// Note: divisions is global (no year field) - runs in weekly sync
			"attendees",
			"persons", // Combined sync: persons + households
			"bunks",
			"bunk_plans",
			"bunk_assignments",
			"staff",                  // Staff sync: depends on divisions, bunks, persons
			"camper_history",         // Computed table: depends on attendees
			"financial_transactions", // Financial data: depends on sessions, persons, households
		}

		// Only include bunk_requests for current year syncs (not historical)
		// Bunk requests are populated during the current year's processing
		// and there's no need to re-process them for historical years
		// opts.Year > 0 means this is a historical sync with a specific year
		if opts.Year == 0 {
			servicesToRun = append(servicesToRun, "family_camp_derived") // Computed from custom values
			servicesToRun = append(servicesToRun, "bunk_requests")
			// Only include process_requests in production (Docker) mode
			// In development, skip AI processing to avoid unnecessary API costs
			if os.Getenv("IS_DOCKER") == boolTrueStr {
				servicesToRun = append(servicesToRun, "process_requests")
			}
		}

		// Include custom field values if requested (for historical syncs)
		// These run after persons/households since they depend on those records existing
		if opts.IncludeCustomValues {
			servicesToRun = append(servicesToRun, "person_custom_values", "household_custom_values")
			servicesToRun = append(servicesToRun, "family_camp_derived") // Derived from custom values
		}
	}

	// If this is a historical sync, set up tracking
	if opts.Year > 0 {
		o.mu.Lock()
		o.historicalSyncRunning = true
		o.historicalSyncQueue = servicesToRun
		o.historicalSyncYear = opts.Year
		o.mu.Unlock()

		// Clear historical sync tracking when done
		defer func() {
			o.mu.Lock()
			o.historicalSyncRunning = false
			o.historicalSyncQueue = nil
			o.historicalSyncYear = 0
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
		o.RegisterService("bunk_requests", NewBunkRequestsSync(o.app, yearClient))
		o.RegisterService("process_requests", NewRequestProcessor(o.app))
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

	// Run sequentially, with parallel execution for custom values syncs
	// Track whether we've already run custom values in parallel
	customValuesRanParallel := false

	for i, serviceName := range servicesToRun {
		// Check if context is canceled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Check if this is a custom values sync that should run in parallel
		if serviceName == serviceNamePersonCustomValues && contains(servicesToRun, serviceNameHouseholdCustomValues) {
			// Add spacing before running parallel syncs (if not first job)
			if i > 0 {
				slog.Info("Waiting before next sync", "duration", o.jobSpacing)
				time.Sleep(o.jobSpacing)
			}

			// Run both custom values syncs in parallel
			if err := o.runCustomValuesSyncsInParallel(ctx, opts); err != nil {
				slog.Error("Custom values parallel sync had errors", "error", err)
			}
			customValuesRanParallel = true
			continue
		}

		// Skip household_custom_values if we already ran it in parallel
		if serviceName == serviceNameHouseholdCustomValues && customValuesRanParallel {
			continue
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
	if opts.Year > 0 && google.IsEnabled() && google.GetSpreadsheetID() != "" {
		o.mu.RLock()
		sheetsService := o.services["google_sheets_export"]
		o.mu.RUnlock()

		if sheetsService != nil {
			if exporter, ok := sheetsService.(*GoogleSheetsExport); ok {
				slog.Info("Historical sync: Exporting to Google Sheets", "year", opts.Year)
				if err := exporter.SyncForYears(ctx, []int{opts.Year}, false); err != nil {
					slog.Error("Historical sync: Google Sheets export failed", "year", opts.Year, "error", err)
				} else {
					slog.Info("Historical sync: Google Sheets export completed", "year", opts.Year)
				}
			}
		}
	}

	return nil
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
	o.RegisterService("bunk_requests", NewBunkRequestsSync(o.app, client))
	// Register the request processor (no CampMinder client needed)
	o.RegisterService("process_requests", NewRequestProcessor(o.app))
	// Camper history computation (no CampMinder client needed - reads from PocketBase)
	o.RegisterService("camper_history", NewCamperHistorySync(o.app))
	// Staff sync: year-scoped staff records (depends on staff_lookups running in weekly sync)
	o.RegisterService("staff", NewStaffSync(o.app, client))
	// Financial transactions: year-scoped transaction data (depends on financial_lookups running in weekly sync)
	o.RegisterService("financial_transactions", NewFinancialTransactionsSync(o.app, client))

	// Register Google Sheets export service (optional, requires configuration)
	if google.IsEnabled() {
		ctx := context.Background()
		sheetsClient, err := google.NewSheetsClient(ctx)
		if err != nil {
			slog.Warn("Google Sheets disabled due to client error", "error", err)
		} else if sheetsClient != nil {
			spreadsheetID := google.GetSpreadsheetID()
			if spreadsheetID != "" {
				o.RegisterService("google_sheets_export", NewGoogleSheetsExport(o.app, sheetsClient, spreadsheetID))
				slog.Info("Google Sheets export service registered", "spreadsheet_id", spreadsheetID)
			} else {
				slog.Warn("Google Sheets enabled but no spreadsheet ID configured")
			}
		}
	}

	// Register on-demand sync services (NOT part of daily sync)
	// These require N API calls (one per entity) so are triggered manually
	o.RegisterService("person_custom_values", NewPersonCustomFieldValuesSync(o.app, client))
	o.RegisterService("household_custom_values", NewHouseholdCustomFieldValuesSync(o.app, client))

	// Family camp derived tables (computes from custom values - on-demand)
	o.RegisterService("family_camp_derived", NewFamilyCampDerivedSync(o.app))

	slog.Info("All sync services registered")
	return nil
}
