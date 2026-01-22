package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameDivisionAttendees = "division_attendees"

// DivisionAttendeesSync handles syncing division attendee assignments from CampMinder
type DivisionAttendeesSync struct {
	BaseSyncService
}

// NewDivisionAttendeesSync creates a new division attendees sync service
func NewDivisionAttendeesSync(app core.App, client *campminder.Client) *DivisionAttendeesSync {
	return &DivisionAttendeesSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *DivisionAttendeesSync) Name() string {
	return serviceNameDivisionAttendees
}

// Sync performs the division attendees sync
// Note: Division attendees are year-scoped - they track which persons are in which divisions
// Division is derived from the person's existing division relation (not from API DivisionID)
func (s *DivisionAttendeesSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load all existing records for this year
	// Use composite key of person_id + division_id as the unique identifier
	existingRecords, err := s.PreloadRecords("division_attendees", filter, func(record *core.Record) (any, bool) {
		personID, pOK := record.Get("person_id").(float64)
		divisionID, dOK := record.Get("division_id").(float64)
		if pOK && personID > 0 && dOK && divisionID > 0 {
			// Create composite key for person+division
			return fmt.Sprintf("%d|%d", int(personID), int(divisionID)), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart(serviceNameDivisionAttendees)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Build reverse lookup: PocketBase division ID -> CampMinder division ID
	divisionCMIDByPBID := make(map[string]int)
	allDivisions, err := s.App.FindRecordsByFilter("divisions", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading divisions", "error", err)
	} else {
		for _, record := range allDivisions {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				divisionCMIDByPBID[record.Id] = int(cmID)
			}
		}
		slog.Info("Loaded divisions for reverse lookup", "count", len(divisionCMIDByPBID))
	}

	// Preload persons with their division relations
	// Maps person cm_id -> {personPBID, divisionPBID, divisionCMID}
	type personDivisionInfo struct {
		personPBID   string
		divisionPBID string
		divisionCMID int
	}
	personDivisionMap := make(map[int]personDivisionInfo)

	allPersons, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading persons for relation resolution", "error", err)
	} else {
		for _, record := range allPersons {
			cmID, ok := record.Get("cm_id").(float64)
			if !ok || cmID == 0 {
				continue
			}
			divisionPBID := record.GetString("division")
			if divisionPBID == "" {
				continue // Person has no division assigned
			}
			// Look up division cm_id from reverse map
			divisionCMID := divisionCMIDByPBID[divisionPBID]
			if divisionCMID == 0 {
				continue // Division not found in reverse lookup
			}
			personDivisionMap[int(cmID)] = personDivisionInfo{
				personPBID:   record.Id,
				divisionPBID: divisionPBID,
				divisionCMID: divisionCMID,
			}
		}
		slog.Info("Loaded persons with divisions", "count", len(personDivisionMap))
	}

	// Fetch division attendees from CampMinder with pagination
	page := 1
	pageSize := 500
	totalFetched := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		attendees, hasMore, err := s.Client.GetDivisionAttendeesPage(page, pageSize)
		if err != nil {
			return fmt.Errorf("fetching division attendees page %d: %w", page, err)
		}

		if page == 1 && len(attendees) > 0 {
			s.SyncSuccessful = true
		}

		if len(attendees) == 0 && page == 1 {
			slog.Info("No division attendees to sync", "year", year)
			s.SyncSuccessful = true
			s.LogSyncComplete("DivisionAttendees")
			return nil
		}

		totalFetched += len(attendees)
		slog.Info("Processing division attendees page", "page", page, "count", len(attendees), "total", totalFetched)

		// Process each attendee
		for _, attendeeData := range attendees {
			// Transform to PocketBase format (extracts cm_id and person_id only)
			pbData, err := s.transformDivisionAttendeeToPB(attendeeData, year)
			if err != nil {
				slog.Error("Error transforming division attendee", "error", err)
				s.Stats.Errors++
				continue
			}

			// Look up person's division from preloaded map
			personCMID := pbData["person_id"].(int)
			info, exists := personDivisionMap[personCMID]
			if !exists || info.divisionPBID == "" {
				// Person not found or has no division - skip silently
				s.Stats.Skipped++
				continue
			}

			// Set the resolved values from person's division relation
			pbData["person"] = info.personPBID
			pbData["division"] = info.divisionPBID
			pbData["division_id"] = info.divisionCMID

			// Use composite key for tracking
			compositeKey := fmt.Sprintf("%d|%d", personCMID, info.divisionCMID)

			// Track as processed
			s.TrackProcessedKey(compositeKey, year)

			// Process the record
			compareFields := []string{"cm_id", "person_id", "division_id", "person", "division", "year"}
			if err := s.ProcessSimpleRecord("division_attendees", compositeKey, pbData, existingRecords, compareFields); err != nil {
				slog.Error("Error processing division attendee", "person_id", personCMID, "division_id", info.divisionCMID, "error", err)
				s.Stats.Errors++
			}
		}

		if !hasMore {
			break
		}
		page++
	}

	slog.Info("Fetched all division attendees from CampMinder", "total", totalFetched, "year", year)

	// Delete orphans
	if err := s.DeleteOrphans(
		"division_attendees",
		func(record *core.Record) (string, bool) {
			personID, pOK := record.Get("person_id").(float64)
			divisionID, dOK := record.Get("division_id").(float64)
			if pOK && personID > 0 && dOK && divisionID > 0 {
				compositeKey := fmt.Sprintf("%d|%d", int(personID), int(divisionID))
				return CompositeKey(compositeKey, year), true
			}
			return "", false
		},
		"division_attendee",
		filter,
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("DivisionAttendees")
	return nil
}

// transformDivisionAttendeeToPB transforms CampMinder division attendee data to PocketBase format
// Note: Only extracts ID and PersonID - division is derived from persons table during sync
func (s *DivisionAttendeesSync) transformDivisionAttendeeToPB(data map[string]any, year int) (map[string]any, error) {
	pbData := make(map[string]any)

	// Extract ID (required)
	idFloat, ok := data["ID"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing division attendee ID")
	}
	pbData["cm_id"] = int(idFloat)

	// Extract PersonID (required) - division will be resolved from persons table
	personID, ok := data["PersonID"].(float64)
	if !ok || personID == 0 {
		return nil, fmt.Errorf("invalid or missing PersonID")
	}
	pbData["person_id"] = int(personID)

	// DivisionID from API is unreliable (73% failure rate)
	// Division will be derived from the person's existing division relation in PocketBase

	// Set year
	pbData["year"] = year

	return pbData, nil
}
