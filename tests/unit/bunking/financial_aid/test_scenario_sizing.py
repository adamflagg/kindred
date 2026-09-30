"""Scenario sizing moves, labels and codes (sub-project 9b; spec §7.4; D36–D38; main spec §12.3). Fictional
rules only (fixtures.py): the camp table is 90/75/55/35/15/2 by tier, teen overrides tier 2 to 70, family
inherits camp; bands are 0-40,000, 40,001-80,000, ... 200,001 and up; the minimum is 100."""

from __future__ import annotations

from decimal import Decimal

import pytest

from bunking.financial_aid.rules.schema import AidRules
from bunking.financial_aid.scenarios import (
    CHANGE_MAX_CHARS,
    SIZING_LEVERS,
    SizingError,
    apply_sizing,
    change_phrases,
    describe,
    dollar_for_dollar,
    nudge,
    shift_round1_tables,
    starting_point_code,
    variant_code,
    widen_bands,
    with_dollar_for_dollar,
    with_minimum,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_lever, with_levers

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


# --- labels ------------------------------------------------------------------------------------------


def test_a_uniform_shift_reads_as_points() -> None:
    assert describe(RULES, shift_round1_tables(RULES, Decimal(2))) == "Round 1 % +2 pts"
    assert describe(RULES, shift_round1_tables(RULES, Decimal("-0.5"))) == "Round 1 % −0.5 pts"


def test_a_clamped_shift_is_not_uniform_so_it_is_counted() -> None:
    assert describe(RULES, shift_round1_tables(RULES, Decimal(-5))) == "award_tables: 7 changes"


def test_bands_and_the_minimum_read_plainly() -> None:
    assert describe(RULES, widen_bands(RULES, Decimal(1000))) == "bands $1,000 wider"
    assert describe(RULES, widen_bands(RULES, Decimal(-1000))) == "bands $1,000 narrower"
    assert describe(RULES, with_minimum(RULES, Decimal(150))) == "minimum $150"


def test_several_moves_read_in_section_order() -> None:
    moved = with_minimum(shift_round1_tables(RULES, Decimal(-2)), Decimal(150))
    assert change_phrases(RULES, moved) == ["Round 1 % −2 pts", "minimum $150"]
    assert describe(RULES, moved) == "Round 1 % −2 pts · minimum $150"


def test_the_grant_offset_reads_by_its_lever_name() -> None:
    off = with_lever(RULES, "grants.offset_mode", "reduce_cost_basis")
    assert describe(RULES, off) == "dollar-for-dollar off"
    assert describe(off, RULES) == "dollar-for-dollar on"


def test_one_other_change_names_its_setting_and_several_are_counted() -> None:
    one = with_lever(RULES, "income.floor", "500")
    assert describe(RULES, one) == "income.floor 0 → 500"
    two = with_lever(with_lever(RULES, "income.floor", "500"), "income.medical_threshold", "5000")
    assert describe(RULES, two) == "income: 2 changes"


def test_no_change_says_so() -> None:
    assert describe(RULES, fictional_rules()) == "no changes"


# --- codes -------------------------------------------------------------------------------------------


def test_starting_points_are_letters_and_variants_count_under_their_head() -> None:
    assert [starting_point_code(i) for i in (0, 1, 25, 26, 27)] == ["A", "B", "Z", "AA", "AB"]
    assert (variant_code("A", 0), variant_code("B", 1)) == ("A1", "B2")


def test_the_carry_from_zz_to_aaa() -> None:
    assert (starting_point_code(701), starting_point_code(702)) == ("ZZ", "AAA")


# --- labels: the parked review minors and final review 9 ----------------------------------------------


def test_money_with_cents_reads_as_dollars_and_cents() -> None:
    assert describe(RULES, with_minimum(RULES, Decimal("150.5"))) == "minimum $150.50"
    assert describe(RULES, with_minimum(RULES, Decimal("150.00"))) == "minimum $150"


def test_bands_moved_unevenly_are_counted_not_named_a_widening() -> None:
    bands = list(RULES.tiers.bands)
    bands[1] = bands[1].model_copy(update={"upper": bands[1].upper + 1000})  # type: ignore[operator]
    bands[2] = bands[2].model_copy(update={"lower": bands[2].lower + 1000})
    uneven = RULES.model_copy(update={"tiers": RULES.tiers.model_copy(update={"bands": bands})})
    assert describe(RULES, uneven) == "tiers: 2 changes"


def test_a_named_move_and_another_change_in_the_same_section_each_read() -> None:
    awards = with_lever(with_minimum(RULES, Decimal(150)), "awards.ask_cap", not RULES.awards.ask_cap)
    ask_cap = f"awards.ask_cap {'yes' if RULES.awards.ask_cap else 'no'} → {'no' if RULES.awards.ask_cap else 'yes'}"
    assert change_phrases(RULES, awards) == ["minimum $150", ask_cap]
    tiers = with_lever(widen_bands(RULES, Decimal(1000)), "tiers.floor_tier", 2)
    assert change_phrases(RULES, tiers) == ["bands $1,000 wider", "tiers.floor_tier 1 → 2"]
    grants = with_levers(RULES, {"grants.offset_mode": "reduce_cost_basis", "grants.late_grant_policy": "recalculate"})
    assert change_phrases(RULES, grants) == [
        "dollar-for-dollar off",
        f"grants.late_grant_policy {RULES.grants.late_grant_policy} → recalculate",
    ]


def test_narrowing_that_empties_a_band_says_narrower() -> None:
    with pytest.raises(SizingError, match=r"^Bands \$50,000 narrower would leave band 1 empty or below \$0$"):
        widen_bands(RULES, Decimal(-50000))


def test_a_change_too_long_for_the_trail_column_is_cut_with_an_ellipsis() -> None:
    long = with_lever(RULES, "programs.summer.label", "a very long label " * 150)
    text = describe(RULES, long)
    assert (len(text), text[-1]) == (CHANGE_MAX_CHARS, "…")
    assert text.startswith("programs.summer.label ")
    assert describe(RULES, with_minimum(RULES, Decimal(150))) == "minimum $150"  # a short one is untouched


def test_one_band_bound_moved_names_that_bound_and_a_new_band_counts_them() -> None:
    bands = list(RULES.tiers.bands)
    bands[5] = bands[5].model_copy(update={"lower": bands[5].lower + 1000})
    one = RULES.model_copy(update={"tiers": RULES.tiers.model_copy(update={"bands": bands})})
    assert describe(RULES, one) == "tiers.bands.6.lower 200,001 → 201,001"
    fewer = RULES.model_copy(update={"tiers": RULES.tiers.model_copy(update={"bands": list(RULES.tiers.bands[:5])})})
    assert describe(RULES, fewer) == "tiers.bands 6 bands → 5 bands"
