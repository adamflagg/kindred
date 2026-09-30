"""Fit to budget (sub-project 9b; main spec §12.3 method 1): the largest half-point shift whose margin is still
>= 0, a plain answer when no shift in range fits, and the margin itself -- the total row's Round 1 Remaining,
with the tightest pool named as information only (plan Decision 11 (a), RULED 2026-09-30; D119)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal

import pytest

from bunking.financial_aid.scenarios import (
    FIT_HIGH,
    FIT_LOW,
    PoolResult,
    ScenarioResults,
    fit_margin,
    fit_tier_shift,
    tightest_pool,
)


def _results(pools: list[tuple[str, str | None]], total: str | None = "10") -> ScenarioResults:
    """Pools as (key, Round 1 remaining); None = the pool has no Round 1 allocation (the "No pool" line)."""
    zero = Decimal(0)
    return ScenarioResults(
        requests=0,
        families=0,
        round1=zero,
        round2=zero,
        round3=zero,
        round1_allocated=None,
        round1_remaining=None if total is None else Decimal(total),
        remaining=None,
        at_minimum=0,
        held=0,
        held_asked=zero,
        round1_unmet=zero,
        pools=[
            PoolResult(
                pool=key,
                label=key or "No pool",
                round1=zero,
                round2=zero,
                round3=zero,
                round1_allocated=None if left is None else Decimal(1000),
                round1_remaining=None if left is None else Decimal(left),
                remaining=None,
                round1_unmet=zero,
            )
            for key, left in pools
        ],
        by_tier=[],
    )


def test_fit_keeps_the_pools_summed_round1_remaining_so_a_surplus_offsets_an_overspend() -> None:
    # The total row's Round 1 Remaining, not the pools' remainings added up: the "No pool" line's 40 has no allocation
    # of its own but spends the budget, so the total (-150) is below the pools' sum (-110).
    results = _results([("camp_pool", "-560"), ("weekend_pool", "450"), ("", None)], total="-150")
    assert fit_margin(results) == Decimal(-150)


def test_the_tightest_pool_is_named_as_information_only() -> None:
    tightest = tightest_pool(_results([("camp_pool", "-560"), ("weekend_pool", "450"), ("", None)], total="-110"))
    assert tightest is not None
    assert (tightest.pool, tightest.round1_remaining) == ("camp_pool", Decimal(-560))
    assert tightest_pool(_results([("", None)], total=None)) is None


def test_with_no_round1_allocation_there_is_nothing_to_fit() -> None:
    with pytest.raises(ValueError, match="no allocation"):
        fit_margin(_results([("", None)], total=None))


def _remaining(f: Callable[[Decimal], Decimal]) -> Callable[[Decimal], Awaitable[Decimal]]:
    async def at(shift: Decimal) -> Decimal:
        return f(shift)

    return at


@pytest.mark.asyncio
async def test_it_finds_the_largest_shift_that_still_fits() -> None:
    found = await fit_tier_shift(_remaining(lambda s: Decimal(1000) - 100 * s))
    assert (found.kind, found.shift, found.remaining) == ("fits", Decimal(10), Decimal(0))
    assert found.tried <= 12


@pytest.mark.asyncio
async def test_it_lands_on_the_half_point_grid() -> None:
    found = await fit_tier_shift(_remaining(lambda s: Decimal(50) - 100 * s))
    assert (found.kind, found.shift) == ("fits", Decimal("0.5"))


@pytest.mark.asyncio
async def test_it_says_when_even_the_lowest_shift_is_over() -> None:
    found = await fit_tier_shift(_remaining(lambda s: Decimal(-1)))
    assert (found.kind, found.shift) == ("over_at_lowest", FIT_LOW)


@pytest.mark.asyncio
async def test_it_says_when_even_the_highest_shift_leaves_money() -> None:
    found = await fit_tier_shift(_remaining(lambda s: Decimal(1)))
    assert (found.kind, found.shift) == ("under_at_highest", FIT_HIGH)


@pytest.mark.asyncio
async def test_a_bad_range_is_refused() -> None:
    with pytest.raises(ValueError):
        await fit_tier_shift(_remaining(lambda s: Decimal(0)), low=Decimal(1), high=Decimal(1))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("low", "high"),
    [(Decimal("-99.75"), Decimal("100.25")), (Decimal(-100), Decimal("99.9")), (Decimal("0.25"), Decimal("10.25"))],
)
async def test_a_range_whose_ends_are_off_the_grid_is_refused(low: Decimal, high: Decimal) -> None:
    with pytest.raises(ValueError, match="not a grid"):
        await fit_tier_shift(_remaining(lambda s: Decimal(0)), low=low, high=high)
