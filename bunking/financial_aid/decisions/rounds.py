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

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal, get_args

from bunking.financial_aid.rules.schema import AidRules

EventKind = Literal["ask", "award", "approve", "refuse", "post", "unpost", "accept", "unaccept"]
EVENT_KINDS: Final[tuple[EventKind, ...]] = get_args(EventKind)
ROUNDS: Final[tuple[int, ...]] = (1, 2, 3)
Approval = Literal["not_needed", "pending", "approved", "refused"]
# The lock_source of a round the 2026 decision-year load wrote (D67; scripts/financial_aid/load_2026_decisions.py):
# reproduced from the repaired sheet, never ticked in Kindred. Read-only; its receipt says where it came from.
REPRODUCED: Final = "reproduced"
# The same load's "CampMinder only" Round 1 (owner, 2026-10-07): a request the sheet has no row for, posted at
# CampMinder's money. Read-only like REPRODUCED, and never labelled as reproduced from the sheet.
FROM_CAMPMINDER: Final = "campminder_only"
LOADED: Final = frozenset({REPRODUCED, FROM_CAMPMINDER})


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
    # Slice 1's receipt label (§4.7): who ticked Posted (the actor of the standing post), and who decided a
    # staff-decided Round 3 amount (whoever keyed it, or finance once it approved it). "" when none.
    posted_by: str = ""
    decided_by: str = ""


def apply_event(state: RoundState, event: DecisionEvent) -> RoundState:
    kind = event.kind
    if kind == "ask":
        return replace(state, ask=event.amount, asked_on=event.effective_on, statement_of_need=event.statement_of_need)
    if kind == "award" and event.decision_type:
        return replace(state, discretionary=event.amount, discretionary_type=event.decision_type)
    if kind == "award":
        return replace(
            state,
            award=event.amount,
            approval="pending" if event.needs_approval else "not_needed",
            decided_by=event.actor,
        )
    if kind == "approve":
        return replace(state, approval="approved", decided_by=event.actor)
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
            posted_by=event.actor,
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
            posted_by="",
        )
    if kind == "accept":
        return replace(state, accepted=True, accepted_at=event.created)
    if kind == "unaccept":
        return replace(state, accepted=False, accepted_at=None)
    raise ValueError(f"unknown aid_decisions event {kind!r}")


def _order(event: DecisionEvent) -> tuple[datetime, str]:
    return event.created, event.id


def _standing_backdated_posts(events: Sequence[DecisionEvent], as_of: datetime, posted_by: date) -> set[str]:
    """The ids of the Posted ticks recorded after `as_of` whose CampMinder post day is on or before
    `posted_by`, and that still stand now: no undo of the same round was recorded after them.

    Ruling (owner batch 2026-09-30) on the undo of a back-dated tick: the undo applies whenever it was
    recorded, up to now, not only by the cut. A back-dated tick is recorded after the cut, so its undo
    is too; cutting undos at the cut would count every mistaken back-dated tick. A tick a person later
    undid was a mistake, so a back-dated one never counts on the CampMinder axis. (A tick recorded by
    the cut keeps the recorded fold: it and any undo recorded by the cut apply as they did then.)

    Ruling (fix round 1): a standing back-dated tick applied on top of a round already posted by the
    cut resets Accepted. The new tick supersedes the earlier offer; the family's acceptance of the old
    amount doesn't carry over (fold_rounds applies it)."""
    last_undo: dict[tuple[str, int], tuple[datetime, str]] = {}
    for e in events:
        if e.kind == "unpost":
            key = (e.request_id, e.round)
            last_undo[key] = max(last_undo.get(key, _order(e)), _order(e))
    out: set[str] = set()
    for e in events:
        if e.kind != "post" or e.created <= as_of or e.effective_on is None or e.effective_on > posted_by:
            continue
        undo = last_undo.get((e.request_id, e.round))
        if undo is None or undo < _order(e):
            out.add(e.id)
    return out


def fold_rounds(
    events: Iterable[DecisionEvent], *, as_of: datetime | None = None, posted_by: date | None = None
) -> dict[str, dict[int, RoundState]]:
    """request id -> round -> state, from the events recorded up to `as_of` (every event when None).
    Events apply in the order they were recorded; the record id breaks a tie in the same instant.

    `posted_by` is the CampMinder axis's day (owner ruling 2026-09-30; None: the recorded axis). It adds
    to the recorded cut each Posted tick recorded after `as_of` that CampMinder posted by that day and
    that still stands (_standing_backdated_posts). Every other event, the accept and unaccept ticks
    included, has no CampMinder date and keeps the recorded cut on both axes. A tick's post day is never
    after the day Kindred recorded it (PostedIn.posted_on refuses a future day, and the row is written
    that same day), so a tick recorded by the cut was posted by then too: the CampMinder axis only ADDS
    back-dated ticks to what the recorded axis shows, and never drops one."""
    listed = list(events)
    extra = (
        _standing_backdated_posts(listed, as_of, posted_by) if as_of is not None and posted_by is not None else set()
    )
    out: dict[str, dict[int, RoundState]] = {}
    kept = (e for e in listed if as_of is None or e.created <= as_of or e.id in extra)
    for event in sorted(kept, key=_order):
        rounds = out.setdefault(event.request_id, {})
        state = rounds.get(event.round, RoundState(round=event.round))
        applied = apply_event(state, event)
        if event.id in extra and state.posted:  # a re-tick supersedes the accepted offer
            applied = replace(applied, accepted=False, accepted_at=None)
        rounds[event.round] = applied
    return out


def needs_finance(amount: Decimal, rules: AidRules) -> bool:
    """Whether a Round 3 amount keyed by the registrar waits for finance (D22, D79): above the
    season's registrar limit, or any amount while the season sets none."""
    limit = rules.round3.registrar_limit
    return limit is None or amount > limit
