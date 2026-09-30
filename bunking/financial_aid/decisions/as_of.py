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

The fold is not the whole past Posted figure: the decisions service then applies sub-project 10b's
clawback as of the date (D54), so a posted round whose money CampMinder had reversed by then counts
nowhere, and where a request's payer shares or line placements can't be replayed its posted money is
left empty and named (POSTED_GAPS).
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
_ROUND2: Final = (
    "Some requests' status on that date can't be replayed (see request_history), so Round 2 asks "
    "aren't counted season-wide"
)
_CANCELLED: Final = (
    "A cancellation in Kindred applies as of the date, but CampMinder's aren't rebuilt: registration statuses are "
    "read as they are today, so a request CampMinder had cancelled by then shows its rounds as if live (10b-2)"
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
    "confirmation": "When the ledger synced that day isn't known, so awaiting sync versus confirmed can't be rebuilt",
    "cancellation": _CANCELLED,
    "to_reverse": _CANCELLED,
    "todos": _CANCELLED,
    "needs_offer": _PRICED,
    "held": _PRICED,
    "remaining": "Remaining subtracts Needs an offer and Pending approval",
    "held_asked": _PRICED,
    "outside_grants_off_requests": _PLACED,
    "round2_asks": _ROUND2,
    "round2_asked": _ROUND2,
    "outside_grants": _PLACED,
    "outside_budget": "It includes decided money not yet posted; the posted part is outside_budget_posted",
    "round2_computed": _PRICED,
    "round1_unmet": _PRICED,
    "pool_unknown": "The request's session and program couldn't be resolved under the rules as of that date, so it sits in No pool",
    "request_history": "These requests' change history can't be replayed to that date, so only their posted rounds show",
    "request_deleted": "Deleted since; its history can't be replayed, so it isn't shown",
    "posted_before_request": "Posted in CampMinder by this date, but the request was recorded in Kindred after it",
    "rules_history": "The rules' change history for this season can't be replayed to that date",
    "ledger_classification": (
        "Which CampMinder lines count as the camp's own aid (a line's funder-type reclassification) and Go's "
        "session attribution are read as they are today, not as of that date"
    ),
    "posted": (
        "Posted, as a request's round and in the budget's cells and strip counts, is left empty where a "
        "request's payer shares or line placements can't be replayed (see payer_shares_history and "
        "line_placements_history)"
    ),
    "accepted": (
        "Accepted, in the budget's cells and strip counts, is left empty with Posted (see payer_shares_history "
        "and line_placements_history)"
    ),
    "outside_budget_posted": (
        "Posted money outside the budget is left empty with Posted (see payer_shares_history and "
        "line_placements_history)"
    ),
    "payer_shares_history": (
        "These requests' payer shares can't be replayed to that date, so whether CampMinder had reversed their "
        "posted money is unknown and it is left empty"
    ),
    "line_placements_history": (
        "The staff placements of some CampMinder lines can't be replayed to that date, so whether CampMinder "
        "had reversed these requests' posted money is unknown and it is left empty"
    ),
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
    "confirmation",
    "cancellation",
    "to_reverse",
    "todos",
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
# Named only when a past read empties them (a request's posted money can't be replayed): not always-on.
POSTED_GAPS: Final[tuple[str, ...]] = ("posted", "accepted", "outside_budget_posted")


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
    season then (it names the decision type, whose whole round sits outside the budget when it does not count); `pool` the request's
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
