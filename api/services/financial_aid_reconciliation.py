"""Reconciliation with the CampMinder ledger (campership sub-project 10b; clean spec §5.1, §5.3,
§6.2; main spec §11; D12, D16, D26, D51, D52, D54, D58, D59, D78, D81).

Pure functions over records the decisions service read. Nothing here writes.

PLACEMENT. A camp-aid line (an aid_postings row whose funder type, after any reclassification, is
"camp"; live, or the reversed credit leg kept as history) sits on ONE request only when that is the
only request it could be (main spec §11: "a posting on the camper … whose person has one request in
that program this season belongs to that request"). That is a rule, not an inference (D16).
Anything else stays at family level: it waits in Money › To place (sub-project 11), never ticks on
its own (D81), and is never split by estimate (D12). The rules, in order:

  1. a staff placement (aid_attribution_overrides naming a person or a session) decides;
  2. a line CampMinder posted to a person goes on that person's one live request; with two or more,
     the session, then the program family, Go attributed to that same person narrows them;
  3. a line posted to the household, or to a person with no request of their own (the parent on a
     Family Camp line), goes on the one live HOUSEHOLD-LEVEL request (Family Camp, person 0) the
     household holds a payer share of. A summer line posted to a parent or the household stays at
     family level (main spec §11; D81: "always require Ben to do the data entry first"), and a
     sibling's line never lands on another sibling.

NET-TOTAL RECONCILIATION (main spec §11, D59): a request's placed live lines are summed and compared
with the locked total of its posted rounds, never line by line, so reverse-and-repost, an added
line and the +$300 on its own line all reconcile the same way. Each payer share is checked against
its own household's lines.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_grants_register import LIVE_REQUEST_STATUSES, program_family_for_session_type
from api.services.financial_aid_intake_types import PayerShareRecord, RequestRecord, SessionRow
from bunking.financial_aid.money import ZERO


def camp_date(moment: datetime) -> date:
    """A UTC instant as its camp-time (Pacific) calendar day (main spec §6.2)."""
    return moment.astimezone(CAMP_TZ).date()


def dollars(amount: Decimal) -> str:
    """$1,800 for whole dollars, $1,800.50 otherwise (D74: exact to the cent)."""
    return f"${amount:,.0f}" if amount == amount.to_integral_value() else f"${amount:,.2f}"


@dataclass(frozen=True)
class CampLine:
    """One camp-aid aid_postings row, in aid dollars (positive). person_cm_id is CampMinder's posted
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
class LinePlacement:
    """An aid_attribution_overrides row that names a person or a session: a staff (or 2026 sheet)
    placement. A reclassify-only override places nothing and is never one of these."""

    transaction_cm_id: int
    person_cm_id: int
    session_cm_id: int
    program_family: str


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
    unplaced_by_household: Mapping[int, Decimal] = field(default_factory=dict)
    synced_at: datetime | None = None
    read: bool = False

    def lines(self, request_id: str) -> tuple[CampLine, ...]:
        return self.by_request.get(request_id, ())

    def family_unplaced(self, households: Iterable[int]) -> Decimal:
        """The live camp aid on these households that no single request takes (family level)."""
        return sum((self.unplaced_by_household.get(h, ZERO) for h in set(households)), ZERO)


def _one(candidates: Sequence[PlaceableRequest]) -> str | None:
    ids = {r.id for r in candidates}
    return next(iter(ids)) if len(ids) == 1 else None


def _narrow(candidates: list[PlaceableRequest], session: int, family: str) -> list[PlaceableRequest]:
    """Two or more candidates: keep those in `session`, else those in `family`; else leave them all
    (still two or more, so the line stays at family level)."""
    if len(candidates) < 2:
        return candidates
    if session:
        in_session = [r for r in candidates if r.session_cm_id == session]
        if in_session:
            return in_session
    if family:
        in_family = [r for r in candidates if r.program_family == family]
        if in_family:
            return in_family
    return candidates


def _place(
    line: CampLine,
    placement: LinePlacement | None,
    by_person: Mapping[int, Sequence[PlaceableRequest]],
    by_household: Mapping[int, Sequence[PlaceableRequest]],
) -> str | None:
    households = [r for r in by_household.get(line.household_cm_id, ()) if r.person_cm_id == 0]
    if placement is not None:
        pool = list(by_person.get(placement.person_cm_id, ())) if placement.person_cm_id > 0 else []
        pool = pool or households
        if placement.session_cm_id:
            pool = [r for r in pool if r.session_cm_id == placement.session_cm_id]
        elif placement.program_family:
            pool = [r for r in pool if r.program_family == placement.program_family]
        return _one(pool)
    if line.person_cm_id > 0:
        mine = list(by_person.get(line.person_cm_id, ()))
        if not mine:
            return _one(households)
        on_person = line.attributed_person_cm_id == line.person_cm_id
        return _one(
            _narrow(mine, line.attributed_session_cm_id if on_person else 0, line.program_family if on_person else "")
        )
    return _one(households)  # only a household-level (Family Camp) request takes a household line


def build_ledger(
    lines: Iterable[CampLine],
    placements: Mapping[int, LinePlacement],
    requests: Iterable[PlaceableRequest],
    synced_at: datetime | None,
) -> SeasonLedger:
    """Every camp-aid line placed on its one request, or left at family level. Only live requests
    (active, unmatched) take a line, as the grants register's split does."""
    by_person: dict[int, list[PlaceableRequest]] = defaultdict(list)
    by_household: dict[int, list[PlaceableRequest]] = defaultdict(list)
    for r in requests:
        if r.status not in LIVE_REQUEST_STATUSES:
            continue
        if r.person_cm_id > 0:
            by_person[r.person_cm_id].append(r)
        for household in r.share_households | {r.household_cm_id}:
            by_household[household].append(r)
    placed: dict[str, list[CampLine]] = defaultdict(list)
    unplaced: dict[int, Decimal] = defaultdict(Decimal)
    for line in lines:
        request_id = _place(line, placements.get(line.transaction_cm_id), by_person, by_household)
        if request_id is not None:
            placed[request_id].append(line)
        elif line.live():
            unplaced[line.household_cm_id] += line.amount
    return SeasonLedger(
        by_request={rid: tuple(lns) for rid, lns in placed.items()},
        unplaced_by_household=dict(unplaced),
        synced_at=synced_at,
        read=True,
    )
