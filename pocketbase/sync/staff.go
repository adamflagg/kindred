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
	// Note: person_id field was removed from schema - we now use the person relation field

	// Resolve person relation
	if pbID, found := personMap[personID]; found {
		pbData["person"] = pbID
	}

	// Year
	pbData["year"] = year

	// StatusID and Status
	if statusID, ok := data["StatusID"].(float64); ok {
		pbData["status_id"] = int(statusID)
	}
	if statusName, ok := data["StatusName"].(string); ok {
		// Map to select values: active, resigned, dismissed, cancelled
		status := strings.ToLower(statusName)
		// Handle common variations
		switch status {
		case "active", "resigned", "dismissed", "cancelled":
			pbData["status"] = status
		default:
			// Keep as lowercase for any other status
			pbData["status"] = status
		}
	}

	// Organizational Category relation
	if orgCatID, ok := data["OrganizationalCategoryID"].(float64); ok && orgCatID > 0 {
		if pbID, found := orgCategoryMap[int(orgCatID)]; found {
			pbData["organizational_category"] = pbID
		}
	}

	// Position1 relation
	if pos1ID, ok := data["Position1ID"].(float64); ok && pos1ID > 0 {
		if pbID, found := positionMap[int(pos1ID)]; found {
			pbData["position1"] = pbID
		}
	}

	// Position2 relation (optional second position)
	if pos2ID, ok := data["Position2ID"].(float64); ok && pos2ID > 0 {
		if pbID, found := positionMap[int(pos2ID)]; found {
			pbData["position2"] = pbID
		}
	}

	// Division relation
	if divID, ok := data["DivisionID"].(float64); ok && divID > 0 {
		if pbID, found := divisionMap[int(divID)]; found {
			pbData["division"] = pbID
		}
	}

	// Bunk assignments (multi-relation)
	// BunkAssignments is an array of objects with ID field
	if bunkAssignments, ok := data["BunkAssignments"].([]interface{}); ok && len(bunkAssignments) > 0 {
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

	// BunkStaff
	if bunkStaff, ok := data["BunkStaff"].(bool); ok {
		pbData["bunk_staff"] = bunkStaff
	}

	// Date fields
	if hireDate, ok := data["HireDate"].(string); ok && hireDate != "" {
		pbData["hire_date"] = s.parseDate(hireDate)
	}
	if empStartDate, ok := data["EmploymentStartDate"].(string); ok && empStartDate != "" {
		pbData["employment_start_date"] = s.parseDate(empStartDate)
	}
	if empEndDate, ok := data["EmploymentEndDate"].(string); ok && empEndDate != "" {
		pbData["employment_end_date"] = s.parseDate(empEndDate)
	}
	if contractInDate, ok := data["ContractInDate"].(string); ok && contractInDate != "" {
		pbData["contract_in_date"] = s.parseDate(contractInDate)
	}
	if contractOutDate, ok := data["ContractOutDate"].(string); ok && contractOutDate != "" {
		pbData["contract_out_date"] = s.parseDate(contractOutDate)
	}
	if contractDueDate, ok := data["ContractDueDate"].(string); ok && contractDueDate != "" {
		pbData["contract_due_date"] = s.parseDate(contractDueDate)
	}

	// International
	if international, ok := data["International"].(string); ok && international != "" {
		// Map "Domestic" or "International" to lowercase select values
		pbData["international"] = strings.ToLower(international)
	}

	// Years (as staff)
	if years, ok := data["Years"].(float64); ok {
		pbData["years"] = int(years)
	}

	// Salary
	if salary, ok := data["Salary"].(float64); ok {
		pbData["salary"] = salary
	}

	return pbData, nil
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
