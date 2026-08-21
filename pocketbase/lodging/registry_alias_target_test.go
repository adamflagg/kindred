package lodging

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Guards an alias that EXISTS but points at the wrong unit.
//
// This class had no writer at all until it was found by hand on 2026-08-03:
// A parenthesised trailer alias resolved to the numbered room sharing its
// stem instead of the trailer's own unit, which left the trailer unreachable
// and made the numbered room it collided with a double-booking candidate --
// one string, two rooms, no error anywhere.
//
// Nothing existing can see it. verify-lodging-seed.sh asserts the database
// matches the registry file field by field, and diff_lodging_registry.py
// already compares member_units in both directions, so a faithfully-loaded
// wrong answer passes every check: the file was self-consistently wrong, which
// is the same blind spot findStrandedContainers was added for. Counting cannot
// see it either -- the alias count is right, the member count is right, and
// every code named is a real unit.
//
// The invariant that does see it: an alias string that is EXACTLY some unit's
// name must resolve to that unit. The parenthesised trailer alias is verbatim
// the name of the trailer's own unit, so an alias spelling it and resolving
// elsewhere is a misdirection rather than a synonym.
//
// A merge is not a violation. A 2+ member alias is a legitimate shorthand when
// the unit it names is among its targets (the first room of a merged pair);
// it is only wrong when the named unit is absent from its own alias.
//
// Nor is a container resolving to its own rooms. Two seeded aliases each name
// a container and resolve to that container's children, which is what booking
// a whole building HAS to mean: the container is not bookable itself, so the
// alias has to name the rooms it is made of. That is the same whole-versus-
// split distinction a multi-room building turns on. Requiring the container
// to appear in its own member list would flag both of these real rows.
//
// Deliberately NOT a fuzzy check. It fires only on an exact name collision, so
// a genuine synonym -- a CampMinder spelling that matches no unit's registry
// name -- is untouched. The alternative, scoring how well an alias resembles
// its target, would re-derive its answers on data nobody is looking at, which
// is what put the wrong code in the file to begin with.

type misdirectedAlias struct {
	AliasString string
	Points      []string
	ShouldBe    string
}

// aliasNameKey normalises the way the Go resolver's aliasLookupKey does: outer
// whitespace and case only. Inner spacing stays significant, because one seeded
// alias genuinely carries a double space.
func aliasNameKey(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func findMisdirectedAliases(units []registryUnit, aliases []registryAlias) []misdirectedAlias {
	byName := make(map[string]string, len(units))
	parent := make(map[string]string, len(units))
	// Indexed rather than ranged by value: registryUnit is 240 bytes and
	// gocritic's rangeValCopy rejects the copy. Matches registry.go's idiom.
	for i := range units {
		u := &units[i]
		// First writer wins: if two units somehow share a name the check has no
		// unambiguous expectation, and inventing one would produce a false
		// positive on every alias spelling it.
		if _, seen := byName[aliasNameKey(u.Name)]; !seen {
			byName[aliasNameKey(u.Name)] = u.Code
		}
		parent[u.Code] = u.ParentUnit
	}
	// descendantOf walks up from child. Bounded by the unit count so a parent
	// cycle in the file terminates here rather than hanging the test run.
	descendantOf := func(child, ancestor string) bool {
		for step := 0; step < len(units); step++ {
			next, ok := parent[child]
			if !ok || next == "" {
				return false
			}
			if next == ancestor {
				return true
			}
			child = next
		}
		return false
	}

	var out []misdirectedAlias
	for _, a := range aliases {
		code, isUnitName := byName[aliasNameKey(a.AliasString)]
		if !isUnitName || slices.Contains(a.MemberUnits, code) {
			continue
		}
		// A container's name standing for the rooms it contains.
		if len(a.MemberUnits) > 0 {
			allInside := true
			for _, member := range a.MemberUnits {
				if !descendantOf(member, code) {
					allInside = false
					break
				}
			}
			if allInside {
				continue
			}
		}
		out = append(out, misdirectedAlias{
			AliasString: a.AliasString,
			Points:      a.MemberUnits,
			ShouldBe:    code,
		})
	}
	return out
}

func TestFindMisdirectedAliasesCatchesTheNewTrailerClass(t *testing.T) {
	t.Parallel()
	units := []registryUnit{
		{Code: "manzanita-7", Name: "Manzanita 7"},
		{Code: "manzanita-new-trailer", Name: "New Trailer (Manzanitas)"},
	}
	aliases := []registryAlias{
		{AliasString: "New Trailer (Manzanitas)", MemberUnits: []string{"manzanita-7"}},
	}

	got := findMisdirectedAliases(units, aliases)

	if len(got) != 1 {
		t.Fatalf("want 1 misdirected alias, got %d (%v)", len(got), got)
	}
	if got[0].ShouldBe != "manzanita-new-trailer" {
		t.Errorf("want ShouldBe manzanita-new-trailer, got %q", got[0].ShouldBe)
	}
}

func TestFindMisdirectedAliasesAllowsACorrectlyTargetedAlias(t *testing.T) {
	t.Parallel()
	units := []registryUnit{{Code: "manzanita-new-trailer", Name: "New Trailer (Manzanitas)"}}
	aliases := []registryAlias{
		{AliasString: "New Trailer (Manzanitas)", MemberUnits: []string{"manzanita-new-trailer"}},
	}

	if got := findMisdirectedAliases(units, aliases); len(got) != 0 {
		t.Errorf("want no violations, got %v", got)
	}
}

func TestFindMisdirectedAliasesAllowsASynonymThatNamesNoUnit(t *testing.T) {
	t.Parallel()
	// The alias below carries the CampMinder spelling and the unit carries the
	// registry name; the two differ, so the string matches no unit name and the
	// check must stay silent.
	units := []registryUnit{{Code: "forest-village-1", Name: "Forest Village 1"}}
	aliases := []registryAlias{
		{AliasString: "Teen Village 1", MemberUnits: []string{"forest-village-1"}},
	}

	if got := findMisdirectedAliases(units, aliases); len(got) != 0 {
		t.Errorf("want no violations, got %v", got)
	}
}

func TestFindMisdirectedAliasesAllowsAMergeThatIncludesTheUnitItNames(t *testing.T) {
	t.Parallel()
	units := []registryUnit{
		{Code: "gt-tioga-1", Name: "Tioga 1"},
		{Code: "gt-tioga-2", Name: "Tioga 2"},
	}
	aliases := []registryAlias{
		{AliasString: "Tioga 1", MemberUnits: []string{"gt-tioga-1", "gt-tioga-2"}},
	}

	if got := findMisdirectedAliases(units, aliases); len(got) != 0 {
		t.Errorf("a merge naming one of its own members is legitimate, got %v", got)
	}
}

func TestFindMisdirectedAliasesFlagsAMergeThatExcludesTheUnitItNames(t *testing.T) {
	t.Parallel()
	units := []registryUnit{
		{Code: "gt-tioga-1", Name: "Tioga 1"},
		{Code: "gt-tioga-2", Name: "Tioga 2"},
		{Code: "gt-tioga-3", Name: "Tioga 3"},
	}
	aliases := []registryAlias{
		{AliasString: "Tioga 1", MemberUnits: []string{"gt-tioga-2", "gt-tioga-3"}},
	}

	if got := findMisdirectedAliases(units, aliases); len(got) != 1 {
		t.Errorf("want 1 violation, got %v", got)
	}
}

func TestFindMisdirectedAliasesAllowsAContainerNamingItsOwnRooms(t *testing.T) {
	t.Parallel()
	// The real case: the aliased unit below is a container, so booking it has to
	// mean booking the rooms inside it.
	units := []registryUnit{
		{Code: "hc-downstairs", Name: "Health Center Downstairs", IsContainer: true},
		{Code: "hc-downstairs-a", Name: "Room A", ParentUnit: "hc-downstairs"},
		{Code: "hc-downstairs-b", Name: "Room B", ParentUnit: "hc-downstairs"},
	}
	aliases := []registryAlias{{
		AliasString: "Health Center Downstairs",
		MemberUnits: []string{"hc-downstairs-a", "hc-downstairs-b"},
	}}

	if got := findMisdirectedAliases(units, aliases); len(got) != 0 {
		t.Errorf("a container standing for its own rooms is legitimate, got %v", got)
	}
}

func TestFindMisdirectedAliasesStillFlagsAContainerPointedOutsideItself(t *testing.T) {
	t.Parallel()
	// One room belongs to a different building. That is the New Trailer defect
	// wearing a container's clothes, and the descendant exception must not
	// swallow it.
	units := []registryUnit{
		{Code: "hc-downstairs", Name: "Health Center Downstairs", IsContainer: true},
		{Code: "hc-downstairs-a", Name: "Room A", ParentUnit: "hc-downstairs"},
		{Code: "manzanita-7", Name: "Manzanita 7"},
	}
	aliases := []registryAlias{{
		AliasString: "Health Center Downstairs",
		MemberUnits: []string{"hc-downstairs-a", "manzanita-7"},
	}}

	if got := findMisdirectedAliases(units, aliases); len(got) != 1 {
		t.Errorf("want 1 violation, got %v", got)
	}
}

func TestFindMisdirectedAliasesIgnoresCaseAndOuterSpace(t *testing.T) {
	t.Parallel()
	units := []registryUnit{{Code: "gt-lofty", Name: "Lofty"}}
	aliases := []registryAlias{{AliasString: "  lofty ", MemberUnits: []string{"gt-lofty"}}}

	if got := findMisdirectedAliases(units, aliases); len(got) != 0 {
		t.Errorf("want no violations, got %v", got)
	}
}

func TestPrivateRegistryHasNoMisdirectedAliases(t *testing.T) {
	t.Parallel()
	// Runs against the real file when kindred-local is linked, and skips
	// cleanly otherwise -- matching TestPrivateRegistryHasNoStrandedContainers.
	path := filepath.Join("..", "..", "config", "lodging_registry.json")
	data, err := os.ReadFile(path) //nolint:gosec // G304: fixed path to local config
	if err != nil {
		if os.IsNotExist(err) {
			t.Skip("private lodging registry absent; run scripts/setup/setup-local-config.sh")
		}
		t.Fatalf("reading %s: %v", path, err)
	}

	var doc registryDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
	if len(doc.Aliases) == 0 {
		t.Fatalf("%s parsed to zero aliases", path)
	}

	for _, m := range findMisdirectedAliases(doc.Units, doc.Aliases) {
		t.Errorf(
			"alias %q is exactly the name of unit %q but resolves to %v: "+
				"the unit it names is unreachable and the unit it hits is a double-booking candidate",
			m.AliasString, m.ShouldBe, m.Points,
		)
	}
}
