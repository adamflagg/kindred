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

// serviceNameCamperTransportation is the canonical name for this sync service
const serviceNameCamperTransportation = "camper_transportation"

// CamperTransportationSync extracts BUS-* custom fields for camper transportation.
// This service reads from person_custom_values and populates the camper_transportation table.
//
// Unique key: (person_id, session_id, year) - one record per camper per session
// Links to: attendees
//
// Field mapping handles both new BUS-* fields and legacy "Bus to/From Camp" fields.
// New fields take priority; legacy fields are used as fallback.
type CamperTransportationSync struct {
	App            core.App
	Year           int
	DryRun         bool
	Stats          Stats
	SyncSuccessful bool
}

// NewCamperTransportationSync creates a new camper transportation sync service
func NewCamperTransportationSync(app core.App) *CamperTransportationSync {
	return &CamperTransportationSync{
		App:    app,
		Year:   0,
		DryRun: false,
	}
}

// Name returns the service name
func (s *CamperTransportationSync) Name() string {
	return serviceNameCamperTransportation
}

// GetStats returns the current stats
func (s *CamperTransportationSync) GetStats() Stats {
	return s.Stats
}

// camperTransportationRecord holds the extracted transportation info for a camper-session
type camperTransportationRecord struct {
	personID   int
	sessionID  int
	year       int
	attendeeID string // PocketBase ID of attendee record

	toCampMethod     string
	fromCampMethod   string
	dropoffName      string
	dropoffPhone     string
	dropoffRelation  string
	pickupName       string
	pickupPhone      string
	pickupRelation   string
	altPickup1Name   string
	altPickup1Phone  string
	altPickup1Rel    string
	altPickup2Name   string
	altPickup2Phone  string
	usedLegacyFields bool
}

// Sync executes the camper transportation extraction
func (s *CamperTransportationSync) Sync(ctx context.Context) error {
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

	slog.Info("Starting camper transportation extraction",
		"year", year,
		"dry_run", s.DryRun,
	)

	// Step 1: Build field name mapping (field_definition PB ID -> field name)
	fieldNameMap, err := s.loadFieldDefinitions(ctx)
	if err != nil {
		return fmt.Errorf("loading field definitions: %w", err)
	}
	slog.Info("Loaded field definitions", "count", len(fieldNameMap))

	// Step 2: Load attendee info (person_id, session_id -> attendee PB ID)
	attendeeMap, err := s.loadAttendeeMapping(ctx, year)
	if err != nil {
		return fmt.Errorf("loading attendee mapping: %w", err)
	}
	slog.Info("Loaded attendee mapping", "count", len(attendeeMap))

	// Step 3: Load person custom values (BUS-* fields)
	records, err := s.loadPersonCustomValues(ctx, year, fieldNameMap, attendeeMap)
	if err != nil {
		return fmt.Errorf("loading person custom values: %w", err)
	}
	slog.Info("Extracted camper transportation records", "count", len(records))

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
	slog.Info("Camper transportation extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"errors", s.Stats.Errors,
	)

	return nil
}

// loadFieldDefinitions builds a map of field_definition PB ID -> field name
// Only loads BUS-* prefixed fields and legacy Bus to/From fields
func (s *CamperTransportationSync) loadFieldDefinitions(_ context.Context) (map[string]string, error) {
	result := make(map[string]string)

	records, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying field definitions: %w", err)
	}

	for _, record := range records {
		name := record.GetString("name")
		if isCamperTransportationField(name) {
			result[record.Id] = name
		}
	}

	return result, nil
}

// isCamperTransportationField checks if a field is relevant for camper transportation
func isCamperTransportationField(name string) bool {
	// BUS-* prefixed fields
	if strings.HasPrefix(name, "BUS-") {
		return true
	}
	// Legacy fields
	if name == "Bus to Camp" || name == "Bus From Camp" {
		return true
	}
	return false
}

// attendeeKey is the composite key for attendee lookup
type attendeeKey struct {
	personID  int
	sessionID int
}

// loadAttendeeMapping builds a map of (person_id, session_id) -> attendee PB ID
func (s *CamperTransportationSync) loadAttendeeMapping(
	ctx context.Context, year int,
) (map[attendeeKey]string, error) {
	result := make(map[attendeeKey]string)

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
			sessionID := record.GetInt("session_id")
			if personID > 0 && sessionID > 0 {
				key := attendeeKey{personID: personID, sessionID: sessionID}
				result[key] = record.Id
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// transportValueEntry represents a loaded transportation custom value
type transportValueEntry struct {
	personID  int
	sessionID int // From attendee lookup
	fieldName string
	value     string
}

// loadPersonCustomValues loads person custom values for BUS-* fields
func (s *CamperTransportationSync) loadPersonCustomValues(
	ctx context.Context, year int, fieldNameMap map[string]string, attendeeMap map[attendeeKey]string,
) (map[string]*camperTransportationRecord, error) {
	// Build person -> sessions mapping from attendee map
	personSessions := make(map[int][]int)
	for key := range attendeeMap {
		personSessions[key.personID] = append(personSessions[key.personID], key.sessionID)
	}

	// Collect all values first
	var entries []transportValueEntry

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
				continue // Not a transportation field
			}

			personID := record.GetInt("person_id")
			value := record.GetString("value")

			if personID > 0 && value != "" {
				// Create entry for each session this person is in
				sessions := personSessions[personID]
				for _, sessionID := range sessions {
					entries = append(entries, transportValueEntry{
						personID:  personID,
						sessionID: sessionID,
						fieldName: fieldName,
						value:     value,
					})
				}
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	// Aggregate to person-session level
	result := make(map[string]*camperTransportationRecord)

	for _, entry := range entries {
		key := attendeeKey{personID: entry.personID, sessionID: entry.sessionID}
		attendeeID, hasAttendee := attendeeMap[key]
		if !hasAttendee {
			continue
		}

		compositeKey := makeTransportationKey(entry.personID, entry.sessionID, year)
		rec := result[compositeKey]
		if rec == nil {
			rec = &camperTransportationRecord{
				personID:   entry.personID,
				sessionID:  entry.sessionID,
				year:       year,
				attendeeID: attendeeID,
			}
			result[compositeKey] = rec
		}

		// Map field to record
		mapTransportFieldToRecord(rec, entry.fieldName, entry.value)
	}

	return result, nil
}

// mapTransportFieldToRecord maps a BUS-* field to the record
func mapTransportFieldToRecord(rec *camperTransportationRecord, fieldName, value string) {
	column := MapTransportationFieldToColumn(fieldName)
	if column == "" {
		return
	}

	switch column {
	case "to_camp_method":
		// New fields take priority
		if rec.toCampMethod == "" || !strings.HasPrefix(fieldName, "Bus ") {
			rec.toCampMethod = value
		}
		// Track if using legacy field
		if fieldName == "Bus to Camp" {
			rec.usedLegacyFields = true
		}
	case "from_camp_method":
		if rec.fromCampMethod == "" || !strings.HasPrefix(fieldName, "Bus ") {
			rec.fromCampMethod = value
		}
		if fieldName == "Bus From Camp" {
			rec.usedLegacyFields = true
		}
	case "dropoff_name":
		if rec.dropoffName == "" {
			rec.dropoffName = value
		}
	case "dropoff_phone":
		if rec.dropoffPhone == "" {
			rec.dropoffPhone = value
		}
	case "dropoff_relationship":
		if rec.dropoffRelation == "" {
			rec.dropoffRelation = value
		}
	case "pickup_name":
		if rec.pickupName == "" {
			rec.pickupName = value
		}
	case "pickup_phone":
		if rec.pickupPhone == "" {
			rec.pickupPhone = value
		}
	case "pickup_relationship":
		if rec.pickupRelation == "" {
			rec.pickupRelation = value
		}
	case "alt_pickup_1_name":
		if rec.altPickup1Name == "" {
			rec.altPickup1Name = value
		}
	case "alt_pickup_1_phone":
		if rec.altPickup1Phone == "" {
			rec.altPickup1Phone = value
		}
	case "alt_pickup_1_relationship":
		if rec.altPickup1Rel == "" {
			rec.altPickup1Rel = value
		}
	case "alt_pickup_2_name":
		if rec.altPickup2Name == "" {
			rec.altPickup2Name = value
		}
	case "alt_pickup_2_phone":
		if rec.altPickup2Phone == "" {
			rec.altPickup2Phone = value
		}
	}
}

// MapTransportationFieldToColumn maps CampMinder field names to database column names
func MapTransportationFieldToColumn(fieldName string) string {
	switch fieldName {
	// To/From camp method
	case "BUS-to camp", "Bus to Camp":
		return "to_camp_method"
	case "BUS-home from camp", "Bus From Camp":
		return "from_camp_method"

	// Dropoff info
	case "BUS-who is dropping off":
		return "dropoff_name"
	case "BUS-Phone number of person dropping off-correct":
		return "dropoff_phone"
	case "BUS-relation to camper drop off":
		return "dropoff_relationship"

	// Pickup info
	case "BUS-person picking up":
		return "pickup_name"
	case "BUS-phone number of person picking up":
		return "pickup_phone"
	case "BUS-relationship to camper pick up person":
		return "pickup_relationship"

	// Alternate pickup 1
	case "BUS-alternate person 1 picking up":
		return "alt_pickup_1_name"
	case "BUS-alternate 1 phone":
		return "alt_pickup_1_phone"
	case "BUS-alternate person relation to camper":
		return "alt_pickup_1_relationship"

	// Alternate pickup 2
	case "BUS-alternate person 2":
		return "alt_pickup_2_name"
	case "BUS-alternate person 2 phone":
		return "alt_pickup_2_phone"
	}
	return ""
}

// makeTransportationKey creates the composite key for upsert logic
func makeTransportationKey(personID, sessionID, year int) string {
	return fmt.Sprintf("%d:%d|%d", personID, sessionID, year)
}

// loadExistingRecords loads existing camper_transportation records for a year
func (s *CamperTransportationSync) loadExistingRecords(ctx context.Context, year int) (map[string]string, error) {
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

		records, err := s.App.FindRecordsByFilter("camper_transportation", filter, "", perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying camper_transportation page %d: %w", page, err)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")
			sessionID := record.GetInt("session_id")
			key := makeTransportationKey(personID, sessionID, year)
			result[key] = record.Id
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// upsertRecords creates or updates camper transportation records
func (s *CamperTransportationSync) upsertRecords(
	ctx context.Context,
	records map[string]*camperTransportationRecord,
	existingRecords map[string]string,
	year int,
) (created, updated, errors int) {
	col, err := s.App.FindCollectionByNameOrId("camper_transportation")
	if err != nil {
		slog.Error("Error finding camper_transportation collection", "error", err)
		return 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, errors
		default:
		}

		key := makeTransportationKey(rec.personID, rec.sessionID, year)
		existingID, exists := existingRecords[key]

		var record *core.Record
		if exists {
			record, err = s.App.FindRecordById("camper_transportation", existingID)
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
		record.Set("session_id", rec.sessionID)
		record.Set("year", rec.year)
		record.Set("to_camp_method", rec.toCampMethod)
		record.Set("from_camp_method", rec.fromCampMethod)
		record.Set("dropoff_name", rec.dropoffName)
		record.Set("dropoff_phone", rec.dropoffPhone)
		record.Set("dropoff_relationship", rec.dropoffRelation)
		record.Set("pickup_name", rec.pickupName)
		record.Set("pickup_phone", rec.pickupPhone)
		record.Set("pickup_relationship", rec.pickupRelation)
		record.Set("alt_pickup_1_name", rec.altPickup1Name)
		record.Set("alt_pickup_1_phone", rec.altPickup1Phone)
		record.Set("alt_pickup_1_relationship", rec.altPickup1Rel)
		record.Set("alt_pickup_2_name", rec.altPickup2Name)
		record.Set("alt_pickup_2_phone", rec.altPickup2Phone)
		record.Set("used_legacy_fields", rec.usedLegacyFields)

		if err := s.App.Save(record); err != nil {
			slog.Error("Error saving camper_transportation record",
				"person_id", rec.personID,
				"session_id", rec.sessionID,
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
func (s *CamperTransportationSync) deleteOrphans(
	ctx context.Context,
	records map[string]*camperTransportationRecord,
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
			record, err := s.App.FindRecordById("camper_transportation", recordID)
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
func (s *CamperTransportationSync) forceWALCheckpoint() error {
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
