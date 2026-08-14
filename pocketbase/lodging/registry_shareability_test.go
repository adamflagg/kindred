package lodging

import "testing"

// The seed-time half of kindred#2026, RE-RULED by kindred#2331 (owner ruling
// D17, 2026-08-14): a LEAF's shareability is a CURATED registry fact, never a
// `sleeps` derivation. The `sleeps >= 12` floor reproduced nothing — no leaf
// in the inventory ever reaches 12, so every family-pool leaf classified
// `single_party` regardless of the owner's actual multi-family enumeration.
//
// classifyShareability answers "may more than one party sleep here at once"
// for a row the loader is about to CREATE. A CONTAINER still classifies by
// having rooms (`isContainer`), unchanged by this ruling — only the LEAF leg
// moved, from a `sleeps` threshold to the `curated` value the registry file
// now carries per unit. pb_migrations/1500000145's historical backfill is
// FROZEN (already applied to production) and is not re-derived here; it
// remains the accurate record of what production's existing rows were
// classified from at the time it ran.
func strPtr(v string) *string { return &v }

func TestClassifyShareability(t *testing.T) {
	cases := []struct {
		name           string
		inventoryClass string
		isContainer    bool
		curated        *string
		want           string
	}{
		// The rule proper, on LEAF rows: read the curated value straight
		// through. No threshold, no capacity math.
		{"registry says shareable", "family_pool", false, strPtr(shareabilityShareable), shareabilityShareable},
		{"registry says single_party", "family_pool", false, strPtr(shareabilitySingleParty), shareabilitySingleParty},

		// THE SAFETY REQUIREMENT: a leaf the registry says nothing about must
		// NOT silently become shareable. It stays unclassified, same as the
		// old "unmeasured" state did.
		{"registry says nothing (nil) leaves it unclassified", "family_pool", false, nil, ""},
		{"registry says nothing (empty string) leaves it unclassified", "family_pool", false, strPtr(""), ""},

		// A container's own curated value, if the file ever set one, is not
		// consulted -- it classifies by having rooms alone, unchanged from
		// before this ruling. Under the owner's settled ruling two households
		// on one container is a legitimate share: they occupy different rooms
		// beneath it, CampMinder has no sub-room concept for every building,
		// so staff assign at container level and will keep doing so.
		{"a family container is shareable regardless of any curated value",
			"family_pool", true, nil, shareabilityShareable},
		{"a family container ignores a curated single_party too",
			"family_pool", true, strPtr(shareabilitySingleParty), shareabilityShareable},

		// Staff housing is not family-camp inventory, so multi-party family
		// occupancy is not a question it answers -- also unmoved by this
		// ruling, and also blind to any curated value.
		{"staff housing is one party regardless of curated value",
			"staff_default", false, strPtr(shareabilityShareable), shareabilitySingleParty},
		{"a staff container is one party", "staff_default", true, nil, shareabilitySingleParty},

		// An unclassified ROLE cannot decide a role-dependent question.
		{"a leaf with no inventory class is unclassified", "", false, strPtr(shareabilityShareable), ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyShareability(tc.inventoryClass, tc.isContainer, tc.curated)
			if got != tc.want {
				t.Errorf("classifyShareability(%q, %v, %v) = %q, want %q",
					tc.inventoryClass, tc.isContainer, tc.curated, got, tc.want)
			}
		})
	}
}
