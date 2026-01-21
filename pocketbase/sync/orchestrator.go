// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
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
	// boolTrueStr is used for string comparisons with boolean environment variables
	boolTrueStr = "true"
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
	Created          int `json:"created"`
	Updated          int `json:"updated"`
	Deleted          int `json:"deleted,omitempty"` // For tracking deletions (e.g., removed bunk requests)
	Skipped          int `json:"skipped"`
	Errors           int `json:"errors"`
	Expanded         int `json:"expanded,omitempty"`          // For tracking many-to-many expansions (e.g., bunk plans)
	AlreadyProcessed int `json:"already_processed,omitempty"` // For process_requests: records already processed
	Duration         int `json:"duration"`                    // Duration in seconds
}

// Options configures how syncs are executed
type Options struct {
	Year       int      // Override year (0 = use default from env)
	Services   []string // Specific services to run (empty = all)
	Concurrent bool     // Run services in parallel
}

// Orchestrator manages sync service execution
type Orchestrator struct {
	app                   core.App
	services              map[string]Service
	mu                    sync.RWMutex
	runningJobs           map[string]*Status
	lastCompletedStatus   map[string]*Status // Store last completed status for each job
	jobSpacing            time.Duration
	baseClient            *campminder.Client // Base client for year overrides
	currentSyncYear       int                // Year being synced (0 = current year from env)
	dailySyncRunning      bool               // Track if daily sync sequence is in progress
	dailySyncQueue        []string           // Services queued for daily sync
	historicalSyncRunning bool               // Track if historical sync sequence is in progress
	historicalSyncQueue   []string           // Services queued for historical sync
	historicalSyncYear    int                // Year being synced in historical sync
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

// IsRunning checks if a sync type is currently running
func (o *Orchestrator) IsRunning(syncType string) bool {
	o.mu.RLock()
	defer o.mu.RUnlock()

	status, exists := o.runningJobs[syncType]
	return exists && status.Status == "running"
}

// GetRunningJobs returns all currently running jobs
func (o *Orchestrator) GetRunningJobs() []string {
	o.mu.RLock()
	defer o.mu.RUnlock()

	var running []string
	for name, status := range o.runningJobs {
		if status.Status == "running" {
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

// RunSingleSync runs a single sync service
func (o *Orchestrator) RunSingleSync(_ context.Context, syncType string) error {
	// Check if service exists
	o.mu.RLock()
	service, exists := o.services[syncType]
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
		Status:    "running",
		StartTime: time.Now(),
		Summary:   Stats{},
		Year:      o.currentSyncYear,
	}

	o.mu.Lock()
	o.runningJobs[syncType] = status
	o.mu.Unlock()

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

// RunDailySync runs all base data syncs in the correct order
func (o *Orchestrator) RunDailySync(ctx context.Context) error {
	// Define sync order (respecting dependencies)
	orderedJobs := []string{
		"session_groups",          // No dependencies - sync first for group data
		"sessions",                // Depends on session_groups (for session_group relation)
		"attendees",               // Depends on sessions
		"person_tag_definitions",  // No dependencies - sync before persons
		"persons",                 // Depends on attendees (attendee-driven sync)
		"households",              // Extracts from persons response (no extra API calls)
		"bunks",                   // No dependencies
		"bunk_plans",              // Depends on sessions and bunks
		"bunk_assignments",        // Depends on sessions, persons, bunks
		"bunk_requests",           // CSV import, depends on persons
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
		// Check if context is cancelled
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
		servicesToRun = []string{
			"session_groups",
			"sessions",
			"attendees",
			"person_tag_definitions",
			"persons",
			"households",
			"bunks",
			"bunk_plans",
			"bunk_assignments",
		}

		// Only include bunk_requests for current year syncs (not historical)
		// Bunk requests are populated during the current year's processing
		// and there's no need to re-process them for historical years
		// opts.Year > 0 means this is a historical sync with a specific year
		if opts.Year == 0 {
			servicesToRun = append(servicesToRun, "bunk_requests")
			// Only include process_requests in production (Docker) mode
			// In development, skip AI processing to avoid unnecessary API costs
			if os.Getenv("IS_DOCKER") == boolTrueStr {
				servicesToRun = append(servicesToRun, "process_requests")
			}
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
		o.RegisterService("session_groups", NewSessionGroupsSync(o.app, yearClient))
		o.RegisterService("sessions", NewSessionsSync(o.app, yearClient))
		o.RegisterService("attendees", NewAttendeesSync(o.app, yearClient))
		o.RegisterService("person_tag_definitions", NewPersonTagDefinitionsSync(o.app, yearClient))
		o.RegisterService("persons", NewPersonsSync(o.app, yearClient))
		o.RegisterService("households", NewHouseholdsSync(o.app, yearClient))
		o.RegisterService("bunks", NewBunksSync(o.app, yearClient))
		o.RegisterService("bunk_plans", NewBunkPlansSync(o.app, yearClient))
		o.RegisterService("bunk_assignments", NewBunkAssignmentsSync(o.app, yearClient))
		o.RegisterService("bunk_requests", NewBunkRequestsSync(o.app, yearClient))
		o.RegisterService("process_requests", NewRequestProcessor(o.app))

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

	// Run sequentially
	for i, serviceName := range servicesToRun {
		// Check if context is cancelled
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
	o.RegisterService("person_tag_definitions", NewPersonTagDefinitionsSync(o.app, client))
	o.RegisterService("persons", NewPersonsSync(o.app, client))
	o.RegisterService("households", NewHouseholdsSync(o.app, client))
	o.RegisterService("bunks", NewBunksSync(o.app, client))
	o.RegisterService("bunk_plans", NewBunkPlansSync(o.app, client))
	o.RegisterService("bunk_assignments", NewBunkAssignmentsSync(o.app, client))
	o.RegisterService("bunk_requests", NewBunkRequestsSync(o.app, client))
	// Register the request processor (no CampMinder client needed)
	o.RegisterService("process_requests", NewRequestProcessor(o.app))

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

	slog.Info("All sync services registered")
	return nil
}
