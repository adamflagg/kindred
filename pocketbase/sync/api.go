// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"slices"
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

// normalizeSession normalizes the session query parameter.
// Empty string and "0" both map to DefaultSession ("all").
func normalizeSession(session string) string {
	if session == "" || session == "0" {
		return DefaultSession
	}
	return session
}

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

// RequirePermission wraps a handler to require authentication and a specific RBAC permission.
// Admin users (is_admin=true) bypass the permission check.
//
// Exported so other packages gating on the same RBAC permissions (e.g.
// lodging's roll-forward routes, which gate on "bunking.manage" like every
// lodging_* write rule) reuse this exact check instead of writing a second
// one with different semantics.
func RequirePermission(permission string, handler func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return apis.NewUnauthorizedError("Authentication required", nil)
		}
		// Admin bypass
		if e.Auth.GetBool("is_admin") {
			return handler(e)
		}
		// Check cached_permissions JSON array (exact element match, not substring)
		perms := e.Auth.Get("cached_permissions")
		data, _ := json.Marshal(perms)
		var permSlice []string
		_ = json.Unmarshal(data, &permSlice)
		if !slices.Contains(permSlice, permission) {
			return apis.NewForbiddenError("Permission required: "+permission, nil)
		}
		return handler(e)
	}
}

// requirePermission is the package-local name kept for this file's existing
// call sites; it delegates to RequirePermission rather than duplicating it.
func requirePermission(permission string, handler func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return RequirePermission(permission, handler)
}

// parseSourceFieldParameter validates and parses the comma-separated `source_field`
// query parameter used by the request-processing endpoints. It returns the parsed
// field names, the first invalid field encountered (empty when all are valid), and
// whether every field was valid. An empty parameter means "all fields" and is valid
// with a nil slice.
func parseSourceFieldParameter(param string) (fields []string, invalid string, ok bool) {
	if param == "" {
		return nil, "", true
	}
	validFields := map[string]bool{
		"bunk_request_form":   true,
		"staff_not_bunk_with": true,
		"bunking_notes":       true,
		"internal_notes":      true,
		"socialize_with":      true,
	}
	for _, f := range strings.Split(param, ",") {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		if !validFields[f] {
			return nil, f, false
		}
		fields = append(fields, f)
	}
	return fields, "", true
}

// InitializeSyncService sets up the sync API endpoints
func InitializeSyncService(app *pocketbase.PocketBase, e *core.ServeEvent) error {
	// Get the scheduler instance
	scheduler := GetScheduler(app)

	// Register API endpoints using PocketBase's router
	// For PocketBase v0.28.4, we use the e.Router directly

	// Refresh bunking endpoint
	e.Router.POST("/api/custom/sync/refresh-bunking",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleRefreshBunking(e, scheduler)
		}))

	// Refresh family camp housing endpoint (kindred#2478)
	e.Router.POST("/api/custom/sync/refresh-family-camp",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleRefreshFamilyCamp(e, scheduler)
		}))

	// Bunk requests CSV upload endpoint (requires bunking.manage permission)
	e.Router.POST("/api/custom/sync/bunk_requests_upload",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleBunkRequestsUpload(e, scheduler)
		}))

	// Status endpoint
	e.Router.GET("/api/custom/sync/status", requireAuth(func(e *core.RequestEvent) error {
		return handleSyncStatus(e, scheduler)
	}))

	// Unified sync endpoint (replaces daily + historical endpoints)
	// Accepts query params: year, service, includeCustomValues, debug
	// Returns 202 Accepted if enqueued, 200 OK if started immediately
	// Requires bunking.manage permission
	e.Router.POST("/api/custom/sync/run", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleUnifiedSync(e, scheduler)
	}))

	// Cancel queued sync endpoint
	e.Router.DELETE("/api/custom/sync/queue/{id}", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleCancelQueuedSync(e, scheduler)
	}))

	// Cancel running sync endpoint
	e.Router.DELETE("/api/custom/sync/running", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleCancelRunningSync(e, scheduler)
	}))

	// Hourly sync endpoint
	e.Router.POST("/api/custom/sync/hourly", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleHourlySync(e, scheduler)
	}))

	// Weekly sync endpoint (global data - expensive N API call syncs)
	e.Router.POST("/api/custom/sync/weekly", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleWeeklySync(e, scheduler)
	}))

	// Custom values sync endpoint (runs person + household custom field values sync)
	// This is separate from weekly sync because it's even more expensive (1 API call per entity)
	e.Router.POST("/api/custom/sync/custom-values", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleCustomValuesSync(e, scheduler)
	}))

	// Phase API endpoints
	// GET /api/custom/sync/phases - List available sync phases
	e.Router.GET("/api/custom/sync/phases", requireAuth(handleGetPhases))

	// POST /api/custom/sync/run-phase - Run a specific phase
	// Accepts query params: year (required), phase (required)
	e.Router.POST("/api/custom/sync/run-phase", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
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
	e.Router.POST("/api/custom/sync/process-requests",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			// Parse optional session parameter (accepts "all" or a numeric cm_id)
			session := normalizeSession(e.Request.URL.Query().Get("session"))

			// Parse optional source_field parameter (comma-separated)
			sourceFields, invalidSourceField, validSourceFields := parseSourceFieldParameter(
				e.Request.URL.Query().Get("source_field"),
			)
			if !validSourceFields {
				return e.JSON(http.StatusBadRequest, map[string]any{
					"error": fmt.Sprintf(
						"Invalid source_field: %s. Valid options: "+
							"bunk_request_form, staff_not_bunk_with, bunking_notes, internal_notes, socialize_with",
						invalidSourceField),
				})
			}

			// Parse optional limit parameter
			limitParam := e.Request.URL.Query().Get("limit")
			limit := 0 // Default: no limit
			if limitParam != "" {
				if l, err := strconv.Atoi(limitParam); err == nil && l > 0 {
					limit = l
				} else {
					return e.JSON(http.StatusBadRequest, map[string]any{
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

			// Parse optional collect_traces parameter
			collectTracesParam := e.Request.URL.Query().Get("collect_traces")
			collectTraces := collectTracesParam == boolTrueStr || collectTracesParam == "1"

			// Create processor with all options
			processor := NewRequestProcessor(app)
			processor.Session = session
			processor.Limit = limit
			processor.Force = force
			processor.SourceFields = sourceFields
			processor.Debug = debug
			processor.Trace = trace
			processor.CollectTraces = collectTraces

			// Mark as running in orchestrator for frontend status tracking
			orchestrator := scheduler.GetOrchestrator()
			if err := orchestrator.MarkSyncRunning("process_requests"); err != nil {
				return e.JSON(http.StatusConflict, map[string]any{
					"error":    err.Error(),
					"status":   "running",
					"syncType": "process_requests",
				})
			}

			// Run in background with panic recovery
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), getProcessRequestsTimeout())
				defer cancel()

				defer func() {
					if r := recover(); r != nil {
						slog.Error("process_requests panicked", "panic", r)
						orchestrator.FinalizeSyncStatus("process_requests", Stats{}, fmt.Errorf("panic: %v", r))
					}
				}()

				slog.Info("Starting process_requests sync",
					"session", session,
					"source_fields", sourceFields,
					"limit", limit,
					"force", force,
					"debug", debug,
					"trace", trace,
					"collect_traces", collectTraces,
				)
				syncErr := processor.Sync(ctx)
				orchestrator.FinalizeSyncStatus("process_requests", processor.GetStats(), syncErr)
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
	e.Router.GET("/api/custom/sync/test-connection",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleTestConnection(e, scheduler)
		}))

	// Individual sync endpoints
	// Sessions sync
	e.Router.POST("/api/custom/sync/sessions", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "sessions")
	}))

	// Attendees sync
	e.Router.POST("/api/custom/sync/attendees", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "attendees")
	}))

	// Persons sync
	e.Router.POST("/api/custom/sync/persons", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "persons")
	}))

	// Bunks sync
	e.Router.POST("/api/custom/sync/bunks", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "bunks")
	}))

	// Bunk plans sync
	e.Router.POST("/api/custom/sync/bunk-plans", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "bunk_plans")
	}))

	// Bunk assignments sync
	e.Router.POST("/api/custom/sync/bunk-assignments",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleIndividualSync(e, scheduler, "bunk_assignments")
		}))

	// Bunk requests sync
	e.Router.POST("/api/custom/sync/bunk-requests", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "bunk_requests")
	}))

	// Session groups sync
	e.Router.POST("/api/custom/sync/session-groups", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "session_groups")
	}))

	// Multi-workbook export endpoint (per-year workbooks)
	e.Router.POST("/api/custom/sync/multi-workbook-export",
		requirePermission("sheets.export", func(e *core.RequestEvent) error {
			return handleMultiWorkbookExport(e, scheduler)
		}))

	// Person tag definitions sync
	e.Router.POST("/api/custom/sync/person-tag-defs",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleIndividualSync(e, scheduler, "person_tag_defs")
		}))

	// Note: households and person_tags are now part of the combined "persons" sync
	// and no longer have separate endpoints

	// Custom field definitions sync
	e.Router.POST("/api/custom/sync/custom-field-defs",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleIndividualSync(e, scheduler, "custom_field_defs")
		}))

	// Divisions sync (division definitions - runs in daily sync before persons)
	e.Router.POST("/api/custom/sync/divisions", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "divisions")
	}))

	// Staff lookups sync (global: positions, org_categories, program_areas - runs in weekly sync)
	e.Router.POST("/api/custom/sync/staff-lookups", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "staff_lookups")
	}))

	// Staff sync (year-scoped staff records - runs in daily sync)
	e.Router.POST("/api/custom/sync/staff", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleIndividualSync(e, scheduler, "staff")
	}))

	// Financial lookups sync (global: financial_categories, payment_methods - runs in weekly sync)
	e.Router.POST("/api/custom/sync/financial-lookups",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleIndividualSync(e, scheduler, "financial_lookups")
		}))

	// Financial transactions sync (year-scoped - runs in daily sync)
	// Accepts optional ?year=YYYY parameter for historical data sync
	e.Router.POST("/api/custom/sync/financial-transactions",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleFinancialTransactionsSync(e, scheduler)
		}))

	// On-demand sync endpoints (require N API calls - one per entity)
	// Person custom values sync
	// Accepts optional ?session=X parameter (0 or empty = all, 1-4 = specific session)
	e.Router.POST("/api/custom/sync/person-custom-values",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handlePersonCustomFieldValuesSync(e, scheduler)
		}))

	// Household custom values sync
	// Accepts optional ?session=X parameter (0 or empty = all, 1-4 = specific session)
	e.Router.POST("/api/custom/sync/household-custom-values",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleHouseholdCustomFieldValuesSync(e, scheduler)
		}))

	// Family camp derived tables sync
	// Computes derived tables from person/household custom values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/family-camp-derived",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleFamilyCampDerivedSync(e, scheduler)
		}))

	// Lodging assignments sync
	// Derives lodging_assignments from the CampMinder cabin custom fields
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/lodging-assignments",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleLodgingAssignmentsSync(e, scheduler)
		}))

	// Staff skills sync
	// Extracts Skills- fields from person_custom_values into normalized table
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/staff-skills", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleStaffSkillsSync(e, scheduler)
	}))

	// Financial aid applications sync
	// Extracts FA- fields from person_custom_values into structured application records
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/financial-aid-applications",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleFinancialAidApplicationsSync(e, scheduler)
		}))

	// Household demographics sync
	// Computes demographics from HH- custom values + household custom values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/household-demographics",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleHouseholdDemographicsSync(e, scheduler)
		}))

	// Camper dietary sync
	// Extracts Family Medical-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/camper-dietary", requirePermission("bunking.manage", func(e *core.RequestEvent) error {
		return handleCamperDietarySync(e, scheduler)
	}))

	// Camper transportation sync
	// Extracts BUS-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/camper-transportation",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleCamperTransportationSync(e, scheduler)
		}))

	// Quest registrations sync
	// Extracts Quest-*/Q-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/quest-registrations",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleQuestRegistrationsSync(e, scheduler)
		}))

	// Staff applications sync
	// Extracts App-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/staff-applications",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleStaffApplicationsSync(e, scheduler)
		}))

	// Staff vehicle info sync
	// Extracts SVI-* fields from person_custom_values
	// Accepts required ?year=YYYY parameter
	e.Router.POST("/api/custom/sync/staff-vehicle-info",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleStaffVehicleInfoSync(e, scheduler)
		}))

	// Normalize geographic data sync
	// Normalizes state/country names in attendees table using normalized_mappings
	e.Router.POST("/api/custom/sync/normalize-geographic",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleIndividualSync(e, scheduler, "normalize_geographic")
		}))

	// Enrollment snapshots sync
	// Captures daily enrollment counts per session
	e.Router.POST("/api/custom/sync/enrollment-snapshots",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleIndividualSync(e, scheduler, "enrollment_snapshots")
		}))

	// Stranded assignment cleanup sync
	// Auto-unassigns scenario-draft campers stranded by bunk-plan changes.
	// PocketBase-only — no CampMinder API call.
	e.Router.POST("/api/custom/sync/stranded-assignment-cleanup",
		requirePermission("bunking.manage", func(e *core.RequestEvent) error {
			return handleIndividualSync(e, scheduler, "stranded_assignment_cleanup")
		}))

	return nil
}

// handleIndividualSync handles running a single sync job
// Returns 202 Accepted if enqueued, 200 OK if started immediately
func handleIndividualSync(e *core.RequestEvent, scheduler *Scheduler, syncType string) error {
	orchestrator := scheduler.GetOrchestrator()

	// Check if already running
	if orchestrator.IsRunning(syncType) {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse debug parameter
	debugParam := e.Request.URL.Query().Get("debug")
	debug := debugParam == boolTrueStr || debugParam == "1"

	// If debug is enabled, set it on the service (if it supports Debuggable interface)
	if debug {
		if service := orchestrator.GetService(syncType); service != nil {
			if debuggable, ok := service.(Debuggable); ok {
				debuggable.SetDebug(true)
				slog.Info("Debug logging enabled for sync", "syncType", syncType)
			}
		}
	}

	// Get current year from environment
	currentYear, err := ParseSeasonYear()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
	}

	// Get user info for queue tracking
	requestedBy := ""
	if e.Auth != nil {
		requestedBy = e.Auth.GetString("email")
	}

	// Check if any sync should cause queueing:
	// 1. Sequence flags (daily/weekly/historical/custom-values) - cover the window between
	//    sequence start and first job execution (before runningJobs is populated)
	// 2. IsAnyJobRunning() - covers individual jobs that were started outside a sequence
	if orchestrator.IsDailySyncRunning() || orchestrator.IsWeeklySyncRunning() ||
		orchestrator.IsHistoricalSyncRunning() || orchestrator.IsCustomValuesSyncRunning() ||
		orchestrator.IsAnyJobRunning() {
		// Queue the individual sync with debug flag
		qs, err := orchestrator.EnqueueIndividualSync(currentYear, syncType, nil, debug, requestedBy)
		if err != nil {
			return e.JSON(http.StatusConflict, map[string]any{
				"error": err.Error(),
			})
		}

		// Successfully queued - return 202 Accepted
		position := orchestrator.GetQueuePositionByID(qs.ID)
		return e.JSON(http.StatusAccepted, map[string]any{
			"status":   "queued",
			"queue_id": qs.ID,
			"position": position,
			"syncType": syncType,
			"debug":    debug,
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

		// Reset debug flag after sync completes
		if debug {
			if service := orchestrator.GetService(syncType); service != nil {
				if debuggable, ok := service.(Debuggable); ok {
					debuggable.SetDebug(false)
				}
			}
		}

		// Process queue after individual sync completes
		processQueuedSyncs(orchestrator)
	}()

	return e.JSON(http.StatusOK, map[string]any{
		"message":  fmt.Sprintf("%s sync started", syncType),
		"status":   "started",
		"syncType": syncType,
		"debug":    debug,
	})
}

// handleRefreshBunking triggers a full bunking refresh: bunks -> bunk_plans -> bunk_assignments
func handleRefreshBunking(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Check if any bunking-related sync is already running
	for _, job := range GetRefreshBunkingJobs() {
		if orchestrator.IsRunning(job) {
			return e.JSON(http.StatusConflict, map[string]any{
				"error":  "Bunking sync already in progress",
				"status": "running",
			})
		}
	}

	// Run bunks -> bunk_plans -> bunk_assignments sequentially
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		if err := orchestrator.RunSyncSequence(ctx, GetRefreshBunkingJobs()); err != nil {
			e.App.Logger().Error("Refresh bunking failed", "error", err)
		}
	}()

	return e.JSON(http.StatusOK, map[string]any{
		"message": "Bunking refresh started (bunks, plans, assignments)",
		"status":  "started",
	})
}

// handleRefreshFamilyCamp triggers a full family-camp housing refresh: attendees ->
// persons -> person_custom_values_family_camp -> household_custom_values_family_camp
// -> family_camp_derived -> lodging_assignments (kindred#2478).
//
// The timeout is 25 minutes, not handleRefreshBunking's 10: measured against
// sync_runs (production snapshot 2026-08-23, status='success'), this chain averages
// 13m31s and has been seen at 17m39s — almost entirely the two bounded custom-values
// jobs. 25 minutes leaves headroom above the worst observed run without risking a
// truncated timeout on an ordinary one.
func handleRefreshFamilyCamp(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Check if any family-camp-refresh-related sync is already running.
	//
	// Collection-group-aware (kindred#2491 Face A), not a plain IsRunning(job) over the six
	// literal names: "person_custom_values_family_camp" and
	// "household_custom_values_family_camp" write the same PocketBase collections as the
	// unrestricted "person_custom_values" / "household_custom_values" jobs under different
	// registered names (kindred#2489), so the literal check does not see the weekly sweep --
	// or an operator's on-demand custom-values run -- as a writer of what this chain is about
	// to rewrite. runSingleSyncInternal blocks the bounded job anyway, so the cost of missing
	// it here is not a data race but a worse failure: this handler answers 200 "started",
	// attendees and persons run, and then the sequence aborts before family_camp_derived and
	// lodging_assignments -- leaving the board on yesterday's cabins while the operator has
	// been told the refresh began. For the four jobs outside the group map this is exactly
	// the check IsRunning makes.
	for _, job := range GetRefreshFamilyCampJobs() {
		if orchestrator.IsCustomValuesCollectionRunning(job) {
			return e.JSON(http.StatusConflict, map[string]any{
				"error":  "Family camp refresh already in progress",
				"status": "running",
			})
		}
	}

	// Run attendees -> persons -> person_custom_values_family_camp ->
	// household_custom_values_family_camp -> family_camp_derived -> lodging_assignments
	// sequentially.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
		defer cancel()

		if err := orchestrator.RunSyncSequence(ctx, GetRefreshFamilyCampJobs()); err != nil {
			e.App.Logger().Error("Refresh family camp failed", "error", err)
		}
	}()

	return e.JSON(http.StatusOK, map[string]any{
		"message": "Family camp housing refresh started (attendees, persons, custom values, derived, lodging assignments)",
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
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("error reading form data")
		}

		if part.FormName() == "file" {
			result.filename = part.FileName()
			// Limit CSV upload to 50MB to prevent OOM from oversized uploads
			const maxCSVSize = 50 * 1024 * 1024
			limitedReader := io.LimitReader(part, maxCSVSize+1)
			result.data, err = io.ReadAll(limitedReader)
			if err != nil {
				_ = part.Close()
				return nil, fmt.Errorf("error reading CSV file")
			}
			if len(result.data) > maxCSVSize {
				_ = part.Close()
				return nil, fmt.Errorf("CSV file exceeds maximum size of 50MB")
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
func determineUploadYear(yearParam string) (int, error) {
	uploadYear, err := ParseSeasonYear()
	if err != nil {
		return 0, fmt.Errorf("year resolution failed: %w", err)
	}
	if yearParam != "" {
		if y, err := strconv.Atoi(yearParam); err == nil && ValidSyncYear(y) {
			uploadYear = y
		}
	}
	return uploadYear, nil
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
		return e.JSON(http.StatusBadRequest, map[string]any{"error": "Invalid multipart form"})
	}

	// Read and validate CSV from form
	uploadResult, err := readCSVFromMultipart(form)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"error": err.Error()})
	}

	// Parse and validate CSV headers
	headers, err := parseAndValidateCSV(uploadResult.data)
	if err != nil {
		slog.Error("CSV parsing error", "error", err)
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error":     err.Error(),
			"details":   "Please ensure the file is a valid CSV with comma-separated values",
			"file_size": len(uploadResult.data),
		})
	}
	slog.Info("CSV headers found", "headers", headers)

	// Check required columns
	requiredColumns := []string{"PersonID", "Last Name", "First Name"}
	if missing := findMissingColumns(headers, requiredColumns); len(missing) > 0 {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error":            "Missing required columns",
			"missing_columns":  missing,
			"found_columns":    headers,
			"required_columns": requiredColumns,
		})
	}

	// Determine upload year and save file
	uploadYear, err := determineUploadYear(e.Request.URL.Query().Get("year"))
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
	}
	csvDir := filepath.Join(scheduler.app.DataDir(), "bunk_requests")

	latestPath, err := saveCSVWithBackup(csvDir, uploadYear, uploadResult.data)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"error": err.Error()})
	}
	slog.Info("CSV file saved", "year", uploadYear, "path", latestPath)

	// Update metadata
	metadata := map[string]any{
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

				// Run bunk_requests sync first and wait for completion. A CSV upload is an
				// operator action, so this is a manual batch of one.
				syncErr := orchestrator.runSyncAndWait(ctx, "bunk_requests", newBatch(triggerManual))
				if syncErr != nil {
					slog.Warn("Error running bunk_requests sync", "error", syncErr)
					return // Don't run process_requests if sync failed
				}

				// Chain process_requests after bunk_requests completes
				if runProcessRequests {
					slog.Info("Chaining process_requests after bunk_requests sync")
					if markErr := orchestrator.MarkSyncRunning("process_requests"); markErr != nil {
						slog.Warn("Could not mark process_requests running (may already be running)", "error", markErr)
					} else {
						// Fresh context — don't share the upload's shorter timeout
						processCtx, processCancel := context.WithTimeout(context.Background(), getProcessRequestsTimeout())
						defer processCancel()

						processor := NewRequestProcessor(scheduler.app)
						// Clear existing bunk_requests for reprocessed persons/fields
						// to avoid unique constraint violations on re-upload
						processor.ClearExisting = true
						// Always collect pipeline traces for CSV uploads
						processor.CollectTraces = true
						processor.Trigger = "upload"

						// Panic recovery — matches /process-requests endpoint pattern
						defer func() {
							if r := recover(); r != nil {
								slog.Error("process_requests panicked", "panic", r)
								orchestrator.FinalizeSyncStatus("process_requests", Stats{}, fmt.Errorf("panic: %v", r))
							}
						}()

						// No force (intake handles processed flags), but clear_existing
						// is set above to avoid unique constraint collisions on re-upload
						procErr := processor.Sync(processCtx)
						orchestrator.FinalizeSyncStatus("process_requests", processor.GetStats(), procErr)
					}
				}
			}()
		}
	}

	return e.JSON(http.StatusOK, map[string]any{
		"message":                  "CSV uploaded successfully",
		"filename":                 uploadResult.filename,
		"header_count":             len(headers),
		"sync_started":             runSync,
		"process_requests_started": processRequestsStarted,
		"year":                     uploadYear,
	})
}

// resolveServiceStatuses answers for every service, preferring live orchestrator state and
// falling back to the last run recorded in `sync_runs`.
//
// The fallback is the read half of kindred#2284. lastCompletedStatus is wiped on every
// container restart — that is why the table was created — but nothing read it back, so this
// endpoint reported every service `idle` after a restart with a full history on disk. The app
// shell renders its freshness lines off `end_time` ("Assignments synced …" on summer,
// "Housing synced …" on weekend), so those lines vanished entirely rather than going stale,
// until the next sync repopulated memory. A mid-morning deploy meant no freshness readout
// until the 3am cron.
//
// PRECEDENCE IS LIVE-FIRST AND IT MATTERS: memory is the only source that knows about a run
// happening right now, and the table only ever holds completed runs. Reading the table first
// would replace a `running` job with its previous completion and stall the client's polling.
//
// The history is fetched ONCE for the whole loop rather than per service — see
// LastRecordedRuns, which also explains why this does not live inside GetStatus.
func resolveServiceStatuses(orchestrator *Orchestrator, syncTypes []string) map[string]any {
	recorded := orchestrator.LastRecordedRuns()

	statuses := make(map[string]any, len(syncTypes))
	for _, syncType := range syncTypes {
		// ONE GetStatus call per service, held in a local. Calling it twice — once to test
		// and once to use — takes the status mutex twice and leaves a window in which a run
		// can finish between them, so the test and the value disagree.
		live := orchestrator.GetStatus(syncType)
		switch {
		case live != nil:
			statuses[syncType] = live
		case recorded[syncType] != nil:
			statuses[syncType] = recorded[syncType]
		default:
			// Never run, or pruned past the retention window. Genuinely nothing to say.
			statuses[syncType] = map[string]string{
				"status": "idle",
			}
		}
	}
	return statuses
}

// statusSyncTypes returns every job the sync-status payload reports on.
//
// Derived from the registry, because the failure mode of a hand-written list here is severe
// and has happened twice: the two bounded family-camp jobs were absent, so useSyncStatusAPI
// saw nothing running during a 13-minute refresh, stopped polling, and could never detect the
// cutover (kindred#2591); reconcile_request_lifecycle was absent, so its dashboard row read
// "idle" while it ran (kindred#2593). The payload is what the client can SEE.
//
// A job missing from this list has no per-job status the client can read, and on a FLAG-LESS
// run path that is fatal to polling: useSyncStatusAPI's refetchInterval keeps polling while
// `_daily_sync_running`/`_historical_sync_running` is set OR some per-job entry reports
// running/pending. RunDailySync and RunSyncWithOptions hold one of those flags throughout, so
// a job missing here merely reads "idle" on the dashboard. RunSyncSequence -- the Refresh
// Housing and Refresh Bunking path -- sets NO flag, so there the per-job entry is the only
// signal, and a job absent from this list means polling stops mid-run and the completion is
// never detected.
//
// Necessary, not sufficient, for a job to SHOW in the admin sync UI: SyncTab renders cards
// from the frontend's own hand-maintained list (YEAR_SYNC_TYPES in
// frontend/src/components/admin/syncTypes.ts) and useSyncCompletionToasts iterates
// SYNC_DISPLAY_NAMES, neither of which is derived from this payload. Publishing a job here
// fixes polling and completion detection; giving it a card is a separate edit -- one
// syncTypes.test.ts pins against this function via the registry (see
// frontend/src/test/backendSyncJobIds.ts).
//
// Order is registry declaration order, NOT execution order, and nothing observes it: the
// payload is a JSON object keyed by job name (see handleSyncStatus), so the sequence does not
// survive serialization at all -- the client reads entries by key. The frontend coverage tests
// that compare this list against their own sort both sides first. getDailySyncJobs
// additionally applies orderQueue, which is why stranded_assignment_cleanup runs last there
// but is listed mid-Transform here.
func statusSyncTypes() []string { return allJobIDs() }

// handleSyncStatus returns the status of all sync jobs
func handleSyncStatus(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Get status of all known sync types. The payload is a JSON object keyed by job
	// name, so this order is documentation rather than protocol -- it is kept aligned
	// with getDailySyncJobs so the list reads as the sequence it describes.
	// Note: "persons" is a combined sync that populates persons, households, AND person_tags
	// tables from a single API call - there are no separate households or person_tags syncs
	syncTypes := statusSyncTypes()

	statuses := resolveServiceStatuses(orchestrator, syncTypes)

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
	configuredYear, err := ParseSeasonYear()
	if err != nil {
		configuredYear = time.Now().Year()
	}
	statuses["_configured_year"] = configuredYear

	// Add bunk requests CSV upload metadata if a CSV has ever been uploaded.
	// Read failures are logged but not surfaced — the absence of this field is
	// indistinguishable from "no upload yet" on the frontend, which is the
	// correct fallback either way.
	if meta, err := readBunkRequestsUploadMetadata(scheduler.app.DataDir()); err != nil {
		slog.Warn("Failed to read bunk_requests upload metadata", "error", err)
	} else if meta != nil {
		statuses["_bunk_requests_upload"] = meta
	}

	// Add queue info
	queue := orchestrator.GetQueuedSyncs()
	queueInfo := make([]map[string]any, len(queue))
	for i, qs := range queue {
		queueInfo[i] = map[string]any{
			"id":                    qs.ID,
			"year":                  qs.Year,
			"type":                  qs.Type, // "unified", "phase", "individual"
			"service":               qs.Service,
			"include_custom_values": qs.IncludeCustomValues,
			"dry_run":               qs.DryRun,
			"position":              i + 1, // 1-based position
			"queued_at":             qs.QueuedAt.Format(time.RFC3339),
		}
	}
	statuses["_queue"] = queueInfo
	statuses["_queue_length"] = len(queue)

	// Add current run progress (remaining jobs in current sequence)
	runType, remaining, total, completed := orchestrator.GetCurrentRunProgress()
	if runType != "" {
		statuses["_current_run"] = map[string]any{
			"type":           runType,
			"total_jobs":     total,
			"completed_jobs": completed,
			"remaining_jobs": remaining,
		}
	}

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
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter",
		})
	}

	// Bounded at both ends. An unbounded upper end is not permissive, it is a silent
	// failure: ?year=99999 was accepted, and then every sync_runs row of that run failed the
	// column's max check and was swallowed by the write path's slog.Error — a green sync and
	// an empty table.
	//
	// ValidSyncYear is the single spelling of that range for every year-taking handler in
	// this file. The one deliberate exception is handleFinancialTransactionsSync, which caps
	// at the current year for a reason stated at the site. (Five service-level validators in
	// sync/ still say 2017-2099 by hand; they are unreachable above 2050 because the
	// handlers reject first, so they are left alone rather than widened here.)
	year, err := strconv.Atoi(yearStr)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Parse service parameter (default: all)
	service := e.Request.URL.Query().Get("service")
	if service == "" {
		service = DefaultService
	}

	// Get current year from environment
	currentYear, yerr := ParseSeasonYear()
	if yerr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"error": yerr.Error()})
	}

	// Parse optional query parameters
	includeCustomValuesParam := e.Request.URL.Query().Get("includeCustomValues")
	includeCustomValues := includeCustomValuesParam == boolTrueStr || includeCustomValuesParam == "1"

	debugParam := e.Request.URL.Query().Get("debug")
	debug := debugParam == boolTrueStr || debugParam == "1"

	// dry_run=true must compute without writing, on both the immediate path below and the
	// queued one (EnqueueUnifiedSync / processQueuedSyncs's "unified" case). Before this fix
	// the parameter was parsed nowhere in this handler at all: it was accepted, echoed
	// nowhere, and discarded, so a documented dry-run request performed a real write
	// (kindred#2334).
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Get user info for queue tracking
	requestedBy := ""
	if e.Auth != nil {
		requestedBy = e.Auth.GetString("email")
	}

	// Reject an unknown or cron-only ?service= up front, before either the immediate or the
	// queued path can start. ResolveUnifiedSyncServices returns nil -- distinct from empty --
	// for a service the registry does not declare as individually routable, and that must be a
	// 400: resolving it to a run of nothing would answer 200 for a sync that never happens, and
	// passing it through (what this endpoint did until Stage 3) starts a real run of a job with
	// no route, or of a service that does not exist at all.
	services := ResolveUnifiedSyncServices(service, includeCustomValues, year == currentYear)
	if services == nil {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Unknown sync service: %s", service),
		})
	}

	orchestrator := scheduler.GetOrchestrator()

	// Reject up front, before either the immediate or the queued path can start, if dry_run
	// was requested against a service that cannot honor it. This must happen synchronously
	// here: both paths below do their real work in a goroutine after the response is already
	// sent, so a check placed inside RunSyncWithOptions would only ever produce a background
	// log line, never the 400 an operator actually needs to see (kindred#2334's ruled fix
	// direction is "either honor it or reject the request", never a silent partial write).
	if dryRun {
		if unsupported := orchestrator.UnsupportedDryRunServices(services); len(unsupported) > 0 {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": fmt.Sprintf("dry_run is not supported for: %s",
					strings.Join(unsupported, ", ")),
				"unsupported_services": unsupported,
			})
		}
	}

	// Check if any sync is already running.
	// Check all sync flags to prevent race conditions (e.g., when global sync triggers first)
	if orchestrator.IsDailySyncRunning() || orchestrator.IsWeeklySyncRunning() ||
		orchestrator.IsHistoricalSyncRunning() || orchestrator.IsCustomValuesSyncRunning() ||
		orchestrator.IsAnyJobRunning() {
		// Sync is running - try to enqueue
		qs, err := orchestrator.EnqueueUnifiedSync(year, service, includeCustomValues, debug, dryRun, requestedBy)
		if err != nil {
			// Queue is full
			return e.JSON(http.StatusConflict, map[string]any{
				"error": err.Error(),
			})
		}

		// Successfully queued - return 202 Accepted. dry_run is echoed from the stored queue
		// item (qs.DryRun), not the local dryRun variable, so a duplicate request that
		// deduped onto an existing item reports what that item will actually do.
		position := orchestrator.GetQueuePositionByID(qs.ID)
		return e.JSON(http.StatusAccepted, map[string]any{
			"status":              "queued",
			"queue_id":            qs.ID,
			"position":            position,
			"year":                year,
			"service":             service,
			"includeCustomValues": includeCustomValues,
			"debug":               debug,
			"dry_run":             qs.DryRun,
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
		DryRun:              dryRun,
	}

	// Set services to sync. services was already resolved above (and validated non-nil), and
	// for the named-service branch ResolveUnifiedSyncServices returns exactly []string{service}
	// -- reuse it rather than rebuilding the same one-element slice a second time.
	if service != DefaultService {
		opts.Services = services
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
			"dry_run", dryRun,
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

	return e.JSON(http.StatusOK, map[string]any{
		"message":             "Sync started",
		"year":                year,
		"service":             service,
		"includeCustomValues": includeCustomValues,
		"debug":               debug,
		"dry_run":             dryRun,
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
		jobs := phaseExecutionJobs(phase)
		slog.Info("Queued phase sync: Running jobs",
			"phase", phase, "year", qs.Year, "jobs", jobs, "debug", qs.Debug)

		// The phase's jobs are one queue and so one batch, filed under the year the
		// operator asked for. currentSyncYear below is process-global and only feeds
		// GetStatus's "pending" rendering; the runs themselves take their year from here.
		batch := newBatch(triggerManual).forYear(qs.Year)

		// Set the current sync year so services use correct year
		orchestrator.mu.Lock()
		orchestrator.currentSyncYear = qs.Year
		orchestrator.mu.Unlock()

		defer func() {
			orchestrator.mu.Lock()
			orchestrator.currentSyncYear = 0
			orchestrator.mu.Unlock()
		}()

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

			// Set year and debug on the service before running
			if svc := orchestrator.GetService(jobID); svc != nil {
				// Set year so service queries correct year's data
				if yearSetter, ok := svc.(YearSetter); ok {
					yearSetter.SetYear(qs.Year)
				}
				// Set debug if requested
				if qs.Debug {
					if debuggable, ok := svc.(Debuggable); ok {
						debuggable.SetDebug(true)
						slog.Info("Queued phase sync: debug enabled for job", "job", jobID)
					}
				}
			}

			slog.Info("Queued phase sync: Running job", "phase", phase, "job", jobID, "year", qs.Year)
			if err := orchestrator.runSyncAndWait(ctx, jobID, batch); err != nil {
				slog.Error("Queued phase sync: job failed",
					"phase", phase, "job", jobID, "error", err)
				// Continue with next job even if one fails
			}

			// Clear debug flag after job completes
			if qs.Debug {
				if svc := orchestrator.GetService(jobID); svc != nil {
					if debuggable, ok := svc.(Debuggable); ok {
						debuggable.SetDebug(false)
					}
				}
			}
		}
		slog.Info("Queued phase sync completed", "id", qs.ID, "phase", phase, "year", qs.Year)

	case "individual":
		// Run single job
		slog.Info("Queued individual sync: Running job", "job", qs.Service, "year", qs.Year, "debug", qs.Debug)

		// Set year and debug on the service before running
		if svc := orchestrator.GetService(qs.Service); svc != nil {
			// Set year so service queries correct year's data
			if yearSetter, ok := svc.(YearSetter); ok {
				yearSetter.SetYear(qs.Year)
			}
			// Set debug if requested
			if qs.Debug {
				if debuggable, ok := svc.(Debuggable); ok {
					debuggable.SetDebug(true)
					slog.Info("Queued individual sync: debug enabled", "job", qs.Service)
				}
			}
		}

		origin := newBatch(triggerManual).forYear(qs.Year)
		if err := orchestrator.runSyncAndWait(ctx, qs.Service, origin); err != nil {
			slog.Error("Queued individual sync failed",
				"id", qs.ID, "job", qs.Service, "year", qs.Year, "error", err)
		} else {
			slog.Info("Queued individual sync completed",
				"id", qs.ID, "job", qs.Service, "year", qs.Year)
		}

		// Clear debug flag after job completes
		if qs.Debug {
			if svc := orchestrator.GetService(qs.Service); svc != nil {
				if debuggable, ok := svc.(Debuggable); ok {
					debuggable.SetDebug(false)
				}
			}
		}

	case "unified", "":
		// Empty type for backward compatibility with existing queued items
		// Determine year mode — currentYear only needed here
		currentYear, err := ParseSeasonYear()
		if err != nil {
			slog.Error("Year resolution failed for unified sync", "error", err)
			break
		}
		optsYear := qs.Year
		if qs.Year == currentYear {
			optsYear = 0 // Current year mode
		}

		// Create sync options. DryRun: qs.DryRun is the queued path's half of kindred#2334 --
		// EnqueueUnifiedSync stored the operator's dry_run request on the queue item, and this
		// is where it has to survive into the actual run or the flag is lost between the 202
		// response and the write.
		opts := Options{
			Year:                optsYear,
			IncludeCustomValues: qs.IncludeCustomValues,
			Debug:               qs.Debug,
			DryRun:              qs.DryRun,
		}

		// Set services to sync
		if qs.Service != DefaultService {
			opts.Services = []string{qs.Service}
		}

		if err := orchestrator.RunSyncWithOptions(ctx, opts); err != nil {
			slog.Error("Queued unified sync failed",
				"id", qs.ID, "year", qs.Year, "service", qs.Service, "dry_run", qs.DryRun, "error", err)
		} else {
			slog.Info("Queued unified sync completed",
				"id", qs.ID, "year", qs.Year, "service", qs.Service, "dry_run", qs.DryRun)
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
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing queue ID",
		})
	}

	orchestrator := scheduler.GetOrchestrator()

	// Try to cancel the queued sync
	if !orchestrator.CancelQueuedSync(id) {
		return e.JSON(http.StatusNotFound, map[string]any{
			"error": "Queued sync not found",
			"id":    id,
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"message": "Queued sync canceled",
		"id":      id,
	})
}

// handleCancelRunningSync handles canceling the currently running sync
func handleCancelRunningSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Try to cancel the running sync
	if !orchestrator.CancelRunningSync() {
		return e.JSON(http.StatusNotFound, map[string]any{
			"error": "No sync currently running",
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"message": "Running sync canceled",
	})
}

// handleHourlySync triggers the hourly sync sequence
func handleHourlySync(e *core.RequestEvent, scheduler *Scheduler) error {
	// Check if hourly sync is already running
	if scheduler.IsHourlySyncRunning() {
		return e.JSON(http.StatusConflict, map[string]any{
			"error": "Hourly sync already in progress",
		})
	}

	// Trigger hourly sync
	scheduler.TriggerHourlySync()

	return e.JSON(http.StatusOK, map[string]any{
		"message": "Hourly sync triggered",
	})
}

// handleWeeklySync triggers the weekly sync sequence (global data jobs)
func handleWeeklySync(e *core.RequestEvent, scheduler *Scheduler) error {
	// Check if weekly sync is already running
	if scheduler.IsWeeklySyncRunning() {
		return e.JSON(http.StatusConflict, map[string]any{
			"error": "Weekly sync already in progress",
		})
	}

	// Trigger weekly sync
	scheduler.TriggerWeeklySync()

	return e.JSON(http.StatusOK, map[string]any{
		"message":  "Weekly sync triggered",
		"services": GetWeeklySyncJobs(),
	})
}

// handleCustomValuesSync triggers the custom values sync (person + household custom field values)
func handleCustomValuesSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Check if custom values sync is already running. Collection-group-aware (kindred#2491
	// Face A): the daily cron's bounded family-camp jobs ("person_custom_values_family_camp",
	// "household_custom_values_family_camp" -- kindred#2489) write these exact same
	// collections under different registered names, so a check against only the two literal
	// unrestricted names missed them.
	if orchestrator.IsCustomValuesCollectionRunning("person_custom_values") ||
		orchestrator.IsCustomValuesCollectionRunning("household_custom_values") {
		return e.JSON(http.StatusConflict, map[string]any{
			"error": "Custom values sync already in progress",
		})
	}

	// Trigger custom values sync
	scheduler.TriggerCustomValuesSync()

	return e.JSON(http.StatusOK, map[string]any{
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
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error": "Failed to query available years",
		})
	}

	// Get current year from environment
	currentYear, err := ParseSeasonYear()
	if err != nil {
		currentYear = time.Now().Year()
	}

	return e.JSON(http.StatusOK, map[string]any{
		"current":   currentYear,
		"available": years,
	})
}

// handleTestConnection tests the CampMinder client connection
func handleTestConnection(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()

	// Get the base client
	if orchestrator.baseClient == nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error": "CampMinder client not initialized",
			"hint":  "Check that CAMPMINDER_API_KEY, CAMPMINDER_CLIENT_ID, and CAMPMINDER_SEASON_ID are set",
		})
	}

	// Test authentication by making a simple API call
	// We'll use GetSessions as it's a read-only operation
	sessions, err := orchestrator.baseClient.GetSessions()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "CampMinder connection failed",
			"details": err.Error(),
			"hint":    "Check API credentials and network connectivity",
			"config": map[string]any{
				"client_id": orchestrator.baseClient.GetClientID(),
				"season_id": orchestrator.baseClient.GetSeasonID(),
			},
		})
	}

	// Success - return connection info
	return e.JSON(http.StatusOK, map[string]any{
		"status":  "connected",
		"message": "CampMinder client connection successful",
		"config": map[string]any{
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
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Google Sheets export is not enabled",
			"hint":  "Set GOOGLE_SHEETS_ENABLED=true and configure credentials",
		})
	}

	// Parse optional years parameter
	yearsParam := e.Request.URL.Query().Get("years")
	years, err := ParseExportYearsParam(yearsParam)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{
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

	// currentSeason anchors both the manual-years validation bound below and the default
	// branch's explicit SetYear below -- resolved via ParseSeasonYear(), the same clock
	// Sync()'s globals gate reads (m.year == currentSeason, multi_workbook_export.go), so the
	// two can never disagree. time.Now().Year() used to anchor this instead: it agrees with
	// ParseSeasonYear() in ordinary operation, which is exactly why that divergence went
	// unnoticed -- off-season, or while preparing next season (the ordinary reason
	// CAMPMINDER_SEASON_ID exists to differ from the wall clock), it sent this button the
	// wrong year's workbook and silently dropped globals. Fail closed, as every neighboring
	// path does (e.g. RunSingleSync), rather than falling back to the wall clock.
	currentSeason, err := ParseSeasonYear()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error": fmt.Sprintf("Cannot resolve current season: %v", err),
		})
	}

	// Validate years if provided
	if len(years) > 0 {
		if err := ValidateExportYears(years, currentSeason); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": err.Error(),
			})
		}
	}

	orchestrator := scheduler.GetOrchestrator()

	// Check if already running
	if orchestrator.IsRunning("multi_workbook_export") {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Multi-workbook export already in progress",
			"status":   "running",
			"syncType": "multi_workbook_export",
		})
	}

	// Get the service
	service := orchestrator.GetService("multi_workbook_export")
	multiExport, ok := service.(*MultiWorkbookExport)
	if !ok || multiExport == nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
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
			// Default: full export (globals + current year). multiExport is the orchestrator's
			// long-lived singleton, also reachable from other call sites that mutate one of
			// its fields and never reset it -- three generic YearSetter sites (a queued
			// "Run Phase -> Export", a queued individual run, the synchronous phase-run
			// handler) for year and the changed-collections filter, and RunSyncWithOptions'
			// dry-run loop for dryRun. This standalone button is none of those runs, so it
			// cannot assume the instance still holds what a plain click means.
			//
			// THE RULE, stated once so it does not have to be rediscovered a fourth time:
			// every field Sync() reads gets set explicitly, right here, in this one block.
			// This has been found the hard way three separate times -- year (fix round 2
			// Critical #3, TestHandleMultiWorkbookExportDefaultBranchResetsYear), the
			// changed-collections filter (fix round 2 Critical #3, ...ClearsFilter), and
			// dryRun (final-review Important I2, ...ResetsDryRun) -- and each was found in a
			// separate round because the first two fixes did not say this out loud.
			multiExport.SetYear(currentSeason)
			// nil means "export everything" (ChangedCollectionsAware's doc comment) -- spec
			// §5's one entry point that must mean it.
			multiExport.SetChangedCollections(nil)
			// A dry-run full sync's SetDryRun(true) must not silently skip this button's write.
			multiExport.SetDryRun(false)
			slog.Info("Starting multi-workbook export for current year", "year", currentSeason)
			if err := multiExport.Sync(ctx); err != nil {
				slog.Error("Multi-workbook export failed", "error", err)
			}
		}
	}()

	// Build response
	response := map[string]any{
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

	// Note: "already running" check is handled by RunSingleSyncWithService below,
	// which reserves the run and returns an error if the sync is already in progress

	// Parse session filter (accepts "all" or a numeric cm_id)
	session := normalizeSession(e.Request.URL.Query().Get("session"))

	// Validate session parameter
	if !IsValidSession(session) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Invalid session parameter. Must be 'all' or a numeric session cm_id.",
		})
	}

	// Parse debug parameter
	debugParam := e.Request.URL.Query().Get("debug")
	debug := debugParam == boolTrueStr || debugParam == "1"

	// Request-scoped instance — never the shared registered singleton. Mutating the
	// singleton let a rejected (409) request's SetSession stick before MarkSyncRunning ever
	// ran, silently narrowing whichever request was actually in flight (#2105).
	// RunSingleSyncWithService also reserves the run atomically, so the check-then-mutate gap
	// the old pattern had between GetService and MarkSyncRunning can't reopen.
	service := NewPersonCustomFieldValuesSync(e.App, orchestrator.BaseClient())
	service.SetSession(session)
	service.SetDebug(debug)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    err.Error(),
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting person_custom_values sync",
		"session", session,
		"debug", debug,
	)

	return e.JSON(http.StatusOK, map[string]any{
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

	// Note: "already running" check is handled by RunSingleSyncWithService below,
	// which reserves the run and returns an error if the sync is already in progress

	// Parse session filter (accepts "all" or a numeric cm_id)
	session := normalizeSession(e.Request.URL.Query().Get("session"))

	// Validate session parameter
	if !IsValidSession(session) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Invalid session parameter. Must be 'all' or a numeric session cm_id.",
		})
	}

	// Parse debug parameter
	debugParam := e.Request.URL.Query().Get("debug")
	debug := debugParam == boolTrueStr || debugParam == "1"

	// Request-scoped instance — never the shared registered singleton. Mutating the
	// singleton let a rejected (409) request's SetSession stick before MarkSyncRunning ever
	// ran, silently narrowing whichever request was actually in flight (#2105).
	// RunSingleSyncWithService also reserves the run atomically, so the check-then-mutate gap
	// the old pattern had between GetService and MarkSyncRunning can't reopen.
	service := NewHouseholdCustomFieldValuesSync(e.App, orchestrator.BaseClient())
	service.SetSession(session)
	service.SetDebug(debug)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    err.Error(),
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting household_custom_values sync",
		"session", session,
		"debug", debug,
	)

	return e.JSON(http.StatusOK, map[string]any{
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
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	// Parse optional year parameter for historical sync
	yearParam := e.Request.URL.Query().Get("year")
	year := 0 // Default: current year from env
	if yearParam != "" {
		// Deliberately stricter than ValidSyncYear at the top end, and the one handler here
		// that is: this backfills financial transactions FROM CampMinder, and a year that
		// has not happened has none. syncYearMax (2050) is a schema bound, not a claim that
		// 2049's ledger is fetchable. The floor stays shared.
		if y, err := strconv.Atoi(yearParam); err == nil && ValidSyncYear(y) && y <= time.Now().Year() {
			year = y
		} else {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": fmt.Sprintf("Invalid year parameter. Must be between %d and the current year.",
					syncYearMin),
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

		return e.JSON(http.StatusOK, map[string]any{
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

	return e.JSON(http.StatusOK, map[string]any{
		"message":  "Financial transactions sync started",
		"status":   "started",
		"syncType": syncType,
	})
}

// handleFamilyCampDerivedSync handles the family camp derived tables computation endpoint
// Accepts required ?year=YYYY parameter to compute derived tables for a specific year
func handleFamilyCampDerivedSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := serviceNameFamilyCampDerived

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewFamilyCampDerivedSync(e.App)
	service.Year = year
	service.DryRun = dryRun

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Family camp derived computation already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting family_camp_derived computation", "year", year, "dry_run", dryRun)

	return e.JSON(http.StatusOK, map[string]any{
		"message":  "Family camp derived computation started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
		"dry_run":  dryRun,
	})
}

// handleLodgingAssignmentsSync handles the lodging assignment ingest endpoint.
// Accepts a required ?year=YYYY parameter and an optional ?dry_run=true.
func handleLodgingAssignmentsSync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := serviceNameLodgingAssignments

	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}
	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewLodgingAssignmentsSync(e.App)
	service.Year = year
	service.DryRun = dryRun

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Lodging assignment ingest already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting lodging_assignments ingest", "year", year, "dry_run", dryRun)

	return e.JSON(http.StatusOK, map[string]any{
		"message":  "Lodging assignment ingest started",
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

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewStaffSkillsSync(e.App)
	service.Year = year
	service.DryRun = dryRun

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Staff skills sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting staff_skills extraction", "year", year, "dry_run", dryRun)

	return e.JSON(http.StatusOK, map[string]any{
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

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewFinancialAidApplicationsSync(e.App)
	service.Year = year
	service.DryRun = dryRun

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Financial aid applications sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting financial_aid_applications extraction", "year", year, "dry_run", dryRun)

	return e.JSON(http.StatusOK, map[string]any{
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

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Parse optional dry-run parameter
	dryRunParam := e.Request.URL.Query().Get("dry_run")
	dryRun := dryRunParam == boolTrueStr || dryRunParam == "1"

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewHouseholdDemographicsSync(e.App)
	service.Year = year
	service.DryRun = dryRun

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Household demographics computation already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting household_demographics computation", "year", year, "dry_run", dryRun)

	return e.JSON(http.StatusOK, map[string]any{
		"message":  "Household demographics computation started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
		"dry_run":  dryRun,
	})
}

// phaseExecutionJobs returns the jobs actually run for phase -- what handleRunPhase and
// processQueuedSyncs iterate, as opposed to GetJobsForPhase's classification list used for
// phase metadata in handleGetPhases (and pinned as including all four custom-values jobs by
// family_camp_daily_cadence_test.go's TestSyncJobMeta_ScopeFamilyCampJobsAreExpensivePhase).
//
// The difference is now declared per row (TriggerPhaseRun) rather than filtered here: the two
// bounded family-camp jobs carry no triggers at all, because the daily cron
// (getDailySyncJobs) covers them minutes earlier and an admin-triggered "Custom Values" phase
// run would otherwise re-fetch the identical, already-fresh family-camp cohort -- kindred
// #2491 Face C, measured at ~11.5 min of rate-limited CampMinder quota. GetJobsForPhase itself
// is untouched; only the execution list is filtered.
func phaseExecutionJobs(phase Phase) []string { return inPhaseWithTrigger(phase, TriggerPhaseRun) }

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

	return e.JSON(http.StatusOK, map[string]any{
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
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Parse required phase parameter
	phaseParam := e.Request.URL.Query().Get("phase")
	if phaseParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
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
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error":        "Invalid phase parameter",
			"valid_phases": []string{"source", "expensive", "transform", "process", "export"},
		})
	}

	// Get jobs for this phase
	jobs := phaseExecutionJobs(phase)
	if len(jobs) == 0 {
		return e.JSON(http.StatusBadRequest, map[string]any{
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

	// Check if any sync is already running (must match handleIndividualSync check)
	if orchestrator.IsDailySyncRunning() || orchestrator.IsWeeklySyncRunning() ||
		orchestrator.IsHistoricalSyncRunning() || orchestrator.IsCustomValuesSyncRunning() ||
		orchestrator.IsAnyJobRunning() {
		// Queue the phase sync instead of returning conflict (pass debug flag)
		qs, err := orchestrator.EnqueuePhaseSync(year, phase, debug, requestedBy)
		if err != nil {
			return e.JSON(http.StatusConflict, map[string]any{
				"error": err.Error(),
			})
		}

		// Successfully queued - return 202 Accepted
		position := orchestrator.GetQueuePositionByID(qs.ID)
		response := map[string]any{
			"status":   "queued",
			"queue_id": qs.ID,
			"position": position,
			"phase":    string(phase),
			"year":     year,
			"jobs":     jobs,
		}
		return e.JSON(http.StatusAccepted, response)
	}

	// Run phase jobs in background
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
		defer cancel()

		// One phase is one queue and so one batch, filed under the requested year rather
		// than read back off the process-global currentSyncYear below.
		batch := newBatch(triggerManual).forYear(year)

		// Set the current sync year so services use correct year
		// (same pattern as RunSyncWithOptions)
		orchestrator.mu.Lock()
		orchestrator.currentSyncYear = year
		orchestrator.mu.Unlock()

		defer func() {
			orchestrator.mu.Lock()
			orchestrator.currentSyncYear = 0
			orchestrator.mu.Unlock()
		}()

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

			// Set year and debug on the service before running
			if svc := orchestrator.GetService(jobID); svc != nil {
				// Set year so service queries correct year's data
				if yearSetter, ok := svc.(YearSetter); ok {
					yearSetter.SetYear(year)
				}
				// Set debug if requested
				if debug {
					if debuggable, ok := svc.(Debuggable); ok {
						debuggable.SetDebug(true)
					}
				}
			}

			slog.Info("Running phase job", "phase", phase, "job", jobID, "year", year)
			if err := orchestrator.runSyncAndWait(ctx, jobID, batch); err != nil {
				slog.Error("Phase job failed", "phase", phase, "job", jobID, "error", err)
				// Continue with next job even if one fails
			}

			// Clear debug after job completes
			if debug {
				if svc := orchestrator.GetService(jobID); svc != nil {
					if debuggable, ok := svc.(Debuggable); ok {
						debuggable.SetDebug(false)
					}
				}
			}
		}

		slog.Info("Phase sync completed", "phase", phase, "year", year)

		// Process queue after phase sync completes
		processQueuedSyncs(orchestrator)
	}()

	response := map[string]any{
		"message": "Phase sync started",
		"status":  "started",
		"phase":   string(phase),
		"year":    year,
		"jobs":    jobs,
		"debug":   debug,
	}
	return e.JSON(http.StatusOK, response)
}

// handleCamperDietarySync handles the camper dietary extraction endpoint
// Accepts required ?year=YYYY parameter to extract dietary info for a specific year
func handleCamperDietarySync(e *core.RequestEvent, scheduler *Scheduler) error {
	orchestrator := scheduler.GetOrchestrator()
	syncType := "camper_dietary"

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewCamperDietarySync(e.App)
	service.Year = year

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Camper dietary sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting camper_dietary extraction", "year", year)

	return e.JSON(http.StatusOK, map[string]any{
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

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewCamperTransportationSync(e.App)
	service.Year = year

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Camper transportation sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting camper_transportation extraction", "year", year)

	return e.JSON(http.StatusOK, map[string]any{
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

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewQuestRegistrationsSync(e.App)
	service.Year = year

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Quest registrations sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting quest_registrations extraction", "year", year)

	return e.JSON(http.StatusOK, map[string]any{
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

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewStaffApplicationsSync(e.App)
	service.Year = year

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Staff applications sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting staff_applications extraction", "year", year)

	return e.JSON(http.StatusOK, map[string]any{
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

	// Parse required year parameter
	yearParam := e.Request.URL.Query().Get("year")
	if yearParam == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "Missing required year parameter. Use ?year=YYYY",
		})
	}

	year, err := strconv.Atoi(yearParam)
	if err != nil || !ValidSyncYear(year) {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Invalid year parameter. Must be between %d and %d.",
				syncYearMin, syncYearMax),
		})
	}

	// Request-scoped instance — never the shared registered singleton (#1881).
	service := NewStaffVehicleInfoSync(e.App)
	service.Year = year

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	origin := newBatch(triggerManual).forYear(year)
	if err := orchestrator.RunSingleSyncWithService(ctx, syncType, service, origin); err != nil {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":    "Staff vehicle info sync already in progress",
			"status":   "running",
			"syncType": syncType,
		})
	}

	slog.Info("Starting staff_vehicle_info extraction", "year", year)

	return e.JSON(http.StatusOK, map[string]any{
		"message":  "Staff vehicle info extraction started",
		"status":   "started",
		"syncType": syncType,
		"year":     year,
	})
}
