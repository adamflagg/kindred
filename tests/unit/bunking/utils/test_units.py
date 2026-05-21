"""Unit mapping — Python port of frontend/src/utils/unitMapping.ts.

This module is the server-side authority for translating bunk names to camp unit
names (Galil, Carmel, etc.). Used by the scoped social-graph endpoint to resolve
?units=galil,carmel into the contained bunks.

A contract test (test_units_contract.py) verifies these results against a shared
JSON fixture that the TypeScript implementation also consumes — drift between
the two languages will fail CI.
"""

import pytest

from bunking.utils.units import (
    UNIT_NAMES,
    get_bunks_in_unit,
    get_unit_for_bunk,
    get_unit_side_for_bunk,
    unit_to_slug,
)


class TestGetUnitForBunk:
    """get_unit_for_bunk maps bunk name → unit name (or None)."""

    @pytest.mark.parametrize(
        ("bunk", "unit"),
        [
            # Carmel: cabins 1-2 (all genders + AG)
            ("B-1", "Carmel"),
            ("G-1", "Carmel"),
            ("AG-1", "Carmel"),
            ("B-2", "Carmel"),
            ("G-2", "Carmel"),
            # Galil: cabins 3-4
            ("B-3", "Galil"),
            ("G-4", "Galil"),
            ("AG-3", "Galil"),
            # Eilat: cabins 5-6
            ("B-5", "Eilat"),
            ("G-6", "Eilat"),
            # Haifa: cabins 7-8
            ("B-7", "Haifa"),
            ("G-8", "Haifa"),
            # Chalutzim 1: cabins 9-10
            ("B-9", "Chalutzim 1"),
            ("G-10", "Chalutzim 1"),
            # Chalutzim 2: cabins 11-12
            ("B-11", "Chalutzim 2"),
            ("G-12", "Chalutzim 2"),
            # Trailing letter (B-5A) is permitted by the spec
            ("B-5A", "Eilat"),
            ("g-12b", "Chalutzim 2"),
        ],
    )
    def test_gendered_pattern_maps_to_correct_unit(self, bunk: str, unit: str) -> None:
        assert get_unit_for_bunk(bunk) == unit

    @pytest.mark.parametrize(
        "name",
        ["Aleph", "aleph", "ALEPH", "Bet", "bet", "B-Aleph", "g-bet", "B-BET"],
    )
    def test_special_nitzanim_names_map_to_nitzanim(self, name: str) -> None:
        assert get_unit_for_bunk(name) == "Nitzanim"

    @pytest.mark.parametrize(
        "bunk",
        ["", "Z-99", "Counselor", "B-99", "B-0", "GG-3", "Galil"],
    )
    def test_unknown_or_invalid_returns_none(self, bunk: str) -> None:
        assert get_unit_for_bunk(bunk) is None


class TestGetUnitSideForBunk:
    """get_unit_side_for_bunk returns {unit, side} where side is 'B'/'G'/None."""

    @pytest.mark.parametrize(
        ("bunk", "unit", "side"),
        [
            ("B-3", "Galil", "B"),
            ("G-4", "Galil", "G"),
            ("AG-3", "Galil", None),  # AG floats — no gendered side
            ("B-Aleph", "Nitzanim", "B"),
            ("G-Bet", "Nitzanim", "G"),
        ],
    )
    def test_gendered_bunks_carry_side(self, bunk: str, unit: str, side: str | None) -> None:
        result = get_unit_side_for_bunk(bunk)
        assert result == {"unit": unit, "side": side}

    def test_unprefixed_aleph_floats(self) -> None:
        assert get_unit_side_for_bunk("Aleph") == {"unit": "Nitzanim", "side": None}
        assert get_unit_side_for_bunk("bet") == {"unit": "Nitzanim", "side": None}

    def test_unknown_returns_none(self) -> None:
        assert get_unit_side_for_bunk("Z-99") is None
        assert get_unit_side_for_bunk("") is None


class TestGetBunksInUnit:
    """get_bunks_in_unit filters a name list to those in a given unit."""

    def test_returns_only_bunks_in_target_unit(self) -> None:
        names = ["B-1", "B-3", "G-3", "AG-3", "B-7", "Aleph"]
        # Galil = cabins 3-4
        assert get_bunks_in_unit("Galil", names) == ["B-3", "G-3", "AG-3"]

    def test_preserves_input_order(self) -> None:
        names = ["G-4", "B-3", "AG-3"]
        assert get_bunks_in_unit("Galil", names) == ["G-4", "B-3", "AG-3"]

    def test_drops_unknown_names_silently(self) -> None:
        names = ["B-3", "Counselor", "B-4", "Z-99"]
        assert get_bunks_in_unit("Galil", names) == ["B-3", "B-4"]

    def test_unknown_unit_returns_empty(self) -> None:
        assert get_bunks_in_unit("Atlantis", ["B-3", "G-4"]) == []

    def test_empty_input_returns_empty(self) -> None:
        assert get_bunks_in_unit("Galil", []) == []


class TestUnitToSlug:
    """unit_to_slug normalizes unit names for URL params."""

    @pytest.mark.parametrize(
        ("unit", "slug"),
        [
            ("Galil", "galil"),
            ("Carmel", "carmel"),
            ("Chalutzim 1", "chalutzim-1"),
            ("Chalutzim 2", "chalutzim-2"),
            ("Nitzanim", "nitzanim"),
        ],
    )
    def test_lowercase_with_dash_separators(self, unit: str, slug: str) -> None:
        assert unit_to_slug(unit) == slug


class TestUnitNames:
    """UNIT_NAMES enumerates every unit in age order (youngest → oldest)."""

    def test_age_ordering(self) -> None:
        assert UNIT_NAMES == (
            "Nitzanim",
            "Carmel",
            "Galil",
            "Eilat",
            "Haifa",
            "Chalutzim 1",
            "Chalutzim 2",
        )
