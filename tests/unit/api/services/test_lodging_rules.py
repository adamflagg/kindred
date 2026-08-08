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
    """Two layers, not three, and the override STATES the outcome.

    1500000135 deleted availability's scenario dimension -- a burst pipe closes
    a cabin in every plan for that weekend -- and collapsed the three-value
    `state` enum to one boolean. The three values were REASONS, not states:
    each only meant anything read against the unit's role, so
    `released_to_family` on a family_pool unit was storable and meaningless.
    """

    @pytest.mark.parametrize(
        ("inventory_class", "override", "expected"),
        [
            ("family_pool", None, True),
            ("family_pool", False, False),  # burst pipe
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
        assert is_family_available(inventory_class, override) is expected

    def test_false_is_a_decision_and_not_an_absent_override(self) -> None:
        """`False` and `None` are different answers on a family_pool unit.

        This is the assertion that stops the override being read with a falsy
        test (`if override:`), which would silently discard every reservation --
        the write this column mainly exists for. Absence means "ask the role";
        False means "closed this weekend".
        """
        assert is_family_available("family_pool", False) is False
        assert is_family_available("family_pool", None) is True


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
