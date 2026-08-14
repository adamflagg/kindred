package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameHouseholdDemographics is the canonical name for this sync service
const serviceNameHouseholdDemographics = "household_demographics"

// customFieldNameSynagogue is the custom field name for synagogue data
const customFieldNameSynagogue = "Synagogue"

// HouseholdDemographicsSync computes household demographics from custom values.
// This service reads from person_custom_values (HH- prefixed fields) and
// household_custom_values, then populates the household_demographics table.
//
// Unlike CampMinder API syncs, this doesn't call external APIs - it computes
// derived/aggregated data from existing PocketBase records.
//
// Grain: one row per (household, person, year).
//
// The table used to hold one row per (household, year), and the HH- answers of
// every camper in a household were folded into it first-non-empty-wins. That
// discarded 7,781 answers across ten years (627 in 2026) and the survivor was
// whichever row SQLite's planner happened to yield first -- kindred#2260. The
// answers are given per camper, so the table now stores them per camper.
//
// Field mapping:
//   - HH- prefixed person fields go to _summer columns (from summer camp
//     registration) on the answering camper's row.
//   - Household custom fields go to _family columns (from family camp
//     registration). They are already one row per household per field, so they
//     land on a person-less row (person_id 0) rather than being copied onto
//     every camper.
type HouseholdDemographicsSync struct {
	App    core.App
	Year   int  // Year to compute for (0 = current year from env)
	DryRun bool // Dry run mode (compute but don't write)
	Debug  bool // Enable verbose debug logging
	Stats  Stats
	// SyncSuccessful reports whether this run's extraction produced any rows.
	// Set immediately after extraction, NOT at the end of Sync(), because its
	// one consumer is the orphan sweep, which runs before Sync() returns.
	SyncSuccessful bool

	// columnConflicts counts values setColumn refused to overwrite. Zero on
	// every year of the production snapshot; a non-zero count means two field
	// definitions share a trimmed name.
	columnConflicts int
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

// SetDebug enables or disables debug logging
func (s *HouseholdDemographicsSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2334) so a
// unified sync run with dry_run=true reaches the DryRun field that this service's
// Sync() already checks before it writes.
func (s *HouseholdDemographicsSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// SetYear sets the year for this sync service
func (s *HouseholdDemographicsSync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *HouseholdDemographicsSync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info("[DEBUG] "+msg, args...)
	}
}

// fieldEquals compares two field values for equality, handling type conversions.
// This mirrors the centralized BaseSyncService.FieldEquals logic.
func (s *HouseholdDemographicsSync) fieldEquals(existing, newVal any) bool {
	// Handle nil vs empty string
	if (existing == nil && newVal == "") || (existing == "" && newVal == nil) {
		return true
	}
	// Handle nil vs false (for boolean fields)
	if existing == nil && newVal == false {
		return true
	}
	if existing == false && newVal == nil {
		return true
	}
	// Handle nil vs 0
	if existing == nil && newVal == 0 {
		return true
	}
	if existing == 0 && newVal == nil {
		return true
	}
	// Handle float64 vs int (JSON unmarshals numbers as float64)
	if existFloat, ok := existing.(float64); ok {
		if newInt, ok := newVal.(int); ok {
			return int(existFloat) == newInt
		}
	}
	if existInt, ok := existing.(int); ok {
		if newFloat, ok := newVal.(float64); ok {
			return existInt == int(newFloat)
		}
	}
	// Handle bool comparison
	if existBool, ok := existing.(bool); ok {
		if newBool, ok := newVal.(bool); ok {
			return existBool == newBool
		}
	}

	// String comparison as fallback
	return fmt.Sprintf("%v", existing) == fmt.Sprintf("%v", newVal)
}

// householdDemographicsRecord holds the computed demographics for one row.
//
// personPBID/personCMID are empty/zero on the household-level row that carries
// the _family columns; every other row belongs to the camper who answered.
type householdDemographicsRecord struct {
	householdPBID string
	personPBID    string
	personCMID    int
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
	// Reset alongside Stats: orchestrator.go registers this service as a
	// singleton, so a counter left standing would be reported against the next
	// year's run as well as its own.
	s.columnConflicts = 0

	// Determine year
	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			return fmt.Errorf("year resolution failed: %w", err)
		}
	}

	// Validate year (minimum 2017 per test spec)
	if !isValidDemographicsYear(year) {
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

	// Step 5: Aggregate to one row per (household, person, year)
	records := s.aggregateToRows(personValues, householdValues, year)
	slog.Info("Aggregated to person grain", "rows", len(records), "conflicts", s.columnConflicts)

	// The extraction finished without error, so len(records) is now a fact about
	// the SOURCE rather than about whether this run worked. Gate the sweep on it:
	// a year in which nobody answered is a legitimately empty upstream, not a
	// collapse, and refusing there wedged the table -- a refused sweep never
	// clears the rows, so `existing` stayed high and every later run refused
	// again. This is the policy BaseSyncService.DeleteOrphans already applies
	// ("Only delete orphans if the sync was successful", with SyncSuccessful set
	// mid-fetch and gated on rows arriving); these four declared their own
	// SyncSuccessful at the END of Sync(), where it was always false during
	// their own sweep and nothing ever read it (kindred#2283).
	s.SyncSuccessful = len(records) > 0

	if s.DryRun {
		slog.Info("Dry run mode - computed but not writing",
			"rows", len(records),
		)
		s.Stats.Created = len(records)
		return nil
	}

	// Step 6: Load existing records for upsert comparison
	existingRecords, err := s.loadExistingRecords(ctx, year)
	if err != nil {
		return fmt.Errorf("loading existing records: %w", err)
	}
	slog.Info("Loaded existing records", "count", len(existingRecords))

	// Step 7: Upsert records
	created, updated, skipped, errors := s.upsertRecords(ctx, records, existingRecords, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
	s.Stats.Skipped = skipped
	s.Stats.Errors = errors

	// Step 8: Delete orphans (records in DB but not in computed set)
	deleted, orphanErr := s.deleteOrphans(ctx, records, existingRecords, year)
	s.Stats.Deleted = deleted

	// WAL checkpoint BEFORE the error return below -- upsertRecords has already
	// written by this point, and the refusal path can fire on a non-empty
	// computed set (a PARTIAL collapse), which is exactly the case where writes
	// already happened.
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if err := s.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	if orphanErr != nil {
		return wrapOrphanSweepError(orphanErr)
	}

	slog.Info("Household demographics computation completed",
		"year", year,
		"column_conflicts", s.columnConflicts,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors,
	)

	return nil
}

// isValidDemographicsYear reports whether a year is in the range this service
// will compute for. 2017 is the first year CampMinder data was imported.
func isValidDemographicsYear(year int) bool {
	return year >= 2017 && year <= 2050
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
		name := normalizeFieldName(record.GetString("name"))
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
	case customFieldNameSynagogue, "Center", "Custody Issues", "Board":
		return true
	}

	return false
}

// IsHHField returns true if the field name starts with "HH-"
// Exported for testing
func IsHHField(name string) bool {
	return strings.HasPrefix(name, "HH-")
}

// personRef is what a person PB ID resolves to: the household that person
// belongs to, and the CampMinder id that keys their row. CampMinder ids are the
// identity layer here (CLAUDE.md section 1) -- the PB id is carried alongside
// only to populate the `person` relation.
type personRef struct {
	householdPBID string
	cmID          int
}

// loadPersonHouseholdMapping builds a map of person PB ID -> personRef
func (s *HouseholdDemographicsSync) loadPersonHouseholdMapping(
	ctx context.Context, year int,
) (map[string]personRef, error) {
	result := make(map[string]personRef)

	filter := fmt.Sprintf("year = %d && household != ''", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := s.App.FindRecordsByFilter("persons", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying persons page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			if householdID != "" {
				result[record.Id] = personRef{householdPBID: householdID, cmID: record.GetInt("cm_id")}
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// hhCustomValueEntry represents a loaded HH custom value.
//
// personPBID/personCMID identify the camper who gave the answer, and are
// empty/zero for household-level (family camp) values, which have no camper.
type hhCustomValueEntry struct {
	householdPBID string
	personPBID    string
	personCMID    int
	fieldName     string
	value         string
}

// loadPersonCustomValues loads person custom values for HH- prefixed fields
func (s *HouseholdDemographicsSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, personToHousehold map[string]personRef,
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

		records, err := s.App.FindRecordsByFilter("person_custom_values", filter, sortByID, perPage, (page-1)*perPage)
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
			ref := personToHousehold[personID]
			value := record.GetString("value")

			if ref.householdPBID != "" && value != "" {
				result = append(result, hhCustomValueEntry{
					householdPBID: ref.householdPBID,
					personPBID:    personID,
					personCMID:    ref.cmID,
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

		records, err := s.App.FindRecordsByFilter("household_custom_values", filter, sortByID, perPage, (page-1)*perPage)
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

// aggregateToRows groups custom values into rows at the table's grain:
// (household, person, year) for the HH- answers a camper gave, and
// (household, 0, year) for the household-level family camp answers.
//
// The map is keyed by MakeCompositeKey, the same write key upsertRecords and
// deleteOrphans use -- the three must agree or a sweep deletes what a write
// just created (kindred#2257, "the grain triple").
//
// Order-independent by construction: at this grain each column has at most one
// contributing value, so nothing here depends on the order the loaders read
// rows in.
func (s *HouseholdDemographicsSync) aggregateToRows(
	personValues []hhCustomValueEntry,
	householdValues []hhCustomValueEntry,
	year int,
) map[string]*householdDemographicsRecord {
	records := make(map[string]*householdDemographicsRecord)

	// Helper to get or create the row for one grain key
	getRecord := func(v hhCustomValueEntry) *householdDemographicsRecord {
		key := MakeCompositeKey(v.householdPBID, v.personCMID, year)
		if records[key] == nil {
			records[key] = &householdDemographicsRecord{
				householdPBID: v.householdPBID,
				personPBID:    v.personPBID,
				personCMID:    v.personCMID,
				year:          year,
			}
		}
		return records[key]
	}

	// Process person custom values (HH- fields) -> _summer columns
	for _, v := range personValues {
		rec := getRecord(v)
		s.mapPersonFieldToRecord(rec, v.fieldName, v.value)
	}

	// Process household custom values -> _family columns
	for _, v := range householdValues {
		rec := getRecord(v)
		s.mapHouseholdFieldToRecord(rec, v.fieldName, v.value)
	}

	return records
}

// setColumn writes a text column, and refuses to overwrite it with a different
// value.
//
// At this grain a second value cannot legitimately arrive: person_custom_values
// is UNIQUE(year, person, field_definition), household_custom_values is
// UNIQUE(year, household, field_definition), and both mapping switches are
// injective, so one row contributes at most one value per column. The only way
// here is two field definitions sharing a trimmed name -- zero exist today.
//
// That makes this a must-be-unique rule rather than a collapse rule, and the
// difference from the code it replaces is the whole point of kindred#2260: the
// old `if rec.X == ""` guard silently dropped a real disagreement between two
// campers. There is no disagreement left to drop, so anything reaching the
// refusal below is a data fault worth hearing about rather than a routine
// collision to resolve.
func (s *HouseholdDemographicsSync) setColumn(rec *householdDemographicsRecord, dst *string, column, value string) {
	if *dst == "" {
		*dst = value
		return
	}
	if *dst == value {
		return // the same answer twice discards nothing
	}
	s.columnConflicts++
	// Identifiers only. These columns hold sensitive-category answers (Jewish
	// identity and affiliation, LGBTQ and interfaith family description, custody
	// arrangements) and a log is a wider audience than the table's admin-only
	// API rules; both values are recoverable from person_custom_values by
	// anyone entitled to see them.
	slog.Warn("Conflicting values for one demographics column at (household, person, year)",
		"household", rec.householdPBID,
		"person", rec.personPBID,
		"year", rec.year,
		"column", column,
	)
}

// mapPersonFieldToRecord maps a HH- person field onto the answering camper's row.
//
// The 14 text columns go through setColumn, which is a must-be-unique rule --
// see its comment. It replaces the `if rec.X == ""` first-non-empty-wins guard
// that gave kindred#2260 its name: at household grain that guard let the first
// camper read speak for the family and threw the rest away.
//
// The four boolean arms are unchanged. They are logical ORs over the
// contributing values, never first-wins, so they were never part of the defect;
// at this grain they OR over one camper's answers instead of the household's.
func (s *HouseholdDemographicsSync) mapPersonFieldToRecord(rec *householdDemographicsRecord, fieldName, value string) {
	// Use MapHHFieldToColumn for the field mapping
	column := MapHHFieldToColumn(fieldName)
	if column == "" {
		return // Unknown field
	}

	switch column {
	case "family_description":
		s.setColumn(rec, &rec.familyDescription, column, value)
	case "family_description_other":
		s.setColumn(rec, &rec.familyDescriptionOther, column, value)
	case "jewish_affiliation":
		s.setColumn(rec, &rec.jewishAffiliation, column, value)
	case "jewish_affiliation_other":
		s.setColumn(rec, &rec.jewishAffiliationOther, column, value)
	case "jewish_identities":
		s.setColumn(rec, &rec.jewishIdentities, column, value)
	case "congregation_summer":
		s.setColumn(rec, &rec.congregationSummer, column, value)
	case "jcc_summer":
		s.setColumn(rec, &rec.jccSummer, column, value)
	case "military_family":
		// Logical OR over the contributing values -- order-independent
		if !rec.militaryFamily && ParseBoolValue(value) {
			rec.militaryFamily = true
		}
	case "parent_immigrant":
		if !rec.parentImmigrant && ParseBoolValue(value) {
			rec.parentImmigrant = true
		}
	case "parent_immigrant_origin":
		s.setColumn(rec, &rec.parentImmigrantOrigin, column, value)
	case "custody_summer":
		s.setColumn(rec, &rec.custodySummer, column, value)
	case "has_custody_considerations":
		if !rec.hasCustodyConsiderations && ParseBoolValue(value) {
			rec.hasCustodyConsiderations = true
		}
	case "away_during_camp":
		if !rec.awayDuringCamp && ParseBoolValue(value) {
			rec.awayDuringCamp = true
		}
	case "away_location":
		s.setColumn(rec, &rec.awayLocation, column, value)
	case "away_phone":
		s.setColumn(rec, &rec.awayPhone, column, value)
	case "away_from_date":
		s.setColumn(rec, &rec.awayFromDate, column, value)
	case "away_return_date":
		s.setColumn(rec, &rec.awayReturnDate, column, value)
	case "form_filler":
		s.setColumn(rec, &rec.formFiller, column, value)
	}
}

// mapHouseholdFieldToRecord maps a household custom field onto the
// household-level row.
//
// These three text columns were never part of kindred#2260 -- household_custom_values
// is one row per household per field, so no second value could ever arrive and
// the old first-wins guard was unreachable. They use setColumn for the same
// reason the person arms do: one rule in this file, and a data fault that
// cannot happen becomes audible rather than silent if it ever does.
func (s *HouseholdDemographicsSync) mapHouseholdFieldToRecord(
	rec *householdDemographicsRecord, fieldName, value string,
) {
	column := MapHouseholdFieldToColumn(fieldName)
	if column == "" {
		return
	}

	switch column {
	case "congregation_family":
		s.setColumn(rec, &rec.congregationFamily, column, value)
	case "jcc_family":
		s.setColumn(rec, &rec.jccFamily, column, value)
	case "custody_family":
		s.setColumn(rec, &rec.custodyFamily, column, value)
	case "board_member":
		// Logical OR, as on the person side
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
	case customFieldNameSynagogue:
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

// MakeCompositeKey creates a composite key from household PB ID, person
// CampMinder ID and year.
// Format: "householdPBID|personCMID|year"
// Exported for testing
func MakeCompositeKey(householdPBID string, personCMID, year int) string {
	return fmt.Sprintf("%s|%d|%d", householdPBID, personCMID, year)
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

		records, err := s.App.FindRecordsByFilter("household_demographics", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying household_demographics page %d: %w", page, err)
		}

		for _, record := range records {
			householdID := record.GetString("household")
			key := MakeCompositeKey(householdID, record.GetInt("person_id"), year)
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
) (created, updated, skipped, errors int) {
	col, err := s.App.FindCollectionByNameOrId("household_demographics")
	if err != nil {
		slog.Error("Error finding household_demographics collection", "error", err)
		return 0, 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errors
		default:
		}

		key := MakeCompositeKey(rec.householdPBID, rec.personCMID, year)
		existingID, exists := existingRecords[key]

		// Build data map for comparison and setting
		data := map[string]any{
			"household":                  rec.householdPBID,
			"person":                     rec.personPBID,
			"person_id":                  rec.personCMID,
			"year":                       rec.year,
			"family_description":         rec.familyDescription,
			"family_description_other":   rec.familyDescriptionOther,
			"jewish_affiliation":         rec.jewishAffiliation,
			"jewish_affiliation_other":   rec.jewishAffiliationOther,
			"jewish_identities":          rec.jewishIdentities,
			"congregation_summer":        rec.congregationSummer,
			"congregation_family":        rec.congregationFamily,
			"jcc_summer":                 rec.jccSummer,
			"jcc_family":                 rec.jccFamily,
			"military_family":            rec.militaryFamily,
			"parent_immigrant":           rec.parentImmigrant,
			"parent_immigrant_origin":    rec.parentImmigrantOrigin,
			"custody_summer":             rec.custodySummer,
			"custody_family":             rec.custodyFamily,
			"has_custody_considerations": rec.hasCustodyConsiderations,
			"away_during_camp":           rec.awayDuringCamp,
			"away_location":              rec.awayLocation,
			"away_phone":                 rec.awayPhone,
			"away_from_date":             rec.awayFromDate,
			"away_return_date":           rec.awayReturnDate,
			"form_filler":                rec.formFiller,
			"board_member":               rec.boardMember,
		}

		var record *core.Record
		if exists {
			// Update existing record
			record, err = s.App.FindRecordById("household_demographics", existingID)
			if err != nil {
				slog.Error("Error finding existing record", "id", existingID, "error", err)
				errors++
				continue
			}

			// Check if update is needed
			needsUpdate := false
			skipFields := map[string]bool{
				"id": true, "created": true, "updated": true,
				"household": true, "person": true, "person_id": true, "year": true,
			}
			for field, newValue := range data {
				if skipFields[field] {
					continue
				}
				if !s.fieldEquals(record.Get(field), newValue) {
					needsUpdate = true
					break
				}
			}

			if !needsUpdate {
				skipped++
				continue
			}
		} else {
			// Create new record
			record = core.NewRecord(col)
		}

		// Set all fields
		for field, value := range data {
			record.Set(field, value)
		}

		if err := s.App.Save(record); err != nil {
			slog.Error("Error saving household_demographics record",
				"household", rec.householdPBID,
				"person", rec.personPBID,
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

	return created, updated, skipped, errors
}

// deleteOrphans removes records that exist in DB but not in computed set.
//
// The key here is leg three of the grain triple and must match the write key in
// upsertRecords exactly. Widen one without the other and the next run sweeps
// away the rows the other just wrote, reporting success as it goes
// (kindred#2257).
//
// Refuses when the computed set is too small to be believed against the rows
// on disk. This USED to be a hand-rolled `len(records) == 0` check that caught
// only a TOTAL collapse -- a load that returned a handful of rows against
// hundreds on disk sailed straight past it and the sweep deleted the rest
// (kindred#2283). The rule now lives in the shared OrphanSweepGuard, which
// widens "empty" to "suspiciously small" and is the one implementation behind
// every guarded sweep in this package rather than an eighth local copy.
//
// The old check also did `s.Stats.Errors++` on refusal, and that increment was
// deliberately NOT carried over. Stats.Errors counts infrastructure failures --
// a save that did not land, a query that broke -- and kindred#2293 makes a
// non-zero count fail the run outright. A refusal is not an infrastructure
// failure: it is this guard working, and it already reaches the operator as
// the error Sync() returns. Counting it as well would report one event twice
// and make a healthy refusal indistinguishable from a broken database.
func (s *HouseholdDemographicsSync) deleteOrphans(
	ctx context.Context,
	records map[string]*householdDemographicsRecord,
	existingRecords map[string]string,
	year int,
) (int, error) {
	// An empty source is not a collapse. Sync() sets SyncSuccessful from the
	// size of this run's extraction, so a year nobody answered skips the sweep
	// and succeeds rather than refusing forever (kindred#2283). The guard below
	// still owns the case that matters: a source that came back SHORT.
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion: the source returned no rows for this year",
			"entity", "household_demographics", "year", year)
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "household_demographics",
		Year:     year,
		Computed: len(records),
		Hint:     "check that the persons sync ran for that year and that person_custom_values loaded",
	}
	if err := guard.Check(len(existingRecords)); err != nil {
		return 0, err
	}

	deleted := 0

	// Build set of computed keys
	computedKeys := make(map[string]bool)
	for _, rec := range records {
		key := MakeCompositeKey(rec.householdPBID, rec.personCMID, rec.year)
		computedKeys[key] = true
	}

	// Find and delete orphans
	for key, recordID := range existingRecords {
		select {
		case <-ctx.Done():
			return deleted, ctx.Err()
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

	return deleted, nil
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
