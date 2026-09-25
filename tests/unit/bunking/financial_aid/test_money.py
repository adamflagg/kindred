"""Whole-dollar money arithmetic. Half-up is the point: banker's rounding under-awards $1."""

from decimal import ROUND_HALF_EVEN, Decimal

import pytest

from bunking.financial_aid.money import floor_dollars, pct_of, round_dollars, zero_if_blank


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("604.5"), Decimal(605)),
        (Decimal("605.5"), Decimal(606)),
        (Decimal("604.49"), Decimal(604)),
        (Decimal("-2.5"), Decimal(-3)),
        (Decimal("0.5"), Decimal(1)),
        (Decimal(12), Decimal(12)),
    ],
)
def test_round_dollars_is_half_away_from_zero(value: Decimal, expected: Decimal) -> None:
    assert round_dollars(value) == expected


def test_half_up_differs_from_bankers_rounding_on_an_even_dollar() -> None:
    # The whole reason for the helper: 604.5 goes to 604 under ROUND_HALF_EVEN.
    assert Decimal("604.5").quantize(Decimal(1), rounding=ROUND_HALF_EVEN) == Decimal(604)
    assert round_dollars(Decimal("604.5")) == Decimal(605)


def test_floor_dollars_never_rounds_up() -> None:
    assert floor_dollars(Decimal("200.99")) == Decimal(200)
    assert floor_dollars(Decimal(200)) == Decimal(200)


def test_pct_of_is_percentage_points_and_unrounded() -> None:
    assert pct_of(Decimal(15), Decimal(4030)) == Decimal("604.5")
    assert pct_of(Decimal(100), Decimal(4000)) == Decimal(4000)
    assert pct_of(Decimal(0), Decimal(4000)) == Decimal(0)


def test_zero_if_blank_is_for_figures_where_blank_means_none() -> None:
    # Expenses and savings only: a blank there means the family has none. Income never
    # goes through this helper -- an absent income figure is unknown, not 0 (C1).
    assert zero_if_blank(None) == Decimal(0)
    assert zero_if_blank(Decimal(3)) == Decimal(3)
