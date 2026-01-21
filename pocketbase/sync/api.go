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

	// Daily sync endpoint
	e.Router.POST("/api/custom/sync/daily", requireAuth(func(e *core.RequestEvent) error {
		return handleDailySync(e, scheduler)
	}))

	// Hourly sync endpoint
	e.Router.POST("/api/custom/sync/hourly", requireAuth(func(e *core.RequestEvent) error {
		return handleHourlySync(e, scheduler)
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
			session = "all" // Default: all sessions
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

	// Historical sync endpoints
	// Sync specific year and service
	e.Router.POST("/api/custom/sync/historical/{year}/{service}", requireAuth(func(e *core.RequestEvent) error {
		return handleHistoricalSync(e, scheduler)
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

	// Google Sheets export endpoint
	e.Router.POST("/api/custom/sync/google-sheets-export", func(e *core.RequestEvent) error {
		// Check authentication
		if e.Auth == nil {
			return apis.NewUnauthorizedError("Authentication required", nil)
		}

		return handleGoogleSheetsExport(e, scheduler)
	})

	// Person tag definitions sync
	e.Router.POST("/api/custom/sync/person-tag-definitions", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "person_tag_definitions")
	}))

	// Households sync
	e.Router.POST("/api/custom/sync/households", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "households")
	}))

	// Person tags sync
	e.Router.POST("/api/custom/sync/person-tags", requireAuth(func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "person_tags")
	}))

	return nil
}

// handleIndividualSync handles running a single sync job
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

	// Run in background
	go func() {
		// Create context inside goroutine so it doesn't get canceled immediately
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		if err := orchestrator.RunSingleSync(ctx, syncType); err != nil {
			// Log error (could also store in DB)
			e.App.Logger().Error("Individual sync failed", "syncType", syncType, "error", err)
		}
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

// handleBunkRequestsUpload handles CSV file upload for bunk requests
func handleBunkRequestsUpload(e *core.RequestEvent, scheduler *Scheduler) error {
	// Parse multipart form
	form, err := e.Request.MultipartReader()
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid multipart form",
		})
	}

	var csvData []byte
	var filename string

	// Read form parts
	for {
		part, err := form.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]interface{}{
				"error": "Error reading form data",
			})
		}

		// Check if this is the CSV file
		if part.FormName() == "file" {
			filename = part.FileName()
			csvData, err = io.ReadAll(part)
			if err != nil {
				return e.JSON(http.StatusBadRequest, map[string]interface{}{
					"error": "Error reading CSV file",
				})
			}
		}
		if err := part.Close(); err != nil {
			slog.Warn("Error closing multipart part", "error", err)
		}
	}

	if len(csvData) == 0 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "No CSV file provided",
		})
	}

	// Strip UTF-8 BOM if present
	if len(csvData) >= 3 && csvData[0] == 0xEF && csvData[1] == 0xBB && csvData[2] == 0xBF {
		csvData = csvData[3:]
		slog.Info("Stripped UTF-8 BOM from CSV file")
	}

	// Validate CSV structure
	reader := csv.NewReader(bytes.NewReader(csvData))
	// Configure reader for flexibility
	reader.LazyQuotes = true       // Allow improperly quoted fields
	reader.TrimLeadingSpace = true // Trim spaces
	reader.FieldsPerRecord = -1    // Allow variable number of fields

	headers, err := reader.Read()
	if err != nil {
		slog.Error("CSV parsing error", "error", err)
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error":     fmt.Sprintf("Invalid CSV format: %v", err),
			"details":   "Please ensure the file is a valid CSV with comma-separated values",
			"file_size": len(csvData),
		})
	}

	// Trim whitespace from headers
	for i := range headers {
		headers[i] = strings.TrimSpace(headers[i])
	}

	slog.Info("CSV headers found", "headers", headers)

	// Check required columns (case-insensitive)
	requiredColumns := []string{"PersonID", "Last Name", "First Name"}
	missingColumns := []string{}

	for _, required := range requiredColumns {
		found := false
		for _, header := range headers {
			if strings.EqualFold(header, required) {
				found = true
				break
			}
		}
		if !found {
			missingColumns = append(missingColumns, required)
		}
	}

	if len(missingColumns) > 0 {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error":            "Missing required columns",
			"missing_columns":  missingColumns,
			"found_columns":    headers,
			"required_columns": requiredColumns,
		})
	}

	// Create directory if it doesn't exist
	csvDir := filepath.Join(scheduler.app.DataDir(), "bunk_requests")
	if err := os.MkdirAll(csvDir, 0750); err != nil { //nolint:gosec // G301: data dir permissions
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Failed to create directory",
		})
	}

	// Create backup of existing file if it exists
	latestPath := filepath.Join(csvDir, "latest.csv")
	if _, err := os.Stat(latestPath); err == nil {
		backupName := fmt.Sprintf("backup_%s.csv", time.Now().Format("20060102_150405"))
		backupPath := filepath.Join(csvDir, backupName)
		if err := os.Rename(latestPath, backupPath); err != nil {
			slog.Warn("Failed to create backup", "error", err)
		}
	}

	// Write new CSV file
	if err := os.WriteFile(latestPath, csvData, 0600); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error": "Failed to save CSV file",
		})
	}

	// Update metadata
	metadata := map[string]interface{}{
		"filename":     filename,
		"uploaded_at":  time.Now().Format(time.RFC3339),
		"size":         len(csvData),
		"header_count": len(headers),
	}

	metadataPath := filepath.Join(csvDir, "upload_metadata.json")
	metadataJSON, _ := json.MarshalIndent(metadata, "", "  ")
	if err := os.WriteFile(metadataPath, metadataJSON, 0600); err != nil {
		slog.Warn("Error writing upload metadata", "error", err)
	}

	// Optionally trigger sync
	runSync := e.Request.URL.Query().Get("run_sync") == boolTrueStr
	if runSync {
		orchestrator := scheduler.GetOrchestrator()
		if !orchestrator.IsRunning("bunk_requests") {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
				defer cancel()
				if err := orchestrator.RunSingleSync(ctx, "bunk_requests"); err != nil {
					slog.Warn("Error running bunk_requests sync", "error", err)
				}
			}()
		}
	}

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":      "CSV uploaded successfully",
		"filename":     filename,
		"header_count": len(headers),
		"sync_started": runSync,
	})
}

// handleSyncStatus returns the status of all sync jobs
func handleSyncStatus(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Get status of all known sync types (in dependency order)
	syncTypes := []string{
		"session_groups",
		"sessions",
		"attendees",
		"person_tag_definitions",
		"persons",
		"households",
		"person_tags",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"bunk_requests",
		"process_requests",
		"google_sheets_export",
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

	// Add historical sync status
	statuses["_historical_sync_running"] = orchestrator.IsHistoricalSyncRunning()
	if orchestrator.IsHistoricalSyncRunning() {
		statuses["_historical_sync_year"] = orchestrator.GetHistoricalSyncYear()
	}

	return e.JSON(http.StatusOK, statuses)
}

// handleDailySync triggers the daily sync sequence
func handleDailySync(e *core.RequestEvent, scheduler *Scheduler) error {
	// Check if daily sync is already running
	if scheduler.IsDailySyncRunning() {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error": "Daily sync already in progress",
		})
	}

	// Trigger daily sync
	scheduler.TriggerDailySync()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message": "Daily sync triggered",
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

// handleHistoricalSync handles syncing a specific year and service
func handleHistoricalSync(e *core.RequestEvent, scheduler *Scheduler) error {
	// Get parameters
	yearStr := e.Request.PathValue("year")
	service := e.Request.PathValue("service")

	// Parse year
	year, err := strconv.Atoi(yearStr)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Invalid year parameter",
		})
	}

	// Validate year range (2017-present)
	currentYear := time.Now().Year()
	if year < 2017 || year > currentYear {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Year must be between 2017 and current year",
		})
	}

	// Get orchestrator
	orchestrator := scheduler.GetOrchestrator()

	// Check if any sync is already running
	runningJobs := orchestrator.GetRunningJobs()
	if len(runningJobs) > 0 {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":       "Other sync jobs are running",
			"runningJobs": runningJobs,
		})
	}

	// Create sync options
	opts := Options{
		Year: year,
	}

	// Set services to sync
	if service == "all" {
		opts.Services = []string{} // Empty means all services in orchestrator
	} else {
		opts.Services = []string{service}
	}

	// Run in background
	go func() {
		// Create context inside goroutine so it doesn't get canceled immediately
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		if err := orchestrator.RunSyncWithOptions(ctx, opts); err != nil {
			// Store error in app logger for monitoring
			e.App.Logger().Error("Historical sync failed", "year", year, "service", service, "error", err)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message": "Historical sync started",
		"year":    year,
		"service": service,
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

// handleGoogleSheetsExport handles manual triggering of Google Sheets export
func handleGoogleSheetsExport(e *core.RequestEvent, scheduler *Scheduler) error {
	// Check if Google Sheets is configured
	if !google.IsEnabled() {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Google Sheets export is not enabled",
			"hint":  "Set GOOGLE_SHEETS_ENABLED=true and configure credentials",
		})
	}

	spreadsheetID := google.GetSpreadsheetID()
	if spreadsheetID == "" {
		return e.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Google Sheets spreadsheet ID not configured",
			"hint":  "Set GOOGLE_SHEETS_SPREADSHEET_ID environment variable",
		})
	}

	orchestrator := scheduler.GetOrchestrator()

	// Check if already running
	if orchestrator.IsRunning("google_sheets_export") {
		return e.JSON(http.StatusConflict, map[string]interface{}{
			"error":    "Google Sheets export already in progress",
			"status":   "running",
			"syncType": "google_sheets_export",
		})
	}

	// Run in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		if err := orchestrator.RunSingleSync(ctx, "google_sheets_export"); err != nil {
			slog.Error("Google Sheets export failed", "error", err)
		}
	}()

	return e.JSON(http.StatusOK, map[string]interface{}{
		"message":        "Google Sheets export started",
		"status":         "started",
		"syncType":       "google_sheets_export",
		"spreadsheet_id": spreadsheetID,
	})
}
