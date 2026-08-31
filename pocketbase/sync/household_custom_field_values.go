//nolint:dupl // Similar pattern to person_custom_field_values.go, intentional for household variant
package sync

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/camp/kindred/pocketbase/ratelimit"
)

// Service name constant - uses new table name
const serviceNameHouseholdCustomValues = "household_custom_values"

// HouseholdCustomFieldValuesSync handles syncing custom field values for households from
// CampMinder. The unrestricted instance (Session=DefaultSession) is ON-DEMAND -- weekly cron +
// manual runs only -- because a year-wide sweep is 1 API call per household. A second, scoped
// instance of this same type IS part of the daily cron (kindred#2482): scoped to family-camp
// attendees, it stays cheap enough to run daily. See orchestrator.go's getDailySyncJobs and the
// "household_custom_values_family_camp" registration.
type HouseholdCustomFieldValuesSync struct {
	BaseSyncService
	Session     string                 // Session filter: "all", "1", "2", "2a", "3", "4", etc.
	rateLimiter *ratelimit.RateLimiter // Rate limiter for API calls

	// Scope selects the cohort. ScopeFamilyCamp uses the bounded daily family-camp cohort
	// (any attendee status, via SessionResolver.GetFamilyCampHouseholdIDsAnyStatus) instead
	// of Session or the year-wide fallback; ScopeAll leaves the existing behavior untouched.
	// Set only on the dedicated scoped instance registered for the daily cron (kindred#2482).
	Scope Scope
}

// NewHouseholdCustomFieldValuesSync creates a new household custom field values sync service
func NewHouseholdCustomFieldValuesSync(app core.App, client *campminder.Client) *HouseholdCustomFieldValuesSync {
	return &HouseholdCustomFieldValuesSync{
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

// SetScope implements scopedService.
func (s *HouseholdCustomFieldValuesSync) SetScope(scope Scope) { s.Scope = scope }

// logJobName is the household twin of PersonCustomFieldValuesSync.logJobName -- see that
// method's comment for the full rationale (kindred#2491 Face D).
func (s *HouseholdCustomFieldValuesSync) logJobName() string {
	return scopedID(serviceNameHouseholdCustomValues, s.Scope)
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2351). Declared
// explicitly rather than inherited by embedding BaseSyncService -- see that field's doc
// comment on BaseSyncService for why a promoted setter is not safe. Setting it also gates
// processHouseholdCustomFieldValue's own two App.Save call sites (a fast-path upsert that
// does not go through BaseSyncService.ProcessSimpleRecord).
func (s *HouseholdCustomFieldValuesSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// SetSession sets the session filter for this sync (e.g., "1", "2", "2a", "all")
func (s *HouseholdCustomFieldValuesSync) SetSession(session string) {
	s.Session = session
}

// Sync performs the household custom field values sync
func (s *HouseholdCustomFieldValuesSync) Sync(ctx context.Context) error {
	year := s.Client.GetSeasonID()
	jobName := s.logJobName()

	// Start the sync process
	s.LogSyncStart(jobName)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Get list of household IDs to sync based on session filter
	householdIDs, err := s.getHouseholdIDsToSync(year)
	if err != nil {
		return fmt.Errorf("getting household IDs to sync: %w", err)
	}

	// Deduplicate household IDs (in case session resolver returns duplicates)
	seenHouseholdIDs := make(map[int]bool)
	uniqueHouseholdIDs := make([]int, 0, len(householdIDs))
	for _, id := range householdIDs {
		if !seenHouseholdIDs[id] {
			seenHouseholdIDs[id] = true
			uniqueHouseholdIDs = append(uniqueHouseholdIDs, id)
		}
	}
	if len(uniqueHouseholdIDs) < len(householdIDs) {
		slog.Warn("Removed duplicate household IDs",
			"original", len(householdIDs),
			"deduplicated", len(uniqueHouseholdIDs))
	}
	householdIDs = uniqueHouseholdIDs

	if len(householdIDs) == 0 {
		slog.Info("No households to sync custom field values for",
			"job", jobName,
			"session", s.Session,
			"year", year)
		s.SyncSuccessful = true
		s.LogSyncComplete(jobName)
		return nil
	}

	slog.Info("Syncing custom field values for households",
		"job", jobName,
		"count", len(householdIDs),
		"session", s.Session,
		"year", year)

	// Pre-load household CM ID -> PB ID mapping for the year
	householdMapping, err := s.preloadHouseholdMapping(year)
	if err != nil {
		return fmt.Errorf("preloading household mapping: %w", err)
	}

	// Pre-load field definition CM ID -> PB ID mapping
	fieldDefMapping, err := s.preloadFieldDefMapping()
	if err != nil {
		return fmt.Errorf("preloading field definition mapping: %w", err)
	}

	// Pre-load existing records for this year
	// KeyBuilder returns identity only (householdPBId:fieldDefPBId)
	// PreloadCompositeRecords appends |year to create yearScopedKey
	filter := fmt.Sprintf("year = %d", year)
	preloadFn := func(record *core.Record) (string, bool) {
		householdPBId := record.GetString("household")
		fieldDefPBId := record.GetString("field_definition")

		if householdPBId != "" && fieldDefPBId != "" {
			// Return identity only - PreloadCompositeRecords adds |year
			return fmt.Sprintf("%s:%s", householdPBId, fieldDefPBId), true
		}
		return "", false
	}
	existingRecords, err := s.PreloadCompositeRecords(
		"household_custom_values", filter, preloadFn)
	if err != nil {
		return fmt.Errorf("preloading existing records: %w", err)
	}

	s.SyncSuccessful = true

	// Only households whose values this run actually fetched may be judged by the
	// orphan sweep. A ?session= filter narrows the run to one session's households
	// while the sweep's filter is the whole year, so without this set a
	// session-scoped run would delete every other session's values as orphans.
	sweptOwners := make(map[string]bool, len(householdIDs))

	// Process each household
	for i, householdCMID := range householdIDs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Log progress every 50 households
		if i > 0 && i%50 == 0 {
			slog.Info("Household custom field values sync progress",
				"processed", i,
				"total", len(householdIDs),
				"percent", fmt.Sprintf("%.1f%%", float64(i)/float64(len(householdIDs))*100))
		}

		// Get PB ID for this household
		householdPBId, found := householdMapping[householdCMID]
		if !found {
			slog.Warn("Household not found in PocketBase, skipping custom field values",
				"household_cm_id", householdCMID)
			continue
		}

		// Fetch custom field values for this household
		err := s.syncHouseholdCustomFieldValues(
			ctx, householdCMID, householdPBId, year, fieldDefMapping, existingRecords)
		if err != nil {
			slog.Error("Error syncing custom field values for household",
				"household_cm_id", householdCMID,
				"error", err)
			s.Stats.Errors++
			// A household whose fetch failed was not fully seen; leaving them out of
			// sweptOwners keeps the sweep from reading a partial fetch as deletions.
			continue
		}

		sweptOwners[householdPBId] = true
	}

	// Delete orphans
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

// preloadHouseholdMapping loads CM ID -> PB ID mapping for households in the given year
func (s *HouseholdCustomFieldValuesSync) preloadHouseholdMapping(year int) (map[int]string, error) {
	filter := fmt.Sprintf("year = %d", year)
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// Year-scoped; the largest year on record holds 2,563 households.
	households, err := s.App.FindRecordsByFilter("households", filter, "", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding households: %w", err)
	}

	mapping := make(map[int]string, len(households))
	for _, household := range households {
		if cmID, ok := household.Get("cm_id").(float64); ok && cmID > 0 {
			mapping[int(cmID)] = household.Id
		}
	}

	s.DebugLog("Preloaded household mapping", "count", len(mapping))

	return mapping, nil
}

// preloadFieldDefMapping loads CM ID -> PB ID mapping for custom field definitions
func (s *HouseholdCustomFieldValuesSync) preloadFieldDefMapping() (map[int]string, error) {
	// Field definitions are global (no year filter)
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// custom_field_defs is NOT year-scoped: all 1,270 rows load every time.
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

// getHouseholdIDsToSync returns the list of household CampMinder IDs to sync based on session filter
func (s *HouseholdCustomFieldValuesSync) getHouseholdIDsToSync(year int) ([]int, error) {
	// Exhaustive on purpose. An unhandled scope must NOT fall through: the constructor sets
	// Session to DefaultSession, so the session guard below is false and control would reach
	// the year-wide filter -- the ~29-minute unrestricted sweep of every household in the
	// year, run on the daily cron under a bounded-sounding registered id.
	switch s.Scope {
	case ScopeFamilyCamp:
		// Bounded daily family-camp pass (kindred#2482): any attendee status, across every
		// family-camp weekend, resolved via attendees rather than Session so it can span
		// multiple weekend sessions in one run.
		resolver := NewSessionResolver(s.App)

		// One weekend, not the season (kindred#2601). Refresh Housing is pressed while looking
		// at ONE weekend, and the two custom-values jobs are ~96% of that chain's ~13.5 min --
		// measured 782 persons / 448 households across the union against 175 for the largest
		// single weekend, so scoping is a 4-5x saving on the press.
		//
		// Reached ONLY through a request-scoped instance (RunSyncSequenceWithServices). The
		// registered singleton the 3am cron runs is constructed with Session=DefaultSession and
		// is never written to, so the unattended pass still spans every weekend -- which is the
		// half TestScopeFamilyCamp_NoSession* exists to keep true.
		if s.Session != "" && s.Session != DefaultSession {
			scoped, err := resolver.GetHouseholdIDsForSessionAnyStatus(s.Session, year)
			if err != nil {
				return nil, err
			}

			s.DebugLog("Resolved family-camp cohort to one weekend",
				"count", len(scoped),
				"session", s.Session,
				"year", year)

			return scoped, nil
		}

		householdIDs, err := resolver.GetFamilyCampHouseholdIDsAnyStatus(year)
		if err != nil {
			return nil, err
		}

		s.DebugLog("Resolved family-camp bounded cohort to household IDs",
			"count", len(householdIDs),
			"year", year)

		return householdIDs, nil
	case ScopeAll:
		// Unscoped -- the Session and year-wide selection below is the whole behavior.
	default:
		return nil, fmt.Errorf("getHouseholdIDsToSync: unhandled scope %q -- give it a case "+
			"here before registering a service under it", s.Scope)
	}

	// Use session resolver if session filter is specified
	if s.Session != "" && s.Session != DefaultSession {
		resolver := NewSessionResolver(s.App)
		householdIDs, err := resolver.GetHouseholdIDsForSession(s.Session, year)
		if err != nil {
			return nil, err
		}

		s.DebugLog("Resolved session to household IDs",
			"session", s.Session,
			"count", len(householdIDs),
			"year", year)

		return householdIDs, nil
	}

	// No session filter - get all households synced for this year
	filter := fmt.Sprintf("year = %d", year)
	// Unlimited (0), not a 10,000 cap. PocketBase treats limit=0 as no limit
	// (core/record_query.go applies Limit only when limit > 0), and a bare
	// number there is a silent truncation cliff, not a page size: kindred#2266
	// was exactly this literal on the orphan sweep, where it hid 94% of a year.
	// Feeds sweptOwners, which is what narrows the orphan sweep. A silent
	// truncation here would shrink the sweep's computed set as well.
	households, err := s.App.FindRecordsByFilter("households", filter, "", 0, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("finding households: %w", err)
	}

	householdIDs := make([]int, 0, len(households))
	for _, household := range households {
		if cmID, ok := household.Get("cm_id").(float64); ok && cmID > 0 {
			householdIDs = append(householdIDs, int(cmID))
		}
	}

	s.DebugLog("Getting all households for year",
		"count", len(householdIDs),
		"year", year)

	return householdIDs, nil
}

// syncHouseholdCustomFieldValues fetches and stores custom field values for a single household
func (s *HouseholdCustomFieldValuesSync) syncHouseholdCustomFieldValues(
	ctx context.Context,
	householdCMID int,
	householdPBId string,
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
			values, hasMore, fetchErr = s.Client.GetHouseholdCustomFieldValuesPage(householdCMID, page, pageSize)
			return fetchErr
		})
		if err != nil {
			return fmt.Errorf("fetching custom field values page %d after retries: %w", page, err)
		}

		for _, valueData := range values {
			if err := s.processHouseholdCustomFieldValue(
				valueData, householdCMID, householdPBId, year, fieldDefMapping, existingRecords); err != nil {
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

// processHouseholdCustomFieldValue handles one API-returned custom field value entry for
// a household: resolves the field definition, applies the same-run duplicate guard, and
// creates/updates/skips the row accordingly. Split out of syncHouseholdCustomFieldValues
// (which needs a live CampMinder HTTP round trip via s.Client) purely so the guard below
// can be exercised directly in tests.
func (s *HouseholdCustomFieldValuesSync) processHouseholdCustomFieldValue(
	valueData map[string]any,
	householdCMID int,
	householdPBId string,
	year int,
	fieldDefMapping map[int]string,
	existingRecords map[string]*core.Record,
) error {
	// Extract field ID from API response
	fieldCMIDFloat, ok := valueData["id"].(float64)
	if !ok || fieldCMIDFloat == 0 {
		slog.Warn("Invalid or missing field id in custom field value",
			"household_cm_id", householdCMID)
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
			"household_cm_id", householdCMID)
		return nil
	}

	// Transform to PB format (simplified: only value and year)
	pbData := s.transformHouseholdCustomFieldValueToPB(valueData, householdPBId, fieldDefPBId, year)

	// Build composite key: identity only (no year)
	// yearScopedKey matches format from PreloadCompositeRecords
	compositeKey := fmt.Sprintf("%s:%s", householdPBId, fieldDefPBId)
	yearScopedKey := fmt.Sprintf("%s|%d", compositeKey, year)

	// Duplicate-in-run guard (kindred#2270). See the identical comment in
	// person_custom_field_values.go's processPersonCustomFieldValue -- this is the
	// household twin of the same defect and the same fix. persons/households/{id}/custom-
	// fields is documented as one entry per field definition, and CampMinder packs
	// multi-selects into a single delimited value string rather than repeating the field
	// id, so a second entry for a key this run has already tracked is not today's shape.
	// Before this guard it silently collapsed onto the first with no diagnostic. This does
	// NOT change the storage grain -- still one row per (household, field_definition,
	// year) -- it only makes that collapse loud.
	if s.IsKeyProcessed(compositeKey, year) {
		valueStr, _ := pbData["value"].(string)
		slog.Warn("Duplicate custom field value entry in this sync run, discarding",
			"household_cm_id", householdCMID,
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
				slog.Error("Error updating household custom field value",
					"error", err,
					"household_cm_id", householdCMID,
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
						HouseholdCMID:   householdCMID,
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
		collection, err := s.App.FindCollectionByNameOrId("household_custom_values")
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
			slog.Error("Error creating household custom field value",
				"error", err,
				"household_cm_id", householdCMID,
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
				HouseholdCMID:   householdCMID,
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
// 10,000 rows with no surrounding pagination -- the latent twin in kindred#2266.
// 10,000 is a hard cap, not a page size. It has not bitten here only because the
// table is small: the largest year holds 1,773 rows against person_custom_values'
// 128,606-184,458. The cap would start silently dropping this table's orphans the
// moment a year crossed it, so it goes now rather than later. Routing through the
// shared guarded sweep replaces the cap with keyset pagination and picks up the
// collapse guard, so there is one implementation instead of a local copy.
//
// sweptOwners is the set of household PB IDs whose values were successfully
// fetched during THIS run, and it is what makes the fix safe rather than
// catastrophic. The sweep's filter is the whole year, but the computed set is
// only ever as wide as the run: this service takes a ?session= filter (api.go),
// and getHouseholdIDsToSync resolves that session through
// GetHouseholdIDsForSession to the households with someone enrolled in it --
// a fraction of the year. Uncapping the read without narrowing the judgement
// would have let one session-scoped run delete every other session's households'
// values as orphans. A row is a candidate only if this run actually fetched that
// household's values; anything else is invisible to the sweep, exactly as it
// should be.
func (s *HouseholdCustomFieldValuesSync) deleteOrphans(year int, sweptOwners map[string]bool) error {
	return s.DeleteOrphansGuarded(
		"household_custom_values",
		func(record *core.Record) (string, bool) {
			householdPBId := record.GetString("household")
			if !sweptOwners[householdPBId] {
				return "", false
			}

			// Matches TrackProcessedCompositeKey's "<identity>|<year>" format
			return fmt.Sprintf("%s:%s|%d",
				householdPBId, record.GetString("field_definition"), record.GetInt("year")), true
		},
		"household custom field value",
		fmt.Sprintf("year = %d", year),
		OrphanSweepGuard{
			Entity:   "household_custom_values",
			Year:     year,
			Computed: len(s.ProcessedKeys),
			Hint: "check that the households sync ran for that year, and that " +
				"custom_field_defs still holds these field definitions",
		},
	)
}

// transformHouseholdCustomFieldValueToPB transforms CampMinder custom field value data to PocketBase format
// Schema: household, field_definition, value, year, last_updated (optional)
func (s *HouseholdCustomFieldValuesSync) transformHouseholdCustomFieldValueToPB(
	data map[string]any,
	householdPBId string,
	fieldDefPBId string,
	year int,
) map[string]any {
	pbData := make(map[string]any)

	// Set relations
	pbData["household"] = householdPBId
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
