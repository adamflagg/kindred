//nolint:dupl // Similar pattern to household_custom_field_values.go, intentional for person variant
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
const serviceNamePersonCustomValues = "person_custom_values"

// PersonCustomFieldValuesSync handles syncing custom field values for persons from CampMinder
// This is an ON-DEMAND sync (not part of daily sync) because it requires 1 API call per person
type PersonCustomFieldValuesSync struct {
	BaseSyncService
	Session     string                 // Session filter: "all", "1", "2", "2a", "3", "4", etc.
	Debug       bool                   // Enable debug logging
	rateLimiter *ratelimit.RateLimiter // Rate limiter for API calls
}

// NewPersonCustomFieldValuesSync creates a new person custom field values sync service
func NewPersonCustomFieldValuesSync(app core.App, client *campminder.Client) *PersonCustomFieldValuesSync {
	return &PersonCustomFieldValuesSync{
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
func (s *PersonCustomFieldValuesSync) Name() string {
	return serviceNamePersonCustomValues
}

// SetSession sets the session filter for this sync (e.g., "1", "2", "2a", "all")
func (s *PersonCustomFieldValuesSync) SetSession(session string) {
	s.Session = session
}

// SetDebug enables or disables debug logging
func (s *PersonCustomFieldValuesSync) SetDebug(debug bool) {
	s.Debug = debug
}

// Sync performs the person custom field values sync
func (s *PersonCustomFieldValuesSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()

	// Start the sync process
	s.LogSyncStart(serviceNamePersonCustomValues)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Get list of person IDs to sync based on session filter
	personIDs, err := s.getPersonIDsToSync(year)
	if err != nil {
		return fmt.Errorf("getting person IDs to sync: %w", err)
	}

	// Deduplicate person IDs (in case session resolver returns duplicates)
	seenPersonIDs := make(map[int]bool)
	uniquePersonIDs := make([]int, 0, len(personIDs))
	for _, id := range personIDs {
		if !seenPersonIDs[id] {
			seenPersonIDs[id] = true
			uniquePersonIDs = append(uniquePersonIDs, id)
		}
	}
	if len(uniquePersonIDs) < len(personIDs) {
		slog.Warn("Removed duplicate person IDs",
			"original", len(personIDs),
			"deduplicated", len(uniquePersonIDs))
	}
	personIDs = uniquePersonIDs

	if len(personIDs) == 0 {
		slog.Info("No persons to sync custom field values for",
			"session", s.Session,
			"year", year)
		s.SyncSuccessful = true
		s.LogSyncComplete("PersonCustomFieldValues")
		return nil
	}

	slog.Info("Syncing custom field values for persons",
		"count", len(personIDs),
		"session", s.Session,
		"year", year)

	// Pre-load person CM ID -> PB ID mapping for the year
	personMapping, err := s.preloadPersonMapping(year)
	if err != nil {
		return fmt.Errorf("preloading person mapping: %w", err)
	}

	// Pre-load field definition CM ID -> PB ID mapping
	fieldDefMapping, err := s.preloadFieldDefMapping()
	if err != nil {
		return fmt.Errorf("preloading field definition mapping: %w", err)
	}

	// Pre-load existing records for this year
	// KeyBuilder returns identity only (personPBId:fieldDefPBId)
	// PreloadCompositeRecords appends |year to create yearScopedKey
	filter := fmt.Sprintf("year = %d", year)
	preloadFn := func(record *core.Record) (string, bool) {
		personPBId := record.GetString("person")
		fieldDefPBId := record.GetString("field_definition")

		if personPBId != "" && fieldDefPBId != "" {
			// Return identity only - PreloadCompositeRecords adds |year
			return fmt.Sprintf("%s:%s", personPBId, fieldDefPBId), true
		}
		return "", false
	}
	existingRecords, err := s.PreloadCompositeRecords(
		"person_custom_values", filter, preloadFn)
	if err != nil {
		return fmt.Errorf("preloading existing records: %w", err)
	}

	s.SyncSuccessful = true

	// Process each person
	for i, personCMID := range personIDs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Log progress every 50 persons
		if i > 0 && i%50 == 0 {
			slog.Info("Custom field values sync progress",
				"processed", i,
				"total", len(personIDs),
				"percent", fmt.Sprintf("%.1f%%", float64(i)/float64(len(personIDs))*100))
		}

		// Get PB ID for this person
		personPBId, found := personMapping[personCMID]
		if !found {
			slog.Warn("Person not found in PocketBase, skipping custom field values",
				"person_cm_id", personCMID)
			continue
		}

		// Fetch custom field values for this person (paginated)
		err := s.syncPersonCustomFieldValues(
			ctx, personCMID, personPBId, year, fieldDefMapping, existingRecords)
		if err != nil {
			slog.Error("Error syncing custom field values for person",
				"person_cm_id", personCMID,
				"error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans (values no longer present in API response)
	if err := s.deleteOrphans(year); err != nil {
		slog.Error("Error deleting orphan custom field values", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("PersonCustomFieldValues")
	return nil
}

// preloadPersonMapping loads CM ID -> PB ID mapping for persons in the given year
func (s *PersonCustomFieldValuesSync) preloadPersonMapping(year int) (map[int]string, error) {
	filter := fmt.Sprintf("year = %d", year)
	persons, err := s.App.FindRecordsByFilter("persons", filter, "", 10000, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding persons: %w", err)
	}

	mapping := make(map[int]string, len(persons))
	for _, person := range persons {
		if cmID, ok := person.Get("cm_id").(float64); ok && cmID > 0 {
			mapping[int(cmID)] = person.Id
		}
	}

	if s.Debug {
		slog.Debug("Preloaded person mapping", "count", len(mapping))
	}

	return mapping, nil
}

// preloadFieldDefMapping loads CM ID -> PB ID mapping for custom field definitions
func (s *PersonCustomFieldValuesSync) preloadFieldDefMapping() (map[int]string, error) {
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

// getPersonIDsToSync returns the list of person CampMinder IDs to sync based on session filter
func (s *PersonCustomFieldValuesSync) getPersonIDsToSync(year int) ([]int, error) {
	// Use session resolver if session filter is specified
	if s.Session != "" && s.Session != DefaultSession {
		resolver := NewSessionResolver(s.App)
		personIDs, err := resolver.GetPersonIDsForSession(s.Session, year)
		if err != nil {
			return nil, err
		}

		if s.Debug {
			slog.Debug("Resolved session to person IDs",
				"session", s.Session,
				"count", len(personIDs),
				"year", year)
		}

		return personIDs, nil
	}

	// No session filter - get all persons synced for this year
	filter := fmt.Sprintf("year = %d", year)
	persons, err := s.App.FindRecordsByFilter("persons", filter, "", 10000, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding persons: %w", err)
	}

	personIDs := make([]int, 0, len(persons))
	for _, person := range persons {
		if cmID, ok := person.Get("cm_id").(float64); ok && cmID > 0 {
			personIDs = append(personIDs, int(cmID))
		}
	}

	if s.Debug {
		slog.Debug("Getting all persons for year",
			"count", len(personIDs),
			"year", year)
	}

	return personIDs, nil
}

// syncPersonCustomFieldValues fetches and stores custom field values for a single person
func (s *PersonCustomFieldValuesSync) syncPersonCustomFieldValues(
	ctx context.Context,
	personCMID int,
	personPBId string,
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
			values, hasMore, fetchErr = s.Client.GetPersonCustomFieldValuesPage(personCMID, page, pageSize)
			return fetchErr
		})
		if err != nil {
			return fmt.Errorf("fetching custom field values page %d after retries: %w", page, err)
		}

		// Process each value
		for _, valueData := range values {
			// Extract field ID from API response
			fieldCMIDFloat, ok := valueData["id"].(float64)
			if !ok || fieldCMIDFloat == 0 {
				slog.Warn("Invalid or missing field id in custom field value",
					"person_cm_id", personCMID)
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
						"person_cm_id", personCMID)
				}
				continue
			}

			// Transform to PB format (simplified: only value and year)
			pbData := s.transformPersonCustomFieldValueToPB(valueData, personPBId, fieldDefPBId, year)

			// Build composite key: identity only (no year)
			// yearScopedKey matches format from PreloadCompositeRecords
			compositeKey := fmt.Sprintf("%s:%s", personPBId, fieldDefPBId)
			yearScopedKey := fmt.Sprintf("%s|%d", compositeKey, year)

			// Track as processed using yearScopedKey format
			s.TrackProcessedKey(yearScopedKey, 0)

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
						slog.Error("Error updating custom field value",
							"error", err,
							"person_cm_id", personCMID,
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
				// Create new record
				collection, err := s.App.FindCollectionByNameOrId("person_custom_values")
				if err != nil {
					return fmt.Errorf("finding collection: %w", err)
				}

				record := core.NewRecord(collection)
				for key, val := range pbData {
					record.Set(key, val)
				}

				if err := s.App.Save(record); err != nil {
					valueStr, _ := pbData["value"].(string)
					slog.Error("Error creating custom field value",
						"error", err,
						"person_cm_id", personCMID,
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
func (s *PersonCustomFieldValuesSync) deleteOrphans(year int) error {
	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("person_custom_values", filter, "", 10000, 0, nil)
	if err != nil {
		return fmt.Errorf("finding records for orphan check: %w", err)
	}

	deleted := 0
	for _, record := range records {
		personPBId := record.GetString("person")
		fieldDefPBId := record.GetString("field_definition")
		recordYear := record.GetInt("year")

		// Use yearScopedKey format to match TrackProcessedKey
		yearScopedKey := fmt.Sprintf("%s:%s|%d", personPBId, fieldDefPBId, recordYear)

		if !s.ProcessedKeys[yearScopedKey] {
			// This value was not seen in the sync, delete it
			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphan custom field value",
					"person", personPBId,
					"field_definition", fieldDefPBId,
					"error", err)
			} else {
				deleted++
			}
		}
	}

	if deleted > 0 {
		slog.Info("Deleted orphan custom field values", "count", deleted)
	}

	return nil
}

// transformPersonCustomFieldValueToPB transforms CampMinder custom field value data to PocketBase format
// Schema: person, field_definition, value, year, last_updated (optional)
func (s *PersonCustomFieldValuesSync) transformPersonCustomFieldValueToPB(
	data map[string]interface{},
	personPBId string,
	fieldDefPBId string,
	year int,
) map[string]interface{} {
	pbData := make(map[string]interface{})

	// Set relations
	pbData["person"] = personPBId
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
