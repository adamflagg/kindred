"""Fit to budget (sub-project 9b; spec §7.4; main spec §12.3 method 1, "shift every tier by the same number of
points"). Pure, over an injected pricing call.

The largest shift, on a half-point grid from FIT_LOW to FIT_HIGH, whose margin (`fit_margin`: the total row's Round 1
Remaining, money on a program with no pool included) is still >= 0 (plan Decision 11 (a), RULED 2026-09-30, D119). A higher
percentage never lowers a Round 1 (the minimum and the ask cap only flatten it), so Remaining falls as the shift
rises and a bisection finds the edge in about ten pricings. When even FIT_LOW is over, or even FIT_HIGH stays
within it, it says so (§12.3: an infeasible target is explained, never a silent failure).

The margin is Round 1's: Round 2 and 3 money already committed is left in the margin; nothing is held back. Pools are
guidance and only the total is hard (D119), so one pool may end below zero while another has money left;
`tightest_pool` names the pool with the least Round 1 Remaining, as information only.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Final, Literal

from bunking.financial_aid.scenarios.results import PoolResult, ScenarioResults

FIT_LOW: Final = Decimal(-100)
FIT_HIGH: Final = Decimal(100)
FIT_STEP: Final = Decimal("0.5")

FitKind = Literal["fits", "over_at_lowest", "under_at_highest"]


@dataclass(frozen=True)
class FitResult:
    shift: Decimal
    remaining: Decimal
    kind: FitKind
    tried: int  # how many shifts were priced


async def fit_tier_shift(
    remaining_at: Callable[[Decimal], Awaitable[Decimal]],
    *,
    low: Decimal = FIT_LOW,
    high: Decimal = FIT_HIGH,
    step: Decimal = FIT_STEP,
) -> FitResult:
    if step <= 0 or high <= low or low % step or high % step:  # both ends on the grid, or int() below truncates
        raise ValueError(f"the fit range {low}..{high} by {step} is not a grid")
    seen: dict[int, Decimal] = {}

    async def at(index: int) -> Decimal:
        if index not in seen:
            seen[index] = await remaining_at(step * index)
        return seen[index]

    lo, hi = int(low / step), int(high / step)
    if await at(lo) < 0:
        return FitResult(low, seen[lo], "over_at_lowest", len(seen))
    if await at(hi) >= 0:
        return FitResult(high, seen[hi], "under_at_highest", len(seen))
    while hi - lo > 1:
        middle = (lo + hi) // 2
        if await at(middle) >= 0:
            lo = middle
        else:
            hi = middle
    return FitResult(step * lo, seen[lo], "fits", len(seen))


def fit_margin(results: ScenarioResults) -> Decimal:
    """What Fit to budget keeps >= 0: the pools' Round 1 allocations summed, less every Round 1 dollar (money on a
    program with no pool included: it has no allocation of its own, but it spends the budget)."""
    if results.round1_remaining is None:
        raise ValueError("these rules give Round 1 no allocation")
    return results.round1_remaining


def tightest_pool(results: ScenarioResults) -> PoolResult | None:
    """The pool with the least Round 1 Remaining (information only, never a limit); None when no pool has a Round 1
    allocation. Ties go to the first pool in the rules' order."""
    tightest: PoolResult | None = None
    for pool in results.pools:
        if pool.round1_remaining is None:
            continue
        if tightest is None or tightest.round1_remaining is None or pool.round1_remaining < tightest.round1_remaining:
            tightest = pool
    return tightest
