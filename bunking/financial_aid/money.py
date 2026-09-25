"""Whole-dollar money arithmetic for financial aid.

Every award rounds HALF AWAY FROM ZERO, which is what the spreadsheet's
ROUND(x, 0) did. Python's ``round()`` and Decimal's default context use banker's
rounding (half to even), which under-awards $1 whenever an amount lands on
exactly .50 over an even dollar -- 59 rows of the 2026 sheet do.
"""

from __future__ import annotations

from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

ZERO = Decimal(0)
ONE = Decimal(1)
HUNDRED = Decimal(100)


def round_dollars(value: Decimal) -> Decimal:
    """Round to whole dollars, half away from zero."""
    return value.quantize(ONE, rounding=ROUND_HALF_UP)


def floor_dollars(value: Decimal) -> Decimal:
    """Whole dollars, never rounding up. For caps that must not be exceeded."""
    return value.quantize(ONE, rounding=ROUND_FLOOR)


def pct_of(pct: Decimal, amount: Decimal) -> Decimal:
    """``pct`` percentage points of ``amount``, unrounded (42.5 means 42.5%)."""
    return pct * amount / HUNDRED


def zero_if_blank(value: Decimal | None) -> Decimal:
    """An intake figure where a blank legitimately means none: expenses and savings.

    Never use this for income. An absent income figure is unknown, not 0 (spec
    principle 5); the income module reports it as missing instead.
    """
    return ZERO if value is None else value
