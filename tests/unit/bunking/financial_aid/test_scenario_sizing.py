"""Scenario sizing moves and codes (sub-project 9b; spec §7.4; D36–D38; main spec §12.3). Fictional
rules only (fixtures.py): the camp table is 90/75/55/35/15/2 by tier, teen overrides tier 2 to 70, family
inherits camp; bands are 0-40,000, 40,001-80,000, ... 200,001 and up; the minimum is 100."""

from __future__ import annotations

from decimal import Decimal

import pytest

from bunking.financial_aid.rules.schema import AidRules
from bunking.financial_aid.scenarios import (
    SIZING_LEVERS,
    SizingError,
    apply_sizing,
    dollar_for_dollar,
    nudge,
    shift_round1_tables,
    starting_point_code,
    variant_code,
    widen_bands,
    with_dollar_for_dollar,
    with_minimum,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules

RULES = fictional_rules()


def _camp(rules: AidRules) -> list[Decimal]:
    table = rules.award_tables["camp"]
    return [table.tiers[t].r1_pct for t in sorted(table.tiers)]


# --- sizing ------------------------------------------------------------------------------------------


def test_a_shift_moves_every_round1_cell_including_overrides_and_nothing_else() -> None:
    shifted = shift_round1_tables(RULES, Decimal(2))
    assert _camp(shifted) == [Decimal(n) for n in (92, 77, 57, 37, 17, 4)]
    assert shifted.award_tables["teen"].overrides[2].r1_pct == Decimal(72)
    assert shifted.award_tables["family"] == RULES.award_tables["family"]  # inherits: moves with camp
    assert shifted.round2 == RULES.round2


def test_a_shift_clamps_at_zero_and_one_hundred() -> None:
    assert _camp(shift_round1_tables(RULES, Decimal(15)))[0] == Decimal(100)
    assert _camp(shift_round1_tables(RULES, Decimal(-5)))[-1] == Decimal(0)


def test_a_zero_move_is_the_same_document() -> None:
    assert shift_round1_tables(RULES, Decimal(0)) is RULES
    assert widen_bands(RULES, Decimal(0)) is RULES


def test_widening_bands_keeps_them_contiguous_and_the_first_floor() -> None:
    bands = widen_bands(RULES, Decimal(1000)).tiers.bands
    assert (bands[0].lower, bands[0].upper) == (Decimal(0), Decimal(41000))
    assert (bands[1].lower, bands[1].upper) == (Decimal(41001), Decimal(82000))
    assert (bands[5].lower, bands[5].upper) == (Decimal(205001), None)


def test_narrowing_bands_below_zero_is_refused() -> None:
    with pytest.raises(SizingError, match="band 1"):
        widen_bands(RULES, Decimal(-50000))


def test_a_minimum_below_zero_is_refused() -> None:
    with pytest.raises(SizingError):
        with_minimum(RULES, Decimal(-1))


def test_each_lever_moves_one_step() -> None:
    moved = {lever.key: nudge(RULES, lever) for lever in SIZING_LEVERS}
    assert [lever.key for lever in SIZING_LEVERS] == ["tier_shift", "minimum", "band_width", "dollar_for_dollar"]
    assert _camp(moved["tier_shift"])[0] == Decimal(91)
    assert moved["minimum"].awards.minimum == Decimal(110)
    assert moved["band_width"].tiers.bands[1].lower == Decimal(41001)
    assert moved["dollar_for_dollar"].grants.offset_mode == "reduce_cost_basis"


def test_dollar_for_dollar_is_a_named_switch_that_flips_both_ways() -> None:
    lever = SIZING_LEVERS[-1]
    off = nudge(RULES, lever)
    assert (lever.step, dollar_for_dollar(RULES), dollar_for_dollar(off)) == (None, True, False)
    assert nudge(off, lever) == RULES
    assert with_dollar_for_dollar(RULES, True) is RULES


def test_apply_sizing_widens_then_shifts() -> None:
    sized = apply_sizing(RULES, tier_shift=Decimal(-2), band_width_delta=Decimal(5000))
    assert _camp(sized)[0] == Decimal(88)
    assert sized.tiers.bands[1].lower == Decimal(45001)


# --- codes -------------------------------------------------------------------------------------------


def test_starting_points_are_letters_and_variants_count_under_their_head() -> None:
    assert [starting_point_code(i) for i in (0, 1, 25, 26, 27)] == ["A", "B", "Z", "AA", "AB"]
    assert (variant_code("A", 0), variant_code("B", 1)) == ("A1", "B2")


def test_the_carry_from_zz_to_aaa() -> None:
    assert (starting_point_code(701), starting_point_code(702)) == ("ZZ", "AAA")


# --- sizing: the parked review minors and final review 9 ----------------------------------------------


def test_narrowing_that_empties_a_band_says_narrower() -> None:
    with pytest.raises(SizingError, match=r"^Bands \$50,000 narrower would leave band 1 empty or below \$0$"):
        widen_bands(RULES, Decimal(-50000))
