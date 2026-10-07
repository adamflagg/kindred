"""A request's rounds priced now (campership sub-project 10a; spec §5.1–§5.3, §7.1; D41–D43, D52, D79).

Decided is worked out on every read and never stored before the lock (D41). The calculator prices
the request under the season's approved rules, with every posted round held at the amount it
locked at (D43). Each round that exists gets one state:

  posted            ticked Posted (D51, D52): its locked amount, whatever it would be now;
  held              a hold not yet released, or the request can't be priced (a figure missing, no
                    approved rules, no session): the amount is unknown (D44);
  pending_approval  a Round 3 amount above the registrar's limit awaiting finance (D79);
  refused           finance refused the Round 3 amount, and nothing else is on the round;
  not_decided       a Round 3 ask with no amount keyed yet;
  needs_offer       decided and not posted: money spoken for (D44);
  not_rebuilt       a past date's round whose state isn't rebuilt (as_of.py).

A posted round is history (D43): it reads as its lock recorded it, and a later change flows into the next round.
There is no "would change by" figure on it (owner 2026-10-05).

Outside grants reach the calculator only as the grants register's bridge built them
(`grant_inputs_by_request`). An incentive is never a GrantInput (D88: it stays an outside
funder), and the rules no longer price incentives at all (culled, §9.9): it posts in CampMinder.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Final, Literal

from bunking.financial_aid.calculator import (
    ApplicationInputs,
    CalcIssue,
    CalcResult,
    GrantInput,
    RequestInputs,
    calculate,
)
from bunking.financial_aid.decisions.rounds import ROUNDS, RoundState
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules.schema import AidRules, DecisionType

RoundStatus = Literal["posted", "held", "pending_approval", "refused", "not_decided", "needs_offer", "not_rebuilt"]
# The pricing stop while no rules version is approved (main spec §10.5); holds.py keys its release text on it
# and Today names it beside intake's own flag.
NO_APPROVED_RULES: Final = "no_approved_rules"
# A result that cannot be priced stops the award like a hold does, and no release lifts it.
_UNPRICEABLE: Final = frozenset({"needs_input", "error"})


@dataclass(frozen=True)
class RequestToPrice:
    """One request as the service read it.

    `live` is an active or unmatched request, which casework can still decide. A withdrawn,
    duplicate or duplicate-pending request is not live: only its posted rounds count (Decision 13).
    `request` is None when it can't be priced (`blocked` says why); `r1_ask` is its Round 1 ask
    either way (aid_requests.ask, as corrected). `released_holds` names the hold codes staff have
    released (`with_holds` in holds.py fills it from the request's hold events).
    """

    request_id: str
    household_cm_id: int
    live: bool
    application: ApplicationInputs
    request: RequestInputs | None
    blocked: str
    issues: tuple[CalcIssue, ...]
    rounds: Mapping[int, RoundState]
    r1_ask: Decimal | None
    grants: tuple[GrantInput, ...] = ()
    released_holds: frozenset[str] = frozenset()


@dataclass(frozen=True)
class RoundView:
    """One round's figures. `decided` is worked out now (a posted round's is the amount it locked);
    `locked` is the Posted amount (D59), None while not posted; `pending` is Pending approval's
    keyed amount (D79). A posted round's pool and budget treatment are those recorded at its lock.
    `extra` is the decision type's own money (top-up + discretionary) inside this round's amount. A type
    that does not `counts_toward_budget` moves the WHOLE round (base and extra) outside the budget (owner
    ruling 2026-09-30, spec §7.2); `extra` is kept as the part that is the type's own money.

    `clawed_back` is sub-project 10b's: a posted round whose money CampMinder has reversed (D54), so
    it counts nowhere."""

    round: int
    status: RoundStatus
    ask: Decimal | None
    decided: Decimal | None
    locked: Decimal | None
    accepted: bool
    pending: Decimal | None
    counts_toward_budget: bool
    pool: str | None
    extra: Decimal = Decimal(0)
    clawed_back: bool = False
    # The named decision type whose money this round carries (spec §7.2's decision-type lines; Decision 12).
    decision_type: str | None = None
    # A full-cost-after-aid round (owner 10-06): its camp award counts toward the budget as usual and only `extra`,
    # the type's remainder, sits below the line, even though the type doesn't count toward the budget.
    extra_outside: bool = False


@dataclass(frozen=True)
class PricedRequest:
    request_id: str
    household_cm_id: int
    live: bool
    program_key: str | None
    pool: str | None
    rounds: tuple[RoundView, ...]
    holds: tuple[CalcIssue, ...]
    notes: tuple[CalcIssue, ...]
    application: ApplicationInputs
    inputs: RequestInputs | None
    result: CalcResult | None
    # The round the named decision's money belongs to: a posted lock's record, else the rules'.
    decision_round: int | None = None

    def view(self, n: int) -> RoundView | None:
        return next((view for view in self.rounds if view.round == n), None)


def _states(rounds: Mapping[int, RoundState]) -> dict[int, RoundState]:
    return {n: rounds.get(n, RoundState(round=n)) for n in ROUNDS}


def _decision(states: Mapping[int, RoundState], rules: AidRules) -> tuple[str | None, DecisionType | None, Decimal]:
    """The request's named discretionary decision (the only kind sub-project 10a keys) and its amount.

    Once a posted round's lock recorded the decision's money inside it, the decision belongs to that
    round whatever the rules say now, so a rules change never moves posted money (D43)."""
    for state in states.values():
        if state.discretionary_type:
            decision = rules.awards.decision_types.get(state.discretionary_type)
            held_by = next(
                (n for n in ROUNDS if _locked_extras(states[n], decision.round if decision else None) is not None),
                None,
            )
            if decision is not None and held_by is not None and held_by != decision.round:
                decision = decision.model_copy(update={"round": held_by})
            return state.discretionary_type, decision, state.discretionary or ZERO
    return None, None, ZERO


def named_decision(rounds: Mapping[int, RoundState], rules: AidRules) -> DecisionType | None:
    """The request's named decision type, whose money `counts_toward_budget` places (spec §7.2)."""
    return _decision(_states(rounds), rules)[1]


def named_decision_key(rounds: Mapping[int, RoundState]) -> str | None:
    """The key of the request's named decision type, as keyed on its rounds (`_decision` reads the same field)."""
    return next((state.discretionary_type for state in _states(rounds).values() if state.discretionary_type), None)


def _amount(value: Any) -> Decimal:
    return Decimal(str(value)) if value is not None else ZERO


def _locked_extras(state: RoundState, rules_decision_round: int | None = None) -> tuple[Decimal, Decimal] | None:
    """The decision type's top-up and discretionary money a posted round's lock recorded inside its
    amount; None when the round is not posted or its lock recorded none (the snapshot's
    `decision_round` is another round).

    Safety net: a posted round whose snapshot predates `decision_round` (or is missing) is the round
    the current rules name for the decision, so its locked amount is the full figure: nothing is
    frozen apart from it and nothing is added on top."""
    if not state.posted:
        return None
    snapshot = state.snapshot or {}
    if "decision_round" not in snapshot:
        return (ZERO, ZERO) if rules_decision_round == state.round else None
    if snapshot["decision_round"] != state.round:
        return None
    return _amount(snapshot.get("top_up")), _amount(snapshot.get("discretionary"))


def request_inputs(item: RequestToPrice, rules: AidRules) -> RequestInputs:
    """The request with its rounds' asks and amounts, and its posted rounds held at their locked amounts. The
    decision times are this request's own locks, so a grant recorded after its Round 1 lock never lowers its Round 1
    (no single season date).

    A posted round locks its base (the locked amount less the decision money its lock recorded),
    and that decision money freezes beside it (locked_top_up, locked_discretionary). Totals are the
    full locked amounts, and the caps measure the base only, as they did before posting (2026)."""
    if item.request is None:
        raise ValueError(f"request {item.request_id} cannot be priced: {item.blocked}")
    states = _states(item.rounds)
    decision_type, decision, discretionary = _decision(states, rules)
    decision_round = decision.round if decision is not None else None

    def locked(n: int) -> Decimal | None:
        state = states[n]
        if not state.posted or state.locked_amount is None:
            return None
        extras = _locked_extras(state, decision_round)
        return state.locked_amount - sum(extras, ZERO) if extras is not None else state.locked_amount

    frozen = next(
        (extras for n in ROUNDS if (extras := _locked_extras(states[n], decision_round)) is not None),
        None,
    )

    r1, r2, r3 = states[1], states[2], states[3]
    return item.request.model_copy(
        update={
            "appeal_amount": r2.ask,
            "round2_decided": r2.ask is not None,
            "round3_amount": r3.award if r3.approval != "refused" else None,
            "round3_statement_of_need": bool(r3.statement_of_need.strip()),
            "decision_type": decision_type,
            "discretionary_amount": discretionary,
            "grants_applicable": list(item.grants),
            "incentives": [],
            "r1_decided_at": r1.locked_at if r1.posted else None,
            "r2_decided_at": r2.locked_at if r2.posted else None,
            "r1_locked": locked(1),
            "r2_locked": locked(2),
            "r3_locked": locked(3),
            "locked_top_up": frozen[0] if frozen is not None else None,
            "locked_discretionary": frozen[1] if frozen is not None else None,
        }
    )


def _worked_out(result: CalcResult, decision: DecisionType | None, n: int) -> Decimal | None:
    """Round n's amount in `result`: the round itself, plus the named decision's money when it
    belongs to this round (its top-up and any discretionary amount; spec §7.1)."""
    base = (result.r1, result.r2, result.r3)[n - 1]
    extra = (result.top_up or ZERO) + result.discretionary if decision is not None and decision.round == n else None
    if base is None:
        return extra if n > 1 else None
    return base + (extra or ZERO)


def _extra_now(result: CalcResult | None, decision: DecisionType | None, n: int) -> Decimal:
    if result is None or decision is None or decision.round != n:
        return ZERO
    return (result.top_up or ZERO) + result.discretionary


def extra_locked(state: RoundState, decision: DecisionType | None) -> Decimal:
    """The decision type's money the lock recorded inside this round (its snapshot, never the rules
    now, so a rules change can't move posted money); 0 if none."""
    extras = _locked_extras(state, decision.round if decision is not None else None)
    return sum(extras, ZERO) if extras is not None else ZERO


def round_exists(state: RoundState) -> bool:
    if state.round == 1:
        return True
    return state.posted or state.ask is not None or state.award is not None or state.discretionary is not None


def _stop(code: str, message: str) -> CalcIssue:
    return CalcIssue(code=code, severity="hold", message=message, step="decisions")


def price_request(item: RequestToPrice, rules: AidRules | None) -> PricedRequest:
    states = _states(item.rounds)
    program_key = item.request.program_key if item.request is not None else None
    program = rules.programs.get(program_key) if rules is not None and program_key is not None else None
    pool = program.budget_pool if program is not None else None
    decision = _decision(states, rules)[1] if rules is not None else None
    decision_key = named_decision_key(item.rounds) if decision is not None else None
    issues: list[CalcIssue] = []
    inputs: RequestInputs | None = None
    result: CalcResult | None = None
    if item.live:
        issues.extend(item.issues)
        if rules is None:
            issues.append(_stop(NO_APPROVED_RULES, "This season's pricing rules are not approved yet"))
        elif item.request is None:
            issues.append(_stop("not_priceable", item.blocked or "This request cannot be priced yet"))
        else:
            inputs = request_inputs(item, rules)
            result = calculate(item.application, inputs, rules)
            issues.extend(result.issues)
    holds = tuple(
        i for i in issues if i.severity in _UNPRICEABLE or (i.severity == "hold" and i.code not in item.released_holds)
    )
    notes = tuple(i for i in issues if i.severity == "warn")
    stopped = bool(holds) or result is None
    views = tuple(
        _view(n, states[n], item, decision, result, stopped=stopped, pool=pool, decision_key=decision_key)
        for n in ROUNDS
        if round_exists(states[n]) and (states[n].posted or item.live)
    )
    return PricedRequest(
        request_id=item.request_id,
        household_cm_id=item.household_cm_id,
        live=item.live,
        program_key=program_key,
        pool=pool,
        rounds=views,
        holds=holds,
        notes=notes,
        application=item.application,
        inputs=inputs,
        result=result,
        decision_round=decision.round if decision is not None else None,
    )


def _extra_outside(decision: DecisionType | None, n: int) -> bool:
    return decision is not None and decision.round == n and decision.kind == "full_cost_after_aid"


def posted_view(
    state: RoundState,
    decision: DecisionType | None,
    ask: Decimal | None,
    pool: str | None,
    *,
    decision_key: str | None = None,
) -> RoundView:
    """A posted round as its lock recorded it (D43): amount, pool and budget treatment from the
    snapshot (`pool` when it has none), and the decision's own money inside. Live and past reads share it."""
    n = state.round
    snapshot = state.snapshot or {}
    counts = decision.counts_toward_budget if decision is not None and decision.round == n else True
    locked_pool = snapshot.get("pool", pool)
    if "decision_round" in snapshot:  # the lock recorded it (lock_snapshot): it stands whatever the rules say now (D43)
        recorded = snapshot.get("decision_type")
        decision_type = recorded if snapshot.get("decision_round") == n and isinstance(recorded, str) else None
    else:  # an older lock without the record: the rules' type, as its counts_toward_budget already falls back
        decision_type = decision_key if decision is not None and decision.round == n else None
    return RoundView(
        round=n,
        status="posted",
        ask=ask,
        decided=state.locked_amount,
        locked=state.locked_amount,
        accepted=state.accepted,
        pending=None,
        counts_toward_budget=bool(snapshot.get("counts_toward_budget", counts)),
        pool=locked_pool if isinstance(locked_pool, str) else None,
        extra=extra_locked(state, decision),
        decision_type=decision_type,
        extra_outside=bool(snapshot.get("extra_outside", _extra_outside(decision, n))),
    )


def _view(
    n: int,
    state: RoundState,
    item: RequestToPrice,
    decision: DecisionType | None,
    result: CalcResult | None,
    *,
    stopped: bool,
    pool: str | None,
    decision_key: str | None = None,
) -> RoundView:
    ask = item.r1_ask if n == 1 else state.ask
    counts = decision.counts_toward_budget if decision is not None and decision.round == n else True
    if state.posted:
        return posted_view(state, decision, ask, pool, decision_key=decision_key)
    decided = _worked_out(result, decision, n) if result is not None else None
    pending = state.award if n == 3 and state.approval == "pending" else None
    if stopped or pending is not None:
        decided = None  # held: the amount is unknown (D44); pending: it is in `pending`
    status: RoundStatus
    if stopped:
        status = "held"
    elif pending is not None:
        status = "pending_approval"
    elif n == 3 and state.approval == "refused" and decided is None:
        status = "refused"
    elif decided is None:
        status = "not_decided"
    else:
        status = "needs_offer"
    return RoundView(
        round=n,
        status=status,
        ask=ask,
        decided=decided,
        locked=None,
        # Only C1's same-day Accepted (D162, owner 10-03) ticks an unposted round: CampMinder covers it in full and
        # tonight's tick posts it. Anything else can't (tick_accepted), and an undo of the Posted tick clears it.
        accepted=state.accepted,
        pending=pending,
        counts_toward_budget=counts,
        pool=pool,
        extra=_extra_now(result, decision, n) if decided is not None else ZERO,
        decision_type=decision_key if decision is not None and decision.round == n else None,
        extra_outside=_extra_outside(decision, n),
    )


def lock_snapshot(priced: PricedRequest, n: int, rules_version: int) -> dict[str, Any]:
    """What a Posted tick stores beside the amount (D43, D52): the receipt as it was when posted,
    where the round counts, and the decision money it locked (`top_up`, `discretionary`: inside
    this round's amount when `decision_round` is this round, else 0), so a later rules change never
    moves posted money between pools or rounds."""
    view = priced.view(n)
    if view is None or view.decided is None:
        raise ValueError(f"round {n} of request {priced.request_id} has nothing decided to lock")
    result = priced.result
    top_up, discretionary = ZERO, ZERO
    if result is not None and priced.decision_round == n:
        top_up, discretionary = result.top_up or ZERO, result.discretionary
    return {
        "round": n,
        "decided": str(view.decided),
        "decision_type": priced.inputs.decision_type if priced.inputs is not None else None,
        "decision_round": priced.decision_round,
        "top_up": str(top_up),
        "discretionary": str(discretionary),
        "rules_version": rules_version,
        "program_key": priced.program_key,
        "pool": view.pool,
        "counts_toward_budget": view.counts_toward_budget,
        "extra_outside": view.extra_outside,
        "application": priced.application.model_dump(mode="json"),
        "inputs": priced.inputs.model_dump(mode="json") if priced.inputs is not None else None,
        "result": priced.result.model_dump(mode="json") if priced.result is not None else None,
    }
