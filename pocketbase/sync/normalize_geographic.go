package sync

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strconv"
	"strings"

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

// Fuzzy matching threshold (0-100)
const defaultFuzzyThreshold = 90

// NormalizeGeographicSync normalizes geographic data in camper_history
// and stores mappings in normalized_mappings table.
//
// This is a pure Go implementation that:
// 1. Loads unique city/school/congregation values from camper_history
// 2. Applies preprocessing (N/A filtering, whitespace normalization)
// 3. Applies domain-specific normalization (city state suffix removal)
// 4. Clusters similar values using fuzzy matching
// 5. Upserts to normalized_mappings table
// 6. Updates camper_history.*_normalized columns
// 7. Deletes orphaned mappings
type NormalizeGeographicSync struct {
	App            core.App
	Year           int
	DryRun         bool
	Debug          bool
	Stats          Stats
	SyncSuccessful bool
	ProcessedKeys  map[string]bool // Track processed keys for orphan detection
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

	// Step 1: Load unique values from camper_history
	uniqueValues, err := n.loadUniqueValues(ctx, year)
	if err != nil {
		return fmt.Errorf("loading unique values: %w", err)
	}

	if len(uniqueValues[categoryCity]) == 0 &&
		len(uniqueValues[categorySchool]) == 0 &&
		len(uniqueValues[categoryCongregation]) == 0 {
		slog.Info("No geographic data found for year", "year", year)
		n.SyncSuccessful = true
		return nil
	}

	slog.Info("Loaded unique geographic values",
		"cities", len(uniqueValues[categoryCity]),
		"schools", len(uniqueValues[categorySchool]),
		"congregations", len(uniqueValues[categoryCongregation]),
	)

	// Step 2: Preprocess and normalize values
	normalizedMappings := n.computeNormalizedMappings(uniqueValues)

	slog.Info("Computed normalized mappings",
		"city_mappings", len(normalizedMappings[categoryCity]),
		"school_mappings", len(normalizedMappings[categorySchool]),
		"congregation_mappings", len(normalizedMappings[categoryCongregation]),
	)

	if n.DryRun {
		slog.Info("Dry run mode - computed but not writing")
		n.SyncSuccessful = true
		return nil
	}

	// Step 3: Preload existing mappings for upsert
	existingMappings, err := n.preloadExistingMappings(year)
	if err != nil {
		return fmt.Errorf("preloading existing mappings: %w", err)
	}

	// Step 4: Upsert normalized_mappings
	if err := n.upsertNormalizedMappings(ctx, normalizedMappings, existingMappings, year); err != nil {
		return fmt.Errorf("upserting normalized mappings: %w", err)
	}

	// Step 5: Update camper_history.*_normalized columns
	if err := n.updateCamperHistoryNormalized(ctx, normalizedMappings, year); err != nil {
		return fmt.Errorf("updating camper history: %w", err)
	}

	// Mark sync as successful before orphan deletion
	n.SyncSuccessful = true

	// Step 6: Delete orphaned mappings
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

// normalizedMapping holds a computed mapping from original to normalized value
type normalizedMapping struct {
	category        string
	originalValue   string
	normalizedValue string
	occurrenceCount int
	confidence      float64
}

// loadUniqueValues loads unique city/school/congregation values from camper_history
func (n *NormalizeGeographicSync) loadUniqueValues(ctx context.Context, year int) (map[string]map[string]int, error) {
	result := map[string]map[string]int{
		categoryCity:         make(map[string]int),
		categorySchool:       make(map[string]int),
		categoryCongregation: make(map[string]int),
	}

	filter := fmt.Sprintf("year = %d", year)
	page := 1
	perPage := 500

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
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
			return nil, fmt.Errorf("querying camper_history page %d: %w", page, err)
		}

		for _, record := range records {
			// City
			if city := record.GetString("city"); city != "" {
				result[categoryCity][city]++
			}
			// School
			if school := record.GetString("school"); school != "" {
				result[categorySchool][school]++
			}
			// Synagogue/congregation
			if synagogue := record.GetString("synagogue"); synagogue != "" {
				result[categoryCongregation][synagogue]++
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return result, nil
}

// computeNormalizedMappings applies normalization and clustering to unique values
func (n *NormalizeGeographicSync) computeNormalizedMappings(uniqueValues map[string]map[string]int) map[string][]*normalizedMapping {
	result := map[string][]*normalizedMapping{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	for category, values := range uniqueValues {
		// Step 1: Preprocess and normalize each value
		preprocessed := make(map[string]string) // original → preprocessed
		for original := range values {
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

		// Step 2: Cluster similar normalized values
		normalizedValues := make([]string, 0, len(preprocessed))
		for _, v := range preprocessed {
			normalizedValues = append(normalizedValues, v)
		}

		clusters := clusterSimilarValuesGo(normalizedValues, defaultFuzzyThreshold)

		// Step 3: Build mappings
		for original, normalized := range preprocessed {
			canonical := clusters[normalized]
			if canonical == "" {
				canonical = normalized
			}

			confidence := 1.0
			if canonical != normalized {
				confidence = 0.9 // Fuzzy match
			}

			result[category] = append(result[category], &normalizedMapping{
				category:        category,
				originalValue:   original,
				normalizedValue: canonical,
				occurrenceCount: values[original],
				confidence:      confidence,
			})
		}
	}

	return result
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
			category := record.GetString("category")
			originalValue := record.GetString("original_value")
			key := fmt.Sprintf("%s:%s:%d", category, originalValue, year)
			existingRecords[key] = record
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	slog.Info("Loaded existing normalized_mappings", "count", len(existingRecords), "year", year)
	return existingRecords, nil
}

// upsertNormalizedMappings upserts the computed mappings to normalized_mappings table
func (n *NormalizeGeographicSync) upsertNormalizedMappings(
	ctx context.Context,
	normalizedMappings map[string][]*normalizedMapping,
	existingMappings map[string]*core.Record,
	year int,
) error {
	col, err := n.App.FindCollectionByNameOrId("normalized_mappings")
	if err != nil {
		return fmt.Errorf("finding normalized_mappings collection: %w", err)
	}

	for category, mappings := range normalizedMappings {
		for _, mapping := range mappings {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			key := fmt.Sprintf("%s:%s:%d", category, mapping.originalValue, year)
			n.ProcessedKeys[key] = true

			// Build record data
			recordData := map[string]interface{}{
				"category":         mapping.category,
				"original_value":   mapping.originalValue,
				"normalized_value": mapping.normalizedValue,
				"occurrence_count": mapping.occurrenceCount,
				"confidence":       mapping.confidence,
				"year":             year,
			}

			existing := existingMappings[key]
			if existing != nil {
				// Check if update needed
				if n.mappingNeedsUpdate(existing, recordData) {
					for field, value := range recordData {
						existing.Set(field, value)
					}
					if err := n.App.Save(existing); err != nil {
						slog.Error("Error updating normalized mapping",
							"category", category,
							"original", mapping.originalValue,
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
						"category", category,
						"original", mapping.originalValue,
						"error", err)
					n.Stats.Errors++
					continue
				}
				n.Stats.Created++
			}
		}
	}

	return nil
}

// mappingNeedsUpdate checks if a mapping record needs updating
func (n *NormalizeGeographicSync) mappingNeedsUpdate(existing *core.Record, newData map[string]interface{}) bool {
	// Compare normalized_value
	if existing.GetString("normalized_value") != newData["normalized_value"].(string) {
		return true
	}
	// Compare occurrence_count
	existingCount := 0
	if c, ok := existing.Get("occurrence_count").(float64); ok {
		existingCount = int(c)
	}
	if existingCount != newData["occurrence_count"].(int) {
		return true
	}
	// Compare confidence
	existingConf := 0.0
	if c, ok := existing.Get("confidence").(float64); ok {
		existingConf = c
	}
	if existingConf != newData["confidence"].(float64) {
		return true
	}
	return false
}

// updateCamperHistoryNormalized updates the *_normalized columns in camper_history
func (n *NormalizeGeographicSync) updateCamperHistoryNormalized(
	ctx context.Context,
	normalizedMappings map[string][]*normalizedMapping,
	year int,
) error {
	// Build lookup maps: original → normalized
	cityMap := make(map[string]string)
	schoolMap := make(map[string]string)
	congregationMap := make(map[string]string)

	for _, m := range normalizedMappings[categoryCity] {
		cityMap[m.originalValue] = m.normalizedValue
	}
	for _, m := range normalizedMappings[categorySchool] {
		schoolMap[m.originalValue] = m.normalizedValue
	}
	for _, m := range normalizedMappings[categoryCongregation] {
		congregationMap[m.originalValue] = m.normalizedValue
	}

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
				if normalized, ok := cityMap[city]; ok {
					if record.GetString("city_normalized") != normalized {
						record.Set("city_normalized", normalized)
						needsUpdate = true
					}
				}
			}

			// School
			if school := record.GetString("school"); school != "" {
				if normalized, ok := schoolMap[school]; ok {
					if record.GetString("school_normalized") != normalized {
						record.Set("school_normalized", normalized)
						needsUpdate = true
					}
				}
			}

			// Congregation
			if synagogue := record.GetString("synagogue"); synagogue != "" {
				if normalized, ok := congregationMap[synagogue]; ok {
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
		originalValue := record.GetString("original_value")
		slog.Info("Deleting orphaned normalized mapping",
			"category", category,
			"original_value", originalValue)

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
	city = strings.Title(strings.ToLower(city))

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
		shorter := len(lowerA)
		if len(lowerB) < shorter {
			shorter = len(lowerB)
		}
		longer := len(lowerA)
		if len(lowerB) > longer {
			longer = len(lowerB)
		}
		return (shorter * 100) / longer
	}

	// Simple edit distance ratio
	maxLen := len(lowerA)
	if len(lowerB) > maxLen {
		maxLen = len(lowerB)
	}

	if maxLen == 0 {
		return 100
	}

	// Count matching characters at same positions
	minLen := len(lowerA)
	if len(lowerB) < minLen {
		minLen = len(lowerB)
	}

	matches := 0
	for i := 0; i < minLen; i++ {
		if lowerA[i] == lowerB[i] {
			matches++
		}
	}

	// Score based on match ratio
	return (matches * 100) / maxLen
}
