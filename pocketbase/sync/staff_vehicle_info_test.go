package sync

import (
	"context"
	"testing"
)

// TestStaffVehicleInfoLoadFieldDefinitionsTrimsNames is a regression test for
// kindred#1873. isStaffVehicleInfoField admits by "SVI-"/"SVI " prefix, which
// a trailing space would not defeat, but MapSVIFieldToColumnImpl exact-matches
// the trimmed literal downstream -- so an untrimmed name would be admitted
// into the map and then silently fail to route. No untrimmed name exists in
// this table today; this pins the fix against a future one.
func TestStaffVehicleInfoLoadFieldDefinitionsTrimsNames(t *testing.T) {
	app := newFieldDefsTestApp(t, map[int]string{
		1: "SVI-are you driving to camp ", // trailing space
		2: "SVI-which friend",             // already clean, must be unaffected
	})

	s := NewStaffVehicleInfoSync(app)
	got, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	want := map[string]bool{
		"SVI-are you driving to camp": true,
		"SVI-which friend":            true,
	}
	for _, name := range got {
		if !want[name] {
			t.Errorf("loadFieldDefinitions returned %q; expected a trimmed name", name)
		}
		delete(want, name)
	}
	for missing := range want {
		t.Errorf("loadFieldDefinitions did not return %q", missing)
	}

	if col := MapSVIFieldToColumnImpl("SVI-are you driving to camp"); col != colDrivingToCamp {
		t.Errorf("MapSVIFieldToColumnImpl(%q) = %q, want %q", "SVI-are you driving to camp", col, colDrivingToCamp)
	}
}

// TestStaffVehicleInfoServiceName verifies the service name constant
func TestStaffVehicleInfoServiceName(t *testing.T) {
	expected := "staff_vehicle_info"
	if serviceNameStaffVehicleInfo != expected {
		t.Errorf("serviceNameStaffVehicleInfo = %q, want %q", serviceNameStaffVehicleInfo, expected)
	}
}

// TestMapSVIFieldToColumn tests the CampMinder field name to column mapping
// for the 8 SVI- fields used in staff vehicle info
func TestMapSVIFieldToColumn(t *testing.T) {
	tests := []struct {
		cmField  string
		expected string
	}{
		// Driving to camp
		{"SVI-are you driving to camp", "driving_to_camp"},
		{"SVI-how are you get to camp", "how_getting_to_camp"},

		// Bringing others
		{"SVI - bring others", "can_bring_others"},
		{"SVI- Who is driving you to camp", "driver_name"},
		{"SVI-which friend", "which_friend"},

		// Vehicle info
		{"SVI-make of vehicle", "vehicle_make"},
		{"SVI-model vehicle", "vehicle_model"},
		{"SVI-license plate number", "license_plate"},

		// Unknown field should return empty
		{"Unknown-Field", ""},
		{"SVI-Unknown", ""},
	}

	for _, tt := range tests {
		t.Run(tt.cmField, func(t *testing.T) {
			got := MapSVIFieldToColumnImpl(tt.cmField)
			if got != tt.expected {
				t.Errorf("MapSVIFieldToColumnImpl(%q) = %q, want %q", tt.cmField, got, tt.expected)
			}
		})
	}
}

// TestParseSVIBoolImpl is the first real test of this parser. The function it
// replaces tested a shadow copy declared in this file, so production went
// unexercised.
//
// After the can_bring_others change, parseSVIBoolImpl has exactly ONE caller:
// driving_to_camp, fed by "SVI-are you driving to camp". That field holds 1,780
// answers with exactly two distinct values -- "Yes" and "No" -- so the tolerant
// arms below ("1", "y", "true") match nothing in the live data. They are pinned
// deliberately: this parser reads a CampMinder field, and a form that starts
// emitting 1/0 must not silently read as all-false. Narrowing this set is a
// behaviour change, not a cleanup.
func TestParseSVIBoolImpl(t *testing.T) {
	cases := map[string]bool{
		// The only two values the live field actually contains.
		"Yes": true,
		"No":  false,
		// Case and whitespace tolerance.
		"yes":   true,
		"YES":   true,
		"  yes": true,
		"no":    false,
		// Tolerant arms, pinned so they cannot be dropped silently.
		"1":    true,
		"y":    true,
		"true": true,
		// Everything else is false, including the unanswered case.
		"":      false,
		"Maybe": false,
		"0":     false,
	}

	for in, want := range cases {
		t.Run(in, func(t *testing.T) {
			if got := parseSVIBoolImpl(in); got != want {
				t.Errorf("parseSVIBoolImpl(%q) = %v, want %v", in, got, want)
			}
		})
	}
}

// TestStaffVehicleInfoCompositeKey tests the unique key generation
// Key format: personID|year
func TestStaffVehicleInfoCompositeKey(t *testing.T) {
	tests := []struct {
		personID int
		year     int
		expected string
	}{
		{12345, 2025, "12345|2025"},
		{67890, 2026, "67890|2026"},
		{100001, 2024, "100001|2024"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			got := makeStaffVehicleKey(tt.personID, tt.year)
			if got != tt.expected {
				t.Errorf("makeStaffVehicleKey(%d, %d) = %q, want %q",
					tt.personID, tt.year, got, tt.expected)
			}
		})
	}
}
