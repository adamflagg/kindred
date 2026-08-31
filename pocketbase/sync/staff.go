package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameStaff = "staff"

// allStaffStatuses defines all CampMinder staff statuses to sync.
// 1=Active, 2=Resigned, 3=Dismissed, 4=Cancelled
//
// Precedence policy (kindred#2267): a person can come back from CampMinder under more than
// one status in a single run (e.g. active this season, still returned as a resigned record
// from a prior one). syncStaff writes at most one `staff` row per person per year, so when
// that happens the FIRST status seen wins -- and "first" is exactly this slice's iteration
// order. That makes Active > Resigned > Dismissed > Cancelled the effective precedence, and
// it is a deliberate, stated policy now, not an accident of slice order. It is provisional:
// nothing has evaluated whether Active-wins is the right call, only that it must be legible
// and every collapse it causes counted (isDuplicateStaffStatus, Stats.DuplicateStaffStatus)
// rather than silent. Do not reorder this slice to change precedence without updating this
// comment and TestAllStaffStatuses, which pins the order.
var allStaffStatuses = []int{1, 2, 3, 4}

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

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2351). Declared
// explicitly rather than inherited by embedding BaseSyncService -- see that field's doc
// comment for why a promoted setter is not safe here.
func (s *StaffSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
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
	existingRecords, err := s.PreloadRecords("staff", filter, func(record *core.Record) (any, bool) {
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

	// Fetch staff from CampMinder across all statuses with pagination
	pageSize := 500
	totalProcessed := 0
	statusCounts := make(map[int]int)

	for _, status := range allStaffStatuses {
		page := 1
		for {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			staffRecords, hasMore, err := s.Client.GetStaffPage(status, page, pageSize)
			if err != nil {
				return fmt.Errorf("fetching staff page %d (status %d): %w", page, status, err)
			}

			if len(staffRecords) == 0 {
				break
			}

			slog.Debug("Processing staff page", "status", status, "page", page, "count", len(staffRecords))

			for _, data := range staffRecords {
				pbData, err := s.transformStaffToPB(data, year, orgCategoryMap, positionMap, divisionMap, bunkMap, personMap)
				if err != nil {
					slog.Error("Error transforming staff record", "error", err)
					s.Stats.Rejected++
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

				// Skip duplicates: see allStaffStatuses above for the precedence policy this
				// implements (first status seen this run wins). isDuplicateStaffStatus does
				// the bookkeeping for both outcomes -- tracking a first sighting, or counting
				// and logging a later one dropped.
				if s.isDuplicateStaffStatus(personPBID, year, status) {
					continue
				}

				// Preserve bunk data for non-active staff — CampMinder clears
				// BunkAssignments on dismissal, but we keep last-known assignments.
				if existing, hasExisting := existingRecords[CompositeKey(personPBID, year)]; hasExisting {
					statusID, _ := pbData["status_id"].(int)
					existingBunks := existing.GetStringSlice("bunks")
					if shouldPreserveBunkData(statusID, existing.GetBool("bunk_staff"), existingBunks) {
						delete(pbData, "bunks")
						delete(pbData, "bunk_staff")
					}
				}

				compareFields := []string{
					"year", "status_id", "status",
					"organizational_category", "position1", "position2", "division",
					"bunks", "bunk_staff",
					"hire_date", "employment_start_date", "employment_end_date",
					"contract_in_date", "contract_out_date", "contract_due_date",
					"international", "years", "salary",
				}
				if err := s.ProcessSimpleRecord("staff", personPBID, pbData, existingRecords, compareFields); err != nil {
					if errors.Is(err, errRejectedRecord) {
						slog.Warn("Rejected staff record", "person_pb_id", personPBID, "error", err)
						s.Stats.Rejected++
					} else {
						slog.Error("Error processing staff record", "person_pb_id", personPBID, "error", err)
						s.Stats.Errors++
					}
				}

				statusCounts[status]++
				totalProcessed++
			}

			if !hasMore {
				break
			}
			page++
		}
	}

	slog.Info("Processed staff records", "total", totalProcessed,
		"active", statusCounts[1], "resigned", statusCounts[2],
		"dismissed", statusCounts[3], "cancelled", statusCounts[4],
		"duplicate_status_dropped", s.Stats.DuplicateStaffStatus)

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
	data map[string]any,
	year int,
	orgCategoryMap, positionMap, divisionMap, bunkMap, personMap map[int]string,
) (map[string]any, error) {
	pbData := make(map[string]any)

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

	// Always set person_id (CampMinder ID) for downstream sync lookups
	// Critical: staff_applications and staff_vehicle_info depend on this field
	pbData["person_id"] = personID

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
func (s *StaffSync) setStatusFields(pbData, data map[string]any) {
	if statusID, ok := data["StatusID"].(float64); ok {
		pbData["status_id"] = int(statusID)
	}
	if statusName, ok := data["StatusName"].(string); ok {
		pbData["status"] = strings.ToLower(statusName)
	}
}

// setStaffRelation maps a CampMinder ID field to a PocketBase relation.
func (s *StaffSync) setStaffRelation(
	pbData, data map[string]any,
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
	pbData, data map[string]any,
	bunkMap map[int]string,
) {
	bunkAssignments, ok := data["BunkAssignments"].([]any)
	if !ok || len(bunkAssignments) == 0 {
		return
	}
	var bunkIDs []string
	for _, ba := range bunkAssignments {
		if baMap, ok := ba.(map[string]any); ok {
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
func (s *StaffSync) setDateField(pbData, data map[string]any, srcKey, dstKey string) {
	if dateStr, ok := data[srcKey].(string); ok && dateStr != "" {
		pbData[dstKey] = ParseDate(dateStr)
	}
}

// setStaffIntField extracts a float64 and sets as int.
func (s *StaffSync) setStaffIntField(pbData, data map[string]any, srcKey, dstKey string) {
	if val, ok := data[srcKey].(float64); ok {
		pbData[dstKey] = int(val)
	}
}

// setStaffFloatField extracts and sets a float64.
func (s *StaffSync) setStaffFloatField(pbData, data map[string]any, srcKey, dstKey string) {
	if val, ok := data[srcKey].(float64); ok {
		pbData[dstKey] = val
	}
}

// isDuplicateStaffStatus reports whether personPBID has already been synced this run under a
// higher-precedence status (see allStaffStatuses for the policy) and does the bookkeeping for
// either outcome. A first sighting is tracked so a later status for the same person this run
// is recognized as the duplicate. A duplicate is counted (Stats.DuplicateStaffStatus) and
// logged at Warn -- visible at the default LOG_LEVEL=INFO -- mirroring the "no matching
// person" branch immediately above its call site, which already does both (kindred#2267).
func (s *StaffSync) isDuplicateStaffStatus(personPBID string, year, status int) bool {
	if s.IsKeyProcessed(personPBID, year) {
		s.Stats.DuplicateStaffStatus++
		slog.Warn("Dropping duplicate staff record: person already synced this run under a higher-precedence status",
			"person_pb_id", personPBID, "year", year, "dropped_status_id", status)
		return true
	}
	s.TrackProcessedKey(personPBID, year)
	return false
}

// shouldPreserveBunkData returns true when existing bunk data should be kept
// instead of being overwritten by (empty) API data. CampMinder strips
// BunkAssignments from dismissed/resigned staff responses, so we preserve
// the last-known assignments for non-active bunk staff who had bunks.
func shouldPreserveBunkData(statusID int, existingBunkStaff bool, existingBunks []string) bool {
	return statusID != 1 && existingBunkStaff && len(existingBunks) > 0
}
