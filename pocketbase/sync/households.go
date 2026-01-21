package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameHouseholds = "households"

// HouseholdsSync handles syncing household data from CampMinder
// Households are extracted from the persons response (includehouseholddetails=true)
type HouseholdsSync struct {
	BaseSyncService
}

// NewHouseholdsSync creates a new households sync service
func NewHouseholdsSync(app core.App, client *campminder.Client) *HouseholdsSync {
	return &HouseholdsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *HouseholdsSync) Name() string {
	return serviceNameHouseholds
}

// getPersonIDsFromAttendees gets unique person IDs from attendees for a specific year
func (s *HouseholdsSync) getPersonIDsFromAttendees(year int) ([]int, error) {
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

// Sync performs the households sync by extracting households from persons data
func (s *HouseholdsSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year
	existingRecords, err := s.PreloadRecords("households", filter, func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart(serviceNameHouseholds)
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
		slog.Info("No attendees found, skipping households sync", "year", year)
		s.SyncSuccessful = true
		s.LogSyncComplete("Households")
		return nil
	}

	slog.Info("Found unique persons from attendees for household extraction", "count", len(personIDs), "year", year)

	// Track unique households across all batches
	allHouseholds := make(map[int]map[string]interface{})

	// Process persons in batches to extract households
	batchSize := 500
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

		slog.Debug("Fetching persons batch for household extraction", "start", i+1, "end", end, "total", len(personIDs))

		// Fetch persons for this batch (includes household data via includehouseholddetails=true)
		persons, err := s.Client.GetPersons(batch)
		if err != nil {
			return fmt.Errorf("fetching persons batch: %w", err)
		}

		// Mark sync as successful once we've successfully fetched data
		if i == 0 && len(persons) > 0 {
			s.SyncSuccessful = true
		}

		// Extract unique households from this batch
		batchHouseholds := s.extractUniqueHouseholds(persons)
		for _, household := range batchHouseholds {
			if id, ok := household["ID"].(float64); ok && id > 0 {
				allHouseholds[int(id)] = household
			}
		}
	}

	slog.Info("Extracted unique households from persons", "count", len(allHouseholds))

	// Process each unique household
	compareFields := []string{"cm_id", "greeting", "mailing_title", "alternate_mailing_title", "billing_mailing_title", "household_phone", "billing_address", "last_updated_utc"}
	for householdID, householdData := range allHouseholds {
		// Transform to PocketBase format
		pbData, err := s.transformHouseholdToPB(householdData, year)
		if err != nil {
			slog.Error("Error transforming household", "id", householdID, "error", err)
			s.Stats.Errors++
			continue
		}

		// Track as processed
		s.TrackProcessedKey(householdID, year)

		// Process the record
		if err := s.ProcessSimpleRecord("households", householdID, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing household", "id", householdID, "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans
	if err := s.DeleteOrphans(
		"households",
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
		"household",
		filter,
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("Households")
	return nil
}

// extractUniqueHouseholds extracts unique households from persons data
func (s *HouseholdsSync) extractUniqueHouseholds(personsData []map[string]interface{}) []map[string]interface{} {
	householdMap := make(map[int]map[string]interface{})

	for _, person := range personsData {
		// Get Households object from person
		householdsObj, ok := person["Households"].(map[string]interface{})
		if !ok {
			continue
		}

		// Extract households from all three possible locations
		householdTypes := []string{"PrincipalHousehold", "PrimaryChildhoodHousehold", "AlternateChildhoodHousehold"}
		for _, hType := range householdTypes {
			if household, ok := householdsObj[hType].(map[string]interface{}); ok {
				if id, idOK := household["ID"].(float64); idOK && id > 0 {
					// Store household, deduplicating by ID
					householdMap[int(id)] = household
				}
			}
		}
	}

	// Convert map to slice
	result := make([]map[string]interface{}, 0, len(householdMap))
	for _, household := range householdMap {
		result = append(result, household)
	}

	return result
}

// transformHouseholdToPB transforms CampMinder household data to PocketBase format
func (s *HouseholdsSync) transformHouseholdToPB(
	data map[string]interface{},
	year int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract ID (required)
	idFloat, ok := data["ID"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing household ID")
	}
	pbData["cm_id"] = int(idFloat)

	// Extract optional text fields
	if greeting, ok := data["Greeting"].(string); ok {
		pbData["greeting"] = greeting
	} else {
		pbData["greeting"] = nil
	}

	if mailingTitle, ok := data["MailingTitle"].(string); ok {
		pbData["mailing_title"] = mailingTitle
	} else {
		pbData["mailing_title"] = nil
	}

	if altMailingTitle, ok := data["AlternateMailingTitle"].(string); ok {
		pbData["alternate_mailing_title"] = altMailingTitle
	} else {
		pbData["alternate_mailing_title"] = nil
	}

	if billingMailingTitle, ok := data["BillingMailingTitle"].(string); ok {
		pbData["billing_mailing_title"] = billingMailingTitle
	} else {
		pbData["billing_mailing_title"] = nil
	}

	if phone, ok := data["HouseholdPhone"].(string); ok {
		pbData["household_phone"] = phone
	} else {
		pbData["household_phone"] = nil
	}

	// Extract billing address as JSON
	pbData["billing_address"] = data["BillingAddress"]

	// Extract last updated
	pbData["last_updated_utc"] = data["LastUpdatedUTC"]

	// Set year
	pbData["year"] = year

	return pbData, nil
}
