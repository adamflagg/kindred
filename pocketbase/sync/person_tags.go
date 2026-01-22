package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNamePersonTags = "person_tags"

// PersonTagsSync handles syncing person tags from CampMinder
// Tags are extracted from the persons response (includetags=true)
type PersonTagsSync struct {
	BaseSyncService
}

// NewPersonTagsSync creates a new person tags sync service
func NewPersonTagsSync(app core.App, client *campminder.Client) *PersonTagsSync {
	return &PersonTagsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *PersonTagsSync) Name() string {
	return serviceNamePersonTags
}

// getPersonIDsFromAttendees gets unique person IDs from attendees for a specific year
func (s *PersonTagsSync) getPersonIDsFromAttendees(year int) ([]int, error) {
	// Query attendees for this year
	filter := fmt.Sprintf("year = %d", year)
	attendees, err := s.App.FindRecordsByFilter("attendees", filter, "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying attendees: %w", err)
	}

	// Extract unique person IDs
	personIDMap := make(map[int]bool)
	for _, attendee := range attendees {
		if cmPersonID, ok := attendee.Get("person_id").(float64); ok {
			personIDMap[int(cmPersonID)] = true
		}
	}

	// Convert map to slice
	personIDs := make([]int, 0, len(personIDMap))
	for id := range personIDMap {
		personIDs = append(personIDs, id)
	}

	return personIDs, nil
}

// Sync performs the person tags sync by extracting tags from persons data
func (s *PersonTagsSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year
	existingRecords, err := s.PreloadRecords("person_tags", filter, func(record *core.Record) (interface{}, bool) {
		personID, personOK := record.Get("person_id").(float64)
		tagName, tagOK := record.Get("tag_name").(string)
		yr, yearOK := record.Get("year").(float64)

		if personOK && tagOK && yearOK {
			// Create composite key: personID:tagName:year
			return fmt.Sprintf("%d:%s:%d", int(personID), tagName, int(yr)), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart(serviceNamePersonTags)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Get person IDs from attendees (same pattern as PersonsSync)
	personIDs, err := s.getPersonIDsFromAttendees(year)
	if err != nil {
		return fmt.Errorf("getting person IDs from attendees: %w", err)
	}

	if len(personIDs) == 0 {
		slog.Info("No attendees found, skipping person_tags sync", "year", year)
		s.SyncSuccessful = true
		s.LogSyncComplete("PersonTags")
		return nil
	}

	slog.Info("Found unique persons from attendees for tag extraction", "count", len(personIDs), "year", year)

	// Pre-load tag definitions for relation lookups
	// Note: person_tag_defs is global (no year filter - definitions are not year-specific)
	tagDefsByName := make(map[string]*core.Record)
	tagDefs, err := s.App.FindRecordsByFilter("person_tag_defs", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading tag definitions", "error", err)
	} else {
		for _, td := range tagDefs {
			if name, ok := td.Get("name").(string); ok && name != "" {
				tagDefsByName[name] = td
			}
		}
		slog.Info("Loaded tag definitions for relation lookup", "count", len(tagDefsByName))
	}

	// Pre-load persons for relation lookups
	personsByCMID := make(map[int]*core.Record)
	personFilter := fmt.Sprintf("year = %d", year)
	persons, err := s.App.FindRecordsByFilter("persons", personFilter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading persons", "error", err)
	} else {
		for _, p := range persons {
			if cmID, ok := p.Get("cm_id").(float64); ok {
				personsByCMID[int(cmID)] = p
			}
		}
		slog.Info("Loaded persons for relation lookup", "count", len(personsByCMID))
	}

	// Process persons in batches to extract tags
	batchSize := 500
	totalTagsProcessed := 0
	for i := 0; i < len(personIDs); i += batchSize {
		// Check context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Get batch
		end := i + batchSize
		if end > len(personIDs) {
			end = len(personIDs)
		}
		batch := personIDs[i:end]

		slog.Debug("Fetching persons batch for tag extraction", "start", i+1, "end", end, "total", len(personIDs))

		// Fetch persons for this batch (includes tags via includetags=true)
		personsData, err := s.Client.GetPersons(batch)
		if err != nil {
			return fmt.Errorf("fetching persons batch: %w", err)
		}

		// Mark sync as successful once we've successfully fetched data
		if i == 0 && len(personsData) > 0 {
			s.SyncSuccessful = true
		}

		// Extract and process tags from each person
		for _, personData := range personsData {
			personID, ok := personData["ID"].(float64)
			if !ok || personID == 0 {
				continue
			}

			tags := s.extractTagsFromPerson(personData)
			for _, tagData := range tags {
				pbData, err := s.transformPersonTagToPB(tagData, int(personID), year)
				if err != nil {
					slog.Debug("Error transforming person tag", "personID", int(personID), "error", err)
					s.Stats.Errors++
					continue
				}

				// Look up relations
				tagName, _ := pbData["tag_name"].(string)
				if tagDef, exists := tagDefsByName[tagName]; exists {
					pbData["tag_definition"] = tagDef.Id
				}
				if person, exists := personsByCMID[int(personID)]; exists {
					pbData["person"] = person.Id
				}

				// Create composite key for tracking
				compositeKey := fmt.Sprintf("%d:%s:%d", int(personID), tagName, year)

				// Track as processed (using string key)
				s.ProcessedKeys[compositeKey] = true

				// Process the record
				if err := s.processPersonTagRecord(compositeKey, pbData, existingRecords); err != nil {
					slog.Error("Error processing person tag", "personID", int(personID), "tagName", tagName, "error", err)
					s.Stats.Errors++
				}
				totalTagsProcessed++
			}
		}
	}

	slog.Info("Processed person tags", "total", totalTagsProcessed)

	// Delete orphans
	if err := s.deletePersonTagOrphans(year); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("PersonTags")
	return nil
}

// extractTagsFromPerson extracts tags from person data
func (s *PersonTagsSync) extractTagsFromPerson(personData map[string]interface{}) []map[string]interface{} {
	tagsRaw, ok := personData["Tags"]
	if !ok || tagsRaw == nil {
		return nil
	}

	tagsArray, ok := tagsRaw.([]interface{})
	if !ok {
		return nil
	}

	result := make([]map[string]interface{}, 0, len(tagsArray))
	for _, tagRaw := range tagsArray {
		if tag, ok := tagRaw.(map[string]interface{}); ok {
			result = append(result, tag)
		}
	}

	return result
}

// transformPersonTagToPB transforms CampMinder tag data to PocketBase format
func (s *PersonTagsSync) transformPersonTagToPB(
	data map[string]interface{},
	personID int,
	year int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract tag name (required)
	tagName, ok := data["Name"].(string)
	if !ok || tagName == "" {
		return nil, fmt.Errorf("invalid or missing tag Name")
	}
	pbData["tag_name"] = tagName

	// Set person ID
	pbData["person_id"] = personID

	// Extract last updated
	pbData["last_updated_utc"] = data["LastUpdatedUTC"]

	// Set year
	pbData["year"] = year

	return pbData, nil
}

// processPersonTagRecord processes a single person tag record
func (s *PersonTagsSync) processPersonTagRecord(
	compositeKey string,
	pbData map[string]interface{},
	existingRecords map[interface{}]*core.Record,
) error {
	compareFields := []string{"person_id", "tag_name", "year", "last_updated_utc", "person", "tag_definition"}

	existing := existingRecords[compositeKey]

	if existing != nil {
		// Check if update is needed
		needsUpdate := false
		for _, field := range compareFields {
			if value, exists := pbData[field]; exists {
				if !s.FieldEquals(existing.Get(field), value) {
					needsUpdate = true
					break
				}
			}
		}

		if needsUpdate {
			for field, value := range pbData {
				existing.Set(field, value)
			}
			if err := s.App.Save(existing); err != nil {
				return fmt.Errorf("updating person_tag: %w", err)
			}
			s.Stats.Updated++
		} else {
			s.Stats.Skipped++
		}
	} else {
		// Create new record
		collection, err := s.App.FindCollectionByNameOrId("person_tags")
		if err != nil {
			return fmt.Errorf("finding person_tags collection: %w", err)
		}

		record := core.NewRecord(collection)
		for field, value := range pbData {
			record.Set(field, value)
		}

		if err := s.App.Save(record); err != nil {
			return fmt.Errorf("creating person_tag: %w", err)
		}
		s.Stats.Created++
	}

	return nil
}

// deletePersonTagOrphans deletes person tags that weren't processed
func (s *PersonTagsSync) deletePersonTagOrphans(year int) error {
	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("person_tags", filter, "", 0, 0)
	if err != nil {
		return fmt.Errorf("loading person_tags for orphan check: %w", err)
	}

	deleted := 0
	for _, record := range records {
		personID, personOK := record.Get("person_id").(float64)
		tagName, tagOK := record.Get("tag_name").(string)
		yr, yearOK := record.Get("year").(float64)

		if !personOK || !tagOK || !yearOK {
			continue
		}

		compositeKey := fmt.Sprintf("%d:%s:%d", int(personID), tagName, int(yr))

		// Check if this record was processed
		if !s.ProcessedKeys[compositeKey] {
			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphaned person_tag", "key", compositeKey, "error", err)
				s.Stats.Errors++
			} else {
				deleted++
			}
		}
	}

	if deleted > 0 {
		slog.Info("Deleted orphaned person_tags", "count", deleted)
		s.Stats.Deleted = deleted
	}

	return nil
}
