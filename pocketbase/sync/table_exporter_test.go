package sync

import (
	"context"
	"testing"
)

// =============================================================================
// Phase 3-5: Generic Table Exporter Tests
// =============================================================================

func TestFieldType_Constants(t *testing.T) {
	// Test that field type constants are defined
	tests := []struct {
		name     string
		got      FieldType
		wantDiff bool
	}{
		{"FieldTypeText", FieldTypeText, false},
		{"FieldTypeNumber", FieldTypeNumber, false},
		{"FieldTypeDate", FieldTypeDate, false},
		{"FieldTypeJSON", FieldTypeJSON, false},
		{"FieldTypeRelation", FieldTypeRelation, false},
		{"FieldTypeMultiRelation", FieldTypeMultiRelation, false},
	}

	// Verify all types are different
	seen := make(map[FieldType]string)
	for _, tt := range tests {
		if existing, ok := seen[tt.got]; ok {
			t.Errorf("FieldType %s has same value as %s", tt.name, existing)
		}
		seen[tt.got] = tt.name
	}
}

func TestColumnConfig_BasicFields(t *testing.T) {
	// Test ColumnConfig struct fields
	col := ColumnConfig{
		Field:        "person",
		Header:       "Person Name",
		Type:         FieldTypeRelation,
		RelatedCol:   "persons",
		RelatedField: "first_name",
	}

	if col.Field != "person" {
		t.Errorf("Field = %q, want %q", col.Field, "person")
	}
	if col.Header != "Person Name" {
		t.Errorf("Header = %q, want %q", col.Header, "Person Name")
	}
	if col.Type != FieldTypeRelation {
		t.Errorf("Type = %v, want FieldTypeRelation", col.Type)
	}
}

func TestExportConfig_YearPlaceholder(t *testing.T) {
	// Test that sheet name supports {year} placeholder
	config := ExportConfig{
		Collection: "attendees",
		SheetName:  "{year}-attendee",
		IsGlobal:   false,
		Columns:    []ColumnConfig{},
	}

	// GetResolvedSheetName should replace {year}
	got := config.GetResolvedSheetName(2025)
	want := "2025-attendee"
	if got != want {
		t.Errorf("GetResolvedSheetName(2025) = %q, want %q", got, want)
	}
}

func TestExportConfig_GlobalSheetName(t *testing.T) {
	// Test that global exports don't use year prefix
	config := ExportConfig{
		Collection: "person_tag_defs",
		SheetName:  "g-tag-def",
		IsGlobal:   true,
		Columns:    []ColumnConfig{},
	}

	// Global sheets should keep the same name regardless of year
	got := config.GetResolvedSheetName(2025)
	want := "g-tag-def"
	if got != want {
		t.Errorf("GetResolvedSheetName(2025) = %q, want %q", got, want)
	}
}

func TestFieldResolver_ResolveValue_Text(t *testing.T) {
	// Test resolving a simple text field
	resolver := NewFieldResolver()

	col := ColumnConfig{
		Field:  "first_name",
		Header: "First Name",
		Type:   FieldTypeText,
	}

	const testName = "Emma"
	got := resolver.ResolveValue(testName, &col)
	if got != testName {
		t.Errorf("ResolveValue() = %v, want %v", got, testName)
	}
}

func TestFieldResolver_ResolveValue_Number(t *testing.T) {
	// Test resolving a number field
	resolver := NewFieldResolver()

	col := ColumnConfig{
		Field:  "grade",
		Header: "Grade",
		Type:   FieldTypeNumber,
	}

	// Float64 input (as PocketBase returns)
	got := resolver.ResolveValue(float64(5), &col)
	if got != 5 {
		t.Errorf("ResolveValue() = %v, want %v", got, 5)
	}
}

func TestFieldResolver_ResolveValue_NilValue(t *testing.T) {
	// Test resolving nil values
	resolver := NewFieldResolver()

	col := ColumnConfig{
		Field:  "optional_field",
		Header: "Optional",
		Type:   FieldTypeText,
	}

	got := resolver.ResolveValue(nil, &col)
	if got != "" {
		t.Errorf("ResolveValue(nil) = %v, want empty string", got)
	}
}

func TestFieldResolver_PreloadLookup(t *testing.T) {
	// Test preloading lookup data
	resolver := NewFieldResolver()

	// Preload some lookup data
	resolver.SetLookupData("persons", map[string]string{
		"pb_id_1": "Emma Johnson",
		"pb_id_2": "Liam Garcia",
	})

	// Should be able to resolve relations
	got := resolver.LookupValue("persons", "pb_id_1")
	if got != "Emma Johnson" {
		t.Errorf("LookupValue() = %q, want %q", got, "Emma Johnson")
	}

	// Unknown ID should return empty
	got = resolver.LookupValue("persons", "unknown_id")
	if got != "" {
		t.Errorf("LookupValue(unknown) = %q, want empty", got)
	}
}

func TestFieldResolver_ResolveMultiRelation(t *testing.T) {
	// Test resolving multi-relation fields to comma-separated values
	resolver := NewFieldResolver()

	// Preload lookup data
	resolver.SetLookupData("person_tag_defs", map[string]string{
		"tag_1": "Alumni",
		"tag_2": "Leadership",
		"tag_3": "Volunteer",
	})

	col := ColumnConfig{
		Field:        "tags",
		Header:       "Tags",
		Type:         FieldTypeMultiRelation,
		RelatedCol:   "person_tag_defs",
		RelatedField: "name",
	}

	// Input is array of PB IDs
	ids := []interface{}{"tag_1", "tag_3"}
	got := resolver.ResolveValue(ids, &col)

	// Should be comma-separated names
	// Note: order may vary, so we check for presence
	gotStr, ok := got.(string)
	if !ok {
		t.Fatalf("Expected string, got %T", got)
	}
	if gotStr != "Alumni, Volunteer" && gotStr != "Volunteer, Alumni" {
		t.Errorf("ResolveValue() = %q, want Alumni/Volunteer combination", gotStr)
	}
}

func TestFieldResolver_ResolveMultiRelation_Empty(t *testing.T) {
	// Test resolving empty multi-relation
	resolver := NewFieldResolver()
	resolver.SetLookupData("bunks", map[string]string{})

	col := ColumnConfig{
		Field:        "bunks",
		Header:       "Bunks",
		Type:         FieldTypeMultiRelation,
		RelatedCol:   "bunks",
		RelatedField: "name",
	}

	// Empty array
	got := resolver.ResolveValue([]interface{}{}, &col)
	if got != "" {
		t.Errorf("ResolveValue([]) = %q, want empty", got)
	}

	// Nil value
	got = resolver.ResolveValue(nil, &col)
	if got != "" {
		t.Errorf("ResolveValue(nil) = %q, want empty", got)
	}
}

func TestFieldResolver_ResolveSingleRelation(t *testing.T) {
	// Test resolving single relation field
	resolver := NewFieldResolver()

	resolver.SetLookupData("camp_sessions", map[string]string{
		"session_1": "Session 2",
		"session_2": "Session 3",
	})

	col := ColumnConfig{
		Field:        "session",
		Header:       "Session",
		Type:         FieldTypeRelation,
		RelatedCol:   "camp_sessions",
		RelatedField: "name",
	}

	got := resolver.ResolveValue("session_1", &col)
	if got != "Session 2" {
		t.Errorf("ResolveValue() = %q, want %q", got, "Session 2")
	}
}

func TestBuildDataMatrix_Headers(t *testing.T) {
	// Test that headers are correctly generated from column configs
	columns := []ColumnConfig{
		{Field: "first_name", Header: "First Name", Type: FieldTypeText},
		{Field: "last_name", Header: "Last Name", Type: FieldTypeText},
		{Field: "grade", Header: "Grade", Type: FieldTypeNumber},
	}

	resolver := NewFieldResolver()
	data := BuildDataMatrix([]map[string]interface{}{}, columns, resolver)

	// Should have header row
	if len(data) != 1 {
		t.Fatalf("Expected 1 row (header only), got %d", len(data))
	}

	headers := data[0]
	if len(headers) != 3 {
		t.Fatalf("Expected 3 headers, got %d", len(headers))
	}

	if headers[0] != "First Name" {
		t.Errorf("Header[0] = %v, want 'First Name'", headers[0])
	}
	if headers[1] != "Last Name" {
		t.Errorf("Header[1] = %v, want 'Last Name'", headers[1])
	}
	if headers[2] != "Grade" {
		t.Errorf("Header[2] = %v, want 'Grade'", headers[2])
	}
}

func TestBuildDataMatrix_DataRows(t *testing.T) {
	// Test that data rows are correctly built
	columns := []ColumnConfig{
		{Field: "first_name", Header: "First Name", Type: FieldTypeText},
		{Field: "grade", Header: "Grade", Type: FieldTypeNumber},
	}

	records := []map[string]interface{}{
		{"first_name": "Emma", "grade": float64(5)},
		{"first_name": "Liam", "grade": float64(6)},
	}

	resolver := NewFieldResolver()
	data := BuildDataMatrix(records, columns, resolver)

	// Should have 3 rows (header + 2 data)
	if len(data) != 3 {
		t.Fatalf("Expected 3 rows, got %d", len(data))
	}

	// Check first data row
	if data[1][0] != "Emma" {
		t.Errorf("Row 1, Col 0 = %v, want 'Emma'", data[1][0])
	}
	if data[1][1] != 5 {
		t.Errorf("Row 1, Col 1 = %v, want 5", data[1][1])
	}

	// Check second data row
	if data[2][0] != "Liam" {
		t.Errorf("Row 2, Col 0 = %v, want 'Liam'", data[2][0])
	}
}

func TestGetYearSpecificExports(t *testing.T) {
	// Test that year-specific export configs are defined
	configs := GetYearSpecificExports()

	if len(configs) == 0 {
		t.Fatal("Expected at least one year-specific export config")
	}

	// Check attendees config exists
	var attendeesConfig *ExportConfig
	for i := range configs {
		if configs[i].Collection == "attendees" {
			attendeesConfig = &configs[i]
			break
		}
	}

	if attendeesConfig == nil {
		t.Fatal("Expected 'attendees' export config")
	}

	if attendeesConfig.IsGlobal {
		t.Error("attendees should not be global")
	}

	if len(attendeesConfig.Columns) == 0 {
		t.Error("attendees should have columns defined")
	}
}

func TestGetGlobalExports(t *testing.T) {
	// Test that global export configs are defined
	configs := GetGlobalExports()

	if len(configs) == 0 {
		t.Fatal("Expected at least one global export config")
	}

	// All should be marked as global
	for _, config := range configs {
		if !config.IsGlobal {
			t.Errorf("Export %s should be marked as global", config.Collection)
		}
	}
}

func TestTableExporter_ExportCallsEnsureSheet(t *testing.T) {
	// Test that TableExporter calls EnsureSheet before writing
	mock := NewMockSheetsWriter()
	resolver := NewFieldResolver()

	exporter := &TableExporter{
		writer:        mock,
		resolver:      resolver,
		spreadsheetID: "test-spreadsheet",
		year:          2025,
	}

	config := ExportConfig{
		Collection: "test_collection",
		SheetName:  "{year}-test",
		IsGlobal:   false,
		Columns: []ColumnConfig{
			{Field: "name", Header: "Name", Type: FieldTypeText},
		},
	}

	records := []map[string]interface{}{
		{"name": "Test Record"},
	}

	err := exporter.Export(context.Background(), &config, records)
	if err != nil {
		t.Fatalf("Export() error = %v", err)
	}

	// Should have ensured the sheet
	if len(mock.EnsuredTabs) != 1 {
		t.Errorf("Expected 1 tab ensured, got %d", len(mock.EnsuredTabs))
	}
	if mock.EnsuredTabs[0] != "2025-test" {
		t.Errorf("Ensured tab = %q, want %q", mock.EnsuredTabs[0], "2025-test")
	}

	// Should have written data
	if _, ok := mock.WrittenData["2025-test"]; !ok {
		t.Error("Expected data written to 2025-test")
	}
}

// =============================================================================
// New Field Types Tests (Phase: Sheets Column Alignment)
// =============================================================================

func TestFieldType_NewConstants(t *testing.T) {
	// Test that new field type constants are defined and unique
	types := []struct {
		name string
		got  FieldType
	}{
		{"FieldTypeForeignKeyID", FieldTypeForeignKeyID},
		{"FieldTypeNestedField", FieldTypeNestedField},
		{"FieldTypeWriteInOverride", FieldTypeWriteInOverride},
		{"FieldTypeDoubleFKResolve", FieldTypeDoubleFKResolve},
		{"FieldTypeCMIDLookup", FieldTypeCMIDLookup},
	}

	// Verify all types are different from each other and from existing types
	seen := make(map[FieldType]string)
	existingTypes := []FieldType{
		FieldTypeText, FieldTypeNumber, FieldTypeDate,
		FieldTypeJSON, FieldTypeRelation, FieldTypeMultiRelation,
	}
	for i, t := range existingTypes {
		seen[t] = []string{"Text", "Number", "Date", "JSON", "Relation", "MultiRelation"}[i]
	}

	for _, tt := range types {
		if existing, ok := seen[tt.got]; ok {
			t.Errorf("FieldType %s has same value as %s", tt.name, existing)
		}
		seen[tt.got] = tt.name
	}
}

func TestFieldResolver_ResolveForeignKeyID(t *testing.T) {
	// Test resolving a relation field to its cm_id (not display name)
	resolver := NewFieldResolver()

	// Set up lookup data with CM IDs
	resolver.SetCMIDLookupData("persons", map[string]int{
		"pb_person_1": 1000001,
		"pb_person_2": 1000002,
	})

	col := ColumnConfig{
		Field:      "person",
		Header:     "Person ID",
		Type:       FieldTypeForeignKeyID,
		RelatedCol: "persons",
	}

	// Should resolve to CM ID
	got := resolver.ResolveValue("pb_person_1", &col)
	if got != 1000001 {
		t.Errorf("ResolveValue() = %v, want %v", got, 1000001)
	}

	// Unknown ID should return empty
	got = resolver.ResolveValue("unknown_pb_id", &col)
	if got != "" {
		t.Errorf("ResolveValue(unknown) = %v, want empty string", got)
	}
}

func TestFieldResolver_ResolveNestedField(t *testing.T) {
	// Test resolving a relation field to a specific nested property (e.g., person → first_name)
	resolver := NewFieldResolver()

	// Set up lookup data with nested fields
	resolver.SetNestedFieldLookupData("persons", "first_name", map[string]string{
		"pb_person_1": "Emma",
		"pb_person_2": "Liam",
	})
	resolver.SetNestedFieldLookupData("persons", "last_name", map[string]string{
		"pb_person_1": "Johnson",
		"pb_person_2": "Garcia",
	})

	colFirstName := ColumnConfig{
		Field:       "person",
		Header:      "First Name",
		Type:        FieldTypeNestedField,
		RelatedCol:  "persons",
		NestedField: "first_name",
	}

	colLastName := ColumnConfig{
		Field:       "person",
		Header:      "Last Name",
		Type:        FieldTypeNestedField,
		RelatedCol:  "persons",
		NestedField: "last_name",
	}

	// Should resolve to the nested field value
	got := resolver.ResolveValue("pb_person_1", &colFirstName)
	if got != "Emma" {
		t.Errorf("ResolveValue(first_name) = %v, want Emma", got)
	}

	got = resolver.ResolveValue("pb_person_1", &colLastName)
	if got != "Johnson" {
		t.Errorf("ResolveValue(last_name) = %v, want Johnson", got)
	}
}

func TestFieldResolver_ResolveWriteInOverride(t *testing.T) {
	// Test resolving write-in override fields (write_in takes precedence over standard)
	resolver := NewFieldResolver()

	// Column config for write-in override
	col := ColumnConfig{
		Field:        "gender_identity_name", // Standard field
		Header:       "Gender Identity",
		Type:         FieldTypeWriteInOverride,
		WriteInField: "gender_identity_write_in", // Override field
	}

	// Test 1: Both fields empty - should return empty
	record := map[string]interface{}{
		"gender_identity_name":     "",
		"gender_identity_write_in": "",
	}
	got := resolver.ResolveWriteInOverride(record, &col)
	if got != "" {
		t.Errorf("Both empty: got %q, want empty", got)
	}

	// Test 2: Standard field set, write-in empty - should return standard
	record = map[string]interface{}{
		"gender_identity_name":     "Non-binary",
		"gender_identity_write_in": "",
	}
	got = resolver.ResolveWriteInOverride(record, &col)
	if got != "Non-binary" {
		t.Errorf("Standard only: got %q, want Non-binary", got)
	}

	// Test 3: Both set - write-in should take precedence
	record = map[string]interface{}{
		"gender_identity_name":     "Other",
		"gender_identity_write_in": "Genderqueer",
	}
	got = resolver.ResolveWriteInOverride(record, &col)
	if got != "Genderqueer" {
		t.Errorf("Both set: got %q, want Genderqueer", got)
	}

	// Test 4: Write-in set, standard empty - should return write-in
	record = map[string]interface{}{
		"gender_identity_name":     "",
		"gender_identity_write_in": "Custom Identity",
	}
	got = resolver.ResolveWriteInOverride(record, &col)
	if got != "Custom Identity" {
		t.Errorf("Write-in only: got %q, want Custom Identity", got)
	}
}

func TestFieldResolver_ResolveDoubleFKResolve(t *testing.T) {
	// Test resolving through two relations (staff.position1 → position.program_area → name)
	resolver := NewFieldResolver()

	// Set up position → program_area mapping
	resolver.SetDoubleFKLookupData("staff_positions", "program_area", map[string]string{
		"pos_1": "prog_area_1",
		"pos_2": "prog_area_2",
		"pos_3": "", // Position without program area
	})

	// Set up program_area → name mapping
	resolver.SetLookupData("staff_program_areas", map[string]string{
		"prog_area_1": "Waterfront",
		"prog_area_2": "Arts & Crafts",
	})

	col := ColumnConfig{
		Field:            "position1",
		Header:           "Position 1 Program Area",
		Type:             FieldTypeDoubleFKResolve,
		RelatedCol:       "staff_positions",
		IntermediateCol:  "staff_program_areas",
		IntermediateLink: "program_area",
	}

	// Should resolve through both relations
	got := resolver.ResolveValue("pos_1", &col)
	if got != "Waterfront" {
		t.Errorf("ResolveValue(pos_1) = %v, want Waterfront", got)
	}

	got = resolver.ResolveValue("pos_2", &col)
	if got != "Arts & Crafts" {
		t.Errorf("ResolveValue(pos_2) = %v, want Arts & Crafts", got)
	}

	// Position without program area should return empty
	got = resolver.ResolveValue("pos_3", &col)
	if got != "" {
		t.Errorf("ResolveValue(pos_3) = %v, want empty", got)
	}
}

func TestFieldResolver_ResolveCMIDLookup(t *testing.T) {
	// Test looking up by CM ID rather than PB ID (for session parent_id)
	resolver := NewFieldResolver()

	// Set up sessions indexed by CM ID
	resolver.SetCMIDIndexedLookup("camp_sessions", map[int]string{
		1335115: "Session 2",
		1335116: "Session 3",
		1335117: "Session 4",
	})

	col := ColumnConfig{
		Field:      "parent_id",
		Header:     "Parent Session",
		Type:       FieldTypeCMIDLookup,
		RelatedCol: "camp_sessions",
	}

	// Should resolve CM ID to display name
	got := resolver.ResolveValue(float64(1335115), &col)
	if got != "Session 2" {
		t.Errorf("ResolveValue(1335115) = %v, want Session 2", got)
	}

	// Integer input should also work
	got = resolver.ResolveValue(1335116, &col)
	if got != "Session 3" {
		t.Errorf("ResolveValue(1335116 int) = %v, want Session 3", got)
	}

	// Unknown CM ID should return empty
	got = resolver.ResolveValue(float64(9999999), &col)
	if got != "" {
		t.Errorf("ResolveValue(unknown) = %v, want empty", got)
	}

	// Nil/zero should return empty
	got = resolver.ResolveValue(nil, &col)
	if got != "" {
		t.Errorf("ResolveValue(nil) = %v, want empty", got)
	}
}

func TestColumnConfig_NewFields(t *testing.T) {
	// Test that ColumnConfig has new fields for advanced resolution
	col := ColumnConfig{
		Field:            "position1",
		Header:           "Position 1 Program Area",
		Type:             FieldTypeDoubleFKResolve,
		RelatedCol:       "staff_positions",
		RelatedField:     "name",
		NestedField:      "first_name",
		WriteInField:     "gender_identity_write_in",
		IntermediateCol:  "staff_program_areas",
		IntermediateLink: "program_area",
	}

	if col.NestedField != "first_name" {
		t.Errorf("NestedField = %q, want first_name", col.NestedField)
	}
	if col.WriteInField != "gender_identity_write_in" {
		t.Errorf("WriteInField = %q, want gender_identity_write_in", col.WriteInField)
	}
	if col.IntermediateCol != "staff_program_areas" {
		t.Errorf("IntermediateCol = %q, want staff_program_areas", col.IntermediateCol)
	}
	if col.IntermediateLink != "program_area" {
		t.Errorf("IntermediateLink = %q, want program_area", col.IntermediateLink)
	}
}

func TestGetGlobalExports_DivisionsIncluded(t *testing.T) {
	// Test that globals include divisions and NOT staff_positions
	// staff_positions data is already inlined in staff export
	configs := GetGlobalExports()

	var hasDivisions, hasStaffPositions bool
	for _, config := range configs {
		if config.Collection == "divisions" {
			hasDivisions = true
		}
		if config.Collection == "staff_positions" {
			hasStaffPositions = true
		}
	}

	if !hasDivisions {
		t.Error("Expected 'divisions' in global exports")
	}
	if hasStaffPositions {
		t.Error("staff_positions should NOT be in global exports (data is inlined in staff export)")
	}
}

func TestGetGlobalExports_Count(t *testing.T) {
	// Test that we have exactly 4 global exports (staff_positions removed)
	configs := GetGlobalExports()

	if len(configs) != 4 {
		t.Errorf("Expected 4 global exports, got %d", len(configs))
		for _, c := range configs {
			t.Logf("  - %s", c.Collection)
		}
	}
}

func TestFieldResolver_ResolveBool(t *testing.T) {
	// Test resolving boolean fields
	resolver := NewFieldResolver()

	col := ColumnConfig{
		Field:  "is_active",
		Header: "Is Active",
		Type:   FieldTypeBool,
	}

	// True value
	got := resolver.ResolveValue(true, &col)
	if got != boolTrueStr {
		t.Errorf("ResolveValue(true) = %v, want %s", got, boolTrueStr)
	}

	// False value
	got = resolver.ResolveValue(false, &col)
	if got != "false" {
		t.Errorf("ResolveValue(false) = %v, want false", got)
	}

	// Nil value
	got = resolver.ResolveValue(nil, &col)
	if got != "" {
		t.Errorf("ResolveValue(nil) = %v, want empty", got)
	}
}

func TestBuildDataMatrix_WriteInOverride(t *testing.T) {
	// Test that BuildDataMatrix handles WriteInOverride correctly
	resolver := NewFieldResolver()

	columns := []ColumnConfig{
		{
			Field: "gender_identity_name", Header: "Gender Identity",
			Type: FieldTypeWriteInOverride, WriteInField: "gender_identity_write_in",
		},
	}

	// Record with write-in value (should override)
	records := []map[string]interface{}{
		{"gender_identity_name": "Other", "gender_identity_write_in": "Genderqueer"},
		{"gender_identity_name": "Non-binary", "gender_identity_write_in": ""},
		{"gender_identity_name": "", "gender_identity_write_in": ""},
	}

	data := BuildDataMatrix(records, columns, resolver)

	// Check header
	if data[0][0] != "Gender Identity" {
		t.Errorf("Header = %v, want Gender Identity", data[0][0])
	}

	// Check write-in override works
	if data[1][0] != "Genderqueer" {
		t.Errorf("Row 1 = %v, want Genderqueer (write-in override)", data[1][0])
	}

	// Check fallback to standard field
	if data[2][0] != "Non-binary" {
		t.Errorf("Row 2 = %v, want Non-binary (standard field)", data[2][0])
	}

	// Check empty case
	if data[3][0] != "" {
		t.Errorf("Row 3 = %v, want empty", data[3][0])
	}
}
