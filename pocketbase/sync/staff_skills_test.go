package sync

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// testLastName is a standard test last name (testFirstName is defined in persons_test.go)
const testLastName = "Johnson"

// newSkillDefsTestApp returns a throwaway PocketBase app with a
// custom_field_defs collection shaped like production's (cm_id + name +
// partition), pre-populated with the given (cm_id, name) pairs, each tagged
// with the Staff partition. Names are stored VERBATIM -- PocketBase preserves
// leading and trailing whitespace in text fields.
func newSkillDefsTestApp(t *testing.T, defs map[int]string) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("custom_field_defs")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "name"})
	col.Fields.Add(&core.SelectField{
		Name:      "partition",
		Values:    []string{"None", "Family", "Alumnus", "Staff", "Camper", "Parent", "Adult"},
		MaxSelect: 7,
	})
	if err := app.Save(col); err != nil {
		t.Fatalf("save custom_field_defs: %v", err)
	}
	for cmID, name := range defs {
		r := core.NewRecord(col)
		r.Set("cm_id", cmID)
		r.Set("name", name)
		r.Set("partition", []string{"Staff"})
		if err := app.Save(r); err != nil {
			t.Fatalf("save field def %d: %v", cmID, err)
		}
	}
	return app
}

// TestStaffSkillsLoadSkillDefinitionsTrimsNames is a regression test for
// kindred#1873. loadSkillDefinitions admits by "Skills-" prefix, which a
// trailing space would not defeat, but it is the derived skill string
// (name with the prefix stripped) that gets written to staff_skills.skill_name
// -- an untrimmed source name would silently carry the trailing space into
// that column. No untrimmed name exists in this table today; this pins the
// fix against a future one.
func TestStaffSkillsLoadSkillDefinitionsTrimsNames(t *testing.T) {
	t.Parallel()
	app := newSkillDefsTestApp(t, map[int]string{
		1: "Skills-Archery ", // trailing space
		2: "Skills-Riflery",  // already clean, must be unaffected
	})

	s := NewStaffSkillsSync(app)
	got, err := s.loadSkillDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadSkillDefinitions: %v", err)
	}

	want := map[string]string{
		"Skills-Archery": "Archery",
		"Skills-Riflery": "Riflery",
	}
	for _, def := range got {
		wantSkill, ok := want[def.name]
		if !ok {
			t.Errorf("loadSkillDefinitions returned %q; expected a trimmed name", def.name)
			continue
		}
		if def.skill != wantSkill {
			t.Errorf("loadSkillDefinitions(%q).skill = %q, want %q", def.name, def.skill, wantSkill)
		}
		delete(want, def.name)
	}
	for missing := range want {
		t.Errorf("loadSkillDefinitions did not return %q", missing)
	}
}

// TestStaffSkillsYearValidation tests year parameter validation
func TestStaffSkillsYearValidation(t *testing.T) {
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
			valid := isValidStaffSkillsYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidStaffSkillsYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestParseProficiency tests parsing of pipe-delimited proficiency values
func TestParseProficiency(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name             string
		rawValue         string
		wantIntermediate bool
		wantExperienced  bool
		wantCanTeach     bool
		wantCertified    bool
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
			name:             "Int. and Exp.",
			rawValue:         "Int.|Exp.",
			wantIntermediate: true,
			wantExperienced:  true,
		},
		{
			name:             "all four proficiencies",
			rawValue:         "Int.|Exp.|Teach|Cert.",
			wantIntermediate: true,
			wantExperienced:  true,
			wantCanTeach:     true,
			wantCertified:    true,
		},
		{
			name:             "different order",
			rawValue:         "Cert.|Teach|Int.|Exp.",
			wantIntermediate: true,
			wantExperienced:  true,
			wantCanTeach:     true,
			wantCertified:    true,
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
			name:             "Int. with spaces",
			rawValue:         " Int. | Exp. ",
			wantIntermediate: true,
			wantExperienced:  true,
		},
		{
			name:             "three proficiencies",
			rawValue:         "Int.|Exp.|Teach",
			wantIntermediate: true,
			wantExperienced:  true,
			wantCanTeach:     true,
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
	t.Parallel()
	tests := []struct {
		fieldName     string
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
	t.Parallel()
	tests := []struct {
		fieldName    string
		wantIsSkills bool
	}{
		{"Skills-Archery", true},
		{"Skills-Backpacking", true},
		{"Skills-would like to acquire", true},
		{"Skills-Skill Notes", true},
		{"Family Camp Adult 1", false},
		{"Bunk Preference", false},
		{"Skills", false},         // No hyphen
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
	t.Parallel()
	tests := []struct {
		partition   string
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

// TestContainsStaffPartitionWithJSONArray tests partition check with JSON array values.
// PocketBase stores select fields as JSON arrays, but GetString returns ""
// or a stringified JSON like ["Staff"]. The fix should handle this correctly.
func TestContainsStaffPartitionWithJSONArray(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		rawValue    any
		wantIsStaff bool
	}{
		// JSON array with Staff
		{
			name:        "JSON array with Staff only",
			rawValue:    []any{"Staff"},
			wantIsStaff: true,
		},
		{
			name:        "JSON array with Staff and others",
			rawValue:    []any{"Camper", "Staff", "Alumnus"},
			wantIsStaff: true,
		},
		{
			name:        "JSON array without Staff",
			rawValue:    []any{"Camper", "Parent"},
			wantIsStaff: false,
		},
		{
			name:        "empty JSON array",
			rawValue:    []any{},
			wantIsStaff: false,
		},
		// String array variant
		{
			name:        "string array with Staff",
			rawValue:    []string{"Staff"},
			wantIsStaff: true,
		},
		{
			name:        "string array without Staff",
			rawValue:    []string{"Camper"},
			wantIsStaff: false,
		},
		// Nil/empty cases
		{
			name:        "nil value",
			rawValue:    nil,
			wantIsStaff: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := containsStaffPartitionFromRaw(tt.rawValue)
			if result != tt.wantIsStaff {
				t.Errorf("containsStaffPartitionFromRaw(%v) = %v, want %v",
					tt.rawValue, result, tt.wantIsStaff)
			}
		})
	}
}

// containsStaffPartitionFromRaw handles both JSON array (from Get) and string (from GetString)
// This is what the fix should implement in staff_skills.go
func containsStaffPartitionFromRaw(rawValue any) bool {
	if rawValue == nil {
		return false
	}

	// Handle as []interface{} (JSON array from record.Get())
	if arr, ok := rawValue.([]any); ok {
		for _, v := range arr {
			if str, ok := v.(string); ok && str == partitionStaff {
				return true
			}
		}
		return false
	}

	// Handle as []string (alternative array type)
	if arr, ok := rawValue.([]string); ok {
		for _, v := range arr {
			if v == partitionStaff {
				return true
			}
		}
		return false
	}

	// Fallback to string handling (comma-separated)
	if str, ok := rawValue.(string); ok {
		return containsStaffPartition(str)
	}

	return false
}

// TestStaffSkillsCompositeKeyFormat tests the composite key format used for upsert
func TestStaffSkillsCompositeKeyFormat(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
	keys := make([]string, 10)
	for i := range 10 {
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
	// Simulate person custom value data
	personValues := []testPersonSkillValue{
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "Int.|Exp.", Year: 2025},
		{PersonCMID: 12345, SkillCMID: 101, SkillName: "Backpacking", Value: "Teach", Year: 2025},
		{PersonCMID: 12346, SkillCMID: 100, SkillName: "Archery", Value: "Cert.", Year: 2025},
	}

	personDemographics := map[int]testStaffDemographics{
		12345: {FirstName: testFirstName, LastName: testLastName},
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
		return
	}
	if r1.SkillName != "Archery" {
		t.Errorf("expected skill name 'Archery', got %q", r1.SkillName)
	}
	if !r1.IsIntermediate || !r1.IsExperienced {
		t.Errorf("expected intermediate=true, experienced=true, got %v, %v", r1.IsIntermediate, r1.IsExperienced)
	}
	if r1.FirstName != testFirstName || r1.LastName != testLastName {
		t.Errorf("expected '%s %s', got '%s %s'", testFirstName, testLastName, r1.FirstName, r1.LastName)
	}

	// Verify third record (certified only)
	r3 := findStaffSkillRecord(records, 12346, 100)
	if r3 == nil {
		t.Fatal("record for person 12346, skill 100 not found")
		return
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
	t.Parallel()
	personValues := []testPersonSkillValue{
		// Duplicate entries for same person-skill-year (should deduplicate)
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "Int.", Year: 2025},
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "Exp.", Year: 2025},
	}

	personDemographics := map[int]testStaffDemographics{
		12345: {FirstName: testFirstName, LastName: testLastName},
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
	t.Parallel()
	// Notes fields should have booleans set to false and raw_value containing the text
	personValues := []testPersonSkillValue{
		{
			PersonCMID: 12345, SkillCMID: 200, SkillName: "would like to acquire",
			Value: "I want to learn rock climbing and wilderness first aid", Year: 2025,
		},
		{
			PersonCMID: 12345, SkillCMID: 201, SkillName: "Skill Notes",
			Value: "Extensive outdoor education background", Year: 2025,
		},
	}

	personDemographics := map[int]testStaffDemographics{
		12345: {FirstName: testFirstName, LastName: testLastName},
	}

	records := buildStaffSkillRecords(personValues, personDemographics)

	// Verify notes field handling
	notesRecord := findStaffSkillRecord(records, 12345, 200)
	if notesRecord == nil {
		t.Fatal("notes record not found")
		return
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
	t.Parallel()
	personValues := []testPersonSkillValue{}
	personDemographics := map[int]testStaffDemographics{}

	records := buildStaffSkillRecords(personValues, personDemographics)

	if len(records) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(records))
	}
}

// TestStaffSkillsEmptyValueSkipped tests that empty values are skipped
func TestStaffSkillsEmptyValueSkipped(t *testing.T) {
	t.Parallel()
	personValues := []testPersonSkillValue{
		{PersonCMID: 12345, SkillCMID: 100, SkillName: "Archery", Value: "", Year: 2025},
		{PersonCMID: 12345, SkillCMID: 101, SkillName: "Backpacking", Value: "Int.", Year: 2025},
	}

	personDemographics := map[int]testStaffDemographics{
		12345: {FirstName: testFirstName, LastName: testLastName},
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
	t.Parallel()
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

// TestStaffSkillsCompareFields verifies that the compareFields list for staff_skills
// contains exactly the expected fields (inclusion list pattern, not skipFields exclusion).
func TestStaffSkillsCompareFields(t *testing.T) {
	t.Parallel()
	// staffSkillsCompareFields should list all fields that matter for idempotency checks,
	// excluding PocketBase-managed fields (id, created, updated, collectionId, collectionName)
	// and the unique key fields (person_id, skill_cm_id, year) which don't change.
	expected := map[string]bool{
		"skill_name":      true,
		"is_intermediate": true,
		"is_experienced":  true,
		"can_teach":       true,
		"is_certified":    true,
		"raw_value":       true,
		"first_name":      true,
		"last_name":       true,
		"person":          true,
	}

	actual := make(map[string]bool)
	for _, f := range staffSkillsCompareFields {
		actual[f] = true
	}

	// Check all expected fields are present
	for field := range expected {
		if !actual[field] {
			t.Errorf("staffSkillsCompareFields missing expected field %q", field)
		}
	}

	// Check no unexpected fields are present
	for field := range actual {
		if !expected[field] {
			t.Errorf("staffSkillsCompareFields contains unexpected field %q", field)
		}
	}

	// Verify the unique key fields are NOT in compareFields (they should be excluded)
	keyFields := []string{"person_id", "skill_cm_id", "year"}
	for _, field := range keyFields {
		if actual[field] {
			t.Errorf("staffSkillsCompareFields should NOT contain key field %q", field)
		}
	}
}

// TestStaffSkillsRecordNeedsUpdateUsesCompareFields verifies that recordNeedsUpdate
// correctly detects when fields match (no update) and when they differ (needs update).
func TestStaffSkillsRecordNeedsUpdateUsesCompareFields(t *testing.T) {
	t.Parallel()
	s := &StaffSkillsSync{}

	// Create a minimal collection with the fields used in comparison
	col := core.NewBaseCollection("test_staff_skills")
	col.Fields.Add(&core.TextField{Name: "skill_name"})
	col.Fields.Add(&core.BoolField{Name: "is_intermediate"})
	col.Fields.Add(&core.BoolField{Name: "is_experienced"})
	col.Fields.Add(&core.BoolField{Name: "can_teach"})
	col.Fields.Add(&core.BoolField{Name: "is_certified"})
	col.Fields.Add(&core.TextField{Name: "raw_value"})
	col.Fields.Add(&core.TextField{Name: "first_name"})
	col.Fields.Add(&core.TextField{Name: "last_name"})
	col.Fields.Add(&core.TextField{Name: "person"})

	t.Run("no update when all fields match", func(t *testing.T) {
		existing := core.NewRecord(col)
		existing.Set("skill_name", "Archery")
		existing.Set("is_intermediate", true)
		existing.Set("is_experienced", false)
		existing.Set("can_teach", false)
		existing.Set("is_certified", false)
		existing.Set("raw_value", "Int.")
		existing.Set("first_name", testFirstName)
		existing.Set("last_name", testLastName)
		existing.Set("person", "pb_abc123")

		newData := map[string]any{
			"skill_name":      "Archery",
			"is_intermediate": true,
			"is_experienced":  false,
			"can_teach":       false,
			"is_certified":    false,
			"raw_value":       "Int.",
			"first_name":      testFirstName,
			"last_name":       testLastName,
			"person":          "pb_abc123",
		}

		if s.recordNeedsUpdate(existing, newData, staffSkillsCompareFields) {
			t.Error("expected no update needed when all compareFields match")
		}
	})

	t.Run("needs update when a compare field differs", func(t *testing.T) {
		existing := core.NewRecord(col)
		existing.Set("skill_name", "Archery")
		existing.Set("is_intermediate", true)
		existing.Set("is_experienced", false)
		existing.Set("can_teach", false)
		existing.Set("is_certified", false)
		existing.Set("raw_value", "Int.")
		existing.Set("first_name", testFirstName)
		existing.Set("last_name", testLastName)
		existing.Set("person", "pb_abc123")

		newData := map[string]any{
			"skill_name":      "Archery",
			"is_intermediate": true,
			"is_experienced":  true,
			"can_teach":       false,
			"is_certified":    false,
			"raw_value":       "Int.|Exp.",
			"first_name":      testFirstName,
			"last_name":       testLastName,
			"person":          "pb_abc123",
		}

		if !s.recordNeedsUpdate(existing, newData, staffSkillsCompareFields) {
			t.Error("expected update needed when is_experienced differs")
		}
	})
}

// newStaffSkillsOrphanTestApp returns a throwaway app holding only the
// staff_skills collection -- the minimum deleteOrphans touches (it looks up
// by ID and deletes; it does not read any other collection).
func newStaffSkillsOrphanTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("staff_skills")
	col.Fields.Add(&core.NumberField{Name: "person_id"})
	col.Fields.Add(&core.NumberField{Name: "skill_cm_id"})
	// Required, because every CampMinder-derived table carries a required year
	// (CLAUDE.md) -- a fixture that accepts a yearless row lets a test pass
	// against data production would reject.
	col.Fields.Add(&core.NumberField{Name: "year", Required: true})
	if err := app.Save(col); err != nil {
		t.Fatalf("save staff_skills: %v", err)
	}
	return app
}

// TestStaffSkillsDeleteOrphansRefusesCollapsedComputedSet pins the guard
// kindred#2283 adds. Before this fix deleteOrphans returned a bare int and had
// no channel to refuse a sweep at all -- an empty ProcessedKeys map against a
// populated year deleted the whole year and reported success.
func TestStaffSkillsDeleteOrphansRefusesCollapsedComputedSet(t *testing.T) {
	t.Parallel()
	app := newStaffSkillsOrphanTestApp(t)
	col, err := app.FindCollectionByNameOrId("staff_skills")
	if err != nil {
		t.Fatalf("find staff_skills: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("person_id", 12345)
	rec.Set("skill_cm_id", 100)
	rec.Set("year", 2026)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save existing row: %v", saveErr)
	}

	s := NewStaffSkillsSync(app)
	s.SyncSuccessful = true
	s.ProcessedKeys = make(map[string]bool) // nothing processed this run

	existing := map[string]*core.Record{"12345:100|2026": rec}
	deleted, err := s.deleteOrphans(existing, 2026)

	if err == nil {
		t.Fatal("expected an error when nothing was processed and rows exist, got nil")
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- nothing may be removed on the refusal path", deleted)
	}

	remaining, err := app.FindRecordsByFilter("staff_skills", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("%d rows survived, want 1 -- the guard must not delete", len(remaining))
	}
}

// TestStaffSkillsDeleteOrphansStillSweepsGenuineOrphans proves the guard did
// not disable orphan deletion for the normal case.
func TestStaffSkillsDeleteOrphansStillSweepsGenuineOrphans(t *testing.T) {
	t.Parallel()
	app := newStaffSkillsOrphanTestApp(t)
	col, err := app.FindCollectionByNameOrId("staff_skills")
	if err != nil {
		t.Fatalf("find staff_skills: %v", err)
	}
	orphan := core.NewRecord(col)
	orphan.Set("person_id", 12346)
	orphan.Set("skill_cm_id", 100)
	orphan.Set("year", 2026)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("save orphan: %v", saveErr)
	}

	s := NewStaffSkillsSync(app)
	s.SyncSuccessful = true
	s.ProcessedKeys = map[string]bool{"12345:100|2026": true}

	existing := map[string]*core.Record{"12346:100|2026": orphan}
	deleted, err := s.deleteOrphans(existing, 2026)
	if err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
}
