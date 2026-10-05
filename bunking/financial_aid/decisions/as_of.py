"""A request's rounds as of a past date, from dated records only (campership 3c-1; spec §7.2, §7.3;
D48, D63).

Every aid_decisions and aid_hold_events row is dated, so each round's Posted tick with its locked
amount, its Accepted tick, its asks and the request's holds fold exactly for any past instant.
3c-1 prices nothing:

  posted       the lock as it stood then: its amount, its pool and budget treatment from the lock's
               snapshot, and the decision type's own money inside it (`extra`), as live reads it;
  not_rebuilt  every other round a live request had: its ask, and nothing decided.

A request that wasn't live then (withdrawn, duplicate) shows only its posted rounds, as live does.
3c-2 prices past dates from the change log; this module keeps the rounds of a request a gap reaches (the
service's _PRICING_GAPS), and names what each gap leaves empty (PAST_DATE_GAPS).

The fold is not the whole past Posted figure: the decisions service then applies sub-project 10b's
clawback as of the date (D54), so a posted round whose money CampMinder had reversed by then counts
nowhere on a request cancelled or closed by then (clawback_eligible), and where a request's payer shares or line placements can't be replayed its posted money is
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
    named_decision_key,
    posted_view,
    round_exists,
)
from bunking.financial_aid.decisions.rounds import ROUNDS, RoundState
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules.schema import AidRules, DecisionType

_ROUND2: Final = (
    "Some requests' status on that date can't be replayed (see request_history), so Round 2 asks "
    "aren't counted season-wide"
)
# What a pool-masking gap empties (past_budget's _past_pool, and the season's total and strip with it).
_POOL_EMPTY: Final = (
    "; its pool's Needs an offer, Pending approval, Remaining, Held and the Held asks, outside grants, outside "
    "the budget and computed demand (Round 2 computed, Round 1 unmet) stay empty, and so do the total's and the "
    "strip's Needs an offer, Pending approval and Held"
)
_CANCELLED: Final = (
    "CampMinder keeps only each registration's current status, dated (its enrollment date), so a past date "
    "reads CampMinder's cancellation by that status date. A request live then whose registration CampMinder had cancelled on "
    "or before that day, by that status date, can't be priced as live: only its posted rounds, asks and "
    "manual hold show" + _POOL_EMPTY + ". A registration whose status changed after that day (re-enrolled, "
    "back to waitlisted or applied, cancelled again later, which re-dates it, or removed from CampMinder) "
    "reads by today's status, so its request is priced and counted as live then. A request CampMinder had "
    "cancelled by that day is left out of Round 2 asks so far, as today's read leaves it out"
)
_TO_REVERSE: Final = (
    "To reverse is cancelled, withdrawn or duplicate money still live in CampMinder's ledger, and a past date doesn't "
    "read the ledger, so it can't be rebuilt"
)


PAST_DATE_GAPS: Final[Mapping[str, str]] = {
    "confirmation": "When the ledger synced that day isn't known, so awaiting sync versus confirmed can't be rebuilt",
    "unconfirmed": (
        "How much of Posted the ledger had confirmed by that date isn't rebuilt: when each ledger sync ran, and "
        "which CampMinder lines it had read then, aren't recorded by date"
    ),
    "awaiting_sync": "Which ticks were awaiting a ledger sync on that date isn't rebuilt (see unconfirmed)",
    "not_reconciled": "Which posted rounds the ledger hadn't confirmed on that date isn't rebuilt (see unconfirmed)",
    "cancellation": _CANCELLED,
    "to_reverse": _TO_REVERSE,
    "queues": "Which Requests views a row is in reads its confirmation and cancellation",
    "unticked": "Why CampMinder's money for a round has no Posted tick reads the overnight tick, which a past date "
    "doesn't rebuild",
    "cm_pending": "Whether a round's CampMinder check was pending (a hand tick awaiting that night's sync, or money the "
    "overnight tick would post) reads the ledger's sync time and the overnight tick, which a past date doesn't rebuild",
    "cm_pending_message": "A pending round's CampMinder line is left empty with whether it was pending",
    "round2_asks": _ROUND2,
    "round2_asked": _ROUND2,
    "pool_unknown": "The request's session and program couldn't be resolved under the rules as of that date, so it sits in No pool",
    "request_history": (
        "These requests' change history can't be replayed to that date, so only their posted rounds show, and "
        "every pool's Needs an offer, Pending approval, Remaining, Held and the Held asks, outside grants, outside "
        "the budget and computed demand (Round 2 computed, Round 1 unmet) stay empty, as do the total's and the "
        "strip's Needs an offer, Pending approval and Held, and Round 2 asks so far (round2_asks); their Included "
        "and to-dos stay empty with their status"
    ),
    "request_deleted": (
        "Deleted since; its history can't be replayed, so it isn't shown, and every pool's Needs an offer, "
        "Pending approval, Remaining, Held and the Held asks, outside grants, outside the budget and computed "
        "demand (Round 2 computed, Round 1 unmet) stay empty, as do the total's and the strip's Needs an offer, "
        "Pending approval and Held"
    ),
    "posted_before_request": "Posted in CampMinder by this date, but the request was recorded in the dashboard after it",
    "rules_history": (
        "The rules' change history for this season can't be replayed to that date, so nothing is priced: only "
        "posted rounds show"
    ),
    "application_history": (
        "The family's application answers can't be replayed to that date, so this request's pricing then can't "
        "be rebuilt: only its posted rounds, asks and manual hold show" + _POOL_EMPTY
    ),
    "pricing_shares_history": (
        "The request's payer shares can't be replayed to that date, so its pricing then can't be rebuilt: only "
        "its posted rounds, asks and manual hold show" + _POOL_EMPTY
    ),
    "equity_not_recorded": (
        "The camper's equity answers weren't recorded by then (intake records them from 3c-2 on), so its "
        "pricing then can't be rebuilt: only its posted rounds, asks and manual hold show" + _POOL_EMPTY
    ),
    "grant_placement": (
        "The family had a grant by then whose placement on a request wasn't logged by then (grant placement is "
        "logged from 3c-2 on), so its requests show their tier, cost, posted rounds, asks and manual hold only"
        + _POOL_EMPTY
        + ", and so does money on no request. A grant line CampMinder deleted before the log began can't be seen"
    ),
    "appeal_refusal": "Whether an appeal can be keyed now; nothing is keyed into a past date",
    "ledger_classification": (
        "Which CampMinder lines count as the camp's own aid (a line's funder-type reclassification) and Go's "
        "session attribution are read as they are today, not as of that date"
    ),
    "posted": (
        "Posted, as a request's round and in the budget's cells and strip counts, is left empty where a "
        "request's payer shares or line placements can't be replayed (see payer_shares_history and "
        "line_placements_history); the row's Notes are left empty with it (its ledger Note can't be built)"
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
# Named on every past read: what 3c-2 can't price from dated records (the ledger's sync time, and
# CampMinder's cancellations, whose earlier statuses are overwritten, 10b-2 Decision 21; cancellation lists
# the requests it keeps unpriced). A gap request names what it empties itself.
GRID_GAPS: Final[tuple[str, ...]] = (
    "confirmation",
    "cancellation",
    "to_reverse",
    "queues",
    "unticked",
    "appeal_refusal",
    "cm_pending",
    "cm_pending_message",
)
# A past budget never rebuilds the ledger figures either (no ledger is read for a past day).
BUDGET_GAPS: Final[tuple[str, ...]] = ("cancellation", "unconfirmed", "awaiting_sync", "not_reconciled")
REMAINING_GAPS: Final[tuple[str, ...]] = ("cancellation",)
# Named only when a past read empties them (a request's posted money can't be replayed): not always-on.
POSTED_GAPS: Final[tuple[str, ...]] = ("posted", "accepted", "outside_budget_posted")


def _view(
    n: int,
    state: RoundState,
    decision: DecisionType | None,
    r1_ask: Decimal | None,
    pool: str | None,
    decision_key: str | None = None,
) -> RoundView:
    ask = r1_ask if n == 1 else state.ask
    if state.posted:
        return posted_view(state, decision, ask, pool, decision_key=decision_key)
    counts = decision.counts_toward_budget if decision is not None and decision.round == n else True
    return RoundView(
        round=n,
        status="not_rebuilt",
        ask=ask,
        decided=None,
        locked=None,
        accepted=False,
        pending=None,
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
    decision_key = named_decision_key(rounds) if decision is not None else None
    views = tuple(
        _view(n, states[n], decision, r1_ask, pool, decision_key)
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
