"""A request's rounds as of a past date, from dated records only (campership 3c-1; spec §7.2, §7.3;
D48, D63).

Every aid_decisions and aid_hold_events row is dated, so each round's Posted tick with its locked
amount, its Accepted tick, its asks and the request's holds fold exactly for any past instant.
3c-1 prices nothing:

  posted       the lock as it stood then: its amount, its pool and budget treatment from the lock's
               snapshot, and the decision type's own money inside it (`extra`), as live reads it;
  not_rebuilt  every other round a live request had: its ask, and nothing decided.

A request that wasn't live then (withdrawn, duplicate) shows only its posted rounds, as live does.
3c-2 prices these rounds from the change log; figures left empty are named in PAST_DATE_GAPS.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
from typing import Final

from bunking.financial_aid.calculator import ApplicationInputs
from bunking.financial_aid.decisions.holds import NO_HOLDS, HoldState
from bunking.financial_aid.decisions.pricing import (
    PricedRequest,
    RoundView,
    named_decision,
    posted_view,
    round_exists,
)
from bunking.financial_aid.decisions.rounds import ROUNDS, RoundState
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules.schema import AidRules, DecisionType

_PRICED: Final = (
    "Priced from the family's answers as they stood then; this read rebuilds dated records only "
    "(the rebuilt pricing is the next PR, 3c-2)"
)
_PLACED: Final = (
    "Grant lines carry their own dates (recorded_on, recorded_at, reversal_date), but which "
    "request, and so which pool, a line sits on is today's placement"
)
PAST_DATE_GAPS: Final[Mapping[str, str]] = {
    "decided": _PRICED,
    "pending_approval": "It counts only while no hold covers the request, and the data checks are priced (3c-2)",
    "would_change_by": _PRICED,
    "tier": _PRICED,
    "cost": _PRICED,
    "total_decided": _PRICED,
    "holds": "Only the manual hold is listed: the data checks run on the family's answers (3c-2)",
    "notes": _PRICED,
    "needs_offer": _PRICED,
    "held": _PRICED,
    "remaining": "Remaining subtracts Needs an offer and Pending approval",
    "held_asked": _PRICED,
    "outside_grants_off_requests": _PLACED,
    "round2_asks": "A request's status on that date can't be replayed, so Round 2 asks aren't counted season-wide",
    "round2_asked": "A request's status on that date can't be replayed, so Round 2 asks aren't counted season-wide",
    "outside_grants": _PLACED,
    "outside_budget": "It includes decided money not yet posted; the posted part is outside_budget_posted",
    "round2_computed": _PRICED,
    "round1_unmet": _PRICED,
    "pool_unknown": "The request's session and program couldn't be resolved under the rules as of that date, so it sits in No pool",
    "request_history": "These requests' change history can't be replayed to that date, so only their posted rounds show",
    "request_deleted": "Deleted since; its history can't be replayed, so it isn't shown",
    "rules_history": "The rules' change history for this season can't be replayed to that date",
}
GRID_GAPS: Final[tuple[str, ...]] = (
    "decided",
    "pending_approval",
    "would_change_by",
    "tier",
    "cost",
    "total_decided",
    "holds",
    "notes",
)
BUDGET_GAPS: Final[tuple[str, ...]] = (
    "needs_offer",
    "pending_approval",
    "held",
    "remaining",
    "outside_grants",
    "outside_budget",
    "held_asked",
    "outside_grants_off_requests",
    "round2_computed",
    "round1_unmet",
)
REMAINING_GAPS: Final[tuple[str, ...]] = ("remaining",)


def _view(
    n: int, state: RoundState, decision: DecisionType | None, r1_ask: Decimal | None, pool: str | None
) -> RoundView:
    ask = r1_ask if n == 1 else state.ask
    if state.posted:
        return posted_view(state, decision, ask, pool)
    counts = decision.counts_toward_budget if decision is not None and decision.round == n else True
    return RoundView(
        round=n,
        status="not_rebuilt",
        ask=ask,
        decided=None,
        locked=None,
        accepted=False,
        pending=None,
        would_change_by=None,
        counts_toward_budget=counts,
        pool=pool,
        extra=ZERO,
    )


def price_as_of(
    request_id: str,
    household_cm_id: int,
    rounds: Mapping[int, RoundState],
    rules: AidRules | None,
    *,
    live: bool,
    r1_ask: Decimal | None,
    hold: HoldState = NO_HOLDS,
    pool: str | None = None,
    program_key: str | None = None,
) -> PricedRequest:
    """One request as of a past instant, from its rounds and holds folded to it. `live` is its status
    then; `r1_ask` its Round 1 ask then (replayed and corrected); `rules` the version that priced the
    season then (it names the decision type whose money counts outside the budget); `pool` the request's
    home pool then, resolved by the caller from its session and program (None: unknown, so NO_POOL;
    see PAST_DATE_GAPS["pool_unknown"]); `program_key` the program it resolved to. A posted round keeps its lock's own pool."""
    states = {n: rounds.get(n, RoundState(round=n)) for n in ROUNDS}
    decision = named_decision(rounds, rules) if rules is not None else None
    views = tuple(
        _view(n, states[n], decision, r1_ask, pool)
        for n in ROUNDS
        if round_exists(states[n]) and (states[n].posted or live)
    )
    manual = hold.manual_issue() if live else None  # live lists a request's holds only while it is live
    return PricedRequest(
        request_id=request_id,
        household_cm_id=household_cm_id,
        live=live,
        program_key=program_key,
        pool=pool,
        rounds=views,
        holds=(manual,) if manual is not None else (),
        notes=(),
        application=ApplicationInputs(household_cm_id=household_cm_id),
        inputs=None,
        result=None,
        decision_round=decision.round if decision is not None else None,
    )
