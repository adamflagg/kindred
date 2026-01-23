package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameCustomFieldDefinitions = "custom_field_defs"

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
// Note: Custom field definitions are global (not year-specific) in CampMinder's API
func (s *CustomFieldDefinitionsSync) Sync(ctx context.Context) error {
	// Pre-load all existing records (no year filter - definitions are global)
	// Use PreloadRecordsGlobal since this table has no year field
	existingRecords, err := s.PreloadRecordsGlobal("custom_field_defs", "", func(record *core.Record) (interface{}, bool) {
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
			pbData, err := s.transformCustomFieldDefinitionToPB(defData)
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

			// Track as processed (no year - definitions are global)
			s.TrackProcessedKey(cmID, 0)

			// Process the record using cm_id as key
			compareFields := []string{"cm_id", "name", "data_type", "partition", "is_seasonal", "is_array", "is_active"}
			err = s.ProcessSimpleRecordGlobal(
				"custom_field_defs", cmID, pbData, existingRecords, compareFields)
			if err != nil {
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

	// Delete orphans (no year filter - definitions are global)
	if err := s.DeleteOrphans(
		"custom_field_defs",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			cmID, cmIDOK := cmIDValue.(float64)
			if cmIDOK && cmID > 0 {
				// Use CompositeKey to match TrackProcessedKey format (cmID|0)
				return CompositeKey(int(cmID), 0), true
			}
			return "", false
		},
		"custom_field_definition",
		"", // No filter - all records
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
// Note: CampMinder /persons/custom-fields endpoint uses camelCase field names
func (s *CustomFieldDefinitionsSync) transformCustomFieldDefinitionToPB(
	data map[string]interface{},
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract ID (required) - API uses "id" (camelCase)
	idFloat, ok := data["id"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing custom field definition id")
	}
	pbData["cm_id"] = int(idFloat)

	// Extract name (required)
	name, ok := data["name"].(string)
	if !ok || name == "" {
		return nil, fmt.Errorf("invalid or missing custom field definition name")
	}
	pbData["name"] = name

	// Extract optional fields with defaults (all camelCase from API)
	if dataType, ok := data["dataType"].(string); ok {
		pbData["data_type"] = dataType
	} else {
		pbData["data_type"] = "None"
	}

	// Handle partition as multi-select (CampMinder returns comma-separated values like "Camper, Adult")
	if partition, ok := data["partition"].(string); ok && partition != "" {
		// Split by ", " (comma + space) to handle multi-value partitions
		parts := strings.Split(partition, ", ")
		pbData["partition"] = parts
	} else {
		pbData["partition"] = []string{"None"}
	}

	if isSeasonal, ok := data["isSeasonal"].(bool); ok {
		pbData["is_seasonal"] = isSeasonal
	} else {
		pbData["is_seasonal"] = false
	}

	if isArray, ok := data["isArray"].(bool); ok {
		pbData["is_array"] = isArray
	} else {
		pbData["is_array"] = false
	}

	if isActive, ok := data["isActive"].(bool); ok {
		pbData["is_active"] = isActive
	} else {
		pbData["is_active"] = true
	}

	return pbData, nil
}
