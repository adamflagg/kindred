package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNamePersonTagDefinitions = "person_tag_definitions"

// PersonTagDefinitionsSync handles syncing person tag definitions from CampMinder
type PersonTagDefinitionsSync struct {
	BaseSyncService
}

// NewPersonTagDefinitionsSync creates a new person tag definitions sync service
func NewPersonTagDefinitionsSync(app core.App, client *campminder.Client) *PersonTagDefinitionsSync {
	return &PersonTagDefinitionsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *PersonTagDefinitionsSync) Name() string {
	return serviceNamePersonTagDefinitions
}

// Sync performs the person tag definitions sync
func (s *PersonTagDefinitionsSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year
	// Note: TagDef uses Name as identifier (no CM ID), so we key by name
	existingRecords, err := s.PreloadRecords("person_tag_definitions", filter, func(record *core.Record) (interface{}, bool) {
		if name, ok := record.Get("name").(string); ok && name != "" {
			return name, true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart(serviceNamePersonTagDefinitions)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Fetch tag definitions from CampMinder
	tags, err := s.Client.GetPersonTagDefinitions()
	if err != nil {
		return fmt.Errorf("fetching person tag definitions: %w", err)
	}

	if len(tags) == 0 {
		slog.Info("No person tag definitions to sync")
		s.SyncSuccessful = true
		s.LogSyncComplete("PersonTagDefinitions")
		return nil
	}

	slog.Info("Fetched person tag definitions from CampMinder", "count", len(tags))
	s.SyncSuccessful = true

	// Process each tag definition
	for _, tagData := range tags {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Transform to PocketBase format
		pbData, err := s.transformPersonTagDefinitionToPB(tagData, year)
		if err != nil {
			slog.Error("Error transforming person tag definition", "error", err)
			s.Stats.Errors++
			continue
		}

		// Extract key (Name is the identifier for tag definitions)
		name, ok := pbData["name"].(string)
		if !ok || name == "" {
			slog.Error("Invalid person tag definition name")
			s.Stats.Errors++
			continue
		}

		// Track as processed (using name as key)
		s.TrackProcessedKey(name, year)

		// Process the record using name as key
		compareFields := []string{"name", "is_seasonal", "is_hidden", "last_updated_utc"}
		if err := s.ProcessSimpleRecord("person_tag_definitions", name, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing person tag definition", "name", name, "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans
	if err := s.DeleteOrphans(
		"person_tag_definitions",
		func(record *core.Record) (string, bool) {
			nameValue := record.Get("name")
			yearValue := record.Get("year")

			name, nameOK := nameValue.(string)
			yr, yearOK := yearValue.(float64)

			if nameOK && yearOK && name != "" {
				return CompositeKey(name, int(yr)), true
			}
			return "", false
		},
		"person_tag_definition",
		filter,
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("PersonTagDefinitions")
	return nil
}

// transformPersonTagDefinitionToPB transforms CampMinder tag definition data to PocketBase format
func (s *PersonTagDefinitionsSync) transformPersonTagDefinitionToPB(
	data map[string]interface{},
	year int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract name (required - this is the identifier)
	name, ok := data["Name"].(string)
	if !ok || name == "" {
		return nil, fmt.Errorf("invalid or missing tag definition Name")
	}
	pbData["name"] = name

	// Extract optional fields
	pbData["is_seasonal"] = data["IsSeasonal"]
	pbData["is_hidden"] = data["IsHidden"]
	pbData["last_updated_utc"] = data["LastUpdatedUTC"]

	// Set year
	pbData["year"] = year

	return pbData, nil
}
