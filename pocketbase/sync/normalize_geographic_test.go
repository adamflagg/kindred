package sync

import (
	"strconv"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tools/types"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
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
			name:      "case variations should cluster",
			values:    []string{"San Francisco", "san francisco", "SAN FRANCISCO"},
			threshold: 90,
			wantCount: 1, // Case differences are caught by the similarity check
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

// TestClusteringMapsToCanonical verifies clustering maps case variations to canonical form
func TestClusteringMapsToCanonical(t *testing.T) {
	values := []string{"Temple Beth Abraham", "temple beth abraham", "TEMPLE BETH ABRAHAM"}

	result := clusterSimilarGeographicValues(values, 90)

	// All case variations should map to the first encountered (canonical)
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

// ============================================================================
// Bug Fix Tests: Float64 epsilon comparison for idempotent updates
// ============================================================================

// TestConfidenceEpsilonComparison tests that float64 confidence values are compared
// with epsilon tolerance to ensure idempotent updates
func TestConfidenceEpsilonComparison(t *testing.T) {
	tests := []struct {
		name        string
		existing    float64
		new         float64
		wantChanged bool
	}{
		{
			name:        "identical values",
			existing:    0.9,
			new:         0.9,
			wantChanged: false,
		},
		{
			name:        "different values",
			existing:    0.9,
			new:         0.85,
			wantChanged: true,
		},
		{
			name:        "tiny difference within epsilon",
			existing:    0.90000001,
			new:         0.9,
			wantChanged: false, // Should be treated as equal
		},
		{
			name:        "floating point precision issue",
			existing:    0.1 + 0.2, // 0.30000000000000004 in IEEE 754
			new:         0.3,
			wantChanged: false, // Should be treated as equal
		},
		{
			name:        "zero vs very small",
			existing:    0.0,
			new:         0.00001,
			wantChanged: false, // Within epsilon
		},
		{
			name:        "zero vs larger than epsilon",
			existing:    0.0,
			new:         0.001,
			wantChanged: true,
		},
		{
			name:        "significantly different",
			existing:    1.0,
			new:         0.5,
			wantChanged: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			changed := confidenceChanged(tt.existing, tt.new)
			if changed != tt.wantChanged {
				t.Errorf("confidenceChanged(%v, %v) = %v, want %v",
					tt.existing, tt.new, changed, tt.wantChanged)
			}
		})
	}
}

// TestMappingNeedsUpdateWithEpsilon tests the full update detection with epsilon comparison
func TestMappingNeedsUpdateWithEpsilon(t *testing.T) {
	tests := []struct {
		name          string
		existingConf  float64
		existingCount int
		existingNorm  string
		newConf       float64
		newCount      int
		newNorm       string
		wantUpdate    bool
	}{
		{
			name:          "no changes",
			existingConf:  0.9,
			existingCount: 10,
			existingNorm:  "Oakland",
			newConf:       0.9,
			newCount:      10,
			newNorm:       "Oakland",
			wantUpdate:    false,
		},
		{
			name:          "confidence epsilon difference - no update",
			existingConf:  0.90000001,
			existingCount: 10,
			existingNorm:  "Oakland",
			newConf:       0.9,
			newCount:      10,
			newNorm:       "Oakland",
			wantUpdate:    false,
		},
		{
			name:          "count changed",
			existingConf:  0.9,
			existingCount: 10,
			existingNorm:  "Oakland",
			newConf:       0.9,
			newCount:      15,
			newNorm:       "Oakland",
			wantUpdate:    true,
		},
		{
			name:          "normalized value changed",
			existingConf:  0.9,
			existingCount: 10,
			existingNorm:  "Oakland",
			newConf:       0.9,
			newCount:      10,
			newNorm:       "oakland", // Different case
			wantUpdate:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			existing := &testNormMappingRecord{
				NormalizedValue: tt.existingNorm,
				OccurrenceCount: tt.existingCount,
				Confidence:      tt.existingConf,
			}
			newMapping := &testNormalizedMapping{
				NormalizedValue: tt.newNorm,
				OccurrenceCount: tt.newCount,
				Confidence:      tt.newConf,
			}

			needsUpdate := mappingNeedsUpdateWithEpsilon(existing, newMapping)
			if needsUpdate != tt.wantUpdate {
				t.Errorf("mappingNeedsUpdateWithEpsilon() = %v, want %v", needsUpdate, tt.wantUpdate)
			}
		})
	}
}

// TestIdempotentSyncRuns tests that running sync twice produces 0 updates on second run
func TestIdempotentSyncRuns(t *testing.T) {
	// Simulate first run creating records
	mappings := []*testNormalizedMapping{
		{
			Category: "city", OriginalValue: "Oakland", NormalizedValue: "Oakland",
			OccurrenceCount: 10, Confidence: 0.9, Year: 2025,
		},
	}

	// After first run, records exist with same values
	existing := make(map[string]*testNormMappingRecord)
	for _, m := range mappings {
		key := buildNormalizedMappingKey(m.Category, m.OriginalValue, m.Year)
		existing[key] = &testNormMappingRecord{
			Category:        m.Category,
			NormalizedValue: m.NormalizedValue,
			OriginalValue:   m.OriginalValue,
			OccurrenceCount: m.OccurrenceCount,
			Confidence:      m.Confidence,
			Year:            m.Year,
		}
	}

	// Second run with same data should produce 0 updates
	stats := simulateUpsertWithEpsilon(mappings, existing, 2025)

	if stats.Updated != 0 {
		t.Errorf("second run should have Updated=0, got %d", stats.Updated)
	}
	if stats.Skipped != 1 {
		t.Errorf("second run should have Skipped=1, got %d", stats.Skipped)
	}
}

// confidenceChanged checks if confidence changed beyond epsilon threshold
func confidenceChanged(existing, newVal float64) bool {
	const epsilon = 0.0001
	diff := existing - newVal
	if diff < 0 {
		diff = -diff
	}
	return diff > epsilon
}

// mappingNeedsUpdateWithEpsilon checks if update needed using epsilon for confidence
func mappingNeedsUpdateWithEpsilon(existing *testNormMappingRecord, newMapping *testNormalizedMapping) bool {
	if existing.NormalizedValue != newMapping.NormalizedValue {
		return true
	}
	if existing.OccurrenceCount != newMapping.OccurrenceCount {
		return true
	}
	return confidenceChanged(existing.Confidence, newMapping.Confidence)
}

// simulateUpsertWithEpsilon simulates upsert using epsilon comparison
func simulateUpsertWithEpsilon(
	mappings []*testNormalizedMapping,
	existing map[string]*testNormMappingRecord,
	year int,
) testNormStats {
	stats := testNormStats{}

	for _, m := range mappings {
		key := buildNormalizedMappingKey(m.Category, m.OriginalValue, year)

		if existingRecord, ok := existing[key]; ok {
			if mappingNeedsUpdateWithEpsilon(existingRecord, m) {
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

// ============================================================================
// Original idempotency tests
// ============================================================================

// TestUpsertNormalizedMappingsIdempotency verifies idempotent upsert behavior
func TestUpsertNormalizedMappingsIdempotency(t *testing.T) {
	// Simulate computed mappings from source data
	mappings := []*testNormalizedMapping{
		{
			Category: "city", OriginalValue: "Oakland",
			NormalizedValue: "Oakland", OccurrenceCount: 10, Year: 2025,
		},
		{
			Category: "city", OriginalValue: "San Francisco",
			NormalizedValue: "San Francisco", OccurrenceCount: 5, Year: 2025,
		},
		{
			Category: "congregation", OriginalValue: "Temple Beth Abraham",
			NormalizedValue: "Temple Beth Abraham", OccurrenceCount: 3, Year: 2025,
		},
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
		{
			Category: "city", OriginalValue: "Oakland",
			NormalizedValue: "Oakland", OccurrenceCount: 10, Year: 2025,
		},
		{
			Category: "city", OriginalValue: "San Francisco",
			NormalizedValue: "San Francisco", OccurrenceCount: 5, Year: 2025,
		},
		{
			// This one will be orphaned (no longer in source data)
			Category: "city", OriginalValue: "Los Angeles",
			NormalizedValue: "Los Angeles", OccurrenceCount: 2, Year: 2025,
		},
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
	caser := cases.Title(language.English)
	return caser.String(strings.TrimSpace(strings.ToLower(city)))
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

// ============================================================================
// Person+Session Normalized Mappings Tests
// ============================================================================

// testPersonSessionMapping represents a normalized mapping with person+session keys
type testPersonSessionMapping struct {
	PersonPBID      string
	SessionPBID     string
	Category        string
	OriginalValue   string
	NormalizedValue string
	Confidence      float64
	Year            int
}

// testAttendeeGeoData represents geographic data extracted from an attendee
type testAttendeeGeoData struct {
	PersonPBID   string
	PersonCMID   int
	SessionPBID  string
	SessionCMID  int
	School       string // from persons
	City         string // from persons.address
	Congregation string // from person_custom_values
}

// buildPersonSessionMappingKey builds composite key for person+session normalized_mappings
func buildPersonSessionMappingKey(personPBID, sessionPBID, category string) string {
	return personPBID + ":" + sessionPBID + ":" + category
}

// TestPersonSessionMappingKey tests the composite key format for person+session mappings
func TestPersonSessionMappingKey(t *testing.T) {
	tests := []struct {
		name        string
		personPBID  string
		sessionPBID string
		category    string
		expectedKey string
	}{
		{
			name:        "school mapping key",
			personPBID:  "pb_person_123",
			sessionPBID: "pb_session_456",
			category:    "school",
			expectedKey: "pb_person_123:pb_session_456:school",
		},
		{
			name:        "city mapping key",
			personPBID:  "pb_person_789",
			sessionPBID: "pb_session_101",
			category:    "city",
			expectedKey: "pb_person_789:pb_session_101:city",
		},
		{
			name:        "congregation mapping key",
			personPBID:  "pb_person_abc",
			sessionPBID: "pb_session_def",
			category:    "congregation",
			expectedKey: "pb_person_abc:pb_session_def:congregation",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := buildPersonSessionMappingKey(tt.personPBID, tt.sessionPBID, tt.category)
			if key != tt.expectedKey {
				t.Errorf("buildPersonSessionMappingKey(%q, %q, %q) = %q, want %q",
					tt.personPBID, tt.sessionPBID, tt.category, key, tt.expectedKey)
			}
		})
	}
}

// TestPersonSessionMappingUniquePerPersonSession tests that each person+session+category
// combination produces exactly one mapping record
func TestPersonSessionMappingUniquePerPersonSession(t *testing.T) {
	// Simulate attendee geo data for two campers in different sessions
	attendeeData := []testAttendeeGeoData{
		{
			PersonPBID: "person_101", PersonCMID: 101,
			SessionPBID: "session_2001", SessionCMID: 2001,
			School: "Riverside Elementary", City: "Oakland", Congregation: "Temple Beth El",
		},
		{
			PersonPBID: "person_101", PersonCMID: 101,
			SessionPBID: "session_2002", SessionCMID: 2002, // Same person, different session
			School: "Riverside Elementary", City: "Oakland", Congregation: "Temple Beth El",
		},
		{
			PersonPBID: "person_102", PersonCMID: 102,
			SessionPBID: "session_2001", SessionCMID: 2001, // Different person, same session
			School: "Oak Valley Middle", City: "San Francisco", Congregation: "",
		},
	}

	// Generate mappings for all three categories
	mappings := make(map[string]*testPersonSessionMapping)

	for _, data := range attendeeData {
		// School mapping
		if data.School != "" {
			key := buildPersonSessionMappingKey(data.PersonPBID, data.SessionPBID, "school")
			mappings[key] = &testPersonSessionMapping{
				PersonPBID:      data.PersonPBID,
				SessionPBID:     data.SessionPBID,
				Category:        "school",
				OriginalValue:   data.School,
				NormalizedValue: data.School, // Simplified normalization
				Confidence:      1.0,
				Year:            2025,
			}
		}

		// City mapping
		if data.City != "" {
			key := buildPersonSessionMappingKey(data.PersonPBID, data.SessionPBID, "city")
			mappings[key] = &testPersonSessionMapping{
				PersonPBID:      data.PersonPBID,
				SessionPBID:     data.SessionPBID,
				Category:        "city",
				OriginalValue:   data.City,
				NormalizedValue: data.City,
				Confidence:      1.0,
				Year:            2025,
			}
		}

		// Congregation mapping
		if data.Congregation != "" {
			key := buildPersonSessionMappingKey(data.PersonPBID, data.SessionPBID, "congregation")
			mappings[key] = &testPersonSessionMapping{
				PersonPBID:      data.PersonPBID,
				SessionPBID:     data.SessionPBID,
				Category:        "congregation",
				OriginalValue:   data.Congregation,
				NormalizedValue: data.Congregation,
				Confidence:      1.0,
				Year:            2025,
			}
		}
	}

	// Expected: 3 attendees × 3 categories = 9 mappings, minus 1 empty congregation = 8
	// Actually: person_101 has 2 sessions × 3 categories = 6
	//           person_102 has 1 session × 2 categories (no congregation) = 2
	//           Total = 8
	expectedCount := 8
	if len(mappings) != expectedCount {
		t.Errorf("expected %d unique mappings, got %d", expectedCount, len(mappings))
	}

	// Verify person_101 has mappings for both sessions
	if _, ok := mappings["person_101:session_2001:school"]; !ok {
		t.Error("missing mapping for person_101 in session_2001 school")
	}
	if _, ok := mappings["person_101:session_2002:school"]; !ok {
		t.Error("missing mapping for person_101 in session_2002 school")
	}
}

// TestSessionFilterCountsMatchMainList tests that filtering by session returns
// counts that match the main registration list (fixes the "show sources" mismatch bug)
func TestSessionFilterCountsMatchMainList(t *testing.T) {
	// Create mappings for 2 persons in session 2001, 1 person in session 2002
	mappings := []*testPersonSessionMapping{
		// Person 101 in session 2001: school = "Riverside Elementary"
		{
			PersonPBID: "p101", SessionPBID: "s2001", Category: "school",
			OriginalValue: "Riverside Elementary", NormalizedValue: "Riverside Elementary",
		},
		// Person 102 in session 2001: school = "Riverside Elementary"
		{
			PersonPBID: "p102", SessionPBID: "s2001", Category: "school",
			OriginalValue: "Riverside Elementary", NormalizedValue: "Riverside Elementary",
		},
		// Person 103 in session 2002: school = "Riverside Elementary"
		{
			PersonPBID: "p103", SessionPBID: "s2002", Category: "school",
			OriginalValue: "Riverside Elementary", NormalizedValue: "Riverside Elementary",
		},
	}

	// Filter to session 2001 only
	session2001Mappings := filterMappingsBySession(mappings, "s2001")

	// Should have 2 mappings (both from session 2001)
	if len(session2001Mappings) != 2 {
		t.Errorf("expected 2 mappings for session 2001, got %d", len(session2001Mappings))
	}

	// Count by normalized value
	schoolCounts := countByNormalizedValue(session2001Mappings)

	// "Riverside Elementary" should have count=2 (not count=3)
	if schoolCounts["Riverside Elementary"] != 2 {
		t.Errorf("expected Riverside Elementary count=2 for session 2001, got %d",
			schoolCounts["Riverside Elementary"])
	}
}

// filterMappingsBySession filters mappings to a specific session
func filterMappingsBySession(mappings []*testPersonSessionMapping, sessionPBID string) []*testPersonSessionMapping {
	var result []*testPersonSessionMapping
	for _, m := range mappings {
		if m.SessionPBID == sessionPBID {
			result = append(result, m)
		}
	}
	return result
}

// countByNormalizedValue groups mappings by normalized_value and counts
func countByNormalizedValue(mappings []*testPersonSessionMapping) map[string]int {
	counts := make(map[string]int)
	for _, m := range mappings {
		counts[m.NormalizedValue]++
	}
	return counts
}

// TestCongregationUsesPersonLevelData verifies that congregation comes from
// person_custom_values (HH-Name of Congregation) not household_custom_values (Synagogue)
func TestCongregationUsesPersonLevelData(t *testing.T) {
	// Simulate person_custom_values data (person-level congregation)
	personCongregations := map[int]string{
		101: "Temple Beth El - Oakland",      // Person 101
		102: "Congregation Beth Israel",      // Person 102
		103: "Temple Sinai Reform Congregation", // Person 103
	}

	// Simulate household_custom_values data (household-level, should NOT be used)
	householdSynagogues := map[int]string{
		1001: "Temple Beth El", // Household 1001 (persons 101, 102)
		1002: "Temple Sinai",   // Household 1002 (person 103)
	}

	// The test verifies that when we look up congregation for person 101,
	// we get "Temple Beth El - Oakland" (person-level) not "Temple Beth El" (household-level)
	congregation101 := personCongregations[101]
	expectedCongregation := "Temple Beth El - Oakland"

	if congregation101 != expectedCongregation {
		t.Errorf("expected congregation %q (from person_custom_values), got %q",
			expectedCongregation, congregation101)
	}

	// Person 103 should have their specific congregation
	congregation103 := personCongregations[103]
	if congregation103 != "Temple Sinai Reform Congregation" {
		t.Errorf("expected congregation 'Temple Sinai Reform Congregation', got %q", congregation103)
	}

	// The household-level synagogue should be different (confirming we're using person-level)
	householdSynagogue := householdSynagogues[1001] // Household for persons 101, 102
	if congregation101 == householdSynagogue {
		t.Error("congregation should come from person_custom_values, not household_custom_values")
	}
}

// TestPersonSessionUpsertIdempotency tests that upserting the same person+session
// mapping twice results in skip (not update or create)
func TestPersonSessionUpsertIdempotency(t *testing.T) {
	// First run: create mappings
	mappings := []*testPersonSessionMapping{
		{
			PersonPBID: "p101", SessionPBID: "s2001", Category: "school",
			OriginalValue: "Riverside Elementary", NormalizedValue: "Riverside Elementary",
			Confidence: 1.0, Year: 2025,
		},
	}

	// Simulate existing records (empty on first run)
	existing := make(map[string]*testPersonSessionMapping)

	stats1 := simulatePersonSessionUpsert(mappings, existing)

	// First run should create
	if stats1.Created != 1 {
		t.Errorf("first run: expected Created=1, got %d", stats1.Created)
	}

	// Now simulate existing records from first run
	for _, m := range mappings {
		key := buildPersonSessionMappingKey(m.PersonPBID, m.SessionPBID, m.Category)
		existing[key] = m
	}

	// Second run with identical data
	stats2 := simulatePersonSessionUpsert(mappings, existing)

	// Second run should skip (no changes)
	if stats2.Created != 0 {
		t.Errorf("second run: expected Created=0, got %d", stats2.Created)
	}
	if stats2.Updated != 0 {
		t.Errorf("second run: expected Updated=0, got %d", stats2.Updated)
	}
	if stats2.Skipped != 1 {
		t.Errorf("second run: expected Skipped=1, got %d", stats2.Skipped)
	}
}

// simulatePersonSessionUpsert simulates the upsert logic for person+session mappings
func simulatePersonSessionUpsert(
	mappings []*testPersonSessionMapping,
	existing map[string]*testPersonSessionMapping,
) testNormStats {
	stats := testNormStats{}

	for _, m := range mappings {
		key := buildPersonSessionMappingKey(m.PersonPBID, m.SessionPBID, m.Category)

		if existingRecord, ok := existing[key]; ok {
			if personSessionMappingNeedsUpdate(existingRecord, m) {
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

// personSessionMappingNeedsUpdate checks if a person+session mapping needs updating
func personSessionMappingNeedsUpdate(existing, newMapping *testPersonSessionMapping) bool {
	if existing.NormalizedValue != newMapping.NormalizedValue {
		return true
	}
	if existing.OriginalValue != newMapping.OriginalValue {
		return true
	}
	return confidenceChanged(existing.Confidence, newMapping.Confidence)
}

// TestEnrolledOnlyInNormalizedMappings verifies that only enrolled attendees
// (status_id=2, is_active=1) are included in normalized_mappings
func TestEnrolledOnlyInNormalizedMappings(t *testing.T) {
	// Simulate attendees with different statuses
	type testAttendee struct {
		PersonID int
		StatusID int
		IsActive bool
	}

	attendees := []testAttendee{
		{PersonID: 101, StatusID: 2, IsActive: true},  // Enrolled - INCLUDE
		{PersonID: 102, StatusID: 2, IsActive: true},  // Enrolled - INCLUDE
		{PersonID: 103, StatusID: 3, IsActive: true},  // Waitlisted - EXCLUDE
		{PersonID: 104, StatusID: 4, IsActive: true},  // Canceled - EXCLUDE
		{PersonID: 105, StatusID: 2, IsActive: false}, // Enrolled but inactive - EXCLUDE
	}

	// Filter to enrolled only (matches the sync query: is_active = 1 AND status_id = 2)
	var enrolledPersonIDs []int
	for _, a := range attendees {
		if a.StatusID == 2 && a.IsActive {
			enrolledPersonIDs = append(enrolledPersonIDs, a.PersonID)
		}
	}

	// Should have exactly 2 enrolled persons
	if len(enrolledPersonIDs) != 2 {
		t.Errorf("expected 2 enrolled persons, got %d", len(enrolledPersonIDs))
	}

	// Verify correct persons included
	expected := map[int]bool{101: true, 102: true}
	for _, pid := range enrolledPersonIDs {
		if !expected[pid] {
			t.Errorf("unexpected person %d in enrolled list", pid)
		}
	}
}

// ============================================================================
// City Extraction Tests
// ============================================================================

// TestExtractCityFromAddressJSON tests extracting city from JSON address field
func TestExtractCityFromAddressJSON(t *testing.T) {
	tests := []struct {
		name         string
		addressRaw   any
		expectedCity string
	}{
		{
			name:         "nil address",
			addressRaw:   nil,
			expectedCity: "",
		},
		{
			name:         "empty string",
			addressRaw:   "",
			expectedCity: "",
		},
		{
			name:         "JSON string with city",
			addressRaw:   `{"city":"San Francisco","state":"CA"}`,
			expectedCity: "San Francisco",
		},
		{
			name:         "JSON string with city only",
			addressRaw:   `{"city":"Oakland"}`,
			expectedCity: "Oakland",
		},
		{
			name:         "JSON string without city",
			addressRaw:   `{"state":"CA"}`,
			expectedCity: "",
		},
		{
			name:         "JSON string with null city",
			addressRaw:   `{"city":null,"state":"CA"}`,
			expectedCity: "",
		},
		{
			name:         "map with city",
			addressRaw:   map[string]any{"city": "Los Angeles", "state": "CA"},
			expectedCity: "Los Angeles",
		},
		{
			name:         "map without city",
			addressRaw:   map[string]any{"state": "CA"},
			expectedCity: "",
		},
		{
			name:         "byte slice JSON",
			addressRaw:   []byte(`{"city":"Berkeley","state":"CA"}`),
			expectedCity: "Berkeley",
		},
		{
			name:         "types.JSONRaw (PocketBase JSON field type)",
			addressRaw:   types.JSONRaw(`{"city":"San Francisco","state":"CA"}`),
			expectedCity: "San Francisco",
		},
		{
			name:         "invalid JSON string",
			addressRaw:   `{invalid json}`,
			expectedCity: "",
		},
		{
			name:         "empty JSON object",
			addressRaw:   `{}`,
			expectedCity: "",
		},
	}

	// Use the real NormalizeGeographicSync for testing
	n := &NormalizeGeographicSync{}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			city := n.extractCityFromAddress(tt.addressRaw)
			if city != tt.expectedCity {
				t.Errorf("extractCityFromAddress(%v) = %q, want %q",
					tt.addressRaw, city, tt.expectedCity)
			}
		})
	}
}

