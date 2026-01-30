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

// serviceNameHouseholdDemographics is the canonical name for this sync service
const serviceNameHouseholdDemographics = "household_demographics"

// HouseholdDemographicsSync computes household demographics from custom values.
// This service reads from person_custom_values (HH- prefixed fields) and
// household_custom_values, then populates the household_demographics table.
//
// Unlike CampMinder API syncs, this doesn't call external APIs - it computes
// derived/aggregated data from existing PocketBase records.
//
// Field mapping:
// - HH- prefixed person fields go to _summer columns (from summer camp registration)
// - Household custom fields go to _family columns (from family camp registration)
// - First non-empty value wins for multi-camper households
type HouseholdDemographicsSync struct {
	App            core.App
	Year           int  // Year to compute for (0 = current year from env)
	DryRun         bool // Dry run mode (compute but don't write)
	Stats          Stats
	SyncSuccessful bool
}

// NewHouseholdDemographicsSync creates a new household demographics sync service
func NewHouseholdDemographicsSync(app core.App) *HouseholdDemographicsSync {
	return &HouseholdDemographicsSync{
		App:    app,
		Year:   0,
		DryRun: false,
	}
}

// Name returns the service name
func (s *HouseholdDemographicsSync) Name() string {
	return serviceNameHouseholdDemographics
}

// GetStats returns the current stats
func (s *HouseholdDemographicsSync) GetStats() Stats {
	return s.Stats
}

// householdDemographicsRecord holds the computed demographics for a household
type householdDemographicsRecord struct {
	householdPBID string
	year          int

	// Family description (multi-select, pipe-separated)
	familyDescription      string
	familyDescriptionOther string

	// Jewish identity
	jewishAffiliation      string
	jewishAffiliationOther string
	jewishIdentities       string

	// Congregation - from summer camp (person) and family camp (household)
	congregationSummer string
	congregationFamily string

	// JCC - from summer camp (person) and family camp (household)
	jccSummer string
	jccFamily string

	// Demographics
	militaryFamily        bool
	parentImmigrant       bool
	parentImmigrantOrigin string

	// Custody/Living situation - from summer camp (person) and family camp (household)
	custodySummer            string
	custodyFamily            string
	hasCustodyConsiderations bool

	// Away during camp
	awayDuringCamp bool
	awayLocation   string
	awayPhone      string
	awayFromDate   string
	awayReturnDate string

	// Metadata
	formFiller  string
	boardMember bool
}

// Sync executes the household demographics computation
func (s *HouseholdDemographicsSync) Sync(ctx context.Context) error {
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
			year = 2025 // Default fallback
		}
	}

	// Validate year (minimum 2017 per test spec)
	if year < 2017 || year > 2050 {
		return fmt.Errorf("invalid year %d: must be between 2017 and 2050", year)
	}

	slog.Info("Starting household demographics computation",
		"year", year,
		"dry_run", s.DryRun,
	)

	// Step 1: Build field name mapping (field_definition PB ID -> field name)
	fieldNameMap, err := s.loadFieldDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading field definitions: %w", err)
	}
	slog.Info("Loaded field definitions", "count", len(fieldNameMap))

	// Step 2: Load person to household mapping (person PB ID -> household PB ID)
	personToHousehold, err := s.loadPersonHouseholdMapping(ctx, year)
	if err != nil {
		return fmt.Errorf("loading person-household mapping: %w", err)
	}
	slog.Info("Loaded person-household mapping", "count", len(personToHousehold))

	// Step 3: Load person custom values (HH- prefixed fields)
	personValues, err := s.loadPersonCustomValues(ctx, year, fieldNameMap, personToHousehold)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Loaded person custom values", "count", len(personValues))

	// Step 4: Load household custom values
	householdValues, err := s.loadHouseholdCustomValues(ctx, year, fieldNameMap)
	if err != nil {
		return fmt.Errorf("loading household custom values: %w", err)
	}
	slog.Info("Loaded household custom values", "count", len(householdValues))

	// Step 5: Aggregate to household level
	records := s.aggregateToHouseholdLevel(personValues, householdValues, year)
	slog.Info("Aggregated to household level", "count", len(records))

	if s.DryRun {
		slog.Info("Dry run mode - computed but not writing",
			"households", len(records),
		)
		s.Stats.Created = len(records)
		s.SyncSuccessful = true
		return nil
	}

	// Step 6: Load existing records for upsert comparison
	existingRecords, err := s.loadExistingRecords(ctx, year)
	if err != nil {
		return fmt.Errorf("loading existing records: %w", err)
	}
	slog.Info("Loaded existing records", "count", len(existingRecords))

	// Step 7: Upsert records
	created, updated, errors := s.upsertRecords(ctx, records, existingRecords, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
	s.Stats.Errors = errors

	// Step 8: Delete orphans (records in DB but not in computed set)
	deleted := s.deleteOrphans(ctx, records, existingRecords)
	s.Stats.Deleted = deleted

	// WAL checkpoint
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	s.SyncSuccessful = true
	slog.Info("Household demographics computation completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors,
	)

	return nil
}

// loadFieldDefinitions builds a map of field_definition PB ID -> field name
// Only loads HH- prefixed fields and household-level fields we care about
func (s *HouseholdDemographicsSync) loadFieldDefinitions(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying field definitions: %w", err)
	}

	for _, record := range records {
		name := record.GetString("name")
		// Include HH- prefixed fields (person level) and household-level fields we care about
		if isHouseholdDemographicsField(name) {
			result[record.Id] = name
		}
	}

	return result, nil
}

// isHouseholdDemographicsField checks if a field is relevant for household demographics
func isHouseholdDemographicsField(name string) bool {
	// HH- prefixed fields from person_custom_values
	if strings.HasPrefix(name, "HH-") {
		return true
	}

	// Specific household_custom_values fields
	switch name {
	case "Synagogue", "Center", "Custody Issues", "Board":
		return true
	}

	return false
}

// IsHHField returns true if the field name starts with "HH-"
// Exported for testing
func IsHHField(name string) bool {
	return strings.HasPrefix(name, "HH-")
}

// loadPersonHouseholdMapping builds a map of person PB ID -> household PB ID
func (s *HouseholdDemographicsSync) loadPersonHouseholdMapping(
	ctx context.Context, year int,
) (map[string]string, error) {
	result := make(map[string]string)

	filter := fmt.Sprintf("year = %d && household != ''", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("persons", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying persons page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			if householdID != "" {
				result[record.Id] = householdID
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// hhCustomValueEntry represents a loaded HH custom value
type hhCustomValueEntry struct {
	householdPBID string
	fieldName     string
	value         string
}

// loadPersonCustomValues loads person custom values for HH- prefixed fields
func (s *HouseholdDemographicsSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, personToHousehold map[string]string,
) ([]hhCustomValueEntry, error) {
	var result []hhCustomValueEntry

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
			if !ok || !IsHHField(fieldName) {
				continue // Only HH- prefixed fields
			}

			personID := record.GetString("person")
			householdID := personToHousehold[personID]
			value := record.GetString("value")

			if householdID != "" && value != "" {
				result = append(result, hhCustomValueEntry{
					householdPBID: householdID,
					fieldName:     fieldName,
					value:         value,
				})
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// loadHouseholdCustomValues loads household custom values for demographics fields
func (s *HouseholdDemographicsSync) loadHouseholdCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string,
) ([]hhCustomValueEntry, error) {
	var result []hhCustomValueEntry

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("household_custom_values", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying household custom values page %d: %w", page, err)
		}

		for _, record := range records {
			fieldDefID := record.GetString("field_definition")
			fieldName, ok := fieldNameMap[fieldDefID]
			if !ok {
				continue // Not a demographics field
			}

			// Skip HH- fields (those come from person_custom_values)
			if IsHHField(fieldName) {
				continue
			}

			householdID := record.GetString("household")
			value := record.GetString("value")
			if householdID != "" && value != "" {
				result = append(result, hhCustomValueEntry{
					householdPBID: householdID,
					fieldName:     fieldName,
					value:         value,
				})
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// aggregateToHouseholdLevel aggregates custom values to household level
// First non-empty value wins for multi-camper households
func (s *HouseholdDemographicsSync) aggregateToHouseholdLevel(
	personValues []hhCustomValueEntry,
	householdValues []hhCustomValueEntry,
	year int,
) map[string]*householdDemographicsRecord {
	records := make(map[string]*householdDemographicsRecord)

	// Helper to get or create record
	getRecord := func(householdID string) *householdDemographicsRecord {
		if records[householdID] == nil {
			records[householdID] = &householdDemographicsRecord{
				householdPBID: householdID,
				year:          year,
			}
		}
		return records[householdID]
	}

	// Process person custom values (HH- fields) -> _summer columns
	for _, v := range personValues {
		rec := getRecord(v.householdPBID)
		s.mapPersonFieldToRecord(rec, v.fieldName, v.value)
	}

	// Process household custom values -> _family columns
	for _, v := range householdValues {
		rec := getRecord(v.householdPBID)
		s.mapHouseholdFieldToRecord(rec, v.fieldName, v.value)
	}

	return records
}

// mapPersonFieldToRecord maps a HH- person field to the appropriate record field
// Uses "first non-empty wins" strategy
func (s *HouseholdDemographicsSync) mapPersonFieldToRecord(rec *householdDemographicsRecord, fieldName, value string) {
	// Use MapHHFieldToColumn for the field mapping
	column := MapHHFieldToColumn(fieldName)
	if column == "" {
		return // Unknown field
	}

	// First non-empty wins
	switch column {
	case "family_description":
		if rec.familyDescription == "" {
			rec.familyDescription = value
		}
	case "family_description_other":
		if rec.familyDescriptionOther == "" {
			rec.familyDescriptionOther = value
		}
	case "jewish_affiliation":
		if rec.jewishAffiliation == "" {
			rec.jewishAffiliation = value
		}
	case "jewish_affiliation_other":
		if rec.jewishAffiliationOther == "" {
			rec.jewishAffiliationOther = value
		}
	case "jewish_identities":
		if rec.jewishIdentities == "" {
			rec.jewishIdentities = value
		}
	case "congregation_summer":
		if rec.congregationSummer == "" {
			rec.congregationSummer = value
		}
	case "jcc_summer":
		if rec.jccSummer == "" {
			rec.jccSummer = value
		}
	case "military_family":
		// Parse boolean, first true wins
		if !rec.militaryFamily && ParseBoolValue(value) {
			rec.militaryFamily = true
		}
	case "parent_immigrant":
		if !rec.parentImmigrant && ParseBoolValue(value) {
			rec.parentImmigrant = true
		}
	case "parent_immigrant_origin":
		if rec.parentImmigrantOrigin == "" {
			rec.parentImmigrantOrigin = value
		}
	case "custody_summer":
		if rec.custodySummer == "" {
			rec.custodySummer = value
		}
	case "has_custody_considerations":
		if !rec.hasCustodyConsiderations && ParseBoolValue(value) {
			rec.hasCustodyConsiderations = true
		}
	case "away_during_camp":
		if !rec.awayDuringCamp && ParseBoolValue(value) {
			rec.awayDuringCamp = true
		}
	case "away_location":
		if rec.awayLocation == "" {
			rec.awayLocation = value
		}
	case "away_phone":
		if rec.awayPhone == "" {
			rec.awayPhone = value
		}
	case "away_from_date":
		if rec.awayFromDate == "" {
			rec.awayFromDate = value
		}
	case "away_return_date":
		if rec.awayReturnDate == "" {
			rec.awayReturnDate = value
		}
	case "form_filler":
		if rec.formFiller == "" {
			rec.formFiller = value
		}
	}
}

// mapHouseholdFieldToRecord maps a household custom field to the appropriate record field
func (s *HouseholdDemographicsSync) mapHouseholdFieldToRecord(
	rec *householdDemographicsRecord, fieldName, value string,
) {
	column := MapHouseholdFieldToColumn(fieldName)
	if column == "" {
		return
	}

	// First non-empty wins
	switch column {
	case "congregation_family":
		if rec.congregationFamily == "" {
			rec.congregationFamily = value
		}
	case "jcc_family":
		if rec.jccFamily == "" {
			rec.jccFamily = value
		}
	case "custody_family":
		if rec.custodyFamily == "" {
			rec.custodyFamily = value
		}
	case "board_member":
		if !rec.boardMember && ParseBoolValue(value) {
			rec.boardMember = true
		}
	}
}

// MapHHFieldToColumn maps HH- field names to database column names
// Exported for testing
func MapHHFieldToColumn(fieldName string) string {
	switch fieldName {
	case "HH-Family Description":
		return "family_description"
	case "HH-Family Description Other":
		return "family_description_other"
	case "HH-Jewish Affiliation":
		return "jewish_affiliation"
	case "HH-Jewish Affiliation Other":
		return "jewish_affiliation_other"
	case "HH-Jewish Identities":
		return "jewish_identities"
	case "HH-Name of Congregation":
		return "congregation_summer"
	case "HH-Name of JCC":
		return "jcc_summer"
	case "HH-Military":
		return "military_family"
	case "HH-parent born outside US":
		return "parent_immigrant"
	case "HH-if yes parent born outside US, where":
		return "parent_immigrant_origin"
	case "HH-special living arrangements":
		return "custody_summer"
	case "HH-special living arrange-yes":
		return "has_custody_considerations"
	case "HH-Home or Away":
		return "away_during_camp"
	case "HH-Away location":
		return "away_location"
	case "HH-Phone number while away":
		return "away_phone"
	case "HH-Away From (mm/dd/yy)":
		return "away_from_date"
	case "HH-Returning (mm/dd/yy)":
		return "away_return_date"
	case "HH-Who is filling out info":
		return "form_filler"
	}
	return ""
}

// MapHouseholdFieldToColumn maps household custom field names to database column names
// Exported for testing
func MapHouseholdFieldToColumn(fieldName string) string {
	switch fieldName {
	case "Synagogue":
		return "congregation_family"
	case "Center":
		return "jcc_family"
	case "Custody Issues":
		return "custody_family"
	case "Board":
		return "board_member"
	}
	return ""
}

// ParseBoolValue parses various string representations of boolean values
// Exported for testing
func ParseBoolValue(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case boolYes, boolTrueStr, "1", "y":
		return true
	}
	return false
}

// MakeCompositeKey creates a composite key from household PB ID and year
// Format: "householdPBID|year"
// Exported for testing
func MakeCompositeKey(householdPBID string, year int) string {
	return fmt.Sprintf("%s|%d", householdPBID, year)
}

// loadExistingRecords loads existing household_demographics records for a year
func (s *HouseholdDemographicsSync) loadExistingRecords(ctx context.Context, year int) (map[string]string, error) {
	result := make(map[string]string) // compositeKey -> PB ID

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("household_demographics", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying household_demographics page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			key := MakeCompositeKey(householdID, year)
			result[key] = record.Id
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// upsertRecords creates or updates household demographics records
func (s *HouseholdDemographicsSync) upsertRecords(
	ctx context.Context,
	records map[string]*householdDemographicsRecord,
	existingRecords map[string]string,
	year int,
) (created, updated, errors int) {
	col, err := s.App.FindCollectionByNameOrId("household_demographics")
	if err != nil {
		slog.Error("Error finding household_demographics collection", "error", err)
		return 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, errors
		default:
		}

		key := MakeCompositeKey(rec.householdPBID, year)
		existingID, exists := existingRecords[key]

		var record *core.Record
		if exists {
			// Update existing record
			record, err = s.App.FindRecordById("household_demographics", existingID)
			if err != nil {
				slog.Error("Error finding existing record", "id", existingID, "error", err)
				errors++
				continue
			}
		} else {
			// Create new record
			record = core.NewRecord(col)
		}

		// Set all fields
		record.Set("household", rec.householdPBID)
		record.Set("year", rec.year)
		record.Set("family_description", rec.familyDescription)
		record.Set("family_description_other", rec.familyDescriptionOther)
		record.Set("jewish_affiliation", rec.jewishAffiliation)
		record.Set("jewish_affiliation_other", rec.jewishAffiliationOther)
		record.Set("jewish_identities", rec.jewishIdentities)
		record.Set("congregation_summer", rec.congregationSummer)
		record.Set("congregation_family", rec.congregationFamily)
		record.Set("jcc_summer", rec.jccSummer)
		record.Set("jcc_family", rec.jccFamily)
		record.Set("military_family", rec.militaryFamily)
		record.Set("parent_immigrant", rec.parentImmigrant)
		record.Set("parent_immigrant_origin", rec.parentImmigrantOrigin)
		record.Set("custody_summer", rec.custodySummer)
		record.Set("custody_family", rec.custodyFamily)
		record.Set("has_custody_considerations", rec.hasCustodyConsiderations)
		record.Set("away_during_camp", rec.awayDuringCamp)
		record.Set("away_location", rec.awayLocation)
		record.Set("away_phone", rec.awayPhone)
		record.Set("away_from_date", rec.awayFromDate)
		record.Set("away_return_date", rec.awayReturnDate)
		record.Set("form_filler", rec.formFiller)
		record.Set("board_member", rec.boardMember)

		if err := s.App.Save(record); err != nil {
			slog.Error("Error saving household_demographics record",
				"household", rec.householdPBID,
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
func (s *HouseholdDemographicsSync) deleteOrphans(
	ctx context.Context,
	records map[string]*householdDemographicsRecord,
	existingRecords map[string]string,
) int {
	deleted := 0

	// Build set of computed keys
	computedKeys := make(map[string]bool)
	for _, rec := range records {
		key := MakeCompositeKey(rec.householdPBID, rec.year)
		computedKeys[key] = true
	}

	// Find and delete orphans
	for key, recordID := range existingRecords {
		select {
		case <-ctx.Done():
			return deleted
		default:
		}

		if !computedKeys[key] {
			record, err := s.App.FindRecordById("household_demographics", recordID)
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
func (s *HouseholdDemographicsSync) forceWALCheckpoint() error {
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
