package sync

import (
	"testing"
)

func TestDivisionAttendeesSync_Name(t *testing.T) {
	s := &DivisionAttendeesSync{}

	got := s.Name()
	want := "division_attendees"

	if got != want {
		t.Errorf("DivisionAttendeesSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformDivisionAttendeeToPB tests basic transformation with only required fields
// The transform now only extracts ID and PersonID - DivisionID is resolved from persons table
func TestTransformDivisionAttendeeToPB(t *testing.T) {
	s := &DivisionAttendeesSync{}

	// Mock CampMinder API response - only ID and PersonID are required now
	// DivisionID from API is unreliable and will be ignored
	attendeeData := map[string]any{
		"ID":         float64(99999),
		"PersonID":   float64(12345),
		"DivisionID": float64(100), // Present but ignored
		"SeasonID":   float64(2025),
	}

	pbData, err := s.transformDivisionAttendeeToPB(attendeeData, 2025)
	if err != nil {
		t.Fatalf("transformDivisionAttendeeToPB returned error: %v", err)
	}

	// Verify required fields
	if got, want := pbData["cm_id"].(int), 99999; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["person_id"].(int), 12345; got != want {
		t.Errorf("person_id = %d, want %d", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}

	// DivisionID should NOT be extracted - it will be resolved from persons table
	if _, exists := pbData["division_id"]; exists {
		t.Error("division_id should not be set by transform - it's derived from persons table")
	}
}

// TestTransformDivisionAttendeeToPB_MissingDivisionID tests that missing DivisionID is OK
// Since we derive division from persons table, missing API DivisionID is not an error
func TestTransformDivisionAttendeeToPB_MissingDivisionID(t *testing.T) {
	s := &DivisionAttendeesSync{}

	attendeeData := map[string]any{
		"ID":       float64(99999),
		"PersonID": float64(12345),
		// DivisionID intentionally missing - this is OK now
	}

	pbData, err := s.transformDivisionAttendeeToPB(attendeeData, 2025)
	if err != nil {
		t.Fatalf("expected no error for missing DivisionID, got: %v", err)
	}

	// Should still extract ID and PersonID
	if got, want := pbData["cm_id"].(int), 99999; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["person_id"].(int), 12345; got != want {
		t.Errorf("person_id = %d, want %d", got, want)
	}
}

// TestTransformDivisionAttendeeToPB_ZeroDivisionID tests that zero DivisionID is OK
// Since we derive division from persons table, zero API DivisionID is not an error
func TestTransformDivisionAttendeeToPB_ZeroDivisionID(t *testing.T) {
	s := &DivisionAttendeesSync{}

	attendeeData := map[string]any{
		"ID":         float64(99999),
		"PersonID":   float64(12345),
		"DivisionID": float64(0), // Zero value - this is OK now
	}

	pbData, err := s.transformDivisionAttendeeToPB(attendeeData, 2025)
	if err != nil {
		t.Fatalf("expected no error for zero DivisionID, got: %v", err)
	}

	// Should still extract ID and PersonID
	if got, want := pbData["cm_id"].(int), 99999; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["person_id"].(int), 12345; got != want {
		t.Errorf("person_id = %d, want %d", got, want)
	}
}

// TestTransformDivisionAttendeeToPB_MissingID tests that missing ID returns error
func TestTransformDivisionAttendeeToPB_MissingID(t *testing.T) {
	s := &DivisionAttendeesSync{}

	attendeeData := map[string]any{
		"PersonID": float64(12345),
	}

	_, err := s.transformDivisionAttendeeToPB(attendeeData, 2025)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

// TestTransformDivisionAttendeeToPB_MissingPersonID tests that missing PersonID returns error
func TestTransformDivisionAttendeeToPB_MissingPersonID(t *testing.T) {
	s := &DivisionAttendeesSync{}

	attendeeData := map[string]any{
		"ID": float64(99999),
	}

	_, err := s.transformDivisionAttendeeToPB(attendeeData, 2025)
	if err == nil {
		t.Error("expected error for missing PersonID, got nil")
	}
}

// TestTransformDivisionAttendeeToPB_ZeroID tests that zero ID returns error
func TestTransformDivisionAttendeeToPB_ZeroID(t *testing.T) {
	s := &DivisionAttendeesSync{}

	attendeeData := map[string]any{
		"ID":       float64(0),
		"PersonID": float64(12345),
	}

	_, err := s.transformDivisionAttendeeToPB(attendeeData, 2025)
	if err == nil {
		t.Error("expected error for zero ID, got nil")
	}
}

// TestTransformDivisionAttendeeToPB_ZeroPersonID tests that zero PersonID returns error
func TestTransformDivisionAttendeeToPB_ZeroPersonID(t *testing.T) {
	s := &DivisionAttendeesSync{}

	attendeeData := map[string]any{
		"ID":       float64(99999),
		"PersonID": float64(0),
	}

	_, err := s.transformDivisionAttendeeToPB(attendeeData, 2025)
	if err == nil {
		t.Error("expected error for zero PersonID, got nil")
	}
}
