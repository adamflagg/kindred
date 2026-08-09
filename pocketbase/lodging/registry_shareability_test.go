package lodging

import "testing"

// The seed-time half of kindred#2026.
//
// classifyShareability answers "may more than one party sleep here at once"
// for a row the loader is about to CREATE. The other half -- rows that already
// exist -- is pb_migrations/1500000145, because neither named seed path can
// reach them (seedUnits skips any existing code+year, and
// apply_lodging_inventory.py withholds every non-notes change from a confirmed
// row, which in production is all of them). The two implementations state the
// same rule and this file is what stops them drifting apart in the direction
// that matters: a Go loader that classified a small room `shareable` on a
// fresh database would seed permission to double-book a bedroom.

func intPtr(v int) *int { return &v }

func TestClassifyShareability(t *testing.T) {
	cases := []struct {
		name           string
		inventoryClass string
		isContainer    bool
		sleeps         *int
		want           string
	}{
		// The rule proper: 12 is the floor, on LEAF rows.
		{"large leaf cabin is shareable", "family_pool", false, intPtr(15), shareabilityShareable},
		{"exactly at the floor is shareable", "family_pool", false, intPtr(12), shareabilityShareable},
		{"one below the floor is one family", "family_pool", false, intPtr(11), shareabilitySingleParty},
		{"a bedroom is one family", "family_pool", false, intPtr(4), shareabilitySingleParty},

		// A container's own `sleeps` is a DELTA over its rooms (kindred#2041),
		// so the >= 12 test does not apply to it and is not applied. Under the
		// owner's settled ruling two households on one container is a
		// legitimate share, not a violation -- the parties occupy different
		// rooms beneath it and CampMinder has no sub-room concept for every
		// building, so staff assign at container level and will keep doing so.
		{"a family container is shareable whatever its delta", "family_pool", true, intPtr(0), shareabilityShareable},
		{"a family container with a small delta is still shareable", "family_pool", true, intPtr(1), shareabilityShareable},
		{"a family container with no measured delta is shareable", "family_pool", true, nil, shareabilityShareable},

		// Staff housing is not family-camp inventory, so multi-party family
		// occupancy is not a question it answers. This is also the mechanism
		// that lands the owner's call on the one residue row -- a staff
		// building sleeping 19 that would otherwise clear the leaf floor.
		{"a large staff building is one party", "staff_default", false, intPtr(19), shareabilitySingleParty},
		{"a staff container is one party", "staff_default", true, nil, shareabilitySingleParty},

		// UNKNOWN, and it stays unknown. A leaf nobody has measured cannot be
		// classified either way, and guessing here is the failure the select
		// exists to prevent: `single_party` would block legitimate work and
		// `shareable` would permit a double-booking.
		{"an unmeasured leaf is left unclassified", "family_pool", false, nil, ""},
		// PocketBase stores an unset number as 0, and registry.go's own
		// comment says consumers read 0 as UNKNOWN, never "zero capacity".
		{"a leaf sleeping zero is unclassified, not tiny", "family_pool", false, intPtr(0), ""},

		// An unclassified ROLE cannot decide a role-dependent question.
		{"a leaf with no inventory class is unclassified", "", false, intPtr(15), ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyShareability(tc.inventoryClass, tc.isContainer, tc.sleeps)
			if got != tc.want {
				t.Errorf("classifyShareability(%q, %v, %v) = %q, want %q",
					tc.inventoryClass, tc.isContainer, tc.sleeps, got, tc.want)
			}
		})
	}
}
