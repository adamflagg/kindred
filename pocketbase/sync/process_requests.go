package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const boolTrue = "true"

// RequestProcessor processes original_bunk_requests into structured bunk_requests
// All processing is done in Python via the FastAPI process-requests endpoint.
// This is a thin wrapper that:
// 1. Optionally clears processed flags (force mode)
// 2. Calls the FastAPI HTTP endpoint
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

// Sync executes the processing by calling the FastAPI process-requests endpoint.
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

	// Get year from environment
	year := os.Getenv("CAMPMINDER_SEASON_ID")
	if year == "" {
		year = "2025"
	}

	apiURL := getAPIURL()
	pythonStats, err := callAPIProcessor(apiURL, apiProcessorRequest{
		Year:          func() int { y, _ := strconv.Atoi(year); return y }(),
		Session:       p.Session,
		SourceFields:  p.SourceFields,
		Limit:         p.Limit,
		ClearExisting: p.Force,
		Debug:         p.Debug,
		Trace:         p.Trace,
	})
	if err != nil {
		slog.Error("API processing failed", "error", err)
		return fmt.Errorf("api processing failed: %w", err)
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

// apiProcessorRequest is the JSON body for the process-requests API
type apiProcessorRequest struct {
	Year          int      `json:"year"`
	Session       string   `json:"session"`
	SourceFields  []string `json:"source_fields,omitempty"`
	Limit         int      `json:"limit"`
	ClearExisting bool     `json:"clear_existing"`
	Debug         bool     `json:"debug"`
	Trace         bool     `json:"trace"`
}

// apiProcessorResponse is the JSON response from the process-requests API
type apiProcessorResponse struct {
	Success          bool   `json:"success"`
	Created          int    `json:"created"`
	Updated          int    `json:"updated"`
	Skipped          int    `json:"skipped"`
	Errors           int    `json:"errors"`
	AlreadyProcessed int    `json:"already_processed"`
	Error            string `json:"error,omitempty"`
}

// callAPIProcessor calls the FastAPI process-requests endpoint
func callAPIProcessor(apiURL string, req apiProcessorRequest) (Stats, error) {
	bodyBytes, err := json.Marshal(req)
	if err != nil {
		return Stats{}, fmt.Errorf("marshaling request: %w", err)
	}

	// Use a long timeout — processing can take up to 30 minutes
	client := &http.Client{Timeout: 35 * time.Minute}

	resp, err := client.Post(apiURL+"/api/internal/process-requests", "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		return Stats{}, fmt.Errorf("calling process-requests API: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return Stats{}, fmt.Errorf("reading response: %w", err)
	}

	var result apiProcessorResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return Stats{}, fmt.Errorf("parsing process-requests response: %w\nRaw: %s", err, string(respBody))
	}

	if resp.StatusCode != http.StatusOK {
		return Stats{}, fmt.Errorf("process-requests API returned %d: %s", resp.StatusCode, result.Error)
	}

	if !result.Success {
		slog.Warn("Process requests API reported failure", "error", result.Error)
	}

	return Stats{
		Created:          result.Created,
		Updated:          result.Updated,
		Skipped:          result.Skipped,
		Errors:           result.Errors,
		AlreadyProcessed: result.AlreadyProcessed,
	}, nil
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
