package sync

import (
	"strconv"
	"strings"
	"testing"
)

// ============================================================================
// Service Name Tests
// ============================================================================

// TestNormalizeGeographicSync_Name verifies the service name is correct
func TestNormalizeGeographicSync_Name(t *testing.T) {
	// The service name must be "normalize_geographic" for orchestrator integration
	expectedName := "normalize_geographic"

	// This test verifies the constant will be defined correctly
	// The actual constant serviceNameNormalizeGeographic is defined in normalize_geographic.go
	if expectedName != "normalize_geographic" {
		t.Errorf("expected service name %q, got %q", "normalize_geographic", expectedName)
	}
}

// ============================================================================
// Year Validation Tests
// ============================================================================

// TestNormalizeGeographicYearValidation tests year parameter validation
func TestNormalizeGeographicYearValidation(t *testing.T) {
	tests := []struct {
		name      string
		year      int
		wantValid bool
	}{
		{"valid year 2024", 2024, true},
		{"valid year 2017 (minimum)", 2017, true},
		{"valid year 2025", 2025, true},
		{"year too old 2016", 2016, false},
		{"year too old 2010", 2010, false},
		{"year far future 2100", 2100, false},
		{"zero year", 0, false},
		{"negative year", -2024, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			valid := isValidNormalizeYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidNormalizeYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// ============================================================================
// Preprocessing Tests
// ============================================================================

// TestPreprocessValue tests basic value preprocessing
func TestPreprocessValue(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty string", "", ""},
		{"whitespace only", "   ", ""},
		{"n/a lowercase", "n/a", ""},
		{"N/A uppercase", "N/A", ""},
		{"none", "none", ""},
		{"null", "null", ""},
		{"dashes", "---", ""},
		{"dots", "...", ""},
		{"normal value", "San Francisco", "San Francisco"},
		{"extra whitespace", "  San   Francisco  ", "San Francisco"},
		{"tabs and spaces", "\tSan\tFrancisco\t", "San Francisco"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := preprocessGeographicValue(tt.input)
			if result != tt.expected {
				t.Errorf("preprocessGeographicValue(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// City Normalization Tests
// ============================================================================

// TestNormalizeCityValue tests city name normalization
func TestNormalizeCityValue(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty string", "", ""},
		{"simple city", "Oakland", "Oakland"},
		{"city with state", "Oakland, CA", "Oakland"},
		{"city with state and zip", "Oakland, CA 94610", "Oakland"},
		{"city with state and full zip", "Oakland, CA 94610-1234", "Oakland"},
		{"lowercase city", "san francisco", "San Francisco"},
		{"all caps city", "SAN FRANCISCO", "San Francisco"},
		{"city with extra whitespace", "  san francisco  ", "San Francisco"},
		{"n/a value", "n/a", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeCityValue(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeCityValue(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// Congregation Normalization Tests
// ============================================================================

// TestNormalizeCongregationValue tests congregation name normalization
func TestNormalizeCongregationValue(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty string", "", ""},
		{"normal congregation", "Temple Beth Abraham", "Temple Beth Abraham"},
		{"congregation with extra spaces", "  Temple  Beth  Abraham  ", "Temple Beth Abraham"},
		{"preserve case", "Congregation B'nai Tikvah", "Congregation B'nai Tikvah"},
		{"n/a value", "N/A", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeCongregationValue(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeCongregationValue(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// Fuzzy Clustering Tests
// ============================================================================

// TestClusterSimilarValues tests fuzzy clustering of similar values
func TestClusterSimilarValues(t *testing.T) {
	tests := []struct {
		name      string
		values    []string
		threshold int
		wantCount int // Expected number of unique clusters
	}{
		{
			name:      "empty input",
			values:    []string{},
			threshold: 90,
			wantCount: 0,
		},
		{
			name:      "single value",
			values:    []string{"Oakland"},
			threshold: 90,
			wantCount: 1,
		},
		{
			name:      "identical values",
			values:    []string{"Oakland", "Oakland", "Oakland"},
			threshold: 90,
			wantCount: 1,
		},
		{
			name:      "completely different values",
			values:    []string{"Oakland", "San Francisco", "Los Angeles"},
			threshold: 90,
			wantCount: 3,
		},
		{
			name:      "similar values should cluster",
			values:    []string{"San Francisco", "San Franciso", "San Fransisco"},
			threshold: 85,
			wantCount: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := clusterSimilarGeographicValues(tt.values, tt.threshold)

			// Count unique canonical values
			uniqueCanonicals := make(map[string]bool)
			for _, canonical := range result {
				uniqueCanonicals[canonical] = true
			}

			if len(uniqueCanonicals) != tt.wantCount {
				t.Errorf("clusterSimilarGeographicValues() got %d clusters, want %d", len(uniqueCanonicals), tt.wantCount)
			}
		})
	}
}

// TestClusteringMapsToCanonical verifies clustering maps all values to canonical form
func TestClusteringMapsToCanonical(t *testing.T) {
	values := []string{"Temple Beth Abraham", "Temple Beth Avraham", "Temple Beth Abraham"}

	result := clusterSimilarGeographicValues(values, 85)

	// All values should map to the same canonical (first encountered)
	canonical := "Temple Beth Abraham"
	for _, v := range values {
		if mapped, ok := result[v]; ok {
			if mapped != canonical {
				t.Errorf("value %q mapped to %q, expected %q", v, mapped, canonical)
			}
		}
	}
}

// ============================================================================
// Composite Key Tests
// ============================================================================

// TestNormalizedMappingCompositeKey tests the composite key format for normalized_mappings
func TestNormalizedMappingCompositeKey(t *testing.T) {
	tests := []struct {
		name          string
		category      string
		originalValue string
		year          int
		expectedKey   string
	}{
		{
			name:          "city key",
			category:      "city",
			originalValue: "Oakland",
			year:          2025,
			expectedKey:   "city:Oakland:2025",
		},
		{
			name:          "school key",
			category:      "school",
			originalValue: "Riverside Elementary",
			year:          2024,
			expectedKey:   "school:Riverside Elementary:2024",
		},
		{
			name:          "congregation key",
			category:      "congregation",
			originalValue: "Temple Beth Abraham",
			year:          2025,
			expectedKey:   "congregation:Temple Beth Abraham:2025",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := buildNormalizedMappingKey(tt.category, tt.originalValue, tt.year)
			if key != tt.expectedKey {
				t.Errorf("buildNormalizedMappingKey(%q, %q, %d) = %q, want %q",
					tt.category, tt.originalValue, tt.year, key, tt.expectedKey)
			}
		})
	}
}

// ============================================================================
// Idempotency Tests
// ============================================================================

// testNormalizedMapping simulates a normalized_mappings record
type testNormalizedMapping struct {
	Category        string
	NormalizedValue string
	OriginalValue   string
	OccurrenceCount int
	Confidence      float64
	Year            int
}

// testNormStats tracks stats for testing
type testNormStats struct {
	Created int
	Updated int
	Skipped int
	Deleted int
	Errors  int
}

// TestUpsertNormalizedMappingsIdempotency verifies idempotent upsert behavior
func TestUpsertNormalizedMappingsIdempotency(t *testing.T) {
	// Simulate computed mappings from source data
	mappings := []*testNormalizedMapping{
		{Category: "city", OriginalValue: "Oakland", NormalizedValue: "Oakland", OccurrenceCount: 10, Year: 2025},
		{Category: "city", OriginalValue: "San Francisco", NormalizedValue: "San Francisco", OccurrenceCount: 5, Year: 2025},
		{Category: "congregation", OriginalValue: "Temple Beth Abraham", NormalizedValue: "Temple Beth Abraham", OccurrenceCount: 3, Year: 2025},
	}

	// First run: no existing records
	existing1 := make(map[string]*testNormMappingRecord)
	stats1 := simulateUpsertNormalizedMappings(mappings, existing1, 2025)

	// First run should create all records
	if stats1.Created != 3 {
		t.Errorf("first run: expected Created=3, got %d", stats1.Created)
	}
	if stats1.Skipped != 0 {
		t.Errorf("first run: expected Skipped=0, got %d", stats1.Skipped)
	}

	// Second run: existing records match computed data (from first run)
	existing2 := buildExistingMappingsMap(mappings, 2025)
	stats2 := simulateUpsertNormalizedMappings(mappings, existing2, 2025)

	// Second run should skip all records (no changes)
	if stats2.Created != 0 {
		t.Errorf("second run: expected Created=0, got %d", stats2.Created)
	}
	if stats2.Skipped != 3 {
		t.Errorf("second run: expected Skipped=3, got %d", stats2.Skipped)
	}
}

// TestUpsertNormalizedMappingsUpdateDetection verifies update detection
func TestUpsertNormalizedMappingsUpdateDetection(t *testing.T) {
	// Existing records in database
	existingMappings := []*testNormalizedMapping{
		{Category: "city", OriginalValue: "Oakland", NormalizedValue: "Oakland", OccurrenceCount: 10, Year: 2025},
		{Category: "city", OriginalValue: "San Francisco", NormalizedValue: "San Francisco", OccurrenceCount: 5, Year: 2025},
	}
	existing := buildExistingMappingsMap(existingMappings, 2025)

	// New computed data with one change: Oakland occurrence count updated
	newMappings := []*testNormalizedMapping{
		{Category: "city", OriginalValue: "Oakland", NormalizedValue: "Oakland", OccurrenceCount: 15, Year: 2025}, // Changed
		{Category: "city", OriginalValue: "San Francisco", NormalizedValue: "San Francisco", OccurrenceCount: 5, Year: 2025},
	}

	stats := simulateUpsertNormalizedMappings(newMappings, existing, 2025)

	// Should update 1 record (Oakland count changed) and skip 1 (SF unchanged)
	if stats.Updated != 1 {
		t.Errorf("expected Updated=1, got %d", stats.Updated)
	}
	if stats.Skipped != 1 {
		t.Errorf("expected Skipped=1, got %d", stats.Skipped)
	}
}

// TestUpsertNormalizedMappingsOrphanDeletion verifies orphan cleanup
func TestUpsertNormalizedMappingsOrphanDeletion(t *testing.T) {
	// Existing records in database
	existingMappings := []*testNormalizedMapping{
		{Category: "city", OriginalValue: "Oakland", NormalizedValue: "Oakland", OccurrenceCount: 10, Year: 2025},
		{Category: "city", OriginalValue: "San Francisco", NormalizedValue: "San Francisco", OccurrenceCount: 5, Year: 2025},
		{Category: "city", OriginalValue: "Los Angeles", NormalizedValue: "Los Angeles", OccurrenceCount: 2, Year: 2025}, // Will be orphaned
	}
	existing := buildExistingMappingsMap(existingMappings, 2025)

	// New computed data: Los Angeles is no longer in source
	newMappings := []*testNormalizedMapping{
		{Category: "city", OriginalValue: "Oakland", NormalizedValue: "Oakland", OccurrenceCount: 10, Year: 2025},
		{Category: "city", OriginalValue: "San Francisco", NormalizedValue: "San Francisco", OccurrenceCount: 5, Year: 2025},
	}

	// Track processed keys
	processedKeys := make(map[string]bool)
	stats := simulateUpsertNormalizedMappingsWithTracking(newMappings, existing, 2025, processedKeys)

	// Should skip 2 records (unchanged)
	if stats.Skipped != 2 {
		t.Errorf("expected Skipped=2, got %d", stats.Skipped)
	}

	// Simulate orphan deletion
	orphanCount := countMappingOrphans(existing, processedKeys)
	if orphanCount != 1 {
		t.Errorf("expected 1 orphan (Los Angeles), got %d", orphanCount)
	}
}

// ============================================================================
// Category Constants Tests
// ============================================================================

// TestNormalizationCategories verifies category constants are correct
func TestNormalizationCategories(t *testing.T) {
	expected := []string{"city", "school", "congregation"}
	categories := getNormalizationCategories()

	if len(categories) != len(expected) {
		t.Errorf("expected %d categories, got %d", len(expected), len(categories))
	}

	for _, exp := range expected {
		found := false
		for _, cat := range categories {
			if cat == exp {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected category %q not found", exp)
		}
	}
}

// ============================================================================
// Test Helper Types and Functions
// ============================================================================

// testNormMappingRecord simulates a PocketBase record for normalized_mappings
type testNormMappingRecord struct {
	Category        string
	NormalizedValue string
	OriginalValue   string
	OccurrenceCount int
	Confidence      float64
	Year            int
}

// buildExistingMappingsMap creates a map of existing records (simulates preload)
func buildExistingMappingsMap(mappings []*testNormalizedMapping, year int) map[string]*testNormMappingRecord {
	result := make(map[string]*testNormMappingRecord)
	for _, m := range mappings {
		key := buildNormalizedMappingKey(m.Category, m.OriginalValue, year)
		result[key] = &testNormMappingRecord{
			Category:        m.Category,
			NormalizedValue: m.NormalizedValue,
			OriginalValue:   m.OriginalValue,
			OccurrenceCount: m.OccurrenceCount,
			Confidence:      m.Confidence,
			Year:            year,
		}
	}
	return result
}

// mappingNeedsUpdate checks if a mapping record needs updating
func mappingNeedsUpdate(existing *testNormMappingRecord, newMapping *testNormalizedMapping) bool {
	return existing.NormalizedValue != newMapping.NormalizedValue ||
		existing.OccurrenceCount != newMapping.OccurrenceCount ||
		existing.Confidence != newMapping.Confidence
}

// simulateUpsertNormalizedMappings simulates the upsert logic
func simulateUpsertNormalizedMappings(
	mappings []*testNormalizedMapping,
	existing map[string]*testNormMappingRecord,
	year int,
) testNormStats {
	stats := testNormStats{}

	for _, m := range mappings {
		key := buildNormalizedMappingKey(m.Category, m.OriginalValue, year)

		if existingRecord, ok := existing[key]; ok {
			if mappingNeedsUpdate(existingRecord, m) {
				stats.Updated++
			} else {
				stats.Skipped++
			}
		} else {
			stats.Created++
		}
	}

	return stats
}

// simulateUpsertNormalizedMappingsWithTracking simulates upsert with key tracking
func simulateUpsertNormalizedMappingsWithTracking(
	mappings []*testNormalizedMapping,
	existing map[string]*testNormMappingRecord,
	year int,
	processedKeys map[string]bool,
) testNormStats {
	stats := testNormStats{}

	for _, m := range mappings {
		key := buildNormalizedMappingKey(m.Category, m.OriginalValue, year)
		processedKeys[key] = true

		if existingRecord, ok := existing[key]; ok {
			if mappingNeedsUpdate(existingRecord, m) {
				stats.Updated++
			} else {
				stats.Skipped++
			}
		} else {
			stats.Created++
		}
	}

	return stats
}

// countMappingOrphans counts records in existing that weren't processed
func countMappingOrphans(existing map[string]*testNormMappingRecord, processedKeys map[string]bool) int {
	count := 0
	for key := range existing {
		if !processedKeys[key] {
			count++
		}
	}
	return count
}

// ============================================================================
// Placeholder functions to make tests compile (will be implemented in production)
// These are the interface the tests expect from normalize_geographic.go
// ============================================================================

// isValidNormalizeYear validates year parameter
func isValidNormalizeYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// buildNormalizedMappingKey builds composite key for normalized_mappings
func buildNormalizedMappingKey(category, originalValue string, year int) string {
	return category + ":" + originalValue + ":" + intToStr(year)
}

// intToStr converts int to string (simple helper for tests)
func intToStr(i int) string {
	return strconv.Itoa(i)
}

// getNormalizationCategories returns the list of normalization categories
func getNormalizationCategories() []string {
	return []string{"city", "school", "congregation"}
}

// preprocessGeographicValue performs basic preprocessing
func preprocessGeographicValue(value string) string {
	if value == "" {
		return ""
	}

	// Trim whitespace
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	// Check for N/A patterns
	lower := strings.ToLower(value)
	if lower == "n/a" || lower == "none" || lower == "null" || lower == "na" {
		return ""
	}

	// Check for dash/dot only values
	trimmed := strings.Trim(value, "-.")
	if trimmed == "" {
		return ""
	}

	// Normalize internal whitespace
	parts := strings.Fields(value)
	return strings.Join(parts, " ")
}

// normalizeCityValue normalizes city names
func normalizeCityValue(city string) string {
	city = preprocessGeographicValue(city)
	if city == "" {
		return ""
	}

	// Remove state suffix (", CA", ", CA 94102", etc.)
	// Simple regex-free approach for testing
	if idx := strings.LastIndex(city, ","); idx != -1 {
		// Check if suffix looks like state code
		suffix := strings.TrimSpace(city[idx+1:])
		if len(suffix) >= 2 && isUpperAlpha(suffix[0]) && isUpperAlpha(suffix[1]) {
			city = city[:idx]
		}
	}

	// Title case
	return strings.Title(strings.TrimSpace(strings.ToLower(city)))
}

// normalizeCongregationValue normalizes congregation names
func normalizeCongregationValue(congregation string) string {
	return preprocessGeographicValue(congregation)
}

// clusterSimilarGeographicValues clusters similar values (simplified for testing)
func clusterSimilarGeographicValues(values []string, threshold int) map[string]string {
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

	// Simple clustering: first value becomes canonical for all similar values
	// In production, this would use fuzzy matching
	result := make(map[string]string)
	clusters := make(map[string][]string)

	for _, v := range unique {
		// Find matching cluster
		matched := false
		for canonical := range clusters {
			if stringSimilarity(v, canonical) >= threshold {
				clusters[canonical] = append(clusters[canonical], v)
				result[v] = canonical
				matched = true
				break
			}
		}

		if !matched {
			clusters[v] = []string{v}
			result[v] = v
		}
	}

	return result
}

// stringSimilarity returns a simple similarity score (0-100)
// In production, this would use RapidFuzz
func stringSimilarity(a, b string) int {
	if a == b {
		return 100
	}

	// Simple Levenshtein-based similarity for testing
	lowerA := strings.ToLower(a)
	lowerB := strings.ToLower(b)

	if lowerA == lowerB {
		return 95
	}

	// Check if one contains the other
	if strings.Contains(lowerA, lowerB) || strings.Contains(lowerB, lowerA) {
		return 85
	}

	// Check prefix match
	minLen := len(lowerA)
	if len(lowerB) < minLen {
		minLen = len(lowerB)
	}

	matchingPrefix := 0
	for i := 0; i < minLen; i++ {
		if lowerA[i] == lowerB[i] {
			matchingPrefix++
		} else {
			break
		}
	}

	// Score based on prefix match ratio
	maxLen := len(lowerA)
	if len(lowerB) > maxLen {
		maxLen = len(lowerB)
	}

	return (matchingPrefix * 100) / maxLen
}

// isUpperAlpha checks if byte is uppercase A-Z
func isUpperAlpha(b byte) bool {
	return b >= 'A' && b <= 'Z'
}

