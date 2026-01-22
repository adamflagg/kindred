package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameHouseholdCustomFieldValues = "household_custom_field_values"

// HouseholdCustomFieldValuesSync handles syncing custom field values for households from CampMinder
// This is an ON-DEMAND sync (not part of daily sync) because it requires 1 API call per household
type HouseholdCustomFieldValuesSync struct {
	BaseSyncService
	SessionFilter int // 0 = all sessions, 1-4 = specific session (filters by persons in session)
}

// NewHouseholdCustomFieldValuesSync creates a new household custom field values sync service
func NewHouseholdCustomFieldValuesSync(app core.App, client *campminder.Client) *HouseholdCustomFieldValuesSync {
	return &HouseholdCustomFieldValuesSync{
		BaseSyncService: NewBaseSyncService(app, client),
		SessionFilter:   0,
	}
}

// Name returns the name of this sync service
func (s *HouseholdCustomFieldValuesSync) Name() string {
	return serviceNameHouseholdCustomFieldValues
}

// SetSessionFilter sets the session filter for this sync
func (s *HouseholdCustomFieldValuesSync) SetSessionFilter(session int) {
	s.SessionFilter = session
}

// Sync performs the household custom field values sync
func (s *HouseholdCustomFieldValuesSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()

	// Start the sync process
	s.LogSyncStart(serviceNameHouseholdCustomFieldValues)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Get list of household IDs to sync based on session filter
	householdIDs, err := s.getHouseholdIDsToSync(year)
	if err != nil {
		return fmt.Errorf("getting household IDs to sync: %w", err)
	}

	if len(householdIDs) == 0 {
		slog.Info("No households to sync custom field values for")
		s.SyncSuccessful = true
		s.LogSyncComplete("HouseholdCustomFieldValues")
		return nil
	}

	slog.Info("Syncing custom field values for households",
		"count", len(householdIDs),
		"session_filter", s.SessionFilter,
		"year", year)

	// Pre-load existing records for this year
	filter := fmt.Sprintf("year = %d", year)
	existingRecords, err := s.PreloadCompositeRecords("household_custom_field_values", filter, func(record *core.Record) (string, bool) {
		householdID, _ := record.Get("household_id").(float64)
		fieldID, _ := record.Get("field_id").(float64)
		seasonID, _ := record.Get("season_id").(float64)

		if householdID > 0 && fieldID > 0 {
			return fmt.Sprintf("%d:%d:%d", int(householdID), int(fieldID), int(seasonID)), true
		}
		return "", false
	})
	if err != nil {
		return fmt.Errorf("preloading existing records: %w", err)
	}

	s.SyncSuccessful = true

	// Process each household
	for i, householdID := range householdIDs {
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

		// Fetch custom field values for this household
		if err := s.syncHouseholdCustomFieldValues(ctx, householdID, year, existingRecords); err != nil {
			slog.Error("Error syncing custom field values for household",
				"household_id", householdID,
				"error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans
	if err := s.deleteOrphans(year, householdIDs); err != nil {
		slog.Error("Error deleting orphan custom field values", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("HouseholdCustomFieldValues")
	return nil
}

// getHouseholdIDsToSync returns the list of household IDs to sync based on session filter
func (s *HouseholdCustomFieldValuesSync) getHouseholdIDsToSync(year int) ([]int, error) {
	if s.SessionFilter > 0 {
		// Get households for persons enrolled in the specific session
		sessionFilter := fmt.Sprintf("year = %d && session_type = 'main'", year)
		sessions, err := s.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 100, 0, nil)
		if err != nil {
			return nil, fmt.Errorf("finding sessions: %w", err)
		}

		var targetSessionID string
		for _, sess := range sessions {
			name := sess.GetString("name")
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

		// Get person IDs from attendees
		personIDSet := make(map[int]bool)
		for _, attendee := range attendees {
			if personID, ok := attendee.Get("person_id").(float64); ok && personID > 0 {
				personIDSet[int(personID)] = true
			}
		}

		// Get households for these persons
		householdIDSet := make(map[int]bool)
		personFilter := fmt.Sprintf("year = %d", year)
		persons, err := s.App.FindRecordsByFilter("persons", personFilter, "", 10000, 0, nil)
		if err != nil {
			return nil, fmt.Errorf("finding persons: %w", err)
		}

		for _, person := range persons {
			cmID, ok := person.Get("cm_id").(float64)
			if !ok || !personIDSet[int(cmID)] {
				continue
			}
			if householdID, ok := person.Get("household_id").(float64); ok && householdID > 0 {
				householdIDSet[int(householdID)] = true
			}
		}

		householdIDs := make([]int, 0, len(householdIDSet))
		for id := range householdIDSet {
			householdIDs = append(householdIDs, id)
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
	return householdIDs, nil
}

// syncHouseholdCustomFieldValues fetches and stores custom field values for a single household
func (s *HouseholdCustomFieldValuesSync) syncHouseholdCustomFieldValues(
	ctx context.Context,
	householdID int,
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

		values, hasMore, err := s.Client.GetHouseholdCustomFieldValuesPage(householdID, page, pageSize)
		if err != nil {
			return fmt.Errorf("fetching custom field values page %d: %w", page, err)
		}

		for _, valueData := range values {
			pbData, err := s.transformHouseholdCustomFieldValueToPB(valueData, householdID, year)
			if err != nil {
				slog.Error("Error transforming custom field value",
					"household_id", householdID,
					"error", err)
				s.Stats.Errors++
				continue
			}

			fieldID := pbData["field_id"].(int)
			seasonID := pbData["season_id"].(int)
			compositeKey := fmt.Sprintf("%d:%d:%d", householdID, fieldID, seasonID)

			s.TrackProcessedKey(compositeKey, 0)

			if existing, found := existingRecords[compositeKey]; found {
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
				collection, err := s.App.FindCollectionByNameOrId("household_custom_field_values")
				if err != nil {
					return fmt.Errorf("finding collection: %w", err)
				}

				record := core.NewRecord(collection)
				for key, val := range pbData {
					record.Set(key, val)
				}

				s.resolveRelations(record, householdID, fieldID, year)

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

// resolveRelations attempts to set the household and field_definition relation fields
func (s *HouseholdCustomFieldValuesSync) resolveRelations(record *core.Record, householdID, fieldID, year int) {
	householdFilter := fmt.Sprintf("cm_id = %d && year = %d", householdID, year)
	households, err := s.App.FindRecordsByFilter("households", householdFilter, "", 1, 0, nil)
	if err == nil && len(households) > 0 {
		record.Set("household", households[0].Id)
	}

	fieldFilter := fmt.Sprintf("cm_id = %d && year = %d", fieldID, year)
	fields, err := s.App.FindRecordsByFilter("custom_field_defs", fieldFilter, "", 1, 0, nil)
	if err == nil && len(fields) > 0 {
		record.Set("field_definition", fields[0].Id)
	}
}

// deleteOrphans removes custom field values for households not in the sync set
func (s *HouseholdCustomFieldValuesSync) deleteOrphans(year int, validHouseholdIDs []int) error {
	validSet := make(map[int]bool)
	for _, id := range validHouseholdIDs {
		validSet[id] = true
	}

	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("household_custom_field_values", filter, "", 10000, 0, nil)
	if err != nil {
		return fmt.Errorf("finding records for orphan check: %w", err)
	}

	deleted := 0
	for _, record := range records {
		householdID, ok := record.Get("household_id").(float64)
		if !ok {
			continue
		}

		fieldID, _ := record.Get("field_id").(float64)
		seasonID, _ := record.Get("season_id").(float64)
		compositeKey := fmt.Sprintf("%d:%d:%d", int(householdID), int(fieldID), int(seasonID))

		if !s.ProcessedKeys[compositeKey] {
			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphan custom field value",
					"household_id", int(householdID),
					"field_id", int(fieldID),
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
func (s *HouseholdCustomFieldValuesSync) transformHouseholdCustomFieldValueToPB(
	data map[string]interface{},
	householdID int,
	year int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	fieldIDFloat, ok := data["Id"].(float64)
	if !ok || fieldIDFloat == 0 {
		return nil, fmt.Errorf("invalid or missing custom field value Id")
	}
	pbData["field_id"] = int(fieldIDFloat)

	pbData["household_id"] = householdID

	if seasonID, ok := data["SeasonID"].(float64); ok {
		pbData["season_id"] = int(seasonID)
	} else {
		pbData["season_id"] = 0
	}

	if value, ok := data["Value"].(string); ok {
		pbData["value"] = value
	} else {
		pbData["value"] = ""
	}

	if lastUpdated, ok := data["LastUpdated"].(string); ok {
		pbData["last_updated"] = lastUpdated
	} else {
		pbData["last_updated"] = ""
	}

	pbData["year"] = year

	return pbData, nil
}
