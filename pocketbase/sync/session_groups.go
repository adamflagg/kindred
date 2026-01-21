package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameSessionGroups = "session_groups"

// SessionGroupsSync handles syncing session group data from CampMinder
type SessionGroupsSync struct {
	BaseSyncService
}

// NewSessionGroupsSync creates a new session groups sync service
func NewSessionGroupsSync(app core.App, client *campminder.Client) *SessionGroupsSync {
	return &SessionGroupsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *SessionGroupsSync) Name() string {
	return serviceNameSessionGroups
}

// Sync performs the session groups sync
func (s *SessionGroupsSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year
	existingRecords, err := s.PreloadRecords("session_groups", filter, func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart(serviceNameSessionGroups)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Fetch session groups from CampMinder
	groups, err := s.Client.GetSessionGroups()
	if err != nil {
		return fmt.Errorf("fetching session groups: %w", err)
	}

	if len(groups) == 0 {
		slog.Info("No session groups to sync")
		return nil
	}

	slog.Info("Fetched session groups from CampMinder", "count", len(groups))
	s.SyncSuccessful = true

	// Process each session group
	for _, groupData := range groups {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Transform to PocketBase format
		pbData, err := s.transformSessionGroupToPB(groupData, year)
		if err != nil {
			slog.Error("Error transforming session group", "error", err)
			s.Stats.Errors++
			continue
		}

		// Extract key
		groupID, ok := groupData["ID"].(float64)
		if !ok {
			slog.Error("Invalid session group ID type")
			s.Stats.Errors++
			continue
		}
		key := int(groupID)

		// Track as processed
		s.TrackProcessedKey(key, year)

		// Process the record
		compareFields := []string{"cm_id", "name", "description", "is_active", "sort_order"}
		if err := s.ProcessSimpleRecord("session_groups", key, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing session group", "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans
	if err := s.DeleteOrphans(
		"session_groups",
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
		"session_group",
		filter,
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("SessionGroups")
	return nil
}

// transformSessionGroupToPB transforms CampMinder session group data to PocketBase format
func (s *SessionGroupsSync) transformSessionGroupToPB(
	data map[string]interface{},
	year int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract group ID (required)
	groupIDFloat, ok := data["ID"].(float64)
	if !ok {
		return nil, fmt.Errorf("invalid session group ID type")
	}
	pbData["cm_id"] = int(groupIDFloat)

	// Extract name (required)
	name, _ := data["Name"].(string)
	pbData["name"] = name

	// Extract optional fields
	pbData["description"] = data["Description"]
	pbData["is_active"] = data["IsActive"]
	pbData["sort_order"] = data["SortOrder"]

	// Set year
	pbData["year"] = year

	return pbData, nil
}
