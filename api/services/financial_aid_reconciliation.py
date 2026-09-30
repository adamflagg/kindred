"""Reconciliation with the CampMinder ledger (campership sub-project 10b; clean spec §5.1, §5.3,
§6.2; main spec §11; D12, D16, D26, D51, D52, D54, D58, D59, D78, D81).

Pure functions over records the decisions service read. Nothing here writes.

PLACEMENT. A camp-aid line (an aid_postings row whose funder type, after any reclassification, is
"camp"; live, or the reversed credit leg kept as history) sits on ONE request only when that is the
only request it could be (main spec §11: "a posting on the camper ... whose person has one request in
that program this season belongs to that request"). That is a rule, not an inference (D16).
Anything else stays at family level: it waits in Money > To place (sub-project 11), never ticks on
its own (D81: "always require the registrar to do the data entry first"), and is never split by estimate (D12).
The rules, in order:

  1. a staff placement (aid_attribution_overrides naming a person or a session) decides, narrowing
     by its own session, else its program family. With no request of the named person it falls back
     to the household's request only when the placement names Family Camp (a session or program);
  2. a line CampMinder posted to a person goes on that person's ONE live request, unless Go's
     attribution names that same person and a program that differs from the request's program, in
     which case it stays at family level;
  3. a line posted to the household, or to a person with no request of their own (the parent on a
     Family Camp line), goes on the household's request only when Go's program is empty or Family
     Camp AND that request (Family Camp, person 0) is the only live request the household holds.

Several candidates and no staff placement leave the line at family level. Go's attribution is NEVER
used to choose among candidates: Go re-attributes every row nightly from active enrollments, so after
a cancellation a reversed line could move requests and the clawback return would break. A choice
made by a person (a placement) is stable; a choice made by a nightly recompute is not.

NET-TOTAL RECONCILIATION (main spec §11, D59): a request's placed live lines are summed and compared
with the locked total of its posted rounds, never line by line, so reverse-and-repost, an added
line and the +$300 on its own line all reconcile the same way. Each payer share is checked against
its own household's lines.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from decimal import Decimal

from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_grants_register import (
    LIVE_REQUEST_STATUSES,
    Placement,
    program_family_for_session_type,
)
from api.services.financial_aid_intake_types import PayerShareRecord, RequestRecord, SessionRow
from bunking.financial_aid.decisions import PricedRequest, RoundState
from bunking.financial_aid.money import ZERO


def camp_date(moment: datetime) -> date:
    """A UTC instant as its camp-time (Pacific) calendar day (main spec §6.2)."""
    return moment.astimezone(CAMP_TZ).date()


def dollars(amount: Decimal) -> str:
    """$1,800 for whole dollars, $1,800.50 otherwise (D74: exact to the cent)."""
    return f"${amount:,.0f}" if amount == amount.to_integral_value() else f"${amount:,.2f}"


@dataclass(frozen=True)
class CampLine:
    """One camp-aid aid_postings row, in aid dollars (positive). Callers must pass only
    funder_type == "camp" lines (after reclassification). person_cm_id is CampMinder's posted
    person (0 = posted to the household); the attributed_* fields are Go's attribution."""

    transaction_cm_id: int
    household_cm_id: int
    person_cm_id: int
    amount: Decimal
    post_date: datetime | None
    is_reversed: bool
    reversal_date: datetime | None
    attributed_person_cm_id: int = 0
    attributed_session_cm_id: int = 0
    program_family: str = ""

    def live(self, at: datetime | None = None) -> bool:
        """Live now (at None), or at `at`: posted by then and not reversed by then. A line with no
        post date can't be placed in time, so it counts only in the live read."""
        if at is None:
            return not self.is_reversed
        if self.post_date is None or self.post_date > at:
            return False
        return not self.is_reversed or (self.reversal_date is not None and self.reversal_date > at)

    def reversed_by(self, at: datetime | None = None) -> bool:
        if not self.is_reversed:
            return False
        return at is None or (self.reversal_date is not None and self.reversal_date <= at)


@dataclass(frozen=True)
class PlaceableRequest:
    id: str
    household_cm_id: int
    person_cm_id: int  # 0 = the household's own request (Family Camp)
    session_cm_id: int  # 0 = unresolved (unmatched)
    program_family: str  # its session's program family; "" when the session is unresolved
    status: str
    share_households: frozenset[int]


def placeable(
    request: RequestRecord, sessions: Mapping[int, SessionRow], shares: Iterable[PayerShareRecord]
) -> PlaceableRequest:
    session = sessions.get(request.session_cm_id)
    return PlaceableRequest(
        id=request.id,
        household_cm_id=request.household_cm_id,
        person_cm_id=request.person_cm_id,
        session_cm_id=request.session_cm_id,
        program_family=program_family_for_session_type(session.session_type) if session is not None else "",
        status=request.status,
        share_households=frozenset(s.household_cm_id for s in shares if s.request_id == request.id),
    )


def request_scope(request: RequestRecord, shares: Iterable[PayerShareRecord]) -> frozenset[int]:
    """D26 / D58: the application's household and every household holding a payer share of the request."""
    return frozenset({request.household_cm_id, *(s.household_cm_id for s in shares if s.request_id == request.id)})


@dataclass(frozen=True)
class SeasonLedger:
    """The season's camp-aid lines, placed. `read` is False for a season read that loaded no ledger
    (a past date), so nothing is reconciled on it."""

    by_request: Mapping[str, tuple[CampLine, ...]] = field(default_factory=dict)
    by_closed_request: Mapping[str, tuple[CampLine, ...]] = field(default_factory=dict)
    unplaced_by_household: Mapping[int, Decimal] = field(default_factory=dict)
    synced_at: datetime | None = None
    read: bool = False

    def lines(self, request_id: str) -> tuple[CampLine, ...]:
        return self.by_request.get(request_id, ())

    def closed_lines(self, request_id: str) -> tuple[CampLine, ...]:
        """Lines placed on a closed (withdrawn / duplicate) request that holds posted money. They feed
        the clawback only (D54): never a tick, never Needs an offer, never demand."""
        return self.by_closed_request.get(request_id, ())

    def family_unplaced(self, households: Iterable[int]) -> Decimal:
        """The live camp aid on these households that no single request takes (family level)."""
        return sum((self.unplaced_by_household.get(h, ZERO) for h in set(households)), ZERO)


FAMILY_CAMP = "family_camp"


def _one(candidates: Sequence[PlaceableRequest]) -> str | None:
    ids = {r.id for r in candidates}
    return next(iter(ids)) if len(ids) == 1 else None


def _household_request(line: CampLine, by_household: Mapping[int, Sequence[PlaceableRequest]]) -> str | None:
    """The household's own (Family Camp) request, only when it is the household's only live request
    and Go did not tag the line with another program."""
    if line.program_family not in ("", FAMILY_CAMP):
        return None
    held = by_household.get(line.household_cm_id, ())
    if len({r.id for r in held}) != 1:
        return None
    return _one([r for r in held if r.person_cm_id == 0])


def _matching(pool: Sequence[PlaceableRequest], placement: Placement) -> list[PlaceableRequest]:
    if placement.session_cm_id:
        return [r for r in pool if r.session_cm_id == placement.session_cm_id]
    if placement.program_family:
        return [r for r in pool if r.program_family == placement.program_family]
    return list(pool)


def _place_by_staff(
    line: CampLine,
    placement: Placement,
    by_person: Mapping[int, Sequence[PlaceableRequest]],
    by_household: Mapping[int, Sequence[PlaceableRequest]],
) -> str | None:
    """A staff placement decides: the named person's request it matches (one only); else, when
    the placement names Family Camp, the household's own request it matches (one only); and only when
    nothing matched there, for a session placement, that person's only live request if unmatched."""
    own = list(by_person.get(placement.person_cm_id, ())) if placement.person_cm_id > 0 else []
    matched = _matching(own, placement)
    if matched:
        return _one(matched)
    if placement.program_family == FAMILY_CAMP or placement.session_cm_id:
        household = [r for r in by_household.get(line.household_cm_id, ()) if r.person_cm_id == 0]
        fallback = _matching(household, placement)
        if fallback:
            return _one(fallback)
    if own and placement.session_cm_id and len({r.id for r in own}) == 1 and own[0].session_cm_id == 0:
        return own[0].id
    return None


def _place(
    line: CampLine,
    placement: Placement | None,
    by_person: Mapping[int, Sequence[PlaceableRequest]],
    by_household: Mapping[int, Sequence[PlaceableRequest]],
) -> str | None:
    if placement is not None:
        return _place_by_staff(line, placement, by_person, by_household)
    if line.person_cm_id > 0:
        mine = by_person.get(line.person_cm_id, ())
        if not mine:
            return _household_request(line, by_household)
        only = _one(mine)
        if only is None:
            return None  # several candidates: never narrowed by Go's attribution
        request = mine[0]
        named = line.attributed_person_cm_id == line.person_cm_id
        if named and line.program_family and request.program_family and line.program_family != request.program_family:
            return None
        return only
    return _household_request(line, by_household)


def _index(
    requests: Iterable[PlaceableRequest],
) -> tuple[dict[int, list[PlaceableRequest]], dict[int, list[PlaceableRequest]]]:
    by_person: dict[int, list[PlaceableRequest]] = defaultdict(list)
    by_household: dict[int, list[PlaceableRequest]] = defaultdict(list)
    for r in requests:
        if r.person_cm_id > 0:
            by_person[r.person_cm_id].append(r)
        for household in r.share_households | {r.household_cm_id}:
            by_household[household].append(r)
    return by_person, by_household


def build_ledger(
    lines: Iterable[CampLine],
    placements: Mapping[int, Placement],
    requests: Iterable[PlaceableRequest],
    synced_at: datetime | None,
    posted_request_ids: frozenset[str] = frozenset(),
) -> SeasonLedger:
    """Every camp-aid line placed on its one request, or left at family level. Only live requests
    (active, unmatched) take a line, as the grants register's split does.

    A second pass (D54, SP10a Decision 13) places a line the first pass left unplaced on a closed
    request (withdrawn, duplicate, duplicate_pending) that holds posted money, named by
    `posted_request_ids`, by the same rules. Those lines go to `by_closed_request` only, so they
    can never tick a request, add to Needs an offer or change demand; they exist so CampMinder
    reversing a withdrawn request's posted money can claw it back."""
    everyone = list(requests)
    by_person, by_household = _index(r for r in everyone if r.status in LIVE_REQUEST_STATUSES)
    closed_person, closed_household = _index(
        r for r in everyone if r.status not in LIVE_REQUEST_STATUSES and r.id in posted_request_ids
    )
    placed: dict[str, list[CampLine]] = defaultdict(list)
    closed: dict[str, list[CampLine]] = defaultdict(list)
    unplaced: dict[int, Decimal] = defaultdict(Decimal)
    for line in lines:
        placement = placements.get(line.transaction_cm_id)
        request_id = _place(line, placement, by_person, by_household)
        if request_id is not None:
            placed[request_id].append(line)
            continue
        closed_id = _place(line, placement, closed_person, closed_household)
        if closed_id is not None:
            closed[closed_id].append(line)
        elif line.live():
            unplaced[line.household_cm_id] += line.amount
    return SeasonLedger(
        by_request={rid: tuple(lns) for rid, lns in placed.items()},
        by_closed_request={rid: tuple(lns) for rid, lns in closed.items()},
        unplaced_by_household=dict(unplaced),
        synced_at=synced_at,
        read=True,
    )


# --- clawback (D54) --------------------------------------------------------------------------


def _posted_day(state: RoundState | None) -> date:
    """The day a posted round was posted in CampMinder (its tick's effective_on), else the day it
    locked; date.min when neither is known, so any reversal counts."""
    if state is None:
        return date.min
    if state.posted_on is not None:
        return state.posted_on
    return camp_date(state.locked_at) if state.locked_at is not None else date.min


def clawed_back_on(lines: Sequence[CampLine], first_posted_on: date, at: datetime | None = None) -> date | None:
    """D54: the day CampMinder took back what it held for this request, or None. Nothing placed on it
    is live, and a placed line was reversed on or after its first posted day. A reversal that leaves
    money live reads short instead, and an appeal's reverse-and-repost is never one (the repost is
    live). Derived on every read: a later repost makes the money posted again."""
    if any(line.live(at) for line in lines):
        return None
    days = [
        camp_date(line.reversal_date)
        for line in lines
        if line.reversal_date is not None and line.reversed_by(at) and camp_date(line.reversal_date) >= first_posted_on
    ]
    return max(days) if days else None


def apply_clawback(
    priced: PricedRequest,
    rounds: Mapping[int, RoundState],
    lines: Sequence[CampLine],
    *,
    at: datetime | None = None,
) -> tuple[PricedRequest, date | None]:
    """The request with every posted round marked clawed back when its money came back, and the
    reversal's day; otherwise the same request and None. All of a request's posted rounds go
    together, because reconciliation is by the request's net total (main spec §11)."""
    posted = [view for view in priced.rounds if view.status == "posted"]
    if not posted:
        return priced, None
    day = clawed_back_on(lines, min(_posted_day(rounds.get(view.round)) for view in posted), at)
    if day is None:
        return priced, None
    views = tuple(replace(view, clawed_back=True) if view.status == "posted" else view for view in priced.rounds)
    return replace(priced, rounds=views), day
