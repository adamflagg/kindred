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


def to_money(value: Decimal | int | str | None) -> Decimal:
    """An intake figure as Decimal. Absent counts as zero, as the sheet's blank cells did."""
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(value)
