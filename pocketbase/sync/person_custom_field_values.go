package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNamePersonCustomFieldValues = "person_custom_field_values"

// PersonCustomFieldValuesSync handles syncing custom field values for persons from CampMinder
// This is an ON-DEMAND sync (not part of daily sync) because it requires 1 API call per person
type PersonCustomFieldValuesSync struct {
	BaseSyncService
	SessionFilter int // 0 = all sessions, 1-4 = specific session
}

// NewPersonCustomFieldValuesSync creates a new person custom field values sync service
func NewPersonCustomFieldValuesSync(app core.App, client *campminder.Client) *PersonCustomFieldValuesSync {
	return &PersonCustomFieldValuesSync{
		BaseSyncService: NewBaseSyncService(app, client),
		SessionFilter:   0, // Default to all sessions
	}
}

// Name returns the name of this sync service
func (s *PersonCustomFieldValuesSync) Name() string {
	return serviceNamePersonCustomFieldValues
}

// SetSessionFilter sets the session filter for this sync
func (s *PersonCustomFieldValuesSync) SetSessionFilter(session int) {
	s.SessionFilter = session
}

// Sync performs the person custom field values sync
func (s *PersonCustomFieldValuesSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()

	// Start the sync process
	s.LogSyncStart(serviceNamePersonCustomFieldValues)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Get list of person IDs to sync based on session filter
	personIDs, err := s.getPersonIDsToSync(year)
	if err != nil {
		return fmt.Errorf("getting person IDs to sync: %w", err)
	}

	if len(personIDs) == 0 {
		slog.Info("No persons to sync custom field values for")
		s.SyncSuccessful = true
		s.LogSyncComplete("PersonCustomFieldValues")
		return nil
	}

	slog.Info("Syncing custom field values for persons",
		"count", len(personIDs),
		"session_filter", s.SessionFilter,
		"year", year)

	// Pre-load existing records for this year
	filter := fmt.Sprintf("year = %d", year)
	existingRecords, err := s.PreloadCompositeRecords("person_custom_field_values", filter, func(record *core.Record) (string, bool) {
		personID, _ := record.Get("person_id").(float64)
		fieldID, _ := record.Get("field_id").(float64)
		seasonID, _ := record.Get("season_id").(float64)

		if personID > 0 && fieldID > 0 {
			// Composite key: person_id:field_id:season_id
			return fmt.Sprintf("%d:%d:%d", int(personID), int(fieldID), int(seasonID)), true
		}
		return "", false
	})
	if err != nil {
		return fmt.Errorf("preloading existing records: %w", err)
	}

	s.SyncSuccessful = true

	// Process each person
	for i, personID := range personIDs {
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

		// Fetch custom field values for this person (paginated)
		if err := s.syncPersonCustomFieldValues(ctx, personID, year, existingRecords); err != nil {
			slog.Error("Error syncing custom field values for person",
				"person_id", personID,
				"error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans (values for persons no longer in the sync set)
	if err := s.deleteOrphans(year, personIDs); err != nil {
		slog.Error("Error deleting orphan custom field values", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("PersonCustomFieldValues")
	return nil
}

// getPersonIDsToSync returns the list of person IDs to sync based on session filter
func (s *PersonCustomFieldValuesSync) getPersonIDsToSync(year int) ([]int, error) {
	var filter string

	if s.SessionFilter > 0 {
		// Get persons enrolled in the specific session
		// First, find the session by session number (1-4 maps to session names)
		sessionFilter := fmt.Sprintf("year = %d && session_type = 'main'", year)
		sessions, err := s.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 100, 0, nil)
		if err != nil {
			return nil, fmt.Errorf("finding sessions: %w", err)
		}

		// Find the session that matches our filter (session 1, 2, 3, or 4)
		var targetSessionID string
		for _, sess := range sessions {
			name := sess.GetString("name")
			// Match session number in name (e.g., "Session 1", "Session 2", etc.)
			if name == fmt.Sprintf("Session %d", s.SessionFilter) {
				targetSessionID = sess.Id
				break
			}
		}

		if targetSessionID == "" {
			return nil, fmt.Errorf("session %d not found for year %d", s.SessionFilter, year)
		}

		// Get attendees for this session
		attendeeFilter := fmt.Sprintf("year = %d && session = '%s'", year, targetSessionID)
		attendees, err := s.App.FindRecordsByFilter("attendees", attendeeFilter, "", 10000, 0, nil)
		if err != nil {
			return nil, fmt.Errorf("finding attendees: %w", err)
		}

		// Extract unique person IDs
		personIDSet := make(map[int]bool)
		for _, attendee := range attendees {
			if personID, ok := attendee.Get("person_id").(float64); ok && personID > 0 {
				personIDSet[int(personID)] = true
			}
		}

		personIDs := make([]int, 0, len(personIDSet))
		for id := range personIDSet {
			personIDs = append(personIDs, id)
		}
		return personIDs, nil
	}

	// No session filter - get all persons synced for this year
	filter = fmt.Sprintf("year = %d", year)
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
	return personIDs, nil
}

// syncPersonCustomFieldValues fetches and stores custom field values for a single person
func (s *PersonCustomFieldValuesSync) syncPersonCustomFieldValues(
	ctx context.Context,
	personID int,
	year int,
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

		// Fetch page of custom field values
		values, hasMore, err := s.Client.GetPersonCustomFieldValuesPage(personID, page, pageSize)
		if err != nil {
			return fmt.Errorf("fetching custom field values page %d: %w", page, err)
		}

		// Process each value
		for _, valueData := range values {
			pbData, err := s.transformPersonCustomFieldValueToPB(valueData, personID, year)
			if err != nil {
				slog.Error("Error transforming custom field value",
					"person_id", personID,
					"error", err)
				s.Stats.Errors++
				continue
			}

			// Build composite key
			fieldID := pbData["field_id"].(int)
			seasonID := pbData["season_id"].(int)
			compositeKey := fmt.Sprintf("%d:%d:%d", personID, fieldID, seasonID)

			// Track as processed
			s.TrackProcessedKey(compositeKey, 0) // 0 because key already includes all components

			// Check for existing record
			if existing, found := existingRecords[compositeKey]; found {
				// Update if changed
				changed := false
				if existing.GetString("value") != pbData["value"].(string) {
					changed = true
				}
				if existing.GetString("last_updated") != pbData["last_updated"].(string) {
					changed = true
				}

				if changed {
					for key, val := range pbData {
						existing.Set(key, val)
					}
					if err := s.App.Save(existing); err != nil {
						slog.Error("Error updating custom field value", "error", err)
						s.Stats.Errors++
					} else {
						s.Stats.Updated++
					}
				} else {
					s.Stats.Skipped++
				}
			} else {
				// Create new record
				collection, err := s.App.FindCollectionByNameOrId("person_custom_field_values")
				if err != nil {
					return fmt.Errorf("finding collection: %w", err)
				}

				record := core.NewRecord(collection)
				for key, val := range pbData {
					record.Set(key, val)
				}

				// Try to resolve relations
				s.resolveRelations(record, personID, fieldID, year)

				if err := s.App.Save(record); err != nil {
					slog.Error("Error creating custom field value", "error", err)
					s.Stats.Errors++
				} else {
					s.Stats.Created++
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

// resolveRelations attempts to set the person and field_definition relation fields
func (s *PersonCustomFieldValuesSync) resolveRelations(record *core.Record, personID, fieldID, year int) {
	// Resolve person relation
	personFilter := fmt.Sprintf("cm_id = %d && year = %d", personID, year)
	persons, err := s.App.FindRecordsByFilter("persons", personFilter, "", 1, 0, nil)
	if err == nil && len(persons) > 0 {
		record.Set("person", persons[0].Id)
	}

	// Resolve field_definition relation (no year filter - definitions are global)
	fieldFilter := fmt.Sprintf("cm_id = %d", fieldID)
	fields, err := s.App.FindRecordsByFilter("custom_field_defs", fieldFilter, "", 1, 0, nil)
	if err == nil && len(fields) > 0 {
		record.Set("field_definition", fields[0].Id)
	}
}

// deleteOrphans removes custom field values for persons not in the sync set
func (s *PersonCustomFieldValuesSync) deleteOrphans(year int, validPersonIDs []int) error {
	// Build set of valid person IDs
	validSet := make(map[int]bool)
	for _, id := range validPersonIDs {
		validSet[id] = true
	}

	// Find records for persons not in valid set
	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("person_custom_field_values", filter, "", 10000, 0, nil)
	if err != nil {
		return fmt.Errorf("finding records for orphan check: %w", err)
	}

	deleted := 0
	for _, record := range records {
		personID, ok := record.Get("person_id").(float64)
		if !ok {
			continue
		}

		// Check if this value was processed (still valid)
		fieldID, _ := record.Get("field_id").(float64)
		seasonID, _ := record.Get("season_id").(float64)
		compositeKey := fmt.Sprintf("%d:%d:%d", int(personID), int(fieldID), int(seasonID))

		if !s.ProcessedKeys[compositeKey] {
			// This value was not seen in the sync, delete it
			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphan custom field value",
					"person_id", int(personID),
					"field_id", int(fieldID),
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
func (s *PersonCustomFieldValuesSync) transformPersonCustomFieldValueToPB(
	data map[string]interface{},
	personID int,
	year int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract field ID (required) - this is the custom field definition ID
	fieldIDFloat, ok := data["Id"].(float64)
	if !ok || fieldIDFloat == 0 {
		return nil, fmt.Errorf("invalid or missing custom field value Id")
	}
	pbData["field_id"] = int(fieldIDFloat)

	// Set person ID
	pbData["person_id"] = personID

	// Extract season ID (optional - 0 for non-seasonal fields)
	if seasonID, ok := data["SeasonID"].(float64); ok {
		pbData["season_id"] = int(seasonID)
	} else {
		pbData["season_id"] = 0
	}

	// Extract value (can be empty or nil)
	if value, ok := data["Value"].(string); ok {
		pbData["value"] = value
	} else {
		pbData["value"] = ""
	}

	// Extract last updated
	if lastUpdated, ok := data["LastUpdated"].(string); ok {
		pbData["last_updated"] = lastUpdated
	} else {
		pbData["last_updated"] = ""
	}

	// Set year
	pbData["year"] = year

	return pbData, nil
}
