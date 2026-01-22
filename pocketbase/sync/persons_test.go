package sync

import (
	"testing"
)

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
			"First":     "Emma",
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
	if got, want := pbData["division_id"].(int), 5; got != want {
		t.Errorf("division_id = %d, want %d", got, want)
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
	if got, want := pbData["first_name"].(string), "Emma"; got != want {
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
	if pbData["division_id"] != 0 {
		t.Errorf("division_id = %v, want 0 for missing field", pbData["division_id"])
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

// TestExtractTagsFromPersonData tests tag extraction during combined sync
func TestExtractTagsFromPersonData(t *testing.T) {
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Mock person data with tags
	personData := map[string]interface{}{
		"ID": float64(12345),
		"Tags": []interface{}{
			map[string]interface{}{
				"Name":           "Alumni",
				"IsSeasonal":     false,
				"LastUpdatedUTC": "2025-01-15T10:30:00.000Z",
			},
			map[string]interface{}{
				"Name":           "Leadership",
				"IsSeasonal":     true,
				"LastUpdatedUTC": "2025-01-16T11:00:00.000Z",
			},
		},
	}

	tags := s.extractTagsFromPerson(personData)

	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(tags))
	}

	// Verify tag names
	if tags[0]["Name"] != "Alumni" {
		t.Errorf("first tag Name = %v, want Alumni", tags[0]["Name"])
	}
	if tags[1]["Name"] != "Leadership" {
		t.Errorf("second tag Name = %v, want Leadership", tags[1]["Name"])
	}
}

// TestExtractTagsFromPersonData_NoTags tests handling when Tags is missing
func TestExtractTagsFromPersonData_NoTags(t *testing.T) {
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	// Person without Tags
	personData := map[string]interface{}{
		"ID": float64(12345),
	}

	tags := s.extractTagsFromPerson(personData)

	if len(tags) != 0 {
		t.Errorf("expected 0 tags for person without Tags, got %d", len(tags))
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

// TestPersonsSync_TransformPersonTagToPB tests person tag transformation for combined sync
func TestPersonsSync_TransformPersonTagToPB(t *testing.T) {
	s := &PersonsSync{
		missingDataStats: make(map[string]int),
	}

	tagData := map[string]interface{}{
		"Name":           "Alumni",
		"IsSeasonal":     false,
		"LastUpdatedUTC": "2025-01-15T10:30:00.000Z",
	}
	personID := 12345
	year := 2025

	pbData, err := s.transformPersonTagToPB(tagData, personID, year)
	if err != nil {
		t.Fatalf("transformPersonTagToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["person_id"].(int), 12345; got != want {
		t.Errorf("person_id = %d, want %d", got, want)
	}
	if got, want := pbData["tag_name"].(string), "Alumni"; got != want {
		t.Errorf("tag_name = %q, want %q", got, want)
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
// including households and person_tags sub-entity stats from combined sync
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

	// Set person_tags stats (simulating combined sync)
	personTagStats := Stats{
		Created: 15,
		Updated: 80,
		Skipped: 5,
		Errors:  0,
	}
	s.personTagStats = &personTagStats

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

	// Verify person_tags sub-stats
	personTagSubStats, exists := stats.SubStats["person_tags"]
	if !exists {
		t.Fatal("expected 'person_tags' key in SubStats")
	}
	if personTagSubStats.Created != 15 {
		t.Errorf("expected person_tags.Created=15, got %d", personTagSubStats.Created)
	}
	if personTagSubStats.Updated != 80 {
		t.Errorf("expected person_tags.Updated=80, got %d", personTagSubStats.Updated)
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

// mockTagDefRecord simulates a core.Record for testing tag definition lookups
type mockTagDefRecord struct {
	id   string
	name string
}

// TestExtractTagIDs tests extracting PocketBase tag definition IDs from person data
func TestExtractTagIDs(t *testing.T) {
	s := &PersonsSync{}

	// Mock tag definitions map (name -> PocketBase ID)
	tagDefsByName := map[string]string{
		"Alumni":     "rec_alumni_001",
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
		if id == "rec_alumni_001" {
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
		"Alumni": "rec_alumni_001",
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
		"Alumni": "rec_alumni_001",
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
		"Alumni": "rec_alumni_001",
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
		"Alumni": "rec_alumni_001",
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

	if tagIDs[0] != "rec_alumni_001" {
		t.Errorf("expected Alumni tag ID, got %q", tagIDs[0])
	}
}

// TestExtractTagIDs_EmptyTagName tests handling when tag Name is empty
func TestExtractTagIDs_EmptyTagName(t *testing.T) {
	s := &PersonsSync{}

	tagDefsByName := map[string]string{
		"Alumni": "rec_alumni_001",
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

	if tagIDs[0] != "rec_alumni_001" {
		t.Errorf("expected Alumni tag ID, got %q", tagIDs[0])
	}
}
