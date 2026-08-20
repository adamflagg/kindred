package sync

import (
	"slices"
	"testing"
)

// TestAliasResolverUnboundedWindows: PocketBase stores an unset year bound as 0,
// not NULL. 94 of the 100 seeded alias rows are unbounded, so a resolver that
// reads 0 as a real lower bound resolves almost nothing.
//
// "ridge-a" gets one lodging_units row per tested year -- the registry itself
// is year-scoped now (migration 1500000141), so a cabin that was never renamed
// still has a distinct record, and id, every season. The alias's own window
// stays unbounded throughout: this test is about the ALIAS STRING resolving at
// any year, not about one unit id surviving across years.
func TestAliasResolverUnboundedWindows(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	years := []int{2017, 2022, 2025, 2026, 2030}
	ridgeAByYear := make(map[int]string, len(years))
	for _, year := range years {
		ridgeAByYear[year] = addUnit(t, app, "ridge-a", year)
	}
	addAlias(t, app, "Ridge A", []string{ridgeAByYear[years[0]]}, 0, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	for _, year := range years {
		got := r.Resolve("Ridge A", year)
		if !got.Resolved {
			t.Errorf("year %d: unbounded alias did not resolve", year)
		}
		if want := ridgeAByYear[year]; len(got.UnitIDs) != 1 || got.UnitIDs[0] != want {
			t.Errorf("year %d: UnitIDs = %v, want [%s]", year, got.UnitIDs, want)
		}
		if got.IsMerge() {
			t.Errorf("year %d: single-member alias reported as a merge", year)
		}
	}
}

// TestAliasResolverRespectsRenameWindows is the load-bearing case. Both
// Two same-named buildings existed 2022-2024; the one in the first area was renamed
// in 2025. Resolving either side into the other silently relocates a household
// across camp, and nothing downstream would notice.
func TestAliasResolverRespectsRenameWindows(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	// Every building here gets a row in EVERY year the test resolves against,
	// including the years its own alias window excludes. A rename retires the
	// STRING, not the building, and the registry is year-scoped (migration
	// 1500000141), so a house that survives a season has a distinct row, and
	// id, every year it stands. Skipping the out-of-window years would let
	// Resolve's missing-row gate answer "unresolved" before covers() is ever
	// consulted -- the window assertions below would then still pass with the
	// window checks deleted, which is exactly what they exist to catch.
	years := []int{2022, 2023, 2024, 2025}
	gtWawonaByYear := make(map[int]string, len(years))
	hcDoctorsByYear := make(map[int]string, len(years))
	for _, year := range years {
		gtWawonaByYear[year] = addUnit(t, app, "gt-wawona", year)
		hcDoctorsByYear[year] = addUnit(t, app, "hc-doctors-house", year)
	}
	// The 2025 split of the Golden Triangle house into two lettable rooms.
	// Never resolved directly here -- only named as members of an alias nothing
	// in this test calls Resolve on -- so 2025 alone is enough.
	gtFront := addUnit(t, app, "gt-wawona-front", 2025)
	gtBack := addUnit(t, app, "gt-wawona-back", 2025)

	// An alias stores whichever season's ids existed when it was authored and is
	// never re-pointed; Resolve threads stored id -> code -> requested year.
	addAlias(t, app, "Golden Triangle - Doctor's House", []string{gtWawonaByYear[2023]}, 0, 2024)
	addAlias(t, app, "Golden Triangle - Wawona", []string{gtFront, gtBack}, 2025, 0)
	addAlias(t, app, "Health Center - Doctor's House", []string{hcDoctorsByYear[2023]}, 0, 2024)
	addAlias(t, app, "Doctor's House", []string{hcDoctorsByYear[2025]}, 2025, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	// In window at the start of the span too -- valid_from_year is unbounded
	// (0), so 2022 (the year the buildings actually opened, per the doc comment
	// above) must resolve exactly like 2023 does. Also what makes the 2022 rows
	// created above load-bearing instead of dead fixture weight.
	if got := r.Resolve("Golden Triangle - Doctor's House", 2022); !got.Resolved ||
		got.UnitIDs[0] != gtWawonaByYear[2022] {
		t.Errorf("2022 GT Doctor's House: %+v", got)
	}
	if got := r.Resolve("Health Center - Doctor's House", 2022); !got.Resolved ||
		got.UnitIDs[0] != hcDoctorsByYear[2022] {
		t.Errorf("2022 HC Doctor's House: %+v", got)
	}
	// In window, both retired strings.
	if got := r.Resolve("Golden Triangle - Doctor's House", 2023); !got.Resolved ||
		got.UnitIDs[0] != gtWawonaByYear[2023] {
		t.Errorf("2023 GT Doctor's House: %+v", got)
	}
	if got := r.Resolve("Health Center - Doctor's House", 2023); !got.Resolved ||
		got.UnitIDs[0] != hcDoctorsByYear[2023] {
		t.Errorf("2023 HC Doctor's House: %+v", got)
	}
	// The valid_to_year boundary itself is INCLUSIVE: the window "0..2024" still
	// covers 2024, not just years strictly before it. This is the half-closed
	// gap the lower bound already had coverage for and the upper bound did not.
	if got := r.Resolve("Golden Triangle - Doctor's House", 2024); !got.Resolved ||
		got.UnitIDs[0] != gtWawonaByYear[2024] {
		t.Errorf("2024 GT Doctor's House (inclusive upper boundary): %+v", got)
	}
	if got := r.Resolve("Health Center - Doctor's House", 2024); !got.Resolved ||
		got.UnitIDs[0] != hcDoctorsByYear[2024] {
		t.Errorf("2024 HC Doctor's House (inclusive upper boundary): %+v", got)
	}
	// Out of window on the high side -- the string was retired, so it must NOT
	// silently fall through to the Health Center row of the same shape. Both
	// buildings have a 2025 row, so only the window can refuse these.
	if got := r.Resolve("Golden Triangle - Doctor's House", 2025); got.Resolved {
		t.Errorf("2025 GT Doctor's House resolved to %v; the window ends at 2024", got.UnitCodes)
	}
	if got := r.Resolve("Health Center - Doctor's House", 2025); got.Resolved {
		t.Errorf("2025 HC Doctor's House resolved to %v; the window ends at 2024", got.UnitCodes)
	}
	// Out of window on the low side. hc-doctors-house has a 2024 row, so only
	// the window can refuse this.
	if got := r.Resolve("Doctor's House", 2024); got.Resolved {
		t.Errorf("2024 bare Doctor's House resolved to %v; the window starts at 2025", got.UnitCodes)
	}
	if got := r.Resolve("Doctor's House", 2025); !got.Resolved ||
		got.UnitIDs[0] != hcDoctorsByYear[2025] {
		t.Errorf("2025 bare Doctor's House: %+v", got)
	}
}

// TestAliasResolverMergeDenotingAlias: 2+ members means the string denotes a
// merge of that many rooms (spec 3.4). Six seeded aliases are of this shape.
func TestAliasResolverMergeDenotingAlias(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	tioga1 := addUnit(t, app, "gt-tioga-1", 2025)
	tioga2 := addUnit(t, app, "gt-tioga-2", 2025)
	addAlias(t, app, "Golden Triangle - Tioga 1and2", []string{tioga1, tioga2}, 0, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	got := r.Resolve("Golden Triangle - Tioga 1and2", 2025)
	if !got.Resolved || !got.IsMerge() {
		t.Fatalf("expected a resolved merge, got %+v", got)
	}
	ids := slices.Sorted(slices.Values(got.UnitIDs))
	want := slices.Sorted(slices.Values([]string{tioga1, tioga2}))
	if ids[0] != want[0] || ids[1] != want[1] {
		t.Errorf("UnitIDs = %v, want %v", ids, want)
	}
	codes := slices.Sorted(slices.Values(got.UnitCodes))
	if codes[0] != "gt-tioga-1" || codes[1] != "gt-tioga-2" {
		t.Errorf("UnitCodes = %v", codes)
	}
}

// TestAliasResolverUnresolvedIsNotAnError: four strings observed 2022-2023 have
// no alias row at all -- "Ridge 2", "River Side - R1", "River Side - R2",
// an unknown cabin string. It must come back unresolved, with the raw string preserved,
// and must not panic or error.
func TestAliasResolverUnresolvedIsNotAnError(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	addUnit(t, app, "ridge-a", 2022)

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
	t.Parallel()
	app := newSyncTestApp(t)
	dsA := addUnit(t, app, "hc-downstairs-a", 2025)
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
	t.Parallel()
	app := newSyncTestApp(t)
	a := addUnit(t, app, "ridge-a", 2025)
	b := addUnit(t, app, "ridge-b", 2025)
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

// TestResolveReturnsTheRequestedYearsUnitIDs is the silent-failure case Task 5
// exists for. An alias stores whichever season's record ids existed when it
// was written and is never re-pointed -- lodging_assignments_sync.go writes
// UnitIDs straight into a placement's relation, so resolving 2027 must not
// hand back 2026's ids.
func TestResolveReturnsTheRequestedYearsUnitIDs(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	id2026 := addUnit(t, app, "test-unit-a", 2026)
	id2027 := addUnit(t, app, "test-unit-a", 2027)
	addAlias(t, app, "Test Building A", []string{id2026}, 0, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	got := r.Resolve("Test Building A", 2027)
	if !got.Resolved {
		t.Fatalf("not resolved for 2027")
	}
	if len(got.UnitIDs) != 1 || got.UnitIDs[0] != id2027 {
		t.Errorf("UnitIDs = %v, want the 2027 row %q", got.UnitIDs, id2027)
	}
	if len(got.UnitCodes) != 1 || got.UnitCodes[0] != "test-unit-a" {
		t.Errorf("UnitCodes = %v, want [test-unit-a]", got.UnitCodes)
	}
}

// TestResolveIsUnresolvedWhenAMemberIsMissingThatYear pins all-or-nothing
// resolution: if any member code has no row in the requested year, the whole
// alias is unresolved. A partial member set would silently shrink a family's
// rooms, which is worse than a name that does not resolve.
func TestResolveIsUnresolvedWhenAMemberIsMissingThatYear(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	a2026 := addUnit(t, app, "test-unit-a", 2026)
	b2026 := addUnit(t, app, "test-unit-b", 2026)
	// "test-unit-a" has a 2027 row; "test-unit-b" does not -- a member code with
	// no row in the requested year, not a claim about why (the registry's own
	// demolition path is `is_active: false` on a row that IS carried forward).
	addUnit(t, app, "test-unit-a", 2027)
	addAlias(t, app, "Test Pair", []string{a2026, b2026}, 0, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	got := r.Resolve("Test Pair", 2027)
	if got.Resolved {
		t.Errorf("resolved with a missing member; want unresolved")
	}
	if len(got.UnitIDs) != 0 {
		t.Errorf("UnitIDs = %v, want empty -- a partial member set silently shrinks a family's rooms", got.UnitIDs)
	}
}

// TestResolveIsUnresolvedWhenAMemberIsDangling closes the second door to a
// partial member set: a stored member_units id that names no unit row at all
// must fail the whole resolution exactly like a member missing from the
// requested year does. Dropping it and returning the survivor would shrink
// the room count exactly as silently -- and it used to fail loudly instead of
// silently, because the eventual lodging_assignments write refuses an id
// RelationField.ValidateValue cannot resolve; skipping the dangling member
// here means only real ids ever reach that write, and the failure vanishes.
func TestResolveIsUnresolvedWhenAMemberIsDangling(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	a2027 := addUnit(t, app, "test-unit-a", 2027)
	addAliasWithDanglingMember(t, app, "Test Pair", []string{a2027, "missingunit0001"}, 0, 0)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}

	got := r.Resolve("Test Pair", 2027)
	if got.Resolved {
		t.Errorf("resolved with a dangling member; want unresolved")
	}
	if len(got.UnitIDs) != 0 {
		t.Errorf("UnitIDs = %v, want empty -- a dangling member silently shrinks a family's rooms", got.UnitIDs)
	}
}
