package sync

import "testing"

// TestPersonLocation pins the "one helper owns the rule" contract shared with
// the Python and TypeScript helpers (kindred#2755): normalized_city, when
// non-blank, IS the whole "City, ST" label; otherwise compose address_city +
// address_state, never both.
func TestPersonLocation(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, normalizedCity, addressCity, addressState, want string
	}{
		{"normalized city wins outright", "Berkeley, CA", "berkeley", "CA", "Berkeley, CA"},
		{
			"normalized city wins even when it doesn't carry a state",
			"Washington", "somewhere else", "OR", "Washington",
		},
		{"composes city and state when normalized is blank", "", "Oakland", "CA", "Oakland, CA"},
		{"composes when normalized is whitespace", "   ", "Oakland", "CA", "Oakland, CA"},
		{"never doubles the state", "San Carlos, CA", "San Carlos", "CA", "San Carlos, CA"},
		{"city only when state is blank", "", "Oakland", "", "Oakland"},
		{"state only when city is blank", "", "", "CA", "CA"},
		{"both blank", "", "", "", ""},
		{"trims whitespace on the composed sides", "", "  Oakland  ", "  CA  ", "Oakland, CA"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := PersonLocation(tc.normalizedCity, tc.addressCity, tc.addressState)
			if got != tc.want {
				t.Errorf("PersonLocation(%q, %q, %q) = %q, want %q",
					tc.normalizedCity, tc.addressCity, tc.addressState, got, tc.want)
			}
		})
	}
}

// TestPersonLocationCityOnly pins the city-without-state variant: the same
// rule TestRosterCleanCity already pins for rosterCleanCity, which now
// delegates here so a second caller (the adult per-cabin export, kindred#2770)
// doesn't reinvent the regex.
func TestPersonLocationCityOnly(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, normalizedCity, addressCity, want string
	}{
		{"prefers the normalized value", "Berkeley, CA", "berkeley", "Berkeley"},
		{"falls back to the raw value", "", "Oakland", "Oakland"},
		{"falls back when normalized is whitespace", "   ", "Oakland", "Oakland"},
		{"strips the state suffix", "San Francisco, CA", "", "San Francisco"},
		{"strips a suffix with no space", "Portland,OR", "", "Portland"},
		{"keeps a comma that is not a state", "Washington, District", "", "Washington, District"},
		{"keeps a lowercase two-letter tail", "Something, ca", "", "Something, ca"},
		{"both blank", "", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := PersonLocationCityOnly(tc.normalizedCity, tc.addressCity)
			if got != tc.want {
				t.Errorf("PersonLocationCityOnly(%q, %q) = %q, want %q",
					tc.normalizedCity, tc.addressCity, got, tc.want)
			}
		})
	}
}
