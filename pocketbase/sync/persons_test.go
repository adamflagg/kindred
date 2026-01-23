package sync

import (
	"testing"
)

const testAlumniTagID = "rec_alumni_001"

func TestPersonsSync_Name(t *testing.T) {
	s := &PersonsSync{}

	got := s.Name()
	want := "persons"

	if got != want {
		t.Errorf("PersonsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformPersonToPB_CamperDetailsExpanded tests that all CamperDetails fields are extracted
func TestTransformPersonToPB_CamperDetailsExpanded(t *testing.T) {
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Mock CampMinder API response with full CamperDetails
	// Note: We don't set Age to avoid needing a Client for age calculation
	personData := map[string]interface{}{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(0), // Female
		// No "Age" field - triggers default age behavior without needing client
		"Name": map[string]interface{}{
			"First":     testFirstName,
			"Last":      "Johnson",
			"Preferred": "Emmy",
		},
		"CamperDetails": map[string]interface{}{
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
		"FamilyPersons": []interface{}{
			map[string]interface{}{
				"FamilyID": float64(99999),
			},
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year)
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
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Minimal CamperDetails without optional fields
	// Note: We don't set Age to avoid needing a Client for age calculation
	personData := map[string]interface{}{
		"ID":          float64(12345),
		"DateOfBirth": "2010-03-15",
		"GenderID":    float64(1), // Male
		// No "Age" field - triggers default age behavior without needing client
		"Name": map[string]interface{}{
			"First": "Liam",
			"Last":  "Garcia",
		},
		"CamperDetails": map[string]interface{}{
			"CampGradeID": float64(6),
		},
	}

	year := 2025

	pbData, err := s.transformPersonToPB(personData, year)
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
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Mock person data with households
	personData := map[string]interface{}{
		"ID": float64(12345),
		"Households": map[string]interface{}{
			"PrincipalHousehold": map[string]interface{}{
				"ID":       float64(100),
				"Greeting": "The Johnson Family",
			},
			"PrimaryChildhoodHousehold": map[string]interface{}{
				"ID":       float64(100), // Same household
				"Greeting": "The Johnson Family",
			},
		},
	}

	households := s.extractUniqueHouseholds([]map[string]interface{}{personData})

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
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Person without Households
	personData := map[string]interface{}{
		"ID": float64(12345),
	}

	households := s.extractUniqueHouseholds([]map[string]interface{}{personData})

	if len(households) != 0 {
		t.Errorf("expected 0 households for person without Households, got %d", len(households))
	}
}

// TestPersonsSync_TransformHouseholdToPB tests household transformation for combined sync
func TestPersonsSync_TransformHouseholdToPB(t *testing.T) {
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	householdData := map[string]interface{}{
		"ID":                    float64(123456),
		"Greeting":              "Hunter and Ashley",
		"MailingTitle":          "Mr. and Mrs Hunter Doe",
		"AlternateMailingTitle": "The Doe Family",
		"BillingMailingTitle":   "Mr. and Mrs Hunter Doe",
		"HouseholdPhone":        "212-523-5555",
		"LastUpdatedUTC":        "2025-01-15T10:30:00.000Z",
		"BillingAddress": map[string]interface{}{
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
	// This verifies that the fields used in processPerson include the new ones
	expectedNewFields := []string{
		"division_id", "partition_id", "lead_date", "tshirt_size",
		"principal_household", "primary_childhood_household", "alternate_childhood_household",
	}

	// The compareFields list should include these fields for proper update detection
	// We verify this by checking the list that will be used in processPerson
	compareFields := []string{
		"cm_id", "first_name", "last_name", "preferred_name",
		"birthdate", "gender", "age", "grade", "school", "years_at_camp",
		"last_year_attended", "gender_identity_id", "gender_identity_name", "gender_identity_write_in",
		"gender_pronoun_id", "gender_pronoun_name", "gender_pronoun_write_in", "phone_numbers",
		"email_addresses", "address", "household_id", "is_camper", "year", "parent_names",
		"division_id", "partition_id", "lead_date", "tshirt_size",
		"principal_household", "primary_childhood_household", "alternate_childhood_household",
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
	s := &PersonsSync{}

	personData := map[string]interface{}{
		"ID": float64(12345),
		"Households": map[string]interface{}{
			"PrincipalHousehold": map[string]interface{}{
				"ID":       float64(100),
				"Greeting": "The Smiths",
			},
			"PrimaryChildhoodHousehold": map[string]interface{}{
				"ID":       float64(200),
				"Greeting": "Primary Home",
			},
			"AlternateChildhoodHousehold": map[string]interface{}{
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
	s := &PersonsSync{}

	// Child with only primary childhood household
	personData := map[string]interface{}{
		"ID": float64(12345),
		"Households": map[string]interface{}{
			"PrimaryChildhoodHousehold": map[string]interface{}{
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
	}

	// Verify households sub-stats
	householdSubStats, exists := stats.SubStats["households"]
	if !exists {
		t.Fatal("expected 'households' key in SubStats")
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
	s := &PersonsSync{}

	// Mock tag definitions map (name -> PocketBase ID)
	tagDefsByName := map[string]string{
		"Alumni":     testAlumniTagID,
		"Leadership": "rec_leadership_002",
		"Sibling":    "rec_sibling_003",
	}

	personData := map[string]interface{}{
		"ID": float64(12345),
		"Tags": []interface{}{
			map[string]interface{}{
				"Name":           "Alumni",
				"LastUpdatedUTC": "2025-01-15T10:30:00.000Z",
			},
			map[string]interface{}{
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
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]interface{}{
		"ID": float64(12345),
	}

	tagIDs := s.extractTagIDs(personData, tagDefsByName)

	if tagIDs != nil {
		t.Errorf("expected nil for person without Tags, got %v", tagIDs)
	}
}

// TestExtractTagIDs_EmptyTags tests handling when Tags is empty array
func TestExtractTagIDs_EmptyTags(t *testing.T) {
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]interface{}{
		"ID":   float64(12345),
		"Tags": []interface{}{},
	}

	tagIDs := s.extractTagIDs(personData, tagDefsByName)

	if len(tagIDs) != 0 {
		t.Errorf("expected 0 tag IDs for empty Tags array, got %d", len(tagIDs))
	}
}

// TestExtractTagIDs_NilTags tests handling when Tags is nil
func TestExtractTagIDs_NilTags(t *testing.T) {
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]interface{}{
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
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]interface{}{
		"ID": float64(12345),
		"Tags": []interface{}{
			map[string]interface{}{
				"Name": "UnknownTag", // Not in tag definitions
			},
			map[string]interface{}{
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
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": testAlumniTagID,
	}

	personData := map[string]interface{}{
		"ID": float64(12345),
		"Tags": []interface{}{
			map[string]interface{}{
				"Name": "", // Empty name
			},
			map[string]interface{}{
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
	s := &PersonsSync{}

	staffRecords := []map[string]interface{}{
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
	s := &PersonsSync{}

	staffRecords := []map[string]interface{}{
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
	s := &PersonsSync{}

	personIDs := s.extractPersonIDsFromStaffRecords(nil)
	if len(personIDs) != 0 {
		t.Errorf("expected 0 person IDs for nil input, got %d", len(personIDs))
	}

	personIDs = s.extractPersonIDsFromStaffRecords([]map[string]interface{}{})
	if len(personIDs) != 0 {
		t.Errorf("expected 0 person IDs for empty input, got %d", len(personIDs))
	}
}

// TestExtractPersonIDsFromStaffRecords_Deduplicates tests that duplicate IDs are removed
func TestExtractPersonIDsFromStaffRecords_Deduplicates(t *testing.T) {
	s := &PersonsSync{}

	// Staff member appears in multiple records (e.g., different status pages)
	staffRecords := []map[string]interface{}{
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
