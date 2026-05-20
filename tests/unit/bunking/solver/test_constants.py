"""Tests for solver-domain hardcoded constants in ``bunking.solver.constants``."""

from __future__ import annotations


def test_max_age_spread_months_is_24() -> None:
    from bunking.solver.constants import MAX_AGE_SPREAD_MONTHS

    assert MAX_AGE_SPREAD_MONTHS == 24


def test_preferred_age_spread_months_is_18() -> None:
    from bunking.solver.constants import PREFERRED_AGE_SPREAD_MONTHS

    assert PREFERRED_AGE_SPREAD_MONTHS == 18


def test_preferred_strictly_less_than_max() -> None:
    from bunking.solver.constants import (
        MAX_AGE_SPREAD_MONTHS,
        PREFERRED_AGE_SPREAD_MONTHS,
    )

    assert 0 < PREFERRED_AGE_SPREAD_MONTHS < MAX_AGE_SPREAD_MONTHS
