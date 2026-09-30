"""Per-round state from the aid_decisions history (campership sub-project 10a; spec §5.1–5.2,
§7.1; D41–D43, D50–D52, D79, D91).

aid_decisions is append-only (pocketbase/pb_migrations/1500000211_aid_decisions.js). Each row is
one dated event on one request's round. A round's state is the fold of its events in the order
they were recorded, so its state on any past date is the fold of the events recorded by then
(D63): pass `as_of`. Nothing here judges whether an event was allowed: the write service refuses
what may not happen before it writes.

Round 1's ask is not here. It is aid_requests.ask (intake), with its dated corrections. Round 2
and Round 3 asks are keyed when the family asks, before anything is decided (D91, D82).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal, get_args

from bunking.financial_aid.rules.schema import AidRules

EventKind = Literal["ask", "award", "approve", "refuse", "post", "unpost", "accept", "unaccept"]
EVENT_KINDS: Final[tuple[EventKind, ...]] = get_args(EventKind)
ROUNDS: Final[tuple[int, ...]] = (1, 2, 3)
Approval = Literal["not_needed", "pending", "approved", "refused"]


@dataclass(frozen=True)
class DecisionEvent:
    """One aid_decisions row. `created` is when Kindred recorded it; `effective_on` is the day it
    happened outside Kindred (the family asked; the award was posted in CampMinder)."""

    id: str
    request_id: str
    round: int
    kind: EventKind
    created: datetime
    amount: Decimal | None = None
    effective_on: date | None = None
    statement_of_need: str = ""
    decision_type: str = ""
    needs_approval: bool = False
    lock_source: str = ""
    rules_version: int | None = None
    snapshot: Mapping[str, Any] | None = None
    note: str = ""
    actor: str = ""


@dataclass(frozen=True)
class RoundState:
    """One round of one request, as its events leave it.

    `award` is a staff-decided Round 3 amount and `approval` its finance approval (D79).
    `discretionary` is a named discretionary amount (`discretionary_type`), finance's own.
    `locked_amount` is what the Posted tick locked (D52); it is None while the round is not
    posted.
    """

    round: int
    ask: Decimal | None = None
    asked_on: date | None = None
    statement_of_need: str = ""
    award: Decimal | None = None
    approval: Approval = "not_needed"
    discretionary: Decimal | None = None
    discretionary_type: str = ""
    posted: bool = False
    locked_amount: Decimal | None = None
    locked_at: datetime | None = None
    posted_on: date | None = None
    lock_source: str = ""
    rules_version: int | None = None
    snapshot: Mapping[str, Any] | None = None
    accepted: bool = False
    accepted_at: datetime | None = None


def apply_event(state: RoundState, event: DecisionEvent) -> RoundState:
    kind = event.kind
    if kind == "ask":
        return replace(state, ask=event.amount, asked_on=event.effective_on, statement_of_need=event.statement_of_need)
    if kind == "award" and event.decision_type:
        return replace(state, discretionary=event.amount, discretionary_type=event.decision_type)
    if kind == "award":
        return replace(state, award=event.amount, approval="pending" if event.needs_approval else "not_needed")
    if kind == "approve":
        return replace(state, approval="approved")
    if kind == "refuse":
        return replace(state, approval="refused")
    if kind == "post":
        return replace(
            state,
            posted=True,
            locked_amount=event.amount,
            locked_at=event.created,
            posted_on=event.effective_on,
            lock_source=event.lock_source,
            rules_version=event.rules_version,
            snapshot=event.snapshot,
        )
    if kind == "unpost":
        return replace(
            state,
            posted=False,
            locked_amount=None,
            locked_at=None,
            posted_on=None,
            lock_source="",
            rules_version=None,
            snapshot=None,
            accepted=False,
            accepted_at=None,
        )
    if kind == "accept":
        return replace(state, accepted=True, accepted_at=event.created)
    if kind == "unaccept":
        return replace(state, accepted=False, accepted_at=None)
    raise ValueError(f"unknown aid_decisions event {kind!r}")


def fold_rounds(events: Iterable[DecisionEvent], *, as_of: datetime | None = None) -> dict[str, dict[int, RoundState]]:
    """request id -> round -> state, from the events recorded up to `as_of` (every event when None).
    Events apply in the order they were recorded; the record id breaks a tie in the same instant."""
    out: dict[str, dict[int, RoundState]] = {}
    kept = (e for e in events if as_of is None or e.created <= as_of)
    for event in sorted(kept, key=lambda e: (e.created, e.id)):
        rounds = out.setdefault(event.request_id, {})
        rounds[event.round] = apply_event(rounds.get(event.round, RoundState(round=event.round)), event)
    return out


def needs_finance(amount: Decimal, rules: AidRules) -> bool:
    """Whether a Round 3 amount keyed by the registrar waits for finance (D22, D79): above the
    season's registrar limit, or any amount while the season sets none."""
    limit = rules.round3.registrar_limit
    return limit is None or amount > limit
