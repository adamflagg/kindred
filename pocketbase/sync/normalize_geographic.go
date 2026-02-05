package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

// serviceNameNormalizeGeographic is the canonical name for this sync service
const serviceNameNormalizeGeographic = "normalize_geographic"

// Normalization categories
const (
	categoryCity         = "city"
	categorySchool       = "school"
	categoryCongregation = "congregation"
)

// Fuzzy matching threshold (0-100)
const defaultFuzzyThreshold = 90

// NormalizeGeographicSync normalizes geographic data from enrolled attendees
// and stores mappings in normalized_mappings table with person+session keys.
//
// This is a pure Go implementation that:
// 1. Loads enrolled attendees (status_id=2, is_active=1) with person+session data
// 2. Gets school/city from persons table, congregation from person_custom_values
// 3. Applies preprocessing (N/A filtering, whitespace normalization)
// 4. Applies domain-specific normalization (city state suffix removal)
// 5. Clusters similar values using fuzzy matching
// 6. Upserts to normalized_mappings with (person, session, category) keys
// 7. Updates camper_history.*_normalized columns for backwards compatibility
// 8. Deletes orphaned mappings
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
	PersonPBID   string
	PersonCMID   int
	SessionPBID  string
	SessionCMID  int
	School       string // from persons.school
	City         string // from persons.address.city
	Congregation string // from person_custom_values (HH-Name of Congregation)
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

	// Step 2: Build normalization lookup maps from all unique values
	normalizedLookup := n.buildNormalizationLookup(attendeeData)

	// Step 3: Create person+session mappings
	mappings := n.createPersonSessionMappings(attendeeData, normalizedLookup, year)

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
	if err := n.upsertPersonSessionMappings(ctx, mappings, existingMappings, year); err != nil {
		return fmt.Errorf("upserting normalized mappings: %w", err)
	}

	// Step 6: Update camper_history.*_normalized columns (backwards compatibility)
	if err := n.updateCamperHistoryNormalized(ctx, normalizedLookup, year); err != nil {
		return fmt.Errorf("updating camper history: %w", err)
	}

	// Mark sync as successful before orphan deletion
	n.SyncSuccessful = true

	// Step 7: Delete orphaned mappings
	n.deleteOrphans(existingMappings)

	// WAL checkpoint
	if n.Stats.Created > 0 || n.Stats.Updated > 0 || n.Stats.Deleted > 0 {
		if err := n.forceWALCheckpoint(); err != nil {
			slog.Warn("WAL checkpoint failed", "error", err)
		}
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

	// Load enrolled attendees (status_id=2, is_active=1)
	filter := fmt.Sprintf("year = %d && is_active = 1 && status_id = 2", year)
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
		)
		if err != nil {
			return nil, fmt.Errorf("querying attendees page %d: %w", page, err)
		}

		// Expand person and session relations
		if errs := n.App.ExpandRecords(records, []string{"person", "session"}, nil); len(errs) > 0 {
			slog.Warn("Some relation expansions failed", "page", page, "errors", errs)
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
			}

			// Extract city from address JSON field
			addressRaw := personRecord.Get("address")
			if addressRaw != nil {
				data.City = n.extractCityFromAddress(addressRaw)
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
	for _, d := range result {
		if d.City != "" {
			withCity++
		}
		if d.School != "" {
			withSchool++
		}
		if d.Congregation != "" {
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

	filter := fmt.Sprintf(`field_definition = %q && year = %d && value != ""`, fieldID, year)
	page := 1
	perPage := 500

	for {
		records, err := n.App.FindRecordsByFilter(
			"person_custom_values",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
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

// extractCityFromAddress extracts city from address JSON field
func (n *NormalizeGeographicSync) extractCityFromAddress(addressRaw any) string {
	if addressRaw == nil {
		return ""
	}

	// Handle string (JSON encoded)
	if addrStr, ok := addressRaw.(string); ok && addrStr != "" {
		var addr map[string]any
		if err := json.Unmarshal([]byte(addrStr), &addr); err == nil {
			if city, ok := addr["city"].(string); ok {
				return city
			}
		}
		return ""
	}

	// Handle map[string]any (direct map)
	if addr, ok := addressRaw.(map[string]any); ok {
		if city, cityOk := addr["city"].(string); cityOk {
			return city
		}
	}

	// Handle types.JSONRaw (PocketBase JSON field type)
	// Note: types.JSONRaw is a distinct type, not []byte, so type assertion must be exact
	if raw, ok := addressRaw.(types.JSONRaw); ok && len(raw) > 0 {
		var addr map[string]any
		if err := json.Unmarshal(raw, &addr); err == nil {
			if city, ok := addr["city"].(string); ok {
				return city
			}
		}
	}

	// Handle []byte (fallback for raw JSON bytes)
	if raw, ok := addressRaw.([]byte); ok && len(raw) > 0 {
		var addr map[string]any
		if err := json.Unmarshal(raw, &addr); err == nil {
			if city, ok := addr["city"].(string); ok {
				return city
			}
		}
	}

	return ""
}

// normalizationLookup maps original values to normalized values per category
type normalizationLookup struct {
	city         map[string]string // original → normalized
	school       map[string]string
	congregation map[string]string
}

// pythonNormalizedResult represents the JSON response from Python normalizer
type pythonNormalizedResult struct {
	Canonical  string  `json:"canonical"`
	Confidence float64 `json:"confidence"`
}

// normalizeWithPython calls the Python geo_normalizer CLI for advanced fuzzy matching
// Falls back to Go implementation if Python call fails
func (n *NormalizeGeographicSync) normalizeWithPython(values []string, category string) (map[string]string, error) {
	if len(values) == 0 {
		return make(map[string]string), nil
	}

	// Serialize values to JSON
	valuesJSON, err := json.Marshal(values)
	if err != nil {
		return nil, fmt.Errorf("marshaling values: %w", err)
	}

	// Find the project root (where pyproject.toml is)
	// The pocketbase binary runs from pocketbase/ directory, so project root is ../
	projectRoot := filepath.Join(filepath.Dir(os.Args[0]), "..")
	if _, statErr := os.Stat(filepath.Join(projectRoot, "pyproject.toml")); os.IsNotExist(statErr) {
		// Try current working directory
		cwd, _ := os.Getwd()
		projectRoot = cwd
		if _, statErr2 := os.Stat(filepath.Join(projectRoot, "pyproject.toml")); os.IsNotExist(statErr2) {
			// Try one level up
			projectRoot = filepath.Dir(cwd)
		}
	}

	// Call Python normalizer
	// #nosec G204 -- arguments are from internal sync logic, not user input
	cmd := exec.Command("uv", "run", "python", "-m", "bunking.geo_normalizer",
		"--category", category,
		"--values", string(valuesJSON))
	cmd.Dir = projectRoot

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			slog.Warn("Python normalizer failed",
				"category", category,
				"stderr", string(exitErr.Stderr),
				"error", err)
		}
		return nil, fmt.Errorf("running python normalizer: %w", err)
	}

	// Parse JSON response
	var results map[string]pythonNormalizedResult
	if err := json.Unmarshal(output, &results); err != nil {
		return nil, fmt.Errorf("parsing python normalizer output: %w", err)
	}

	// Convert to simple map
	result := make(map[string]string)
	for original, normalized := range results {
		result[original] = normalized.Canonical
	}

	return result, nil
}

// buildNormalizationLookup builds lookup maps from unique values
// Uses Python RapidFuzz for advanced fuzzy matching, with Go fallback
func (n *NormalizeGeographicSync) buildNormalizationLookup(data []attendeeGeoData) *normalizationLookup {
	// Collect unique values per category
	uniqueCities := make(map[string]bool)
	uniqueSchools := make(map[string]bool)
	uniqueCongregations := make(map[string]bool)

	for _, d := range data {
		if d.City != "" {
			uniqueCities[d.City] = true
		}
		if d.School != "" {
			uniqueSchools[d.School] = true
		}
		if d.Congregation != "" {
			uniqueCongregations[d.Congregation] = true
		}
	}

	// Debug: log unique counts before normalization
	slog.Info("Unique values collected",
		"cities", len(uniqueCities),
		"schools", len(uniqueSchools),
		"congregations", len(uniqueCongregations),
	)

	lookup := &normalizationLookup{
		city:         make(map[string]string),
		school:       make(map[string]string),
		congregation: make(map[string]string),
	}

	// Try Python normalizer first for better fuzzy matching
	// Fall back to Go implementation if Python fails
	usePython := true

	// Convert maps to slices for Python
	cityValues := mapKeysToSlice(uniqueCities)
	schoolValues := mapKeysToSlice(uniqueSchools)
	congregationValues := mapKeysToSlice(uniqueCongregations)

	if usePython && len(cityValues) > 0 {
		if result, err := n.normalizeWithPython(cityValues, categoryCity); err == nil {
			lookup.city = result
			slog.Debug("Used Python normalizer for cities", "count", len(result))
		} else {
			slog.Warn("Python normalizer failed for cities, using Go fallback", "error", err)
			lookup.city = n.normalizeAndCluster(uniqueCities, categoryCity)
		}
	} else {
		lookup.city = n.normalizeAndCluster(uniqueCities, categoryCity)
	}

	if usePython && len(schoolValues) > 0 {
		if result, err := n.normalizeWithPython(schoolValues, categorySchool); err == nil {
			lookup.school = result
			slog.Debug("Used Python normalizer for schools", "count", len(result))
		} else {
			slog.Warn("Python normalizer failed for schools, using Go fallback", "error", err)
			lookup.school = n.normalizeAndCluster(uniqueSchools, categorySchool)
		}
	} else {
		lookup.school = n.normalizeAndCluster(uniqueSchools, categorySchool)
	}

	if usePython && len(congregationValues) > 0 {
		if result, err := n.normalizeWithPython(congregationValues, categoryCongregation); err == nil {
			lookup.congregation = result
			slog.Debug("Used Python normalizer for congregations", "count", len(result))
		} else {
			slog.Warn("Python normalizer failed for congregations, using Go fallback", "error", err)
			lookup.congregation = n.normalizeAndCluster(uniqueCongregations, categoryCongregation)
		}
	} else {
		lookup.congregation = n.normalizeAndCluster(uniqueCongregations, categoryCongregation)
	}

	return lookup
}

// mapKeysToSlice converts a map[string]bool to a []string
func mapKeysToSlice(m map[string]bool) []string {
	result := make([]string, 0, len(m))
	for k := range m {
		result = append(result, k)
	}
	return result
}

// normalizeAndCluster normalizes values and clusters similar ones
func (n *NormalizeGeographicSync) normalizeAndCluster(unique map[string]bool, category string) map[string]string {
	result := make(map[string]string)

	// Preprocess each value
	preprocessed := make(map[string]string) // original → preprocessed
	for original := range unique {
		var normalized string
		switch category {
		case categoryCity:
			normalized = normalizeCityGo(original)
		case categorySchool:
			normalized = normalizeSchoolGo(original)
		case categoryCongregation:
			normalized = normalizeCongregationGo(original)
		default:
			normalized = preprocessGo(original)
		}
		if normalized != "" {
			preprocessed[original] = normalized
		}
	}

	// Sort values for deterministic clustering
	normalizedValues := make([]string, 0, len(preprocessed))
	for _, v := range preprocessed {
		normalizedValues = append(normalizedValues, v)
	}
	sort.Strings(normalizedValues)

	// Cluster similar values
	clusters := clusterSimilarValuesGo(normalizedValues, defaultFuzzyThreshold)

	// Build final lookup: original → canonical
	for original, normalized := range preprocessed {
		canonical := clusters[normalized]
		if canonical == "" {
			canonical = normalized
		}
		result[original] = canonical
	}

	return result
}

// createPersonSessionMappings creates mappings for each person+session
func (n *NormalizeGeographicSync) createPersonSessionMappings(
	data []attendeeGeoData,
	lookup *normalizationLookup,
	year int,
) []*personSessionMapping {
	var mappings []*personSessionMapping

	for _, d := range data {
		// School mapping
		if d.School != "" {
			if normalized, ok := lookup.school[d.School]; ok && normalized != "" {
				mappings = append(mappings, &personSessionMapping{
					personPBID:      d.PersonPBID,
					sessionPBID:     d.SessionPBID,
					category:        categorySchool,
					originalValue:   d.School,
					normalizedValue: normalized,
					confidence:      n.computeConfidence(d.School, normalized),
					year:            year,
				})
			}
		}

		// City mapping
		if d.City != "" {
			if normalized, ok := lookup.city[d.City]; ok && normalized != "" {
				mappings = append(mappings, &personSessionMapping{
					personPBID:      d.PersonPBID,
					sessionPBID:     d.SessionPBID,
					category:        categoryCity,
					originalValue:   d.City,
					normalizedValue: normalized,
					confidence:      n.computeConfidence(d.City, normalized),
					year:            year,
				})
			}
		}

		// Congregation mapping
		if d.Congregation != "" {
			if normalized, ok := lookup.congregation[d.Congregation]; ok && normalized != "" {
				mappings = append(mappings, &personSessionMapping{
					personPBID:      d.PersonPBID,
					sessionPBID:     d.SessionPBID,
					category:        categoryCongregation,
					originalValue:   d.Congregation,
					normalizedValue: normalized,
					confidence:      n.computeConfidence(d.Congregation, normalized),
					year:            year,
				})
			}
		}
	}

	return mappings
}

// computeConfidence returns confidence score based on how much the value changed
func (n *NormalizeGeographicSync) computeConfidence(original, normalized string) float64 {
	if strings.EqualFold(original, normalized) {
		return 1.0
	}
	// Fuzzy match has lower confidence
	return 0.9
}

// preloadExistingMappings loads all existing normalized_mappings for the year
func (n *NormalizeGeographicSync) preloadExistingMappings(year int) (map[string]*core.Record, error) {
	existingRecords := make(map[string]*core.Record)

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		records, err := n.App.FindRecordsByFilter(
			"normalized_mappings",
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
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

// upsertPersonSessionMappings upserts mappings with person+session keys
func (n *NormalizeGeographicSync) upsertPersonSessionMappings(
	ctx context.Context,
	mappings []*personSessionMapping,
	existingMappings map[string]*core.Record,
	year int,
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
	if existing.GetString("normalized_value") != newData["normalized_value"].(string) {
		return true
	}
	// Compare original_value
	if existing.GetString("original_value") != newData["original_value"].(string) {
		return true
	}
	// Compare confidence with epsilon for float precision
	const epsilon = 0.0001
	existingConf := 0.0
	if c, ok := existing.Get("confidence").(float64); ok {
		existingConf = c
	}
	newConf := newData["confidence"].(float64)
	return math.Abs(existingConf-newConf) > epsilon
}

// updateCamperHistoryNormalized updates the *_normalized columns in camper_history
func (n *NormalizeGeographicSync) updateCamperHistoryNormalized(
	ctx context.Context,
	lookup *normalizationLookup,
	year int,
) error {
	// Update camper_history records
	filter := fmt.Sprintf("year = %d", year)
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
		)
		if err != nil {
			return fmt.Errorf("querying camper_history page %d: %w", page, err)
		}

		for _, record := range records {
			needsUpdate := false

			// City
			if city := record.GetString("city"); city != "" {
				if normalized, ok := lookup.city[city]; ok {
					if record.GetString("city_normalized") != normalized {
						record.Set("city_normalized", normalized)
						needsUpdate = true
					}
				}
			}

			// School
			if school := record.GetString("school"); school != "" {
				if normalized, ok := lookup.school[school]; ok {
					if record.GetString("school_normalized") != normalized {
						record.Set("school_normalized", normalized)
						needsUpdate = true
					}
				}
			}

			// Congregation (synagogue field in camper_history)
			if synagogue := record.GetString("synagogue"); synagogue != "" {
				if normalized, ok := lookup.congregation[synagogue]; ok {
					if record.GetString("congregation_normalized") != normalized {
						record.Set("congregation_normalized", normalized)
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

// deleteOrphans removes mappings that weren't processed (no longer in source data)
func (n *NormalizeGeographicSync) deleteOrphans(existingMappings map[string]*core.Record) int {
	if !n.SyncSuccessful {
		slog.Info("Skipping orphan deletion due to sync failure")
		return 0
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
		n.Stats.Deleted = orphanCount
		slog.Info("Deleted orphaned normalized_mappings", "count", orphanCount)
	}

	return orphanCount
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

// ============================================================================
// Normalization Helper Functions (Go implementations)
// ============================================================================

// N/A pattern - matches common "not applicable" representations
var naPatternGo = regexp.MustCompile(`(?i)^(n/?a|none|null|na|-+|\.+|\s*)$`)

// State suffix pattern - matches ", CA", ", CA 94102", ", CA 94102-1234"
var stateSuffixPatternGo = regexp.MustCompile(`(?i),\s*[A-Z]{2}(\s+\d{5}(-\d{4})?)?$`)

// preprocessGo performs basic preprocessing of input values
func preprocessGo(value string) string {
	if value == "" {
		return ""
	}

	// Trim whitespace
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	// Check for N/A patterns
	if naPatternGo.MatchString(value) {
		return ""
	}

	// Normalize internal whitespace (collapse multiple spaces/tabs to single space)
	parts := strings.Fields(value)
	return strings.Join(parts, " ")
}

// normalizeCityGo normalizes city names
func normalizeCityGo(city string) string {
	city = preprocessGo(city)
	if city == "" {
		return ""
	}

	// Remove state suffix (", CA", ", CA 94102", etc.)
	city = stateSuffixPatternGo.ReplaceAllString(city, "")

	// Standardize to title case
	city = strings.TrimSpace(city)
	caser := cases.Title(language.English)
	city = caser.String(strings.ToLower(city))

	return city
}

// normalizeSchoolGo normalizes school names
func normalizeSchoolGo(school string) string {
	school = preprocessGo(school)
	if school == "" {
		return ""
	}

	// For schools, just normalize whitespace - preserve original case
	return school
}

// normalizeCongregationGo normalizes congregation/synagogue names
func normalizeCongregationGo(congregation string) string {
	congregation = preprocessGo(congregation)
	if congregation == "" {
		return ""
	}

	// For congregations, just normalize whitespace - preserve original case
	return congregation
}

// clusterSimilarValuesGo clusters similar values using simple string similarity
// In production, this could use a more sophisticated fuzzy matching library
func clusterSimilarValuesGo(values []string, threshold int) map[string]string {
	if len(values) == 0 {
		return map[string]string{}
	}

	// Deduplicate while preserving order
	seen := make(map[string]bool)
	unique := []string{}
	for _, v := range values {
		if v != "" && !seen[v] {
			seen[v] = true
			unique = append(unique, v)
		}
	}

	if len(unique) == 0 {
		return map[string]string{}
	}

	// Build clusters: first value encountered becomes canonical
	result := make(map[string]string)
	clusters := make(map[string][]string) // canonical → members

	for _, v := range unique {
		// Find best matching cluster
		bestMatch := ""
		bestScore := 0

		for canonical := range clusters {
			score := stringSimilarityGo(v, canonical)
			if score >= threshold && score > bestScore {
				bestMatch = canonical
				bestScore = score
			}
		}

		if bestMatch != "" {
			// Add to existing cluster
			clusters[bestMatch] = append(clusters[bestMatch], v)
			result[v] = bestMatch
		} else {
			// Create new cluster
			clusters[v] = []string{v}
			result[v] = v
		}
	}

	return result
}

// stringSimilarityGo returns a simple similarity score (0-100)
// Uses a basic Levenshtein-inspired approach
func stringSimilarityGo(a, b string) int {
	if a == b {
		return 100
	}

	lowerA := strings.ToLower(a)
	lowerB := strings.ToLower(b)

	if lowerA == lowerB {
		return 95 // Case difference only
	}

	// Check if one contains the other (common with typos)
	if strings.Contains(lowerA, lowerB) || strings.Contains(lowerB, lowerA) {
		shorter := min(len(lowerA), len(lowerB))
		longer := max(len(lowerA), len(lowerB))
		return (shorter * 100) / longer
	}

	// Simple edit distance ratio
	maxLen := max(len(lowerA), len(lowerB))

	if maxLen == 0 {
		return 100
	}

	// Count matching characters at same positions
	minLen := min(len(lowerA), len(lowerB))

	matches := 0
	for i := 0; i < minLen; i++ {
		if lowerA[i] == lowerB[i] {
			matches++
		}
	}

	// Score based on match ratio
	return (matches * 100) / maxLen
}
