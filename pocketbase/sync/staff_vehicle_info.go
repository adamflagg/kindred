package sync

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameStaffVehicleInfo is the canonical name for this sync service
const serviceNameStaffVehicleInfo = "staff_vehicle_info"

// StaffVehicleInfoSync extracts SVI-* custom fields for staff vehicle information.
// This service reads from person_custom_values and populates the staff_vehicle_info table.
//
// Unique key: (person_id, year) - one record per staff member per year
// Links to: staff
//
// Field mapping: 8 SVI-* prefixed fields covering driving plans and vehicle details.
type StaffVehicleInfoSync struct {
	App            core.App
	Year           int
	DryRun         bool
	Stats          Stats
	SyncSuccessful bool
}

// NewStaffVehicleInfoSync creates a new staff vehicle info sync service
func NewStaffVehicleInfoSync(app core.App) *StaffVehicleInfoSync {
	return &StaffVehicleInfoSync{
		App:    app,
		Year:   0,
		DryRun: false,
	}
}

// Name returns the service name
func (s *StaffVehicleInfoSync) Name() string {
	return serviceNameStaffVehicleInfo
}

// GetStats returns the current stats
func (s *StaffVehicleInfoSync) GetStats() Stats {
	return s.Stats
}

// staffVehicleInfoRecord holds the extracted vehicle info for a staff member
type staffVehicleInfoRecord struct {
	personID int
	year     int
	staffID  string // PocketBase ID of staff record

	drivingToCamp     bool
	howGettingToCamp  string
	canBringOthers    bool
	driverName        string
	whichFriend       string
	vehicleMake       string
	vehicleModel      string
	licensePlate      string
}

// Sync executes the staff vehicle info extraction
func (s *StaffVehicleInfoSync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Determine year
	year := s.Year
	if year == 0 {
		yearStr := os.Getenv("CAMPMINDER_SEASON_ID")
		if yearStr != "" {
			if y, err := strconv.Atoi(yearStr); err == nil {
				year = y
			}
		}
		if year == 0 {
			year = 2025
		}
	}

	// Validate year
	if year < 2017 || year > 2099 {
		return fmt.Errorf("invalid year %d: must be between 2017 and 2099", year)
	}

	slog.Info("Starting staff vehicle info extraction",
		"year", year,
		"dry_run", s.DryRun,
	)

	// Step 1: Build field name mapping
	fieldNameMap, err := s.loadFieldDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading field definitions: %w", err)
	}
	slog.Info("Loaded field definitions", "count", len(fieldNameMap))

	// Step 2: Load person -> staff mapping
	personToStaff, err := s.loadPersonStaffMapping(ctx, year)
	if err != nil {
		return fmt.Errorf("loading person-staff mapping: %w", err)
	}
	slog.Info("Loaded person-staff mapping", "count", len(personToStaff))

	// Step 3: Load person custom values (SVI-* fields)
	records, err := s.loadPersonCustomValues(ctx, year, fieldNameMap, personToStaff)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Extracted staff vehicle info records", "count", len(records))

	if s.DryRun {
		slog.Info("Dry run mode - extracted but not writing",
			"records", len(records),
		)
		s.Stats.Created = len(records)
		s.SyncSuccessful = true
		return nil
	}

	// Step 4: Load existing records
	existingRecords, err := s.loadExistingRecords(ctx, year)
	if err != nil {
		return fmt.Errorf("loading existing records: %w", err)
	}
	slog.Info("Loaded existing records", "count", len(existingRecords))

	// Step 5: Upsert records
	created, updated, errors := s.upsertRecords(ctx, records, existingRecords, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
	s.Stats.Errors = errors

	// Step 6: Delete orphans
	deleted := s.deleteOrphans(ctx, records, existingRecords)
	s.Stats.Deleted = deleted

	// WAL checkpoint
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	s.SyncSuccessful = true
	slog.Info("Staff vehicle info extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors,
	)

	return nil
}

// loadFieldDefinitions builds a map of field_definition PB ID -> field name
func (s *StaffVehicleInfoSync) loadFieldDefinitions(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying field definitions: %w", err)
	}

	for _, record := range records {
		name := record.GetString("name")
		if isStaffVehicleInfoField(name) {
			result[record.Id] = name
		}
	}

	return result, nil
}

// isStaffVehicleInfoField checks if a field is relevant for staff vehicle info
func isStaffVehicleInfoField(name string) bool {
	return strings.HasPrefix(name, "SVI-") || strings.HasPrefix(name, "SVI ")
}

// loadPersonStaffMapping builds a map of person CM ID -> staff PB ID
func (s *StaffVehicleInfoSync) loadPersonStaffMapping(
	ctx context.Context, year int,
) (map[int]string, error) {
	result := make(map[int]string)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("staff", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying staff page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			if personID > 0 {
				if _, exists := result[personID]; !exists {
					result[personID] = record.Id
				}
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// sviValueEntry represents a loaded SVI custom value
type sviValueEntry struct {
	personID  int
	fieldName string
	value     string
}

// loadPersonCustomValues loads person custom values for SVI-* fields
func (s *StaffVehicleInfoSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, personToStaff map[int]string,
) (map[string]*staffVehicleInfoRecord, error) {
	var entries []sviValueEntry

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("person_custom_values", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying person custom values page %d: %w", page, err)
		}

		for _, record := range records {
			fieldDefID := record.GetString("field_definition")
			fieldName, ok := fieldNameMap[fieldDefID]
			if !ok {
				continue
			}

			personID := record.GetInt("person_id")
			value := record.GetString("value")

			if personID > 0 && value != "" {
				entries = append(entries, sviValueEntry{
					personID:  personID,
					fieldName: fieldName,
					value:     value,
				})
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	// Aggregate to person level
	result := make(map[string]*staffVehicleInfoRecord)

	for _, entry := range entries {
		staffID, hasStaff := personToStaff[entry.personID]
		if !hasStaff {
			continue
		}

		key := makeStaffVehicleKey(entry.personID, year)
		rec := result[key]
		if rec == nil {
			rec = &staffVehicleInfoRecord{
				personID: entry.personID,
				year:     year,
				staffID:  staffID,
			}
			result[key] = rec
		}

		mapSVIFieldToRecord(rec, entry.fieldName, entry.value)
	}

	return result, nil
}

// mapSVIFieldToRecord maps an SVI-* field to the record
func mapSVIFieldToRecord(rec *staffVehicleInfoRecord, fieldName, value string) {
	column := MapSVIFieldToColumnImpl(fieldName)
	if column == "" {
		return
	}

	switch column {
	case "driving_to_camp":
		rec.drivingToCamp = parseSVIBoolImpl(value)
	case "how_getting_to_camp":
		if rec.howGettingToCamp == "" {
			rec.howGettingToCamp = value
		}
	case "can_bring_others":
		rec.canBringOthers = parseSVIBoolImpl(value)
	case "driver_name":
		if rec.driverName == "" {
			rec.driverName = value
		}
	case "which_friend":
		if rec.whichFriend == "" {
			rec.whichFriend = value
		}
	case "vehicle_make":
		if rec.vehicleMake == "" {
			rec.vehicleMake = value
		}
	case "vehicle_model":
		if rec.vehicleModel == "" {
			rec.vehicleModel = value
		}
	case "license_plate":
		if rec.licensePlate == "" {
			rec.licensePlate = value
		}
	}
}

// MapSVIFieldToColumnImpl maps CampMinder field names to database column names
func MapSVIFieldToColumnImpl(fieldName string) string {
	switch fieldName {
	case "SVI-are you driving to camp":
		return "driving_to_camp"
	case "SVI-how are you get to camp":
		return "how_getting_to_camp"
	case "SVI - bring others":
		return "can_bring_others"
	case "SVI- Who is driving you to camp":
		return "driver_name"
	case "SVI-which friend":
		return "which_friend"
	case "SVI-make of vehicle":
		return "vehicle_make"
	case "SVI-model vehicle":
		return "vehicle_model"
	case "SVI-licence plate number":
		return "license_plate"
	}
	return ""
}

// parseSVIBoolImpl parses Yes/No values to boolean
func parseSVIBoolImpl(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case "yes", "true", "1", "y":
		return true
	}
	return false
}

// isSVIBoolFieldImpl returns true if the column should be parsed as boolean
func isSVIBoolFieldImpl(column string) bool {
	switch column {
	case "driving_to_camp", "can_bring_others":
		return true
	}
	return false
}

// makeStaffVehicleKey creates the composite key for upsert logic
func makeStaffVehicleKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}

// loadExistingRecords loads existing staff_vehicle_info records for a year
func (s *StaffVehicleInfoSync) loadExistingRecords(ctx context.Context, year int) (map[string]string, error) {
	result := make(map[string]string)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("staff_vehicle_info", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying staff_vehicle_info page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			key := makeStaffVehicleKey(personID, year)
			result[key] = record.Id
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// upsertRecords creates or updates staff vehicle info records
func (s *StaffVehicleInfoSync) upsertRecords(
	ctx context.Context,
	records map[string]*staffVehicleInfoRecord,
	existingRecords map[string]string,
	year int,
) (created, updated, errors int) {
	col, err := s.App.FindCollectionByNameOrId("staff_vehicle_info")
	if err != nil {
		slog.Error("Error finding staff_vehicle_info collection", "error", err)
		return 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, errors
		default:
		}

		key := makeStaffVehicleKey(rec.personID, year)
		existingID, exists := existingRecords[key]

		var record *core.Record
		if exists {
			record, err = s.App.FindRecordById("staff_vehicle_info", existingID)
			if err != nil {
				slog.Error("Error finding existing record", "id", existingID, "error", err)
				errors++
				continue
			}
		} else {
			record = core.NewRecord(col)
		}

		// Set all fields
		record.Set("staff", rec.staffID)
		record.Set("person_id", rec.personID)
		record.Set("year", rec.year)
		record.Set("driving_to_camp", rec.drivingToCamp)
		record.Set("how_getting_to_camp", rec.howGettingToCamp)
		record.Set("can_bring_others", rec.canBringOthers)
		record.Set("driver_name", rec.driverName)
		record.Set("which_friend", rec.whichFriend)
		record.Set("vehicle_make", rec.vehicleMake)
		record.Set("vehicle_model", rec.vehicleModel)
		record.Set("license_plate", rec.licensePlate)

		if err := s.App.Save(record); err != nil {
			slog.Error("Error saving staff_vehicle_info record",
				"person_id", rec.personID,
				"year", rec.year,
				"error", err,
			)
			errors++
			continue
		}

		if exists {
			updated++
		} else {
			created++
		}
	}

	return created, updated, errors
}

// deleteOrphans removes records that exist in DB but not in computed set
func (s *StaffVehicleInfoSync) deleteOrphans(
	ctx context.Context,
	records map[string]*staffVehicleInfoRecord,
	existingRecords map[string]string,
) int {
	deleted := 0

	for key, recordID := range existingRecords {
		select {
		case <-ctx.Done():
			return deleted
		default:
		}

		if _, exists := records[key]; !exists {
			record, err := s.App.FindRecordById("staff_vehicle_info", recordID)
			if err != nil {
				slog.Warn("Error finding orphan record", "id", recordID, "error", err)
				continue
			}

			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphan record", "id", recordID, "error", err)
				continue
			}
			deleted++
		}
	}

	return deleted
}

// forceWALCheckpoint forces a SQLite WAL checkpoint
func (s *StaffVehicleInfoSync) forceWALCheckpoint() error {
	db := s.App.DB()
	if db == nil {
		return fmt.Errorf("unable to get database connection")
	}

	_, err := db.NewQuery("PRAGMA wal_checkpoint(FULL)").Execute()
	if err != nil {
		return fmt.Errorf("WAL checkpoint failed: %w", err)
	}

	return nil
}
