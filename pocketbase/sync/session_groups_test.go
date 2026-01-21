package sync

import (
	"testing"
)

func TestSessionGroupsSync_Name(t *testing.T) {
	s := &SessionGroupsSync{}

	got := s.Name()
	want := "session_groups"

	if got != want {
		t.Errorf("SessionGroupsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformSessionGroupToPB tests that all CampMinder session group fields are extracted
func TestTransformSessionGroupToPB(t *testing.T) {
	s := &SessionGroupsSync{}

	// Mock CampMinder API response
	groupData := map[string]interface{}{
		"ID":          float64(100),
		"Name":        "Main Sessions",
		"Description": "Standard summer camp sessions",
		"IsActive":    true,
		"SortOrder":   float64(1),
	}

	year := 2025

	pbData, err := s.transformSessionGroupToPB(groupData, year)
	if err != nil {
		t.Fatalf("transformSessionGroupToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 100; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Main Sessions"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
	if got, want := pbData["description"], "Standard summer camp sessions"; got != want {
		t.Errorf("description = %v, want %v", got, want)
	}
	if got, want := pbData["is_active"], true; got != want {
		t.Errorf("is_active = %v, want %v", got, want)
	}
	if got, want := pbData["sort_order"], float64(1); got != want {
		t.Errorf("sort_order = %v, want %v", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
}

// TestTransformSessionGroupHandlesMissingFields tests that nil/missing fields don't cause errors
func TestTransformSessionGroupHandlesMissingFields(t *testing.T) {
	s := &SessionGroupsSync{}

	// Minimal data with only required fields
	groupData := map[string]interface{}{
		"ID":   float64(100),
		"Name": "Main Sessions",
	}

	year := 2025

	pbData, err := s.transformSessionGroupToPB(groupData, year)
	if err != nil {
		t.Fatalf("transformSessionGroupToPB returned error: %v", err)
	}

	// Required fields should be set
	if got, want := pbData["cm_id"].(int), 100; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Main Sessions"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// Optional fields should be present (even if nil)
	optionalFields := []string{"description", "is_active", "sort_order"}
	for _, field := range optionalFields {
		if _, exists := pbData[field]; !exists {
			t.Errorf("field %q missing from pbData (should be present even if nil)", field)
		}
	}
}

// TestTransformSessionGroupRequiredIDError tests that missing ID returns error
func TestTransformSessionGroupRequiredIDError(t *testing.T) {
	s := &SessionGroupsSync{}

	// Missing ID field
	groupData := map[string]interface{}{
		"Name": "Main Sessions",
	}

	_, err := s.transformSessionGroupToPB(groupData, 2025)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}
