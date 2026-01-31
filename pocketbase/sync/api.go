// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/camp/kindred/pocketbase/google"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// DefaultSession is the default value for session parameter meaning "all sessions"
const DefaultSession = "all"

// DefaultService is the default value for service parameter meaning "all services"
const DefaultService = "all"

// requireAuth wraps a handler function to require authentication
func requireAuth(handler func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return apis.NewUnauthorizedError("Authentication required", nil)
		}
		return handler(e)
	}
}

// InitializeSyncService sets up the sync API endpoints
func InitializeSyncService(app *pocketbase.PocketBase, e *core.ServeEvent) error {
	// Get the scheduler instance
	scheduler := GetScheduler(app)

	// Register API endpoints using PocketBase's router
	// For PocketBase v0.28.4, we use the e.Router directly

	// Refresh bunking endpoint
	e.Router.POST("/api/custom/sync/refresh-bunking", requireAuth(func(e *core.RequestEvent) error {
		return handleRefreshBunking(e, scheduler)
	}))

	// Bunk requests CSV upload endpoint
	e.Router.POST("/api/custom/sync/bunk_requests_upload", requireAuth(func(e *core.RequestEvent) error {
		return handleBunkRequestsUpload(e, scheduler)
	}))

	// Status endpoint
	e.Router.GET("/api/custom/sync/status", requireAuth(func(e *core.RequestEvent) error {
		return handleSyncStatus(e, scheduler)
	}))

	// Unified sync endpoint (replaces daily + historical endpoints)
	// Accepts query params: year, service, includeCustomValues, debug
	// Returns 202 Accepted if enqueued, 200 OK if started immediately
	e.Router.POST("/api/custom/sync/run", requireAuth(func(e *core.RequestEvent) error {
		return handleUnifiedSync(e, scheduler)
	}))

	// Cancel queued sync endpoint
	e.Router.DELETE("/api/custom/sync/queue/{id}", requireAuth(func(e *core.RequestEvent) error {
		return handleCancelQueuedSync(e, scheduler)
	}))

	// Cancel running sync endpoint
	e.Router.DELETE("/api/custom/sync/running", requireAuth(func(e *core.RequestEvent) error {
		return handleCancelRunningSync(e, scheduler)
	}))

	// Hourly sync endpoint
	e.Router.POST("/api/custom/sync/hourly", requireAuth(func(e *core.RequestEvent) error {
		return handleHourlySync(e, scheduler)
	}))

	// Weekly sync endpoint (global data - expensive N API call syncs)
	e.Router.POST("/api/custom/sync/weekly", requireAuth(func(e *core.RequestEvent) error {
		return handleWeeklySync(e, scheduler)
	}))

	// Custom values sync endpoint (runs person + household custom field values sync)
	// This is separate from weekly sync because it's even more expensive (1 API call per entity)
	e.Router.POST("/api/custom/sync/custom-values", requireAuth(func(e *core.RequestEvent) error {
		return handleCustomValuesSync(e, scheduler)
	}))

	// Phase API endpoints
	// GET /api/custom/sync/phases - List available sync phases
	e.Router.GET("/api/custom/sync/phases", requireAuth(handleGetPhases))

	// POST /api/custom/sync/run-phase - Run a specific phase
	// Accepts query params: year (required), phase (required)
	e.Router.POST("/api/custom/sync/run-phase", requireAuth(func(e *core.RequestEvent) error {
		return handleRunPhase(e, scheduler)
	}))

	// Process requests endpoint
	// Processes original_bunk_requests → bunk_requests via Python
	// Accepts optional query parameters:
	// - ?session=X (session identifier - dynamically validated against camp_sessions table)
	//              Accepts: "all", main sessions (1-4), embedded (2a, 2b, 3a, etc.), or "toc"
	// - ?limit=N (optional limit for testing)
	// - ?force=true (clear processed flags and reprocess)
	// - ?source_field=X,Y (comma-separated list of fields to process)
	// - ?debug=true (enable verbose debug logging in Python processor)
	// - ?trace=true (enable very verbose trace logging in Python processor)
	e.Router.POST("/api/custom/sync/process-requests", requireAuth(func(e *core.RequestEvent) error {
		// Parse optional session parameter (now accepts string: all, 1, 2, 2a, etc.)
		session := e.Request.URL.Query().Get("session")
		if session == "" {
			session = DefaultSession
		}

		// Parse optional source_field parameter (comma-separated)
		sourceFieldParam := e.Request.URL.Query().Get("source_field")
		var sourceFields []string
		if sourceFieldParam != "" {
			validFields := map[string]bool{
				"bunk_with": true, "not_bunk_with": true,
				"bunking_notes": true, "internal_notes": true, "socialize_with": true,
			}
			for _, f := range strings.Split(sourceFieldParam, ",") {
				f = strings.TrimSpace(f)
				if f == "" {
					continue
				}
				if !validFields[f] {
					return e.JSON(http.StatusBadRequest, map[string]interface{}{
						"error": fmt.Sprintf(
							"Invalid source_field: %s. Valid options: "+
								"bunk_with, not_bunk_with, bunking_notes, internal_notes, socialize_with", f),
					})
				}
				sourceFields = append(sourceFields, f)
			}
		}

		// Parse optional limit parameter
		limitParam := e.Request.URL.Query().Get("limit")
		limit := 0 // Default: no limit
		if limitParam != "" {
			if l, err := strconv.Atoi(limitParam); err == nil && l > 0 {
				limit = l
			} else {
				return e.JSON(http.StatusBadRequest, map[string]interface{}{
					"error": "Invalid limit parameter. Must be a positive integer.",
				})
			}
		}

		// Parse optional force parameter
		forceParam := e.Request.URL.Query().Get("force")
		force := forceParam == boolTrueStr || forceParam == "1"

		// Parse optional debug parameter
		debugParam := e.Request.URL.Query().Get("debug")
		debug := debugParam == boolTrueStr || debugParam == "1"

		// Parse optional trace parameter
		traceParam := e.Request.URL.Query().Get("trace")
		trace := traceParam == boolTrueStr || traceParam == "1"

		// Create processor with all options
		processor := NewRequestProcessor(app)
		processor.Session = session
		processor.Limit = limit
		processor.Force = force
		processor.SourceFields = sourceFields
		processor.Debug = debug
		processor.Trace = trace

		// Run in background
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()

			slog.Info("Starting process_requests sync",
				"session", session,
				"source_fields", sourceFields,
				"limit", limit,
				"force", force,
				"debug", debug,
				"trace", trace,
			)
			if err := processor.Sync(ctx); err != nil {
				slog.Error("Process requests sync failed", "error", err)
			} else {
				stats := processor.GetStats()
				slog.Info("Process requests completed", "created", stats.Created, "skipped", stats.Skipped, "errors", stats.Errors)
			}
		}()

		return e.JSON(http.StatusOK, map[string]any{
			"status":        "started",
			"message":       "Process requests sync started",
			"session":       session,
			"source_fields": sourceFields,
			"limit":         limit,
			"force":         force,
			"debug":         debug,
			"trace":         trace,
		})
	}))

	// Get available years from database
	e.Router.GET("/api/custom/sync/years", requireAuth(func(e *core.RequestEvent) error {
		return handleGetAvailableYears(e, app)
	}))

	// Test connection endpoint
	e.Router.GET("/api/custom/sync/test-connection", requireAuth(func(e *core.RequestEvent) error {
		return handleTestConnection(e, scheduler)
	}))

	// Individual sync endpoints
	// Sessions sync
	e.Router.POST("/api/custom/sync/sessions", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "sessions")
	}))

	// Attendees sync
	e.Router.POST("/api/custom/sync/attendees", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "attendees")
	}))

	// Persons sync
	e.Router.POST("/api/custom/sync/persons", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "persons")
	}))

	// Bunks sync
	e.Router.POST("/api/custom/sync/bunks", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "bunks")
	}))

	// Bunk plans sync
	e.Router.POST("/api/custom/sync/bunk-plans", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "bunk_plans")
	}))

	// Bunk assignments sync
	e.Router.POST("/api/custom/sync/bunk-assignments", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "bunk_assignments")
	}))

	// Bunk requests sync
	e.Router.POST("/api/custom/sync/bunk-requests", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "bunk_requests")
	}))

	// Session groups sync
	e.Router.POST("/api/custom/sync/session-groups", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "session_groups")
	}))

	// Multi-workbook export endpoint (per-year workbooks)
	e.Router.POST("/api/custom/sync/multi-workbook-export", func(e *core.RequestEvent) error {
		// Check authentication
		if e.Auth == nil {
			return apis.NewUnauthorizedError("Authentication required", nil)
		}

		return handleMultiWorkbookExport(e, scheduler)
	})

	// Person tag definitions sync
	e.Router.POST("/api/custom/sync/person-tag-defs", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "person_tag_defs")
	}))

	// Note: households and person_tags are now part of the combined "persons" sync
	// and no longer have separate endpoints

	// Custom field definitions sync
	e.Router.POST("/api/custom/sync/custom-field-defs", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "custom_field_defs")
	}))

	// Divisions sync (division definitions - runs in daily sync before persons)
	e.Router.POST("/api/custom/sync/divisions", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "divisions")
	}))

	// Staff lookups sync (global: positions, org_categories, program_areas - runs in weekly sync)
	e.Router.POST("/api/custom/sync/staff-lookups", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "staff_lookups")
	}))

	// Staff sync (year-scoped staff records - runs in daily sync)
	e.Router.POST("/api/custom/sync/staff", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "staff")
	}))

	// Financial lookups sync (global: financial_categories, payment_methods - runs in weekly sync)
	e.Router.POST("/api/custom/sync/financial-lookups", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "financial_lookups")
	}))

	// Financial transactions sync (year-scoped - runs in daily sync)
	// Accepts optional ?year=YYYY parameter for historical data sync
	e.Router.POST("/api/custom/sync/financial-transactions", requireAuth(func(e *core.RequestEvent) error {
		return handleFinancialTransactionsSync(e, scheduler)
	}))

	// Camper history computation endpoint
	// Computes denormalized camper history with retention metrics
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/camper-history", requireAuth(func(e *core.RequestEvent) error {
		return handleCamperHistorySync(e, scheduler)
	}))

	// On-demand sync endpoints (require N API calls - one per entity)
	// Person custom values sync
	// Accepts optional ?session=X parameter (0 or empty = all, 1-4 = specific session)
	e.Router.POST("/api/custom/sync/person-custom-values", requireAuth(func(e *core.RequestEvent) error {
		return handlePersonCustomFieldValuesSync(e, scheduler)
	}))

	// Household custom values sync
	// Accepts optional ?session=X parameter (0 or empty = all, 1-4 = specific session)
	e.Router.POST("/api/custom/sync/household-custom-values", requireAuth(func(e *core.RequestEvent) error {
		return handleHouseholdCustomFieldValuesSync(e, scheduler)
	}))

	// Family camp derived tables sync
	// Computes derived tables from person/household custom values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/family-camp-derived", requireAuth(func(e *core.RequestEvent) error {
		return handleFamilyCampDerivedSync(e, scheduler)
	}))

	// Staff skills sync
	// Extracts Skills- fields from person_custom_values into normalized table
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/staff-skills", requireAuth(func(e *core.RequestEvent) error {
		return handleStaffSkillsSync(e, scheduler)
	}))

	// Financial aid applications sync
	// Extracts FA- fields from person_custom_values into structured application records
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/financial-aid-applications", requireAuth(func(e *core.RequestEvent) error {
		return handleFinancialAidApplicationsSync(e, scheduler)
	}))

	// Household demographics sync
	// Computes demographics from HH- custom values + household custom values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/household-demographics", requireAuth(func(e *core.RequestEvent) error {
		return handleHouseholdDemographicsSync(e, scheduler)
	}))

	// Camper dietary sync
	// Extracts Family Medical-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/camper-dietary", requireAuth(func(e *core.RequestEvent) error {
		return handleCamperDietarySync(e, scheduler)
	}))

	// Camper transportation sync
	// Extracts BUS-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/camper-transportation", requireAuth(func(e *core.RequestEvent) error {
		return handleCamperTransportationSync(e, scheduler)
	}))

	// Quest registrations sync
	// Extracts Quest-*/Q-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/quest-registrations", requireAuth(func(e *core.RequestEvent) error {
		return handleQuestRegistrationsSync(e, scheduler)
	}))

	// Staff applications sync
	// Extracts App-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/staff-applications", requireAuth(func(e *core.RequestEvent) error {
		return handleStaffApplicationsSync(e, scheduler)
	}))

	// Staff vehicle info sync
	// Extracts SVI-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/staff-vehicle-info", requireAuth(func(e *core.RequestEvent) error {
		return handleStaffVehicleInfoSync(e, scheduler)
	}))

	return nil
}

// handleIndividualSync handles running a single sync job
// Returns 202 Accepted if enqueued, 200 OK if started immediately
func handleIndividualSync(e *core.RequestEvent, scheduler *Scheduler, syncType string) error {
	orchestrator := scheduler.GetOrchestrator()

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Get current year from environment
	currentYear := time.Now().Year()
	if yearStr := os.Getenv("CAMPMINDER_SEASON_ID"); yearStr != "" {
		if cy, err := strconv.Atoi(yearStr); err == nil {
			currentYear = cy
		}
	}

	// Get user info for queue tracking
	requestedBy := ""
	if e.Auth != nil {
		requestedBy = e.Auth.GetString("email")
	}

	// Check if any sync sequence is running - if so, queue instead of running immediately
	if orchestrator.IsDailySyncRunning() || orchestrator.IsWeeklySyncRunning() ||
		orchestrator.IsHistoricalSyncRunning() || orchestrator.IsCustomValuesSyncRunning() {
		// Queue the individual sync
		qs, err := orchestrator.EnqueueIndividualSync(currentYear, syncType, nil, requestedBy)
		if err != nil {
			return e.JSON(http.StatusConflict, map[string]interface{}{
				"error": err.Error(),
			})
		}

		// Successfully queued - return 202 Accepted
		position := orchestrator.GetQueuePositionByID(qs.ID)
		return e.JSON(http.StatusAccepted, map[string]interface{}{
			"status":   "queued",
			"queue_id": qs.ID,
			"position": position,
			"syncType": syncType,
		})
	}

	// Run in background
	go func() {
		// Create context inside goroutine so it doesn't get canceled immediately
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			// Log error (could also store in DB)
			e.App.Logger().Error("Individual sync failed", "syncType", syncType, "error", err)
		}

		// Process queue after individual sync completes
		processQueuedSyncs(orchestrator)
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  fmt.Sprintf("%s sync started", syncType),
		"status":   "started",
		"syncType": syncType,
	})
}

// handleRefreshBunking triggers a bunk assignments sync
func handleRefreshBunking(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Check if already running
	if orchestrator.IsRunning("bunk_assignments") {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":  "Sync already in progress",
			"status": "running",
		})
	}

	// Start sync with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	err := orchestrator.RunSingleSync(ctx, "bunk_assignments")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
	}

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message": "Bunk assignments sync started",
		"status":  "started",
	})
}

// csvUploadResult holds the result of reading a CSV from multipart form
type csvUploadResult struct {
	data     []byte
	filename string
}

// readCSVFromMultipart extracts CSV data from a multipart form
func readCSVFromMultipart(form *multipart.Reader) (*csvUploadResult, error) {
	var result csvUploadResult

	for {
		part, err := form.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("error reading form data")
		}

		if part.FormName() == "file" {
			result.filename = part.FileName()
			result.data, err = io.ReadAll(part)
			if err != nil {
				_ = part.Close()
				return nil, fmt.Errorf("error reading CSV file")
			}
		}
		if err := part.Close(); err != nil {
			slog.Warn("Error closing multipart part", "error", err)
		}
	}

	if len(result.data) == 0 {
		return nil, fmt.Errorf("no CSV file provided")
	}

	// Strip UTF-8 BOM if present
	if len(result.data) >= 3 && result.data[0] == 0xEF && result.data[1] == 0xBB && result.data[2] == 0xBF {
		result.data = result.data[3:]
		slog.Info("Stripped UTF-8 BOM from CSV file")
	}

	return &result, nil
}

// parseAndValidateCSV parses CSV headers and validates required columns
func parseAndValidateCSV(csvData []byte) ([]string, error) {
	reader := csv.NewReader(bytes.NewReader(csvData))
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = -1

	headers, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("invalid CSV format: %w", err)
	}

	// Trim whitespace from headers
	for i := range headers {
		headers[i] = strings.TrimSpace(headers[i])
	}

	return headers, nil
}

// findMissingColumns checks for required columns (case-insensitive)
func findMissingColumns(headers, required []string) []string {
	var missing []string
	for _, req := range required {
		found := false
		for _, header := range headers {
			if strings.EqualFold(header, req) {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, req)
		}
	}
	return missing
}

// determineUploadYear determines the year for CSV storage from env and query param
func determineUploadYear(yearParam string) int {
	uploadYear := time.Now().Year()
	if yearStr := os.Getenv("CAMPMINDER_SEASON_ID"); yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			uploadYear = y
		}
	}
	if yearParam != "" {
		if y, err := strconv.Atoi(yearParam); err == nil && y >= 2017 && y <= 2050 {
			uploadYear = y
		}
	}
	return uploadYear
}

// saveCSVWithBackup saves CSV data with automatic backup of existing file
func saveCSVWithBackup(csvDir string, uploadYear int, csvData []byte) (string, error) {
	if err := os.MkdirAll(csvDir, 0750); err != nil { //nolint:gosec // G301: data dir permissions
		return "", fmt.Errorf("failed to create directory")
	}

	latestFilename := fmt.Sprintf("%d_latest.csv", uploadYear)
	latestPath := filepath.Join(csvDir, latestFilename)

	// Create backup of existing file if it exists
	if _, err := os.Stat(latestPath); err == nil {
		backupName := fmt.Sprintf("%d_backup_%s.csv", uploadYear, time.Now().Format("20060102_150405"))
		backupPath := filepath.Join(csvDir, backupName)
		if err := os.Rename(latestPath, backupPath); err != nil {
			slog.Warn("Failed to create backup", "error", err)
		}
	}

	if err := os.WriteFile(latestPath, csvData, 0600); err != nil {
		return "", fmt.Errorf("failed to save CSV file")
	}

	return latestPath, nil
}

// handleBunkRequestsUpload handles CSV file upload for bunk requests
func handleBunkRequestsUpload(e *core.RequestEvent, scheduler *Scheduler) error {
	form, err := e.Request.MultipartReader()
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{"error": "Invalid multipart form"})
	}

	// Read and validate CSV from form
	uploadResult, err := readCSVFromMultipart(form)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{"error": err.Error()})
	}

	// Parse and validate CSV headers
	headers, err := parseAndValidateCSV(uploadResult.data)
	if err != nil {
		slog.Error("CSV parsing error", "error", err)
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error":     err.Error(),
			"details":   "Please ensure the file is a valid CSV with comma-separated values",
			"file_size": len(uploadResult.data),
		})
	}
	slog.Info("CSV headers found", "headers", headers)

	// Check required columns
	requiredColumns := []string{"PersonID", "Last Name", "First Name"}
	if missing := findMissingColumns(headers, requiredColumns); len(missing) > 0 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error":            "Missing required columns",
			"missing_columns":  missing,
			"found_columns":    headers,
			"required_columns": requiredColumns,
		})
	}

	// Determine upload year and save file
	uploadYear := determineUploadYear(e.Request.URL.Query().Get("year"))
	csvDir := filepath.Join(scheduler.app.DataDir(), "bunk_requests")

	latestPath, err := saveCSVWithBackup(csvDir, uploadYear, uploadResult.data)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
	}
	slog.Info("CSV file saved", "year", uploadYear, "path", latestPath)

	// Update metadata
	metadata := map[string]interface{}{
		"filename":     uploadResult.filename,
		"uploaded_at":  time.Now().Format(time.RFC3339),
		"size":         len(uploadResult.data),
		"header_count": len(headers),
		"year":         uploadYear,
	}
	metadataPath := filepath.Join(csvDir, "upload_metadata.json")
	metadataJSON, _ := json.MarshalIndent(metadata, "", "  ")
	if err := os.WriteFile(metadataPath, metadataJSON, 0600); err != nil {
		slog.Warn("Error writing upload metadata", "error", err)
	}

	// Optionally trigger sync and/or process_requests
	runSync := e.Request.URL.Query().Get("run_sync") == boolTrueStr
	runProcessRequestsParam := e.Request.URL.Query().Get("run_process_requests")
	runProcessRequests := runProcessRequestsParam == boolTrueStr || runProcessRequestsParam == "1"

	// process_requests only runs if sync also runs (it depends on sync completing first)
	processRequestsStarted := runSync && runProcessRequests

	if runSync {
		orchestrator := scheduler.GetOrchestrator()
		if !orchestrator.IsRunning("bunk_requests") {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
				defer cancel()

				// Run bunk_requests sync first and wait for completion
				syncErr := orchestrator.runSyncAndWait(ctx, "bunk_requests")
				if syncErr != nil {
					slog.Warn("Error running bunk_requests sync", "error", syncErr)
					return // Don't run process_requests if sync failed
				}

				// Chain process_requests after bunk_requests completes
				if runProcessRequests {
					slog.Info("Chaining process_requests after bunk_requests sync")
					processor := NewRequestProcessor(scheduler.app)
					// Use defaults: all sessions, no force, no field filter
					if err := processor.Sync(ctx); err != nil {
						slog.Error("process_requests failed after upload", "error", err)
					} else {
						stats := processor.GetStats()
						slog.Info("process_requests completed after upload",
							"created", stats.Created,
							"skipped", stats.Skipped,
							"errors", stats.Errors,
						)
					}
				}
			}()
		}
	}

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":                  "CSV uploaded successfully",
		"filename":                 uploadResult.filename,
		"header_count":             len(headers),
		"sync_started":             runSync,
		"process_requests_started": processRequestsStarted,
		"year":                     uploadYear,
	})
}

// handleSyncStatus returns the status of all sync jobs
func handleSyncStatus(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Get status of all known sync types (in dependency order)
	// Note: "persons" is a combined sync that populates persons, households, AND person_tags
	// tables from a single API call - there are no separate households or person_tags syncs
	// Note: "divisions" now runs in daily sync (before persons) rather than weekly
	syncTypes := []string{
		// Weekly syncs - global definitions that rarely change
		"person_tag_defs",   // Global sync: tag definitions
		"custom_field_defs", // Global sync: custom field definitions
		"staff_lookups",     // Global sync: positions, org_categories, program_areas
		"financial_lookups", // Global sync: financial_categories, payment_methods
		// Daily syncs (in dependency order)
		"session_groups",
		"sessions",
		"divisions", // Division definitions (runs before persons in daily sync)
		"attendees",
		"persons", // Combined sync: persons + households + person_tags (includes division relation)
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"staff",                  // Year-scoped staff records (depends on divisions, bunks, persons)
		"camper_history",         // Computed camper denorm with retention metrics
		"financial_transactions", // Year-scoped financial data (depends on sessions, persons, households)
		"family_camp_derived",    // Computed from custom values (depends on person_custom_values, household_custom_values)
		"bunk_requests",
		"process_requests",
		"multi_workbook_export",
		// On-demand syncs (not part of daily sync)
		"person_custom_values",
		"household_custom_values",
	}

	statuses := make(map[string]interface{})
	for _, syncType := range syncTypes {
		if status := orchestrator.GetStatus(syncType); status != nil {
			statuses[syncType] = status
		} else {
			statuses[syncType] = map[string]string{
				"status": "idle",
			}
		}
	}

	// Add daily sync status
	statuses["_daily_sync_running"] = orchestrator.IsDailySyncRunning()

	// Add weekly sync status
	statuses["_weekly_sync_running"] = orchestrator.IsWeeklySyncRunning()

	// Add historical sync status
	statuses["_historical_sync_running"] = orchestrator.IsHistoricalSyncRunning()
	if orchestrator.IsHistoricalSyncRunning() {
		statuses["_historical_sync_year"] = orchestrator.GetHistoricalSyncYear()
	}

	// Add configured year from environment (CAMPMINDER_SEASON_ID)
	configuredYear := time.Now().Year()
	if yearStr := os.Getenv("CAMPMINDER_SEASON_ID"); yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			configuredYear = y
		}
	}
	statuses["_configured_year"] = configuredYear

	// Add queue info
	queue := orchestrator.GetQueuedSyncs()
	queueInfo := make([]map[string]interface{}, len(queue))
	for i, qs := range queue {
		queueInfo[i] = map[string]interface{}{
			"id":                    qs.ID,
			"year":                  qs.Year,
			"type":                  qs.Type, // "unified", "phase", "individual"
			"service":               qs.Service,
			"include_custom_values": qs.IncludeCustomValues,
			"position":              i + 1, // 1-based position
			"queued_at":             qs.QueuedAt.Format(time.RFC3339),
		}
	}
	statuses["_queue"] = queueInfo
	statuses["_queue_length"] = len(queue)

	return e.JSON(http.StatusOK, statuses)
}

// handleUnifiedSync handles both current year and historical syncs via a single endpoint
// Replaces the separate handleDailySync and handleHistoricalSync handlers
// Query params: year (required), service (default: all), includeCustomValues, debug
// Returns 202 Accepted if enqueued, 200 OK if started immediately, 409 if queue full
func handleUnifiedSync(e *core.RequestEvent, scheduler *Scheduler) error {
	// Parse required year parameter
	yearStr := e.Request.URL.Query().Get("year")
	if yearStr == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter",
		})
	}

	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2017 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be 2017 or later.",
		})
	}

	// Parse service parameter (default: all)
	service := e.Request.URL.Query().Get("service")
	if service == "" {
		service = DefaultService
	}

	// Get current year from environment
	currentYear := time.Now().Year()
	if yearStr := os.Getenv("CAMPMINDER_SEASON_ID"); yearStr != "" {
		if cy, err := strconv.Atoi(yearStr); err == nil {
			currentYear = cy
		}
	}

	// Parse optional query parameters
	includeCustomValuesParam := e.Request.URL.Query().Get("includeCustomValues")
	includeCustomValues := includeCustomValuesParam == boolTrueStr || includeCustomValuesParam == "1"

	debugParam := e.Request.URL.Query().Get("debug")
	debug := debugParam == boolTrueStr || debugParam == "1"

	// Get user info for queue tracking
	requestedBy := ""
	if e.Auth != nil {
		requestedBy = e.Auth.GetString("email")
	}

	// Get orchestrator and check if any sync is already running
	orchestrator := scheduler.GetOrchestrator()
	if orchestrator.IsDailySyncRunning() || orchestrator.IsHistoricalSyncRunning() {
		// Sync is running - try to enqueue
		qs, err := orchestrator.EnqueueUnifiedSync(year, service, includeCustomValues, debug, requestedBy)
		if err != nil {
			// Queue is full
			return e.JSON(http.StatusConflict, map[string]interface{}{
				"error": err.Error(),
			})
		}

		// Successfully queued - return 202 Accepted
		position := orchestrator.GetQueuePositionByID(qs.ID)
		return e.JSON(http.StatusAccepted, map[string]interface{}{
			"status":              "queued",
			"queue_id":            qs.ID,
			"position":            position,
			"year":                year,
			"service":             service,
			"includeCustomValues": includeCustomValues,
			"debug":               debug,
		})
	}

	// IMPORTANT: Orchestrator uses Year=0 to indicate current year mode
	// This enables bunk_requests and process_requests inclusion
	// Year > 0 triggers historical mode (re-registers services with year-specific client)
	optsYear := year
	if year == currentYear {
		optsYear = 0 // Current year mode
	}

	// Create sync options
	opts := Options{
		Year:                optsYear,
		IncludeCustomValues: includeCustomValues,
		Debug:               debug,
	}

	// Set services to sync
	if service != DefaultService {
		opts.Services = []string{service}
	}

	// Run in background with queue processing on completion
	go func() {
		// Panic recovery to ensure sync flags are cleared if something goes wrong
		defer func() {
			if r := recover(); r != nil {
				slog.Error("Panic during unified sync",
					"panic", r,
					"year", year,
					"service", service,
				)
				orchestrator.ClearSyncFlags()
			}
		}()

		slog.Info("Unified sync: Job started",
			"year", year,
			"service", service,
			"includeCustomValues", includeCustomValues,
			"debug", debug,
			"isCurrentYear", year == currentYear,
		)

		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
		defer cancel()

		// Store cancel function so running sync can be canceled
		orchestrator.SetActiveSyncCancel(cancel)
		defer orchestrator.ClearActiveSyncCancel()

		if err := orchestrator.RunSyncWithOptions(ctx, opts); err != nil {
			slog.Error("Unified sync failed", "year", year, "service", service, "error", err)
		}

		// Process queue after sync completes
		processQueuedSyncs(orchestrator)
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":             "Sync started",
		"year":                year,
		"service":             service,
		"includeCustomValues": includeCustomValues,
		"debug":               debug,
	})
}

// processQueuedSyncs processes the next item in the sync queue
// Handles all three types: unified, phase, and individual
func processQueuedSyncs(orchestrator *Orchestrator) {
	// Panic recovery to ensure sync flags are cleared if something goes wrong
	defer func() {
		if r := recover(); r != nil {
			slog.Error("Panic during queued sync processing", "panic", r)
			orchestrator.ClearSyncFlags()
		}
	}()

	// Dequeue next item
	qs := orchestrator.DequeueUnifiedSync()
	if qs == nil {
		return // Queue is empty
	}

	slog.Info("Processing queued sync",
		"id", qs.ID,
		"type", qs.Type,
		"year", qs.Year,
		"service", qs.Service,
	)

	// Get current year from environment for year mode determination
	currentYear := time.Now().Year()
	if yearStr := os.Getenv("CAMPMINDER_SEASON_ID"); yearStr != "" {
		if cy, err := strconv.Atoi(yearStr); err == nil {
			currentYear = cy
		}
	}

	// Run the queued sync with cancel support
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	// Store cancel function so running sync can be canceled
	orchestrator.SetActiveSyncCancel(cancel)
	defer orchestrator.ClearActiveSyncCancel()

	// Handle based on queue item type
	switch qs.Type {
	case "phase":
		// Run all jobs in the phase sequentially
		phase := Phase(qs.Service)
		jobs := GetJobsForPhase(phase)
		slog.Info("Queued phase sync: Running jobs",
			"phase", phase, "year", qs.Year, "jobs", jobs)

		canceled := false
		for _, jobID := range jobs {
			select {
			case <-ctx.Done():
				slog.Error("Queued phase sync canceled", "phase", phase, "error", ctx.Err())
				canceled = true
			default:
			}
			if canceled {
				break
			}

			slog.Info("Queued phase sync: Running job", "phase", phase, "job", jobID)
			if err := orchestrator.runSyncAndWait(ctx, jobID); err != nil {
				slog.Error("Queued phase sync: job failed",
					"phase", phase, "job", jobID, "error", err)
				// Continue with next job even if one fails
			}
		}
		slog.Info("Queued phase sync completed", "id", qs.ID, "phase", phase, "year", qs.Year)

	case "individual":
		// Run single job
		slog.Info("Queued individual sync: Running job", "job", qs.Service, "year", qs.Year)
		if err := orchestrator.runSyncAndWait(ctx, qs.Service); err != nil {
			slog.Error("Queued individual sync failed",
				"id", qs.ID, "job", qs.Service, "year", qs.Year, "error", err)
		} else {
			slog.Info("Queued individual sync completed",
				"id", qs.ID, "job", qs.Service, "year", qs.Year)
		}

	case "unified", "":
		// Empty type for backward compatibility with existing queued items
		// Determine year mode
		optsYear := qs.Year
		if qs.Year == currentYear {
			optsYear = 0 // Current year mode
		}

		// Create sync options
		opts := Options{
			Year:                optsYear,
			IncludeCustomValues: qs.IncludeCustomValues,
			Debug:               qs.Debug,
		}

		// Set services to sync
		if qs.Service != DefaultService {
			opts.Services = []string{qs.Service}
		}

		if err := orchestrator.RunSyncWithOptions(ctx, opts); err != nil {
			slog.Error("Queued unified sync failed",
				"id", qs.ID, "year", qs.Year, "service", qs.Service, "error", err)
		} else {
			slog.Info("Queued unified sync completed",
				"id", qs.ID, "year", qs.Year, "service", qs.Service)
		}

	default:
		slog.Error("Unknown queued sync type", "id", qs.ID, "type", qs.Type)
	}

	// Recursively process next item in queue
	processQueuedSyncs(orchestrator)
}

// handleCancelQueuedSync handles canceling a queued sync by ID
func handleCancelQueuedSync(e *core.RequestEvent, scheduler *Scheduler) error {
	// Get the queue ID from path parameter
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing queue ID",
		})
	}

	orchestrator := scheduler.GetOrchestrator()

	// Try to cancel the queued sync
	if !orchestrator.CancelQueuedSync(id) {
		return e.JSON(http.StatusNotFound, map[string]interface{}{
			"error": "Queued sync not found",
			"id":    id,
		})
	}

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message": "Queued sync canceled",
		"id":      id,
	})
}

// handleCancelRunningSync handles canceling the currently running sync
func handleCancelRunningSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Try to cancel the running sync
	if !orchestrator.CancelRunningSync() {
		return e.JSON(http.StatusNotFound, map[string]interface{}{
			"error": "No sync currently running",
		})
	}

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message": "Running sync canceled",
	})
}

// handleHourlySync triggers the hourly sync sequence
func handleHourlySync(e *core.RequestEvent, scheduler *Scheduler) error {
	// Check if hourly sync is already running
	if scheduler.IsHourlySyncRunning() {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error": "Hourly sync already in progress",
		})
	}

	// Trigger hourly sync
	scheduler.TriggerHourlySync()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message": "Hourly sync triggered",
	})
}

// handleWeeklySync triggers the weekly sync sequence (global data jobs)
func handleWeeklySync(e *core.RequestEvent, scheduler *Scheduler) error {
	// Check if weekly sync is already running
	if scheduler.IsWeeklySyncRunning() {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error": "Weekly sync already in progress",
		})
	}

	// Trigger weekly sync
	scheduler.TriggerWeeklySync()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Weekly sync triggered",
		"services": GetWeeklySyncJobs(),
	})
}

// handleCustomValuesSync triggers the custom values sync (person + household custom field values)
func handleCustomValuesSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Check if custom values sync is already running
	if orchestrator.IsRunning("person_custom_values") || orchestrator.IsRunning("household_custom_values") {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error": "Custom values sync already in progress",
		})
	}

	// Trigger custom values sync
	scheduler.TriggerCustomValuesSync()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Custom values sync triggered",
		"services": GetCustomValuesSyncJobs(),
	})
}

// handleGetAvailableYears returns available years from the database
func handleGetAvailableYears(e *core.RequestEvent, app *pocketbase.PocketBase) error {
	// Query distinct years from camp_sessions table
	var years []int

	err := app.DB().NewQuery(`
		SELECT DISTINCT year 
		FROM camp_sessions 
		WHERE year IS NOT NULL 
		ORDER BY year DESC
	`).Column(&years)

	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Failed to query available years",
		})
	}

	// Get current year from environment
	currentYear := time.Now().Year()
	if yearStr := os.Getenv("CAMPMINDER_SEASON_ID"); yearStr != "" {
		if cy, err := strconv.Atoi(yearStr); err == nil {
			currentYear = cy
		}
	}

	return e.JSON(http.StatusOK, map[string]interface{}{
		"current":   currentYear,
		"available": years,
	})
}

// handleTestConnection tests the CampMinder client connection
func handleTestConnection(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Get the base client
	if orchestrator.baseClient == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "CampMinder client not initialized",
			"hint":  "Check that CAMPMINDER_API_KEY, CAMPMINDER_CLIENT_ID, and CAMPMINDER_SEASON_ID are set",
		})
	}

	// Test authentication by making a simple API call
	// We'll use GetSessions as it's a read-only operation
	sessions, err := orchestrator.baseClient.GetSessions()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error":   "CampMinder connection failed",
			"details": err.Error(),
			"hint":    "Check API credentials and network connectivity",
			"config": map[string]interface{}{
				"client_id": orchestrator.baseClient.GetClientID(),
				"season_id": orchestrator.baseClient.GetSeasonID(),
			},
		})
	}

	// Success - return connection info
	return e.JSON(http.StatusOK, map[string]interface{}{
		"status":  "connected",
		"message": "CampMinder client connection successful",
		"config": map[string]interface{}{
			"client_id":      orchestrator.baseClient.GetClientID(),
			"season_id":      orchestrator.baseClient.GetSeasonID(),
			"sessions_found": len(sessions),
		},
	})
}

// handleMultiWorkbookExport handles the multi-workbook export
// Exports globals to a dedicated workbook and year data to per-year workbooks.
// Query parameters:
//   - years: comma-separated list of years to export (empty = current year)
//   - includeGlobals: "true" to include globals export (default: true for current year, false for historical)
func handleMultiWorkbookExport(e *core.RequestEvent, scheduler *Scheduler) error {
	// Check if Google Sheets is configured
	if !google.IsEnabled() {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Google Sheets export is not enabled",
			"hint":  "Set GOOGLE_SHEETS_ENABLED=true and configure credentials",
		})
	}

	// Parse optional years parameter
	yearsParam := e.Request.URL.Query().Get("years")
	years, err := ParseExportYearsParam(yearsParam)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": fmt.Sprintf("Invalid years parameter: %v", err),
		})
	}

	// Parse optional includeGlobals parameter
	// Default: true for current year sync, false for historical
	includeGlobalsParam := e.Request.URL.Query().Get("includeGlobals")
	includeGlobals := len(years) == 0 // Default to true for current year
	if includeGlobalsParam != "" {
		includeGlobals = includeGlobalsParam == boolTrueStr || includeGlobalsParam == "1"
	}

	// Validate years if provided
	if len(years) > 0 {
		currentYear := time.Now().Year()
		if err := ValidateExportYears(years, currentYear); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]interface{}{
				"error": err.Error(),
			})
		}
	}

	orchestrator := scheduler.GetOrchestrator()

	// Check if already running
	if orchestrator.IsRunning("multi_workbook_export") {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Multi-workbook export already in progress",
			"status":   "running",
			"syncType": "multi_workbook_export",
		})
	}

	// Get the service
	service := orchestrator.GetService("multi_workbook_export")
	multiExport, ok := service.(*MultiWorkbookExport)
	if !ok || multiExport == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Multi-workbook export service not available",
			"hint":  "Ensure GOOGLE_SHEETS_ENABLED=true and credentials are configured",
		})
	}

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		if len(years) > 0 {
			// Export specific years
			slog.Info("Starting multi-workbook export for specific years",
				"years", years,
				"includeGlobals", includeGlobals,
			)
			if err := multiExport.SyncForYears(ctx, years, includeGlobals); err != nil {
				slog.Error("Multi-workbook export failed", "error", err, "years", years)
			}
		} else {
			// Default: full export (globals + current year)
			slog.Info("Starting multi-workbook export for current year")
			if err := multiExport.Sync(ctx); err != nil {
				slog.Error("Multi-workbook export failed", "error", err)
			}
		}
	}()

	// Build response
	response := map[string]interface{}{
		"message":  "Multi-workbook export started",
		"status":   "started",
		"syncType": "multi_workbook_export",
	}
	if len(years) > 0 {
		response["years"] = years
		response["includeGlobals"] = includeGlobals
	}

	return e.JSON(http.StatusOK, response)
}

// handlePersonCustomFieldValuesSync handles the on-demand person custom field values sync
// This is expensive (1 API call per person) so supports session filtering
//
//nolint:dupl // Similar pattern to handleHouseholdCustomFieldValuesSync, intentional for person variant
func handlePersonCustomFieldValuesSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "person_custom_values"

	// Note: "already running" check is handled by MarkSyncRunning below,
	// which returns an error if the sync is already in progress

	// Parse session filter (accepts string: all, 1, 2, 2a, 3, 4, etc.)
	session := e.Request.URL.Query().Get("session")
	if session == "" || session == "0" {
		session = DefaultSession
	}

	// Validate session parameter
	if !IsValidSession(session) {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid session parameter. Must be 'all', '1', '2', '2a', '2b', '3', '3a', '3b', '4', or 'toc'.",
		})
	}

	// Parse debug parameter
	debugParam := e.Request.URL.Query().Get("debug")
	debug := debugParam == boolTrueStr || debugParam == "1"

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*PersonCustomFieldValuesSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Person custom field values sync service not found",
		})
	}
	service.SetSession(session)
	service.SetDebug(debug)

	// Mark as running BEFORE starting goroutine to prevent race condition
	// This ensures the first frontend poll sees the sync as active
	if err := orchestrator.MarkSyncRunning(syncType); err != nil {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    err.Error(),
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
		defer cancel()

		slog.Info("Starting person_custom_values sync",
			"session", session,
			"debug", debug,
		)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Person custom field values sync failed", "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Person custom field values sync completed",
				"created", stats.Created,
				"updated", stats.Updated,
				"skipped", stats.Skipped,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  fmt.Sprintf("%s sync started", syncType),
		"status":   "started",
		"syncType": syncType,
		"session":  session,
		"debug":    debug,
	})
}

// handleHouseholdCustomFieldValuesSync handles the on-demand household custom field values sync
// This is expensive (1 API call per household) so supports session filtering
//
//nolint:dupl // Similar pattern to handlePersonCustomFieldValuesSync, intentional for household variant
func handleHouseholdCustomFieldValuesSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "household_custom_values"

	// Note: "already running" check is handled by MarkSyncRunning below,
	// which returns an error if the sync is already in progress

	// Parse session filter (accepts string: all, 1, 2, 2a, 3, 4, etc.)
	session := e.Request.URL.Query().Get("session")
	if session == "" || session == "0" {
		session = DefaultSession
	}

	// Validate session parameter
	if !IsValidSession(session) {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid session parameter. Must be 'all', '1', '2', '2a', '2b', '3', '3a', '3b', '4', or 'toc'.",
		})
	}

	// Parse debug parameter
	debugParam := e.Request.URL.Query().Get("debug")
	debug := debugParam == boolTrueStr || debugParam == "1"

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*HouseholdCustomFieldValuesSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Household custom field values sync service not found",
		})
	}
	service.SetSession(session)
	service.SetDebug(debug)

	// Mark as running BEFORE starting goroutine to prevent race condition
	// This ensures the first frontend poll sees the sync as active
	if err := orchestrator.MarkSyncRunning(syncType); err != nil {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    err.Error(),
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
		defer cancel()

		slog.Info("Starting household_custom_values sync",
			"session", session,
			"debug", debug,
		)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Household custom field values sync failed", "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Household custom field values sync completed",
				"created", stats.Created,
				"updated", stats.Updated,
				"skipped", stats.Skipped,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  fmt.Sprintf("%s sync started", syncType),
		"status":   "started",
		"syncType": syncType,
		"session":  session,
		"debug":    debug,
	})
}

// handleFinancialTransactionsSync handles the financial transactions sync
// Accepts optional ?year=YYYY parameter for historical data sync
func handleFinancialTransactionsSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "financial_transactions"

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse optional year parameter for historical sync
	yearParam := e.Request.URL.Query().Get("year")
	year := 0 // Default: current year from env
	if yearParam != "" {
		if y, err := strconv.Atoi(yearParam); err == nil && y >= 2017 && y <= time.Now().Year() {
			year = y
		} else {
			return e.JSON(http.StatusBadRequest, map[string]interface{}{
				"error": "Invalid year parameter. Must be between 2017 and current year.",
			})
		}
	}

	// For historical sync, use year-specific client
	if year > 0 {
		// Run in background with year override
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()

			slog.Info("Starting financial_transactions historical sync", "year", year)

			// Clone the client with the specified year
			if orchestrator.baseClient == nil {
				slog.Error("Cannot run historical sync - baseClient is nil")
				return
			}
			yearClient := orchestrator.baseClient.CloneWithYear(year)

			// Create a new service with the year client
			yearService := NewFinancialTransactionsSync(scheduler.app, yearClient)

			if err := yearService.SyncForYear(ctx, year); err != nil {
				slog.Error("Financial transactions historical sync failed", "year", year, "error", err)
			} else {
				stats := yearService.GetStats()
				slog.Info("Financial transactions historical sync completed",
					"year", year,
					"created", stats.Created,
					"updated", stats.Updated,
					"skipped", stats.Skipped,
					"errors", stats.Errors,
				)
			}
		}()

		return e.JSON(http.StatusOK, map[string]interface{}{
			"message":  "Financial transactions historical sync started",
			"status":   "started",
			"syncType": syncType,
			"year":     year,
		})
	}

	// Current year: run in background using standard sync
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting financial_transactions sync")
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Financial transactions sync failed", "error", err)
		} else {
			service := orchestrator.GetService(syncType)
			if service != nil {
				stats := service.GetStats()
				slog.Info("Financial transactions sync completed",
					"created", stats.Created,
					"updated", stats.Updated,
					"skipped", stats.Skipped,
					"errors", stats.Errors,
				)
			}
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Financial transactions sync started",
		"status":   "started",
		"syncType": syncType,
	})
}

// handleCamperHistorySync handles the camper history computation endpoint
// Accepts required ?year=YYYY parameter to compute history for a specific year
func handleCamperHistorySync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "camper_history"

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Camper history computation already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*CamperHistorySync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Camper history sync service not found",
		})
	}
	service.Year = year
	service.DryRun = dryRun

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting camper_history computation",
			"year", year,
			"dry_run", dryRun,
		)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Camper history computation failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Camper history computation completed",
				"year", year,
				"created", stats.Created,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Camper history computation started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
		"dry_run":  dryRun,
	})
}

// handleFamilyCampDerivedSync handles the family camp derived tables computation endpoint
// Accepts required ?year=YYYY parameter to compute derived tables for a specific year
func handleFamilyCampDerivedSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := serviceNameFamilyCampDerived

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Family camp derived computation already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*FamilyCampDerivedSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Family camp derived sync service not found",
		})
	}
	service.Year = year
	service.DryRun = dryRun

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting family_camp_derived computation",
			"year", year,
			"dry_run", dryRun,
		)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Family camp derived computation failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Family camp derived computation completed",
				"year", year,
				"created", stats.Created,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Family camp derived computation started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
		"dry_run":  dryRun,
	})
}

// handleStaffSkillsSync handles the staff skills extraction endpoint
// Accepts required ?year=YYYY parameter to extract skills for a specific year
func handleStaffSkillsSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "staff_skills"

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Staff skills sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*StaffSkillsSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Staff skills sync service not found",
		})
	}
	service.Year = year
	service.DryRun = dryRun

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting staff_skills extraction",
			"year", year,
			"dry_run", dryRun,
		)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Staff skills extraction failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Staff skills extraction completed",
				"year", year,
				"created", stats.Created,
				"updated", stats.Updated,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Staff skills extraction started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
		"dry_run":  dryRun,
	})
}

// handleFinancialAidApplicationsSync handles the financial aid applications computation endpoint
// Accepts required ?year=YYYY parameter to compute FA applications for a specific year
func handleFinancialAidApplicationsSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := serviceNameFinancialAidApplications

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Financial aid applications sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*FinancialAidApplicationsSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Financial aid applications sync service not found",
		})
	}
	service.Year = year
	service.DryRun = dryRun

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting financial_aid_applications extraction",
			"year", year,
			"dry_run", dryRun,
		)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Financial aid applications extraction failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Financial aid applications extraction completed",
				"year", year,
				"created", stats.Created,
				"updated", stats.Updated,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Financial aid applications extraction started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
		"dry_run":  dryRun,
	})
}

// handleHouseholdDemographicsSync handles the household demographics computation endpoint
// Accepts required ?year=YYYY parameter to compute demographics for a specific year
func handleHouseholdDemographicsSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := serviceNameHouseholdDemographics

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Household demographics computation already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*HouseholdDemographicsSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Household demographics sync service not found",
		})
	}
	service.Year = year
	service.DryRun = dryRun

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting household_demographics computation",
			"year", year,
			"dry_run", dryRun,
		)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Household demographics computation failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Household demographics computation completed",
				"year", year,
				"created", stats.Created,
				"updated", stats.Updated,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Household demographics computation started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
		"dry_run":  dryRun,
	})
}

// handleGetPhases returns list of available sync phases with metadata
func handleGetPhases(e *core.RequestEvent) error {
	phases := GetAllPhases()

	type PhaseInfo struct {
		ID          string   `json:"id"`
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Jobs        []string `json:"jobs"`
	}

	// Build phase info with human-readable names and descriptions
	phaseNames := map[Phase]string{
		PhaseSource:    "CampMinder",
		PhaseExpensive: "Custom Values",
		PhaseTransform: "Transform",
		PhaseProcess:   "Process",
		PhaseExport:    "Export",
	}

	phaseDescriptions := map[Phase]string{
		PhaseSource:    "Sync data from CampMinder API",
		PhaseExpensive: "Sync custom field values (slow, 1 API call per entity)",
		PhaseTransform: "Compute derived tables from synced data",
		PhaseProcess:   "Import CSV files and process with AI",
		PhaseExport:    "Export data to Google Sheets",
	}

	result := make([]PhaseInfo, 0, len(phases))
	for _, phase := range phases {
		result = append(result, PhaseInfo{
			ID:          string(phase),
			Name:        phaseNames[phase],
			Description: phaseDescriptions[phase],
			Jobs:        GetJobsForPhase(phase),
		})
	}

	return e.JSON(http.StatusOK, map[string]interface{}{
		"phases": result,
	})
}

// handleRunPhase runs all jobs in a specific sync phase
// Requires ?year=YYYY and ?phase=<phase> query parameters
// Returns 202 Accepted if enqueued, 200 OK if started immediately
func handleRunPhase(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Parse required phase parameter
	phaseParam := e.Request.URL.Query().Get("phase")
	if phaseParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required phase parameter. Use ?phase=<source|expensive|transform|process|export>",
		})
	}

	// Validate phase
	phase := Phase(phaseParam)
	validPhase := false
	for _, p := range GetAllPhases() {
		if p == phase {
			validPhase = true
			break
		}
	}
	if !validPhase {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error":        "Invalid phase parameter",
			"valid_phases": []string{"source", "expensive", "transform", "process", "export"},
		})
	}

	// Get jobs for this phase
	jobs := GetJobsForPhase(phase)
	if len(jobs) == 0 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "No jobs found for phase: " + string(phase),
		})
	}

	// Parse optional debug parameter
	debugParam := e.Request.URL.Query().Get("debug")
	debug := debugParam == boolTrueStr || debugParam == "1"

	// Get user info for queue tracking
	requestedBy := ""
	if e.Auth != nil {
		requestedBy = e.Auth.GetString("email")
	}

	// Check for warning: Transform phase without custom values
	var warning string
	if phase == PhaseTransform {
		// Check if custom values exist for this year
		if !checkCustomValuesExist(scheduler.app, year) {
			warning = "Transform phase requires Custom Values phase to have run first. " +
				"4 of 5 transform jobs depend on custom values data and will produce incomplete results without it."
		}
	}

	// Check if any sync is already running
	if orchestrator.IsDailySyncRunning() || orchestrator.IsWeeklySyncRunning() ||
		orchestrator.IsHistoricalSyncRunning() || orchestrator.IsCustomValuesSyncRunning() {
		// Queue the phase sync instead of returning conflict
		qs, err := orchestrator.EnqueuePhaseSync(year, phase, requestedBy)
		if err != nil {
			return e.JSON(http.StatusConflict, map[string]interface{}{
				"error": err.Error(),
			})
		}

		// Successfully queued - return 202 Accepted
		position := orchestrator.GetQueuePositionByID(qs.ID)
		response := map[string]interface{}{
			"status":   "queued",
			"queue_id": qs.ID,
			"position": position,
			"phase":    string(phase),
			"year":     year,
			"jobs":     jobs,
		}
		if warning != "" {
			response["warning"] = warning
		}
		return e.JSON(http.StatusAccepted, response)
	}

	// Run phase jobs in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
		defer cancel()

		slog.Info("Starting phase sync",
			"phase", phase,
			"year", year,
			"jobs", jobs,
			"debug", debug,
		)

		// Run jobs sequentially in order
		for _, jobID := range jobs {
			select {
			case <-ctx.Done():
				slog.Error("Phase sync canceled", "phase", phase, "error", ctx.Err())
				return
			default:
			}

			slog.Info("Running phase job", "phase", phase, "job", jobID)
			if err := orchestrator.runSyncAndWait(ctx, jobID); err != nil {
				slog.Error("Phase job failed", "phase", phase, "job", jobID, "error", err)
				// Continue with next job even if one fails
			}
		}

		slog.Info("Phase sync completed", "phase", phase, "year", year)

		// Process queue after phase sync completes
		processQueuedSyncs(orchestrator)
	}()

	response := map[string]interface{}{
		"message": "Phase sync started",
		"status":  "started",
		"phase":   string(phase),
		"year":    year,
		"jobs":    jobs,
		"debug":   debug,
	}
	if warning != "" {
		response["warning"] = warning
	}
	return e.JSON(http.StatusOK, response)
}

// checkCustomValuesExist checks if custom values have been synced for a given year
func checkCustomValuesExist(app core.App, year int) bool {
	// Check for at least one person_custom_values record for this year
	records, err := app.FindRecordsByFilter(
		"person_custom_values",
		fmt.Sprintf("year = %d", year),
		"",
		1,
		0,
	)
	return err == nil && len(records) > 0
}

// handleCamperDietarySync handles the camper dietary extraction endpoint
// Accepts required ?year=YYYY parameter to extract dietary info for a specific year
func handleCamperDietarySync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "camper_dietary"

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Camper dietary sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*CamperDietarySync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Camper dietary sync service not found",
		})
	}
	service.Year = year

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting camper_dietary extraction", "year", year)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Camper dietary extraction failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Camper dietary extraction completed",
				"year", year,
				"created", stats.Created,
				"updated", stats.Updated,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Camper dietary extraction started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
	})
}

// handleCamperTransportationSync handles the camper transportation extraction endpoint
// Accepts required ?year=YYYY parameter to extract transportation info for a specific year
func handleCamperTransportationSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "camper_transportation"

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Camper transportation sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*CamperTransportationSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Camper transportation sync service not found",
		})
	}
	service.Year = year

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting camper_transportation extraction", "year", year)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Camper transportation extraction failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Camper transportation extraction completed",
				"year", year,
				"created", stats.Created,
				"updated", stats.Updated,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Camper transportation extraction started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
	})
}

// handleQuestRegistrationsSync handles the Quest registrations extraction endpoint
// Accepts required ?year=YYYY parameter to extract Quest info for a specific year
func handleQuestRegistrationsSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "quest_registrations"

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Quest registrations sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*QuestRegistrationsSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Quest registrations sync service not found",
		})
	}
	service.Year = year

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting quest_registrations extraction", "year", year)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Quest registrations extraction failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Quest registrations extraction completed",
				"year", year,
				"created", stats.Created,
				"updated", stats.Updated,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Quest registrations extraction started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
	})
}

// handleStaffApplicationsSync handles the staff applications extraction endpoint
// Accepts required ?year=YYYY parameter to extract staff application info for a specific year
func handleStaffApplicationsSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "staff_applications"

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Staff applications sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*StaffApplicationsSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Staff applications sync service not found",
		})
	}
	service.Year = year

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting staff_applications extraction", "year", year)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Staff applications extraction failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Staff applications extraction completed",
				"year", year,
				"created", stats.Created,
				"updated", stats.Updated,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Staff applications extraction started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
	})
}

// handleStaffVehicleInfoSync handles the staff vehicle info extraction endpoint
// Accepts required ?year=YYYY parameter to extract staff vehicle info for a specific year
func handleStaffVehicleInfoSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "staff_vehicle_info"

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Staff vehicle info sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || year < 2017 || year > 2050 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter. Must be between 2017 and 2050.",
		})
	}

	// Get the service and set options
	service, ok := orchestrator.GetService(syncType).(*StaffVehicleInfoSync)
	if !ok || service == nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Staff vehicle info sync service not found",
		})
	}
	service.Year = year

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		slog.Info("Starting staff_vehicle_info extraction", "year", year)
		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			slog.Error("Staff vehicle info extraction failed", "year", year, "error", err)
		} else {
			stats := service.GetStats()
			slog.Info("Staff vehicle info extraction completed",
				"year", year,
				"created", stats.Created,
				"updated", stats.Updated,
				"deleted", stats.Deleted,
				"errors", stats.Errors,
			)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":  "Staff vehicle info extraction started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
	})
}
