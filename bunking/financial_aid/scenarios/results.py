"""A scenario's results (sub-project 9b; spec §7.4, §5.3; the mock's strip, Compare and Trail). Pure: from the
priced season and its budget, exactly as sub-project 10a's Rounds & budget computes them.

  Round n            Posted + Needs an offer + Pending approval for round n: the money §5.3's Remaining
                     subtracts from round n's allocation. Round 2 is only the Round 2 asks keyed so far; there is
                     no appeal estimate (Decision 10).
  Round 1 remaining  the total row's Round 1 Remaining: the pools' allocations less every Round 1 dollar (what Fit
                     to budget fits, Decision 11 (a)); Remaining is every round's.
  At the minimum     live requests whose Round 1, not yet posted, is the minimum award (the calculator's r1_bound).
  By tier            each final tier's live requests, families and Round 1, counted exactly as the budget counts
                     Round 1 (a posted Round 1 at its lock; a clawed-back round, or one whose decision type is
                     outside the budget, in no tier). `asked` waits for SP9c (RPT-17).
  Not in tiers       Round 1 money the budget counts on a request with no tier: a withdrawn request's posted round
                     (only live requests are priced into a tier) or a live one priced without a final tier. The tier
                     rows plus this are Round 1 (final review 2).
  Held               requests with a held round and their asks: below the line, never counted.
  Round 1 unmet      §5.9's "Round 1 unmet ask, not yet appealed" (SP10a's demand.round1_unmet): below the line,
                     never subtracted -- the forward signal for sizing Round 2 (plan Decision 10 (b), RULED
                     2026-09-30).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from bunking.financial_aid.decisions import Cell, PoolBudget, PricedRequest, RoundView, SeasonBudget
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.scenarios.request_set import RequestSetNote


class _Result(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class TierRow(_Result):
    tier: int
    requests: int
    families: int
    round1: Decimal
    # SP9c (RPT-17's by-tier compare) fills it with the tier's Round 1 asks; None until then. Defaulted so kept
    # options stored by SP9b still load.
    asked: Decimal | None = None


class PoolResult(_Result):
    pool: str
    label: str
    round1: Decimal
    round2: Decimal
    round3: Decimal
    round1_allocated: Decimal | None
    round1_remaining: Decimal | None
    remaining: Decimal | None
    round1_unmet: Decimal  # below the line


class ScenarioResults(_Result):
    requests: int
    families: int
    round1: Decimal
    round2: Decimal
    round3: Decimal
    round1_allocated: Decimal | None
    round1_remaining: Decimal | None
    remaining: Decimal | None
    at_minimum: int
    held: int
    held_asked: Decimal
    round1_unmet: Decimal  # below the line: §5.9, the forward signal for Round 2 (Decision 10 (b), RULED 2026-09-30)
    pools: list[PoolResult]
    by_tier: list[TierRow]
    # Round 1 the budget counts on requests in no tier (a withdrawn request's posted round): by_tier + this = round1.
    # Defaulted so kept options stored before it still load.
    not_in_tiers: Decimal = ZERO
    # The request set these figures were priced on (D138); None: every frozen request. Kept options and trail rows
    # always store None: a request set is a view setting, applied when a figure is read.
    request_set: RequestSetNote | None = None


@dataclass
class _Tier:
    requests: set[str] = field(default_factory=set)
    families: set[int] = field(default_factory=set)
    round1: Decimal = ZERO


def _spent(cell: Cell) -> Decimal:
    return cell.posted + cell.needs_offer + cell.pending_approval


def round1_amount(priced: PricedRequest) -> Decimal | None:
    """A request's Round 1: its locked amount once posted, its decided amount while it needs an offer, else None."""
    view = priced.view(1)
    if view is None:
        return None
    if view.status == "posted":
        return view.locked
    if view.status == "needs_offer":
        return view.decided
    return None


def round1_by_request(priced: Iterable[PricedRequest]) -> dict[str, Decimal]:
    return {p.request_id: amount for p in priced if p.live and (amount := round1_amount(p)) is not None}


def up_down(reference: Mapping[str, Decimal], other: Mapping[str, Decimal]) -> tuple[int, int]:
    """Requests whose Round 1 is higher / lower in `other` than in `reference`. A request priced on one side only
    (held on the other) counts in neither."""
    shared = reference.keys() & other.keys()
    return sum(1 for r in shared if other[r] > reference[r]), sum(1 for r in shared if other[r] < reference[r])


def _pool(pool: PoolBudget) -> PoolResult:
    return PoolResult(
        pool=pool.pool,
        label=pool.label,
        round1=_spent(pool.rounds[1]),
        round2=_spent(pool.rounds[2]),
        round3=_spent(pool.rounds[3]),
        round1_allocated=pool.rounds[1].allocated,
        round1_remaining=pool.rounds[1].remaining,
        remaining=pool.total.remaining,
        round1_unmet=pool.demand.round1_unmet,
    )


def _counted_round1(view: RoundView) -> Decimal | None:
    """A Round 1 view's money exactly as the budget's Round 1 counts it (budget._tally_round): Posted, Needs an offer
    and Pending approval of a type that counts toward the budget; a clawed-back round counts nowhere (D54)."""
    if not view.counts_toward_budget:
        return None
    if view.status == "posted":
        return None if view.clawed_back else (view.locked or ZERO)
    if view.status == "needs_offer":
        return view.decided or ZERO
    if view.status == "pending_approval":
        return view.pending or ZERO
    return None


def scenario_results(
    priced: Iterable[PricedRequest], budget: SeasonBudget, *, request_set: RequestSetNote | None = None
) -> ScenarioResults:
    every = list(priced)
    live = [p for p in every if p.live]
    tiers: dict[int, _Tier] = defaultdict(_Tier)
    not_in_tiers = ZERO
    at_minimum = 0
    for p in live:
        view = p.view(1)
        if (
            view is not None
            and view.status == "needs_offer"
            and p.result is not None
            and p.result.r1_bound == "minimum"
        ):
            at_minimum += 1
    for p in every:
        view = p.view(1)
        amount = _counted_round1(view) if view is not None else None
        if amount is None:
            continue
        if not p.live or p.result is None or p.result.final_tier is None:
            not_in_tiers += amount
            continue
        tier = tiers[p.result.final_tier]
        tier.requests.add(p.request_id)
        tier.families.add(p.household_cm_id)
        tier.round1 += amount
    total = budget.total
    return ScenarioResults(
        requests=len(live),
        families=len({p.household_cm_id for p in live}),
        round1=_spent(total.rounds[1]),
        round2=_spent(total.rounds[2]),
        round3=_spent(total.rounds[3]),
        round1_allocated=total.rounds[1].allocated,
        round1_remaining=total.rounds[1].remaining,
        remaining=total.total.remaining,
        at_minimum=at_minimum,
        held=total.below.held.requests,
        held_asked=total.below.held_asked,
        round1_unmet=total.demand.round1_unmet,
        pools=[_pool(pool) for pool in budget.pools],
        by_tier=[
            TierRow(tier=n, requests=len(t.requests), families=len(t.families), round1=t.round1)
            for n, t in sorted(tiers.items())
        ],
        not_in_tiers=not_in_tiers,
        request_set=request_set,
    )
