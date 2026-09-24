"""Cross-language drift guard for the lodging name resolvers (kindred#2762).

Two resolvers turn a staff-typed cabin string into a lodging unit:

- Python, for display -- ``HousingNameResolver`` (``api/services/lodging_rules.py``).
  Direct-matches a unit's own name/code FIRST, then falls back to aliases.
- Go, the ingest -- ``AliasResolver.Resolve`` (``pocketbase/sync/lodging_alias_resolver.go``).
  Checks aliases FIRST, then falls back to an exact match on a LEAF unit's
  name/code, for the requested year.

The two run in opposite orders on purpose (kindred#2762 Part 1): two production
aliases map a *container's* name to its leaf rooms, and alias-first is what
keeps those resolving to the rooms rather than the whole building. There is no
cross-language bridge in this repo to call the real Go code from Python (see
``tests/unit/sync/bunk_request_processor/test_unresolved_id_parity.py`` and
``tests/unit/sync/bunk_request_processor/core/test_source_field_map_ts_parity.py``
for the same pattern), so this file reimplements the Go algorithm's
direct-name-fallback half in Python, next to the real Python implementation,
so drift between the two fails a Python test here instead of surfacing as a
mis-placed household.

PARITY SCOPE, per the issue body: strings with NO covering alias that
direct-match a LEAF unit. Alias-covered strings are excluded on purpose --
the two container-name aliases resolve to the container in Python (direct
match wins, since Python checks it first) and to its leaf rooms in Go (the
alias wins, since Go checks it first). That divergence is deliberate and is
demonstrated, not asserted as parity, below.
"""

from api.services.lodging_rules import HousingNameResolver, RegistryUnit, UnitAlias, housing_lookup_key

YEAR = 2026


def _unit(unit_id: str, code: str, name: str, *, parent_id: str = "") -> RegistryUnit:
    return RegistryUnit(unit_id=unit_id, code=code, name=name, year=YEAR, parent_id=parent_id)


def _alias(alias_string: str, *member_ids: str) -> UnitAlias:
    return UnitAlias(alias_string=alias_string, member_unit_ids=tuple(member_ids), valid_from_year=0, valid_to_year=0)


# Two ordinary leaf units, no relation to each other.
_LEAF_1 = _unit("u-cabin-1", "test-cabin-1", "Test Cabin One")
_LEAF_2 = _unit("u-cabin-2", "test-cabin-2", "Test Cabin Two")

# A container with two leaf children -- the shape the two real production
# container-name aliases rely on.
_CONTAINER = _unit("u-container-1", "test-container-1", "Test Container One")
_CHILD_A = _unit("u-leaf-a", "test-leaf-a", "Test Leaf A", parent_id="u-container-1")
_CHILD_B = _unit("u-leaf-b", "test-leaf-b", "Test Leaf B", parent_id="u-container-1")

# A second, ALIAS-FREE container. Unlike `_CONTAINER` above (whose only
# route to resolving is through its alias, so the leaf-only filter is never
# actually consulted for it -- the alias short-circuits first), this one has
# no alias at all, so it is the only fixture unit that exercises the
# direct-name fallback's leaf-only filter on its real code path.
_LONE_CONTAINER = _unit("u-lone-container", "test-lone-container", "Test Lone Container")

# A THIRD container, dedicated to the ambiguity-poisoning fix: unlike
# `_LONE_CONTAINER` above (deliberately alone, so Python's "direct-matches the
# container itself" case has a clean witness with no collision), this one
# shares its exact `name` with an unrelated leaf below. Excluding a container
# from the fallback's ambiguity index entirely -- rather than only from being
# a candidate WINNER -- let that leaf win the shared name uncontested; both
# languages must agree it stays unresolved instead.
_CONTAINER_NAME_COLLISION = _unit("u-collision-container", "test-collision-container", "Collision Name")
_LEAF_SHARING_CONTAINER_NAME = _unit("u-collision-leaf", "test-collision-leaf", "Collision Name")

_UNITS = [
    _LEAF_1,
    _LEAF_2,
    _CONTAINER,
    _CHILD_A,
    _CHILD_B,
    _LONE_CONTAINER,
    _CONTAINER_NAME_COLLISION,
    _LEAF_SHARING_CONTAINER_NAME,
]

# `RegistryUnit` (unlike Go's `lodging_units` row) carries no `is_container`
# column -- Python's direct-name index does not need one, since it deliberately
# direct-matches containers too. The Go mirror below needs to know which of
# these codes are containers, so it is tracked here instead, alongside the
# fixture that defines it.
_CONTAINER_CODES = frozenset({_CONTAINER.code, _LONE_CONTAINER.code, _CONTAINER_NAME_COLLISION.code})

_ALIASES = [
    # The container-name alias: covers "Test Container One" and expands to
    # its two leaf children, exactly like the real production rows.
    _alias("Test Container One", _CHILD_A.unit_id, _CHILD_B.unit_id),
    # An unrelated alias, present only to prove it does not leak into the
    # direct-match strings this file actually asserts parity on.
    _alias("Historical Name For Cabin One", _LEAF_1.unit_id),
]


def _go_direct_match_codes(raw: str, year: int) -> tuple[str, ...]:
    """A minimal, faithful mirror of the Go algorithm being added in this PR.

    Aliases first (same lookup key, same year window, same all-or-nothing
    member translation as `AliasResolver.Resolve`); then, only when nothing
    covers the string, an exact match on a LEAF unit's name or code in this
    year -- sticky-ambiguous exactly like Go's `directByKey` sentinel and
    Python's own `_direct_by_key` (a key two units answer to is `None`/"",
    never picked arbitrarily, and a later duplicate must not un-ambiguous it).
    """
    key = housing_lookup_key(raw)
    if not key:
        return ()

    matches = [a for a in _ALIASES if housing_lookup_key(a.alias_string) == key and a.covers(year)]
    if len(matches) == 1:
        codes: list[str] = []
        for member_id in matches[0].member_unit_ids:
            unit = next((u for u in _UNITS if u.unit_id == member_id and u.year == year), None)
            if unit is None:
                return ()
            codes.append(unit.code)
        return tuple(codes)
    if len(matches) > 1:
        return ()  # overlapping alias windows -- ambiguous, never picked arbitrarily

    direct_by_key: dict[str, str | None] = {}
    for unit in _UNITS:
        if unit.year != year:
            continue
        is_container = unit.code in _CONTAINER_CODES
        for candidate in (unit.name, unit.code):
            candidate_key = housing_lookup_key(candidate)
            if not candidate_key:
                continue
            if is_container:
                # A container may never WIN the fallback, but its presence
                # still has to poison the key -- an unrelated leaf sharing
                # its exact name/code must not win uncontested. Mirrors the
                # Go fix: `continue`-ing past a container entirely made it
                # invisible to this collision check, not just ineligible to
                # win it.
                direct_by_key[candidate_key] = None
                continue
            if candidate_key in direct_by_key and direct_by_key[candidate_key] != unit.code:
                direct_by_key[candidate_key] = None
            else:
                direct_by_key[candidate_key] = unit.code

    direct = direct_by_key.get(key)
    return (direct,) if direct else ()


class TestGoDirectNameFallbackParity:
    """Strings with no covering alias must direct-match the same leaf in both."""

    def test_no_alias_covers_these_strings(self) -> None:
        """Sanity guard on the fixture itself: if one of the strings below
        ever picks up a covering alias, the parity assertions stop meaning
        what their docstring says, so fail loudly rather than silently."""
        covered = {
            "test-cabin-1",
            "test cabin one",
            "test cabin two",
            "test-cabin-2",
            "test-leaf-a",
            "test leaf a",
            "collision name",
        }
        for alias in _ALIASES:
            assert housing_lookup_key(alias.alias_string) not in covered

    def test_exact_code_match(self) -> None:
        resolver = HousingNameResolver.build(_UNITS, _ALIASES)
        assert resolver.resolve_codes("test-cabin-1", YEAR) == _go_direct_match_codes("test-cabin-1", YEAR)
        assert resolver.resolve_codes("test-cabin-1", YEAR) == ("test-cabin-1",)

    def test_exact_name_match(self) -> None:
        resolver = HousingNameResolver.build(_UNITS, _ALIASES)
        assert resolver.resolve_codes("Test Cabin One", YEAR) == _go_direct_match_codes("Test Cabin One", YEAR)
        assert resolver.resolve_codes("Test Cabin One", YEAR) == ("test-cabin-1",)

    def test_case_and_outer_whitespace_are_ignored_on_both_sides(self) -> None:
        resolver = HousingNameResolver.build(_UNITS, _ALIASES)
        for raw in ("TEST CABIN TWO", "  test-cabin-2  ", "test cabin two"):
            assert resolver.resolve_codes(raw, YEAR) == _go_direct_match_codes(raw, YEAR) == ("test-cabin-2",)

    def test_a_leaf_child_of_a_container_still_direct_matches_on_its_own_name(self) -> None:
        """`test-leaf-a` carries no alias of its own -- only its CONTAINER's
        name has one -- so this exercises the leaf-direct-match path, not the
        alias path."""
        resolver = HousingNameResolver.build(_UNITS, _ALIASES)
        assert resolver.resolve_codes("Test Leaf A", YEAR) == _go_direct_match_codes("Test Leaf A", YEAR)
        assert resolver.resolve_codes("Test Leaf A", YEAR) == ("test-leaf-a",)


class TestContainerDirectMatchDivergesOnPurpose:
    """OUT of parity scope -- the reason container strings are excluded.

    Two separate divergences, both deliberate per the issue body:

    1. Alias-covered: order is reversed between the two resolvers, so an
       alias-covered container name resolves to the container in Python
       (direct match wins, checked first) and to its leaf rooms in Go (the
       alias wins, checked first).
    2. Alias-free: Python's direct match never filters containers at all;
       Go's direct-name fallback always does, so a bare container name with
       no alias resolves in Python and stays a work-queue item in Go.

    Neither is a bug in either resolver. Nobody should "fix" this difference
    later without reading why it is here.
    """

    def test_python_direct_matches_the_alias_covered_container_itself(self) -> None:
        resolver = HousingNameResolver.build(_UNITS, _ALIASES)
        assert resolver.resolve_codes("Test Container One", YEAR) == ("test-container-1",)

    def test_go_resolves_the_alias_covered_container_to_its_leaf_rooms_instead(self) -> None:
        assert _go_direct_match_codes("Test Container One", YEAR) == ("test-leaf-a", "test-leaf-b")

    def test_python_direct_matches_the_alias_free_container_too(self) -> None:
        resolver = HousingNameResolver.build(_UNITS, _ALIASES)
        assert resolver.resolve_codes("Test Lone Container", YEAR) == ("test-lone-container",)

    def test_go_never_direct_matches_a_container_so_it_stays_unresolved(self) -> None:
        assert _go_direct_match_codes("Test Lone Container", YEAR) == ()


class TestContainerAmbiguityPoisoningIsInParity:
    """A THIRD container behaviour, discovered in code review -- and unlike
    the two divergences above, this one is NOT a deliberate difference: both
    languages must agree.

    `_CONTAINER_NAME_COLLISION` and `_LEAF_SHARING_CONTAINER_NAME` share one
    name and nothing else. A container may never WIN the direct-name
    fallback, but excluding it from the ambiguity index entirely -- rather
    than only from being a candidate winner -- left an unrelated leaf free to
    claim their shared name uncontested, the same way any other two-claimant
    name has to fall through unresolved
    (`TestAliasResolverDirectMatchSharedNameIsUnresolved`'s Go counterpart).
    Python's `HousingNameResolver` already got this right, because it never
    special-cased containers out of the index in the first place; the Go
    mirror above did, and `_go_direct_match_codes` used to reproduce that
    same exclusion rather than the corrected algorithm.
    """

    def test_a_leaf_sharing_a_containers_exact_name_stays_unresolved_in_both(self) -> None:
        resolver = HousingNameResolver.build(_UNITS, _ALIASES)
        assert resolver.resolve_codes("Collision Name", YEAR) == ()
        assert _go_direct_match_codes("Collision Name", YEAR) == ()
