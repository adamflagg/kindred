package sync

import (
	"testing"
)

func TestCustomFieldDefinitionsSync_Name(t *testing.T) {
	s := &CustomFieldDefinitionsSync{}

	got := s.Name()
	want := "custom_field_definitions"

	if got != want {
		t.Errorf("CustomFieldDefinitionsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformCustomFieldDefinitionToPB tests transformation to PocketBase format
func TestTransformCustomFieldDefinitionToPB(t *testing.T) {
	s := &CustomFieldDefinitionsSync{}

	// Mock CampMinder API response
	data := map[string]interface{}{
		"Id":         float64(12345),
		"Name":       "Dietary Restrictions",
		"DataType":   "String",
		"Partition":  "Camper",
		"IsSeasonal": false,
		"IsArray":    true,
		"IsActive":   true,
	}

	year := 2025

	pbData, err := s.transformCustomFieldDefinitionToPB(data, year)
	if err != nil {
		t.Fatalf("transformCustomFieldDefinitionToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Dietary Restrictions"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
	if got, want := pbData["data_type"].(string), "String"; got != want {
		t.Errorf("data_type = %q, want %q", got, want)
	}
	if got, want := pbData["partition"].(string), "Camper"; got != want {
		t.Errorf("partition = %q, want %q", got, want)
	}
	if got, want := pbData["is_seasonal"].(bool), false; got != want {
		t.Errorf("is_seasonal = %v, want %v", got, want)
	}
	if got, want := pbData["is_array"].(bool), true; got != want {
		t.Errorf("is_array = %v, want %v", got, want)
	}
	if got, want := pbData["is_active"].(bool), true; got != want {
		t.Errorf("is_active = %v, want %v", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
}

// TestTransformCustomFieldDefinitionHandlesMissingFields tests handling of optional fields
func TestTransformCustomFieldDefinitionHandlesMissingFields(t *testing.T) {
	s := &CustomFieldDefinitionsSync{}

	// Minimal data with only required fields
	data := map[string]interface{}{
		"Id":   float64(12345),
		"Name": "Test Field",
	}

	year := 2025

	pbData, err := s.transformCustomFieldDefinitionToPB(data, year)
	if err != nil {
		t.Fatalf("transformCustomFieldDefinitionToPB returned error: %v", err)
	}

	// Required fields should be set
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Test Field"; got != want {
		t.Errorf("name = %q, want %q", got, want)
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
	s := &CustomFieldDefinitionsSync{}

	// Missing ID field
	data := map[string]interface{}{
		"Name": "Test Field",
	}

	_, err := s.transformCustomFieldDefinitionToPB(data, 2025)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

// TestTransformCustomFieldDefinitionRequiredNameError tests error on missing Name
func TestTransformCustomFieldDefinitionRequiredNameError(t *testing.T) {
	s := &CustomFieldDefinitionsSync{}

	// Missing Name field
	data := map[string]interface{}{
		"Id": float64(12345),
	}

	_, err := s.transformCustomFieldDefinitionToPB(data, 2025)
	if err == nil {
		t.Error("expected error for missing Name, got nil")
	}
}

// TestTransformCustomFieldDefinitionZeroIDError tests error on ID=0
func TestTransformCustomFieldDefinitionZeroIDError(t *testing.T) {
	s := &CustomFieldDefinitionsSync{}

	// ID=0 (invalid)
	data := map[string]interface{}{
		"Id":   float64(0),
		"Name": "Test Field",
	}

	_, err := s.transformCustomFieldDefinitionToPB(data, 2025)
	if err == nil {
		t.Error("expected error for ID=0, got nil")
	}
}

// TestTransformCustomFieldDefinitionEmptyNameError tests error on empty Name
func TestTransformCustomFieldDefinitionEmptyNameError(t *testing.T) {
	s := &CustomFieldDefinitionsSync{}

	// Empty Name
	data := map[string]interface{}{
		"Id":   float64(12345),
		"Name": "",
	}

	_, err := s.transformCustomFieldDefinitionToPB(data, 2025)
	if err == nil {
		t.Error("expected error for empty Name, got nil")
	}
}

// TestTransformCustomFieldDefinitionValidDataTypes tests all valid data types
func TestTransformCustomFieldDefinitionValidDataTypes(t *testing.T) {
	s := &CustomFieldDefinitionsSync{}

	validDataTypes := []string{"None", "String", "Integer", "Decimal", "Date", "Time", "DateTime", "Boolean"}

	for _, dt := range validDataTypes {
		data := map[string]interface{}{
			"Id":       float64(12345),
			"Name":     "Test Field",
			"DataType": dt,
		}

		pbData, err := s.transformCustomFieldDefinitionToPB(data, 2025)
		if err != nil {
			t.Errorf("transformCustomFieldDefinitionToPB returned error for DataType %q: %v", dt, err)
			continue
		}

		if got := pbData["data_type"].(string); got != dt {
			t.Errorf("data_type = %q, want %q", got, dt)
		}
	}
}

// TestTransformCustomFieldDefinitionValidPartitions tests all valid partitions
func TestTransformCustomFieldDefinitionValidPartitions(t *testing.T) {
	s := &CustomFieldDefinitionsSync{}

	validPartitions := []string{"None", "Family", "Alumnus", "Staff", "Camper", "Parent", "Adult"}

	for _, p := range validPartitions {
		data := map[string]interface{}{
			"Id":        float64(12345),
			"Name":      "Test Field",
			"Partition": p,
		}

		pbData, err := s.transformCustomFieldDefinitionToPB(data, 2025)
		if err != nil {
			t.Errorf("transformCustomFieldDefinitionToPB returned error for Partition %q: %v", p, err)
			continue
		}

		if got := pbData["partition"].(string); got != p {
			t.Errorf("partition = %q, want %q", got, p)
		}
	}
}
