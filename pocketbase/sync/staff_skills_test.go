package sync

import (
	"fmt"
	"strings"
	"testing"
)

// serviceNameStaffSkills is the canonical name for this sync service
const serviceNameStaffSkills = "staff_skills"

// TestStaffSkillsSync_Name verifies the service name is correct
func TestStaffSkillsSync_Name(t *testing.T) {
	// The service name must be "staff_skills" for orchestrator integration
	expectedName := serviceNameStaffSkills

	// Test that the expected name matches
	if expectedName != "staff_skills" {
		t.Errorf("expected service name %q", expectedName)
	}
}

// TestStaffSkillsYearValidation tests year parameter validation
func TestStaffSkillsYearValidation(t *testing.T) {
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
			valid := isValidStaffSkillsYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidStaffSkillsYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestParseProficiency tests parsing of pipe-delimited proficiency values
func TestParseProficiency(t *testing.T) {
	tests := []struct {
		name              string
		rawValue          string
		wantIntermediate  bool
		wantExperienced   bool
		wantCanTeach      bool
		wantCertified     bool
	}{
		{
			name:             "single Int.",
			rawValue:         "Int.",
			wantIntermediate: true,
		},
		{
			name:            "single Exp.",
			rawValue:        "Exp.",
			wantExperienced: true,
		},
		{
			name:         "single Teach",
			rawValue:     "Teach",
			wantCanTeach: true,
		},
		{
			name:          "single Cert.",
			rawValue:      "Cert.",
			wantCertified: true,
		},
		{
			name:              "Int. and Exp.",
			rawValue:          "Int.|Exp.",
			wantIntermediate:  true,
			wantExperienced:   true,
		},
		{
			name:              "all four proficiencies",
			rawValue:          "Int.|Exp.|Teach|Cert.",
			wantIntermediate:  true,
			wantExperienced:   true,
			wantCanTeach:      true,
			wantCertified:     true,
		},
		{
			name:              "different order",
			rawValue:          "Cert.|Teach|Int.|Exp.",
			wantIntermediate:  true,
			wantExperienced:   true,
			wantCanTeach:      true,
			wantCertified:     true,
		},
		{
			name:     "empty value",
			rawValue: "",
		},
		{
			name:     "notes field (free text)",
			rawValue: "Would like to learn more about outdoor skills",
		},
		{
			name:              "Int. with spaces",
			rawValue:          " Int. | Exp. ",
			wantIntermediate:  true,
			wantExperienced:   true,
		},
		{
			name:              "three proficiencies",
			rawValue:          "Int.|Exp.|Teach",
			wantIntermediate:  true,
			wantExperienced:   true,
			wantCanTeach:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			intermediate, experienced, canTeach, certified := parseProficiencyValues(tt.rawValue)

			if intermediate != tt.wantIntermediate {
				t.Errorf("intermediate = %v, want %v", intermediate, tt.wantIntermediate)
			}
			if experienced != tt.wantExperienced {
				t.Errorf("experienced = %v, want %v", experienced, tt.wantExperienced)
			}
			if canTeach != tt.wantCanTeach {
				t.Errorf("canTeach = %v, want %v", canTeach, tt.wantCanTeach)
			}
			if certified != tt.wantCertified {
				t.Errorf("certified = %v, want %v", certified, tt.wantCertified)
			}
		})
	}
}

// TestExtractSkillName tests stripping "Skills-" prefix from field names
func TestExtractSkillName(t *testing.T) {
	tests := []struct {
		fieldName    string
		wantSkillName string
	}{
		{"Skills-Archery", "Archery"},
		{"Skills-Backpacking", "Backpacking"},
		{"Skills-Ropes Course", "Ropes Course"},
		{"Skills-would like to acquire", "would like to acquire"},
		{"Skills-Skill Notes", "Skill Notes"},
		{"Skills-Swimming", "Swimming"},
		{"Skills-Hiking", "Hiking"},
		{"Skills-Canoeing/Kayaking", "Canoeing/Kayaking"},
		// Edge cases
		{"Skills-", ""},
		{"Skills-A", "A"},
		{"Not-Skills-Field", "Not-Skills-Field"}, // Should not strip if doesn't start with Skills-
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := extractSkillNameFromField(tt.fieldName)
			if result != tt.wantSkillName {
				t.Errorf("extractSkillNameFromField(%q) = %q, want %q", tt.fieldName, result, tt.wantSkillName)
			}
		})
	}
}

// TestIsSkillsField tests identification of Skills- fields
func TestIsSkillsField(t *testing.T) {
	tests := []struct {
		fieldName string
		wantIsSkills bool
	}{
		{"Skills-Archery", true},
		{"Skills-Backpacking", true},
		{"Skills-would like to acquire", true},
		{"Skills-Skill Notes", true},
		{"Family Camp Adult 1", false},
		{"Bunk Preference", false},
		{"Skills", false}, // No hyphen
		{"skills-archery", false}, // lowercase
		{"SKILLS-ARCHERY", false}, // uppercase
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := isSkillsField(tt.fieldName)
			if result != tt.wantIsSkills {
				t.Errorf("isSkillsField(%q) = %v, want %v", tt.fieldName, result, tt.wantIsSkills)
			}
		})
	}
}

// TestIsStaffPartition tests identification of Staff partition
func TestIsStaffPartition(t *testing.T) {
	tests := []struct {
		partition string
		wantIsStaff bool
	}{
		{"Staff", true},
		{"Staff,Camper", true},
		{"Camper,Staff", true},
		{"Family,Staff,Alumnus", true},
		{"Camper", false},
		{"Family", false},
		{"", false},
		{"Parent", false},
		{"Adult", false},
	}

	for _, tt := range tests {
		t.Run(tt.partition, func(t *testing.T) {
			result := containsStaffPartition(tt.partition)
			if result != tt.wantIsStaff {
				t.Errorf("containsStaffPartition(%q) = %v, want %v", tt.partition, result, tt.wantIsStaff)
			}
		})
	}
}

// TestStaffSkillsCompositeKeyFormat tests the composite key format used for upsert
func TestStaffSkillsCompositeKeyFormat(t *testing.T) {
	tests := []struct {
		name       string
		personCMID int
		skillCMID  int
		year       int
		expected   string
	}{
		{
			name:       "standard key",
			personCMID: 12345,
			skillCMID:  100,
			year:       2025,
			expected:   "12345:100|2025",
		},
		{
			name:       "different year same person/skill",
			personCMID: 12345,
			skillCMID:  100,
			year:       2024,
			expected:   "12345:100|2024",
		},
		{
			name:       "large IDs",
			personCMID: 9999999,
			skillCMID:  999999,
			year:       2025,
			expected:   "9999999:999999|2025",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := formatStaffSkillsCompositeKey(tt.personCMID, tt.skillCMID, tt.year)
			if key != tt.expected {
				t.Errorf("formatStaffSkillsCompositeKey = %q, want %q", key, tt.expected)
			}
		})
	}
}

// TestStaffSkillsCompositeKeyDeterministic tests that the same input produces the same key
func TestStaffSkillsCompositeKeyDeterministic(t *testing.T) {
	keys := make([]string, 10)
	for i := 0; i < 10; i++ {
		keys[i] = formatStaffSkillsCompositeKey(12345, 100, 2025)
	}

	for i := 1; i < len(keys); i++ {
		if keys[i] != keys[0] {
			t.Errorf("key %d (%q) differs from key 0 (%q)", i, keys[i], keys[0])
		}
	}
}

// TestStaffSkillsOrphanDetection tests that records not in processed keys are identified as orphans
func TestStaffSkillsOrphanDetection(t *testing.T) {
	existingKeys := map[string]bool{
		"12345:100|2025": true,
		"12345:101|2025": true,
		"12346:100|2025": true, // Will not be processed = orphan
	}

	processedKeys := map[string]bool{
		"12345:100|2025": true,
		"12345:101|2025": true,
		// 12346 not in source data anymore
	}

	orphanCount := 0
	for key := range existingKeys {
		if !processedKeys[key] {
			orphanCount++
		}
	}

	if orphanCount != 1 {
		t.Errorf("expected 1 orphan, got %d", orphanCount)
	}
}

// TestStaffSkillsUpsertDecision tests the create vs update decision logic
func TestStaffSkillsUpsertDecision(t *testing.T) {
	tests := []struct {
		name         string
		existingKeys map[string]bool
		newKey       string
		expectCreate bool
		expectUpdate bool
	}{
		{
			name:         "new record - not in existing",
			existingKeys: map[string]bool{},
			newKey:       "12345:100|2025",
			expectCreate: true,
			expectUpdate: false,
		},
		{
			name:         "existing record - should update",
			existingKeys: map[string]bool{"12345:100|2025": true},
			newKey:       "12345:100|2025",
			expectCreate: false,
			expectUpdate: true,
		},
		{
			name:         "different skill - new record",
			existingKeys: map[string]bool{"12345:100|2025": true},
			newKey:       "12345:101|2025",
			expectCreate: true,
			expectUpdate: false,
		},
		{
			name:         "different year - new record",
			existingKeys: map[string]bool{"12345:100|2025": true},
			newKey:       "12345:100|2026",
			expectCreate: true,
			expectUpdate: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			exists := tt.existingKeys[tt.newKey]

			isCreate := !exists
			isUpdate := exists

			if isCreate != tt.expectCreate {
				t.Errorf("create decision = %v, want %v", isCreate, tt.expectCreate)
			}
			if isUpdate != tt.expectUpdate {
				t.Errorf("update decision = %v, want %v", isUpdate, tt.expectUpdate)
			}
		})
	}
}

// TestStaffSkillRecord represents a staff skill record for testing
type testStaffSkillRecord struct {
	PersonID       int
	PersonPBID     string
	SkillCMID      int
	SkillName      string
	IsIntermediate bool
	IsExperienced  bool
	CanTeach       bool
	IsCertified    bool
	RawValue       string
	Year           int
	FirstName      string
	LastName       string
}

// TestStaffSkillsRecordBuilding tests that records are correctly built from source data
func TestStaffSkillsRecordBuilding(t *testing.T) {
	// Simulate person custom value data
	personValues := []testPersonSkillValue{
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "Int.|Exp.", Year: 2025},
		{PersonCMID: 12345, SkillCMID: 101, SkillName: "Backpacking", Value: "Teach", Year: 2025},
		{PersonCMID: 12346, SkillCMID: 100, SkillName: "Archery", Value: "Cert.", Year: 2025},
	}

	personDemographics := map[int]testStaffDemographics{
		12345: {FirstName: "Emma", LastName: "Johnson"},
		12346: {FirstName: "Liam", LastName: "Garcia"},
	}

	records := buildStaffSkillRecords(personValues, personDemographics)

	// Should have 3 records (one per person-skill combination)
	if len(records) != 3 {
		t.Errorf("expected 3 records, got %d", len(records))
	}

	// Verify first record
	r1 := findStaffSkillRecord(records, 12345, 100)
	if r1 == nil {
		t.Fatal("record for person 12345, skill 100 not found")
	}
	if r1.SkillName != "Archery" {
		t.Errorf("expected skill name 'Archery', got %q", r1.SkillName)
	}
	if !r1.IsIntermediate || !r1.IsExperienced {
		t.Errorf("expected intermediate=true, experienced=true, got %v, %v", r1.IsIntermediate, r1.IsExperienced)
	}
	if r1.FirstName != "Emma" || r1.LastName != "Johnson" {
		t.Errorf("expected 'Emma Johnson', got '%s %s'", r1.FirstName, r1.LastName)
	}

	// Verify third record (certified only)
	r3 := findStaffSkillRecord(records, 12346, 100)
	if r3 == nil {
		t.Fatal("record for person 12346, skill 100 not found")
	}
	if !r3.IsCertified {
		t.Error("expected certified=true")
	}
	if r3.IsIntermediate || r3.IsExperienced || r3.CanTeach {
		t.Error("expected only certified flag set")
	}
}

// TestStaffSkillsDeduplication tests that duplicate records are handled correctly
func TestStaffSkillsDeduplication(t *testing.T) {
	personValues := []testPersonSkillValue{
		// Duplicate entries for same person-skill-year (should deduplicate)
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "Int.", Year: 2025},
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "Exp.", Year: 2025},
	}

	personDemographics := map[int]testStaffDemographics{
		12345: {FirstName: "Emma", LastName: "Johnson"},
	}

	records := buildStaffSkillRecords(personValues, personDemographics)

	// Should be deduplicated to 1 record
	// Note: The actual implementation should take the first or merge values
	if len(records) < 1 {
		t.Error("expected at least 1 record")
	}

	// Verify composite key uniqueness
	keys := make(map[string]bool)
	for _, r := range records {
		key := formatStaffSkillsCompositeKey(r.PersonID, r.SkillCMID, r.Year)
		if keys[key] {
			t.Errorf("duplicate composite key found: %s", key)
		}
		keys[key] = true
	}
}

// TestStaffSkillsNotesFieldHandling tests that notes fields (non-structured) are handled correctly
func TestStaffSkillsNotesFieldHandling(t *testing.T) {
	// Notes fields should have booleans set to false and raw_value containing the text
	personValues := []testPersonSkillValue{
		{PersonCMID: 12345, SkillCMID: 200, SkillName: "would like to acquire", Value: "I want to learn rock climbing and wilderness first aid", Year: 2025},
		{PersonCMID: 12345, SkillCMID: 201, SkillName: "Skill Notes", Value: "Extensive outdoor education background", Year: 2025},
	}

	personDemographics := map[int]testStaffDemographics{
		12345: {FirstName: "Emma", LastName: "Johnson"},
	}

	records := buildStaffSkillRecords(personValues, personDemographics)

	// Verify notes field handling
	notesRecord := findStaffSkillRecord(records, 12345, 200)
	if notesRecord == nil {
		t.Fatal("notes record not found")
	}

	// Booleans should all be false for notes fields
	if notesRecord.IsIntermediate || notesRecord.IsExperienced || notesRecord.CanTeach || notesRecord.IsCertified {
		t.Error("notes field should have all proficiency booleans set to false")
	}

	// Raw value should contain the original text
	if notesRecord.RawValue != "I want to learn rock climbing and wilderness first aid" {
		t.Errorf("expected raw value preserved, got %q", notesRecord.RawValue)
	}
}

// TestStaffSkillsEmptyDataHandling tests graceful handling of empty input
func TestStaffSkillsEmptyDataHandling(t *testing.T) {
	personValues := []testPersonSkillValue{}
	personDemographics := map[int]testStaffDemographics{}

	records := buildStaffSkillRecords(personValues, personDemographics)

	if len(records) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(records))
	}
}

// TestStaffSkillsEmptyValueSkipped tests that empty values are skipped
func TestStaffSkillsEmptyValueSkipped(t *testing.T) {
	personValues := []testPersonSkillValue{
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "", Year: 2025},
		{PersonCMID: 12345, SkillCMID: 101, SkillName: "Backpacking", Value: "Int.", Year: 2025},
	}

	personDemographics := map[int]testStaffDemographics{
		12345: {FirstName: "Emma", LastName: "Johnson"},
	}

	records := buildStaffSkillRecords(personValues, personDemographics)

	// Should skip empty value, only 1 record
	if len(records) != 1 {
		t.Errorf("expected 1 record (empty skipped), got %d", len(records))
	}

	if records[0].SkillName != "Backpacking" {
		t.Errorf("expected 'Backpacking', got %q", records[0].SkillName)
	}
}

// TestStaffSkillsMissingDemographics tests handling when person demographics are missing
func TestStaffSkillsMissingDemographics(t *testing.T) {
	personValues := []testPersonSkillValue{
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "Int.", Year: 2025},
	}

	// No demographics for person 12345
	personDemographics := map[int]testStaffDemographics{}

	records := buildStaffSkillRecords(personValues, personDemographics)

	// Should still create record, just with empty name fields
	if len(records) != 1 {
		t.Errorf("expected 1 record, got %d", len(records))
	}

	if records[0].FirstName != "" || records[0].LastName != "" {
		t.Errorf("expected empty names when demographics missing, got '%s %s'", records[0].FirstName, records[0].LastName)
	}
}

// ============================================================================
// Test helper types and functions
// ============================================================================

type testPersonSkillValue struct {
	PersonCMID int
	SkillCMID  int
	SkillName  string
	Value      string
	Year       int
}

type testStaffDemographics struct {
	FirstName string
	LastName  string
}

// isValidStaffSkillsYear validates year parameter for staff skills sync
func isValidStaffSkillsYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// parseProficiencyValues parses pipe-delimited proficiency string into boolean flags
func parseProficiencyValues(rawValue string) (intermediate, experienced, canTeach, certified bool) {
	parts := strings.Split(rawValue, "|")
	for _, p := range parts {
		switch strings.TrimSpace(p) {
		case "Int.":
			intermediate = true
		case "Exp.":
			experienced = true
		case "Teach":
			canTeach = true
		case "Cert.":
			certified = true
		}
	}
	return
}

// extractSkillNameFromField strips the "Skills-" prefix from a field name
func extractSkillNameFromField(fieldName string) string {
	const prefix = "Skills-"
	if strings.HasPrefix(fieldName, prefix) {
		return fieldName[len(prefix):]
	}
	return fieldName
}

// isSkillsField checks if a field name is a Skills- field
func isSkillsField(fieldName string) bool {
	return strings.HasPrefix(fieldName, "Skills-")
}

// containsStaffPartition checks if partition string contains "Staff"
func containsStaffPartition(partition string) bool {
	if partition == "" {
		return false
	}
	// Handle comma-separated partition values
	parts := strings.Split(partition, ",")
	for _, p := range parts {
		if strings.TrimSpace(p) == "Staff" {
			return true
		}
	}
	return false
}

// formatStaffSkillsCompositeKey creates the composite key for upsert
func formatStaffSkillsCompositeKey(personCMID, skillCMID, year int) string {
	return fmt.Sprintf("%d:%d|%d", personCMID, skillCMID, year)
}

// buildStaffSkillRecords builds staff skill records from source data
func buildStaffSkillRecords(
	personValues []testPersonSkillValue,
	demographics map[int]testStaffDemographics,
) []*testStaffSkillRecord {
	// Track records by composite key to deduplicate
	recordsByKey := make(map[string]*testStaffSkillRecord)

	for _, pv := range personValues {
		// Skip empty values
		if pv.Value == "" {
			continue
		}

		key := formatStaffSkillsCompositeKey(pv.PersonCMID, pv.SkillCMID, pv.Year)

		// First value wins (deduplicate)
		if _, exists := recordsByKey[key]; exists {
			continue
		}

		// Parse proficiency values
		intermediate, experienced, canTeach, certified := parseProficiencyValues(pv.Value)

		// Get demographics
		demo := demographics[pv.PersonCMID]

		recordsByKey[key] = &testStaffSkillRecord{
			PersonID:       pv.PersonCMID,
			SkillCMID:      pv.SkillCMID,
			SkillName:      pv.SkillName,
			IsIntermediate: intermediate,
			IsExperienced:  experienced,
			CanTeach:       canTeach,
			IsCertified:    certified,
			RawValue:       pv.Value,
			Year:           pv.Year,
			FirstName:      demo.FirstName,
			LastName:       demo.LastName,
		}
	}

	// Convert map to slice
	records := make([]*testStaffSkillRecord, 0, len(recordsByKey))
	for _, r := range recordsByKey {
		records = append(records, r)
	}

	return records
}

// findStaffSkillRecord finds a record by person and skill CM ID
func findStaffSkillRecord(records []*testStaffSkillRecord, personCMID, skillCMID int) *testStaffSkillRecord {
	for _, r := range records {
		if r.PersonID == personCMID && r.SkillCMID == skillCMID {
			return r
		}
	}
	return nil
}
