package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameCustomFieldDefinitions = "custom_field_definitions"

// CustomFieldDefinitionsSync handles syncing custom field definitions from CampMinder
type CustomFieldDefinitionsSync struct {
	BaseSyncService
}

// NewCustomFieldDefinitionsSync creates a new custom field definitions sync service
func NewCustomFieldDefinitionsSync(app core.App, client *campminder.Client) *CustomFieldDefinitionsSync {
	return &CustomFieldDefinitionsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *CustomFieldDefinitionsSync) Name() string {
	return serviceNameCustomFieldDefinitions
}

// Sync performs the custom field definitions sync
func (s *CustomFieldDefinitionsSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year
	existingRecords, err := s.PreloadRecords("custom_field_definitions", filter, func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart(serviceNameCustomFieldDefinitions)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Fetch custom field definitions page by page
	page := 1
	pageSize := LargePageSize

	for {
		// Check context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Fetch page
		definitions, hasMore, err := s.Client.GetCustomFieldDefinitionsPage(page, pageSize)
		if err != nil {
			return fmt.Errorf("fetching custom field definitions page %d: %w", page, err)
		}

		slog.Info("Processing custom field definitions page", "page", page, "count", len(definitions))

		// Mark sync as successful once we've successfully fetched data
		if page == 1 {
			s.SyncSuccessful = true
		}

		// Process each definition on this page
		for _, defData := range definitions {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			// Transform to PocketBase format
			pbData, err := s.transformCustomFieldDefinitionToPB(defData, year)
			if err != nil {
				slog.Error("Error transforming custom field definition", "error", err)
				s.Stats.Errors++
				continue
			}

			// Extract key (cm_id is the identifier)
			cmID, ok := pbData["cm_id"].(int)
			if !ok || cmID == 0 {
				slog.Error("Invalid custom field definition cm_id")
				s.Stats.Errors++
				continue
			}

			// Track as processed
			s.TrackProcessedKey(cmID, year)

			// Process the record using cm_id as key
			compareFields := []string{"cm_id", "name", "data_type", "partition", "is_seasonal", "is_array", "is_active"}
			if err := s.ProcessSimpleRecord("custom_field_definitions", cmID, pbData, existingRecords, compareFields); err != nil {
				slog.Error("Error processing custom field definition", "cm_id", cmID, "error", err)
				s.Stats.Errors++
			}
		}

		// Check if we have more pages
		if !hasMore || len(definitions) == 0 {
			break
		}
		page++
	}

	// Delete orphans
	if err := s.DeleteOrphans(
		"custom_field_definitions",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			yearValue := record.Get("year")

			cmID, cmIDOK := cmIDValue.(float64)
			yr, yearOK := yearValue.(float64)

			if cmIDOK && yearOK && cmID > 0 {
				return CompositeKey(int(cmID), int(yr)), true
			}
			return "", false
		},
		"custom_field_definition",
		filter,
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("CustomFieldDefinitions")
	return nil
}

// transformCustomFieldDefinitionToPB transforms CampMinder custom field definition data to PocketBase format
func (s *CustomFieldDefinitionsSync) transformCustomFieldDefinitionToPB(
	data map[string]interface{},
	year int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract ID (required)
	idFloat, ok := data["Id"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing custom field definition Id")
	}
	pbData["cm_id"] = int(idFloat)

	// Extract name (required)
	name, ok := data["Name"].(string)
	if !ok || name == "" {
		return nil, fmt.Errorf("invalid or missing custom field definition Name")
	}
	pbData["name"] = name

	// Extract optional fields with defaults
	if dataType, ok := data["DataType"].(string); ok {
		pbData["data_type"] = dataType
	} else {
		pbData["data_type"] = "None"
	}

	if partition, ok := data["Partition"].(string); ok {
		pbData["partition"] = partition
	} else {
		pbData["partition"] = "None"
	}

	if isSeasonal, ok := data["IsSeasonal"].(bool); ok {
		pbData["is_seasonal"] = isSeasonal
	} else {
		pbData["is_seasonal"] = false
	}

	if isArray, ok := data["IsArray"].(bool); ok {
		pbData["is_array"] = isArray
	} else {
		pbData["is_array"] = false
	}

	if isActive, ok := data["IsActive"].(bool); ok {
		pbData["is_active"] = isActive
	} else {
		pbData["is_active"] = true
	}

	// Set year
	pbData["year"] = year

	return pbData, nil
}
