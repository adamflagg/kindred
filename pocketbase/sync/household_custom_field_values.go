//nolint:dupl // Similar pattern to person_custom_field_values.go, intentional for household variant
package sync

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/camp/kindred/pocketbase/ratelimit"
)

// Service name constant - uses new table name
const serviceNameHouseholdCustomValues = "household_custom_values"

// HouseholdCustomFieldValuesSync handles syncing custom field values for households from CampMinder
// This is an ON-DEMAND sync (not part of daily sync) because it requires 1 API call per household
type HouseholdCustomFieldValuesSync struct {
	BaseSyncService
	Session     string                 // Session filter: "all", "1", "2", "2a", "3", "4", etc.
	Debug       bool                   // Enable debug logging
	rateLimiter *ratelimit.RateLimiter // Rate limiter for API calls
}

// NewHouseholdCustomFieldValuesSync creates a new household custom field values sync service
func NewHouseholdCustomFieldValuesSync(app core.App, client *campminder.Client) *HouseholdCustomFieldValuesSync {
	return &HouseholdCustomFieldValuesSync{
		BaseSyncService: NewBaseSyncService(app, client),
		Session:         DefaultSession, // Default to all sessions
		Debug:           false,
		rateLimiter: ratelimit.NewRateLimiter(&ratelimit.Config{
			APIDelay:          300 * time.Millisecond, // ~3 req/sec
			BackoffMultiplier: 2.0,
			MaxDelay:          120 * time.Second, // CampMinder rate limits are aggressive
			MaxAttempts:       10,
		}),
	}
}

// Name returns the name of this sync service
func (s *HouseholdCustomFieldValuesSync) Name() string {
	return serviceNameHouseholdCustomValues
}

// SetSession sets the session filter for this sync (e.g., "1", "2", "2a", "all")
func (s *HouseholdCustomFieldValuesSync) SetSession(session string) {
	s.Session = session
}

// SetDebug enables or disables debug logging
func (s *HouseholdCustomFieldValuesSync) SetDebug(debug bool) {
	s.Debug = debug
}

// Sync performs the household custom field values sync
func (s *HouseholdCustomFieldValuesSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()

	// Start the sync process
	s.LogSyncStart(serviceNameHouseholdCustomValues)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Get list of household IDs to sync based on session filter
	householdIDs, err := s.getHouseholdIDsToSync(year)
	if err != nil {
		return fmt.Errorf("getting household IDs to sync: %w", err)
	}

	// Deduplicate household IDs (in case session resolver returns duplicates)
	seenHouseholdIDs := make(map[int]bool)
	uniqueHouseholdIDs := make([]int, 0, len(householdIDs))
	for _, id := range householdIDs {
		if !seenHouseholdIDs[id] {
			seenHouseholdIDs[id] = true
			uniqueHouseholdIDs = append(uniqueHouseholdIDs, id)
		}
	}
	if len(uniqueHouseholdIDs) < len(householdIDs) {
		slog.Warn("Removed duplicate household IDs",
			"original", len(householdIDs),
			"deduplicated", len(uniqueHouseholdIDs))
	}
	householdIDs = uniqueHouseholdIDs

	if len(householdIDs) == 0 {
		slog.Info("No households to sync custom field values for",
			"session", s.Session,
			"year", year)
		s.SyncSuccessful = true
		s.LogSyncComplete("HouseholdCustomFieldValues")
		return nil
	}

	slog.Info("Syncing custom field values for households",
		"count", len(householdIDs),
		"session", s.Session,
		"year", year)

	// Pre-load household CM ID -> PB ID mapping for the year
	householdMapping, err := s.preloadHouseholdMapping(year)
	if err != nil {
		return fmt.Errorf("preloading household mapping: %w", err)
	}

	// Pre-load field definition CM ID -> PB ID mapping
	fieldDefMapping, err := s.preloadFieldDefMapping()
	if err != nil {
		return fmt.Errorf("preloading field definition mapping: %w", err)
	}

	// Pre-load existing records for this year
	// KeyBuilder returns identity only (householdPBId:fieldDefPBId)
	// PreloadCompositeRecords appends |year to create yearScopedKey
	filter := fmt.Sprintf("year = %d", year)
	preloadFn := func(record *core.Record) (string, bool) {
		householdPBId := record.GetString("household")
		fieldDefPBId := record.GetString("field_definition")

		if householdPBId != "" && fieldDefPBId != "" {
			// Return identity only - PreloadCompositeRecords adds |year
			return fmt.Sprintf("%s:%s", householdPBId, fieldDefPBId), true
		}
		return "", false
	}
	existingRecords, err := s.PreloadCompositeRecords(
		"household_custom_values", filter, preloadFn)
	if err != nil {
		return fmt.Errorf("preloading existing records: %w", err)
	}

	s.SyncSuccessful = true

	// Process each household
	for i, householdCMID := range householdIDs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Log progress every 50 households
		if i > 0 && i%50 == 0 {
			slog.Info("Household custom field values sync progress",
				"processed", i,
				"total", len(householdIDs),
				"percent", fmt.Sprintf("%.1f%%", float64(i)/float64(len(householdIDs))*100))
		}

		// Get PB ID for this household
		householdPBId, found := householdMapping[householdCMID]
		if !found {
			slog.Warn("Household not found in PocketBase, skipping custom field values",
				"household_cm_id", householdCMID)
			continue
		}

		// Fetch custom field values for this household
		err := s.syncHouseholdCustomFieldValues(
			ctx, householdCMID, householdPBId, year, fieldDefMapping, existingRecords)
		if err != nil {
			slog.Error("Error syncing custom field values for household",
				"household_cm_id", householdCMID,
				"error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans
	if err := s.deleteOrphans(year); err != nil {
		slog.Error("Error deleting orphan custom field values", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("HouseholdCustomFieldValues")
	return nil
}

// preloadHouseholdMapping loads CM ID -> PB ID mapping for households in the given year
func (s *HouseholdCustomFieldValuesSync) preloadHouseholdMapping(year int) (map[int]string, error) {
	filter := fmt.Sprintf("year = %d", year)
	households, err := s.App.FindRecordsByFilter("households", filter, "", 10000, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding households: %w", err)
	}

	mapping := make(map[int]string, len(households))
	for _, household := range households {
		if cmID, ok := household.Get("cm_id").(float64); ok && cmID > 0 {
			mapping[int(cmID)] = household.Id
		}
	}

	if s.Debug {
		slog.Debug("Preloaded household mapping", "count", len(mapping))
	}

	return mapping, nil
}

// preloadFieldDefMapping loads CM ID -> PB ID mapping for custom field definitions
func (s *HouseholdCustomFieldValuesSync) preloadFieldDefMapping() (map[int]string, error) {
	// Field definitions are global (no year filter)
	fieldDefs, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 10000, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding field definitions: %w", err)
	}

	mapping := make(map[int]string, len(fieldDefs))
	for _, fieldDef := range fieldDefs {
		if cmID, ok := fieldDef.Get("cm_id").(float64); ok && cmID > 0 {
			mapping[int(cmID)] = fieldDef.Id
		}
	}

	if s.Debug {
		slog.Debug("Preloaded field definition mapping", "count", len(mapping))
	}

	return mapping, nil
}

// getHouseholdIDsToSync returns the list of household CampMinder IDs to sync based on session filter
func (s *HouseholdCustomFieldValuesSync) getHouseholdIDsToSync(year int) ([]int, error) {
	// Use session resolver if session filter is specified
	if s.Session != "" && s.Session != DefaultSession {
		resolver := NewSessionResolver(s.App)
		householdIDs, err := resolver.GetHouseholdIDsForSession(s.Session, year)
		if err != nil {
			return nil, err
		}

		if s.Debug {
			slog.Debug("Resolved session to household IDs",
				"session", s.Session,
				"count", len(householdIDs),
				"year", year)
		}

		return householdIDs, nil
	}

	// No session filter - get all households synced for this year
	filter := fmt.Sprintf("year = %d", year)
	households, err := s.App.FindRecordsByFilter("households", filter, "", 10000, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding households: %w", err)
	}

	householdIDs := make([]int, 0, len(households))
	for _, household := range households {
		if cmID, ok := household.Get("cm_id").(float64); ok && cmID > 0 {
			householdIDs = append(householdIDs, int(cmID))
		}
	}

	if s.Debug {
		slog.Debug("Getting all households for year",
			"count", len(householdIDs),
			"year", year)
	}

	return householdIDs, nil
}

// syncHouseholdCustomFieldValues fetches and stores custom field values for a single household
func (s *HouseholdCustomFieldValuesSync) syncHouseholdCustomFieldValues(
	ctx context.Context,
	householdCMID int,
	householdPBId string,
	year int,
	fieldDefMapping map[int]string,
	existingRecords map[string]*core.Record,
) error {
	page := 1
	pageSize := LargePageSize

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Fetch page of custom field values with rate limiting and retry
		var values []map[string]interface{}
		var hasMore bool

		err := s.rateLimiter.ExecuteWithRetry(ctx, func() error {
			var fetchErr error
			values, hasMore, fetchErr = s.Client.GetHouseholdCustomFieldValuesPage(householdCMID, page, pageSize)
			return fetchErr
		})
		if err != nil {
			return fmt.Errorf("fetching custom field values page %d after retries: %w", page, err)
		}

		for _, valueData := range values {
			// Extract field ID from API response
			fieldCMIDFloat, ok := valueData["id"].(float64)
			if !ok || fieldCMIDFloat == 0 {
				slog.Warn("Invalid or missing field id in custom field value",
					"household_cm_id", householdCMID)
				s.Stats.Errors++
				continue
			}
			fieldCMID := int(fieldCMIDFloat)

			// Look up field definition PB ID
			fieldDefPBId, found := fieldDefMapping[fieldCMID]
			if !found {
				// Field definition not synced, skip
				if s.Debug {
					slog.Debug("Field definition not found, skipping",
						"field_cm_id", fieldCMID,
						"household_cm_id", householdCMID)
				}
				continue
			}

			// Transform to PB format (simplified: only value and year)
			pbData := s.transformHouseholdCustomFieldValueToPB(valueData, householdPBId, fieldDefPBId, year)

			// Build composite key: identity only (no year)
			// yearScopedKey matches format from PreloadCompositeRecords
			compositeKey := fmt.Sprintf("%s:%s", householdPBId, fieldDefPBId)
			yearScopedKey := fmt.Sprintf("%s|%d", compositeKey, year)

			// Track as processed using yearScopedKey format
			// Use TrackProcessedCompositeKey to avoid double year suffix:
			// TrackProcessedKey(yearScopedKey, 0) would create "key|year|0"
			// but deleteOrphans looks for "key|year"
			s.TrackProcessedCompositeKey(compositeKey, year)

			// Check for existing record using yearScopedKey
			if existing, found := existingRecords[yearScopedKey]; found {
				// Fast path: if lastUpdated unchanged, skip entirely
				existingLastUpdated := existing.GetString("last_updated")
				newLastUpdated, hasNewLastUpdated := pbData["last_updated"].(string)

				if existingLastUpdated != "" && hasNewLastUpdated && existingLastUpdated == newLastUpdated {
					// lastUpdated matches - no changes, skip update
					s.Stats.Skipped++
					continue
				}

				// Value or lastUpdated changed - update record
				if existing.GetString("value") != pbData["value"].(string) || existingLastUpdated != newLastUpdated {
					for key, val := range pbData {
						existing.Set(key, val)
					}
					if err := s.App.Save(existing); err != nil {
						valueStr, _ := pbData["value"].(string)
						slog.Error("Error updating household custom field value",
							"error", err,
							"household_cm_id", householdCMID,
							"field_cm_id", fieldCMID,
							"value_length", len(valueStr))
						s.Stats.Errors++
					} else {
						s.Stats.Updated++
					}
				} else {
					s.Stats.Skipped++
				}
			} else {
				collection, err := s.App.FindCollectionByNameOrId("household_custom_values")
				if err != nil {
					return fmt.Errorf("finding collection: %w", err)
				}

				record := core.NewRecord(collection)
				for key, val := range pbData {
					record.Set(key, val)
				}

				if err := s.App.Save(record); err != nil {
					valueStr, _ := pbData["value"].(string)
					slog.Error("Error creating household custom field value",
						"error", err,
						"household_cm_id", householdCMID,
						"field_cm_id", fieldCMID,
						"value_length", len(valueStr))
					s.Stats.Errors++
				} else {
					s.Stats.Created++
					// Add to existingRecords to prevent duplicate creation if API returns duplicates
					existingRecords[yearScopedKey] = record
				}
			}
		}

		if !hasMore || len(values) == 0 {
			break
		}
		page++
	}

	return nil
}

// deleteOrphans removes custom field values that were not seen in this sync
func (s *HouseholdCustomFieldValuesSync) deleteOrphans(year int) error {
	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("household_custom_values", filter, "", 10000, 0, nil)
	if err != nil {
		return fmt.Errorf("finding records for orphan check: %w", err)
	}

	deleted := 0
	for _, record := range records {
		householdPBId := record.GetString("household")
		fieldDefPBId := record.GetString("field_definition")
		recordYear := record.GetInt("year")

		// Use yearScopedKey format to match TrackProcessedKey
		yearScopedKey := fmt.Sprintf("%s:%s|%d", householdPBId, fieldDefPBId, recordYear)

		if !s.ProcessedKeys[yearScopedKey] {
			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphan custom field value",
					"household", householdPBId,
					"field_definition", fieldDefPBId,
					"error", err)
			} else {
				deleted++
			}
		}
	}

	if deleted > 0 {
		slog.Info("Deleted orphan household custom field values", "count", deleted)
	}

	return nil
}

// transformHouseholdCustomFieldValueToPB transforms CampMinder custom field value data to PocketBase format
// Schema: household, field_definition, value, year, last_updated (optional)
func (s *HouseholdCustomFieldValuesSync) transformHouseholdCustomFieldValueToPB(
	data map[string]interface{},
	householdPBId string,
	fieldDefPBId string,
	year int,
) map[string]interface{} {
	pbData := make(map[string]interface{})

	// Set relations
	pbData["household"] = householdPBId
	pbData["field_definition"] = fieldDefPBId

	// Extract value (can be empty or nil)
	if value, ok := data["value"].(string); ok {
		pbData["value"] = value
	} else {
		pbData["value"] = ""
	}

	// Set year
	pbData["year"] = year

	// Capture lastUpdated for delta sync (if present and non-empty)
	if lastUpdated, ok := data["lastUpdated"].(string); ok && lastUpdated != "" {
		pbData["last_updated"] = lastUpdated
	}

	return pbData
}
