package sync

import (
	"testing"
)

func TestHouseholdsSync_Name(t *testing.T) {
	s := &HouseholdsSync{}

	got := s.Name()
	want := "households"

	if got != want {
		t.Errorf("HouseholdsSync.Name() = %q, want %q", got, want)
	}
}

// TestTransformHouseholdToPB tests that all CampMinder household fields are extracted
func TestTransformHouseholdToPB(t *testing.T) {
	s := &HouseholdsSync{}

	// Mock CampMinder API response (based on HouseholdDetails schema in persons.yaml)
	householdData := map[string]interface{}{
		"ID":                     float64(123456),
		"ClientID":               float64(754),
		"Greeting":               "Hunter and Ashley",
		"MailingTitle":           "Mr. and Mrs Hunter Doe",
		"AlternateMailingTitle":  "The Doe Family",
		"BillingMailingTitle":    "Mr. and Mrs Hunter Doe",
		"HouseholdPhone":         "212-523-5555",
		"LastUpdatedUTC":         "2025-01-15T10:30:00.000Z",
		"BillingAddress": map[string]interface{}{
			"Address1":      "123 Main St",
			"Address2":      "Apt 4B",
			"City":          "Boulder",
			"StateProvince": "CO",
			"PostalCode":    "80303",
			"Country":       "US",
		},
	}

	year := 2025

	pbData, err := s.transformHouseholdToPB(householdData, year)
	if err != nil {
		t.Fatalf("transformHouseholdToPB returned error: %v", err)
	}

	// Verify fields
	if got, want := pbData["cm_id"].(int), 123456; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}
	if got, want := pbData["greeting"].(string), "Hunter and Ashley"; got != want {
		t.Errorf("greeting = %q, want %q", got, want)
	}
	if got, want := pbData["mailing_title"].(string), "Mr. and Mrs Hunter Doe"; got != want {
		t.Errorf("mailing_title = %q, want %q", got, want)
	}
	if got, want := pbData["alternate_mailing_title"].(string), "The Doe Family"; got != want {
		t.Errorf("alternate_mailing_title = %q, want %q", got, want)
	}
	if got, want := pbData["billing_mailing_title"].(string), "Mr. and Mrs Hunter Doe"; got != want {
		t.Errorf("billing_mailing_title = %q, want %q", got, want)
	}
	if got, want := pbData["household_phone"].(string), "212-523-5555"; got != want {
		t.Errorf("household_phone = %q, want %q", got, want)
	}
	if got, want := pbData["last_updated_utc"], "2025-01-15T10:30:00.000Z"; got != want {
		t.Errorf("last_updated_utc = %v, want %v", got, want)
	}
	if got, want := pbData["year"].(int), 2025; got != want {
		t.Errorf("year = %d, want %d", got, want)
	}

	// Verify billing_address is present and is the raw map (stored as JSON)
	if _, exists := pbData["billing_address"]; !exists {
		t.Error("billing_address missing from pbData")
	}
}

// TestTransformHouseholdHandlesMissingFields tests that nil/missing fields don't cause errors
func TestTransformHouseholdHandlesMissingFields(t *testing.T) {
	s := &HouseholdsSync{}

	// Minimal data with only required fields
	householdData := map[string]interface{}{
		"ID": float64(123456),
	}

	year := 2025

	pbData, err := s.transformHouseholdToPB(householdData, year)
	if err != nil {
		t.Fatalf("transformHouseholdToPB returned error: %v", err)
	}

	// Required fields should be set
	if got, want := pbData["cm_id"].(int), 123456; got != want {
		t.Errorf("cm_id = %d, want %d", got, want)
	}

	// Optional fields should be present (even if nil/zero value)
	optionalFields := []string{"greeting", "mailing_title", "alternate_mailing_title", "billing_mailing_title", "household_phone", "billing_address", "last_updated_utc"}
	for _, field := range optionalFields {
		if _, exists := pbData[field]; !exists {
			t.Errorf("field %q missing from pbData (should be present even if nil)", field)
		}
	}
}

// TestTransformHouseholdRequiredIDError tests that missing ID returns error
func TestTransformHouseholdRequiredIDError(t *testing.T) {
	s := &HouseholdsSync{}

	// Missing ID field
	householdData := map[string]interface{}{
		"Greeting": "Hunter and Ashley",
	}

	_, err := s.transformHouseholdToPB(householdData, 2025)
	if err == nil {
		t.Error("expected error for missing ID, got nil")
	}
}

// TestTransformHouseholdZeroIDError tests that ID=0 returns error
func TestTransformHouseholdZeroIDError(t *testing.T) {
	s := &HouseholdsSync{}

	// ID=0 (invalid)
	householdData := map[string]interface{}{
		"ID": float64(0),
	}

	_, err := s.transformHouseholdToPB(householdData, 2025)
	if err == nil {
		t.Error("expected error for ID=0, got nil")
	}
}

// TestExtractHouseholdsFromPersons tests extraction of unique households from persons data
func TestExtractHouseholdsFromPersons(t *testing.T) {
	s := &HouseholdsSync{}

	// Mock persons data with households
	personsData := []map[string]interface{}{
		{
			"ID": float64(1001),
			"Households": map[string]interface{}{
				"PrincipalHousehold": map[string]interface{}{
					"ID":       float64(100),
					"Greeting": "The Johnson Family",
				},
				"PrimaryChildhoodHousehold": map[string]interface{}{
					"ID":       float64(100), // Same as principal
					"Greeting": "The Johnson Family",
				},
			},
		},
		{
			"ID": float64(1002),
			"Households": map[string]interface{}{
				"PrincipalHousehold": map[string]interface{}{
					"ID":       float64(200),
					"Greeting": "The Garcia Family",
				},
			},
		},
		{
			"ID": float64(1003),
			"Households": map[string]interface{}{
				"PrincipalHousehold": map[string]interface{}{
					"ID":       float64(100), // Duplicate - same as person 1001
					"Greeting": "The Johnson Family",
				},
			},
		},
	}

	households := s.extractUniqueHouseholds(personsData)

	// Should have 2 unique households (IDs 100 and 200)
	if len(households) != 2 {
		t.Errorf("expected 2 unique households, got %d", len(households))
	}

	// Verify both household IDs are present
	ids := make(map[int]bool)
	for _, h := range households {
		if id, ok := h["ID"].(float64); ok {
			ids[int(id)] = true
		}
	}
	if !ids[100] {
		t.Error("household ID 100 not found in extracted households")
	}
	if !ids[200] {
		t.Error("household ID 200 not found in extracted households")
	}
}
