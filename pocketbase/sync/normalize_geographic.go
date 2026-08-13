package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// serviceNameNormalizeGeographic is the canonical name for this sync service
const serviceNameNormalizeGeographic = "normalize_geographic"

// Normalization categories
const (
	categoryCity         = "city"
	categorySchool       = "school"
	categoryCongregation = "congregation"
)

// Common filter fragment
const filterYearParam = "year = {:year}"

// NormalizeGeographicSync normalizes geographic data from enrolled attendees
// and stores mappings in normalized_mappings table with person+session keys.
//
// Orchestrates normalization by:
//  1. Loading attendees with person+session data (school/city from persons,
//     congregation from person_custom_values, state/country from household)
//  2. Loading geo_overrides (alias, merge, rejected) up to the current year
//  3. Building normalization lookup via Python geo_normalizer (RapidFuzz, static lookups)
//  4. Creating person+session mappings (applying alias/merge overrides)
//  5. Preloading existing normalized_mappings for upsert comparison
//  6. Upserting to normalized_mappings with (person, session, category) keys,
//     skipping rejected overrides
//  7. Updating camper_history.*_normalized columns for backwards compatibility
//  8. Updating persons.normalized_* columns for drilldown consistency
//  9. Deleting orphaned mappings no longer in source data
//
// 10. Running WAL checkpoint if any records were modified
type NormalizeGeographicSync struct {
	App            core.App
	Year           int
	DryRun         bool
	Debug          bool
	Stats          Stats
	SyncSuccessful bool
	ProcessedKeys  map[string]bool // Track processed keys for orphan detection
}

// attendeeGeoData holds geographic data for one attendee
type attendeeGeoData struct {
	PersonPBID     string
	PersonCMID     int
	SessionPBID    string
	SessionCMID    int
	School         string // from persons.school
	City           string // from persons.address.city
	Congregation   string // from person_custom_values (HH-Name of Congregation)
	AddressState   string // from household billing_state
	AddressCountry string // from household billing_country
}

// personSessionMapping holds a computed mapping for person+session
type personSessionMapping struct {
	personPBID      string
	sessionPBID     string
	category        string
	originalValue   string
	normalizedValue string
	confidence      float64
	year            int
	addressState    string // from household billing_state
	addressCountry  string // from household billing_country
	addressCity     string // from persons.address_city
}

// NewNormalizeGeographicSync creates a new normalize geographic sync service
func NewNormalizeGeographicSync(app core.App) *NormalizeGeographicSync {
	return &NormalizeGeographicSync{
		App:           app,
		Year:          0,     // Default: current year from env
		DryRun:        false, // Default: write to database
		ProcessedKeys: make(map[string]bool),
	}
}

// Name returns the service name
func (n *NormalizeGeographicSync) Name() string {
	return serviceNameNormalizeGeographic
}

// GetStats returns the current stats
func (n *NormalizeGeographicSync) GetStats() Stats {
	return n.Stats
}

// SetDebug enables or disables debug logging
func (n *NormalizeGeographicSync) SetDebug(debug bool) {
	n.Debug = debug
}

// SetYear sets the year for this sync service
func (n *NormalizeGeographicSync) SetYear(year int) {
	n.Year = year
}

// DebugLog logs a message at INFO level only when Debug is enabled
func (n *NormalizeGeographicSync) DebugLog(msg string, args ...any) {
	if n.Debug {
		slog.Info(msg, args...)
	}
}

// Sync executes the geographic normalization
func (n *NormalizeGeographicSync) Sync(ctx context.Context) error {
	n.Stats = Stats{}
	n.SyncSuccessful = false
	n.ProcessedKeys = make(map[string]bool)

	// Determine year
	year := n.Year
	if year == 0 {
		var err error
		year, err = ParseSeasonYear()
		if err != nil {
			return fmt.Errorf("year resolution failed: %w", err)
		}
	}

	slog.Info("Starting geographic normalization",
		"year", year,
		"dry_run", n.DryRun,
	)

	// Step 1: Load enrolled attendees with geographic data
	attendeeData, err := n.loadAttendeeGeoData(ctx, year)
	if err != nil {
		return fmt.Errorf("loading attendee geo data: %w", err)
	}

	if len(attendeeData) == 0 {
		slog.Info("No enrolled attendees found for year", "year", year)
		n.SyncSuccessful = true
		return nil
	}

	slog.Info("Loaded attendee geographic data",
		"attendees", len(attendeeData),
	)

	// Step 1b: Load geo_overrides (alias + merge + rejected) up to current year
	aliasOverrides, mergeOverrides, rejectedOverrides, err := n.loadGeoOverrides(year)
	if err != nil {
		slog.Warn("Could not load geo_overrides, continuing without overrides", "error", err)
		aliasOverrides = make(map[string]map[string]string)
		mergeOverrides = make(map[string]map[string]string)
		rejectedOverrides = make(map[string]map[string]bool)
	}

	// Step 2: Build normalization lookup maps from all unique values
	normalizedLookup, err := n.buildNormalizationLookup(ctx, attendeeData)
	if err != nil {
		return fmt.Errorf("building normalization lookup: %w", err)
	}

	// Step 3: Create person+session mappings
	mappings := n.createPersonSessionMappings(attendeeData, normalizedLookup, aliasOverrides, mergeOverrides, year)

	// Count mappings by category for debugging
	categoryCount := make(map[string]int)
	for _, m := range mappings {
		categoryCount[m.category]++
	}
	slog.Info("Created person+session mappings",
		"total_mappings", len(mappings),
		"city_mappings", categoryCount[categoryCity],
		"school_mappings", categoryCount[categorySchool],
		"congregation_mappings", categoryCount[categoryCongregation],
	)

	if n.DryRun {
		slog.Info("Dry run mode - computed but not writing")
		n.SyncSuccessful = true
		return nil
	}

	// Step 4: Preload existing mappings for upsert
	existingMappings, err := n.preloadExistingMappings(year)
	if err != nil {
		return fmt.Errorf("preloading existing mappings: %w", err)
	}

	// Step 5: Upsert normalized_mappings
	if err := n.upsertPersonSessionMappings(ctx, mappings, existingMappings, year, rejectedOverrides); err != nil {
		return fmt.Errorf("upserting normalized mappings: %w", err)
	}

	// Step 6: Update camper_history.*_normalized columns (backwards compatibility)
	if err := n.updateCamperHistoryNormalized(ctx, normalizedLookup, year); err != nil {
		return fmt.Errorf("updating camper history: %w", err)
	}

	// Step 6b: Update persons.normalized_* columns for drilldown consistency
	if err := n.updatePersonsNormalized(ctx, normalizedLookup, attendeeData, year); err != nil {
		return fmt.Errorf("updating persons normalized: %w", err)
	}

	// Mark sync as successful before orphan deletion
	n.SyncSuccessful = true

	// Step 7: Delete orphaned mappings
	deleted, orphanErr := n.deleteOrphans(existingMappings, year)
	n.Stats.Deleted = deleted

	// WAL checkpoint BEFORE the error return below -- the upserts above have
	// already written by this point, and the refusal path can fire on a
	// non-empty computed set (a PARTIAL collapse), which is exactly the case
	// where writes already happened.
	if n.Stats.Created > 0 || n.Stats.Updated > 0 || n.Stats.Deleted > 0 {
		if err := n.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
	}

	if orphanErr != nil {
		return fmt.Errorf("orphan sweep refused: %w", orphanErr)
	}

	slog.Info("Geographic normalization completed",
		"year", year,
		"created", n.Stats.Created,
		"updated", n.Stats.Updated,
		"skipped", n.Stats.Skipped,
		"deleted", n.Stats.Deleted,
		"errors", n.Stats.Errors,
	)

	return nil
}

// loadAttendeeGeoData loads enrolled attendees with their geographic data
func (n *NormalizeGeographicSync) loadAttendeeGeoData(ctx context.Context, year int) ([]attendeeGeoData, error) {
	var result []attendeeGeoData

	// Load congregation field definition ID
	congregationFieldID, err := n.getCongregationFieldID()
	if err != nil {
		slog.Warn("Could not find congregation field definition", "error", err)
		// Continue without congregation data
	}

	// Load person congregations from person_custom_values
	congregationByPersonPBID := make(map[string]string)
	if congregationFieldID != "" {
		congregationByPersonPBID, err = n.loadPersonCongregations(year, congregationFieldID)
		if err != nil {
			slog.Warn("Could not load person congregations", "error", err)
			// Continue without congregation data
		}
	}

	// Load all attendees for the year regardless of enrollment status.
	// Normalization is cheap (local fuzzy matching) and benefits all attendees:
	// waitlisted campers get clean data, and more data points improve clustering.
	filter := filterYearParam
	filterParams := dbx.Params{"year": year}
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		records, err := n.App.FindRecordsByFilter(
			"attendees",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
			filterParams,
		)
		if err != nil {
			return nil, fmt.Errorf("querying attendees page %d: %w", page, err)
		}

		// Expand person and session relations
		if errs := n.App.ExpandRecords(records, []string{"person", "session"}, nil); len(errs) > 0 {
			slog.Warn("Some relation expansions failed", "page", page, "errors", errs)
		}

		// Expand primary_childhood_household on person records for address state/country
		var personRecords []*core.Record
		for _, record := range records {
			if pr := record.ExpandedOne("person"); pr != nil {
				personRecords = append(personRecords, pr)
			}
		}
		if len(personRecords) > 0 {
			if errs := n.App.ExpandRecords(personRecords, []string{"primary_childhood_household"}, nil); len(errs) > 0 {
				slog.Warn("Some household expansions failed", "page", page, "errors", errs)
			}
		}

		for _, record := range records {
			// Get person expand
			personRecord := record.ExpandedOne("person")
			if personRecord == nil {
				continue
			}

			// Get session expand
			sessionRecord := record.ExpandedOne("session")
			if sessionRecord == nil {
				continue
			}

			data := attendeeGeoData{
				PersonPBID:  personRecord.Id,
				PersonCMID:  int(personRecord.GetFloat("cm_id")),
				SessionPBID: sessionRecord.Id,
				SessionCMID: int(sessionRecord.GetFloat("cm_id")),
				School:      personRecord.GetString("school"),
				City:        personRecord.GetString("address_city"),
			}

			// Get address state/country from household
			if household := personRecord.ExpandedOne("primary_childhood_household"); household != nil {
				data.AddressState = household.GetString("billing_state")
				data.AddressCountry = household.GetString("billing_country")
			}

			// Get congregation from person_custom_values
			if congregation, ok := congregationByPersonPBID[personRecord.Id]; ok {
				data.Congregation = congregation
			}

			result = append(result, data)
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	// Debug: count how many records have each field populated
	withCity := 0
	withSchool := 0
	withCongregation := 0
	for i := range result {
		if result[i].City != "" {
			withCity++
		}
		if result[i].School != "" {
			withSchool++
		}
		if result[i].Congregation != "" {
			withCongregation++
		}
	}
	slog.Info("Loaded attendee geographic data (field counts)",
		"total", len(result),
		"with_city", withCity,
		"with_school", withSchool,
		"with_congregation", withCongregation,
	)

	return result, nil
}

// getCongregationFieldID returns the PocketBase ID for the "HH-Name of Congregation" field
func (n *NormalizeGeographicSync) getCongregationFieldID() (string, error) {
	records, err := n.App.FindRecordsByFilter(
		"custom_field_defs",
		`name = "HH-Name of Congregation"`,
		"",
		1,
		0,
	)
	if err != nil || len(records) == 0 {
		return "", fmt.Errorf("congregation field not found")
	}
	return records[0].Id, nil
}

// loadPersonCongregations loads congregation values from person_custom_values
func (n *NormalizeGeographicSync) loadPersonCongregations(year int, fieldID string) (map[string]string, error) {
	result := make(map[string]string)

	filter := `field_definition = {:fieldID} && year = {:year} && value != ""`
	filterParams := dbx.Params{"fieldID": fieldID, "year": year}
	page := 1
	perPage := 500

	for {
		records, err := n.App.FindRecordsByFilter(
			"person_custom_values",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
			filterParams,
		)
		if err != nil {
			return nil, fmt.Errorf("querying person_custom_values page %d: %w", page, err)
		}

		for _, record := range records {
			personPBID := record.GetString("person")
			value := record.GetString("value")
			if personPBID != "" && value != "" {
				result[personPBID] = value
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	slog.Info("Loaded person congregations", "count", len(result))
	return result, nil
}

// loadGeoOverrides loads alias, merge, and rejected overrides from the geo_overrides table.
// Returns:
//   - aliasOverrides: category -> (lowercase raw_value -> canonical_name)
//   - mergeOverrides: category -> (canonical_name -> merged_into)
//   - rejectedOverrides: category -> (lowercase canonical_name -> true)
func (n *NormalizeGeographicSync) loadGeoOverrides(year int) (
	aliasOverrides map[string]map[string]string,
	mergeOverrides map[string]map[string]string,
	rejectedOverrides map[string]map[string]bool,
	err error,
) {
	aliasOverrides = map[string]map[string]string{
		categoryCity: {}, categorySchool: {}, categoryCongregation: {},
	}
	mergeOverrides = map[string]map[string]string{
		categoryCity: {}, categorySchool: {}, categoryCongregation: {},
	}
	rejectedOverrides = map[string]map[string]bool{
		categoryCity: {}, categorySchool: {}, categoryCongregation: {},
	}

	records, findErr := n.App.FindRecordsByFilter(
		"geo_overrides",
		"year <= {:year}",
		"year ASC",
		0,
		0,
		dbx.Params{"year": year},
	)
	if findErr != nil {
		return aliasOverrides, mergeOverrides, rejectedOverrides, fmt.Errorf("loading geo_overrides: %w", findErr)
	}

	for _, record := range records {
		cat := record.GetString("category")
		overrideType := record.GetString("override_type")

		switch overrideType {
		case "alias":
			rawValue := strings.ToLower(record.GetString("raw_value"))
			canonical := record.GetString("canonical_name")
			if rawValue != "" && canonical != "" {
				if _, ok := aliasOverrides[cat]; ok {
					aliasOverrides[cat][rawValue] = canonical
				}
			}
		case "merge":
			canonical := record.GetString("canonical_name")
			mergedInto := record.GetString("merged_into")
			if canonical != "" && mergedInto != "" {
				if _, ok := mergeOverrides[cat]; ok {
					mergeOverrides[cat][canonical] = mergedInto
				}
			}
		case "rejected":
			// Rejections carry forward permanently across years. To un-reject a canonical,
			// delete the rejection record from geo_overrides — there is no override mechanism.
			name := record.GetString("canonical_name")
			if name != "" {
				if rejectedOverrides[cat] == nil {
					rejectedOverrides[cat] = make(map[string]bool)
				}
				rejectedOverrides[cat][strings.ToLower(name)] = true
			}
		}
	}

	aliasCount := len(aliasOverrides[categoryCity]) +
		len(aliasOverrides[categorySchool]) + len(aliasOverrides[categoryCongregation])
	mergeCount := len(mergeOverrides[categoryCity]) +
		len(mergeOverrides[categorySchool]) + len(mergeOverrides[categoryCongregation])
	rejectedCount := len(rejectedOverrides[categoryCity]) +
		len(rejectedOverrides[categorySchool]) + len(rejectedOverrides[categoryCongregation])
	if aliasCount > 0 || mergeCount > 0 || rejectedCount > 0 {
		slog.Info("Loaded geo_overrides", "aliases", aliasCount, "merges", mergeCount, "rejected", rejectedCount)
	}

	return aliasOverrides, mergeOverrides, rejectedOverrides, nil
}

// geoContext holds the first-seen address state and country for a geographic value.
// Used to pass location context to the Python normalizer for country-aware matching.
type geoContext struct {
	State   string `json:"state"`
	Country string `json:"country"`
}

// geoLookupKey is a composite key for deduplicating geographic values.
// Using (Value, State, Country) ensures that "Springfield, IL" and
// "Springfield, MO" are treated as separate entries rather than collapsing
// to first-seen context.
type geoLookupKey struct {
	Value   string
	State   string
	Country string
}

// valueWithContext is the JSON structure sent to the Python normalizer.
// Each value includes its address context so the normalizer can apply
// country-specific matching rules (e.g., skip normalization for non-US cities).
type valueWithContext struct {
	Value   string `json:"value"`
	State   string `json:"state"`
	Country string `json:"country"`
}

// normalizedEntry holds a canonical value and its confidence from Python normalizer
type normalizedEntry struct {
	Canonical  string
	Confidence float64
}

// normalizationLookup maps original values to normalized entries per category
type normalizationLookup struct {
	city         map[string]normalizedEntry // original → {canonical, confidence}
	school       map[string]normalizedEntry
	congregation map[string]normalizedEntry
}

// pythonNormalizedResult represents the JSON response from the geo-normalize API
type pythonNormalizedResult struct {
	Canonical  string  `json:"canonical"`
	Confidence float64 `json:"confidence"`
}

// geoNormalizeRequest is the JSON body for the geo-normalize API
type geoNormalizeRequest struct {
	Category string             `json:"category"`
	Values   []valueWithContext `json:"values"`
}

// callGeoNormalizeAPI calls the FastAPI geo-normalize endpoint
func callGeoNormalizeAPI(
	ctx context.Context, apiURL, category string, values []valueWithContext,
) (map[string]pythonNormalizedResult, error) {
	reqBody := geoNormalizeRequest{
		Category: category,
		Values:   values,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshaling request: %w", err)
	}

	endpoint := apiURL + "/api/internal/geo-normalize"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("building geo-normalize request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := geoNormalizeClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("calling geo-normalize API: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("geo-normalize API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var results map[string]pythonNormalizedResult
	if err := json.Unmarshal(respBody, &results); err != nil {
		return nil, fmt.Errorf("parsing geo-normalize response: %w", err)
	}

	return results, nil
}

// normalizeWithPython calls the FastAPI geo-normalize endpoint for fuzzy matching.
func (n *NormalizeGeographicSync) normalizeWithPython(
	ctx context.Context, valuesWithContext map[geoLookupKey]geoContext, category string,
) (map[string]normalizedEntry, error) {
	if len(valuesWithContext) == 0 {
		return make(map[string]normalizedEntry), nil
	}

	// Build context array for API request
	contextValues := make([]valueWithContext, 0, len(valuesWithContext))
	for key, geoCtx := range valuesWithContext {
		contextValues = append(contextValues, valueWithContext{
			Value:   key.Value,
			State:   geoCtx.State,
			Country: geoCtx.Country,
		})
	}

	apiURL := getAPIURL()
	results, err := callGeoNormalizeAPI(ctx, apiURL, category, contextValues)
	if err != nil {
		return nil, err
	}

	// Convert to normalizedEntry map (preserving confidence from API)
	result := make(map[string]normalizedEntry)
	for original, normalized := range results {
		result[original] = normalizedEntry(normalized)
	}

	return result, nil
}

// buildNormalizationLookup builds lookup maps from unique values
// Uses Python RapidFuzz for advanced fuzzy matching
func (n *NormalizeGeographicSync) buildNormalizationLookup(
	ctx context.Context, data []attendeeGeoData,
) (*normalizationLookup, error) {
	// Collect unique values per category keyed by (value, state, country)
	// so that "Springfield, IL" and "Springfield, MO" are separate entries.
	uniqueCities := make(map[geoLookupKey]geoContext)
	uniqueSchools := make(map[geoLookupKey]geoContext)
	uniqueCongregations := make(map[geoLookupKey]geoContext)

	for i := range data {
		d := &data[i]
		if d.City != "" {
			cityKey := geoLookupKey{Value: d.City, State: d.AddressState, Country: d.AddressCountry}
			if _, exists := uniqueCities[cityKey]; !exists {
				uniqueCities[cityKey] = geoContext{State: d.AddressState, Country: d.AddressCountry}
			}
		}
		if d.School != "" {
			schoolKey := geoLookupKey{Value: d.School, State: d.AddressState, Country: d.AddressCountry}
			if _, exists := uniqueSchools[schoolKey]; !exists {
				uniqueSchools[schoolKey] = geoContext{State: d.AddressState, Country: d.AddressCountry}
			}
		}
		if d.Congregation != "" {
			congKey := geoLookupKey{Value: d.Congregation, State: d.AddressState, Country: d.AddressCountry}
			if _, exists := uniqueCongregations[congKey]; !exists {
				uniqueCongregations[congKey] = geoContext{State: d.AddressState, Country: d.AddressCountry}
			}
		}
	}

	// Debug: log unique counts before normalization
	slog.Info("Unique values collected",
		"cities", len(uniqueCities),
		"schools", len(uniqueSchools),
		"congregations", len(uniqueCongregations),
	)

	lookup := &normalizationLookup{
		city:         make(map[string]normalizedEntry),
		school:       make(map[string]normalizedEntry),
		congregation: make(map[string]normalizedEntry),
	}

	if len(uniqueCities) > 0 {
		result, err := n.normalizeWithPython(ctx, uniqueCities, categoryCity)
		if err != nil {
			return nil, fmt.Errorf("normalizing cities: %w", err)
		}
		lookup.city = result
	}

	if len(uniqueSchools) > 0 {
		result, err := n.normalizeWithPython(ctx, uniqueSchools, categorySchool)
		if err != nil {
			return nil, fmt.Errorf("normalizing schools: %w", err)
		}
		lookup.school = result
	}

	if len(uniqueCongregations) > 0 {
		result, err := n.normalizeWithPython(ctx, uniqueCongregations, categoryCongregation)
		if err != nil {
			return nil, fmt.Errorf("normalizing congregations: %w", err)
		}
		lookup.congregation = result
	}

	return lookup, nil
}

// createPersonSessionMappings creates mappings for each person+session.
// Alias overrides take priority over fuzzy match; merge redirects are applied after.
func (n *NormalizeGeographicSync) createPersonSessionMappings(
	data []attendeeGeoData,
	lookup *normalizationLookup,
	aliasOverrides map[string]map[string]string,
	mergeOverrides map[string]map[string]string,
	year int,
) []*personSessionMapping {
	var mappings []*personSessionMapping

	for i := range data {
		d := &data[i]
		// School mapping
		if d.School != "" {
			normalized, confidence := resolveValue(
				d.School, categorySchool, lookup.school, aliasOverrides, mergeOverrides)
			if normalized != "" {
				mappings = append(mappings, &personSessionMapping{
					personPBID:      d.PersonPBID,
					sessionPBID:     d.SessionPBID,
					category:        categorySchool,
					originalValue:   d.School,
					normalizedValue: normalized,
					confidence:      confidence,
					year:            year,
					addressState:    d.AddressState,
					addressCountry:  d.AddressCountry,
					addressCity:     d.City,
				})
			}
		}

		// City mapping
		if d.City != "" {
			normalized, confidence := resolveValue(
				d.City, categoryCity, lookup.city, aliasOverrides, mergeOverrides)
			if normalized != "" {
				mappings = append(mappings, &personSessionMapping{
					personPBID:      d.PersonPBID,
					sessionPBID:     d.SessionPBID,
					category:        categoryCity,
					originalValue:   d.City,
					normalizedValue: normalized,
					confidence:      confidence,
					year:            year,
					addressState:    d.AddressState,
					addressCountry:  d.AddressCountry,
					addressCity:     d.City,
				})
			}
		}

		// Congregation mapping
		if d.Congregation != "" {
			normalized, confidence := resolveValue(
				d.Congregation, categoryCongregation, lookup.congregation,
				aliasOverrides, mergeOverrides)
			if normalized != "" {
				mappings = append(mappings, &personSessionMapping{
					personPBID:      d.PersonPBID,
					sessionPBID:     d.SessionPBID,
					category:        categoryCongregation,
					originalValue:   d.Congregation,
					normalizedValue: normalized,
					confidence:      confidence,
					year:            year,
					addressState:    d.AddressState,
					addressCountry:  d.AddressCountry,
					addressCity:     d.City,
				})
			}
		}
	}

	return mappings
}

// preloadExistingMappings loads all existing normalized_mappings for the year
func (n *NormalizeGeographicSync) preloadExistingMappings(year int) (map[string]*core.Record, error) {
	existingRecords := make(map[string]*core.Record)

	filter := filterYearParam
	filterParams := dbx.Params{"year": year}
	page := 1
	perPage := 500

	for {
		records, err := n.App.FindRecordsByFilter(
			"normalized_mappings",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
			filterParams,
		)
		if err != nil {
			return nil, fmt.Errorf("querying existing mappings page %d: %w", page, err)
		}

		for _, record := range records {
			// Use person+session+category as key for new schema
			personPBID := record.GetString("person")
			sessionPBID := record.GetString("session")
			category := record.GetString("category")

			if personPBID != "" && sessionPBID != "" {
				// New schema: key by person+session+category
				key := fmt.Sprintf("%s:%s:%s", personPBID, sessionPBID, category)
				existingRecords[key] = record
			} else {
				// Old schema: key by category+original+year (for migration)
				originalValue := record.GetString("original_value")
				key := fmt.Sprintf("%s:%s:%d", category, originalValue, year)
				existingRecords[key] = record
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	slog.Info("Loaded existing normalized_mappings", "count", len(existingRecords), "year", year)
	return existingRecords, nil
}

// upsertPersonSessionMappings upserts mappings with person+session keys.
// Rejected canonicals (from rejectedOverrides) are silently skipped.
func (n *NormalizeGeographicSync) upsertPersonSessionMappings(
	ctx context.Context,
	mappings []*personSessionMapping,
	existingMappings map[string]*core.Record,
	year int,
	rejectedOverrides map[string]map[string]bool,
) error {
	col, err := n.App.FindCollectionByNameOrId("normalized_mappings")
	if err != nil {
		return fmt.Errorf("finding normalized_mappings collection: %w", err)
	}

	for _, m := range mappings {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Skip rejected canonicals
		if rejected, ok := rejectedOverrides[m.category]; ok {
			if rejected[strings.ToLower(m.normalizedValue)] {
				slog.Debug("skipping rejected canonical",
					"category", m.category,
					"normalized_value", m.normalizedValue)
				continue
			}
		}

		key := fmt.Sprintf("%s:%s:%s", m.personPBID, m.sessionPBID, m.category)
		n.ProcessedKeys[key] = true

		// Build record data
		recordData := map[string]any{
			"person":           m.personPBID,
			"session":          m.sessionPBID,
			"category":         m.category,
			"original_value":   m.originalValue,
			"normalized_value": m.normalizedValue,
			"confidence":       m.confidence,
			"year":             year,
			"address_state":    m.addressState,
			"address_country":  m.addressCountry,
			"address_city":     m.addressCity,
		}

		existing := existingMappings[key]
		if existing != nil {
			// Check if update needed
			if n.personSessionMappingNeedsUpdate(existing, recordData) {
				for field, value := range recordData {
					existing.Set(field, value)
				}
				if err := n.App.Save(existing); err != nil {
					slog.Error("Error updating normalized mapping",
						"person", m.personPBID,
						"session", m.sessionPBID,
						"category", m.category,
						"error", err)
					n.Stats.Errors++
					continue
				}
				n.Stats.Updated++
			} else {
				n.Stats.Skipped++
			}
		} else {
			// Create new record
			record := core.NewRecord(col)
			for field, value := range recordData {
				record.Set(field, value)
			}
			if err := n.App.Save(record); err != nil {
				slog.Error("Error creating normalized mapping",
					"person", m.personPBID,
					"session", m.sessionPBID,
					"category", m.category,
					"error", err)
				n.Stats.Errors++
				continue
			}
			n.Stats.Created++
		}
	}

	return nil
}

// personSessionMappingNeedsUpdate checks if a mapping record needs updating
func (n *NormalizeGeographicSync) personSessionMappingNeedsUpdate(
	existing *core.Record,
	newData map[string]any,
) bool {
	// Compare normalized_value
	newNormalized, _ := newData["normalized_value"].(string)
	if existing.GetString("normalized_value") != newNormalized {
		return true
	}
	// Compare original_value
	newOriginal, _ := newData["original_value"].(string)
	if existing.GetString("original_value") != newOriginal {
		return true
	}
	// Compare address_state
	if existing.GetString("address_state") != fmt.Sprint(newData["address_state"]) {
		return true
	}
	// Compare address_country
	if existing.GetString("address_country") != fmt.Sprint(newData["address_country"]) {
		return true
	}
	// Compare address_city
	if existing.GetString("address_city") != fmt.Sprint(newData["address_city"]) {
		return true
	}
	// Compare confidence with epsilon for float precision
	const epsilon = 0.0001
	existingConf := 0.0
	if c, ok := existing.Get("confidence").(float64); ok {
		existingConf = c
	}
	newConf, _ := newData["confidence"].(float64)
	return math.Abs(existingConf-newConf) > epsilon
}

// updateCamperHistoryNormalized updates the *_normalized columns in camper_history
func (n *NormalizeGeographicSync) updateCamperHistoryNormalized(
	ctx context.Context,
	lookup *normalizationLookup,
	year int,
) error {
	// Update camper_history records
	filter := filterYearParam
	filterParams := dbx.Params{"year": year}
	page := 1
	perPage := 500
	updatedCount := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		records, err := n.App.FindRecordsByFilter(
			"camper_history",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
			filterParams,
		)
		if err != nil {
			return fmt.Errorf("querying camper_history page %d: %w", page, err)
		}

		for _, record := range records {
			needsUpdate := false

			// City
			if city := record.GetString("city"); city != "" {
				if entry, ok := lookup.city[city]; ok {
					if record.GetString("city_normalized") != entry.Canonical {
						record.Set("city_normalized", entry.Canonical)
						needsUpdate = true
					}
				}
			}

			// School
			if school := record.GetString("school"); school != "" {
				if entry, ok := lookup.school[school]; ok {
					if record.GetString("school_normalized") != entry.Canonical {
						record.Set("school_normalized", entry.Canonical)
						needsUpdate = true
					}
				}
			}

			// Congregation (synagogue field in camper_history)
			if synagogue := record.GetString("synagogue"); synagogue != "" {
				if entry, ok := lookup.congregation[synagogue]; ok {
					if record.GetString("congregation_normalized") != entry.Canonical {
						record.Set("congregation_normalized", entry.Canonical)
						needsUpdate = true
					}
				}
			}

			if needsUpdate {
				if err := n.App.Save(record); err != nil {
					slog.Error("Error updating camper_history normalized fields",
						"id", record.Id,
						"error", err)
					continue
				}
				updatedCount++
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	n.DebugLog("Updated camper_history normalized fields", "count", updatedCount)
	return nil
}

// updatePersonsNormalized updates the normalized_* columns on persons records
// This enables the drilldown service to match on normalized values directly
// instead of requiring separate normalized_mappings lookups.
func (n *NormalizeGeographicSync) updatePersonsNormalized(
	ctx context.Context,
	lookup *normalizationLookup,
	attendeeData []attendeeGeoData,
	year int,
) error {
	// Build person PBID → raw congregation map from attendee data
	// (congregation comes from person_custom_values, not persons table)
	congregationByPerson := make(map[string]string)
	for i := range attendeeData {
		if attendeeData[i].Congregation != "" {
			congregationByPerson[attendeeData[i].PersonPBID] = attendeeData[i].Congregation
		}
	}

	filter := filterYearParam
	filterParams := dbx.Params{"year": year}
	page := 1
	perPage := 500
	updatedCount := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		records, err := n.App.FindRecordsByFilter(
			"persons",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
			filterParams,
		)
		if err != nil {
			return fmt.Errorf("querying persons page %d: %w", page, err)
		}

		for _, record := range records {
			needsUpdate := false

			// City
			if city := record.GetString("address_city"); city != "" {
				if entry, ok := lookup.city[city]; ok {
					if record.GetString("normalized_city") != entry.Canonical {
						record.Set("normalized_city", entry.Canonical)
						needsUpdate = true
					}
				}
			}

			// School
			if school := record.GetString("school"); school != "" {
				if entry, ok := lookup.school[school]; ok {
					if record.GetString("normalized_school") != entry.Canonical {
						record.Set("normalized_school", entry.Canonical)
						needsUpdate = true
					}
				}
			}

			// Congregation (from person_custom_values via attendee data)
			if rawCongregation, ok := congregationByPerson[record.Id]; ok {
				if entry, ok := lookup.congregation[rawCongregation]; ok {
					if record.GetString("normalized_congregation") != entry.Canonical {
						record.Set("normalized_congregation", entry.Canonical)
						needsUpdate = true
					}
				}
			}

			if needsUpdate {
				if err := n.App.Save(record); err != nil {
					slog.Error("Error updating persons normalized fields",
						"id", record.Id,
						"error", err)
					continue
				}
				updatedCount++
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	n.DebugLog("Updated persons normalized fields", "count", updatedCount)
	return nil
}

// deleteOrphans removes mappings that weren't processed (no longer in source data).
//
// Refuses when the computed set is too small to be believed against the rows
// on disk: that combination is always a broken input, and sweeping on it
// deletes the season's mappings and reports success (kindred#2257,
// kindred#2283). The rule lives in OrphanSweepGuard so there is one
// implementation, not an eighth copy.
func (n *NormalizeGeographicSync) deleteOrphans(existingMappings map[string]*core.Record, year int) (int, error) {
	if !n.SyncSuccessful {
		slog.Info("Skipping orphan deletion due to sync failure")
		return 0, nil
	}

	guard := OrphanSweepGuard{
		Entity:   "normalized_mappings",
		Year:     year,
		Computed: len(n.ProcessedKeys),
		Hint:     "check that the attendees sync returned this season",
	}
	if err := guard.Check(len(existingMappings)); err != nil {
		return 0, err
	}

	orphanCount := 0
	for key, record := range existingMappings {
		if n.ProcessedKeys[key] {
			continue
		}

		category := record.GetString("category")
		personPBID := record.GetString("person")
		sessionPBID := record.GetString("session")

		n.DebugLog("Deleting orphaned normalized mapping",
			"category", category,
			"person", personPBID,
			"session", sessionPBID)

		if err := n.App.Delete(record); err != nil {
			slog.Error("Error deleting orphan", "id", record.Id, "error", err)
			n.Stats.Errors++
			continue
		}
		orphanCount++
	}

	if orphanCount > 0 {
		slog.Info("Deleted orphaned normalized_mappings", "count", orphanCount)
	}

	return orphanCount, nil
}

// resolveValue checks alias overrides first, then fuzzy match, then merge redirects.
// Returns the normalized value and confidence score.
func resolveValue(
	rawValue string, category string, lookupMap map[string]normalizedEntry,
	aliasOverrides, mergeOverrides map[string]map[string]string,
) (normalized string, confidence float64) {
	lowerRaw := strings.ToLower(rawValue)

	// 1. Check alias override first
	if aliases, ok := aliasOverrides[category]; ok {
		if canonical, found := aliases[lowerRaw]; found {
			normalized = canonical
			confidence = 1.0 // manual override = full confidence
			// Check merge redirect on alias result
			if merges, ok := mergeOverrides[category]; ok {
				if mergedInto, found := merges[normalized]; found {
					normalized = mergedInto
				}
			}
			return normalized, confidence
		}
	}

	// 2. Fall back to Python normalizer result (preserving Python confidence)
	if entry, ok := lookupMap[rawValue]; ok && entry.Canonical != "" {
		normalized = entry.Canonical
		confidence = entry.Confidence
	} else {
		return "", 0 // no match
	}

	// 3. Check merge redirect on normalized result
	if merges, ok := mergeOverrides[category]; ok {
		if mergedInto, found := merges[normalized]; found {
			normalized = mergedInto
		}
	}

	return normalized, confidence
}

// forceWALCheckpoint forces a SQLite WAL checkpoint
func (n *NormalizeGeographicSync) forceWALCheckpoint() error {
	db := n.App.DB()
	if db == nil {
		return fmt.Errorf("unable to get database connection")
	}

	_, err := db.NewQuery("PRAGMA wal_checkpoint(FULL)").Execute()
	if err != nil {
		return fmt.Errorf("WAL checkpoint failed: %w", err)
	}

	return nil
}
