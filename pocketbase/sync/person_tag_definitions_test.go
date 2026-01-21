package sync

import (
	"testing"
)

func TestPersonTagDefinitionsSync_Name(t *testing.T) {
	s := &PersonTagDefinitionsSync{}

	got := s.Name()
	want := "person_tag_definitions"

	if got != want {
		t.Errorf("PersonTagDefinitionsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformPersonTagDefinitionToPB tests that all CampMinder tag definition fields are extracted
func TestTransformPersonTagDefinitionToPB(t *testing.T) {
	s := &PersonTagDefinitionsSync{}

	// Mock CampMinder API response (based on TagDef schema in persons.yaml)
	// Note: TagDef does NOT have an ID field - Name is the identifier
	tagData := map[string]interface{}{
		"Name":           "Alumni",
		"IsSeasonal":     true,
		"IsHidden":       false,
		"LastUpdatedUTC": "2025-01-15T10:30:00.000Z",
	}

	year := 2025

	pbData, err := s.transformPersonTagDefinitionToPB(tagData, year)
	if err != nil {
		t.Fatalf("transformPersonTagDefinitionToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["name"].(string), "Alumni"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
	if got, want := pbData["is_seasonal"], true; got != want {
		t.Errorf("is_seasonal = %v, want %v", got, want)
	}
	if got, want := pbData["is_hidden"], false; got != want {
		t.Errorf("is_hidden = %v, want %v", got, want)
	}
	if got, want := pbData["last_updated_utc"], "2025-01-15T10:30:00.000Z"; got != want {
		t.Errorf("last_updated_utc = %v, want %v", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
}

// TestTransformPersonTagDefinitionHandlesMissingFields tests that nil/missing fields don't cause errors
func TestTransformPersonTagDefinitionHandlesMissingFields(t *testing.T) {
	s := &PersonTagDefinitionsSync{}

	// Minimal data with only required fields
	tagData := map[string]interface{}{
		"Name": "Volunteer",
	}

	year := 2025

	pbData, err := s.transformPersonTagDefinitionToPB(tagData, year)
	if err != nil {
		t.Fatalf("transformPersonTagDefinitionToPB returned error: %v", err)
	}

	// Required fields should be set
	if got, want := pbData["name"].(string), "Volunteer"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// Optional fields should be present (even if nil/zero value)
	optionalFields := []string{"is_seasonal", "is_hidden", "last_updated_utc"}
	for _, field := range optionalFields {
		if _, exists := pbData[field]; !exists {
			t.Errorf("field %q missing from pbData (should be present even if nil)", field)
		}
	}
}

// TestTransformPersonTagDefinitionRequiredNameError tests that missing Name returns error
func TestTransformPersonTagDefinitionRequiredNameError(t *testing.T) {
	s := &PersonTagDefinitionsSync{}

	// Missing Name field
	tagData := map[string]interface{}{
		"IsSeasonal": true,
	}

	_, err := s.transformPersonTagDefinitionToPB(tagData, 2025)
	if err == nil {
		t.Error("expected error for missing Name, got nil")
	}
}

// TestTransformPersonTagDefinitionEmptyNameError tests that empty Name returns error
func TestTransformPersonTagDefinitionEmptyNameError(t *testing.T) {
	s := &PersonTagDefinitionsSync{}

	// Empty Name field
	tagData := map[string]interface{}{
		"Name": "",
	}

	_, err := s.transformPersonTagDefinitionToPB(tagData, 2025)
	if err == nil {
		t.Error("expected error for empty Name, got nil")
	}
}
