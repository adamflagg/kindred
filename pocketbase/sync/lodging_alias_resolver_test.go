package sync

import (
	"sort"
	"testing"
)

// TestAliasResolverUnboundedWindows: PocketBase stores an unset year bound as 0,
// not NULL. 94 of the 100 seeded alias rows are unbounded, so a resolver that
// reads 0 as a real lower bound resolves almost nothing.
func TestAliasResolverUnboundedWindows(t *testing.T) {
	app := newLodgingTestApp(t)
	ridgeA := addUnit(t, app, "ridge-a")
	addAlias(t, app, "Ridge A", []string{ridgeA}, 0, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	for _, year := range []int{2017, 2022, 2025, 2026, 2030} {
		got := r.Resolve("Ridge A", year)
		if !got.Resolved {
			t.Errorf("year %d: unbounded alias did not resolve", year)
		}
		if len(got.UnitIDs) != 1 || got.UnitIDs[0] != ridgeA {
			t.Errorf("year %d: UnitIDs = %v, want [%s]", year, got.UnitIDs, ridgeA)
		}
		if got.IsMerge() {
			t.Errorf("year %d: single-member alias reported as a merge", year)
		}
	}
}

// TestAliasResolverRespectsRenameWindows is the load-bearing case. Both
// Doctor's Houses existed 2022-2024; the Golden Triangle one was renamed Wawona
// in 2025. Resolving either side into the other silently relocates a household
// across camp, and nothing downstream would notice.
func TestAliasResolverRespectsRenameWindows(t *testing.T) {
	app := newLodgingTestApp(t)
	gtWawona := addUnit(t, app, "gt-wawona")
	gtFront := addUnit(t, app, "gt-wawona-front")
	gtBack := addUnit(t, app, "gt-wawona-back")
	hcDoctors := addUnit(t, app, "hc-doctors-house")

	addAlias(t, app, "Golden Triangle - Doctor's House", []string{gtWawona}, 0, 2024)
	addAlias(t, app, "Golden Triangle - Wawona", []string{gtFront, gtBack}, 2025, 0)
	addAlias(t, app, "Health Center - Doctor's House", []string{hcDoctors}, 0, 2024)
	addAlias(t, app, "Doctor's House", []string{hcDoctors}, 2025, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	// In window.
	if got := r.Resolve("Golden Triangle - Doctor's House", 2023); !got.Resolved ||
		got.UnitIDs[0] != gtWawona {
		t.Errorf("2023 GT Doctor's House: %+v", got)
	}
	// Out of window on the high side -- the string was retired, so it must NOT
	// silently fall through to the Health Center row of the same shape.
	if got := r.Resolve("Golden Triangle - Doctor's House", 2025); got.Resolved {
		t.Errorf("2025 GT Doctor's House resolved to %v; the window ends at 2024", got.UnitCodes)
	}
	// Out of window on the low side.
	if got := r.Resolve("Doctor's House", 2024); got.Resolved {
		t.Errorf("2024 bare Doctor's House resolved to %v; the window starts at 2025", got.UnitCodes)
	}
	if got := r.Resolve("Doctor's House", 2025); !got.Resolved || got.UnitIDs[0] != hcDoctors {
		t.Errorf("2025 bare Doctor's House: %+v", got)
	}
}

// TestAliasResolverMergeDenotingAlias: 2+ members means the string denotes a
// merge of that many rooms (spec 3.4). Six seeded aliases are of this shape.
func TestAliasResolverMergeDenotingAlias(t *testing.T) {
	app := newLodgingTestApp(t)
	tioga1 := addUnit(t, app, "gt-tioga-1")
	tioga2 := addUnit(t, app, "gt-tioga-2")
	addAlias(t, app, "Golden Triangle - Tioga 1and2", []string{tioga1, tioga2}, 0, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	got := r.Resolve("Golden Triangle - Tioga 1and2", 2025)
	if !got.Resolved || !got.IsMerge() {
		t.Fatalf("expected a resolved merge, got %+v", got)
	}
	ids := append([]string{}, got.UnitIDs...)
	sort.Strings(ids)
	want := []string{tioga1, tioga2}
	sort.Strings(want)
	if ids[0] != want[0] || ids[1] != want[1] {
		t.Errorf("UnitIDs = %v, want %v", ids, want)
	}
	codes := append([]string{}, got.UnitCodes...)
	sort.Strings(codes)
	if codes[0] != "gt-tioga-1" || codes[1] != "gt-tioga-2" {
		t.Errorf("UnitCodes = %v", codes)
	}
}

// TestAliasResolverUnresolvedIsNotAnError: four strings observed 2022-2023 have
// no alias row at all -- "Ridge 2", "River Side - R1", "River Side - R2",
// "Tuolumne 7". They must come back unresolved, with the raw string preserved,
// and must not panic or error.
func TestAliasResolverUnresolvedIsNotAnError(t *testing.T) {
	app := newLodgingTestApp(t)
	addUnit(t, app, "ridge-a")

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	for _, raw := range []string{"Ridge 2", "River Side - R1", "River Side - R2", "Tuolumne 7"} {
		got := r.Resolve(raw, 2022)
		if got.Resolved {
			t.Errorf("%q unexpectedly resolved to %v", raw, got.UnitCodes)
		}
		if got.Raw != raw {
			t.Errorf("Raw = %q, want %q -- the verbatim string must survive for the work queue", got.Raw, raw)
		}
		if len(got.UnitIDs) != 0 {
			t.Errorf("%q returned units %v while unresolved", raw, got.UnitIDs)
		}
	}
}

// TestAliasResolverToleratesWhitespaceAndCase: the seed stores strings verbatim,
// including the real double space in "Health Center Downstairs  - Room A", but
// CampMinder values are hand-entered. Lookup normalises case and outer
// whitespace; inner spacing stays significant because the seed relies on it.
func TestAliasResolverToleratesWhitespaceAndCase(t *testing.T) {
	app := newLodgingTestApp(t)
	dsA := addUnit(t, app, "hc-downstairs-a")
	addAlias(t, app, "Health Center Downstairs  - Room A", []string{dsA}, 0, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	for _, probe := range []string{
		"Health Center Downstairs  - Room A",
		"  Health Center Downstairs  - Room A  ",
		"health center downstairs  - room a",
	} {
		if got := r.Resolve(probe, 2025); !got.Resolved {
			t.Errorf("%q did not resolve", probe)
		}
	}
	// Single space is a DIFFERENT string; collapsing inner whitespace would make
	// the seeded double-space row and a hypothetical single-space row collide.
	if got := r.Resolve("Health Center Downstairs - Room A", 2025); got.Resolved {
		t.Error("single-space variant resolved; inner spacing must stay significant")
	}
}

// TestAliasResolverFlagsOverlappingWindows: the Plan 3 admin UI can add a second
// row for the same string with a different valid_from_year -- the unique index
// is on (alias_string, valid_from_year), not alias_string alone. Overlapping
// windows are a data problem for staff, not something to resolve arbitrarily.
func TestAliasResolverFlagsOverlappingWindows(t *testing.T) {
	app := newLodgingTestApp(t)
	a := addUnit(t, app, "ridge-a")
	b := addUnit(t, app, "ridge-b")
	addAlias(t, app, "Ridge A", []string{a}, 0, 0)
	addAlias(t, app, "Ridge A", []string{b}, 2024, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	got := r.Resolve("Ridge A", 2025)
	if got.Resolved {
		t.Error("an ambiguous alias must not resolve")
	}
	if !got.Ambiguous {
		t.Error("Ambiguous flag not set; the caller cannot tell this apart from 'no alias'")
	}
}
