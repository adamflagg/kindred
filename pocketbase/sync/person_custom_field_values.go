//nolint:dupl // Similar pattern to household_custom_field_values.go, intentional for person variant
package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/camp/kindred/pocketbase/ratelimit"
)

// Service name constant - uses new table name
const serviceNamePersonCustomValues = "person_custom_values"

// PersonCustomFieldValuesSync handles syncing custom field values for persons from CampMinder.
// The unrestricted instance (Session=DefaultSession) is ON-DEMAND -- weekly cron + manual runs
// only -- because a year-wide sweep is 1 API call per person. A second, scoped instance of this
// same type IS part of the daily cron (kindred#2482): scoped to family-camp attendees, it stays
// cheap enough to run daily. See orchestrator.go's getDailySyncJobs and the
// "person_custom_values_family_camp" registration.
type PersonCustomFieldValuesSync struct {
	BaseSyncService
	Session     string                 // Session filter: "all", "1", "2", "2a", "3", "4", etc.
	rateLimiter *ratelimit.RateLimiter // Rate limiter for API calls

	// Scope selects the cohort. ScopeFamilyCamp uses the bounded daily family-camp cohort
	// (any attendee status, via SessionResolver.GetFamilyCampPersonIDsAnyStatus) instead of
	// Session or the year-wide fallback; ScopeAll leaves the existing behavior untouched.
	// Set only on the dedicated scoped instance registered for the daily cron (kindred#2482).
	Scope Scope
}

// NewPersonCustomFieldValuesSync creates a new person custom field values sync service
func NewPersonCustomFieldValuesSync(app core.App, client *campminder.Client) *PersonCustomFieldValuesSync {
	return &PersonCustomFieldValuesSync{
		BaseSyncService: NewBaseSyncService(app, client),
		Session:         DefaultSession, // Default to all sessions
		rateLimiter: ratelimit.NewRateLimiter(&ratelimit.Config{
			APIDelay:          300 * time.Millisecond, // ~3 req/sec
			BackoffMultiplier: 2.0,
			MaxDelay:          120 * time.Second, // CampMinder rate limits are aggressive
			MaxAttempts:       10,
		}),
	}
}

// Name returns the name of this sync service
func (s *PersonCustomFieldValuesSync) Name() string {
	return serviceNamePersonCustomValues
}

// SetScope implements scopedService.
func (s *PersonCustomFieldValuesSync) SetScope(scope Scope) { s.Scope = scope }

// logJobName returns the registered job name this instance is actually running as. Sync()
// uses this (not the fixed Name()) for LogSyncStart and its cohort-size log line, so an
// operator reading logs can tell the nightly bounded pass apart from the weekly unrestricted
// sweep -- before this both logged identically even though they cover different cohorts on
// different schedules (kindred#2491 Face D).
func (s *PersonCustomFieldValuesSync) logJobName() string {
	return scopedID(serviceNamePersonCustomValues, s.Scope)
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2351). Declared
// explicitly rather than inherited by embedding BaseSyncService -- see that field's doc
// comment on BaseSyncService for why a promoted setter is not safe. Setting it also gates
// processPersonCustomFieldValue's own two App.Save call sites (a fast-path upsert that does
// not go through BaseSyncService.ProcessSimpleRecord).
func (s *PersonCustomFieldValuesSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// SetSession sets the session filter for this sync (e.g., "1", "2", "2a", "all")
func (s *PersonCustomFieldValuesSync) SetSession(session string) {
	s.Session = session
}

// Sync performs the person custom field values sync
func (s *PersonCustomFieldValuesSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	jobName := s.logJobName()

	// Start the sync process
	s.LogSyncStart(jobName)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Get list of person IDs to sync based on session filter
	personIDs, err := s.getPersonIDsToSync(year)
	if err != nil {
		return fmt.Errorf("getting person IDs to sync: %w", err)
	}

	// Deduplicate person IDs (in case session resolver returns duplicates)
	seenPersonIDs := make(map[int]bool)
	uniquePersonIDs := make([]int, 0, len(personIDs))
	for _, id := range personIDs {
		if !seenPersonIDs[id] {
			seenPersonIDs[id] = true
			uniquePersonIDs = append(uniquePersonIDs, id)
		}
	}
	if len(uniquePersonIDs) < len(personIDs) {
		slog.Warn("Removed duplicate person IDs",
			"original", len(personIDs),
			"deduplicated", len(uniquePersonIDs))
	}
	personIDs = uniquePersonIDs

	if len(personIDs) == 0 {
		slog.Info("No persons to sync custom field values for",
			"job", jobName,
			"session", s.Session,
			"year", year)
		s.SyncSuccessful = true
		s.LogSyncComplete(jobName)
		return nil
	}

	slog.Info("Syncing custom field values for persons",
		"job", jobName,
		"count", len(personIDs),
		"session", s.Session,
		"year", year)

	// Pre-load person CM ID -> PB ID mapping for the year
	personMapping, err := s.preloadPersonMapping(year)
	if err != nil {
		return fmt.Errorf("preloading person mapping: %w", err)
	}

	// Pre-load field definition CM ID -> PB ID mapping
	fieldDefMapping, err := s.preloadFieldDefMapping()
	if err != nil {
		return fmt.Errorf("preloading field definition mapping: %w", err)
	}

	// Pre-load existing records for this year
	// KeyBuilder returns identity only (personPBId:fieldDefPBId)
	// PreloadCompositeRecords appends |year to create yearScopedKey
	filter := fmt.Sprintf("year = %d", year)
	preloadFn := func(record *core.Record) (string, bool) {
		personPBId := record.GetString("person")
		fieldDefPBId := record.GetString("field_definition")

		if personPBId != "" && fieldDefPBId != "" {
			// Return identity only - PreloadCompositeRecords adds |year
			return fmt.Sprintf("%s:%s", personPBId, fieldDefPBId), true
		}
		return "", false
	}
	existingRecords, err := s.PreloadCompositeRecords(
		"person_custom_values", filter, preloadFn)
	if err != nil {
		return fmt.Errorf("preloading existing records: %w", err)
	}

	s.SyncSuccessful = true

	// Only persons whose values this run actually fetched may be judged by the
	// orphan sweep. A ?session= filter narrows the run to one session's persons
	// while the sweep's filter is the whole year, so without this set a
	// session-scoped run would delete every other session's values as orphans.
	sweptOwners := make(map[string]bool, len(personIDs))

	// Process each person
	for i, personCMID := range personIDs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Log progress every 50 persons
		if i > 0 && i%50 == 0 {
			slog.Info("Person custom field values sync progress",
				"processed", i,
				"total", len(personIDs),
				"percent", fmt.Sprintf("%.1f%%", float64(i)/float64(len(personIDs))*100))
		}

		// Get PB ID for this person
		personPBId, found := personMapping[personCMID]
		if !found {
			slog.Warn("Person not found in PocketBase, skipping custom field values",
				"person_cm_id", personCMID)
			continue
		}

		// Fetch custom field values for this person (paginated)
		err := s.syncPersonCustomFieldValues(
			ctx, personCMID, personPBId, year, fieldDefMapping, existingRecords)
		if err != nil {
			slog.Error("Error syncing custom field values for person",
				"person_cm_id", personCMID,
				"error", err)
			s.Stats.Errors++
			// A person whose fetch failed was not fully seen; leaving them out of
			// sweptOwners keeps the sweep from reading a partial fetch as deletions.
			continue
		}

		sweptOwners[personPBId] = true
	}

	// Delete orphans (values no longer present in API response)
	if err := s.deleteOrphans(year, sweptOwners); err != nil {
		slog.Error("Error deleting orphan custom field values", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete(jobName)
	return nil
}

// preloadPersonMapping loads CM ID -> PB ID mapping for persons in the given year
func (s *PersonCustomFieldValuesSync) preloadPersonMapping(year int) (map[int]string, error) {
	filter := fmt.Sprintf("year = %d", year)
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// This lookup is year-scoped and the largest year on record holds 3,383
	// persons, so the old cap had headroom -- but headroom is not a guarantee,
	// and the failure mode is a narrowed sweep rather than an error.
	persons, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding persons: %w", err)
	}

	mapping := make(map[int]string, len(persons))
	for _, person := range persons {
		if cmID, ok := person.Get("cm_id").(float64); ok && cmID > 0 {
			mapping[int(cmID)] = person.Id
		}
	}

	s.DebugLog("Preloaded person mapping", "count", len(mapping))

	return mapping, nil
}

// preloadFieldDefMapping loads CM ID -> PB ID mapping for custom field definitions
func (s *PersonCustomFieldValuesSync) preloadFieldDefMapping() (map[int]string, error) {
	// Field definitions are global (no year filter)
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// custom_field_defs is NOT year-scoped: all 1,270 rows load every time. That
	// is the one here with no year to bound it, so it is the one that would
	// creep up on the cap first.
	fieldDefs, err := s.App.FindRecordsByFilter("custom_field_defs", "", "", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding field definitions: %w", err)
	}

	mapping := make(map[int]string, len(fieldDefs))
	for _, fieldDef := range fieldDefs {
		if cmID, ok := fieldDef.Get("cm_id").(float64); ok && cmID > 0 {
			mapping[int(cmID)] = fieldDef.Id
		}
	}

	s.DebugLog("Preloaded field definition mapping", "count", len(mapping))

	return mapping, nil
}

// getPersonIDsToSync returns the list of person CampMinder IDs to sync based on session filter
func (s *PersonCustomFieldValuesSync) getPersonIDsToSync(year int) ([]int, error) {
	// Bounded daily family-camp pass (kindred#2482): any attendee status, across every
	// family-camp weekend, resolved via attendees rather than Session so it can span
	// multiple weekend sessions in one run.
	if s.Scope == ScopeFamilyCamp {
		resolver := NewSessionResolver(s.App)
		personIDs, err := resolver.GetFamilyCampPersonIDsAnyStatus(year)
		if err != nil {
			return nil, err
		}

		s.DebugLog("Resolved family-camp bounded cohort to person IDs",
			"count", len(personIDs),
			"year", year)

		return personIDs, nil
	}

	// Use session resolver if session filter is specified
	if s.Session != "" && s.Session != DefaultSession {
		resolver := NewSessionResolver(s.App)
		personIDs, err := resolver.GetPersonIDsForSession(s.Session, year)
		if err != nil {
			return nil, err
		}

		s.DebugLog("Resolved session to person IDs",
			"session", s.Session,
			"count", len(personIDs),
			"year", year)

		return personIDs, nil
	}

	// No session filter - get all persons synced for this year
	filter := fmt.Sprintf("year = %d", year)
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// Feeds sweptOwners, which is what narrows the orphan sweep. A silent
	// truncation here would shrink the sweep's computed set as well, so the
	// two defects would compound rather than cancel.
	persons, err := s.App.FindRecordsByFilter("persons", filter, "", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding persons: %w", err)
	}

	personIDs := make([]int, 0, len(persons))
	for _, person := range persons {
		if cmID, ok := person.Get("cm_id").(float64); ok && cmID > 0 {
			personIDs = append(personIDs, int(cmID))
		}
	}

	s.DebugLog("Getting all persons for year",
		"count", len(personIDs),
		"year", year)

	return personIDs, nil
}

// syncPersonCustomFieldValues fetches and stores custom field values for a single person
func (s *PersonCustomFieldValuesSync) syncPersonCustomFieldValues(
	ctx context.Context,
	personCMID int,
	personPBId string,
	year int,
	fieldDefMapping map[int]string,
	existingRecords map[string]*core.Record,
) error {
	page := 1
	pageSize := LargePageSize

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Fetch page of custom field values with rate limiting and retry
		var values []map[string]any
		var hasMore bool

		err := s.rateLimiter.ExecuteWithRetry(ctx, func() error {
			var fetchErr error
			values, hasMore, fetchErr = s.Client.GetPersonCustomFieldValuesPage(personCMID, page, pageSize)
			return fetchErr
		})
		if err != nil {
			return fmt.Errorf("fetching custom field values page %d after retries: %w", page, err)
		}

		// Process each value
		for _, valueData := range values {
			if err := s.processPersonCustomFieldValue(
				valueData, personCMID, personPBId, year, fieldDefMapping, existingRecords); err != nil {
				return err
			}
		}

		if !hasMore || len(values) == 0 {
			break
		}
		page++
	}

	return nil
}

// processPersonCustomFieldValue handles one API-returned custom field value entry for a
// person: resolves the field definition, applies the same-run duplicate guard, and
// creates/updates/skips the row accordingly. Split out of syncPersonCustomFieldValues
// (which needs a live CampMinder HTTP round trip via s.Client) purely so the guard below
// can be exercised directly in tests.
func (s *PersonCustomFieldValuesSync) processPersonCustomFieldValue(
	valueData map[string]any,
	personCMID int,
	personPBId string,
	year int,
	fieldDefMapping map[int]string,
	existingRecords map[string]*core.Record,
) error {
	// Extract field ID from API response
	fieldCMIDFloat, ok := valueData["id"].(float64)
	if !ok || fieldCMIDFloat == 0 {
		slog.Warn("Invalid or missing field id in custom field value",
			"person_cm_id", personCMID)
		s.Stats.Rejected++
		return nil
	}
	fieldCMID := int(fieldCMIDFloat)

	// Look up field definition PB ID
	fieldDefPBId, found := fieldDefMapping[fieldCMID]
	if !found {
		// Field definition not synced, skip
		s.DebugLog("Field definition not found, skipping",
			"field_cm_id", fieldCMID,
			"person_cm_id", personCMID)
		return nil
	}

	// Transform to PB format (simplified: only value and year)
	pbData := s.transformPersonCustomFieldValueToPB(valueData, personPBId, fieldDefPBId, year)

	// Build composite key: identity only (no year)
	// yearScopedKey matches format from PreloadCompositeRecords
	compositeKey := fmt.Sprintf("%s:%s", personPBId, fieldDefPBId)
	yearScopedKey := fmt.Sprintf("%s|%d", compositeKey, year)

	// Duplicate-in-run guard (kindred#2270). persons/{id}/custom-fields is documented as
	// one entry per field definition, and CampMinder packs multi-selects into a single
	// delimited value string rather than repeating the field id -- so a second entry for
	// a key this run has already tracked is not today's shape. Before this guard, that
	// second entry silently landed on the "existing" branch below (populated either from
	// the DB preload or from this same run's own `existingRecords[yearScopedKey] = record`
	// a few lines down) and collapsed onto the first with no diagnostic: matching
	// lastUpdated counted it as Skipped, a changed value counted it as Updated, and only an
	// App.Save failure counted it as Errors. This does NOT change the storage grain --
	// still exactly one row per (person, field_definition, year) -- it only makes that
	// existing collapse loud: count it as Rejected (upstream data quality, not a local
	// fault) and log it, so a future API shape change is attributable instead of invisible.
	if s.IsKeyProcessed(compositeKey, year) {
		valueStr, _ := pbData["value"].(string)
		slog.Warn("Duplicate custom field value entry in this sync run, discarding",
			"person_cm_id", personCMID,
			"field_cm_id", fieldCMID,
			"field_definition_pb_id", fieldDefPBId,
			"year", year,
			"value_length", len(valueStr))
		s.Stats.Rejected++
		return nil
	}

	// Track as processed using yearScopedKey format
	// Use TrackProcessedCompositeKey to avoid double year suffix:
	// TrackProcessedKey(yearScopedKey, 0) would create "key|year|0"
	// but deleteOrphans looks for "key|year"
	s.TrackProcessedCompositeKey(compositeKey, year)

	// Check for existing record using yearScopedKey
	if existing, found := existingRecords[yearScopedKey]; found {
		// Fast path: if lastUpdated unchanged, skip entirely
		existingLastUpdated := existing.GetString("last_updated")
		newLastUpdated, hasNewLastUpdated := pbData["last_updated"].(string)

		if existingLastUpdated != "" && hasNewLastUpdated && existingLastUpdated == newLastUpdated {
			// lastUpdated matches - no changes, skip update
			s.Stats.Skipped++
			return nil
		}

		// Value or lastUpdated changed - update record.
		//
		// oldValue is read BEFORE the Set loop below overwrites it: the cabin
		// change capture (kindred#2482) needs old and new simultaneously, and
		// this is the only point in the pipeline where both are in scope.
		newValue, _ := pbData["value"].(string)
		oldValue := existing.GetString("value")
		if oldValue != newValue || existingLastUpdated != newLastUpdated {
			for key, val := range pbData {
				existing.Set(key, val)
			}
			if s.DryRun {
				s.Stats.Updated++
				return nil
			}
			if err := s.App.Save(existing); err != nil {
				valueStr, _ := pbData["value"].(string)
				slog.Error("Error updating custom field value",
					"error", err,
					"person_cm_id", personCMID,
					"field_cm_id", fieldCMID,
					"value_length", len(valueStr))
				s.Stats.Errors++
			} else {
				s.Stats.Updated++
				// Capture the change, but only a VALUE change -- the branch
				// condition above also fires on a bare last_updated bump, which
				// is not a change to where anyone slept. No-op for any field
				// outside the retention scope (lodging_value_history.go).
				if oldValue != newValue {
					logLodgingValueChange(s.App, &lodgingValueObservation{
						Year:            year,
						FieldCMID:       fieldCMID,
						PersonCMID:      personCMID,
						OldValue:        oldValue,
						NewValue:        newValue,
						SourceChangedAt: newLastUpdated,
					})
				}
			}
		} else {
			s.Stats.Skipped++
		}
	} else {
		// Create new record
		collection, err := s.App.FindCollectionByNameOrId("person_custom_values")
		if err != nil {
			return fmt.Errorf("finding collection: %w", err)
		}

		record := core.NewRecord(collection)
		for key, val := range pbData {
			record.Set(key, val)
		}

		if s.DryRun {
			s.Stats.Created++
			return nil
		}

		if err := s.App.Save(record); err != nil {
			valueStr, _ := pbData["value"].(string)
			slog.Error("Error creating custom field value",
				"error", err,
				"person_cm_id", personCMID,
				"field_cm_id", fieldCMID,
				"value_length", len(valueStr))
			s.Stats.Errors++
		} else {
			s.Stats.Created++
			// Add to existingRecords so a later record within this same run for the
			// same key hits the "existing" branch (which the guard above now also
			// short-circuits before it can be reached by a true duplicate).
			existingRecords[yearScopedKey] = record
			// The first observed cabin is a fact worth keeping, so the create
			// branch writes history too, as is_genesis (kindred#2482).
			newValue, _ := pbData["value"].(string)
			newLastUpdated, _ := pbData["last_updated"].(string)
			logLodgingValueChange(s.App, &lodgingValueObservation{
				Year:            year,
				FieldCMID:       fieldCMID,
				PersonCMID:      personCMID,
				NewValue:        newValue,
				SourceChangedAt: newLastUpdated,
				IsGenesis:       true,
			})
		}
	}

	return nil
}

// deleteOrphans removes custom field values that were not seen in this sync.
//
// This used to be a hand-rolled loop over a single FindRecordsByFilter capped at
// 10,000 rows with no surrounding pagination (kindred#2266). 10,000 is a hard
// cap, not a page size: production years hold 128,606-184,458 rows, so the sweep
// inspected 5.4-7.8% of the year and a value deleted in CampMinder simply
// survived, feeding every derived table that reads this one. Routing through the
// shared guarded sweep replaces the cap with keyset pagination and picks up the
// collapse guard, so there is one implementation instead of a local copy.
//
// sweptOwners is the set of person PB IDs whose values were successfully fetched
// during THIS run, and it is what makes the fix safe rather than catastrophic.
// The sweep's filter is the whole year, but the computed set is only ever as
// wide as the run: this service takes a ?session= filter (api.go), and a
// session resolves to the persons enrolled in it -- in the current season the
// largest single session covers about 11% of the people who hold custom values.
// Uncapping the read without narrowing the judgement would have let one
// session-scoped run delete the other ~89% of the year as orphans. A row is a
// candidate only if this run actually fetched that person's values; anything else
// is invisible to the sweep, exactly as it should be.
func (s *PersonCustomFieldValuesSync) deleteOrphans(year int, sweptOwners map[string]bool) error {
	return s.DeleteOrphansGuarded(
		"person_custom_values",
		func(record *core.Record) (string, bool) {
			personPBId := record.GetString("person")
			if !sweptOwners[personPBId] {
				return "", false
			}

			// Matches TrackProcessedCompositeKey's "<identity>|<year>" format
			return fmt.Sprintf("%s:%s|%d",
				personPBId, record.GetString("field_definition"), record.GetInt("year")), true
		},
		"person custom field value",
		fmt.Sprintf("year = %d", year),
		OrphanSweepGuard{
			Entity:   "person_custom_values",
			Year:     year,
			Computed: len(s.ProcessedKeys),
			Hint: "check that the persons sync ran for that year, and that " +
				"custom_field_defs still holds these field definitions",
		},
	)
}

// cmIDSocializeWithBest is the CampMinder custom-field id for "Ret Parent-Socialize with
// best" -- the summer bunking dropdown kindred#2484 reads directly from person_custom_values
// instead of the manually uploaded bunk-requests CSV column ("RetParent-Socializewithbest").
// The free-text companion field (cm_id 85804, "...Explain") is a deliberately separate,
// out-of-scope decision per #2484 -- do not extend this constant to cover it.
const cmIDSocializeWithBest = 85803

// loadPersonCustomFieldValuesByCMID returns person PB id -> raw value for every
// person_custom_values row in the given year whose field_definition matches the
// custom_field_defs record carrying fieldCMID.
//
// custom_field_defs is the join target -- NOT person_tag_defs -- and getting that join
// wrong returns zero rows with no error, which is why the cm_id lookup is isolated here
// rather than inlined at each call site (kindred#2484).
//
// A field definition that has not synced yet (custom_field_defs has no matching row) is
// reported as an empty map, not an error: callers that fall back to another source (e.g.
// bunk_requests.go's CSV-to-custom-field swap) treat "nothing to switch to yet" as
// normal, not fatal.
func loadPersonCustomFieldValuesByCMID(app core.App, fieldCMID, year int) (map[string]string, error) {
	defs, err := app.FindRecordsByFilter(
		"custom_field_defs", fmt.Sprintf("cm_id = %d", fieldCMID), "", 1, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding custom field definition %d: %w", fieldCMID, err)
	}
	if len(defs) == 0 {
		return map[string]string{}, nil
	}

	records, err := app.FindRecordsByFilter(
		"person_custom_values",
		fmt.Sprintf("field_definition = '%s' && year = %d", defs[0].Id, year),
		"", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding person_custom_values for field %d: %w", fieldCMID, err)
	}

	values := make(map[string]string, len(records))
	for _, record := range records {
		if personPBId := record.GetString("person"); personPBId != "" {
			// PR #2523 review: CampMinder's custom-field export is a different path
			// than the CSV, whose column is already trimmed (getColumn's
			// strings.TrimSpace). Trimming here too keeps a whitespace-only
			// difference from reading as a real disagreement to callers that
			// compare this value against the CSV (bunk_requests.go).
			values[personPBId] = strings.TrimSpace(record.GetString("value"))
		}
	}
	return values, nil
}

// transformPersonCustomFieldValueToPB transforms CampMinder custom field value data to PocketBase format
// Schema: person, field_definition, value, year, last_updated (optional)
func (s *PersonCustomFieldValuesSync) transformPersonCustomFieldValueToPB(
	data map[string]any,
	personPBId string,
	fieldDefPBId string,
	year int,
) map[string]any {
	pbData := make(map[string]any)

	// Set relations
	pbData["person"] = personPBId
	pbData["field_definition"] = fieldDefPBId

	// Extract value (can be empty or nil)
	if value, ok := data["value"].(string); ok {
		pbData["value"] = value
	} else {
		pbData["value"] = ""
	}

	// Set year
	pbData["year"] = year

	// Capture lastUpdated for delta sync (if present and non-empty)
	if lastUpdated, ok := data["lastUpdated"].(string); ok && lastUpdated != "" {
		pbData["last_updated"] = lastUpdated
	}

	return pbData
}
