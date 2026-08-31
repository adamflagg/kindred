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
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// RequestProcessor processes original_bunk_requests into structured bunk_requests
// All processing is done in Python via the FastAPI process-requests endpoint.
// This is a thin wrapper that:
// 1. Calls the FastAPI HTTP endpoint (passing force/clear_existing flags)
// 2. Collects stats for the sync status UI
type RequestProcessor struct {
	BaseSyncService
	Session       string   // Session filter (e.g., "all", "1", "2a", "toc")
	Limit         int      // Optional limit for testing (0 = no limit)
	Force         bool     // Force reprocess — passed to Python API to clear processed flags
	ClearExisting bool     // Clear existing bunk_requests before reprocessing (granular per-person/field)
	SourceFields  []string // Optional source field filter (empty = all fields)
	Debug         bool     // Enable debug logging in Python processor
	Trace         bool     // Enable trace logging (very verbose) in Python processor
	CollectTraces bool     // Enable pipeline trace collection for debug tool
	Trigger       string   // run source: "upload" | "scheduled" | "manual" (empty = manual)
}

// NewRequestProcessor creates a new processor
func NewRequestProcessor(app core.App) *RequestProcessor {
	return &RequestProcessor{
		BaseSyncService: NewBaseSyncService(app, nil), // No CampMinder client needed
		Session:         "all",                        // Default to all sessions
		Limit:           0,                            // Default to no limit
		Force:           false,                        // Default to no force
		ClearExisting:   false,                        // Default to no clearing
		SourceFields:    nil,                          // Default to all fields
		Debug:           false,                        // Default to no debug
		Trace:           false,                        // Default to no trace
	}
}

// Name returns the service name

// Sync executes the processing by calling the FastAPI process-requests endpoint.
// Python handles all 5 field types:
// - bunk_with, not_bunk_with, bunking_notes, internal_notes -> AI parsing
// - socialize_with -> direct parsing (dropdown values)
func (p *RequestProcessor) Sync(ctx context.Context) error {
	p.Stats = Stats{}
	p.SyncSuccessful = false

	slog.Info("Starting request processing via API",
		"session", p.Session,
		"limit", p.Limit,
		"force", p.Force,
		"clearExisting", p.ClearExisting,
		"sourceFields", p.SourceFields,
		"debug", p.Debug,
		"trace", p.Trace,
	)

	// Get and validate year from environment
	yearInt, err := ParseSeasonYear()
	if err != nil {
		return fmt.Errorf("year resolution failed: %w", err)
	}

	apiURL := getAPIURL()
	pythonStats, err := callAPIProcessor(ctx, apiURL, &apiProcessorRequest{
		Year:          yearInt,
		Session:       p.Session,
		SourceFields:  p.SourceFields,
		Limit:         p.Limit,
		ClearExisting: p.ClearExisting || p.Force,
		Force:         p.Force,
		Debug:         p.Debug,
		Trace:         p.Trace,
		CollectTraces: p.CollectTraces,
		Trigger:       p.Trigger,
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
	Force         bool     `json:"force"`
	Debug         bool     `json:"debug"`
	Trace         bool     `json:"trace"`
	CollectTraces bool     `json:"collect_traces"`
	Trigger       string   `json:"trigger,omitempty"`
}

// apiProcessorResponse is the JSON response from the process-requests API
type apiProcessorResponse struct {
	Success          bool     `json:"success"`
	Created          int      `json:"created"`
	Updated          int      `json:"updated"`
	Skipped          int      `json:"skipped"`
	Errors           int      `json:"errors"`
	AlreadyProcessed int      `json:"already_processed"`
	Error            string   `json:"error,omitempty"`
	Warnings         []string `json:"warnings,omitempty"`
	Phase1Failed     int      `json:"phase1_failed"`
}

// getProcessRequestsTimeout returns the HTTP timeout for process-requests calls.
// Reads PROCESS_REQUESTS_TIMEOUT_MINUTES env var, defaults to 120 minutes.
func getProcessRequestsTimeout() time.Duration {
	const defaultTimeout = 120 * time.Minute
	envVal := os.Getenv("PROCESS_REQUESTS_TIMEOUT_MINUTES")
	if envVal == "" {
		return defaultTimeout
	}
	minutes, err := strconv.Atoi(envVal)
	if err != nil || minutes <= 0 {
		slog.Warn("Invalid PROCESS_REQUESTS_TIMEOUT_MINUTES, using default",
			"value", envVal, "default_minutes", int(defaultTimeout.Minutes()))
		return defaultTimeout
	}
	return time.Duration(minutes) * time.Minute
}

// callAPIProcessor calls the FastAPI process-requests endpoint
func callAPIProcessor(ctx context.Context, apiURL string, req *apiProcessorRequest) (Stats, error) {
	bodyBytes, err := json.Marshal(req)
	if err != nil {
		return Stats{}, fmt.Errorf("marshaling request: %w", err)
	}

	client := &http.Client{Timeout: getProcessRequestsTimeout()}

	endpoint := apiURL + "/api/internal/process-requests"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return Stats{}, fmt.Errorf("building process-requests request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		return Stats{}, fmt.Errorf("calling process-requests API: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return Stats{}, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return Stats{}, fmt.Errorf("process-requests API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result apiProcessorResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return Stats{}, fmt.Errorf("parsing process-requests response: %w\nRaw: %s", err, string(respBody))
	}

	if !result.Success {
		slog.Warn("Process requests API reported failure", "error", result.Error)
	}

	for _, w := range result.Warnings {
		slog.Warn("Process requests warning from Python", "warning", w)
	}

	return Stats{
		Created:          result.Created,
		Updated:          result.Updated,
		Skipped:          result.Skipped,
		Errors:           result.Errors,
		AlreadyProcessed: result.AlreadyProcessed,
	}, nil
}
