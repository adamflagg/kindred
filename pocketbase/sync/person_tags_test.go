package sync

import (
	"testing"
)

func TestPersonTagsSync_Name(t *testing.T) {
	s := &PersonTagsSync{}

	got := s.Name()
	want := "person_tags"

	if got != want {
		t.Errorf("PersonTagsSync.Name() = %q, want %q", got, want)
	}
}

// TestExtractTagsFromPerson tests tag extraction from person data
func TestExtractTagsFromPerson(t *testing.T) {
	s := &PersonTagsSync{}

	// Mock person data with Tags array
	personData := map[string]interface{}{
		"ID": float64(12345),
		"Tags": []interface{}{
			map[string]interface{}{
				"Name":           "Alumni",
				"IsSeasonal":     false,
				"IsHidden":       false,
				"LastUpdatedUTC": "2025-01-15T10:30:00.000Z",
			},
			map[string]interface{}{
				"Name":           "Leadership",
				"IsSeasonal":     true,
				"IsHidden":       false,
				"LastUpdatedUTC": "2025-01-16T11:00:00.000Z",
			},
		},
	}

	tags := s.extractTagsFromPerson(personData)

	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(tags))
	}

	// Verify first tag
	if tags[0]["Name"] != "Alumni" {
		t.Errorf("first tag Name = %v, want Alumni", tags[0]["Name"])
	}

	// Verify second tag
	if tags[1]["Name"] != "Leadership" {
		t.Errorf("second tag Name = %v, want Leadership", tags[1]["Name"])
	}
}

// TestExtractTagsFromPersonNoTags tests handling when Tags is missing
func TestExtractTagsFromPersonNoTags(t *testing.T) {
	s := &PersonTagsSync{}

	// Person without Tags
	personData := map[string]interface{}{
		"ID": float64(12345),
	}

	tags := s.extractTagsFromPerson(personData)

	if len(tags) != 0 {
		t.Errorf("expected 0 tags for person without Tags, got %d", len(tags))
	}
}

// TestExtractTagsFromPersonEmptyTags tests handling when Tags is empty array
func TestExtractTagsFromPersonEmptyTags(t *testing.T) {
	s := &PersonTagsSync{}

	// Person with empty Tags array
	personData := map[string]interface{}{
		"ID":   float64(12345),
		"Tags": []interface{}{},
	}

	tags := s.extractTagsFromPerson(personData)

	if len(tags) != 0 {
		t.Errorf("expected 0 tags for person with empty Tags, got %d", len(tags))
	}
}

// TestExtractTagsFromPersonNilTags tests handling when Tags is nil
func TestExtractTagsFromPersonNilTags(t *testing.T) {
	s := &PersonTagsSync{}

	// Person with nil Tags
	personData := map[string]interface{}{
		"ID":   float64(12345),
		"Tags": nil,
	}

	tags := s.extractTagsFromPerson(personData)

	if len(tags) != 0 {
		t.Errorf("expected 0 tags for person with nil Tags, got %d", len(tags))
	}
}

// TestTransformPersonTagToPB tests transformation to PocketBase format
func TestTransformPersonTagToPB(t *testing.T) {
	s := &PersonTagsSync{}

	tagData := map[string]interface{}{
		"Name":           "Alumni",
		"IsSeasonal":     false,
		"IsHidden":       false,
		"LastUpdatedUTC": "2025-01-15T10:30:00.000Z",
	}
	personID := 12345
	year := 2025

	pbData, err := s.transformPersonTagToPB(tagData, personID, year)
	if err != nil {
		t.Fatalf("transformPersonTagToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["person_id"].(int), 12345; got != want {
		t.Errorf("person_id = %d, want %d", got, want)
	}
	if got, want := pbData["tag_name"].(string), "Alumni"; got != want {
		t.Errorf("tag_name = %q, want %q", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}
	if _, exists := pbData["last_updated_utc"]; !exists {
		t.Error("last_updated_utc missing from pbData")
	}
}

// TestTransformPersonTagToPBMissingName tests error on missing tag name
func TestTransformPersonTagToPBMissingName(t *testing.T) {
	s := &PersonTagsSync{}

	tagData := map[string]interface{}{
		"IsSeasonal": false,
		// Missing Name
	}

	_, err := s.transformPersonTagToPB(tagData, 12345, 2025)
	if err == nil {
		t.Error("expected error for missing tag Name, got nil")
	}
}

// TestTransformPersonTagToPBEmptyName tests error on empty tag name
func TestTransformPersonTagToPBEmptyName(t *testing.T) {
	s := &PersonTagsSync{}

	tagData := map[string]interface{}{
		"Name":       "",
		"IsSeasonal": false,
	}

	_, err := s.transformPersonTagToPB(tagData, 12345, 2025)
	if err == nil {
		t.Error("expected error for empty tag Name, got nil")
	}
}
