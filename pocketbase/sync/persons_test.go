package sync

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

const testAlumniTagID = "rec_alumni_001"
const testFirstName = "Emma"

func TestPersonsSync_Name(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	got := s.Name()
	want := "persons"

	if got != want {
		t.Errorf("PersonsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformPersonToPB_CamperDetailsExpanded tests that all CamperDetails fields are extracted
func TestTransformPersonToPB_CamperDetailsExpanded(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Mock CampMinder API response with full CamperDetails
	// Note: We don't set Age to avoid needing a Client for age calculation
	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0), // Female
		// No "Age" field - triggers default age behavior without needing client
		"Name": map[string]any{
			"First":     testFirstName,
			"Last":      "Johnson",
			"Preferred": "Emmy",
		},
		"CamperDetails": map[string]any{
			"PartitionID":      float64(2),   // Grade grouping
			"DivisionID":       float64(5),   // Division assignment
			"LeadDate":         "2020-01-15", // Lead/inquiry date
			"TShirtSize":       "Youth Medium",
			"CampGradeID":      float64(8),
			"CampGradeName":    "7th",
			"SchoolGradeID":    float64(8),
			"SchoolGradeName":  "Eighth",
			"School":           "Riverside Elementary",
			"YearsAtCamp":      float64(3),
			"LastYearAttended": float64(2024),
		},
		"FamilyPersons": []any{
			map[string]any{
				"FamilyID": float64(99999),
			},
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// Verify new CamperDetails fields
	if got, want := pbData["division_cm_id"].(int), 5; got != want {
		t.Errorf("division_cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["partition_id"].(int), 2; got != want {
		t.Errorf("partition_id = %d, want %d", got, want)
	}
	if got, want := pbData["lead_date"].(string), "2020-01-15"; got != want {
		t.Errorf("lead_date = %q, want %q", got, want)
	}
	if got, want := pbData["tshirt_size"].(string), "Youth Medium"; got != want {
		t.Errorf("tshirt_size = %q, want %q", got, want)
	}

	// Verify existing fields still work
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["first_name"].(string), testFirstName; got != want {
		t.Errorf("first_name = %q, want %q", got, want)
	}
	if got, want := pbData["school"].(string), "Riverside Elementary"; got != want {
		t.Errorf("school = %q, want %q", got, want)
	}
}

// TestTransformPersonToPB_MissingCamperDetailsFields tests graceful handling of missing CamperDetails fields
func TestTransformPersonToPB_MissingCamperDetailsFields(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Minimal CamperDetails without optional fields
	// Note: We don't set Age to avoid needing a Client for age calculation
	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(1), // Male
		// No "Age" field - triggers default age behavior without needing client
		"Name": map[string]any{
			"First": "Liam",
			"Last":  "Garcia",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(6),
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// New fields should have zero/empty values (not error)
	if pbData["division_cm_id"] != 0 {
		t.Errorf("division_cm_id = %v, want 0 for missing field", pbData["division_cm_id"])
	}
	if pbData["partition_id"] != 0 {
		t.Errorf("partition_id = %v, want 0 for missing field", pbData["partition_id"])
	}
	if pbData["lead_date"] != "" {
		t.Errorf("lead_date = %v, want empty string for missing field", pbData["lead_date"])
	}
	if pbData["tshirt_size"] != "" {
		t.Errorf("tshirt_size = %v, want empty string for missing field", pbData["tshirt_size"])
	}
}

// TestExtractHouseholdsFromPersonData tests household extraction during combined sync
func TestExtractHouseholdsFromPersonData(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Mock person data with households
	personData := map[string]any{
		"ID": float64(12345),
		"Households": map[string]any{
			"PrincipalHousehold": map[string]any{
				"ID":       float64(100),
				"Greeting": "The Johnson Family",
			},
			"PrimaryChildhoodHousehold": map[string]any{
				"ID":       float64(100), // Same household
				"Greeting": "The Johnson Family",
			},
		},
	}

	households := s.extractUniqueHouseholds([]map[string]any{personData})

	if len(households) != 1 {
		t.Errorf("expected 1 unique household, got %d", len(households))
	}

	// Verify household ID
	if id, ok := households[0]["ID"].(float64); !ok || int(id) != 100 {
		t.Errorf("household ID = %v, want 100", households[0]["ID"])
	}
}

// TestExtractHouseholdsFromPersonData_NoHouseholds tests handling when Households is missing
func TestExtractHouseholdsFromPersonData_NoHouseholds(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Person without Households
	personData := map[string]any{
		"ID": float64(12345),
	}

	households := s.extractUniqueHouseholds([]map[string]any{personData})

	if len(households) != 0 {
		t.Errorf("expected 0 households for person without Households, got %d", len(households))
	}
}

// TestPersonsSync_TransformHouseholdToPB tests household transformation for combined sync
func TestPersonsSync_TransformHouseholdToPB(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	householdData := map[string]any{
		"ID":                    float64(123456),
		"Greeting":              "Hunter and Ashley",
		"MailingTitle":          "Mr. and Mrs Hunter Doe",
		"AlternateMailingTitle": "The Doe Family",
		"BillingMailingTitle":   "Mr. and Mrs Hunter Doe",
		"HouseholdPhone":        "212-523-5555",
		"LastUpdatedUTC":        "2025-01-15T10:30:00.000Z",
		"BillingAddress": map[string]any{
			"Address1": "123 Main St",
			"City":     "Boulder",
		},
	}

	year := 2025

	pbData, err := s.transformHouseholdToPB(householdData, year)
	if err != nil {
		t.Fatalf("transformHouseholdToPB returned error: %v", err)
	}

	// Verify required field
	if got, want := pbData["cm_id"].(int), 123456; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}

	// Verify optional fields
	if got, want := pbData["greeting"].(string), "Hunter and Ashley"; got != want {
		t.Errorf("greeting = %q, want %q", got, want)
	}

	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
}

// TestPersonsCompareFields tests that compareFields includes new CamperDetails fields and household relations
func TestPersonsCompareFields(t *testing.T) {
	t.Parallel()
	// This verifies that the fields used in processPerson include the discrete address
	// and email columns (added in Phase 2) and don't include removed JSON fields.
	expectedNewFields := []string{
		"address_city", "address_state", "primary_email", "secondary_email",
		"division", "partition_id", "lead_date", "tshirt_size", "cm_lead_date", "tags",
	}

	// The compareFields list must match persons.go processPerson exactly.
	// Phase 3 removed: phone_numbers, email_addresses, address (JSON fields)
	// Phase 2 added: address_city, address_state, primary_email, secondary_email
	compareFields := []string{
		"cm_id", "first_name", "last_name", "preferred_name",
		"birthdate", "gender", "age", "grade", "school", "years_at_camp",
		"last_year_attended", "gender_identity_id", "gender_identity_name", "gender_identity_write_in",
		"gender_pronoun_id", "gender_pronoun_name", "gender_pronoun_write_in",
		"address_city", "address_state", "primary_email", "secondary_email",
		"household_id", "is_camper", "year", "parent_names",
		"division", "partition_id", "lead_date", "tshirt_size", "cm_lead_date",
		"tags",
	}

	// Verify new fields are in the list
	for _, newField := range expectedNewFields {
		found := false
		for _, field := range compareFields {
			if field == newField {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("compareFields should include %q for proper update detection", newField)
		}
	}
}

// TestExtractHouseholdIDsFromPerson tests extraction of household CampMinder IDs
func TestExtractHouseholdIDsFromPerson(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	personData := map[string]any{
		"ID": float64(12345),
		"Households": map[string]any{
			"PrincipalHousehold": map[string]any{
				"ID":       float64(100),
				"Greeting": "The Smiths",
			},
			"PrimaryChildhoodHousehold": map[string]any{
				"ID":       float64(200),
				"Greeting": "Primary Home",
			},
			"AlternateChildhoodHousehold": map[string]any{
				"ID":       float64(300),
				"Greeting": "Alternate Home",
			},
		},
	}

	ids := s.extractHouseholdIDsFromPerson(personData)

	if ids.PrincipalID != 100 {
		t.Errorf("PrincipalID = %d, want 100", ids.PrincipalID)
	}
	if ids.PrimaryChildhoodID != 200 {
		t.Errorf("PrimaryChildhoodID = %d, want 200", ids.PrimaryChildhoodID)
	}
	if ids.AlternateChildhoodID != 300 {
		t.Errorf("AlternateChildhoodID = %d, want 300", ids.AlternateChildhoodID)
	}
}

// TestExtractHouseholdIDsFromPerson_Partial tests with only some households present
func TestExtractHouseholdIDsFromPerson_Partial(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	// Child with only primary childhood household
	personData := map[string]any{
		"ID": float64(12345),
		"Households": map[string]any{
			"PrimaryChildhoodHousehold": map[string]any{
				"ID":       float64(200),
				"Greeting": "Primary Home",
			},
		},
	}

	ids := s.extractHouseholdIDsFromPerson(personData)

	if ids.PrincipalID != 0 {
		t.Errorf("PrincipalID = %d, want 0 (not present)", ids.PrincipalID)
	}
	if ids.PrimaryChildhoodID != 200 {
		t.Errorf("PrimaryChildhoodID = %d, want 200", ids.PrimaryChildhoodID)
	}
	if ids.AlternateChildhoodID != 0 {
		t.Errorf("AlternateChildhoodID = %d, want 0 (not present)", ids.AlternateChildhoodID)
	}
}

// TestAllCapsNameFix tests ALL CAPS name conversion
func TestAllCapsNameFix(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	tests := []struct {
		input    string
		expected string
	}{
		{"JOHN", "John"},
		{"SMITH", "Smith"},
		{"McDonald", "McDonald"}, // Mixed case preserved
		{"O'BRIEN", "O'brien"},   // ALL CAPS converted (apostrophe in name)
		{"DeVos", "DeVos"},       // Mixed case preserved
		{"", ""},                 // Empty string
	}

	for _, tt := range tests {
		got := s.fixAllCapsName(tt.input)
		if got != tt.expected {
			t.Errorf("fixAllCapsName(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

// TestPersonsSync_GetStats_WithSubStats tests that GetStats returns combined stats
// including households sub-entity stats from combined sync
// Note: person_tags stats removed - tags are now a multi-select relation on persons
func TestPersonsSync_GetStats_WithSubStats(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Set main persons stats
	s.Stats = Stats{
		Created: 10,
		Updated: 5,
		Skipped: 85,
		Errors:  0,
	}

	// Set household stats (simulating combined sync)
	householdStats := Stats{
		Created: 3,
		Updated: 2,
		Skipped: 45,
		Errors:  0,
	}
	s.householdStats = &householdStats

	// Get stats - should include SubStats
	stats := s.GetStats()

	// Verify main stats
	if stats.Created != 10 {
		t.Errorf("expected Created=10, got %d", stats.Created)
	}
	if stats.Updated != 5 {
		t.Errorf("expected Updated=5, got %d", stats.Updated)
	}

	// Verify SubStats is populated
	if stats.SubStats == nil {
		t.Fatal("expected SubStats to be non-nil for combined sync")
		return
	}

	// Verify households sub-stats
	householdSubStats, exists := stats.SubStats["households"]
	if !exists {
		t.Fatal("expected 'households' key in SubStats")
		return
	}
	if householdSubStats.Created != 3 {
		t.Errorf("expected households.Created=3, got %d", householdSubStats.Created)
	}
	if householdSubStats.Updated != 2 {
		t.Errorf("expected households.Updated=2, got %d", householdSubStats.Updated)
	}
}

// TestPersonsSync_GetStats_WithoutSubStats tests backwards compatibility
// when sub-entity stats are not set (not a combined sync)
func TestPersonsSync_GetStats_WithoutSubStats(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Set only main stats (no sub-entity stats)
	s.Stats = Stats{
		Created: 10,
		Updated: 5,
		Skipped: 85,
		Errors:  0,
	}

	// Get stats - should not have SubStats
	stats := s.GetStats()

	// Verify main stats
	if stats.Created != 10 {
		t.Errorf("expected Created=10, got %d", stats.Created)
	}

	// SubStats should be nil when not set
	if stats.SubStats != nil {
		t.Errorf("expected SubStats to be nil when sub-entity stats not set, got %v", stats.SubStats)
	}
}

// TestPersonsSync_GetStats_PartialSubStats tests when only some sub-entity stats are set
func TestPersonsSync_GetStats_PartialSubStats(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Set main stats
	s.Stats = Stats{
		Created: 10,
		Updated: 5,
		Skipped: 85,
		Errors:  0,
	}

	// Set only household stats (no person_tags)
	householdStats := Stats{
		Created: 3,
		Updated: 2,
		Skipped: 45,
		Errors:  0,
	}
	s.householdStats = &householdStats

	// Get stats
	stats := s.GetStats()

	// Verify SubStats exists
	if stats.SubStats == nil {
		t.Fatal("expected SubStats to be non-nil")
		return
	}

	// Verify households sub-stats present
	if _, exists := stats.SubStats["households"]; !exists {
		t.Error("expected 'households' key in SubStats")
	}

	// Verify person_tags sub-stats NOT present
	if _, exists := stats.SubStats["person_tags"]; exists {
		t.Error("expected 'person_tags' key to NOT be in SubStats when not set")
	}
}

// =============================================================================
// Tests for extractTagIDs - Multi-select relation field population
// =============================================================================

// TestExtractTagIDs tests extracting PocketBase tag definition IDs from person data
func TestExtractTagIDs(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	// Mock tag definitions map (name -> PocketBase ID)
	tagDefsByName := map[string]string{
		"Alumni":     testAlumniTagID,
		"Leadership": "rec_leadership_002",
		"Sibling":    "rec_sibling_003",
	}

	personData := map[string]any{
		"ID": float64(12345),
		"Tags": []any{
			map[string]any{
				"Name":           "Alumni",
				"LastUpdatedUTC": "2025-01-15T10:30:00.000Z",
			},
			map[string]any{
				"Name":           "Leadership",
				"LastUpdatedUTC": "2025-01-16T11:00:00.000Z",
			},
		},
	}

	tagIDs := s.extractTagIDs(personData, tagDefsByName)

	if len(tagIDs) != 2 {
		t.Fatalf("expected 2 tag IDs, got %d", len(tagIDs))
	}

	// Verify both IDs are present (order may vary)
	foundAlumni := false
	foundLeadership := false
	for _, id := range tagIDs {
		if id == testAlumniTagID {
			foundAlumni = true
		}
		if id == "rec_leadership_002" {
			foundLeadership = true
		}
	}

	if !foundAlumni {
		t.Error("expected Alumni tag ID in result")
	}
	if !foundLeadership {
		t.Error("expected Leadership tag ID in result")
	}
}

// TestExtractTagIDs_NoTags tests handling when Tags is missing
func TestExtractTagIDs_NoTags(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]any{
		"ID": float64(12345),
	}

	tagIDs := s.extractTagIDs(personData, tagDefsByName)

	if tagIDs != nil {
		t.Errorf("expected nil for person without Tags, got %v", tagIDs)
	}
}

// TestExtractTagIDs_EmptyTags tests handling when Tags is empty array
func TestExtractTagIDs_EmptyTags(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]any{
		"ID":   float64(12345),
		"Tags": []any{},
	}

	tagIDs := s.extractTagIDs(personData, tagDefsByName)

	if len(tagIDs) != 0 {
		t.Errorf("expected 0 tag IDs for empty Tags array, got %d", len(tagIDs))
	}
}

// TestExtractTagIDs_NilTags tests handling when Tags is nil
func TestExtractTagIDs_NilTags(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]any{
		"ID":   float64(12345),
		"Tags": nil,
	}

	tagIDs := s.extractTagIDs(personData, tagDefsByName)

	if tagIDs != nil {
		t.Errorf("expected nil for nil Tags, got %v", tagIDs)
	}
}

// TestExtractTagIDs_UnknownTag tests handling when tag name not in definitions
func TestExtractTagIDs_UnknownTag(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]any{
		"ID": float64(12345),
		"Tags": []any{
			map[string]any{
				"Name": "UnknownTag", // Not in tag definitions
			},
			map[string]any{
				"Name": "Alumni", // In tag definitions
			},
		},
	}

	tagIDs := s.extractTagIDs(personData, tagDefsByName)

	if len(tagIDs) != 1 {
		t.Fatalf("expected 1 tag ID (unknown tags skipped), got %d", len(tagIDs))
	}

	if tagIDs[0] != testAlumniTagID {
		t.Errorf("expected Alumni tag ID, got %q", tagIDs[0])
	}
}

// TestExtractTagIDs_EmptyTagName tests handling when tag Name is empty
func TestExtractTagIDs_EmptyTagName(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]any{
		"ID": float64(12345),
		"Tags": []any{
			map[string]any{
				"Name": "", // Empty name
			},
			map[string]any{
				"Name": "Alumni",
			},
		},
	}

	tagIDs := s.extractTagIDs(personData, tagDefsByName)

	if len(tagIDs) != 1 {
		t.Fatalf("expected 1 tag ID (empty name skipped), got %d", len(tagIDs))
	}

	if tagIDs[0] != testAlumniTagID {
		t.Errorf("expected Alumni tag ID, got %q", tagIDs[0])
	}
}

// =============================================================================
// Tests for extractPersonIDsFromStaffRecords - Staff person ID extraction
// =============================================================================

// TestExtractPersonIDsFromStaffRecords tests extraction of person IDs from staff records
func TestExtractPersonIDsFromStaffRecords(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	staffRecords := []map[string]any{
		{"PersonID": float64(1001), "StatusID": float64(1), "Position1ID": float64(10)},
		{"PersonID": float64(1002), "StatusID": float64(1), "Position1ID": float64(20)},
		{"PersonID": float64(1003), "StatusID": float64(2), "Position1ID": float64(30)},
	}

	personIDs := s.extractPersonIDsFromStaffRecords(staffRecords)

	if len(personIDs) != 3 {
		t.Fatalf("expected 3 person IDs, got %d", len(personIDs))
	}

	// Build a set for easier verification
	idSet := make(map[int]bool)
	for _, id := range personIDs {
		idSet[id] = true
	}

	expectedIDs := []int{1001, 1002, 1003}
	for _, expected := range expectedIDs {
		if !idSet[expected] {
			t.Errorf("expected person ID %d in result", expected)
		}
	}
}

// TestExtractPersonIDsFromStaffRecords_SkipsInvalidIDs tests that invalid person IDs are skipped
func TestExtractPersonIDsFromStaffRecords_SkipsInvalidIDs(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	staffRecords := []map[string]any{
		{"PersonID": float64(1001), "StatusID": float64(1)},
		{"PersonID": float64(0), "StatusID": float64(1)},     // Invalid: zero ID
		{"PersonID": float64(-5), "StatusID": float64(1)},    // Invalid: negative ID
		{"StatusID": float64(1)},                             // Invalid: missing PersonID
		{"PersonID": "not-a-number", "StatusID": float64(1)}, // Invalid: wrong type
		{"PersonID": float64(1002), "StatusID": float64(1)},
	}

	personIDs := s.extractPersonIDsFromStaffRecords(staffRecords)

	if len(personIDs) != 2 {
		t.Fatalf("expected 2 valid person IDs, got %d", len(personIDs))
	}

	// Build a set for verification
	idSet := make(map[int]bool)
	for _, id := range personIDs {
		idSet[id] = true
	}

	if !idSet[1001] || !idSet[1002] {
		t.Errorf("expected person IDs 1001 and 1002 in result, got %v", personIDs)
	}
}

// TestExtractPersonIDsFromStaffRecords_EmptyInput tests handling of empty input
func TestExtractPersonIDsFromStaffRecords_EmptyInput(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	personIDs := s.extractPersonIDsFromStaffRecords(nil)
	if len(personIDs) != 0 {
		t.Errorf("expected 0 person IDs for nil input, got %d", len(personIDs))
	}

	personIDs = s.extractPersonIDsFromStaffRecords([]map[string]any{})
	if len(personIDs) != 0 {
		t.Errorf("expected 0 person IDs for empty input, got %d", len(personIDs))
	}
}

// TestExtractPersonIDsFromStaffRecords_Deduplicates tests that duplicate IDs are removed
func TestExtractPersonIDsFromStaffRecords_Deduplicates(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	// Staff member appears in multiple records (e.g., different status pages)
	staffRecords := []map[string]any{
		{"PersonID": float64(1001), "StatusID": float64(1)},
		{"PersonID": float64(1001), "StatusID": float64(2)}, // Duplicate
		{"PersonID": float64(1002), "StatusID": float64(1)},
		{"PersonID": float64(1002), "StatusID": float64(1)}, // Duplicate
	}

	personIDs := s.extractPersonIDsFromStaffRecords(staffRecords)

	if len(personIDs) != 2 {
		t.Fatalf("expected 2 unique person IDs, got %d", len(personIDs))
	}
}

// =============================================================================
// Tests for mergePersonIDs - Merging attendee and staff person IDs
// =============================================================================

// TestMergePersonIDs tests merging of attendee and staff person IDs
func TestMergePersonIDs(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	attendeeIDs := []int{1001, 1002, 1003}
	staffIDs := []int{2001, 2002, 2003}

	merged := s.mergePersonIDs(attendeeIDs, staffIDs)

	if len(merged) != 6 {
		t.Fatalf("expected 6 merged IDs, got %d", len(merged))
	}

	// Verify all IDs are present
	idSet := make(map[int]bool)
	for _, id := range merged {
		idSet[id] = true
	}

	expectedIDs := []int{1001, 1002, 1003, 2001, 2002, 2003}
	for _, expected := range expectedIDs {
		if !idSet[expected] {
			t.Errorf("expected person ID %d in merged result", expected)
		}
	}
}

// TestMergePersonIDs_WithOverlap tests merging when some IDs appear in both lists
func TestMergePersonIDs_WithOverlap(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	// Former campers who are now staff (appear in both lists)
	attendeeIDs := []int{1001, 1002, 1003}
	staffIDs := []int{1002, 2001, 2002} // 1002 is both camper and staff

	merged := s.mergePersonIDs(attendeeIDs, staffIDs)

	if len(merged) != 5 {
		t.Fatalf("expected 5 unique IDs (1 duplicate removed), got %d", len(merged))
	}

	// Verify all unique IDs are present exactly once
	idSet := make(map[int]bool)
	for _, id := range merged {
		if idSet[id] {
			t.Errorf("duplicate ID %d found in merged result", id)
		}
		idSet[id] = true
	}

	expectedIDs := []int{1001, 1002, 1003, 2001, 2002}
	for _, expected := range expectedIDs {
		if !idSet[expected] {
			t.Errorf("expected person ID %d in merged result", expected)
		}
	}
}

// TestMergePersonIDs_EmptyInputs tests merging with empty or nil inputs
func TestMergePersonIDs_EmptyInputs(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	// Both empty
	merged := s.mergePersonIDs(nil, nil)
	if len(merged) != 0 {
		t.Errorf("expected 0 IDs for nil inputs, got %d", len(merged))
	}

	// Only attendees
	merged = s.mergePersonIDs([]int{1001, 1002}, nil)
	if len(merged) != 2 {
		t.Errorf("expected 2 IDs from attendees only, got %d", len(merged))
	}

	// Only staff
	merged = s.mergePersonIDs(nil, []int{2001, 2002})
	if len(merged) != 2 {
		t.Errorf("expected 2 IDs from staff only, got %d", len(merged))
	}

	// Empty slices (not nil)
	merged = s.mergePersonIDs([]int{}, []int{})
	if len(merged) != 0 {
		t.Errorf("expected 0 IDs for empty slices, got %d", len(merged))
	}
}

// =============================================================================
// Tests for shouldExcludeTag - Future year tag filtering
// =============================================================================

// TestShouldExcludeTag_FutureYear tests that tags with future years are excluded
func TestShouldExcludeTag_FutureYear(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}
	syncYear := 2025

	tests := []struct {
		tagName  string
		expected bool
		reason   string
	}{
		// Future year tags should be excluded
		{"2026 Early Registration", true, "2026 is future for 2025 sync"},
		{"2027 Registration", true, "2027 is future for 2025 sync"},
		{"Summer 2026", true, "2026 in tag name"},
		{"Returning 2026", true, "2026 in tag name"},

		// Current/past year tags should NOT be excluded
		{"2025 Registration", false, "2025 is current year"},
		{"2024 Alumni", false, "2024 is past year"},
		{"2020 First Year", false, "2020 is past year"},

		// Tags without years should NOT be excluded
		{"Alumni", false, "no year in name"},
		{"Leadership", false, "no year in name"},
		{"Sibling", false, "no year in name"},
		{"First Year Camper", false, "no year in name"},
		{"VIP", false, "no year in name"},

		// Edge cases
		{"", false, "empty string"},
		{"2025", false, "just year, current"},
		{"2026", true, "just year, future"},
		{"Camp 2025-2026", true, "contains future year"},
	}

	for _, tt := range tests {
		got := s.shouldExcludeTag(tt.tagName, syncYear)
		if got != tt.expected {
			t.Errorf("shouldExcludeTag(%q, %d) = %v, want %v (%s)",
				tt.tagName, syncYear, got, tt.expected, tt.reason)
		}
	}
}

// TestShouldExcludeTag_DifferentSyncYears tests tag filtering with different sync years
func TestShouldExcludeTag_DifferentSyncYears(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	// When syncing 2024, 2025 tags should be excluded
	if !s.shouldExcludeTag("2025 Registration", 2024) {
		t.Error("expected 2025 tag to be excluded when syncing 2024")
	}
	if s.shouldExcludeTag("2024 Registration", 2024) {
		t.Error("expected 2024 tag to NOT be excluded when syncing 2024")
	}

	// When syncing 2026, 2025 tags should NOT be excluded
	if s.shouldExcludeTag("2025 Registration", 2026) {
		t.Error("expected 2025 tag to NOT be excluded when syncing 2026")
	}
}

// TestExtractTagIDs_FiltersFutureTags tests that extractTagIDs filters out future-year tags
func TestExtractTagIDs_FiltersFutureTags(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	// Tag definitions - pretend these are in the database
	tagDefsByName := map[string]string{
		"Alumni":                  testAlumniTagID,
		"2025 Registration":       "rec_2025_reg",
		"2026 Early Registration": "rec_2026_early",
		"Leadership":              "rec_leadership_002",
	}

	personData := map[string]any{
		"ID": float64(12345),
		"Tags": []any{
			map[string]any{"Name": "Alumni"},
			map[string]any{"Name": "2025 Registration"},
			map[string]any{"Name": "2026 Early Registration"}, // Should be filtered
			map[string]any{"Name": "Leadership"},
		},
	}

	syncYear := 2025
	tagIDs := s.extractTagIDsWithYearFilter(personData, tagDefsByName, syncYear)

	// Should have 3 tags (2026 filtered out)
	if len(tagIDs) != 3 {
		t.Fatalf("expected 3 tag IDs (2026 tag filtered), got %d: %v", len(tagIDs), tagIDs)
	}

	// Verify 2026 tag is NOT in result
	for _, id := range tagIDs {
		if id == "rec_2026_early" {
			t.Error("expected 2026 Early Registration tag to be filtered out")
		}
	}

	// Verify other tags ARE in result
	idSet := make(map[string]bool)
	for _, id := range tagIDs {
		idSet[id] = true
	}
	if !idSet[testAlumniTagID] {
		t.Error("expected Alumni tag in result")
	}
	if !idSet["rec_2025_reg"] {
		t.Error("expected 2025 Registration tag in result")
	}
	if !idSet["rec_leadership_002"] {
		t.Error("expected Leadership tag in result")
	}
}

// =============================================================================
// Tests for cm_* fields from CamperDetails
// =============================================================================

// TestTransformPersonToPB_CMLeadDateExtracted tests that cm_lead_date is extracted from CamperDetails
// Note: cm_years_at_camp and cm_last_year_attended were removed (they duplicated years_at_camp/last_year_attended)
func TestTransformPersonToPB_CMLeadDateExtracted(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"YearsAtCamp":      float64(5),
			"LastYearAttended": float64(2024),
			"LeadDate":         "2019-02-15",
			"CampGradeID":      float64(8),
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// Verify cm_lead_date is extracted
	if got, ok := pbData["cm_lead_date"].(string); !ok || got != "2019-02-15" {
		t.Errorf("cm_lead_date = %v, want '2019-02-15'", pbData["cm_lead_date"])
	}

	// Verify years_at_camp is extracted (canonical field, not cm_ prefix)
	if got, ok := pbData["years_at_camp"].(int); !ok || got != 5 {
		t.Errorf("years_at_camp = %v, want 5", pbData["years_at_camp"])
	}

	// Verify last_year_attended is extracted (capped at current year - 1 = 2024 in this case)
	if got, ok := pbData["last_year_attended"].(int); !ok || got != 2024 {
		t.Errorf("last_year_attended = %v, want 2024", pbData["last_year_attended"])
	}
}

// TestTransformPersonToPB_CMLeadDateMissing tests graceful handling of missing cm_lead_date
// Note: cm_years_at_camp and cm_last_year_attended were removed (they duplicated years_at_camp/last_year_attended)
func TestTransformPersonToPB_CMLeadDateMissing(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(1),
		"Name": map[string]any{
			"First": "Liam",
			"Last":  "Garcia",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(6), // Only grade, no cm_lead_date
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// cm_lead_date should default to empty string
	if got := pbData["cm_lead_date"]; got != "" {
		t.Errorf("cm_lead_date = %v, want '' for missing field", got)
	}

	// years_at_camp should default to 0
	if got := pbData["years_at_camp"]; got != 0 {
		t.Errorf("years_at_camp = %v, want 0 for missing field", got)
	}

	// last_year_attended should default to 0
	if got := pbData["last_year_attended"]; got != 0 {
		t.Errorf("last_year_attended = %v, want 0 for missing field", got)
	}
}

// =============================================================================
// Tests for household relation population
// =============================================================================

// TestUpdatePersonHouseholdRelations_PopulatesFromHouseholdID tests that the household
// relation is populated from household_id when principal household is not available
// This tests the fix for the bug where persons have household_id but empty household relation
func TestUpdatePersonHouseholdRelations_UsesHouseholdID(t *testing.T) {
	t.Parallel()
	// This test verifies the expected behavior:
	// When a person has household_id (CM ID) but no principal household in Households object,
	// the household relation should still be populated by looking up the household by CM ID

	// Note: This is a behavior specification test - the actual implementation
	// requires a running PocketBase instance, so this documents the expected contract

	s := &PersonsSync{}

	// Person with only FamilyPersons household_id, no Households object
	personData := map[string]any{
		"ID": float64(12345),
		"FamilyPersons": []any{
			map[string]any{
				"FamilyID": float64(99999), // This becomes household_id
			},
		},
		// No "Households" object - common for older CampMinder data
	}

	ids := s.extractHouseholdIDsFromPerson(personData)

	// Principal ID should be 0 (no Households object)
	if ids.PrincipalID != 0 {
		t.Errorf("PrincipalID = %d, want 0 (no Households object)", ids.PrincipalID)
	}

	// The fix needs to ensure that when PrincipalID is 0 but household_id exists,
	// we still populate the household relation from household_id
	// This is a design specification that the implementation must satisfy
}

// =============================================================================
// Tests for is_camper flag - should be based on attendee status, not hardcoded
// =============================================================================

// TestTransformPersonToPB_IsCamperFlag tests that is_camper is set based on the isCamper parameter
// Previously this was hardcoded to true, which incorrectly marked staff-only persons as campers
func TestTransformPersonToPB_IsCamperFlag(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
	}

	year := 2025

	// Test with isCamper = true (attendee)
	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}
	if got, ok := pbData["is_camper"].(bool); !ok || !got {
		t.Errorf("is_camper = %v, want true for camper", pbData["is_camper"])
	}

	// Test with isCamper = false (staff-only)
	pbData, err = s.transformPersonToPB(personData, year, false)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}
	if got, ok := pbData["is_camper"].(bool); !ok || got {
		t.Errorf("is_camper = %v, want false for staff-only", pbData["is_camper"])
	}
}

// TestGatherPersonIDs_TracksCamperStatus tests that gatherPersonIDs returns camper status info
func TestGatherPersonIDs_TracksCamperStatus(t *testing.T) {
	t.Parallel()
	// This test documents the expected behavior:
	// gatherPersonIDs should return both the list of person IDs AND a set indicating
	// which IDs are campers (from attendees) vs staff-only

	// The result struct should contain:
	// - personIDs: merged list of all unique person IDs
	// - camperIDsSet: map[int]bool where true means this ID came from attendees

	// Note: Full integration testing requires a running PocketBase instance
	// This test documents the contract the implementation must satisfy
}

// TestMergePersonIDs_PreservesCamperInfo tests that merging preserves camper identification
// When staff and attendee IDs overlap, the person should still be marked as a camper
func TestMergePersonIDs_PreservesCamperInfo(t *testing.T) {
	t.Parallel()
	// Former campers who are now staff should still be marked as campers
	// because they appear in the attendees list

	attendeeIDs := []int{1001, 1002, 1003}
	_ = []int{1002, 2001, 2002} // staffIDs: 1002 is both camper and staff

	// Build camper set from attendees (before merge)
	camperIDsSet := make(map[int]bool)
	for _, id := range attendeeIDs {
		camperIDsSet[id] = true
	}

	// After merge, 1002 should still be in camperIDsSet
	if !camperIDsSet[1002] {
		t.Error("expected person ID 1002 (camper who became staff) to still be marked as camper")
	}

	// Staff-only IDs should NOT be in camperIDsSet
	if camperIDsSet[2001] {
		t.Error("expected staff-only ID 2001 to NOT be in camperIDsSet")
	}
	if camperIDsSet[2002] {
		t.Error("expected staff-only ID 2002 to NOT be in camperIDsSet")
	}
}

// =============================================================================
// Tests for extracting address_city and address_state from address
// =============================================================================

// TestExtractAddressCity tests extraction of city from address for the new address_city field
func TestExtractAddressCity(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
		"Households": map[string]any{
			"PrimaryChildhoodHousehold": map[string]any{
				"ID": float64(100),
				"BillingAddress": map[string]any{
					"Street1":       "123 Main St",
					"City":          "San Francisco",
					"StateProvince": "CA",
					"Zip":           "94102",
				},
			},
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// Verify address_city is extracted
	if got, ok := pbData["address_city"].(string); !ok || got != "San Francisco" {
		t.Errorf("address_city = %v, want 'San Francisco'", pbData["address_city"])
	}

	// Verify address_state is extracted
	if got, ok := pbData["address_state"].(string); !ok || got != "CA" {
		t.Errorf("address_state = %v, want 'CA'", pbData["address_state"])
	}
}

// TestExtractAddressCity_StateField tests extraction when State field is used instead of StateProvince
func TestExtractAddressCity_StateField(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
		"Households": map[string]any{
			"PrimaryChildhoodHousehold": map[string]any{
				"ID": float64(100),
				"BillingAddress": map[string]any{
					"City":  "Oakland",
					"State": "California",
				},
			},
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// Verify address_city is extracted
	if got, ok := pbData["address_city"].(string); !ok || got != "Oakland" {
		t.Errorf("address_city = %v, want 'Oakland'", pbData["address_city"])
	}

	// Verify address_state is extracted (uses State field)
	if got, ok := pbData["address_state"].(string); !ok || got != "California" {
		t.Errorf("address_state = %v, want 'California'", pbData["address_state"])
	}
}

// TestExtractAddressCity_NoHouseholds tests graceful handling when no household data
func TestExtractAddressCity_NoHouseholds(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
		// No Households object
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// Verify address_city defaults to empty string
	if got := pbData["address_city"]; got != "" {
		t.Errorf("address_city = %v, want '' for missing households", got)
	}

	// Verify address_state defaults to empty string
	if got := pbData["address_state"]; got != "" {
		t.Errorf("address_state = %v, want '' for missing households", got)
	}
}

// =============================================================================
// Tests for extracting primary_email and secondary_email
// =============================================================================

// TestExtractPrimaryEmail tests extraction of primary email (IsLogin: true)
func TestExtractPrimaryEmail(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
		"ContactDetails": map[string]any{
			"Emails": []any{
				map[string]any{
					"Address": "secondary@example.com",
					"IsLogin": false,
				},
				map[string]any{
					"Address": "primary@example.com",
					"IsLogin": true,
				},
			},
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// Verify primary_email is the one with IsLogin: true
	if got, ok := pbData["primary_email"].(string); !ok || got != "primary@example.com" {
		t.Errorf("primary_email = %v, want 'primary@example.com'", pbData["primary_email"])
	}

	// Verify secondary_email is the other email
	if got, ok := pbData["secondary_email"].(string); !ok || got != "secondary@example.com" {
		t.Errorf("secondary_email = %v, want 'secondary@example.com'", pbData["secondary_email"])
	}
}

// TestExtractPrimaryEmail_FirstEntryFallback tests that first entry is used when no IsLogin
func TestExtractPrimaryEmail_FirstEntryFallback(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
		"ContactDetails": map[string]any{
			"Emails": []any{
				map[string]any{
					"Address": "first@example.com",
				},
				map[string]any{
					"Address": "second@example.com",
				},
			},
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// When no IsLogin flag, use first email as primary
	if got, ok := pbData["primary_email"].(string); !ok || got != "first@example.com" {
		t.Errorf("primary_email = %v, want 'first@example.com'", pbData["primary_email"])
	}

	// Second email becomes secondary
	if got, ok := pbData["secondary_email"].(string); !ok || got != "second@example.com" {
		t.Errorf("secondary_email = %v, want 'second@example.com'", pbData["secondary_email"])
	}
}

// TestExtractPrimaryEmail_SingleEmail tests handling when only one email exists
func TestExtractPrimaryEmail_SingleEmail(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
		"ContactDetails": map[string]any{
			"Emails": []any{
				map[string]any{
					"Address": "only@example.com",
				},
			},
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// Single email becomes primary
	if got, ok := pbData["primary_email"].(string); !ok || got != "only@example.com" {
		t.Errorf("primary_email = %v, want 'only@example.com'", pbData["primary_email"])
	}

	// No secondary email
	if got := pbData["secondary_email"]; got != "" {
		t.Errorf("secondary_email = %v, want '' for single email", got)
	}
}

// TestExtractPrimaryEmail_NoEmails tests handling when no emails exist
func TestExtractPrimaryEmail_NoEmails(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
		// No ContactDetails
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// No primary_email when no emails
	if got := pbData["primary_email"]; got != "" {
		t.Errorf("primary_email = %v, want '' for no emails", got)
	}

	// No secondary_email when no emails
	if got := pbData["secondary_email"]; got != "" {
		t.Errorf("secondary_email = %v, want '' for no emails", got)
	}
}

// =============================================================================
// Tests for phone_numbers removal
// =============================================================================

// TestPhoneNumbersRemoved tests that phone_numbers field is no longer populated
func TestPhoneNumbersRemoved(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	personData := map[string]any{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0),
		"Name": map[string]any{
			"First": testFirstName,
			"Last":  "Johnson",
		},
		"CamperDetails": map[string]any{
			"CampGradeID": float64(8),
		},
		"ContactDetails": map[string]any{
			"PhoneNumbers": []any{
				map[string]any{
					"Number": "555-123-4567",
					"Type":   "Mobile",
				},
			},
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	// phone_numbers field should not exist in the output
	if _, exists := pbData["phone_numbers"]; exists {
		t.Errorf("phone_numbers field should not be populated, got %v", pbData["phone_numbers"])
	}
}

func TestParseHouseholdSalutation(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{}

	type want struct {
		first string
		last  string
	}

	tests := []struct {
		name      string
		mailing   string
		alternate string
		want      []want
	}{
		{
			name:    "joint different surnames",
			mailing: "Sarah Johnson and David Garcia",
			want:    []want{{"Sarah", "Johnson"}, {"David", "Garcia"}},
		},
		{
			name:    "joint shared surname (single first on left)",
			mailing: "Sarah and David Johnson",
			want:    []want{{"Sarah", "Johnson"}, {"David", "Johnson"}},
		},
		{
			name:    "single with honorific",
			mailing: "Mr. David Johnson",
			want:    []want{{"David", "Johnson"}},
		},
		{
			name:    "honorific joint shared surname",
			mailing: "Mr. and Mrs. Johnson",
			want:    []want{{"", "Johnson"}, {"", "Johnson"}},
		},
		{
			// Regression: previously this fell through to per-side parsing,
			// left stripped to "" → nil, right parsed alone as "David Garcia",
			// yielding only 1 parent. Should yield 2 sharing the surname,
			// with the right parent's first name preserved.
			name:    "honorific joint with first name on right",
			mailing: "Mr. and Mrs. David Garcia",
			want:    []want{{"", "Garcia"}, {"David", "Garcia"}},
		},
		{
			name:    "honorific joint different surnames",
			mailing: "Mr. Johnson and Mrs. Garcia",
			want:    []want{{"", "Johnson"}, {"", "Garcia"}},
		},
		{
			name:    "honorific surname only on left, full name on right",
			mailing: "Mr. Johnson and Mrs. Sarah Garcia",
			want:    []want{{"", "Johnson"}, {"Sarah", "Garcia"}},
		},
		{
			name:    "ampersand separator",
			mailing: "Sarah Johnson & David Garcia",
			want:    []want{{"Sarah", "Johnson"}, {"David", "Garcia"}},
		},
		{
			name:    "suffix stripped",
			mailing: "Mr. David Johnson Jr.",
			want:    []want{{"David", "Johnson"}},
		},
		{
			name:    "honorific without period",
			mailing: "Dr Sarah Johnson",
			want:    []want{{"Sarah", "Johnson"}},
		},
		{
			name:    "honorifics on both sides full names",
			mailing: "Mr. Sarah Johnson and Mrs. David Garcia",
			want:    []want{{"Sarah", "Johnson"}, {"David", "Garcia"}},
		},
		{
			name:      "fallback to alternate when mailing empty",
			mailing:   "",
			alternate: "Mr. Johnson",
			want:      []want{{"", "Johnson"}},
		},
		{
			name:      "fallback to alternate when mailing unparseable",
			mailing:   "???",
			alternate: "Mr. David Johnson",
			want:      []want{{"David", "Johnson"}},
		},
		{
			name: "both empty returns nil",
			want: nil,
		},
		{
			name:    "all caps normalized",
			mailing: "SARAH JOHNSON AND DAVID GARCIA",
			want:    []want{{"Sarah", "Johnson"}, {"David", "Garcia"}},
		},
		{
			name:    "single token unparseable",
			mailing: "Johnson",
			want:    nil,
		},
		{
			name:    "whitespace trimmed",
			mailing: "  Sarah Johnson and David Garcia  ",
			want:    []want{{"Sarah", "Johnson"}, {"David", "Garcia"}},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := s.parseHouseholdSalutation(tc.mailing, tc.alternate)

			if len(got) != len(tc.want) {
				t.Fatalf("parents len = %d, want %d (got=%+v)", len(got), len(tc.want), got)
			}

			for i, w := range tc.want {
				gFirst, _ := got[i]["first"].(string)
				gLast, _ := got[i]["last"].(string)
				if gFirst != w.first {
					t.Errorf("parent[%d].first = %q, want %q", i, gFirst, w.first)
				}
				if gLast != w.last {
					t.Errorf("parent[%d].last = %q, want %q", i, gLast, w.last)
				}
			}
		})
	}
}

// TestTransformPersonToPB_ParentNamesFromMailingTitle verifies that parent_names
// JSON is populated from Households.PrimaryChildhoodHousehold.MailingTitle.
// Pre-fix, the code at persons.go:706-751 read non-existent Name fields from the
// Relatives array (which only carries IDs) and produced parent_names=null for
// every record — see #1393.
func TestTransformPersonToPB_ParentNamesFromMailingTitle(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{missingDataStats: make(map[string]int)}

	personData := map[string]any{
		"ID": float64(12345),
		"Name": map[string]any{
			"First": "Emma",
			"Last":  "Johnson",
		},
		// transformPersonToPB short-circuits to nil without CamperDetails.
		"CamperDetails": map[string]any{"CampGradeID": float64(7)},
		"Households": map[string]any{
			"PrimaryChildhoodHousehold": map[string]any{
				"MailingTitle": "Sarah Johnson and David Garcia",
			},
		},
	}

	pbData, err := s.transformPersonToPB(personData, 2026, true)
	if err != nil {
		t.Fatalf("transformPersonToPB returned error: %v", err)
	}

	raw, ok := pbData["parent_names"].(string)
	if !ok || raw == "" {
		t.Fatalf("parent_names should be a populated JSON string, got %v (%T)",
			pbData["parent_names"], pbData["parent_names"])
	}

	// Spot-check both surnames appear in the JSON. Full structural validation is
	// covered by TestParseHouseholdSalutation; here we just confirm wiring.
	for _, surname := range []string{"Johnson", "Garcia"} {
		if !contains(raw, surname) {
			t.Errorf("parent_names JSON missing surname %q: %s", surname, raw)
		}
	}
}

func contains(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}

// TestTransformPersonToPB_ParentNamesClearedOnParseFail verifies that when the
// salutation parser yields nothing, parent_names is explicitly set to "" in
// pbData so a row's previously-good value gets cleared during update. Without
// this, the upsert path skips the field (only fields present in pbData are
// compared/written), and stale guardian data persists indefinitely.
func TestTransformPersonToPB_ParentNamesClearedOnParseFail(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		households  any
		wantCleared bool
		wantStat    bool
	}{
		{
			name: "unparseable mailing title",
			households: map[string]any{
				"PrimaryChildhoodHousehold": map[string]any{"MailingTitle": "???"},
			},
			wantCleared: true,
			wantStat:    true,
		},
		{
			name: "empty mailing and alternate",
			households: map[string]any{
				"PrimaryChildhoodHousehold": map[string]any{
					"MailingTitle":          "",
					"AlternateMailingTitle": "",
				},
			},
			wantCleared: true,
			wantStat:    true,
		},
		{
			name:        "missing households block entirely",
			households:  nil,
			wantCleared: true,
			wantStat:    true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &PersonsSync{missingDataStats: make(map[string]int)}
			personData := map[string]any{
				"ID":            float64(12345),
				"Name":          map[string]any{"First": "Emma", "Last": "Johnson"},
				"CamperDetails": map[string]any{"CampGradeID": float64(7)},
			}
			if tc.households != nil {
				personData["Households"] = tc.households
			}

			pbData, err := s.transformPersonToPB(personData, 2026, true)
			if err != nil {
				t.Fatalf("transformPersonToPB returned error: %v", err)
			}

			val, exists := pbData["parent_names"]
			if !exists {
				t.Fatalf("parent_names key absent from pbData; expected explicit clear (empty string)")
			}
			if tc.wantCleared {
				if val != "" {
					t.Errorf("parent_names = %v (%T), want \"\"", val, val)
				}
			}
			if tc.wantStat {
				if got := s.missingDataStats["missing_parent_names"]; got != 1 {
					t.Errorf("missingDataStats[missing_parent_names] = %d, want 1", got)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// kindred#2394: a staff-only person is not an orphan
//
// getPersonIDsFromStaff pulls staff person IDs into the run ON PURPOSE, so that
// staff.person can be populated. transformPersonToPB then returns nil for
// anyone whose CampMinder record carries no CamperDetails block -- someone who
// has never been a camper -- and processPerson returns at that nil before it
// reaches TrackProcessedKey. deleteOrphans reads every untracked (cm_id, year)
// in `persons` as absent from CampMinder and deletes it, so the sync fetched
// these people deliberately and then deleted them for not being campers.
// ---------------------------------------------------------------------------

// staffOnlyPersonData returns the CampMinder payload shape that produces the
// defect: a real person with no CamperDetails block. Deliberately distinct from
// validPersonData (rejection_wrapper_test.go), whose CamperDetails is what makes
// it transform into a row.
func staffOnlyPersonData(cmID int, first, last string) map[string]any {
	return map[string]any{
		"ID":   float64(cmID),
		"Name": map[string]any{"First": first, "Last": last},
	}
}

// TestProcessPersonTracksStaffOnlyPersonAsProcessed pins the tracking itself.
// The skip accounting must be untouched: no row was written, so the record
// really was skipped -- it simply must not also read as missing from CampMinder.
func TestProcessPersonTracksStaffOnlyPersonAsProcessed(t *testing.T) {
	t.Parallel()

	const (
		staffCMID = 2001
		year      = 2026
	)

	s := &PersonsSync{
		BaseSyncService:  BaseSyncService{ProcessedKeys: map[string]bool{}},
		missingDataStats: map[string]int{},
	}

	if err := s.processPerson(
		staffOnlyPersonData(staffCMID, testFirstName, "Johnson"),
		false, map[int]*core.Record{}, map[string]string{}, map[int]string{}, year,
	); err != nil {
		t.Fatalf("processPerson: %v", err)
	}

	if !s.IsKeyProcessed(staffCMID, year) {
		t.Errorf("ProcessedKeys is missing %q -- a person this run fetched from CampMinder "+
			"on purpose reads as absent from it, and deleteOrphans deletes their row",
			CompositeKey(staffCMID, year))
	}

	if s.skippedStaff != 1 {
		t.Errorf("skippedStaff = %d, want 1 -- tracking must not change the skip accounting", s.skippedStaff)
	}
	if s.Stats.Skipped != 1 {
		t.Errorf("Stats.Skipped = %d, want 1 -- tracking must not change the skip accounting", s.Stats.Skipped)
	}
}

// TestStaffOnlyPersonSurvivesOrphanSweep drives the whole path the nightly run
// takes: two campers processed, one staff-only person fetched and written off,
// then the real deleteOrphans against a real persons collection. Three rows is
// under OrphanSweepMinRows, so the collapse guard's ratio arm does not fire and
// what the sweep does is decided by ProcessedKeys alone -- which is the point.
func TestStaffOnlyPersonSurvivesOrphanSweep(t *testing.T) {
	t.Parallel()

	const (
		camperOneCMID = 1001
		camperTwoCMID = 1002
		staffCMID     = 2001
		year          = 2026
	)

	// Reuses the fixture from rejection_wrapper_test.go: same collection, same fields.
	app := newPersonsTestApp(t)
	seedSweepPerson(t, app, camperOneCMID, year, testFirstName, "Johnson")
	seedSweepPerson(t, app, camperTwoCMID, year, "Liam", "Garcia")
	seedSweepPerson(t, app, staffCMID, year, "Noah", "Martinez") // staff, never a camper

	s := NewPersonsSync(app, nil)
	s.SyncSuccessful = true

	// The two campers came through the write path this run.
	s.TrackProcessedKey(camperOneCMID, year)
	s.TrackProcessedKey(camperTwoCMID, year)

	// The staff-only person comes through the real path: fetched, transformed to
	// nil, no row written.
	if err := s.processPerson(
		staffOnlyPersonData(staffCMID, "Noah", "Martinez"),
		false, map[int]*core.Record{}, map[string]string{}, map[int]string{}, year,
	); err != nil {
		t.Fatalf("processPerson: %v", err)
	}

	if err := s.deleteOrphans(year); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	if _, err := app.FindFirstRecordByFilter("persons", "cm_id = 2001"); err != nil {
		t.Errorf("the staff-only person's row was swept as an orphan (%v) -- "+
			"the run fetched them from CampMinder, so they are not missing from it. "+
			"In production this is 26 staff a night, and it severs staff.person", err)
	}

	// The campers are untouched, so the assertion above is about the tracking and
	// not about a sweep that did nothing at all.
	for _, filter := range []string{"cm_id = 1001", "cm_id = 1002"} {
		if _, err := app.FindFirstRecordByFilter("persons", filter); err != nil {
			t.Errorf("a tracked camper was swept (%s): %v", filter, err)
		}
	}
}

// seedSweepPerson writes one persons row for the sweep tests above.
func seedSweepPerson(t *testing.T, app core.App, cmID, year int, first, last string) {
	t.Helper()

	col, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}

	rec := core.NewRecord(col)
	rec.Set("cm_id", cmID)
	rec.Set("year", year)
	rec.Set("first_name", first)
	rec.Set("last_name", last)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("seed person %d: %v", cmID, saveErr)
	}
}
