package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameDivisions = "divisions"

// DivisionsSync handles syncing division definitions from CampMinder
type DivisionsSync struct {
	BaseSyncService
}

// NewDivisionsSync creates a new divisions sync service
func NewDivisionsSync(app core.App, client *campminder.Client) *DivisionsSync {
	return &DivisionsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *DivisionsSync) Name() string {
	return serviceNameDivisions
}

// Sync performs the divisions sync
// Note: Divisions are global (not year-specific) - they define age/gender groups
func (s *DivisionsSync) Sync(ctx context.Context) error {
	// Pre-load all existing records (no year filter - divisions are global)
	// Use cm_id as the key since divisions have CampMinder IDs
	existingRecords, err := s.PreloadRecordsGlobal("divisions", "", func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Start the sync process
	s.LogSyncStart(serviceNameDivisions)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Fetch divisions from CampMinder
	divisions, err := s.Client.GetDivisions()
	if err != nil {
		return fmt.Errorf("fetching divisions: %w", err)
	}

	if len(divisions) == 0 {
		slog.Info("No divisions to sync")
		s.SyncSuccessful = true
		s.LogSyncComplete("Divisions")
		return nil
	}

	slog.Info("Fetched divisions from CampMinder", "count", len(divisions))
	s.SyncSuccessful = true

	// Track parent division IDs for second pass
	parentDivisionIDs := make(map[int]int) // cm_id -> parent_cm_id

	// First pass: Create/update all division records (without parent relations)
	for _, divisionData := range divisions {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Transform to PocketBase format
		pbData, err := s.transformDivisionToPB(divisionData)
		if err != nil {
			slog.Error("Error transforming division", "error", err)
			s.Stats.Errors++
			continue
		}

		// Extract cm_id
		cmID, ok := pbData["cm_id"].(int)
		if !ok || cmID == 0 {
			slog.Error("Invalid division cm_id")
			s.Stats.Errors++
			continue
		}

		// Track parent division for second pass
		if parentCMID, ok := pbData["parent_division_cm_id"].(int); ok && parentCMID > 0 {
			parentDivisionIDs[cmID] = parentCMID
		}
		// Remove temporary field before saving
		delete(pbData, "parent_division_cm_id")

		// Track as processed (no year - divisions are global)
		s.TrackProcessedKey(cmID, 0)

		// Process the record using cm_id as key
		compareFields := []string{"cm_id", "name", "description", "start_grade_id", "end_grade_id",
			"gender_id", "capacity", "assign_on_enrollment", "staff_only"}
		if err := s.ProcessSimpleRecordGlobal("divisions", cmID, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing division", "cm_id", cmID, "error", err)
			s.Stats.Errors++
		}
	}

	// Second pass: Resolve parent_division relations
	if len(parentDivisionIDs) > 0 {
		if err := s.resolveParentDivisionRelations(parentDivisionIDs); err != nil {
			slog.Warn("Error resolving parent division relations", "error", err)
		}
	}

	// Delete orphans (no year filter - divisions are global)
	if err := s.DeleteOrphans(
		"divisions",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			cmID, ok := cmIDValue.(float64)
			if ok && cmID > 0 {
				// Use CompositeKey to match TrackProcessedKey format (cmID|0)
				return CompositeKey(int(cmID), 0), true
			}
			return "", false
		},
		"division",
		"", // No filter - all records
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("Divisions")
	return nil
}

// resolveParentDivisionRelations updates division records with parent_division relations
func (s *DivisionsSync) resolveParentDivisionRelations(parentDivisionIDs map[int]int) error {
	slog.Debug("Checking parent division relations", "divisions_with_parents", len(parentDivisionIDs))

	// Build a map of cm_id -> PocketBase record ID
	divisionIDMap := make(map[int]string)
	allDivisions, err := s.App.FindRecordsByFilter("divisions", "", "", 0, 0)
	if err != nil {
		return fmt.Errorf("loading divisions for relation resolution: %w", err)
	}

	for _, record := range allDivisions {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			divisionIDMap[int(cmID)] = record.Id
		}
	}

	// Update each division with its parent relation
	updated := 0
	for cmID, parentCMID := range parentDivisionIDs {
		childRecordID, childExists := divisionIDMap[cmID]
		parentRecordID, parentExists := divisionIDMap[parentCMID]

		if !childExists {
			slog.Warn("Child division not found", "cm_id", cmID)
			continue
		}
		if !parentExists {
			slog.Warn("Parent division not found", "parent_cm_id", parentCMID, "child_cm_id", cmID)
			continue
		}

		// Find and update the child record
		record, err := s.App.FindRecordById("divisions", childRecordID)
		if err != nil {
			slog.Error("Error finding division for parent update", "id", childRecordID, "error", err)
			continue
		}

		// Check if already set correctly
		if record.GetString("parent_division") == parentRecordID {
			continue
		}

		record.Set("parent_division", parentRecordID)
		if err := s.App.Save(record); err != nil {
			slog.Error("Error updating parent division relation", "cm_id", cmID, "error", err)
		} else {
			updated++
		}
	}

	if updated > 0 {
		slog.Info("Updated parent division relations", "count", updated)
	}

	return nil
}

// transformDivisionToPB transforms CampMinder division data to PocketBase format
func (s *DivisionsSync) transformDivisionToPB(data map[string]interface{}) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract ID (required)
	idFloat, ok := data["ID"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing division ID")
	}
	pbData["cm_id"] = int(idFloat)

	// Extract Name (required)
	name, ok := data["Name"].(string)
	if !ok || name == "" {
		return nil, fmt.Errorf("invalid or missing division Name")
	}
	pbData["name"] = name

	// Extract optional text fields
	if desc, ok := data["Description"].(string); ok {
		pbData["description"] = desc
	} else {
		pbData["description"] = ""
	}

	// Extract optional number fields
	if startGrade, ok := data["StartGradeRangeID"].(float64); ok {
		pbData["start_grade_id"] = int(startGrade)
	}
	if endGrade, ok := data["EndGradeRangeID"].(float64); ok {
		pbData["end_grade_id"] = int(endGrade)
	}
	if genderID, ok := data["GenderID"].(float64); ok {
		pbData["gender_id"] = int(genderID)
	}
	if capacity, ok := data["Capacity"].(float64); ok {
		pbData["capacity"] = int(capacity)
	}

	// Extract parent division ID (for relation resolution in second pass)
	if subOfID, ok := data["SubOfDivisionID"].(float64); ok && subOfID > 0 {
		pbData["parent_division_cm_id"] = int(subOfID)
	}

	// Extract boolean fields
	if assignOnEnroll, ok := data["AssignDuringCamperEnrollment"].(bool); ok {
		pbData["assign_on_enrollment"] = assignOnEnroll
	} else {
		pbData["assign_on_enrollment"] = false
	}
	if staffOnly, ok := data["StaffOnly"].(bool); ok {
		pbData["staff_only"] = staffOnly
	} else {
		pbData["staff_only"] = false
	}

	return pbData, nil
}
