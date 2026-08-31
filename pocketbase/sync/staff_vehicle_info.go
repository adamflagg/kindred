package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameStaffVehicleInfo is the canonical name for this sync service
const serviceNameStaffVehicleInfo = "staff_vehicle_info"

// Column name constants for staff_vehicle_info table
const (
	colDrivingToCamp  = "driving_to_camp"
	colCanBringOthers = "can_bring_others"
)

// StaffVehicleInfoSync extracts SVI-* custom fields for staff vehicle information.
// This service reads from person_custom_values and populates the staff_vehicle_info table.
//
// Unique key: (person_id, year) - one record per staff member per year
// Links to: staff
//
// Field mapping: 10 SVI-* prefixed fields covering driving plans, vehicle details
// and transport logistics.
type StaffVehicleInfoSync struct {
	App            core.App
	Year           int
	DryRun         bool
	Debug          bool
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

// GetStats returns the current stats
func (s *StaffVehicleInfoSync) GetStats() Stats {
	return s.Stats
}

// SetDebug enables or disables debug logging
func (s *StaffVehicleInfoSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2334) so a
// unified sync run with dry_run=true reaches the DryRun field that this service's
// Sync() already checks before it writes.
func (s *StaffVehicleInfoSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// SetYear sets the year for this sync service
func (s *StaffVehicleInfoSync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *StaffVehicleInfoSync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
}

// staffVehicleInfoRecord holds the extracted vehicle info for a staff member
type staffVehicleInfoRecord struct {
	personID int
	year     int
	staffID  string // PocketBase ID of staff record

	drivingToCamp    bool
	howGettingToCamp string
	canBringOthers   string
	driverName       string
	whichFriend      string
	vehicleMake      string
	vehicleModel     string
	licensePlate     string
	rideFrom         string
	transportNotes   string
}

// Sync executes the staff vehicle info extraction
func (s *StaffVehicleInfoSync) Sync(ctx context.Context) error {
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

	// Layer 1 of the kindred#2258 guard: compare the mapper against what
	// CampMinder published THIS RUN, so an upstream rename surfaces in the log
	// rather than as an empty column found by audit years later.
	defNames := make([]string, 0, len(fieldNameMap))
	for _, name := range fieldNameMap {
		defNames = append(defNames, name)
	}
	unrouted, unmapped := sviRoutingReport(defNames)
	slog.Info("SVI field routing",
		"admitted", len(fieldNameMap),
		"routable", len(fieldNameMap)-len(unmapped),
	)
	for _, column := range unrouted {
		slog.Warn("SVI column is reachable from no CampMinder field -- renamed upstream?",
			"column", column)
	}
	// Once per field NAME per run, never per value: per-value would emit
	// ~1,700 lines per full backfill for fields working as intended.
	for _, name := range unmapped {
		slog.Warn("SVI field is admitted but routes to no column", "field", name)
	}

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

	// The extraction finished without error, so len(records) is now a fact about
	// the SOURCE rather than about whether this run worked. Gate the sweep on it:
	// a year in which nobody has vehicle info yet is a legitimately empty
	// upstream, not a collapse, and refusing there wedged the table -- a refused
	// sweep never clears the rows, so `existing` stayed high and every later run
	// refused again. This mirrors camper_dietary.go / camper_transportation.go /
	// quest_registrations.go / household_demographics.go (kindred#2283,
	// kindred#2301): deleteOrphans reads this instead of running unconditionally.
	s.SyncSuccessful = len(records) > 0

	if s.DryRun {
		slog.Info("Dry run mode - extracted but not writing",
			"records", len(records),
		)
		s.Stats.Created = len(records)
		return nil
	}

	// Step 4: Load existing records
	existingRecords, err := s.loadExistingRecords(ctx, year)
	if err != nil {
		return fmt.Errorf("loading existing records: %w", err)
	}
	slog.Info("Loaded existing records", "count", len(existingRecords))

	// Step 5: Upsert records
	created, updated, upsertSkipped, upsertErrors := s.upsertRecords(ctx, records, existingRecords, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
	// Stats.Skipped now carries TWO record-level meanings (kindred#2384): the
	// staff-row gate drop counted above in loadPersonCustomValues (kindred#2277)
	// and, added here, a record that needed no write. Both count RECORDS, so
	// the unit stays consistent -- but += (not =) preserves the earlier count.
	s.Stats.Skipped += upsertSkipped
	s.Stats.Errors = upsertErrors

	// Step 6: Delete orphans
	deleted, err := s.deleteOrphans(ctx, records, existingRecords, year)
	s.Stats.Deleted = deleted

	// WAL checkpoint BEFORE the error return below. upsertRecords has already
	// written by this point, and both error paths return with those writes still
	// in the WAL. That now includes the refusal path: widening the guard to catch
	// a PARTIAL collapse (kindred#2279) means it can refuse on a non-empty
	// computed set, which is exactly the case where upsertRecords did write. The
	// checkpoint therefore has to precede the error return, not follow it.
	if s.Stats.Created > 0 || s.Stats.Updated > 0 || s.Stats.Deleted > 0 {
		if cpErr := s.forceWALCheckpoint(); cpErr != nil {
			slog.Warn("WAL checkpoint failed", "error", cpErr)
		}
	}

	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("orphan sweep interrupted: %w", err)
		}
		return fmt.Errorf("orphan sweep refused: %w", err)
	}

	slog.Info("Staff vehicle info extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"skipped", s.Stats.Skipped,
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
		name := normalizeFieldName(record.GetString("name"))
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

		records, err := s.App.FindRecordsByFilter("staff", filter, sortByID, perPage, (page-1)*perPage)
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

	// Cache for person PB ID -> CM ID lookups
	personCache := make(map[string]int)

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
			if !ok {
				continue
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
	// gatedPeople tracks the staff-row gate drops by PERSON, not by value
	// (kindred#2277). A person who substantially completed the SVI form
	// (production: 2-10 fields, mean 4.8 -- the SVI form has only 10 fields
	// total, far smaller than the App-* onboarding form) would otherwise
	// inflate a single dropped record into up to ten Stats.Skipped increments.
	gatedPeople := make(map[int]bool)

	for _, entry := range entries {
		staffID, hasStaff := personToStaff[entry.personID]
		if !hasStaff {
			// Structurally correct -- `staff` is a required relation, so a row
			// cannot be written without one -- but it must not be silent
			// (kindred#2273, kindred#2277). Once aggregated below, this joins
			// a DIFFERENT meaning of Stats.Skipped from upsertRecords further
			// down (kindred#2384): this counts a person dropped before a
			// record was ever built, upsertRecords counts a built record that
			// needed no write. Both are record-level counts, so the unit
			// stays consistent.
			gatedPeople[entry.personID] = true
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

		if MapSVIFieldToColumnImpl(entry.fieldName) == "" {
			// A VALUE discard, not a record one -- rec was already created
			// above, so this person's row IS written. Counting it into
			// Stats.Skipped would mix units with the staff-gate drop above,
			// which discards whole records (kindred#2277 review).
			s.Stats.SkippedValues++
			continue
		}
		mapSVIFieldToRecord(rec, entry.fieldName, entry.value)
	}

	if len(gatedPeople) > 0 {
		s.Stats.Skipped += len(gatedPeople)
		// One aggregated warning per run, not one per gated person -- a bad
		// backfill can gate out hundreds of people in one run, and this must
		// not become hundreds of log lines (kindred#2277).
		slog.Warn("Staff vehicle info: discarding SVI-* answers for people with no staff row",
			"year", year,
			"people", len(gatedPeople),
		)
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
	case colDrivingToCamp:
		rec.drivingToCamp = parseSVIBoolImpl(value)
	case "how_getting_to_camp":
		if rec.howGettingToCamp == "" {
			rec.howGettingToCamp = value
		}
	case colCanBringOthers:
		// Raw answer, first-non-empty-wins like every other text column.
		// NOT parseSVIBoolImpl -- see kindred#2262.
		if rec.canBringOthers == "" {
			rec.canBringOthers = value
		}
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
	case "ride_from":
		if rec.rideFrom == "" {
			rec.rideFrom = value
		}
	case "transport_notes":
		if rec.transportNotes == "" {
			rec.transportNotes = value
		}
	}
}

// sviTargetColumns lists every column MapSVIFieldToColumnImpl can return. It
// is the guard's subject: each of these must be reachable from at least one
// field name CampMinder publishes.
var sviTargetColumns = []string{
	colDrivingToCamp,
	"how_getting_to_camp",
	colCanBringOthers,
	"driver_name",
	"which_friend",
	"vehicle_make",
	"vehicle_model",
	"license_plate",
	"ride_from",
	"transport_notes",
}

// sviRoutingReport compares the mapper against the field names CampMinder
// actually published.
//
// unroutedColumns: target columns no published name routes to. A non-empty
// result means a literal in MapSVIFieldToColumnImpl is misspelled or the field
// was renamed upstream -- this is the kindred#2258 failure, and it is the
// reason this function exists.
//
// unmappedFields: published SVI names that route nowhere. Expected to be
// non-empty -- two definitions are deliberately unrouted -- so this is for
// logging, not for failing.
//
// Both slices are sorted so callers and tests are deterministic.
func sviRoutingReport(defNames []string) (unroutedColumns, unmappedFields []string) {
	reached := make(map[string]bool, len(sviTargetColumns))

	for _, name := range defNames {
		column := MapSVIFieldToColumnImpl(normalizeFieldName(name))
		if column == "" {
			if isStaffVehicleInfoField(normalizeFieldName(name)) {
				unmappedFields = append(unmappedFields, name)
			}
			continue
		}
		reached[column] = true
	}

	for _, column := range sviTargetColumns {
		if !reached[column] {
			unroutedColumns = append(unroutedColumns, column)
		}
	}

	slices.Sort(unroutedColumns)
	slices.Sort(unmappedFields)
	return unroutedColumns, unmappedFields
}

// MapSVIFieldToColumnImpl maps CampMinder field names to database column names
func MapSVIFieldToColumnImpl(fieldName string) string {
	switch fieldName {
	case "SVI-are you driving to camp":
		return colDrivingToCamp
	case "SVI-how are you get to camp":
		return "how_getting_to_camp"
	case "SVI - bring others":
		return colCanBringOthers
	case "SVI- Who is driving you to camp":
		return "driver_name"
	case "SVI-which friend":
		return "which_friend"
	case "SVI-make of vehicle":
		return "vehicle_make"
	case "SVI-model vehicle":
		return "vehicle_model"
	// British spelling: this is how CampMinder publishes it. The American
	// spelling matched nothing for the table's entire history (kindred#2258).
	case "SVI-licence plate number":
		return "license_plate"
	case "SVI- Where do you need a ride from":
		return "ride_from"
	case "SVI - other":
		return "transport_notes"
	}
	return ""
}

// parseSVIBoolImpl parses Yes/No values to boolean
func parseSVIBoolImpl(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	switch lower {
	case boolYes, boolTrue, "1", "y":
		return true
	}
	return false
}

// makeStaffVehicleKey creates the composite key for upsert logic
func makeStaffVehicleKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}

// staffVehicleInfoCompareFields lists the fields to compare for idempotency
// checks (kindred#2384). Excludes the unique key fields (person_id, year)
// since loadExistingRecords already matched on them, and PocketBase-managed
// fields. Includes `staff` even though it is not part of the key -- unlike
// person_id/year, it can change independently of the key if the
// person-to-staff mapping is rebuilt.
var staffVehicleInfoCompareFields = []string{
	"staff",
	colDrivingToCamp, "how_getting_to_camp", colCanBringOthers,
	"driver_name", "which_friend", "vehicle_make", "vehicle_model",
	"license_plate", "ride_from", "transport_notes",
}

// recordNeedsUpdate checks if any compared field differs between existing
// record and new data. Uses compareFields (inclusion list): only the listed
// fields are checked for changes. Delegates to the shared
// compareRecordNeedsUpdate in base_sync.go.
func (s *StaffVehicleInfoSync) recordNeedsUpdate(
	existing *core.Record, newData map[string]any, compareFields []string,
) bool {
	return compareRecordNeedsUpdate(existing, newData, compareFields)
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

		records, err := s.App.FindRecordsByFilter("staff_vehicle_info", filter, sortByID, perPage, (page-1)*perPage)
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
) (created, updated, skipped, errCount int) {
	col, err := s.App.FindCollectionByNameOrId("staff_vehicle_info")
	if err != nil {
		slog.Error("Error finding staff_vehicle_info collection", "error", err)
		return 0, 0, 0, len(records)
	}

	for _, rec := range records {
		select {
		case <-ctx.Done():
			return created, updated, skipped, errCount
		default:
		}

		key := makeStaffVehicleKey(rec.personID, year)
		existingID, exists := existingRecords[key]

		data := map[string]any{
			"staff":               rec.staffID,
			"person_id":           rec.personID,
			"year":                rec.year,
			colDrivingToCamp:      rec.drivingToCamp,
			"how_getting_to_camp": rec.howGettingToCamp,
			colCanBringOthers:     rec.canBringOthers,
			"driver_name":         rec.driverName,
			"which_friend":        rec.whichFriend,
			"vehicle_make":        rec.vehicleMake,
			"vehicle_model":       rec.vehicleModel,
			"license_plate":       rec.licensePlate,
			"ride_from":           rec.rideFrom,
			"transport_notes":     rec.transportNotes,
		}

		var record *core.Record
		if exists {
			record, err = s.App.FindRecordById("staff_vehicle_info", existingID)
			if err != nil {
				slog.Error("Error finding existing record", "id", existingID, "error", err)
				errCount++
				continue
			}

			// Check if update is actually needed (kindred#2384). An unchanged
			// record counts as a skip, not an update. Stats.Skipped here can
			// also carry a SEPARATE meaning from loadPersonCustomValues above
			// (a person dropped at the staff-row gate, kindred#2277) -- both
			// are record-level counts, so the unit is still consistent, but a
			// reader of the final number cannot tell which happened without
			// this comment.
			if !s.recordNeedsUpdate(record, data, staffVehicleInfoCompareFields) {
				s.DebugLog("Skipping unchanged staff_vehicle_info record",
					"person_id", rec.personID, "year", year)
				skipped++
				continue
			}
		} else {
			record = core.NewRecord(col)
		}

		for field, value := range data {
			record.Set(field, value)
		}

		if err := s.App.Save(record); err != nil {
			slog.Error("Error saving staff_vehicle_info record",
				"person_id", rec.personID,
				"year", rec.year,
				"error", err,
			)
			errCount++
			continue
		}

		if exists {
			updated++
		} else {
			created++
		}
	}

	return created, updated, skipped, errCount
}

// deleteOrphans removes records that exist in DB but not in computed set.
//
// Refuses when the computed set is too small to be believed against the rows on
// disk: that combination is always a broken input, and sweeping on it deletes
// the year and reports success (kindred#2273). The rule itself lives in
// OrphanSweepGuard -- this was one of two hand-written copies, and it now shares
// the one implementation, which also widened it from "empty" to "suspiciously
// small" (kindred#2279 Gap 1). A staff sync that times out partway leaves a
// SHORT personToStaff mapping far more often than an empty one.
//
// TWO upstream faults produce it, and the hint names both because they surface
// in different places: a collapsed personToStaff mapping (values fail the staff
// gate), or a collapsed fieldNameMap after an upstream rename of the SVI-*
// namespace (values route nowhere). The second is the kindred#2258 class and
// shows up in the "SVI field routing" warnings Layer 1 logs earlier in the same
// run -- naming only the staff table sends an operator to the wrong place.
func (s *StaffVehicleInfoSync) deleteOrphans(
	ctx context.Context,
	records map[string]*staffVehicleInfoRecord,
	existingRecords map[string]string,
	year int,
) (int, error) {
	// An orphan sweep that runs after a PARTIAL fetch deletes rows the feed
	// simply did not return. Sync() sets SyncSuccessful from the size of this
	// run's extraction, so a year nobody has vehicle info for yet skips the
	// sweep and succeeds rather than refusing forever (kindred#2301). The guard
	// below still owns the case that matters: a source that came back SHORT.
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion: the source returned no rows for this year",
			"entity", "staff_vehicle_info", "year", year)
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "staff_vehicle_info",
		Year:     year,
		Computed: len(records),
		Hint:     "check the staff table for that year, and the SVI field routing warnings above for an upstream rename",
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
			record, err := s.App.FindRecordById("staff_vehicle_info", recordID)
			if err != nil {
				slog.Warn("Error finding orphan record", "id", recordID, "error", err)
				continue
			}

			if err := s.App.Delete(record); err != nil {
				slog.Error("Error deleting orphan record", "id", recordID, "error", err)
				s.Stats.Errors++
				continue
			}
			deleted++
		}
	}

	return deleted, nil
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
