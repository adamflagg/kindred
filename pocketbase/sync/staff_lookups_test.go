package sync

import (
	"testing"
)

func TestStaffLookupsSync_Name(t *testing.T) {
	s := &StaffLookupsSync{}

	got := s.Name()
	want := "staff_lookups"

	if got != want {
		t.Errorf("StaffLookupsSync.Name() = %q, want %q", got, want)
	}
}

// =============================================================================
// Program Area Transform Tests
// =============================================================================

func TestTransformProgramAreaToPB(t *testing.T) {
	s := &StaffLookupsSync{}

	// Mock CampMinder API response
	programAreaData := map[string]interface{}{
		"ID":   float64(100),
		"Name": "Aquatics",
	}

	pbData, err := s.transformProgramAreaToPB(programAreaData)
	if err != nil {
		t.Fatalf("transformProgramAreaToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 100; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Aquatics"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// Verify no extra fields
	if len(pbData) != 2 {
		t.Errorf("expected 2 fields, got %d: %v", len(pbData), pbData)
	}
}

func TestTransformProgramAreaToPB_MissingID(t *testing.T) {
	s := &StaffLookupsSync{}

	data := map[string]interface{}{
		"Name": "Aquatics",
	}

	_, err := s.transformProgramAreaToPB(data)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

func TestTransformProgramAreaToPB_ZeroID(t *testing.T) {
	s := &StaffLookupsSync{}

	data := map[string]interface{}{
		"ID":   float64(0),
		"Name": "Aquatics",
	}

	_, err := s.transformProgramAreaToPB(data)
	if err == nil {
		t.Error("expected error for zero ID, got nil")
	}
}

func TestTransformProgramAreaToPB_MissingName(t *testing.T) {
	s := &StaffLookupsSync{}

	data := map[string]interface{}{
		"ID": float64(100),
	}

	_, err := s.transformProgramAreaToPB(data)
	if err == nil {
		t.Error("expected error for missing Name, got nil")
	}
}

func TestTransformProgramAreaToPB_EmptyName(t *testing.T) {
	s := &StaffLookupsSync{}

	data := map[string]interface{}{
		"ID":   float64(100),
		"Name": "",
	}

	_, err := s.transformProgramAreaToPB(data)
	if err == nil {
		t.Error("expected error for empty Name, got nil")
	}
}

// =============================================================================
// Org Category Transform Tests
// =============================================================================

func TestTransformOrgCategoryToPB(t *testing.T) {
	s := &StaffLookupsSync{}

	// Mock CampMinder API response
	orgCategoryData := map[string]interface{}{
		"ID":   float64(200),
		"Name": "Leadership",
	}

	pbData, err := s.transformOrgCategoryToPB(orgCategoryData)
	if err != nil {
		t.Fatalf("transformOrgCategoryToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 200; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Leadership"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// Verify no extra fields
	if len(pbData) != 2 {
		t.Errorf("expected 2 fields, got %d: %v", len(pbData), pbData)
	}
}

func TestTransformOrgCategoryToPB_MissingID(t *testing.T) {
	s := &StaffLookupsSync{}

	data := map[string]interface{}{
		"Name": "Leadership",
	}

	_, err := s.transformOrgCategoryToPB(data)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

func TestTransformOrgCategoryToPB_ZeroID(t *testing.T) {
	s := &StaffLookupsSync{}

	data := map[string]interface{}{
		"ID":   float64(0),
		"Name": "Leadership",
	}

	_, err := s.transformOrgCategoryToPB(data)
	if err == nil {
		t.Error("expected error for zero ID, got nil")
	}
}

func TestTransformOrgCategoryToPB_MissingName(t *testing.T) {
	s := &StaffLookupsSync{}

	data := map[string]interface{}{
		"ID": float64(200),
	}

	_, err := s.transformOrgCategoryToPB(data)
	if err == nil {
		t.Error("expected error for missing Name, got nil")
	}
}

func TestTransformOrgCategoryToPB_EmptyName(t *testing.T) {
	s := &StaffLookupsSync{}

	data := map[string]interface{}{
		"ID":   float64(200),
		"Name": "",
	}

	_, err := s.transformOrgCategoryToPB(data)
	if err == nil {
		t.Error("expected error for empty Name, got nil")
	}
}

// =============================================================================
// Position Transform Tests
// =============================================================================

func TestTransformPositionToPB(t *testing.T) {
	s := &StaffLookupsSync{}

	// Program area lookup map
	programAreaMap := map[int]string{
		100: "pb_area_id_100",
	}

	// Mock CampMinder API response
	positionData := map[string]interface{}{
		"ID":            float64(300),
		"Name":          "Lifeguard",
		"ProgramAreaID": float64(100),
	}

	pbData, err := s.transformPositionToPB(positionData, programAreaMap)
	if err != nil {
		t.Fatalf("transformPositionToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 300; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Lifeguard"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}
	if got, want := pbData["program_area"].(string), "pb_area_id_100"; got != want {
		t.Errorf("program_area = %q, want %q", got, want)
	}
}

func TestTransformPositionToPB_NoProgramArea(t *testing.T) {
	s := &StaffLookupsSync{}

	programAreaMap := map[int]string{}

	// Position without program area
	positionData := map[string]interface{}{
		"ID":   float64(300),
		"Name": "Lifeguard",
	}

	pbData, err := s.transformPositionToPB(positionData, programAreaMap)
	if err != nil {
		t.Fatalf("transformPositionToPB returned error: %v", err)
	}

	// Verify required fields
	if got, want := pbData["cm_id"].(int), 300; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["name"].(string), "Lifeguard"; got != want {
		t.Errorf("name = %q, want %q", got, want)
	}

	// program_area should not be set
	if _, exists := pbData["program_area"]; exists {
		t.Errorf("program_area should not be set when not provided")
	}
}

func TestTransformPositionToPB_UnknownProgramArea(t *testing.T) {
	s := &StaffLookupsSync{}

	// Program area map doesn't include the referenced ID
	programAreaMap := map[int]string{
		100: "pb_area_id_100",
	}

	// Position references a program area not in the map
	positionData := map[string]interface{}{
		"ID":            float64(300),
		"Name":          "Lifeguard",
		"ProgramAreaID": float64(999), // Not in map
	}

	pbData, err := s.transformPositionToPB(positionData, programAreaMap)
	if err != nil {
		t.Fatalf("transformPositionToPB returned error: %v", err)
	}

	// Should succeed but without program_area relation
	if got, want := pbData["cm_id"].(int), 300; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if _, exists := pbData["program_area"]; exists {
		t.Errorf("program_area should not be set when not found in map")
	}
}

func TestTransformPositionToPB_MissingID(t *testing.T) {
	s := &StaffLookupsSync{}

	programAreaMap := map[int]string{}

	data := map[string]interface{}{
		"Name": "Lifeguard",
	}

	_, err := s.transformPositionToPB(data, programAreaMap)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

func TestTransformPositionToPB_ZeroID(t *testing.T) {
	s := &StaffLookupsSync{}

	programAreaMap := map[int]string{}

	data := map[string]interface{}{
		"ID":   float64(0),
		"Name": "Lifeguard",
	}

	_, err := s.transformPositionToPB(data, programAreaMap)
	if err == nil {
		t.Error("expected error for zero ID, got nil")
	}
}

func TestTransformPositionToPB_MissingName(t *testing.T) {
	s := &StaffLookupsSync{}

	programAreaMap := map[int]string{}

	data := map[string]interface{}{
		"ID": float64(300),
	}

	_, err := s.transformPositionToPB(data, programAreaMap)
	if err == nil {
		t.Error("expected error for missing Name, got nil")
	}
}

func TestTransformPositionToPB_EmptyName(t *testing.T) {
	s := &StaffLookupsSync{}

	programAreaMap := map[int]string{}

	data := map[string]interface{}{
		"ID":   float64(300),
		"Name": "",
	}

	_, err := s.transformPositionToPB(data, programAreaMap)
	if err == nil {
		t.Error("expected error for empty Name, got nil")
	}
}
