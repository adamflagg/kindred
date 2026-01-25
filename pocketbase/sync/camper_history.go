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

	"github.com/pocketbase/pocketbase/core"
)

// CamperHistorySync computes camper history records with retention metrics.
// All computation is done in Python - this is a thin wrapper that:
// 1. Handles PocketBase auth
// 2. Calls Python subprocess
// 3. Collects stats for the sync status UI
type CamperHistorySync struct {
	BaseSyncService
	Year   int  // Year to compute history for (0 = current year from env)
	DryRun bool // Dry run mode (compute but don't write)
}

// NewCamperHistorySync creates a new camper history sync service
func NewCamperHistorySync(app core.App) *CamperHistorySync {
	return &CamperHistorySync{
		BaseSyncService: NewBaseSyncService(app, nil), // No CampMinder client needed
		Year:            0,                            // Default: current year from env
		DryRun:          false,                        // Default: write to database
	}
}

// Name returns the service name
func (c *CamperHistorySync) Name() string {
	return "camper_history"
}

// Sync executes the computation by calling Python
func (c *CamperHistorySync) Sync(ctx context.Context) error {
	c.Stats = Stats{}
	c.SyncSuccessful = false

	// Determine year
	year := c.Year
	if year == 0 {
		yearStr := os.Getenv("CAMPMINDER_SEASON_ID")
		if yearStr != "" {
			if y, err := strconv.Atoi(yearStr); err == nil {
				year = y
			}
		}
		if year == 0 {
			year = 2025 // Default fallback
		}
	}

	slog.Info("Starting camper history computation via Python",
		"year", year,
		"dry_run", c.DryRun,
	)

	pythonStats, err := c.callPythonComputer(ctx, year)
	if err != nil {
		slog.Error("Python computation failed", "error", err)
		return fmt.Errorf("python computation failed: %w", err)
	}

	// Use Python stats
	c.Stats = pythonStats
	slog.Info("Camper history computation completed",
		"year", year,
		"created", c.Stats.Created,
		"deleted", c.Stats.Deleted,
		"errors", c.Stats.Errors,
	)

	c.SyncSuccessful = true
	c.LogSyncComplete("camper_history")
	return nil
}

// SyncForYear computes history for a specific year
func (c *CamperHistorySync) SyncForYear(ctx context.Context, year int) error {
	c.Year = year
	return c.Sync(ctx)
}

// GetStats returns the service stats
func (c *CamperHistorySync) GetStats() Stats {
	return c.Stats
}

// callPythonComputer invokes the Python camper history computation
func (c *CamperHistorySync) callPythonComputer(ctx context.Context, year int) (Stats, error) {
	// Find project root and Python path
	projectRoot := c.getProjectRoot()
	pythonPath := c.getPythonPath(projectRoot)

	// Create temp file for stats output
	statsFile, err := os.CreateTemp("", "camper_history_stats_*.json")
	if err != nil {
		return Stats{}, fmt.Errorf("creating temp file: %w", err)
	}
	statsFilePath := statsFile.Name()
	_ = statsFile.Close()                           // Close so Python can write to it
	defer func() { _ = os.Remove(statsFilePath) }() // Clean up after we're done

	// Build args slice
	args := []string{
		"-m",
		"bunking.metrics.compute_camper_history",
		"--year", strconv.Itoa(year),
		"--stats-output", statsFilePath,
	}

	// Add dry-run flag if specified
	if c.DryRun {
		args = append(args, "--dry-run")
	}

	//nolint:gosec // G204: args are from trusted internal config
	cmd := exec.CommandContext(ctx, pythonPath, args...)
	cmd.Dir = projectRoot

	// Set environment variables for Python
	cmd.Env = append(os.Environ(),
		"PYTHONPATH="+projectRoot,
	)

	slog.Info("Running Python camper history computer", "command", cmd.String())
	slog.Debug("Stats output file", "path", statsFilePath)

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Try to read stats file even on error
		statsData, readErr := os.ReadFile(statsFilePath) //nolint:gosec // G304: trusted temp file
		if readErr == nil && len(statsData) > 0 {
			slog.Warn("Python failed but wrote stats file, attempting to parse")
			var result struct {
				Success bool `json:"success"`
				Created int  `json:"created"`
				Deleted int  `json:"deleted"`
				Errors  int  `json:"errors"`
			}
			if json.Unmarshal(statsData, &result) == nil {
				return Stats{
					Created: result.Created,
					Deleted: result.Deleted,
					Errors:  result.Errors,
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
		Success bool `json:"success"`
		Created int  `json:"created"`
		Deleted int  `json:"deleted"`
		Errors  int  `json:"errors"`
	}

	if err := json.Unmarshal(statsData, &result); err != nil {
		return Stats{}, fmt.Errorf("parsing stats JSON: %w\nRaw content: %s", err, string(statsData))
	}

	if !result.Success {
		slog.Warn("Python processor reported failure")
	}

	return Stats{
		Created: result.Created,
		Deleted: result.Deleted,
		Errors:  result.Errors,
	}, nil
}

// getProjectRoot returns the project root directory (parent of pocketbase)
func (c *CamperHistorySync) getProjectRoot() string {
	// In Docker, project root is /app
	if os.Getenv("IS_DOCKER") == boolTrue {
		return "/app"
	}

	// DataDir is typically /path/to/project/pocketbase/pb_data
	// We need to go up two levels to get project root
	dataDir := c.App.DataDir()

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
func (c *CamperHistorySync) getPythonPath(projectRoot string) string {
	// In Docker, Python is installed system-wide (no venv)
	if os.Getenv("IS_DOCKER") == boolTrue {
		return "python3"
	}

	// In development, use the project's venv (uv creates .venv with dot prefix)
	return filepath.Join(projectRoot, ".venv", "bin", "python")
}
