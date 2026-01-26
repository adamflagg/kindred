package sync

import (
	"testing"
)

func TestDivisionsSync_Name(t *testing.T) {
	s := &DivisionsSync{}

	got := s.Name()
	want := serviceNameDivisions

	if got != want {
		t.Errorf("DivisionsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformDivisionToPB tests that all CampMinder division fields are extracted
func TestTransformDivisionToPB(t *testing.T) {
	s := &DivisionsSync{}

	// Mock CampMinder API response based on divisions endpoint schema
	divisionData := map[string]interface{}{
		"ID":                           float64(12345),
		"Name":                         "Boys 3rd-4th Grade",
		"Description":                  "Division for boys in 3rd-4th grade",
		"StartGradeRangeID":            float64(3),
		"EndGradeRangeID":              float64(4),
		"GenderID":                     float64(1), // 1=Male
		"Capacity":                     float64(48),
		"SubOfDivisionID":              float64(100), // Parent division
		"AssignDuringCamperEnrollment": true,
		"StaffOnly":                    false,
	}

	pbData, err := s.transformDivisionToPB(divisionData)
	if err != nil {
		t.Fatalf("transformDivisionToPB returned error: %v", err)
	}

	// Verify required fields
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Boys 3rd-4th Grade"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// Verify optional fields
	if got, want := pbData["description"].(string), "Division for boys in 3rd-4th grade"; got != want {
		t.Errorf("description = %q, want %q", got, want)
	}
	if got, want := pbData["start_grade_id"].(int), 3; got != want {
		t.Errorf("start_grade_id = %d, want %d", got, want)
	}
	if got, want := pbData["end_grade_id"].(int), 4; got != want {
		t.Errorf("end_grade_id = %d, want %d", got, want)
	}
	if got, want := pbData["gender_id"].(int), 1; got != want {
		t.Errorf("gender_id = %d, want %d", got, want)
	}
	if got, want := pbData["capacity"].(int), 48; got != want {
		t.Errorf("capacity = %d, want %d", got, want)
	}
	if got, want := pbData["parent_division_cm_id"].(int), 100; got != want {
		t.Errorf("parent_division_cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["assign_on_enrollment"].(bool), true; got != want {
		t.Errorf("assign_on_enrollment = %v, want %v", got, want)
	}
	if got, want := pbData["staff_only"].(bool), false; got != want {
		t.Errorf("staff_only = %v, want %v", got, want)
	}

	// Verify no year field (divisions are global)
	if _, hasYear := pbData["year"]; hasYear {
		t.Error("year field should not be present - divisions are global")
	}
}

// TestTransformDivisionToPB_MinimalData tests with only required fields
func TestTransformDivisionToPB_MinimalData(t *testing.T) {
	s := &DivisionsSync{}

	// Minimal data with only required fields
	divisionData := map[string]interface{}{
		"ID":   float64(12345),
		"Name": "Test Division",
	}

	pbData, err := s.transformDivisionToPB(divisionData)
	if err != nil {
		t.Fatalf("transformDivisionToPB returned error: %v", err)
	}

	// Required fields should be set
	if got, want := pbData["cm_id"].(int), 12345; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Test Division"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// Optional fields should be nil or zero value
	if pbData["description"] != nil && pbData["description"] != "" {
		t.Errorf("description should be empty, got %v", pbData["description"])
	}
}

// TestTransformDivisionToPB_MissingID tests that missing ID returns error
func TestTransformDivisionToPB_MissingID(t *testing.T) {
	s := &DivisionsSync{}

	divisionData := map[string]interface{}{
		"Name": "Test Division",
	}

	_, err := s.transformDivisionToPB(divisionData)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

// TestTransformDivisionToPB_MissingName tests that missing Name returns error
func TestTransformDivisionToPB_MissingName(t *testing.T) {
	s := &DivisionsSync{}

	divisionData := map[string]interface{}{
		"ID": float64(12345),
	}

	_, err := s.transformDivisionToPB(divisionData)
	if err == nil {
		t.Error("expected error for missing Name, got nil")
	}
}

// TestTransformDivisionToPB_ZeroID tests that zero ID returns error
func TestTransformDivisionToPB_ZeroID(t *testing.T) {
	s := &DivisionsSync{}

	divisionData := map[string]interface{}{
		"ID":   float64(0),
		"Name": "Test Division",
	}

	_, err := s.transformDivisionToPB(divisionData)
	if err == nil {
		t.Error("expected error for zero ID, got nil")
	}
}

// TestTransformDivisionToPB_EmptyName tests that empty Name returns error
func TestTransformDivisionToPB_EmptyName(t *testing.T) {
	s := &DivisionsSync{}

	divisionData := map[string]interface{}{
		"ID":   float64(12345),
		"Name": "",
	}

	_, err := s.transformDivisionToPB(divisionData)
	if err == nil {
		t.Error("expected error for empty Name, got nil")
	}
}
