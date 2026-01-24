package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

const boolTrue = "true"

// RequestProcessor processes original_bunk_requests into structured bunk_requests
// All processing is now done in Python - this is just a thin wrapper that:
// 1. Handles PocketBase auth
// 2. Calls Python subprocess
// 3. Collects stats for the sync status UI
type RequestProcessor struct {
	BaseSyncService
	Session      string   // Session filter (e.g., "all", "1", "2a", "toc")
	Limit        int      // Optional limit for testing (0 = no limit)
	Force        bool     // Force reprocess by clearing processed flags first
	SourceFields []string // Optional source field filter (empty = all fields)
	Debug        bool     // Enable debug logging in Python processor
	Trace        bool     // Enable trace logging (very verbose) in Python processor
}

// NewRequestProcessor creates a new processor
func NewRequestProcessor(app core.App) *RequestProcessor {
	return &RequestProcessor{
		BaseSyncService: NewBaseSyncService(app, nil), // No CampMinder client needed
		Session:         "all",                        // Default to all sessions
		Limit:           0,                            // Default to no limit
		Force:           false,                        // Default to no force
		SourceFields:    nil,                          // Default to all fields
		Debug:           false,                        // Default to no debug
		Trace:           false,                        // Default to no trace
	}
}

// Name returns the service name
func (p *RequestProcessor) Name() string {
	return "process_requests"
}

// Sync executes the processing by calling Python
// Python handles all 5 field types:
// - bunk_with, not_bunk_with, bunking_notes, internal_notes -> AI parsing
// - socialize_with -> direct parsing (dropdown values)
func (p *RequestProcessor) Sync(ctx context.Context) error {
	p.Stats = Stats{}
	p.SyncSuccessful = false

	slog.Info("Starting request processing via Python",
		"session", p.Session,
		"limit", p.Limit,
		"force", p.Force,
		"sourceFields", p.SourceFields,
		"debug", p.Debug,
		"trace", p.Trace,
	)

	// If force mode, clear processed flags first
	if p.Force {
		cleared, err := p.clearProcessedFlags(ctx)
		if err != nil {
			slog.Error("Failed to clear processed flags", "error", err)
			return fmt.Errorf("clearing processed flags: %w", err)
		}
		slog.Info("Cleared processed flags for force reprocess", "count", cleared)
	}

	pythonStats, err := p.callPythonProcessor(ctx)
	if err != nil {
		slog.Error("Python processing failed", "error", err)
		return fmt.Errorf("python processing failed: %w", err)
	}

	// Use Python stats
	p.Stats = pythonStats
	slog.Info("Processing completed",
		"created", p.Stats.Created,
		"skipped", p.Stats.Skipped,
		"errors", p.Stats.Errors,
	)

	p.SyncSuccessful = true
	p.LogSyncComplete("process_requests")
	return nil
}

// GetStats returns the service stats
func (p *RequestProcessor) GetStats() Stats {
	return p.Stats
}

// callPythonProcessor invokes the Python bunk request processor
func (p *RequestProcessor) callPythonProcessor(ctx context.Context) (Stats, error) {
	// Get year from environment
	year := os.Getenv("CAMPMINDER_SEASON_ID")
	if year == "" {
		year = "2025"
	}

	// Find project root and Python path
	projectRoot := p.getProjectRoot()
	pythonPath := p.getPythonPath(projectRoot)

	// Create temp file for stats output
	statsFile, err := os.CreateTemp("", "bunk_processor_stats_*.json")
	if err != nil {
		return Stats{}, fmt.Errorf("creating temp file: %w", err)
	}
	statsFilePath := statsFile.Name()
	_ = statsFile.Close()                           // Close so Python can write to it
	defer func() { _ = os.Remove(statsFilePath) }() // Clean up after we're done

	// Build args slice - always include base args
	args := []string{
		"-m",
		"bunking.sync.bunk_request_processor.process_requests",
		"--year", year,
		"--session", p.Session,
		"--stats-output", statsFilePath,
	}

	// Add source field filters (applied before session filter in Python)
	for _, field := range p.SourceFields {
		args = append(args, "--source-field", field)
	}

	// Add optional limit if specified (applied last in Python)
	if p.Limit > 0 {
		args = append(args, "--test-limit", fmt.Sprintf("%d", p.Limit))
	}

	// Add clear-existing flag when force reprocessing
	if p.Force {
		args = append(args, "--clear-existing")
	}

	// Add debug flag for verbose logging
	if p.Debug {
		args = append(args, "--debug")
	}

	// Add trace flag for very verbose logging (overrides debug)
	if p.Trace {
		args = append(args, "--trace")
	}

	//nolint:gosec // G204: args are from trusted internal config
	cmd := exec.CommandContext(ctx, pythonPath, args...)
	cmd.Dir = projectRoot

	// Set environment variables for Python
	cmd.Env = append(os.Environ(),
		"PYTHONPATH="+projectRoot,
	)

	slog.Info("Running Python processor", "command", cmd.String())
	slog.Debug("Stats output file", "path", statsFilePath)

	output, err := cmd.CombinedOutput()

	// In debug/trace mode, log Python output for visibility
	if (p.Debug || p.Trace) && len(output) > 0 {
		slog.Info("Python processor output", "output", string(output))
	}

	if err != nil {
		// Try to read stats file even on error - Python may have written error stats
		statsData, readErr := os.ReadFile(statsFilePath) //nolint:gosec // G304: trusted temp file
		if readErr == nil && len(statsData) > 0 {
			slog.Warn("Python failed but wrote stats file, attempting to parse")
			var result struct {
				Success          bool `json:"success"`
				Created          int  `json:"created"`
				Updated          int  `json:"updated"`
				Skipped          int  `json:"skipped"`
				Errors           int  `json:"errors"`
				AlreadyProcessed int  `json:"already_processed"`
			}
			if json.Unmarshal(statsData, &result) == nil {
				return Stats{
					Created:          result.Created,
					Updated:          result.Updated,
					Skipped:          result.Skipped,
					Errors:           result.Errors,
					AlreadyProcessed: result.AlreadyProcessed,
				}, nil
			}
		}
		return Stats{}, fmt.Errorf("python subprocess failed: %w\nOutput: %s", err, string(output))
	}

	// Read stats from temp file
	statsData, err := os.ReadFile(statsFilePath) //nolint:gosec // G304: trusted temp file
	if err != nil {
		return Stats{}, fmt.Errorf("reading stats file: %w", err)
	}

	// Parse JSON stats
	var result struct {
		Success          bool `json:"success"`
		Created          int  `json:"created"`
		Updated          int  `json:"updated"`
		Skipped          int  `json:"skipped"`
		Errors           int  `json:"errors"`
		AlreadyProcessed int  `json:"already_processed"`
	}

	if err := json.Unmarshal(statsData, &result); err != nil {
		return Stats{}, fmt.Errorf("parsing stats JSON: %w\nRaw content: %s", err, string(statsData))
	}

	if !result.Success {
		slog.Warn("Python processor reported failure")
	}

	return Stats{
		Created:          result.Created,
		Updated:          result.Updated,
		Skipped:          result.Skipped,
		Errors:           result.Errors,
		AlreadyProcessed: result.AlreadyProcessed,
	}, nil
}

// getProjectRoot returns the project root directory (parent of pocketbase)
func (p *RequestProcessor) getProjectRoot() string {
	// In Docker, project root is /app
	if os.Getenv("IS_DOCKER") == boolTrue {
		return "/app"
	}

	// DataDir is typically /path/to/project/pocketbase/pb_data
	// We need to go up two levels to get project root
	dataDir := p.App.DataDir()

	// Convert to absolute path first (handles relative paths like "./pb_data")
	absDataDir, err := filepath.Abs(dataDir)
	if err != nil {
		slog.Warn("Could not get absolute path for DataDir", "dataDir", dataDir, "error", err)
		absDataDir = dataDir
	}

	projectRoot := filepath.Dir(filepath.Dir(absDataDir))
	slog.Debug("Resolved project root", "projectRoot", projectRoot, "dataDir", dataDir)
	return projectRoot
}

// getPythonPath returns the Python interpreter path based on environment
func (p *RequestProcessor) getPythonPath(projectRoot string) string {
	// In Docker, Python is installed system-wide (no venv)
	if os.Getenv("IS_DOCKER") == boolTrue {
		return "python3"
	}

	// In development, use the project's venv (uv creates .venv with dot prefix)
	return filepath.Join(projectRoot, ".venv", "bin", "python")
}

// clearBatchSize is the maximum number of person IDs per OR condition batch.
// Conservative to avoid query length issues while maintaining efficiency.
const clearBatchSize = 25

// batchStrings splits a slice into batches of the given size.
// Returns empty slice for empty input or invalid batch size.
func batchStrings(items []string, batchSize int) [][]string {
	if len(items) == 0 || batchSize <= 0 {
		return [][]string{}
	}

	result := make([][]string, 0, (len(items)+batchSize-1)/batchSize)
	for i := 0; i < len(items); i += batchSize {
		end := i + batchSize
		if end > len(items) {
			end = len(items)
		}
		result = append(result, items[i:end])
	}
	return result
}

// buildBatchedFilter appends person ID conditions to the base filter.
// Returns base filter unchanged if personIDs is empty.
func buildBatchedFilter(baseFilter string, personIDs []string) string {
	if len(personIDs) == 0 {
		return baseFilter
	}
	idConditions := make([]string, len(personIDs))
	for i, pbID := range personIDs {
		idConditions[i] = fmt.Sprintf("requester = '%s'", pbID)
	}
	return fmt.Sprintf("%s && (%s)", baseFilter, strings.Join(idConditions, " || "))
}

// clearProcessedFlags clears the 'processed' field in original_bunk_requests
// to force reprocessing of records.
//
// Filter priority (matches Python loader):
//  1. Year (always applied)
//  2. Source fields (if p.SourceFields is non-empty)
//  3. Session (if p.Session != "all", filters to persons in target sessions)
//  4. Limit (applied last)
//
// For sessions with many persons, queries are batched to avoid long OR conditions.
func (p *RequestProcessor) clearProcessedFlags(ctx context.Context) (int, error) {
	year := os.Getenv("CAMPMINDER_SEASON_ID")
	if year == "" {
		year = "2025"
	}

	// Build base filter - always filter by year and processed != ''
	baseFilter := fmt.Sprintf("year = %s && processed != ''", year)

	// Add source field filter if specified
	if len(p.SourceFields) > 0 {
		fieldConditions := make([]string, len(p.SourceFields))
		for i, field := range p.SourceFields {
			fieldConditions[i] = fmt.Sprintf("field = '%s'", field)
		}
		fieldFilter := "(" + strings.Join(fieldConditions, " || ") + ")"
		baseFilter = fmt.Sprintf("%s && %s", baseFilter, fieldFilter)
	}

	// Check if session filter is needed
	var personIDs []string
	if p.Session != DefaultSession && p.Session != "" {
		ids, err := p.getPersonsInSession(ctx, year)
		switch {
		case err != nil:
			slog.Warn("Failed to get persons for session filter, skipping session filter",
				"session", p.Session, "error", err)
			// Fall through with empty personIDs - will query without session filter
		case len(ids) == 0:
			slog.Warn("No persons found in target session", "session", p.Session)
			return 0, nil // Nothing to clear
		default:
			personIDs = ids
		}
	}

	// If no session filter needed (all sessions or failed to get persons), run single query
	if len(personIDs) == 0 {
		return p.clearRecordsWithFilter(baseFilter)
	}

	// Batch the queries for session filtering
	batches := batchStrings(personIDs, clearBatchSize)
	slog.Info("Clearing processed flags in batches",
		"session", p.Session,
		"totalPersons", len(personIDs),
		"batchCount", len(batches),
		"batchSize", clearBatchSize,
	)

	totalCleared := 0
	remainingLimit := p.Limit // 0 means no limit

	for batchNum, batch := range batches {
		// Check if we've hit the limit
		if remainingLimit > 0 && totalCleared >= remainingLimit {
			break
		}

		// Build filter for this batch
		batchFilter := buildBatchedFilter(baseFilter, batch)

		slog.Debug("Processing batch",
			"batch", batchNum+1,
			"batchSize", len(batch),
			"totalPersons", len(personIDs),
		)

		// Temporarily adjust limit for this batch if needed
		originalLimit := p.Limit
		if remainingLimit > 0 {
			p.Limit = remainingLimit - totalCleared
		}

		cleared, err := p.clearRecordsWithFilter(batchFilter)
		p.Limit = originalLimit // Restore

		if err != nil {
			slog.Error("Failed to clear batch",
				"batch", batchNum+1,
				"error", err,
			)
			// Continue with other batches
			continue
		}

		totalCleared += cleared
	}

	slog.Info("Completed batched flag clearing",
		"totalCleared", totalCleared,
		"batchCount", len(batches),
	)

	return totalCleared, nil
}

// clearRecordsWithFilter finds and clears processed records matching the filter.
// Respects p.Limit if set.
func (p *RequestProcessor) clearRecordsWithFilter(filter string) (int, error) {
	// Determine page size respecting limit
	pageSize := 500
	if p.Limit > 0 && p.Limit < pageSize {
		pageSize = p.Limit
	}

	// Find records that have been processed (non-empty processed field)
	records, err := p.App.FindRecordsByFilter(
		"original_bunk_requests",
		filter,
		"-updated", // Most recently updated first
		pageSize,
		0,
	)
	if err != nil {
		return 0, fmt.Errorf("finding processed records: %w", err)
	}

	// Apply limit if specified
	if p.Limit > 0 && len(records) > p.Limit {
		records = records[:p.Limit]
	}

	slog.Debug("Found processed records to clear",
		"count", len(records),
		"filter", filter,
		"limit", p.Limit,
	)

	// Clear processed field on each record
	cleared := 0
	for _, record := range records {
		record.Set("processed", "")
		if err := p.App.Save(record); err != nil {
			slog.Error("Failed to clear processed flag", "recordId", record.Id, "error", err)
			continue
		}
		cleared++
	}

	return cleared, nil
}

// getPersonsInSession returns PocketBase IDs of persons enrolled in target sessions
func (p *RequestProcessor) getPersonsInSession(_ context.Context, year string) ([]string, error) {
	// Use shared session resolver to get CM IDs
	yearInt, err := strconv.Atoi(year)
	if err != nil {
		return nil, fmt.Errorf("invalid year: %s", year)
	}

	resolver := NewSessionResolver(p.App)
	sessionCMIDs, err := resolver.ResolveSessionCMIDs(p.Session, yearInt)
	if err != nil {
		return nil, err
	}

	if len(sessionCMIDs) == 0 {
		return nil, nil
	}

	// Build session filter for attendees query
	sessionConditions := make([]string, len(sessionCMIDs))
	for i, cmID := range sessionCMIDs {
		sessionConditions[i] = fmt.Sprintf("session.cm_id = %d", cmID)
	}
	sessionFilter := "(" + strings.Join(sessionConditions, " || ") + ")"

	// Query attendees for persons in target sessions
	filter := fmt.Sprintf("year = %s && status = 'enrolled' && %s", year, sessionFilter)
	attendees, err := p.App.FindRecordsByFilter(
		"attendees",
		filter,
		"",
		0,
		0,
	)
	if err != nil {
		return nil, fmt.Errorf("querying attendees: %w", err)
	}

	// Extract unique person PB IDs
	personIDSet := make(map[string]bool)
	for _, attendee := range attendees {
		personPBID := attendee.GetString("person")
		if personPBID != "" {
			personIDSet[personPBID] = true
		}
	}

	personIDs := make([]string, 0, len(personIDSet))
	for id := range personIDSet {
		personIDs = append(personIDs, id)
	}

	return personIDs, nil
}
