package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// serviceNameCamperTransportation is the canonical name for this sync service
const serviceNameCamperTransportation = "camper_transportation"

// CampMinder field name constants
const (
	cmFieldBusToCamp   = "Bus to Camp"
	cmFieldBusFromCamp = "Bus From Camp"
)

// Column name constants for camper_transportation table
const (
	colToCampMethod           = "to_camp_method"
	colFromCampMethod         = "from_camp_method"
	colDropoffName            = "dropoff_name"
	colDropoffPhone           = "dropoff_phone"
	colDropoffRelationship    = "dropoff_relationship"
	colPickupName             = "pickup_name"
	colPickupPhone            = "pickup_phone"
	colPickupRelationship     = "pickup_relationship"
	colAltPickup1Name         = "alt_pickup_1_name"
	colAltPickup1Phone        = "alt_pickup_1_phone"
	colAltPickup1Relationship = "alt_pickup_1_relationship"
	colAltPickup2Name         = "alt_pickup_2_name"
	colAltPickup2Phone        = "alt_pickup_2_phone"
)

// CamperTransportationSync extracts BUS-* custom fields for camper transportation.
// This service reads from person_custom_values and populates the camper_transportation table.
//
// Unique key: (person_id, session_id, year) - one record per camper per session
// Links to: attendees, via a relation field that is `required: true` and carries
// `cascadeDelete: true` (pb_migrations/1500000043_camper_transportation.js). That cascade is
// KEPT DELIBERATELY -- reviewed and re-affirmed under kindred#2311, whatever the original author
// weighed: transportation is enrolment-scoped, so a bus pickup contact is meaningless once
// CampMinder no longer lists the attendee for that session, and taking the row with the attendee
// is the behavior we want.
//
// kindred#2261/#2265 reached the opposite conclusion, and the remedy there was NOT a cascade
// flag flip: migration 1500000153 dropped the whole `attendee` column from quest_registrations
// and camper_dietary, because those tables are person x year and the stored link was one
// arbitrarily-chosen attendee row that could never answer the enrolment question. This table's
// link is sound -- idx_camper_transportation_unique is (person_id, session_id, year), so exactly
// one attendee row can match, and on the production snapshot EVERY row's stored attendee is for
// that row's own session, with zero exceptions (measured under kindred#2311 and re-measured at
// review; the count moves between snapshots, the zero does not). Do not carry #2261's remedy
// over here: dropping this column would remove a link that works.
//
// Dropping the cascade instead would preserve nothing. Two reasons, either one sufficient:
//   - `required: true` means PocketBase refuses to delete the referenced attendee at all when
//     the relation does not cascade (core.deleteRefRecords returns "part of a required
//     reference"), so that change alone turns a silent row deletion into a failing attendees
//     sweep rather than into a surviving row.
//   - This table runs its own orphan sweep (deleteOrphans, below), which removes a row whenever
//     its (person_id, session_id) has no attendeeMap hit in loadAttendeeMapping -- exactly the
//     condition that holds once CampMinder drops the attendee. The row dies on this sync's own
//     next run either way; the cascade only makes it happen one run sooner.
//
// The row is what is lost, not the content: this table is fully derived from
// person_custom_values, with no staff_touched column and no GUI write path, so an attendee that
// reappears upstream is recomputed with the same values. See kindred#2311 for the full analysis
// and the options considered.
//
// Field mapping handles both new BUS-* fields and legacy "Bus to/From Camp" fields.
// New fields take priority; legacy fields are used as fallback.
//
// Rows persist after a camper CANCELS: loadAttendeeMapping applies no status filter, so a
// cancelled camper's attendees row -- and therefore this table's row -- survives cancellation
// untouched. That is not the same claim as "never swept by deletion": deleteOrphans below does
// delete rows, just not merely for a status change. A future reader (e.g. a staff dashboard)
// must filter by active enrolment for the view's own year -- an `attendees` row with
// status_id = 2 for that person and year -- and must not filter across years. See "Reading
// Derived Informational Tables (Active-Enrolment Filtering)" in docs/architecture/sync-layer.md.
type CamperTransportationSync struct {
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

// SetDebug enables or disables debug logging
func (s *CamperTransportationSync) SetDebug(debug bool) {
	s.Debug = debug
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2334) so a
// unified sync run with dry_run=true reaches the DryRun field that this service's
// Sync() already checks before it writes.
func (s *CamperTransportationSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// SetYear sets the year for this sync service
func (s *CamperTransportationSync) SetYear(year int) {
	s.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (s *CamperTransportationSync) DebugLog(msg string, args ...any) {
	if s.Debug {
		slog.Info(msg, args...)
	}
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

	slog.Info("Starting camper transportation extraction",
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
	created, updated, errors := s.upsertRecords(ctx, records, existingRecords, year)
	s.Stats.Created = created
	s.Stats.Updated = updated
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

	slog.Info("Camper transportation extraction completed",
		"year", year,
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"skipped", s.Stats.Skipped,
		"skipped_values", s.Stats.SkippedValues,
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
		name := normalizeFieldName(record.GetString("name"))
		if isCamperTransportationField(name) {
			result[record.Id] = name
			s.DebugLog("Found transportation field definition", "name", name, "pb_id", record.Id)
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
	if name == cmFieldBusToCamp || name == cmFieldBusFromCamp {
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
// Note: The attendees table has "session" (PB relation ID) but no "session_id" (CM ID).
// We use ExpandRecords() to expand the session relation and get cm_id from the expanded record.
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

		records, err := s.App.FindRecordsByFilter("attendees", filter, sortByID, perPage, (page-1)*perPage)
		if err != nil {
			return nil, fmt.Errorf("querying attendees page %d: %w", page, err)
		}

		// Expand the session relation to get cm_id
		if errs := s.App.ExpandRecords(records, []string{"session"}, nil); len(errs) > 0 {
			s.DebugLog("Some session expansions failed", "errors", errs)
		}

		for _, record := range records {
			personID := record.GetInt("person_id")

			// Get session CM ID from expanded relation
			// Attendees has "session" (PB ID), not "session_id" (CM ID)
			sessionID := 0
			if expandedSession := record.ExpandedOne("session"); expandedSession != nil {
				sessionID = expandedSession.GetInt("cm_id")
			}

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
				continue // Not a transportation field
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
	// unmappedCounts tracks discard events: a "BUS-*" field accepted by
	// isCamperTransportationField (the prefix test) that has no case in
	// MapTransportationFieldToColumn. Keyed by field name so the eventual log
	// line names what was dropped, not just how much (kindred#2272). This
	// counts per (person, session) entry -- i.e. discard EVENTS, not source
	// values: a value on a person enrolled in two sessions fans out to two
	// entries here, same as it does for a routed field.
	unmappedCounts := make(map[string]int)

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

		// Map field to record. A field with no case in
		// MapTransportationFieldToColumn used to be dropped here with no
		// counter and no log line -- the sync reported success either way.
		if column := mapTransportFieldToRecord(rec, entry.fieldName, entry.value); column == "" {
			unmappedCounts[entry.fieldName]++
		}
	}

	if len(unmappedCounts) > 0 {
		known, unexpected := classifyUnmappedBusFields(unmappedCounts)
		total := 0
		for _, n := range unmappedCounts {
			total += n
		}
		s.Stats.SkippedValues += total

		// One aggregated warning per run, not one per discarded value -- a
		// historical backfill over 2017-2020 would otherwise log 1,628 lines.
		// unexpected is the bucket that actually needs a human: a name not in
		// retiredBusFieldReasons is either a new CampMinder "BUS-*" field with
		// no routing case yet, or a retired field this list has not been told
		// about.
		slog.Warn("Camper transportation: discarding values for unmapped BUS-* fields",
			"year", year,
			"discard_events", total,
			"known_retired_fields", known,
			"unrecognized_fields", unexpected,
		)
	}

	return result, nil
}

// mapTransportFieldToRecord maps a BUS-* field to the record. It returns the
// column the value was written to, or "" if MapTransportationFieldToColumn
// has no case for fieldName. mapTransportFieldToRecord is a package-level
// function with no receiver and no access to Stats, so the caller --
// loadPersonCustomValues' aggregation loop, which does have the receiver --
// is where an empty return gets counted and logged instead of silently
// dropped (kindred#2272).
func mapTransportFieldToRecord(rec *camperTransportationRecord, fieldName, value string) string {
	column := MapTransportationFieldToColumn(fieldName)
	if column == "" {
		return ""
	}

	switch column {
	case colToCampMethod:
		// New fields take priority
		if rec.toCampMethod == "" || !strings.HasPrefix(fieldName, "Bus ") {
			rec.toCampMethod = value
		}
		// Track if using legacy field
		if fieldName == cmFieldBusToCamp {
			rec.usedLegacyFields = true
		}
	case colFromCampMethod:
		if rec.fromCampMethod == "" || !strings.HasPrefix(fieldName, "Bus ") {
			rec.fromCampMethod = value
		}
		if fieldName == cmFieldBusFromCamp {
			rec.usedLegacyFields = true
		}
	case colDropoffName:
		if rec.dropoffName == "" {
			rec.dropoffName = value
		}
	case colDropoffPhone:
		if rec.dropoffPhone == "" {
			rec.dropoffPhone = value
		}
	case colDropoffRelationship:
		if rec.dropoffRelation == "" {
			rec.dropoffRelation = value
		}
	case colPickupName:
		if rec.pickupName == "" {
			rec.pickupName = value
		}
	case colPickupPhone:
		if rec.pickupPhone == "" {
			rec.pickupPhone = value
		}
	case colPickupRelationship:
		if rec.pickupRelation == "" {
			rec.pickupRelation = value
		}
	case colAltPickup1Name:
		if rec.altPickup1Name == "" {
			rec.altPickup1Name = value
		}
	case colAltPickup1Phone:
		if rec.altPickup1Phone == "" {
			rec.altPickup1Phone = value
		}
	case colAltPickup1Relationship:
		if rec.altPickup1Rel == "" {
			rec.altPickup1Rel = value
		}
	case colAltPickup2Name:
		if rec.altPickup2Name == "" {
			rec.altPickup2Name = value
		}
	case colAltPickup2Phone:
		if rec.altPickup2Phone == "" {
			rec.altPickup2Phone = value
		}
	}

	return column
}

// retiredBusFieldReasons documents the eleven CampMinder "BUS-*" custom field
// definitions that MapTransportationFieldToColumn deliberately has no case
// for. They belonged to an airport/flight-transfer form retired after the
// 2020 season: kindred#2272 measured 1,299 discarded source values (1,628
// discard events once fanned out per multi-session camper) across 188
// people, every one of them dated 2017-2020, and zero in every year since
// 2021 -- nothing has been lost since, and nothing is being lost today. A
// name landing in this map is a closed question, not an oversight; do not
// add a routing case for one without first checking whether CampMinder
// actually resumed collecting it.
//
// "BUS-phone number of person dropping off" is the odd one out: it has zero
// rows in person_custom_values in ANY year. It is the abandoned Integer-typed
// predecessor of the routed, String-typed
// "BUS-Phone number of person dropping off-correct" -- do not confuse the two
// when reading a diff; they differ only by a capital P and the "-correct"
// suffix.
var retiredBusFieldReasons = map[string]string{
	"BUS-From camp-traveling without grownup":  "retired flight-transfer form field, no values since 2020",
	"BUS-Departure airport-from camp":          "retired flight-transfer form field, no values since 2020",
	"BUS-Airport arriving to home from camp":   "retired flight-transfer form field, no values since 2020",
	"BUS-Flight # from camp":                   "retired flight-transfer form field, no values since 2020",
	"BUS-Departing time of return home flight": "retired flight-transfer form field, no values since 2020",
	"BUS-To camp-traveling without adult":      "retired flight-transfer form field, no values since 2020",
	"BUS-Departure airport to camp":            "retired flight-transfer form field, no values since 2020",
	"BUS-Arriving airport to camp":             "retired flight-transfer form field, no values since 2020",
	"BUS-Flight # to camp":                     "retired flight-transfer form field, no values since 2020",
	"BUS-Arrival time to camp":                 "retired flight-transfer form field, no values since 2020",
	"BUS-phone number of person dropping off":  "abandoned predecessor of the routed \"-correct\" field; zero rows ever",
}

// Separate from the above: alt_pickup_2_name, alt_pickup_2_phone and
// alt_pickup_1_relationship ARE routed (colAltPickup2Name, colAltPickup2Phone,
// colAltPickup1Relationship all have switch cases below) but have never held
// a value in any year 2017-2026. kindred#2272 decided KEEP AS-IS: dropping
// them needs a migration and is only worth it inside a wider
// camper_transportation cleanup, none of which is in flight. Do not touch
// these three columns on their own.

// classifyUnmappedBusFields splits per-field discard counts (fields
// MapTransportationFieldToColumn returned "" for) into the eleven names
// retiredBusFieldReasons already explains, and everything else. The second
// bucket is the one an operator needs to act on: it is either a brand-new
// CampMinder "BUS-*" field with no routing case yet, or a retired field this
// map has not been told about.
func classifyUnmappedBusFields(counts map[string]int) (known, unexpected map[string]int) {
	known = make(map[string]int, len(counts))
	unexpected = make(map[string]int, len(counts))
	for name, n := range counts {
		if _, ok := retiredBusFieldReasons[name]; ok {
			known[name] = n
		} else {
			unexpected[name] = n
		}
	}
	return known, unexpected
}

// MapTransportationFieldToColumn maps CampMinder field names to database
// column names. Eleven "BUS-*" definitions are deliberately absent from this
// switch -- see retiredBusFieldReasons immediately above for which ones and
// why. Adding a case here removes a field from that map's coverage too, so
// keep them in sync (TestRetiredBusFieldReasonsCoversExactlyTheElevenUnroutedNames
// checks this).
func MapTransportationFieldToColumn(fieldName string) string {
	switch fieldName {
	// To/From camp method
	case "BUS-to camp", cmFieldBusToCamp:
		return colToCampMethod
	case "BUS-home from camp", cmFieldBusFromCamp:
		return colFromCampMethod

	// Dropoff info
	case "BUS-who is dropping off":
		return colDropoffName
	case "BUS-Phone number of person dropping off-correct":
		return colDropoffPhone
	case "BUS-relation to camper drop off":
		return colDropoffRelationship

	// Pickup info
	case "BUS-person picking up":
		return colPickupName
	case "BUS-phone number of person picking up":
		return colPickupPhone
	case "BUS-relationship to camper pick up person":
		return colPickupRelationship

	// Alternate pickup 1
	case "BUS-alternate person 1 picking up":
		return colAltPickup1Name
	case "BUS-alternate 1 phone":
		return colAltPickup1Phone
	case "BUS-alternate person relation to camper":
		return colAltPickup1Relationship

	// Alternate pickup 2
	case "BUS-alternate person 2":
		return colAltPickup2Name
	case "BUS-alternate person 2 phone":
		return colAltPickup2Phone
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

		records, err := s.App.FindRecordsByFilter("camper_transportation", filter, sortByID, perPage, (page-1)*perPage)
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

// deleteOrphans removes records that exist in DB but not in computed set.
//
// Refuses when the computed set is too small to be believed against the rows
// on disk: that combination is always a broken input, and sweeping on it
// deletes the year and reports success (kindred#2257, kindred#2283). The rule
// lives in OrphanSweepGuard so there is one implementation, not an eighth copy.
func (s *CamperTransportationSync) deleteOrphans(
	ctx context.Context,
	records map[string]*camperTransportationRecord,
	existingRecords map[string]string,
	year int,
) (int, error) {
	// An empty source is not a collapse. Sync() sets SyncSuccessful from the
	// size of this run's extraction, so a year nobody answered skips the sweep
	// and succeeds rather than refusing forever (kindred#2283). The guard below
	// still owns the case that matters: a source that came back SHORT.
	if !s.SyncSuccessful {
		slog.Info("Skipping orphan deletion: the source returned no rows for this year",
			"entity", "camper_transportation", "year", year)
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "camper_transportation",
		Year:     year,
		Computed: len(records),
		Hint:     "check that the attendee mapping and the BUS-* field definitions still exist upstream",
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
			record, err := s.App.FindRecordById("camper_transportation", recordID)
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
