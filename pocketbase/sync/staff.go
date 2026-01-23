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
const serviceNameStaff = "staff"

// StaffSync handles syncing year-scoped staff records from CampMinder
// This syncs the main staff table which depends on:
// - staff_lookups (positions, org_categories, program_areas) - run first via weekly sync
// - divisions, bunks, persons - run first via daily sync
type StaffSync struct {
	BaseSyncService
}

// NewStaffSync creates a new staff sync service
func NewStaffSync(app core.App, client *campminder.Client) *StaffSync {
	return &StaffSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *StaffSync) Name() string {
	return serviceNameStaff
}

// Sync performs the year-scoped staff sync
func (s *StaffSync) Sync(ctx context.Context) error {
	s.LogSyncStart(serviceNameStaff)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	if err := s.syncStaff(ctx); err != nil {
		return fmt.Errorf("syncing staff: %w", err)
	}

	// Note: SyncSuccessful is set inside syncStaff() before DeleteOrphans

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("Staff")
	return nil
}

// syncStaff syncs main staff table from CampMinder (year-scoped)
func (s *StaffSync) syncStaff(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	slog.Info("Syncing staff records", "year", year)

	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year using person relation field as key
	existingRecords, err := s.PreloadRecords("staff", filter, func(record *core.Record) (interface{}, bool) {
		if personRel := record.GetString("person"); personRel != "" {
			return personRel, true // Use PocketBase person record ID as key
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Build lookup maps for relations
	orgCategoryMap := s.buildCMIDMap("staff_org_categories")
	positionMap := s.buildCMIDMap("staff_positions")
	divisionMap := s.buildCMIDMap("divisions")
	bunkMap := s.buildBunkMap(year)
	personMap := s.buildPersonMap(year)

	s.ClearProcessedKeys()

	// Fetch staff from CampMinder with pagination
	// Status 1 = Active (most common query)
	page := 1
	pageSize := 500
	totalProcessed := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		staffRecords, hasMore, err := s.Client.GetStaffPage(1, page, pageSize)
		if err != nil {
			return fmt.Errorf("fetching staff page %d: %w", page, err)
		}

		if len(staffRecords) == 0 {
			break
		}

		slog.Debug("Processing staff page", "page", page, "count", len(staffRecords))

		for _, data := range staffRecords {
			pbData, err := s.transformStaffToPB(data, year, orgCategoryMap, positionMap, divisionMap, bunkMap, personMap)
			if err != nil {
				slog.Error("Error transforming staff record", "error", err)
				s.Stats.Errors++
				continue
			}

			// Get person PocketBase ID (the relation field value)
			personPBID, _ := pbData["person"].(string)
			if personPBID == "" {
				// Staff member doesn't have a matching person record - skip
				cmPersonID, _ := data["PersonID"].(float64)
				slog.Warn("Staff record has no matching person in persons table, skipping",
					"cm_person_id", int(cmPersonID))
				s.Stats.Skipped++
				continue
			}

			// Skip duplicates (same person appearing multiple times in API response)
			if s.IsKeyProcessed(personPBID, year) {
				slog.Debug("Skipping duplicate staff record in API response", "person_pb_id", personPBID)
				continue
			}

			s.TrackProcessedKey(personPBID, year)

			compareFields := []string{
				"year", "status_id", "status",
				"organizational_category", "position1", "position2", "division",
				"bunks", "bunk_staff",
				"hire_date", "employment_start_date", "employment_end_date",
				"contract_in_date", "contract_out_date", "contract_due_date",
				"international", "years", "salary",
			}
			if err := s.ProcessSimpleRecord("staff", personPBID, pbData, existingRecords, compareFields); err != nil {
				slog.Error("Error processing staff record", "person_pb_id", personPBID, "error", err)
				s.Stats.Errors++
			}

			totalProcessed++
		}

		if !hasMore {
			break
		}
		page++
	}

	slog.Info("Processed staff records", "total", totalProcessed)

	// Mark sync as successful before orphan deletion (DeleteOrphans checks this flag)
	s.SyncSuccessful = true

	// Delete orphans
	if err := s.DeleteOrphans(
		"staff",
		func(record *core.Record) (string, bool) {
			personRel := record.GetString("person")
			yearValue := record.Get("year")

			y, yOK := yearValue.(float64)

			if personRel != "" && yOK {
				return CompositeKey(personRel, int(y)), true
			}
			return "", false
		},
		"staff record",
		filter,
	); err != nil {
		slog.Error("Error deleting orphan staff records", "error", err)
	}

	return nil
}

// buildCMIDMap builds a map from cm_id to PocketBase ID for a global collection
func (s *StaffSync) buildCMIDMap(collection string) map[int]string {
	result := make(map[int]string)
	records, err := s.App.FindRecordsByFilter(collection, "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading records for relation resolution", "collection", collection, "error", err)
		return result
	}
	for _, record := range records {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			result[int(cmID)] = record.Id
		}
	}
	return result
}

// buildBunkMap builds a map from cm_id to PocketBase ID for bunks (year-filtered)
func (s *StaffSync) buildBunkMap(year int) map[int]string {
	result := make(map[int]string)
	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("bunks", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading bunks for relation resolution", "year", year, "error", err)
		return result
	}
	for _, record := range records {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			result[int(cmID)] = record.Id
		}
	}
	return result
}

// buildPersonMap builds a map from cm_id to PocketBase ID for persons (year-filtered)
func (s *StaffSync) buildPersonMap(year int) map[int]string {
	result := make(map[int]string)
	filter := fmt.Sprintf("year = %d", year)
	records, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading persons for relation resolution", "year", year, "error", err)
		return result
	}
	for _, record := range records {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			result[int(cmID)] = record.Id
		}
	}
	return result
}

func (s *StaffSync) transformStaffToPB(
	data map[string]interface{},
	year int,
	orgCategoryMap, positionMap, divisionMap, bunkMap, personMap map[int]string,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// PersonID from CampMinder (required for resolving person relation)
	personIDFloat, ok := data["PersonID"].(float64)
	if !ok || personIDFloat == 0 {
		return nil, fmt.Errorf("invalid or missing staff PersonID")
	}
	personID := int(personIDFloat)

	// Resolve person relation
	if pbID, found := personMap[personID]; found {
		pbData["person"] = pbID
	}

	pbData["year"] = year

	// Status
	s.setStatusFields(pbData, data)

	// Relations
	s.setStaffRelation(pbData, data, "OrganizationalCategoryID", "organizational_category", orgCategoryMap)
	s.setStaffRelation(pbData, data, "Position1ID", "position1", positionMap)
	s.setStaffRelation(pbData, data, "Position2ID", "position2", positionMap)
	s.setStaffRelation(pbData, data, "DivisionID", "division", divisionMap)

	// Bunk assignments (multi-relation)
	s.setBunkAssignments(pbData, data, bunkMap)

	// Boolean
	if bunkStaff, ok := data["BunkStaff"].(bool); ok {
		pbData["bunk_staff"] = bunkStaff
	}

	// Date fields
	s.setDateField(pbData, data, "HireDate", "hire_date")
	s.setDateField(pbData, data, "EmploymentStartDate", "employment_start_date")
	s.setDateField(pbData, data, "EmploymentEndDate", "employment_end_date")
	s.setDateField(pbData, data, "ContractInDate", "contract_in_date")
	s.setDateField(pbData, data, "ContractOutDate", "contract_out_date")
	s.setDateField(pbData, data, "ContractDueDate", "contract_due_date")

	// International
	if international, ok := data["International"].(string); ok && international != "" {
		pbData["international"] = strings.ToLower(international)
	}

	// Numeric fields
	s.setStaffIntField(pbData, data, "Years", "years")
	s.setStaffFloatField(pbData, data, "Salary", "salary")

	return pbData, nil
}

// setStatusFields extracts StatusID and StatusName from data.
func (s *StaffSync) setStatusFields(pbData, data map[string]interface{}) {
	if statusID, ok := data["StatusID"].(float64); ok {
		pbData["status_id"] = int(statusID)
	}
	if statusName, ok := data["StatusName"].(string); ok {
		pbData["status"] = strings.ToLower(statusName)
	}
}

// setStaffRelation maps a CampMinder ID field to a PocketBase relation.
func (s *StaffSync) setStaffRelation(
	pbData, data map[string]interface{},
	srcKey, dstKey string,
	lookupMap map[int]string,
) {
	if id, ok := data[srcKey].(float64); ok && id > 0 {
		if pbID, found := lookupMap[int(id)]; found {
			pbData[dstKey] = pbID
		}
	}
}

// setBunkAssignments extracts bunk assignments array and maps to PB IDs.
func (s *StaffSync) setBunkAssignments(
	pbData, data map[string]interface{},
	bunkMap map[int]string,
) {
	bunkAssignments, ok := data["BunkAssignments"].([]interface{})
	if !ok || len(bunkAssignments) == 0 {
		return
	}
	var bunkIDs []string
	for _, ba := range bunkAssignments {
		if baMap, ok := ba.(map[string]interface{}); ok {
			if bunkID, ok := baMap["ID"].(float64); ok && bunkID > 0 {
				if pbID, found := bunkMap[int(bunkID)]; found {
					bunkIDs = append(bunkIDs, pbID)
				}
			}
		}
	}
	if len(bunkIDs) > 0 {
		pbData["bunks"] = bunkIDs
	}
}

// setDateField extracts a date string and parses it.
func (s *StaffSync) setDateField(pbData, data map[string]interface{}, srcKey, dstKey string) {
	if dateStr, ok := data[srcKey].(string); ok && dateStr != "" {
		pbData[dstKey] = s.parseDate(dateStr)
	}
}

// setStaffIntField extracts a float64 and sets as int.
func (s *StaffSync) setStaffIntField(pbData, data map[string]interface{}, srcKey, dstKey string) {
	if val, ok := data[srcKey].(float64); ok {
		pbData[dstKey] = int(val)
	}
}

// setStaffFloatField extracts and sets a float64.
func (s *StaffSync) setStaffFloatField(pbData, data map[string]interface{}, srcKey, dstKey string) {
	if val, ok := data[srcKey].(float64); ok {
		pbData[dstKey] = val
	}
}

// parseDate converts CampMinder date format to PocketBase format
func (s *StaffSync) parseDate(dateStr string) string {
	if dateStr == "" {
		return ""
	}
	// CampMinder dates are typically in ISO format or similar
	// PocketBase accepts ISO 8601 format: "2024-01-15 00:00:00.000Z"
	// Try to normalize the date
	if len(dateStr) >= 10 {
		// Take the date part (YYYY-MM-DD)
		return dateStr[:10] + " 00:00:00.000Z"
	}
	return dateStr
}
