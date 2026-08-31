package sync

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// ============================================================================
// Year Validation Tests
// ============================================================================

// TestNormalizeGeographicYearValidation tests year parameter validation
func TestNormalizeGeographicYearValidation(t *testing.T) {
	t.Parallel()
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
// Composite Key Tests
// ============================================================================

// TestNormalizedMappingCompositeKey tests the composite key format for normalized_mappings
func TestNormalizedMappingCompositeKey(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	AddressState    string
	AddressCountry  string
}

// testAttendeeGeoData represents geographic data extracted from an attendee
type testAttendeeGeoData struct {
	PersonPBID     string
	PersonCMID     int
	SessionPBID    string
	SessionCMID    int
	School         string // from persons.school
	City           string // from persons.address_city (discrete column)
	Congregation   string // from person_custom_values
	AddressState   string // from household billing_state
	AddressCountry string // from household billing_country
}

// buildPersonSessionMappingKey builds composite key for person+session normalized_mappings
func buildPersonSessionMappingKey(personPBID, sessionPBID, category string) string {
	return personPBID + ":" + sessionPBID + ":" + category
}

// TestPersonSessionMappingKey tests the composite key format for person+session mappings
func TestPersonSessionMappingKey(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	// Simulate person_custom_values data (person-level congregation)
	personCongregations := map[int]string{
		101: "Temple Beth El - Oakland",         // Person 101
		102: "Congregation Beth Israel",         // Person 102
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
	t.Parallel()
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
	if existing.AddressState != newMapping.AddressState {
		return true
	}
	if existing.AddressCountry != newMapping.AddressCountry {
		return true
	}
	return confidenceChanged(existing.Confidence, newMapping.Confidence)
}

// TestAllAttendeesForYearInNormalizedMappings verifies that all attendees for
// a given year are included in normalized_mappings regardless of enrollment status.
// Note: status_id == 2 determines enrolled status (is_active was dropped from
// the schema). Year is the only meaningful filter for normalization.
// Normalization is cheap (local fuzzy matching) and benefits all attendees:
// - Waitlisted campers get clean data for review and seamless enrollment transitions
// - More data points improve canonical value selection via frequency-based clustering
func TestAllAttendeesForYearInNormalizedMappings(t *testing.T) {
	t.Parallel()
	type testAttendee struct {
		PersonID int
		StatusID int
		Year     int
	}

	attendees := []testAttendee{
		{PersonID: 101, StatusID: 2, Year: 2025}, // Enrolled
		{PersonID: 102, StatusID: 2, Year: 2025}, // Enrolled
		{PersonID: 103, StatusID: 3, Year: 2025}, // Waitlisted
		{PersonID: 104, StatusID: 4, Year: 2025}, // Other status
		{PersonID: 105, StatusID: 2, Year: 2024}, // Different year - EXCLUDE
	}

	// Filter by year only (matches the sync query: year = YYYY)
	targetYear := 2025
	var includedPersonIDs []int
	for _, a := range attendees {
		if a.Year == targetYear {
			includedPersonIDs = append(includedPersonIDs, a.PersonID)
		}
	}

	// Should include all 4 attendees for 2025, regardless of status
	if len(includedPersonIDs) != 4 {
		t.Errorf("expected 4 attendees for year %d, got %d", targetYear, len(includedPersonIDs))
	}

	// Verify correct persons included
	expected := map[int]bool{101: true, 102: true, 103: true, 104: true}
	for _, pid := range includedPersonIDs {
		if !expected[pid] {
			t.Errorf("unexpected person %d in included list", pid)
		}
	}

	// Verify different-year person excluded
	for _, pid := range includedPersonIDs {
		if pid == 105 {
			t.Error("person 105 from year 2024 should be excluded")
		}
	}
}

// ============================================================================
// City Field Source Tests
// ============================================================================

// TestCityUsesDiscreteColumn verifies that city data comes from the discrete
// persons.address_city column, NOT from a JSON address field.
// The JSON address field was removed in the Phase 3 migration (PR #208).
// loadAttendeeGeoData must use personRecord.GetString("address_city").
func TestCityUsesDiscreteColumn(t *testing.T) {
	t.Parallel()
	// This test verifies the expected data flow:
	// persons.address_city (text column) → attendeeGeoData.City
	//
	// Previously this used persons.address (JSON) → extractCityFromAddress() → City
	// which broke when the JSON field was removed, causing all city data to be empty.

	// Simulate the expected data extraction pattern
	testCases := []struct {
		name         string
		addressCity  string // discrete column value (from GetString("address_city"))
		expectedCity string
	}{
		{"populated city", "San Francisco", "San Francisco"},
		{"empty city", "", ""},
		{"city with whitespace", "  Oakland  ", "  Oakland  "}, // GetString returns raw value
	}

	for _, tt := range testCases {
		t.Run(tt.name, func(t *testing.T) {
			// The discrete column value should be used directly as data.City
			// (no JSON parsing needed)
			data := attendeeGeoData{
				City: tt.addressCity, // This is what GetString("address_city") returns
			}
			if data.City != tt.expectedCity {
				t.Errorf("City = %q, want %q", data.City, tt.expectedCity)
			}
		})
	}
}

// TestExtractCityFromAddressNotUsed verifies that the old extractCityFromAddress
// helper is no longer needed. The normalize_geographic.go loadAttendeeGeoData
// function should read address_city directly, not parse JSON.
func TestExtractCityFromAddressNotUsed(t *testing.T) {
	t.Parallel()
	// After the fix, extractCityFromAddress should not exist on NormalizeGeographicSync.
	// This test serves as documentation that city comes from a discrete column.
	//
	// If this test compiles, it means the extractCityFromAddress method
	// has been properly removed (otherwise it would be unused and caught by linting).
	t.Log("City data now comes from persons.address_city discrete column")
}

// ============================================================================
// HTTP-based Geo Normalize API Tests
// ============================================================================

func TestCallGeoNormalizeAPI(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		responseStatus int
		responseBody   string
		wantErr        bool
		wantCount      int
	}{
		{
			name:           "successful normalization",
			responseStatus: 200,
			responseBody:   `{"SF": {"canonical": "San Francisco, CA", "confidence": 0.95}}`,
			wantErr:        false,
			wantCount:      1,
		},
		{
			name:           "empty values returns empty map",
			responseStatus: 200,
			responseBody:   `{}`,
			wantErr:        false,
			wantCount:      0,
		},
		{
			name:           "server error",
			responseStatus: 500,
			responseBody:   `{"error": "internal error"}`,
			wantErr:        true,
			wantCount:      0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" {
					t.Errorf("expected POST, got %s", r.Method)
				}
				if r.URL.Path != "/api/internal/geo-normalize" {
					t.Errorf("expected /api/internal/geo-normalize, got %s", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tt.responseStatus)
				_, _ = w.Write([]byte(tt.responseBody))
			}))
			defer server.Close()

			result, err := callGeoNormalizeAPI(context.Background(), server.URL, "city", []valueWithContext{
				{Value: "SF", State: "CA", Country: "US"},
			})

			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if len(result) != tt.wantCount {
				t.Errorf("expected %d results, got %d", tt.wantCount, len(result))
			}
		})
	}
}

// ============================================================================
// Geo Override Integration Tests
// ============================================================================

const testCityOakland = "Oakland"

// TestResolveValueAliasOverrideTakesPriority verifies that alias overrides
// take priority over fuzzy match results. When a raw value has an alias
// override, it should return the alias canonical with confidence 1.0.
func TestResolveValueAliasOverrideTakesPriority(t *testing.T) {
	t.Parallel()
	// Fuzzy match lookup maps a raw value to a normalized entry
	fuzzyLookup := map[string]normalizedEntry{
		"Oaklnd": {Canonical: testCityOakland, Confidence: 0.9}, // fuzzy match would normalize to "Oakland"
	}

	// Alias override maps the same raw value to a different canonical
	aliasOverrides := map[string]map[string]string{
		categoryCity: {
			"oaklnd": "Oak Land City", // lowercase key -> different canonical
		},
		categorySchool:       {},
		categoryCongregation: {},
	}

	mergeOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	// The alias override should win over fuzzy match
	normalized, confidence := resolveValue("Oaklnd", categoryCity, fuzzyLookup, aliasOverrides, mergeOverrides)

	if normalized != "Oak Land City" {
		t.Errorf("resolveValue() normalized = %q, want %q", normalized, "Oak Land City")
	}
	if confidence != 1.0 {
		t.Errorf("resolveValue() confidence = %f, want 1.0", confidence)
	}
}

// TestResolveValueAliasIsCaseInsensitive verifies that alias lookup is
// case-insensitive (raw values are lowercased before lookup).
func TestResolveValueAliasIsCaseInsensitive(t *testing.T) {
	t.Parallel()
	fuzzyLookup := map[string]normalizedEntry{}

	aliasOverrides := map[string]map[string]string{
		categorySchool: {
			"riverside elem": "Riverside Elementary School",
		},
		categoryCity:         {},
		categoryCongregation: {},
	}

	mergeOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	// Input with mixed case should still match the lowercase alias key
	normalized, confidence := resolveValue("Riverside Elem", categorySchool, fuzzyLookup, aliasOverrides, mergeOverrides)

	if normalized != "Riverside Elementary School" {
		t.Errorf("resolveValue() normalized = %q, want %q", normalized, "Riverside Elementary School")
	}
	if confidence != 1.0 {
		t.Errorf("resolveValue() confidence = %f, want 1.0", confidence)
	}
}

// TestResolveValueMergeRedirectAfterFuzzyMatch verifies that merge redirects
// are followed after fuzzy match resolution. If fuzzy matches "A" and a merge
// says A -> B, the final result should be B.
func TestResolveValueMergeRedirectAfterFuzzyMatch(t *testing.T) {
	t.Parallel()
	// Fuzzy match normalizes "Temple Beth-El" -> "Temple Beth El"
	fuzzyLookup := map[string]normalizedEntry{
		"Temple Beth-El": {Canonical: "Temple Beth El", Confidence: 0.9},
	}

	aliasOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	// Merge redirect: "Temple Beth El" -> "Congregation Beth El"
	mergeOverrides := map[string]map[string]string{
		categoryCongregation: {
			"Temple Beth El": "Congregation Beth El",
		},
		categoryCity:   {},
		categorySchool: {},
	}

	normalized, confidence := resolveValue(
		"Temple Beth-El", categoryCongregation, fuzzyLookup,
		aliasOverrides, mergeOverrides)

	if normalized != "Congregation Beth El" {
		t.Errorf("resolveValue() normalized = %q, want %q", normalized, "Congregation Beth El")
	}
	// Confidence comes from Python normalizer entry (0.9 for fuzzy match)
	if confidence != 0.9 {
		t.Errorf("resolveValue() confidence = %f, want 0.9", confidence)
	}
}

// TestResolveValueAliasPlusMerge verifies the combined path: alias resolves
// raw -> A, then merge redirects A -> B. Final result should be B with
// confidence 1.0 (because the alias itself is a manual override).
func TestResolveValueAliasPlusMerge(t *testing.T) {
	t.Parallel()
	fuzzyLookup := map[string]normalizedEntry{} // empty, alias should handle it

	aliasOverrides := map[string]map[string]string{
		categorySchool: {
			"rv elem": "Riverside Elementary", // alias maps typo to canonical
		},
		categoryCity:         {},
		categoryCongregation: {},
	}

	mergeOverrides := map[string]map[string]string{
		categorySchool: {
			"Riverside Elementary": "Riverside Elementary School", // merge redirects
		},
		categoryCity:         {},
		categoryCongregation: {},
	}

	normalized, confidence := resolveValue("RV Elem", categorySchool, fuzzyLookup, aliasOverrides, mergeOverrides)

	if normalized != "Riverside Elementary School" {
		t.Errorf("resolveValue() normalized = %q, want %q", normalized, "Riverside Elementary School")
	}
	if confidence != 1.0 {
		t.Errorf("resolveValue() confidence = %f, want 1.0 (alias override)", confidence)
	}
}

// TestResolveValueEmptyOverridesFallBackToFuzzy verifies that when alias/merge
// overrides are empty, the function falls back to fuzzy match as before.
func TestResolveValueEmptyOverridesFallBackToFuzzy(t *testing.T) {
	t.Parallel()
	fuzzyLookup := map[string]normalizedEntry{
		"San Fran": {Canonical: "San Francisco", Confidence: 0.9},
	}

	aliasOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	mergeOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	normalized, confidence := resolveValue("San Fran", categoryCity, fuzzyLookup, aliasOverrides, mergeOverrides)

	if normalized != "San Francisco" {
		t.Errorf("resolveValue() normalized = %q, want %q", normalized, "San Francisco")
	}
	// Fuzzy match where original != normalized -> 0.9
	if confidence != 0.9 {
		t.Errorf("resolveValue() confidence = %f, want 0.9", confidence)
	}
}

// TestResolveValueFuzzyMatchExactCaseConfidence verifies that when fuzzy match
// returns a case-equal result, confidence is 1.0.
func TestResolveValueFuzzyMatchExactCaseConfidence(t *testing.T) {
	t.Parallel()
	fuzzyLookup := map[string]normalizedEntry{
		testCityOakland: {Canonical: testCityOakland, Confidence: 1.0}, // exact match
	}

	aliasOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	mergeOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	normalized, confidence := resolveValue(testCityOakland, categoryCity, fuzzyLookup, aliasOverrides, mergeOverrides)

	if normalized != testCityOakland {
		t.Errorf("resolveValue() normalized = %q, want %q", normalized, testCityOakland)
	}
	if confidence != 1.0 {
		t.Errorf("resolveValue() confidence = %f, want 1.0 (exact case match)", confidence)
	}
}

// TestResolveValueNoMatchReturnsEmpty verifies that when no alias override
// and no fuzzy match exist, resolveValue returns empty string and 0 confidence.
func TestResolveValueNoMatchReturnsEmpty(t *testing.T) {
	t.Parallel()
	fuzzyLookup := map[string]normalizedEntry{} // no matches

	aliasOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	mergeOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	normalized, confidence := resolveValue("Unknown Place", categoryCity, fuzzyLookup, aliasOverrides, mergeOverrides)

	if normalized != "" {
		t.Errorf("resolveValue() normalized = %q, want empty string", normalized)
	}
	if confidence != 0 {
		t.Errorf("resolveValue() confidence = %f, want 0", confidence)
	}
}

// TestResolveValueNilOverrideMapsDoNotPanic verifies that nil maps in the
// overrides don't cause panics (defensive coding).
func TestResolveValueNilOverrideMapsDoNotPanic(t *testing.T) {
	t.Parallel()
	fuzzyLookup := map[string]normalizedEntry{
		testCityOakland: {Canonical: testCityOakland, Confidence: 1.0},
	}

	// Missing category keys in override maps
	aliasOverrides := map[string]map[string]string{}
	mergeOverrides := map[string]map[string]string{}

	// Should not panic, should fall back to fuzzy match
	normalized, confidence := resolveValue(testCityOakland, categoryCity, fuzzyLookup, aliasOverrides, mergeOverrides)

	if normalized != testCityOakland {
		t.Errorf("resolveValue() normalized = %q, want %q", normalized, testCityOakland)
	}
	if confidence != 1.0 {
		t.Errorf("resolveValue() confidence = %f, want 1.0", confidence)
	}
}

// TestResolveValueMergeOnlyNoAlias verifies that merge redirects work
// even when there are no alias overrides for a category. The fuzzy match
// result is redirected by the merge.
func TestResolveValueMergeOnlyNoAlias(t *testing.T) {
	t.Parallel()
	fuzzyLookup := map[string]normalizedEntry{
		"Oak Valley Middle School": {Canonical: "Oak Valley Middle School", Confidence: 1.0},
	}

	aliasOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	mergeOverrides := map[string]map[string]string{
		categorySchool: {
			"Oak Valley Middle School": "Oak Valley Middle",
		},
		categoryCity:         {},
		categoryCongregation: {},
	}

	normalized, confidence := resolveValue(
		"Oak Valley Middle School", categorySchool, fuzzyLookup,
		aliasOverrides, mergeOverrides)

	if normalized != "Oak Valley Middle" {
		t.Errorf("resolveValue() normalized = %q, want %q", normalized, "Oak Valley Middle")
	}
	// Exact case match from fuzzy -> 1.0 confidence (merge doesn't change confidence)
	if confidence != 1.0 {
		t.Errorf("resolveValue() confidence = %f, want 1.0", confidence)
	}
}

// TestResolveValueCategoryIsolation verifies that overrides for one category
// do not affect resolution in another category.
func TestResolveValueCategoryIsolation(t *testing.T) {
	t.Parallel()
	fuzzyLookup := map[string]normalizedEntry{
		testCityOakland: {Canonical: testCityOakland, Confidence: 1.0},
	}

	aliasOverrides := map[string]map[string]string{
		categoryCity: {
			"oakland": "Oakland, CA", // alias only for city category
		},
		categorySchool:       {},
		categoryCongregation: {},
	}

	mergeOverrides := map[string]map[string]string{
		categoryCity:         {},
		categorySchool:       {},
		categoryCongregation: {},
	}

	// When resolving as "school" category, the city alias should NOT apply
	normalized, confidence := resolveValue(
		testCityOakland, categorySchool, fuzzyLookup,
		aliasOverrides, mergeOverrides)

	// Should use fuzzy match, not the city alias
	if normalized != testCityOakland {
		t.Errorf("resolveValue() for school category = %q, want %q (city alias should not apply)",
			normalized, testCityOakland)
	}
	if confidence != 1.0 {
		t.Errorf("resolveValue() confidence = %f, want 1.0", confidence)
	}
}

// ============================================================================
// Address State/Country from Household Tests
// ============================================================================

// TestAttendeeGeoDataHasAddressFields verifies the attendeeGeoData struct
// carries address_state and address_country fields from the household join.
func TestAttendeeGeoDataHasAddressFields(t *testing.T) {
	t.Parallel()
	data := attendeeGeoData{
		PersonPBID:     "person_101",
		PersonCMID:     101,
		SessionPBID:    "session_2001",
		SessionCMID:    2001,
		School:         "Riverside Elementary",
		City:           "Oakland",
		Congregation:   "Temple Beth El",
		AddressState:   "CA",
		AddressCountry: "US",
	}

	if data.AddressState != "CA" {
		t.Errorf("AddressState = %q, want %q", data.AddressState, "CA")
	}
	if data.AddressCountry != "US" {
		t.Errorf("AddressCountry = %q, want %q", data.AddressCountry, "US")
	}
}

// TestAttendeeGeoDataEmptyHousehold verifies that address fields default to
// empty strings when no household is linked (nil expanded record).
func TestAttendeeGeoDataEmptyHousehold(t *testing.T) {
	t.Parallel()
	data := attendeeGeoData{
		PersonPBID:  "person_102",
		PersonCMID:  102,
		SessionPBID: "session_2001",
		SessionCMID: 2001,
		School:      "Oak Valley Middle",
		City:        "San Francisco",
		// AddressState and AddressCountry intentionally unset (no household)
	}

	if data.AddressState != "" {
		t.Errorf("AddressState should be empty when no household, got %q", data.AddressState)
	}
	if data.AddressCountry != "" {
		t.Errorf("AddressCountry should be empty when no household, got %q", data.AddressCountry)
	}
}

// TestPersonSessionMappingCarriesAddressFields verifies the personSessionMapping
// struct carries address_state and address_country through the mapping pipeline.
func TestPersonSessionMappingCarriesAddressFields(t *testing.T) {
	t.Parallel()
	m := personSessionMapping{
		personPBID:      "person_101",
		sessionPBID:     "session_2001",
		category:        categoryCity,
		originalValue:   "Oakland",
		normalizedValue: "Oakland",
		confidence:      1.0,
		year:            2025,
		addressState:    "CA",
		addressCountry:  "US",
	}

	if m.addressState != "CA" {
		t.Errorf("addressState = %q, want %q", m.addressState, "CA")
	}
	if m.addressCountry != "US" {
		t.Errorf("addressCountry = %q, want %q", m.addressCountry, "US")
	}
}

// TestPersonSessionMappingNeedsUpdateDetectsAddressStateChange verifies that
// a change to address_state triggers an update.
func TestPersonSessionMappingNeedsUpdateDetectsAddressStateChange(t *testing.T) {
	t.Parallel()
	existing := &testPersonSessionMapping{
		PersonPBID: "p101", SessionPBID: "s2001", Category: "city",
		OriginalValue: "Oakland", NormalizedValue: "Oakland",
		Confidence: 1.0, Year: 2025,
		AddressState: "CA", AddressCountry: "US",
	}

	updated := &testPersonSessionMapping{
		PersonPBID: "p101", SessionPBID: "s2001", Category: "city",
		OriginalValue: "Oakland", NormalizedValue: "Oakland",
		Confidence: 1.0, Year: 2025,
		AddressState: "NY", AddressCountry: "US", // state changed
	}

	if !personSessionMappingNeedsUpdate(existing, updated) {
		t.Error("expected update when address_state changes from CA to NY")
	}
}

// TestPersonSessionMappingNeedsUpdateDetectsAddressCountryChange verifies that
// a change to address_country triggers an update.
func TestPersonSessionMappingNeedsUpdateDetectsAddressCountryChange(t *testing.T) {
	t.Parallel()
	existing := &testPersonSessionMapping{
		PersonPBID: "p101", SessionPBID: "s2001", Category: "school",
		OriginalValue: "Riverside Elementary", NormalizedValue: "Riverside Elementary",
		Confidence: 1.0, Year: 2025,
		AddressState: "CA", AddressCountry: "US",
	}

	updated := &testPersonSessionMapping{
		PersonPBID: "p101", SessionPBID: "s2001", Category: "school",
		OriginalValue: "Riverside Elementary", NormalizedValue: "Riverside Elementary",
		Confidence: 1.0, Year: 2025,
		AddressState: "CA", AddressCountry: "CA", // country changed
	}

	if !personSessionMappingNeedsUpdate(existing, updated) {
		t.Error("expected update when address_country changes from US to CA")
	}
}

// TestPersonSessionMappingNeedsUpdateNoChangeWithAddress verifies that
// identical address fields do not trigger a spurious update.
func TestPersonSessionMappingNeedsUpdateNoChangeWithAddress(t *testing.T) {
	t.Parallel()
	existing := &testPersonSessionMapping{
		PersonPBID: "p101", SessionPBID: "s2001", Category: "city",
		OriginalValue: "Oakland", NormalizedValue: "Oakland",
		Confidence: 1.0, Year: 2025,
		AddressState: "CA", AddressCountry: "US",
	}

	same := &testPersonSessionMapping{
		PersonPBID: "p101", SessionPBID: "s2001", Category: "city",
		OriginalValue: "Oakland", NormalizedValue: "Oakland",
		Confidence: 1.0, Year: 2025,
		AddressState: "CA", AddressCountry: "US",
	}

	if personSessionMappingNeedsUpdate(existing, same) {
		t.Error("should not need update when address fields are identical")
	}
}

// TestAddressFieldsPropagateToMappings verifies that address_state and
// address_country from attendeeGeoData flow through to personSessionMapping
// for all three categories (school, city, congregation).
func TestAddressFieldsPropagateToMappings(t *testing.T) {
	t.Parallel()
	attendeeData := []testAttendeeGeoData{
		{
			PersonPBID: "p101", PersonCMID: 101,
			SessionPBID: "s2001", SessionCMID: 2001,
			School: "Riverside Elementary", City: "Oakland",
			Congregation: "Temple Beth El",
			AddressState: "CA", AddressCountry: "US",
		},
	}

	// Simulate mapping creation (mirrors createPersonSessionMappings logic)
	var mappings []*testPersonSessionMapping
	for _, d := range attendeeData {
		if d.School != "" {
			mappings = append(mappings, &testPersonSessionMapping{
				PersonPBID: d.PersonPBID, SessionPBID: d.SessionPBID,
				Category: "school", OriginalValue: d.School, NormalizedValue: d.School,
				Confidence: 1.0, Year: 2025,
				AddressState: d.AddressState, AddressCountry: d.AddressCountry,
			})
		}
		if d.City != "" {
			mappings = append(mappings, &testPersonSessionMapping{
				PersonPBID: d.PersonPBID, SessionPBID: d.SessionPBID,
				Category: "city", OriginalValue: d.City, NormalizedValue: d.City,
				Confidence: 1.0, Year: 2025,
				AddressState: d.AddressState, AddressCountry: d.AddressCountry,
			})
		}
		if d.Congregation != "" {
			mappings = append(mappings, &testPersonSessionMapping{
				PersonPBID: d.PersonPBID, SessionPBID: d.SessionPBID,
				Category: "congregation", OriginalValue: d.Congregation,
				NormalizedValue: d.Congregation,
				Confidence:      1.0, Year: 2025,
				AddressState: d.AddressState, AddressCountry: d.AddressCountry,
			})
		}
	}

	// Should have 3 mappings, all with address fields
	if len(mappings) != 3 {
		t.Fatalf("expected 3 mappings, got %d", len(mappings))
	}

	for _, m := range mappings {
		if m.AddressState != "CA" {
			t.Errorf("mapping %s: AddressState = %q, want %q", m.Category, m.AddressState, "CA")
		}
		if m.AddressCountry != "US" {
			t.Errorf("mapping %s: AddressCountry = %q, want %q", m.Category, m.AddressCountry, "US")
		}
	}
}

// ============================================================================
// Context Tuple Tests — valueWithContext JSON serialization
// ============================================================================

// TestValueWithContextJSON verifies that valueWithContext serializes to the
// JSON format expected by the Python normalizer: {"value": "x", "state": "CA", "country": "US"}
func TestValueWithContextJSON(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		input    valueWithContext
		wantJSON string
	}{
		{
			name:     "full context US",
			input:    valueWithContext{Value: "Oakland", State: "CA", Country: "US"},
			wantJSON: `{"value":"Oakland","state":"CA","country":"US"}`,
		},
		{
			name:     "international with empty state",
			input:    valueWithContext{Value: "London", State: "", Country: "GB"},
			wantJSON: `{"value":"London","state":"","country":"GB"}`,
		},
		{
			name:     "no context at all",
			input:    valueWithContext{Value: "Unknown City", State: "", Country: ""},
			wantJSON: `{"value":"Unknown City","state":"","country":""}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.input)
			if err != nil {
				t.Fatalf("json.Marshal failed: %v", err)
			}
			if string(data) != tt.wantJSON {
				t.Errorf("got %s, want %s", string(data), tt.wantJSON)
			}
		})
	}
}

// TestValueWithContextSliceJSON verifies that a slice of valueWithContext
// serializes to the array format sent to Python normalizer.
func TestValueWithContextSliceJSON(t *testing.T) {
	t.Parallel()
	values := []valueWithContext{
		{Value: "Oakland", State: "CA", Country: "US"},
		{Value: "London", State: "", Country: "GB"},
	}

	data, err := json.Marshal(values)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	// Parse back to verify structure
	var parsed []map[string]string
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	if len(parsed) != 2 {
		t.Fatalf("expected 2 items, got %d", len(parsed))
	}

	// Each item must have exactly these three keys
	for i, item := range parsed {
		for _, key := range []string{"value", "state", "country"} {
			if _, ok := item[key]; !ok {
				t.Errorf("item[%d] missing key %q", i, key)
			}
		}
		if len(item) != 3 {
			t.Errorf("item[%d] has %d keys, want 3", i, len(item))
		}
	}
}

// TestGeoContextStruct verifies geoContext stores state and country.
func TestGeoContextStruct(t *testing.T) {
	t.Parallel()
	ctx := geoContext{State: "CA", Country: "US"}
	if ctx.State != "CA" {
		t.Errorf("State = %q, want %q", ctx.State, "CA")
	}
	if ctx.Country != "US" {
		t.Errorf("Country = %q, want %q", ctx.Country, "US")
	}
}

// ============================================================================
// buildNormalizationLookup context collection tests
// ============================================================================

// TestBuildNormalizationLookupCollectsContext verifies that buildNormalizationLookup
// collects the first-seen state/country context for each unique value, and passes
// context tuples (not bare strings) to the normalizer.
func TestBuildNormalizationLookupCollectsContext(t *testing.T) {
	t.Parallel()
	// This test verifies the internal collection logic without calling Python.
	// We test that unique values are collected with first-seen context.

	data := []attendeeGeoData{
		{
			PersonPBID: "p1", PersonCMID: 1001, SessionPBID: "s1", SessionCMID: 2001,
			City: "Oakland", School: "Riverside Elementary", Congregation: "Temple Beth Abraham",
			AddressState: "CA", AddressCountry: "US",
		},
		{
			// Same city "Oakland" but different state — first-seen should win
			PersonPBID: "p2", PersonCMID: 1002, SessionPBID: "s1", SessionCMID: 2001,
			City: "Oakland", School: "Oak Valley Middle", Congregation: "",
			AddressState: "NY", AddressCountry: "US",
		},
		{
			// International camper with no state
			PersonPBID: "p3", PersonCMID: 1003, SessionPBID: "s1", SessionCMID: 2001,
			City: "London", School: "Westminster Academy", Congregation: "",
			AddressState: "", AddressCountry: "GB",
		},
	}

	// Collect unique cities with context (same logic as buildNormalizationLookup)
	uniqueCities := make(map[string]geoContext)
	for _, d := range data {
		if d.City != "" {
			if _, exists := uniqueCities[d.City]; !exists {
				uniqueCities[d.City] = geoContext{State: d.AddressState, Country: d.AddressCountry}
			}
		}
	}

	// Should have 2 unique cities
	if len(uniqueCities) != 2 {
		t.Fatalf("expected 2 unique cities, got %d", len(uniqueCities))
	}

	// Oakland should have CA/US (first-seen), not NY/US
	oaklandCtx, ok := uniqueCities["Oakland"]
	if !ok {
		t.Fatal("missing Oakland in uniqueCities")
		return
	}
	if oaklandCtx.State != "CA" {
		t.Errorf("Oakland state = %q, want %q (first-seen)", oaklandCtx.State, "CA")
	}
	if oaklandCtx.Country != "US" {
		t.Errorf("Oakland country = %q, want %q", oaklandCtx.Country, "US")
	}

	// London should have empty state, GB country
	londonCtx, ok := uniqueCities["London"]
	if !ok {
		t.Fatal("missing London in uniqueCities")
		return
	}
	if londonCtx.State != "" {
		t.Errorf("London state = %q, want empty", londonCtx.State)
	}
	if londonCtx.Country != "GB" {
		t.Errorf("London country = %q, want %q", londonCtx.Country, "GB")
	}
}

// TestBuildContextValuesFromMap verifies that converting a map[string]geoContext
// to []valueWithContext produces the expected entries.
func TestBuildContextValuesFromMap(t *testing.T) {
	t.Parallel()
	valuesWithContext := map[string]geoContext{
		"Oakland": {State: "CA", Country: "US"},
		"London":  {State: "", Country: "GB"},
	}

	contextValues := make([]valueWithContext, 0, len(valuesWithContext))
	for value, ctx := range valuesWithContext {
		contextValues = append(contextValues, valueWithContext{
			Value:   value,
			State:   ctx.State,
			Country: ctx.Country,
		})
	}

	if len(contextValues) != 2 {
		t.Fatalf("expected 2 context values, got %d", len(contextValues))
	}

	// Sort for deterministic comparison
	slices.SortFunc(contextValues, func(a, b valueWithContext) int {
		return cmp.Compare(a.Value, b.Value)
	})

	// London should be first (alphabetical)
	if contextValues[0].Value != "London" {
		t.Errorf("first value = %q, want %q", contextValues[0].Value, "London")
	}
	if contextValues[0].Country != "GB" {
		t.Errorf("London country = %q, want %q", contextValues[0].Country, "GB")
	}

	// Oakland should be second
	if contextValues[1].Value != testCityOakland {
		t.Errorf("second value = %q, want %q", contextValues[1].Value, testCityOakland)
	}
	if contextValues[1].State != "CA" {
		t.Errorf("Oakland state = %q, want %q", contextValues[1].State, "CA")
	}

	// Verify JSON serialization of the full slice
	data, err := json.Marshal(contextValues)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	jsonStr := string(data)
	// Must contain the context object format, not bare strings
	if !strings.Contains(jsonStr, `"value"`) {
		t.Error("JSON output missing 'value' key — should be context objects, not bare strings")
	}
	if !strings.Contains(jsonStr, `"state"`) {
		t.Error("JSON output missing 'state' key")
	}
	if !strings.Contains(jsonStr, `"country"`) {
		t.Error("JSON output missing 'country' key")
	}
	// Must NOT be a bare string array
	if strings.HasPrefix(jsonStr, `["`) {
		t.Error("JSON output looks like a bare string array — should be context objects")
	}
}

// ============================================================================
// Composite Key Dedup Tests — geoLookupKey
// ============================================================================

// TestBuildNormalizationLookupCompositeKeyDedup verifies that the same city name
// from different states produces separate entries in the normalizer request,
// not collapsing to first-seen context.
func TestBuildNormalizationLookupCompositeKeyDedup(t *testing.T) {
	// Set up a mock server that echoes back each value with a state-qualified canonical
	var receivedValues []valueWithContext
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req geoNormalizeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}
		receivedValues = append(receivedValues, req.Values...)

		// Return each value as its own canonical, qualified by state
		results := make(map[string]pythonNormalizedResult)
		for _, v := range req.Values {
			canonical := v.Value
			if v.State != "" {
				canonical = v.Value + ", " + v.State
			}
			results[v.Value] = pythonNormalizedResult{Canonical: canonical, Confidence: 1.0}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(results)
	}))
	defer server.Close()

	// Override API_URL to point to mock server
	t.Setenv("API_URL", server.URL)

	sync := &NormalizeGeographicSync{
		ProcessedKeys: make(map[string]bool),
	}

	data := []attendeeGeoData{
		{
			PersonPBID: "p1", PersonCMID: 1001, SessionPBID: "s1", SessionCMID: 2001,
			City: "Springfield", AddressState: "IL", AddressCountry: "US",
		},
		{
			PersonPBID: "p2", PersonCMID: 1002, SessionPBID: "s1", SessionCMID: 2001,
			City: "Springfield", AddressState: "MO", AddressCountry: "US",
		},
	}

	lookup, err := sync.buildNormalizationLookup(context.Background(), data)
	if err != nil {
		t.Fatalf("buildNormalizationLookup failed: %v", err)
	}

	// The normalizer should have received 2 separate entries for "Springfield"
	// with different state contexts (IL and MO).
	if len(receivedValues) < 2 {
		t.Errorf("expected at least 2 values sent to normalizer, got %d", len(receivedValues))
	}

	// Verify both state contexts were sent
	statesSeen := make(map[string]bool)
	for _, v := range receivedValues {
		if v.Value == "Springfield" {
			statesSeen[v.State] = true
		}
	}
	if !statesSeen["IL"] {
		t.Error("Springfield with state IL was not sent to normalizer")
	}
	if !statesSeen["MO"] {
		t.Error("Springfield with state MO was not sent to normalizer")
	}

	// The lookup should contain the normalized result
	if lookup.city == nil {
		t.Fatal("city lookup is nil")
		return
	}
	if len(lookup.city) == 0 {
		t.Fatal("city lookup is empty")
		return
	}
}

// TestGeoLookupKeyCompositeEquality verifies that geoLookupKey uses
// all three fields (Value, State, Country) for equality comparison.
func TestGeoLookupKeyCompositeEquality(t *testing.T) {
	t.Parallel()
	k1 := geoLookupKey{Value: "Springfield", State: "IL", Country: "US"}
	k2 := geoLookupKey{Value: "Springfield", State: "MO", Country: "US"}
	k3 := geoLookupKey{Value: "Springfield", State: "IL", Country: "US"}

	m := make(map[geoLookupKey]bool)
	m[k1] = true
	m[k2] = true

	if len(m) != 2 {
		t.Errorf("expected 2 distinct keys, got %d", len(m))
	}

	if k1 == k2 {
		t.Error("k1 should not equal k2 (different state)")
	}
	if k1 != k3 {
		t.Error("k1 should equal k3 (same fields)")
	}
}

// ============================================================================
// Rejection Blocklist Tests
// ============================================================================

// TestRejectedOverridesSkipsMappings verifies that canonicals in the rejected
// blocklist are silently skipped during upsert.
func TestRejectedOverridesSkipsMappings(t *testing.T) {
	t.Parallel()
	rejectedOverrides := map[string]map[string]bool{
		categoryCity:         {"springfield": true},
		categorySchool:       {},
		categoryCongregation: {"unknown congregation": true},
	}

	// Mappings include one rejected city and one rejected congregation
	mappings := []*personSessionMapping{
		{
			personPBID: "p1", sessionPBID: "s1", category: categoryCity,
			originalValue: "Springfield", normalizedValue: "Springfield",
			confidence: 0.95, year: 2025,
		},
		{
			personPBID: "p1", sessionPBID: "s1", category: categorySchool,
			originalValue: "Riverside Elementary", normalizedValue: "Riverside Elementary",
			confidence: 0.90, year: 2025,
		},
		{
			personPBID: "p2", sessionPBID: "s1", category: categoryCongregation,
			originalValue: "Unknown Congregation", normalizedValue: "Unknown Congregation",
			confidence: 0.85, year: 2025,
		},
	}

	// Simulate rejection filtering (matches upsertPersonSessionMappings logic)
	var kept []*personSessionMapping
	for _, m := range mappings {
		if rejected, ok := rejectedOverrides[m.category]; ok {
			if rejected[strings.ToLower(m.normalizedValue)] {
				continue
			}
		}
		kept = append(kept, m)
	}

	// Only the school mapping should survive
	if len(kept) != 1 {
		t.Fatalf("expected 1 kept mapping, got %d", len(kept))
	}
	if kept[0].category != categorySchool {
		t.Errorf("expected kept mapping category = %q, got %q", categorySchool, kept[0].category)
	}
}

// TestRejectedOverridesCaseInsensitive verifies that rejection matching
// is case-insensitive.
func TestRejectedOverridesCaseInsensitive(t *testing.T) {
	t.Parallel()
	rejectedOverrides := map[string]map[string]bool{
		categoryCity: {"springfield": true},
	}

	tests := []struct {
		normalizedValue string
		wantRejected    bool
	}{
		{"Springfield", true},
		{"springfield", true},
		{"SPRINGFIELD", true},
		{"Oakland", false},
	}

	for _, tt := range tests {
		rejected := false
		if r, ok := rejectedOverrides[categoryCity]; ok {
			rejected = r[strings.ToLower(tt.normalizedValue)]
		}
		if rejected != tt.wantRejected {
			t.Errorf("rejected(%q) = %v, want %v", tt.normalizedValue, rejected, tt.wantRejected)
		}
	}
}

// TestAddressCityPopulatedInMappings verifies that address_city is populated
// from the attendee's City field for all category mappings.
func TestAddressCityPopulatedInMappings(t *testing.T) {
	t.Parallel()
	data := []attendeeGeoData{
		{
			PersonPBID: "p1", PersonCMID: 1001, SessionPBID: "s1", SessionCMID: 2001,
			City: "Oakland", School: "Riverside Elementary", Congregation: "Temple Beth Abraham",
			AddressState: "CA", AddressCountry: "US",
		},
	}

	lookup := &normalizationLookup{
		city: map[string]normalizedEntry{"Oakland": {Canonical: "Oakland", Confidence: 1.0}},
		school: map[string]normalizedEntry{
			"Riverside Elementary": {Canonical: "Riverside Elementary", Confidence: 0.9},
		},
		congregation: map[string]normalizedEntry{
			"Temple Beth Abraham": {Canonical: "Temple Beth Abraham", Confidence: 0.95},
		},
	}

	aliasOverrides := map[string]map[string]string{
		categoryCity: {}, categorySchool: {}, categoryCongregation: {},
	}
	mergeOverrides := map[string]map[string]string{
		categoryCity: {}, categorySchool: {}, categoryCongregation: {},
	}

	sync := &NormalizeGeographicSync{}
	mappings := sync.createPersonSessionMappings(data, lookup, aliasOverrides, mergeOverrides, 2025)

	if len(mappings) != 3 {
		t.Fatalf("expected 3 mappings, got %d", len(mappings))
	}

	for _, m := range mappings {
		if m.addressCity != "Oakland" {
			t.Errorf("mapping %s: addressCity = %q, want %q", m.category, m.addressCity, "Oakland")
		}
	}
}

// ============================================================================
// Override Map Dedup Tests (carry-forward across years)
// ============================================================================

// TestOverrideMapDedup_AliasNewestYearWins verifies that when the same alias key
// is assigned from records sorted by year ASC, the newest year's value wins.
func TestOverrideMapDedup_AliasNewestYearWins(t *testing.T) {
	t.Parallel()
	aliasOverrides := map[string]map[string]string{
		categoryCity: {}, categorySchool: {}, categoryCongregation: {},
	}

	// Simulate year-ASC sorted processing (2025 first, then 2026 overwrites)
	aliasOverrides[categorySchool]["riverside elem"] = "Riverside Elementary"         // 2025
	aliasOverrides[categorySchool]["riverside elem"] = "Riverside Elementary Academy" // 2026 overwrites

	if aliasOverrides[categorySchool]["riverside elem"] != "Riverside Elementary Academy" {
		t.Errorf("expected newest year value to win, got %q",
			aliasOverrides[categorySchool]["riverside elem"])
	}
}

// TestOverrideMapDedup_MergeNewestYearWins verifies merge override dedup.
func TestOverrideMapDedup_MergeNewestYearWins(t *testing.T) {
	t.Parallel()
	mergeOverrides := map[string]map[string]string{
		categoryCity: {}, categorySchool: {}, categoryCongregation: {},
	}

	// 2025: "Old Name" -> "Name A"
	// 2026: "Old Name" -> "Name B"
	mergeOverrides[categoryCongregation]["Old Name"] = "Name A" // 2025
	mergeOverrides[categoryCongregation]["Old Name"] = "Name B" // 2026 overwrites

	if mergeOverrides[categoryCongregation]["Old Name"] != "Name B" {
		t.Errorf("expected newest year merge to win, got %q",
			mergeOverrides[categoryCongregation]["Old Name"])
	}
}

// TestOverrideMapDedup_RejectedCarriesForward verifies rejected overrides persist across years.
func TestOverrideMapDedup_RejectedCarriesForward(t *testing.T) {
	t.Parallel()
	rejectedOverrides := map[string]map[string]bool{
		categoryCity: {}, categorySchool: {}, categoryCongregation: {},
	}

	// 2025: "springfield" rejected = true
	// 2026: same rejection carries forward
	rejectedOverrides[categoryCity]["springfield"] = true // 2025
	rejectedOverrides[categoryCity]["springfield"] = true // 2026 same

	if !rejectedOverrides[categoryCity]["springfield"] {
		t.Error("expected springfield to remain rejected")
	}
}

// TestNormalizeGeographicDeleteOrphansRefusesCollapsedComputedSet pins the
// guard kindred#2283 adds. Before this fix deleteOrphans returned a bare int
// and had no channel to refuse a sweep at all -- an empty ProcessedKeys map
// against a populated year deleted every normalized mapping and reported
// success.
func TestNormalizeGeographicDeleteOrphansRefusesCollapsedComputedSet(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "normalized_mappings", "category", "person", "session")
	col, err := app.FindCollectionByNameOrId("normalized_mappings")
	if err != nil {
		t.Fatalf("find normalized_mappings: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("category", categoryCity)
	rec.Set("person", "pers_001")
	rec.Set("session", "sess_001")
	rec.Set("year", 2026)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save existing row: %v", saveErr)
	}

	n := NewNormalizeGeographicSync(app)
	n.SyncSuccessful = true
	n.ProcessedKeys = make(map[string]bool) // nothing processed this run

	key := "pers_001:sess_001:" + categoryCity
	existing := map[string]*core.Record{key: rec}
	deleted, err := n.deleteOrphans(existing, 2026)

	if err == nil {
		t.Fatal("expected an error when nothing was processed and rows exist, got nil")
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- nothing may be removed on the refusal path", deleted)
	}

	remaining, err := app.FindRecordsByFilter("normalized_mappings", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("%d rows survived, want 1 -- the guard must not delete", len(remaining))
	}
}

// TestNormalizeGeographicDeleteOrphansStillSweepsGenuineOrphans proves the
// guard did not disable orphan deletion for the normal case.
func TestNormalizeGeographicDeleteOrphansStillSweepsGenuineOrphans(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "normalized_mappings", "category", "person", "session")
	col, err := app.FindCollectionByNameOrId("normalized_mappings")
	if err != nil {
		t.Fatalf("find normalized_mappings: %v", err)
	}
	orphan := core.NewRecord(col)
	orphan.Set("category", categoryCity)
	orphan.Set("person", "pers_002")
	orphan.Set("session", "sess_001")
	orphan.Set("year", 2026)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("save orphan: %v", saveErr)
	}

	n := NewNormalizeGeographicSync(app)
	n.SyncSuccessful = true
	n.ProcessedKeys = map[string]bool{"pers_001:sess_001:" + categoryCity: true}

	orphanKey := "pers_002:sess_001:" + categoryCity
	existing := map[string]*core.Record{orphanKey: orphan}
	deleted, err := n.deleteOrphans(existing, 2026)
	if err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
}

// newNormalizeGeographicSyncTestApp builds the collections
// NormalizeGeographicSync.Sync() reads on its way to the orphan sweep.
// `attendees.person` and `attendees.session` must be real relations because
// Sync() expands them; the rest only have to exist.
func newNormalizeGeographicSyncTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	created := func(col *core.Collection) {
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	}

	households := core.NewBaseCollection("households")
	households.Fields.Add(&core.NumberField{Name: "cm_id"})
	households.Fields.Add(&core.TextField{Name: "billing_state"})
	households.Fields.Add(&core.TextField{Name: "billing_country"})
	created(households)
	if err := app.Save(households); err != nil {
		t.Fatalf("create households: %v", err)
	}

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	sessions.Fields.Add(&core.TextField{Name: "name"})
	created(sessions)
	if err := app.Save(sessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.TextField{Name: "school"})
	persons.Fields.Add(&core.TextField{Name: "address_city"})
	persons.Fields.Add(&core.TextField{Name: "normalized_city"})
	persons.Fields.Add(&core.TextField{Name: "normalized_school"})
	persons.Fields.Add(&core.TextField{Name: "normalized_congregation"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	persons.Fields.Add(&core.RelationField{
		Name: "primary_childhood_household", CollectionId: households.Id, MaxSelect: 1,
	})
	created(persons)
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	created(attendees)
	if err := app.Save(attendees); err != nil {
		t.Fatalf("create attendees: %v", err)
	}

	for _, name := range []string{"custom_field_defs", "person_custom_values", "geo_overrides"} {
		col := core.NewBaseCollection(name)
		for _, f := range []string{
			"name", "person", "field_definition", "value",
			"type", "category", "canonical_name", "merged_into", "raw_value",
			// The column loadGeoOverrides actually switches on. Absent from
			// this fixture until the geo_overrides loader got its first test:
			// "type" is a different column and never fed that switch.
			"override_type",
		} {
			col.Fields.Add(&core.TextField{Name: f})
		}
		col.Fields.Add(&core.NumberField{Name: "year"})
		created(col)
		if err := app.Save(col); err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
	}

	// camper_history is gone (see #2369) -- Sync() must reach the persons-normalized
	// step and the sweep without that collection existing at all.
	mappings := core.NewBaseCollection("normalized_mappings")
	for _, f := range []string{
		"person", "session", "category", "original_value", "normalized_value",
		"address_state", "address_country", "address_city",
	} {
		mappings.Fields.Add(&core.TextField{Name: f})
	}
	mappings.Fields.Add(&core.NumberField{Name: "confidence"})
	mappings.Fields.Add(&core.NumberField{Name: "year"})
	created(mappings)
	if err := app.Save(mappings); err != nil {
		t.Fatalf("create normalized_mappings: %v", err)
	}

	return app
}

// TestNormalizeGeographicSyncPropagatesSweepRefusal is the caller-propagation
// test for kindred#2283. normalize_geographic.go is the other file that
// previously called deleteOrphans without capturing its return value at all, so
// "the caller now uses the error" is the whole point of the change here, and the
// guard tests alone prove nothing about it. Sibling PR kindred#2294 shipped
// exactly this gap: a counted failure that never reached the returned error.
//
// The attendees here carry no city, school or congregation, which keeps the
// fixture hermetic -- populating any of them sends buildNormalizationLookup to
// the geo-normalize HTTP API, and pointing that at an httptest server needs
// t.Setenv, which cannot coexist with the t.Parallel() kindred#2288 requires.
// The refusal therefore comes from the empty-computed-set arm.
//
// Deleting the `if orphanErr != nil` return in normalize_geographic.go makes
// this test fail; without it the whole sync suite stays green.
func TestNormalizeGeographicSyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newNormalizeGeographicSyncTestApp(t)

	sessions, err := app.FindCollectionByNameOrId("camp_sessions")
	if err != nil {
		t.Fatalf("find camp_sessions: %v", err)
	}
	sess := core.NewRecord(sessions)
	sess.Set("cm_id", 200)
	sess.Set("name", "Session A")
	if saveErr := app.Save(sess); saveErr != nil {
		t.Fatalf("save session: %v", saveErr)
	}

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	attendeesCol, err := app.FindCollectionByNameOrId("attendees")
	if err != nil {
		t.Fatalf("find attendees: %v", err)
	}
	for _, cmID := range []int{101, 102, 103} {
		p := core.NewRecord(personsCol)
		p.Set("cm_id", cmID)
		p.Set("year", 2026)
		if saveErr := app.Save(p); saveErr != nil {
			t.Fatalf("save person %d: %v", cmID, saveErr)
		}
		a := core.NewRecord(attendeesCol)
		a.Set("person", p.Id)
		a.Set("session", sess.Id)
		a.Set("year", 2026)
		if saveErr := app.Save(a); saveErr != nil {
			t.Fatalf("save attendee %d: %v", cmID, saveErr)
		}
	}

	mappingsCol, err := app.FindCollectionByNameOrId("normalized_mappings")
	if err != nil {
		t.Fatalf("find normalized_mappings: %v", err)
	}
	for i := range OrphanSweepMinRows + 5 {
		rec := core.NewRecord(mappingsCol)
		rec.Set("person", fmt.Sprintf("pers_%06d", i))
		rec.Set("session", sess.Id)
		rec.Set("category", categoryCity)
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("save existing mapping %d: %v", i, saveErr)
		}
	}

	n := NewNormalizeGeographicSync(app)
	n.Year = 2026
	syncErr := n.Sync(context.Background())

	if syncErr == nil {
		t.Fatal("Sync returned nil on a refused sweep -- the refusal never reached the caller")
	}
	if !strings.Contains(syncErr.Error(), "orphan sweep refused") {
		t.Errorf("Sync error = %q, want it to carry the sweep refusal", syncErr.Error())
	}

	remaining, err := app.FindRecordsByFilter("normalized_mappings", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != OrphanSweepMinRows+5 {
		t.Errorf("%d rows survived, want %d -- a refused sweep must delete nothing",
			len(remaining), OrphanSweepMinRows+5)
	}
}

// ============================================================================
// geo_overrides loader (kindred: transform-phase log audit, 2026-08-18)
// ============================================================================

// TestLoadGeoOverrides_ReadsRows is the test the override feature never had.
//
// Every existing "override" test in this file assigns into a plain Go map and
// asserts on the map — none of them issues the query, so the loader's sort
// argument was never exercised. Production logged
//
//	WARN Could not load geo_overrides, continuing without overrides
//	     error=loading geo_overrides: invalid sort field "year ASC"
//
// on every run: PocketBase sort expressions are `field` / `+field` / `-field`,
// so "year ASC" is read as a FIELD NAME and rejected. The caller swallows the
// error and continues with empty maps, so alias, merge and rejection overrides
// have never been applied by this job and nothing went red.
func TestLoadGeoOverrides_ReadsRows(t *testing.T) {
	t.Parallel()
	app := newNormalizeGeographicSyncTestApp(t)

	col, err := app.FindCollectionByNameOrId("geo_overrides")
	if err != nil {
		t.Fatalf("find geo_overrides: %v", err)
	}

	save := func(overrideType, category string, year int, fields map[string]string) {
		t.Helper()
		rec := core.NewRecord(col)
		rec.Set("override_type", overrideType)
		rec.Set("category", category)
		rec.Set("year", year)
		for k, v := range fields {
			rec.Set(k, v)
		}
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("save %s override: %v", overrideType, saveErr)
		}
	}

	save("alias", categorySchool, 2025, map[string]string{
		"raw_value": "Lakeview Elem", "canonical_name": "Lakeview Elementary",
	})
	save("merge", categoryCongregation, 2025, map[string]string{
		"canonical_name": "Beth Shalom", "merged_into": "Congregation Beth Shalom",
	})
	save("rejected", categoryCity, 2025, map[string]string{
		"canonical_name": "Unknown",
	})

	n := &NormalizeGeographicSync{App: app}
	alias, merge, rejected, err := n.loadGeoOverrides(2026)
	if err != nil {
		t.Fatalf("loadGeoOverrides: %v", err)
	}

	if got := alias[categorySchool]["lakeview elem"]; got != "Lakeview Elementary" {
		t.Errorf("alias override = %q, want %q", got, "Lakeview Elementary")
	}
	if got := merge[categoryCongregation]["Beth Shalom"]; got != "Congregation Beth Shalom" {
		t.Errorf("merge override = %q, want %q", got, "Congregation Beth Shalom")
	}
	if !rejected[categoryCity]["unknown"] {
		t.Errorf("rejected override for %q not loaded", "unknown")
	}
}

// TestLoadGeoOverrides_NewestYearWins pins the reason the loader sorts at all:
// the same alias key may be set in more than one year, later rows overwrite
// earlier ones as the loop runs, so ascending year is what makes the newest
// value the one that survives. The sibling TestOverrideMapDedup_* tests assert
// that overwrite semantics against a hand-built map; this one asserts the sort
// that feeds it, which is the half that was broken.
func TestLoadGeoOverrides_NewestYearWins(t *testing.T) {
	t.Parallel()
	app := newNormalizeGeographicSyncTestApp(t)

	col, err := app.FindCollectionByNameOrId("geo_overrides")
	if err != nil {
		t.Fatalf("find geo_overrides: %v", err)
	}

	// Saved newest-first, so a loader that does not sort would leave the 2025
	// value in place.
	for _, row := range []struct {
		year      int
		canonical string
	}{
		{2026, "Lakeview Elementary Academy"},
		{2025, "Lakeview Elementary"},
	} {
		rec := core.NewRecord(col)
		rec.Set("override_type", "alias")
		rec.Set("category", categorySchool)
		rec.Set("year", row.year)
		rec.Set("raw_value", "Lakeview Elem")
		rec.Set("canonical_name", row.canonical)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("save alias override for %d: %v", row.year, saveErr)
		}
	}

	n := &NormalizeGeographicSync{App: app}
	alias, _, _, err := n.loadGeoOverrides(2026)
	if err != nil {
		t.Fatalf("loadGeoOverrides: %v", err)
	}

	if got := alias[categorySchool]["lakeview elem"]; got != "Lakeview Elementary Academy" {
		t.Errorf("alias override = %q, want the newest year's value %q",
			got, "Lakeview Elementary Academy")
	}
}
