"""Pure lodging rules. These encode three facts that are invisible in the schema.

1. sleeps = 0 means UNKNOWN. PocketBase number columns are
   `NUMERIC DEFAULT 0 NOT NULL`, so an unset number stores as 0, never NULL.
2. Family availability is a two-input table (base default x per-session
   override), not a single flag.
3. private-vs-shared bathroom depends on merge state, so merging can itself
   satisfy a medical bathroom request.

The share gate, the NEAR/WITH modes and the request text are NOT here: the Go
ingest derives them into typed columns and this surface reads those. See the
module docstring of api/services/lodging_rules.py for why re-parsing them in
Python would regress two fixes that live only on the Go side.
"""

import pytest

from api.services.lodging_rules import (
    amenity_coverage,
    container_bathroom,
    effective_bathroom,
    is_family_available,
    unit_capacity,
)


class TestUnitCapacity:
    def test_zero_means_unknown_not_zero_beds(self) -> None:
        assert unit_capacity(0) is None

    def test_none_means_unknown(self) -> None:
        assert unit_capacity(None) is None

    def test_negative_is_treated_as_unknown(self) -> None:
        assert unit_capacity(-3) is None

    def test_positive_passes_through(self) -> None:
        assert unit_capacity(8) == 8


class TestIsFamilyAvailable:
    """TWO QUESTIONS, and the override answers only one of them.

    1500000135 deleted availability's scenario dimension and collapsed the
    three-value `state` enum to one boolean. The three values were REASONS, not
    states: each only meant anything read against the unit's role, so
    `released_to_family` on a family_pool unit was storable and meaningless.

    kindred#2382 then found that the surviving boolean was still carrying two
    unrelated facts -- the staff<->family ROLE and whether somebody is IN the
    room -- and split them. `override` is the role; `is_occupied` is the
    occupancy, read from `lodging_write_ins` rather than from the role column.
    This function is where the two meet, and the only place they do.
    """

    @pytest.mark.parametrize(
        ("inventory_class", "override", "expected"),
        [
            ("family_pool", None, True),
            ("family_pool", False, False),  # closed by role
            ("family_pool", True, True),  # redundant but harmless
            ("staff_default", None, False),
            ("staff_default", True, True),  # released for this weekend
            ("staff_default", False, False),
            # An admin-created unit with no explicit role stores "". Treated as
            # family_pool so it is at least visible; the roster reports the gap
            # separately via RosterCounts.units_missing_allocation.
            ("", None, True),
            ("", False, False),
        ],
    )
    def test_the_override_wins_and_the_role_decides_without_one(
        self, inventory_class: str, override: bool | None, expected: bool
    ) -> None:
        assert is_family_available(inventory_class, override, is_occupied=False) is expected

    def test_false_is_a_decision_and_not_an_absent_override(self) -> None:
        """`False` and `None` are different answers on a family_pool unit.

        This is the assertion that stops the override being read with a falsy
        test (`if override:`), which would silently discard every closure.
        Absence means "ask the role"; False means "closed this weekend".
        """
        assert is_family_available("family_pool", False, is_occupied=False) is False
        assert is_family_available("family_pool", None, is_occupied=False) is True

    @pytest.mark.parametrize(
        ("inventory_class", "override"),
        [
            ("family_pool", None),
            ("family_pool", True),
            ("staff_default", True),  # released AND written into -- occupancy wins
            ("", None),
        ],
    )
    def test_an_occupancy_closes_the_unit_whatever_the_role_says(
        self, inventory_class: str, override: bool | None
    ) -> None:
        """kindred#2382: somebody is in it, so no family can go in it.

        The role can say "this is family inventory" as loudly as it likes; a
        cabin with an occupant cannot take a second party. Ordering it the other
        way round is a bed collision, which is the failure write-ins exist to
        prevent.
        """
        assert is_family_available(inventory_class, override, is_occupied=True) is False


class TestEffectiveBathroom:
    def test_unset_value_is_unknown_not_none(self) -> None:
        assert effective_bathroom("", "", frozenset(), frozenset({"ridge-a"})) == "unknown"

    def test_none_passes_through(self) -> None:
        assert effective_bathroom("none", "", frozenset(), frozenset({"ridge-a"})) == "none"

    def test_private_passes_through(self) -> None:
        assert effective_bathroom("private", "", frozenset(), frozenset({"hc-upstairs-5"})) == "private"

    def test_full_group_merge_upgrades_shared_to_private(self) -> None:
        """merge{Tioga 1, Tioga 2} covers the whole gt-tioga-12 group."""
        assert (
            effective_bathroom(
                "shared",
                "gt-tioga-12",
                frozenset({"gt-tioga-1", "gt-tioga-2"}),
                frozenset({"gt-tioga-1", "gt-tioga-2"}),
            )
            == "private"
        )

    def test_partial_group_merge_stays_shared(self) -> None:
        """merge{Upstairs 1, Upstairs 2} leaves 3 members of hc-upstairs-hall out."""
        assert (
            effective_bathroom(
                "shared",
                "hc-upstairs-hall",
                frozenset({"hc-upstairs-1", "hc-upstairs-2", "hc-upstairs-3", "hc-upstairs-4", "hc-upstairs-6"}),
                frozenset({"hc-upstairs-1", "hc-upstairs-2"}),
            )
            == "shared"
        )

    def test_shared_without_a_group_stays_shared(self) -> None:
        assert effective_bathroom("shared", "", frozenset(), frozenset({"x"})) == "shared"


class TestContainerBathroom:
    """kindred#2022's second gap. All 15 registry containers store
    bathroom = "none" on their own row -- a building is not a room -- which
    short-circuits `effective_bathroom`'s exclusivity branch (line 108-109)
    before it ever runs. A party that books the whole container (the
    health-center apartments: two bedrooms over one shared bath, normally
    let whole) needs the container's input substituted from its leaves
    instead. This is that substitution, kept OUTSIDE `effective_bathroom`
    itself -- that function stays the same four-argument pure test the
    class above already pins, rather than growing a fifth argument to know
    about children it has no way to walk.
    """

    def test_leaves_sharing_one_group_inherit_shared(self) -> None:
        assert container_bathroom(frozenset({"hc-dh-bath"})) == ("shared", "hc-dh-bath")

    def test_leaves_with_no_group_inherit_nothing(self) -> None:
        assert container_bathroom(frozenset({""})) == ("none", "")

    def test_leaves_split_across_groups_inherit_nothing(self) -> None:
        """Ambiguous -- rooms that don't share one physical bathroom have no
        single answer, so the container reports exactly what its own
        registry row already says."""
        assert container_bathroom(frozenset({"group-a", "group-b"})) == ("none", "")

    def test_no_leaves_inherit_nothing(self) -> None:
        assert container_bathroom(frozenset()) == ("none", "")


class TestAmenityCoverage:
    """kindred#1912. A container's stored amenity flags describe the
    CONTAINER, not its rooms -- the same shape as the settled
    "a container's `sleeps` is a delta" ruling, on a different column. In the
    2026 registry twelve of the fourteen family-pool containers record
    `has_power = 0` while every leaf beneath them has power, so reading a
    container's own flag marks twelve entirely-powered buildings unpowered.

    The grain is three-valued rather than boolean because both boolean
    policies fall out of it for free (`OR == state != "none"`,
    `AND == state == "all"`), so a per-criterion policy map would be a strict
    subset that costs more to build.

    `None` is the fourth answer and it is not a grain: it is the ABSENCE of
    evidence, which `unit_capacity`, `unit_shareability` and
    `effective_bathroom` each already spell as "unknown" for the same reason.
    An unconfirmed cabin's `has_power = False` means "nobody has said", not
    "there is no power" -- the gate `rosterAttention` already applies to the
    roster's own fit check.
    """

    def test_every_source_has_it(self) -> None:
        assert amenity_coverage([True, True, True]) == "all"

    def test_no_source_has_it(self) -> None:
        assert amenity_coverage([False, False]) == "none"

    def test_a_mixed_set_is_some(self) -> None:
        assert amenity_coverage([True, False, True]) == "some"

    def test_a_single_source_answers_for_itself(self) -> None:
        """A leaf has no descendants, so it is its own one-element set."""
        assert amenity_coverage([True]) == "all"
        assert amenity_coverage([False]) == "none"

    def test_nothing_to_judge_is_unknown(self) -> None:
        """Never "none": marking a slot we cannot see as unmet asserts a fact
        about it, and the mark this feeds exists to state a fact."""
        assert amenity_coverage([]) == "unknown"

    def test_one_unmeasured_source_makes_the_whole_answer_unknown(self) -> None:
        """The same all-or-nothing evidence bar `resolvePartyUnit` applies to
        a merge: one unconfirmed room is an absence of data, not a looser
        standard for having more rooms."""
        assert amenity_coverage([True, None]) == "unknown"
        assert amenity_coverage([False, None]) == "unknown"
        assert amenity_coverage([None]) == "unknown"
