package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameCamperDietary is the canonical name for this sync service
const serviceNameCamperDietary = "camper_dietary"

// camperDietaryCompareFields lists the fields to compare for idempotency checks.
// Only these fields are checked when deciding whether an existing record needs updating.
// Excludes PocketBase-managed fields (id, created, updated, collectionId, collectionName).
var camperDietaryCompareFields = []string{
	"attendee", "person_id", "year",
	"has_dietary_needs", "dietary_explanation",
	"has_allergies", "allergy_info", "additional_medical",
}

// Column name constants for camper_dietary table
const (
	colHasDietaryNeeds    = "has_dietary_needs"
	colDietaryExplanation = "dietary_explanation"
	colHasAllergies       = "has_allergies"
	colAllergyInfo        = "allergy_info"
	colAdditionalMedical  = "additional_medical"
)

// CamperDietarySync extracts Family Medical-* custom fields for campers.
// This service reads from person_custom_values and populates the camper_dietary table.
//
// Unique key: (person_id, year) - one record per camper per year
// Links to: attendees (any attendee record for this person-year)
//
// Field mapping:
// - Family Medical-Dietary Needs -> has_dietary_needs (bool)
// - Family Medical-Dietary Explain -> dietary_explanation
// - Family Medical-Allergies -> has_allergies (bool)
// - Family Medical-Allergy Info -> allergy_info
// - Family Medical-Additional -> additional_medical
//
// Rows persist after a camper cancels; this table is never swept by deletion. A future reader
// (e.g. a staff dashboard) must filter by active enrolment for the view's own year -- an
// `attendees` row with status_id = 2 for that person and year -- and must not filter across
// years. See "Reading Derived Informational Tables (Active-Enrolment Filtering)" in
// docs/architecture/sync-layer.md.
type CamperDietarySync struct {
	App    core.App
	Year   int
	DryRun bool
	Debug  bool
	Stats  Stats
	// SyncSuccessful reports whether this run's extraction produced any rows.
	// Set immediately after extraction, NOT at the end of Sync(), because its
	// one consumer is the orphan sweep, which runs before Sync() returns.
	SyncSuccessful bool
}

// NewCamperDietarySync creates a new camper dietary sync service
func NewCamperDietarySync(app core.App) *CamperDietarySync {
	return &CamperDietarySync{
		App:    app,
		Year:   0,
		DryRun: false,
	}
}

// Name returns the service name
func (s *CamperDietarySync) Name() string {
	return serviceNameCamperDietary
}

// GetStats returns the current stats
func (s *CamperDietarySync) GetStats() Stats {
	return s.Stats
}

// SetDebug enables or disables debug logging
func (s *CamperDietarySync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetYear sets the year for this sync service
func (s *CamperDietarySync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *CamperDietarySync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
}

// camperDietaryRecord holds the extracted dietary info for a camper
type camperDietaryRecord struct {
	personID   int
	year       int
	attendeeID string // PocketBase ID of an attendee record

	hasDietaryNeeds    bool
	dietaryExplanation string
	hasAllergies       bool
	allergyInfo        string
	additionalMedical  string
}

// Sync executes the camper dietary extraction
func (s *CamperDietarySync) Sync(ctx context.Context) error {
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Determine year
	year := s.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			return fmt.Errorf("year resolution failed: %w", err)
		}
	}

	// Validate year
	if year < 2017 || year > 2099 {
		return fmt.Errorf("invalid year %d: must be between 2017 and 2099", year)
	}

	slog.Info("Starting camper dietary extraction",
		"year", year,
		"dry_run", s.DryRun,
		"debug", s.Debug,
	)

	// Step 1: Build field name mapping (field_definition PB ID -> field name)
	fieldNameMap, err := s.loadFieldDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading field definitions: %w", err)
	}
	slog.Info("Loaded field definitions", "count", len(fieldNameMap))

	// Step 2: Load person -> attendee mapping (person CM ID -> attendee PB ID)
	personToAttendee, err := s.loadPersonAttendeeMapping(ctx, year)
	if err != nil {
		return fmt.Errorf("loading person-attendee mapping: %w", err)
	}
	slog.Info("Loaded person-attendee mapping", "count", len(personToAttendee))

	// Step 3: Load person custom values (Family Medical-* fields)
	records, err := s.loadPersonCustomValues(ctx, year, fieldNameMap, personToAttendee)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Extracted camper dietary records", "count", len(records))

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
		slog.Info("Dry run mode - extracted but not writing",
			"records", len(records),
		)
		s.Stats.Created = len(records)
		return nil
	}

	// Step 4: Load existing records for upsert comparison
	existingRecords, err := s.loadExistingRecords(ctx, year)
	if err != nil {
		return fmt.Errorf("loading existing records: %w", err)
	}
	slog.Info("Loaded existing records", "count", len(existingRecords))

	// Step 5: Upsert records
	created, updated, skipped, errors := s.upsertRecords(ctx, records, existingRecords, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
	s.Stats.Skipped = skipped
	s.Stats.Errors = errors

	// Step 6: Delete orphans
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

	slog.Info("Camper dietary extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"skipped", s.Stats.Skipped,
		"deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors,
	)

	return nil
}

// loadFieldDefinitions builds a map of field_definition PB ID -> field name
// Only loads Family Medical-* prefixed fields we care about
func (s *CamperDietarySync) loadFieldDefinitions(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying field definitions: %w", err)
	}

	for _, record := range records {
		name := normalizeFieldName(record.GetString("name"))
		if isCamperDietaryField(name) {
			result[record.Id] = name
		}
	}

	return result, nil
}

// isCamperDietaryField checks if a field is relevant for camper dietary
func isCamperDietaryField(name string) bool {
	switch name {
	case "Family Medical-Dietary Needs",
		"Family Medical-Dietary Explain",
		"Family Medical-Allergies",
		"Family Medical-Allergy Info",
		"Family Medical-Additional":
		return true
	}
	return false
}

// loadPersonAttendeeMapping builds a map of person CM ID -> attendee PB ID
// We use the first attendee record found for each person-year combination
func (s *CamperDietarySync) loadPersonAttendeeMapping(
	ctx context.Context, year int,
) (map[int]string, error) {
	result := make(map[int]string)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("dietary needs query cancelled: %w", ctx.Err())
		default:
		}

		records, err := s.App.FindRecordsByFilter("attendees", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying attendees page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			if personID > 0 {
				// First one wins (we just need any attendee for the relation)
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

// dietaryValueEntry represents a loaded dietary custom value
type dietaryValueEntry struct {
	personID  int
	fieldName string
	value     string
}

// loadPersonCustomValues loads person custom values for Family Medical-* fields
func (s *CamperDietarySync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, personToAttendee map[int]string,
) (map[string]*camperDietaryRecord, error) {
	// Collect all values first
	var entries []dietaryValueEntry

	// Cache for person PB ID -> CM ID lookups
	personCache := make(map[string]int)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("custom values query cancelled: %w", ctx.Err())
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
				continue // Not a dietary field
			}

			// person_custom_values has "person" relation field (PB ID), not "person_id"
			personPBID := record.GetString("person")
			if personPBID == "" {
				continue
			}

			// Look up CM ID from cache or persons table
			personID := 0
			if cached, ok := personCache[personPBID]; ok {
				personID = cached
			} else {
				personFilter := fmt.Sprintf("id = '%s'", personPBID)
				persons, err := s.App.FindRecordsByFilter("persons", personFilter, "", 1, 0)
				if err == nil && len(persons) > 0 {
					if cmID, ok := persons[0].Get("cm_id").(float64); ok {
						personID = int(cmID)
						personCache[personPBID] = personID
					}
				}
			}

			value := record.GetString("value")

			if personID > 0 && value != "" {
				entries = append(entries, dietaryValueEntry{
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
	result := make(map[string]*camperDietaryRecord)

	for _, entry := range entries {
		attendeeID, hasAttendee := personToAttendee[entry.personID]
		if !hasAttendee {
			continue // Skip if no attendee record for this person
		}

		key := makeCamperDietaryKey(entry.personID, year)
		rec := result[key]
		if rec == nil {
			rec = &camperDietaryRecord{
				personID:   entry.personID,
				year:       year,
				attendeeID: attendeeID,
			}
			result[key] = rec
		}

		// Map field to record
		mapDietaryFieldToRecord(rec, entry.fieldName, entry.value)
	}

	return result, nil
}

// mapDietaryFieldToRecord maps a Family Medical-* field to the record
func mapDietaryFieldToRecord(rec *camperDietaryRecord, fieldName, value string) {
	column := MapDietaryFieldToColumn(fieldName)
	if column == "" {
		return
	}

	switch column {
	case colHasDietaryNeeds:
		rec.hasDietaryNeeds = parseDietaryBoolValue(value)
	case colDietaryExplanation:
		if rec.dietaryExplanation == "" {
			rec.dietaryExplanation = value
		}
	case colHasAllergies:
		rec.hasAllergies = parseDietaryBoolValue(value)
	case colAllergyInfo:
		if rec.allergyInfo == "" {
			rec.allergyInfo = value
		}
	case colAdditionalMedical:
		if rec.additionalMedical == "" {
			rec.additionalMedical = value
		}
	}
}

// MapDietaryFieldToColumn maps CampMinder field names to database column names
func MapDietaryFieldToColumn(fieldName string) string {
	switch fieldName {
	case "Family Medical-Dietary Needs":
		return colHasDietaryNeeds
	case "Family Medical-Dietary Explain":
		return colDietaryExplanation
	case "Family Medical-Allergies":
		return colHasAllergies
	case "Family Medical-Allergy Info":
		return colAllergyInfo
	case "Family Medical-Additional":
		return colAdditionalMedical
	}
	return ""
}

// parseDietaryBoolValue parses Yes/No values to boolean
func parseDietaryBoolValue(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case boolYes, boolTrue, "1", "y":
		return true
	}
	return false
}

// makeCamperDietaryKey creates the composite key for upsert logic
func makeCamperDietaryKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}

// recordNeedsUpdate checks if any compared field differs between existing record and new data.
// Uses compareFields (inclusion list): only the listed fields are checked for changes.
// Delegates to the shared compareRecordNeedsUpdate in base_sync.go.
func (s *CamperDietarySync) recordNeedsUpdate(record *core.Record, data map[string]any, compareFields []string) bool {
	return compareRecordNeedsUpdate(record, data, compareFields)
}

// loadExistingRecords loads existing camper_dietary records for a year
func (s *CamperDietarySync) loadExistingRecords(ctx context.Context, year int) (map[string]string, error) {
	result := make(map[string]string) // compositeKey -> PB ID

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("loading existing dietary records cancelled: %w", ctx.Err())
		default:
		}

		records, err := s.App.FindRecordsByFilter("camper_dietary", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying camper_dietary page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			key := makeCamperDietaryKey(personID, year)
			result[key] = record.Id
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// upsertRecords creates or updates camper dietary records
func (s *CamperDietarySync) upsertRecords(
	ctx context.Context,
	records map[string]*camperDietaryRecord,
	existingRecords map[string]string,
	year int,
) (created, updated, skipped, errors int) {
	col, err := s.App.FindCollectionByNameOrId("camper_dietary")
	if err != nil {
		slog.Error("Error finding camper_dietary collection", "error", err)
		return 0, 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errors
		default:
		}

		key := makeCamperDietaryKey(rec.personID, year)
		existingID, exists := existingRecords[key]

		// Build data map for comparison
		data := map[string]any{
			"attendee":            rec.attendeeID,
			"person_id":           rec.personID,
			"year":                rec.year,
			"has_dietary_needs":   rec.hasDietaryNeeds,
			"dietary_explanation": rec.dietaryExplanation,
			"has_allergies":       rec.hasAllergies,
			"allergy_info":        rec.allergyInfo,
			"additional_medical":  rec.additionalMedical,
		}

		var record *core.Record
		if exists {
			record, err = s.App.FindRecordById("camper_dietary", existingID)
			if err != nil {
				slog.Error("Error finding existing record", "id", existingID, "error", err)
				errors++
				continue
			}

			// Check if update is actually needed
			if !s.recordNeedsUpdate(record, data, camperDietaryCompareFields) {
				s.DebugLog("Skipping unchanged dietary record", "person_id", rec.personID, "year", year)
				skipped++
				continue
			}
			s.DebugLog("Updating dietary record", "person_id", rec.personID, "year", year)
		} else {
			record = core.NewRecord(col)
		}

		// Set all fields
		for field, value := range data {
			record.Set(field, value)
		}

		if err := s.App.Save(record); err != nil {
			slog.Error("Error saving camper_dietary record",
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

	return created, updated, skipped, errors
}

// deleteOrphans removes records that exist in DB but not in computed set.
//
// Refuses when the computed set is too small to be believed against the rows
// on disk: that combination is always a broken input, and sweeping on it
// deletes the year and reports success (kindred#2257, kindred#2283). The rule
// lives in OrphanSweepGuard so there is one implementation, not an eighth copy.
func (s *CamperDietarySync) deleteOrphans(
	ctx context.Context,
	records map[string]*camperDietaryRecord,
	existingRecords map[string]string,
	year int,
) (int, error) {
	// An empty source is not a collapse. Sync() sets SyncSuccessful from the
	// size of this run's extraction, so a year nobody answered skips the sweep
	// and succeeds rather than refusing forever (kindred#2283). The guard below
	// still owns the case that matters: a source that came back SHORT.
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion: the source returned no rows for this year",
			"entity", "camper_dietary", "year", year)
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "camper_dietary",
		Year:     year,
		Computed: len(records),
		Hint:     "check that the attendee mapping and the dietary field definitions still exist upstream",
	}
	if err := guard.Check(len(existingRecords)); err != nil {
		return 0, err
	}

	deleted := 0

	for key, recordID := range existingRecords {
		select {
		case <-ctx.Done():
			return deleted, ctx.Err()
		default:
		}

		if _, exists := records[key]; !exists {
			record, err := s.App.FindRecordById("camper_dietary", recordID)
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
func (s *CamperDietarySync) forceWALCheckpoint() error {
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
