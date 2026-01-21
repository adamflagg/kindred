package sync

import (
	"testing"
)

func TestSessionProgramsSync_Name(t *testing.T) {
	s := &SessionProgramsSync{}

	got := s.Name()
	want := "session_programs"

	if got != want {
		t.Errorf("SessionProgramsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformSessionProgramToPB tests that all CampMinder session program fields are extracted
func TestTransformSessionProgramToPB(t *testing.T) {
	s := &SessionProgramsSync{}

	// Mock CampMinder API response
	programData := map[string]interface{}{
		"ID":           float64(200),
		"Name":         "Junior Camp",
		"Description":  "Program for younger campers",
		"SessionID":    float64(12345),
		"StartAge":     float64(8),
		"EndAge":       float64(11),
		"StartGradeID": float64(3),
		"EndGradeID":   float64(6),
		"IsActive":     true,
	}

	year := 2025

	pbData, err := s.transformSessionProgramToPB(programData, year)
	if err != nil {
		t.Fatalf("transformSessionProgramToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 200; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Junior Camp"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
	if got, want := pbData["description"], "Program for younger campers"; got != want {
		t.Errorf("description = %v, want %v", got, want)
	}
	if got, want := pbData["session_cm_id"], float64(12345); got != want {
		t.Errorf("session_cm_id = %v, want %v", got, want)
	}
	if got, want := pbData["start_age"], float64(8); got != want {
		t.Errorf("start_age = %v, want %v", got, want)
	}
	if got, want := pbData["end_age"], float64(11); got != want {
		t.Errorf("end_age = %v, want %v", got, want)
	}
	if got, want := pbData["start_grade_id"], float64(3); got != want {
		t.Errorf("start_grade_id = %v, want %v", got, want)
	}
	if got, want := pbData["end_grade_id"], float64(6); got != want {
		t.Errorf("end_grade_id = %v, want %v", got, want)
	}
	if got, want := pbData["is_active"], true; got != want {
		t.Errorf("is_active = %v, want %v", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
}

// TestTransformSessionProgramHandlesMissingFields tests that nil/missing fields don't cause errors
func TestTransformSessionProgramHandlesMissingFields(t *testing.T) {
	s := &SessionProgramsSync{}

	// Minimal data with only required fields
	programData := map[string]interface{}{
		"ID":   float64(200),
		"Name": "Junior Camp",
	}

	year := 2025

	pbData, err := s.transformSessionProgramToPB(programData, year)
	if err != nil {
		t.Fatalf("transformSessionProgramToPB returned error: %v", err)
	}

	// Required fields should be set
	if got, want := pbData["cm_id"].(int), 200; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Junior Camp"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// Optional fields should be present (even if nil)
	optionalFields := []string{
		"description", "session_cm_id", "start_age", "end_age",
		"start_grade_id", "end_grade_id", "is_active",
	}
	for _, field := range optionalFields {
		if _, exists := pbData[field]; !exists {
			t.Errorf("field %q missing from pbData (should be present even if nil)", field)
		}
	}
}

// TestTransformSessionProgramRequiredIDError tests that missing ID returns error
func TestTransformSessionProgramRequiredIDError(t *testing.T) {
	s := &SessionProgramsSync{}

	// Missing ID field
	programData := map[string]interface{}{
		"Name": "Junior Camp",
	}

	_, err := s.transformSessionProgramToPB(programData, 2025)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

// TestTransformSessionProgramHandlesNullSessionID tests that null SessionID is handled
func TestTransformSessionProgramHandlesNullSessionID(t *testing.T) {
	s := &SessionProgramsSync{}

	// SessionID is nil (program not tied to specific session)
	programData := map[string]interface{}{
		"ID":        float64(200),
		"Name":      "Standalone Program",
		"SessionID": nil,
	}

	year := 2025

	pbData, err := s.transformSessionProgramToPB(programData, year)
	if err != nil {
		t.Fatalf("transformSessionProgramToPB returned error: %v", err)
	}

	// session_cm_id should be nil
	if pbData["session_cm_id"] != nil {
		t.Errorf("session_cm_id should be nil for null input, got %v", pbData["session_cm_id"])
	}
}
