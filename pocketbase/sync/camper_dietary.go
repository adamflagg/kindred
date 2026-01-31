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

// serviceNameCamperDietary is the canonical name for this sync service
const serviceNameCamperDietary = "camper_dietary"

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
type CamperDietarySync struct {
	App            core.App
	Year           int
	DryRun         bool
	Stats          Stats
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

	// Validate year
	if year < 2017 || year > 2099 {
		return fmt.Errorf("invalid year %d: must be between 2017 and 2099", year)
	}

	slog.Info("Starting camper dietary extraction",
		"year", year,
		"dry_run", s.DryRun,
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

	if s.DryRun {
		slog.Info("Dry run mode - extracted but not writing",
			"records", len(records),
		)
		s.Stats.Created = len(records)
		s.SyncSuccessful = true
		return nil
	}

	// Step 4: Load existing records for upsert comparison
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
	slog.Info("Camper dietary extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
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
		name := record.GetString("name")
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
			return nil, ctx.Err()
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
				continue // Not a dietary field
			}

			personID := record.GetInt("person_id")
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
	case "has_dietary_needs":
		rec.hasDietaryNeeds = parseDietaryBoolValue(value)
	case "dietary_explanation":
		if rec.dietaryExplanation == "" {
			rec.dietaryExplanation = value
		}
	case "has_allergies":
		rec.hasAllergies = parseDietaryBoolValue(value)
	case "allergy_info":
		if rec.allergyInfo == "" {
			rec.allergyInfo = value
		}
	case "additional_medical":
		if rec.additionalMedical == "" {
			rec.additionalMedical = value
		}
	}
}

// MapDietaryFieldToColumn maps CampMinder field names to database column names
func MapDietaryFieldToColumn(fieldName string) string {
	switch fieldName {
	case "Family Medical-Dietary Needs":
		return "has_dietary_needs"
	case "Family Medical-Dietary Explain":
		return "dietary_explanation"
	case "Family Medical-Allergies":
		return "has_allergies"
	case "Family Medical-Allergy Info":
		return "allergy_info"
	case "Family Medical-Additional":
		return "additional_medical"
	}
	return ""
}

// parseDietaryBoolValue parses Yes/No values to boolean
func parseDietaryBoolValue(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case "yes", "true", "1", "y":
		return true
	}
	return false
}

// makeCamperDietaryKey creates the composite key for upsert logic
func makeCamperDietaryKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
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
			return nil, ctx.Err()
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
) (created, updated, errors int) {
	col, err := s.App.FindCollectionByNameOrId("camper_dietary")
	if err != nil {
		slog.Error("Error finding camper_dietary collection", "error", err)
		return 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, errors
		default:
		}

		key := makeCamperDietaryKey(rec.personID, year)
		existingID, exists := existingRecords[key]

		var record *core.Record
		if exists {
			record, err = s.App.FindRecordById("camper_dietary", existingID)
			if err != nil {
				slog.Error("Error finding existing record", "id", existingID, "error", err)
				errors++
				continue
			}
		} else {
			record = core.NewRecord(col)
		}

		// Set all fields
		record.Set("attendee", rec.attendeeID)
		record.Set("person_id", rec.personID)
		record.Set("year", rec.year)
		record.Set("has_dietary_needs", rec.hasDietaryNeeds)
		record.Set("dietary_explanation", rec.dietaryExplanation)
		record.Set("has_allergies", rec.hasAllergies)
		record.Set("allergy_info", rec.allergyInfo)
		record.Set("additional_medical", rec.additionalMedical)

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

	return created, updated, errors
}

// deleteOrphans removes records that exist in DB but not in computed set
func (s *CamperDietarySync) deleteOrphans(
	ctx context.Context,
	records map[string]*camperDietaryRecord,
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

	return deleted
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
