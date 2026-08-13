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
	rateLimiter *ratelimit.RateLimiter // Rate limiter for API calls
}

// NewPersonCustomFieldValuesSync creates a new person custom field values sync service
func NewPersonCustomFieldValuesSync(app core.App, client *campminder.Client) *PersonCustomFieldValuesSync {
	return &PersonCustomFieldValuesSync{
		BaseSyncService: NewBaseSyncService(app, client),
		Session:         DefaultSession, // Default to all sessions
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

	// Only persons whose values this run actually fetched may be judged by the
	// orphan sweep. A ?session= filter narrows the run to one session's persons
	// while the sweep's filter is the whole year, so without this set a
	// session-scoped run would delete every other session's values as orphans.
	sweptOwners := make(map[string]bool, len(personIDs))

	// Process each person
	for i, personCMID := range personIDs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Log progress every 50 persons
		if i > 0 && i%50 == 0 {
			slog.Info("Person custom field values sync progress",
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
			// A person whose fetch failed was not fully seen; leaving them out of
			// sweptOwners keeps the sweep from reading a partial fetch as deletions.
			continue
		}

		sweptOwners[personPBId] = true
	}

	// Delete orphans (values no longer present in API response)
	if err := s.deleteOrphans(year, sweptOwners); err != nil {
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
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// This lookup is year-scoped and the largest year on record holds 3,383
	// persons, so the old cap had headroom -- but headroom is not a guarantee,
	// and the failure mode is a narrowed sweep rather than an error.
	persons, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding persons: %w", err)
	}

	mapping := make(map[int]string, len(persons))
	for _, person := range persons {
		if cmID, ok := person.Get("cm_id").(float64); ok && cmID > 0 {
			mapping[int(cmID)] = person.Id
		}
	}

	s.DebugLog("Preloaded person mapping", "count", len(mapping))

	return mapping, nil
}

// preloadFieldDefMapping loads CM ID -> PB ID mapping for custom field definitions
func (s *PersonCustomFieldValuesSync) preloadFieldDefMapping() (map[int]string, error) {
	// Field definitions are global (no year filter)
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// custom_field_defs is NOT year-scoped: all 1,270 rows load every time. That
	// is the one here with no year to bound it, so it is the one that would
	// creep up on the cap first.
	fieldDefs, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding field definitions: %w", err)
	}

	mapping := make(map[int]string, len(fieldDefs))
	for _, fieldDef := range fieldDefs {
		if cmID, ok := fieldDef.Get("cm_id").(float64); ok && cmID > 0 {
			mapping[int(cmID)] = fieldDef.Id
		}
	}

	s.DebugLog("Preloaded field definition mapping", "count", len(mapping))

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

		s.DebugLog("Resolved session to person IDs",
			"session", s.Session,
			"count", len(personIDs),
			"year", year)

		return personIDs, nil
	}

	// No session filter - get all persons synced for this year
	filter := fmt.Sprintf("year = %d", year)
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// Feeds sweptOwners, which is what narrows the orphan sweep. A silent
	// truncation here would shrink the sweep's computed set as well, so the
	// two defects would compound rather than cancel.
	persons, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding persons: %w", err)
	}

	personIDs := make([]int, 0, len(persons))
	for _, person := range persons {
		if cmID, ok := person.Get("cm_id").(float64); ok && cmID > 0 {
			personIDs = append(personIDs, int(cmID))
		}
	}

	s.DebugLog("Getting all persons for year",
		"count", len(personIDs),
		"year", year)

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
		var values []map[string]any
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
				s.DebugLog("Field definition not found, skipping",
					"field_cm_id", fieldCMID,
					"person_cm_id", personCMID)
				continue
			}

			// Transform to PB format (simplified: only value and year)
			pbData := s.transformPersonCustomFieldValueToPB(valueData, personPBId, fieldDefPBId, year)

			// Build composite key: identity only (no year)
			// yearScopedKey matches format from PreloadCompositeRecords
			compositeKey := fmt.Sprintf("%s:%s", personPBId, fieldDefPBId)
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
				newValue, _ := pbData["value"].(string)
				if existing.GetString("value") != newValue || existingLastUpdated != newLastUpdated {
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

// deleteOrphans removes custom field values that were not seen in this sync.
//
// This used to be a hand-rolled loop over a single FindRecordsByFilter capped at
// 10,000 rows with no surrounding pagination (kindred#2266). 10,000 is a hard
// cap, not a page size: production years hold 128,606-184,458 rows, so the sweep
// inspected 5.4-7.8% of the year and a value deleted in CampMinder simply
// survived, feeding every derived table that reads this one. Routing through the
// shared guarded sweep replaces the cap with keyset pagination and picks up the
// collapse guard, so there is one implementation instead of a local copy.
//
// sweptOwners is the set of person PB IDs whose values were successfully fetched
// during THIS run, and it is what makes the fix safe rather than catastrophic.
// The sweep's filter is the whole year, but the computed set is only ever as
// wide as the run: this service takes a ?session= filter (api.go), and a
// session resolves to the persons enrolled in it -- in the current season the
// largest single session covers about 11% of the people who hold custom values.
// Uncapping the read without narrowing the judgement would have let one
// session-scoped run delete the other ~89% of the year as orphans. A row is a
// candidate only if this run actually fetched that person's values; anything else
// is invisible to the sweep, exactly as it should be.
func (s *PersonCustomFieldValuesSync) deleteOrphans(year int, sweptOwners map[string]bool) error {
	return s.DeleteOrphansGuarded(
		"person_custom_values",
		func(record *core.Record) (string, bool) {
			personPBId := record.GetString("person")
			if !sweptOwners[personPBId] {
				return "", false
			}

			// Matches TrackProcessedCompositeKey's "<identity>|<year>" format
			return fmt.Sprintf("%s:%s|%d",
				personPBId, record.GetString("field_definition"), record.GetInt("year")), true
		},
		"person custom field value",
		fmt.Sprintf("year = %d", year),
		OrphanSweepGuard{
			Entity:   "person_custom_values",
			Year:     year,
			Computed: len(s.ProcessedKeys),
			Hint: "check that the persons sync ran for that year, and that " +
				"custom_field_defs still holds these field definitions",
		},
	)
}

// transformPersonCustomFieldValueToPB transforms CampMinder custom field value data to PocketBase format
// Schema: person, field_definition, value, year, last_updated (optional)
func (s *PersonCustomFieldValuesSync) transformPersonCustomFieldValueToPB(
	data map[string]any,
	personPBId string,
	fieldDefPBId string,
	year int,
) map[string]any {
	pbData := make(map[string]any)

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
