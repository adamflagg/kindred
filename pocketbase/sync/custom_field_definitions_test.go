package sync

import (
	"reflect"
	"testing"
)

// TestTransformCustomFieldDefinitionToPB tests transformation to PocketBase format
// Note: CampMinder API uses camelCase field names for this endpoint
func TestTransformCustomFieldDefinitionToPB(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	// Mock CampMinder API response (camelCase field names)
	data := map[string]any{
		"id":         float64(12345),
		"name":       "Dietary Restrictions",
		"dataType":   "String",
		"partition":  "Camper",
		"isSeasonal": false,
		"isArray":    true,
		"isActive":   true,
	}

	pbData, err := s.transformCustomFieldDefinitionToPB(data)
	if err != nil {
		t.Fatalf("transformCustomFieldDefinitionToPB returned error: %v", err)
	}

	// Verify fields
	gotCMID, ok := pbData["cm_id"].(int)
	if !ok {
		t.Fatal("cm_id type assertion failed")
		return
	}
	if gotCMID != 12345 {
		t.Errorf("cm_id = %d, want %d", gotCMID, 12345)
	}
	gotName, ok := pbData["name"].(string)
	if !ok {
		t.Fatal("name type assertion failed")
		return
	}
	if gotName != "Dietary Restrictions" {
		t.Errorf("name = %q, want %q", gotName, "Dietary Restrictions")
	}
	gotDataType, ok := pbData["data_type"].(string)
	if !ok {
		t.Fatal("data_type type assertion failed")
		return
	}
	if gotDataType != "String" {
		t.Errorf("data_type = %q, want %q", gotDataType, "String")
	}
	// Partition is now a []string (multi-select)
	gotPartition, ok := pbData["partition"].([]string)
	if !ok {
		t.Fatal("partition type assertion failed")
		return
	}
	if !reflect.DeepEqual(gotPartition, []string{"Camper"}) {
		t.Errorf("partition = %v, want %v", gotPartition, []string{"Camper"})
	}
	gotSeasonal, ok := pbData["is_seasonal"].(bool)
	if !ok {
		t.Fatal("is_seasonal type assertion failed")
		return
	}
	if gotSeasonal != false {
		t.Errorf("is_seasonal = %v, want %v", gotSeasonal, false)
	}
	gotArray, ok := pbData["is_array"].(bool)
	if !ok {
		t.Fatal("is_array type assertion failed")
		return
	}
	if gotArray != true {
		t.Errorf("is_array = %v, want %v", gotArray, true)
	}
	gotActive, ok := pbData["is_active"].(bool)
	if !ok {
		t.Fatal("is_active type assertion failed")
		return
	}
	if gotActive != true {
		t.Errorf("is_active = %v, want %v", gotActive, true)
	}
	// Note: year field removed - custom field definitions are global (not year-specific)
	if _, hasYear := pbData["year"]; hasYear {
		t.Error("year field should not be present - definitions are global")
	}
}

// TestTransformCustomFieldDefinitionHandlesMissingFields tests handling of optional fields
func TestTransformCustomFieldDefinitionHandlesMissingFields(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	// Minimal data with only required fields (camelCase)
	data := map[string]any{
		"id":   float64(12345),
		"name": "Test Field",
	}

	pbData, err := s.transformCustomFieldDefinitionToPB(data)
	if err != nil {
		t.Fatalf("transformCustomFieldDefinitionToPB returned error: %v", err)
	}

	// Required fields should be set
	gotCMID2, ok := pbData["cm_id"].(int)
	if !ok {
		t.Fatal("cm_id type assertion failed")
		return
	}
	if gotCMID2 != 12345 {
		t.Errorf("cm_id = %d, want %d", gotCMID2, 12345)
	}
	gotName2, ok := pbData["name"].(string)
	if !ok {
		t.Fatal("name type assertion failed")
		return
	}
	if gotName2 != "Test Field" {
		t.Errorf("name = %q, want %q", gotName2, "Test Field")
	}

	// Optional fields should have defaults
	if _, exists := pbData["data_type"]; !exists {
		t.Error("data_type should be present even with default")
	}
	if _, exists := pbData["partition"]; !exists {
		t.Error("partition should be present even with default")
	}
	if _, exists := pbData["is_seasonal"]; !exists {
		t.Error("is_seasonal should be present even with default")
	}
	if _, exists := pbData["is_array"]; !exists {
		t.Error("is_array should be present even with default")
	}
	if _, exists := pbData["is_active"]; !exists {
		t.Error("is_active should be present even with default")
	}
}

// TestTransformCustomFieldDefinitionRequiredIDError tests error on missing ID
func TestTransformCustomFieldDefinitionRequiredIDError(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	// Missing ID field
	data := map[string]any{
		"name": "Test Field",
	}

	_, err := s.transformCustomFieldDefinitionToPB(data)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

// TestTransformCustomFieldDefinitionRequiredNameError tests error on missing Name
func TestTransformCustomFieldDefinitionRequiredNameError(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	// Missing Name field
	data := map[string]any{
		"id": float64(12345),
	}

	_, err := s.transformCustomFieldDefinitionToPB(data)
	if err == nil {
		t.Error("expected error for missing Name, got nil")
	}
}

// TestTransformCustomFieldDefinitionZeroIDError tests error on ID=0
func TestTransformCustomFieldDefinitionZeroIDError(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	// ID=0 (invalid)
	data := map[string]any{
		"id":   float64(0),
		"name": "Test Field",
	}

	_, err := s.transformCustomFieldDefinitionToPB(data)
	if err == nil {
		t.Error("expected error for ID=0, got nil")
	}
}

// TestTransformCustomFieldDefinitionEmptyNameError tests error on empty Name
func TestTransformCustomFieldDefinitionEmptyNameError(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	// Empty Name
	data := map[string]any{
		"id":   float64(12345),
		"name": "",
	}

	_, err := s.transformCustomFieldDefinitionToPB(data)
	if err == nil {
		t.Error("expected error for empty Name, got nil")
	}
}

// TestTransformCustomFieldDefinitionValidDataTypes tests all valid data types
func TestTransformCustomFieldDefinitionValidDataTypes(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	validDataTypes := []string{"None", "String", "Integer", "Decimal", "Date", "Time", "DateTime", "Boolean"}

	for _, dt := range validDataTypes {
		data := map[string]any{
			"id":       float64(12345),
			"name":     "Test Field",
			"dataType": dt,
		}

		pbData, err := s.transformCustomFieldDefinitionToPB(data)
		if err != nil {
			t.Errorf("transformCustomFieldDefinitionToPB returned error for DataType %q: %v", dt, err)
			continue
		}

		gotDT, ok := pbData["data_type"].(string)
		if !ok {
			t.Errorf("data_type type assertion failed for %q", dt)
			continue
		}
		if gotDT != dt {
			t.Errorf("data_type = %q, want %q", gotDT, dt)
		}
	}
}

// TestTransformCustomFieldDefinitionValidPartitions tests all valid partitions
func TestTransformCustomFieldDefinitionValidPartitions(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	validPartitions := []string{"None", "Family", "Alumnus", "Staff", "Camper", "Parent", "Adult"}

	for _, p := range validPartitions {
		data := map[string]any{
			"id":        float64(12345),
			"name":      "Test Field",
			"partition": p,
		}

		pbData, err := s.transformCustomFieldDefinitionToPB(data)
		if err != nil {
			t.Errorf("transformCustomFieldDefinitionToPB returned error for Partition %q: %v", p, err)
			continue
		}

		// Partition is now a []string (multi-select)
		want := []string{p}
		gotP, ok := pbData["partition"].([]string)
		if !ok {
			t.Errorf("partition type assertion failed for %q", p)
			continue
		}
		if !reflect.DeepEqual(gotP, want) {
			t.Errorf("partition = %v, want %v", gotP, want)
		}
	}
}

// TestTransformCustomFieldDefinitionMultiValuePartition tests handling of multi-value partitions
func TestTransformCustomFieldDefinitionMultiValuePartition(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	// Test multi-value partition (as returned by CampMinder API)
	data := map[string]any{
		"id":        float64(12345),
		"name":      "Multi-Partition Field",
		"partition": "Camper, Adult",
	}

	pbData, err := s.transformCustomFieldDefinitionToPB(data)
	if err != nil {
		t.Fatalf("transformCustomFieldDefinitionToPB returned error: %v", err)
	}

	// Should split into array
	want := []string{"Camper", "Adult"}
	if got := pbData["partition"].([]string); !reflect.DeepEqual(got, want) {
		t.Errorf("partition = %v, want %v", got, want)
	}
}

// TestTransformCustomFieldDefinitionTripleValuePartition tests handling of three-value partitions
func TestTransformCustomFieldDefinitionTripleValuePartition(t *testing.T) {
	t.Parallel()
	s := &CustomFieldDefinitionsSync{}

	// Test three-value partition
	data := map[string]any{
		"id":        float64(12345),
		"name":      "Triple-Partition Field",
		"partition": "Staff, Camper, Parent",
	}

	pbData, err := s.transformCustomFieldDefinitionToPB(data)
	if err != nil {
		t.Fatalf("transformCustomFieldDefinitionToPB returned error: %v", err)
	}

	// Should split into array
	want := []string{"Staff", "Camper", "Parent"}
	if got := pbData["partition"].([]string); !reflect.DeepEqual(got, want) {
		t.Errorf("partition = %v, want %v", got, want)
	}
}
