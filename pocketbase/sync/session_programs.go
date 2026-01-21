package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameSessionPrograms = "session_programs"

// SessionProgramsSync handles syncing session program data from CampMinder
type SessionProgramsSync struct {
	BaseSyncService
}

// NewSessionProgramsSync creates a new session programs sync service
func NewSessionProgramsSync(app core.App, client *campminder.Client) *SessionProgramsSync {
	return &SessionProgramsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *SessionProgramsSync) Name() string {
	return serviceNameSessionPrograms
}

// Sync performs the session programs sync
func (s *SessionProgramsSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year
	existingRecords, err := s.PreloadRecords("session_programs", filter, func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart(serviceNameSessionPrograms)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Fetch session programs from CampMinder
	programs, err := s.Client.GetSessionPrograms()
	if err != nil {
		return fmt.Errorf("fetching session programs: %w", err)
	}

	if len(programs) == 0 {
		slog.Info("No session programs to sync")
		return nil
	}

	slog.Info("Fetched session programs from CampMinder", "count", len(programs))
	s.SyncSuccessful = true

	// Process each session program
	for _, programData := range programs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Transform to PocketBase format
		pbData, err := s.transformSessionProgramToPB(programData, year)
		if err != nil {
			slog.Error("Error transforming session program", "error", err)
			s.Stats.Errors++
			continue
		}

		// Extract key
		programID, ok := programData["ID"].(float64)
		if !ok {
			slog.Error("Invalid session program ID type")
			s.Stats.Errors++
			continue
		}
		key := int(programID)

		// Track as processed
		s.TrackProcessedKey(key, year)

		// Process the record
		compareFields := []string{
			"cm_id", "name", "description", "session_cm_id",
			"start_age", "end_age", "start_grade_id", "end_grade_id", "is_active",
		}
		if err := s.ProcessSimpleRecord("session_programs", key, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing session program", "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans
	if err := s.DeleteOrphans(
		"session_programs",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			yearValue := record.Get("year")

			cmID, cmOK := cmIDValue.(float64)
			yr, yearOK := yearValue.(float64)

			if cmOK && yearOK {
				return CompositeKey(int(cmID), int(yr)), true
			}
			return "", false
		},
		"session_program",
		filter,
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("SessionPrograms")
	return nil
}

// transformSessionProgramToPB transforms CampMinder session program data to PocketBase format
func (s *SessionProgramsSync) transformSessionProgramToPB(
	data map[string]interface{},
	year int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract program ID (required)
	programIDFloat, ok := data["ID"].(float64)
	if !ok {
		return nil, fmt.Errorf("invalid session program ID type")
	}
	pbData["cm_id"] = int(programIDFloat)

	// Extract name (required)
	name, _ := data["Name"].(string)
	pbData["name"] = name

	// Extract optional fields
	pbData["description"] = data["Description"]
	pbData["session_cm_id"] = data["SessionID"]
	pbData["start_age"] = data["StartAge"]
	pbData["end_age"] = data["EndAge"]
	pbData["start_grade_id"] = data["StartGradeID"]
	pbData["end_grade_id"] = data["EndGradeID"]
	pbData["is_active"] = data["IsActive"]

	// Set year
	pbData["year"] = year

	return pbData, nil
}
