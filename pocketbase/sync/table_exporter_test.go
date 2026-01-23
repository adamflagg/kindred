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
		SheetName:  "{year}-attendees",
		IsGlobal:   false,
		Columns:    []ColumnConfig{},
	}

	// GetResolvedSheetName should replace {year}
	got := config.GetResolvedSheetName(2025)
	want := "2025-attendees"
	if got != want {
		t.Errorf("GetResolvedSheetName(2025) = %q, want %q", got, want)
	}
}

func TestExportConfig_GlobalSheetName(t *testing.T) {
	// Test that global exports don't use year prefix
	config := ExportConfig{
		Collection: "person_tag_defs",
		SheetName:  "globals-tag-definitions",
		IsGlobal:   true,
		Columns:    []ColumnConfig{},
	}

	// Global sheets should keep the same name regardless of year
	got := config.GetResolvedSheetName(2025)
	want := "globals-tag-definitions"
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

	got := resolver.ResolveValue("Emma", col)
	if got != "Emma" {
		t.Errorf("ResolveValue() = %v, want %v", got, "Emma")
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
	got := resolver.ResolveValue(float64(5), col)
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

	got := resolver.ResolveValue(nil, col)
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
	got := resolver.ResolveValue(ids, col)

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
	got := resolver.ResolveValue([]interface{}{}, col)
	if got != "" {
		t.Errorf("ResolveValue([]) = %q, want empty", got)
	}

	// Nil value
	got = resolver.ResolveValue(nil, col)
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

	got := resolver.ResolveValue("session_1", col)
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
