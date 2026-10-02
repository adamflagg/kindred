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
     a session placement then matches the person's closed request that holds posted money on that
     session exactly, before the person's lone unmatched request;
  2. a line CampMinder posted to a person goes on that person's ONE live request, unless Go's
     attribution names that same person and a program that differs from the request's program, or
     names that person with no program (enrolled in two programs) while the household holds a live
     Family Camp request that could own it too, in which case it stays at family level;
  3. a line posted to the household, or to a person with no request of their own (the parent on a
     Family Camp line), goes on the household's request only when Go's program is empty or Family
     Camp AND that request (Family Camp, person 0) is the only live request the household holds. A
     line on a person whose own request is closed never takes the household's request (the
     closed-request pass takes it, D54), except a LIVE line Go tags Family Camp: that person left
     summer but stays in Family Camp, and the line goes to the household's request by this rule;
  4. the closed-request pass places what the live pass found no request for by the same rules, except
     that it ignores Go's program on a REVERSED line: a reversal follows the person's closed request,
     so the clawback fires (D54) even though Go re-tagged the line after the cancel (below).

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

import json
from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Final, Literal

from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_grants_register import (
    LIVE_REQUEST_STATUSES,
    Placement,
    program_family_for_session_type,
)
from api.services.financial_aid_intake_types import (
    STATUS_ACTIVE,
    STATUS_DUPLICATE_PENDING,
    STATUS_UNMATCHED,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_payer_shares import PayerShareError, split_award
from bunking.financial_aid.calculator import CalcIssue
from bunking.financial_aid.decisions import DecisionEvent, PricedRequest, RoundLedger, RoundState
from bunking.financial_aid.money import ZERO, dollars
from bunking.logging_config import get_logger

logger = get_logger(__name__)


def camp_date(moment: datetime) -> date:
    """A UTC instant as its camp-time (Pacific) calendar day (main spec §6.2)."""
    return moment.astimezone(CAMP_TZ).date()


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
    # The line's CampMinder description after any reclassification (aid_postings.effective_source_key): the key of the
    # aid_sources row that classifies it. "" when a caller didn't read it.
    description_key: str = ""
    # When Kindred recorded the row (aid_postings' created) and last wrote it (updated). Read only by a
    # past read, for the recorded as-of axis (as_recorded); None on the live read.
    recorded_at: datetime | None = None
    updated_at: datetime | None = None

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


def as_recorded(lines: Iterable[CampLine], at: datetime) -> list[CampLine]:
    """The lines as Kindred had recorded them by `at`: the recorded as-of axis (owner ruling
    2026-09-30, PR Decision 11). The campminder axis, the default, reads the lines as they are, cut
    only on CampMinder's post_date and reversal_date (CampLine.live). On the recorded axis those cuts
    still apply, and a line counts only if its aid_postings row existed by `at` too (`recorded_at`, the
    row's created). A line with no recorded time can't be placed in Kindred's time, so it is left out,
    as a line with no post date is on any past read.

    Reversal timing (ruling C): aid_postings keeps no time for when Kindred recorded a reversal. A
    reversal is an update of the same row (aid_postings.go: the reversed credit leg keeps its key), so
    the best available is the row's last write (`updated_at`, else `recorded_at`). That is an upper
    bound: any later write to the row (a re-attribution, a changed flag) moves it on too, so this axis
    can show a reversal later than Kindred had it, never earlier. A reversal not recorded by `at`
    reads as not reversed, so the line is live then as far as the reversal goes."""
    out: list[CampLine] = []
    for line in lines:
        if line.recorded_at is None or line.recorded_at > at:
            continue
        written = line.updated_at or line.recorded_at
        if line.is_reversed and written > at:
            line = replace(line, is_reversed=False, reversal_date=None)
        out.append(line)
    return out


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


@dataclass(frozen=True)
class SplitPart:
    """One part of a line the registrar split across requests (D12, SP11-rest): where it goes, named the
    way a placement names it (a person, a session, a program family), and how much of the line it takes."""

    person_cm_id: int
    session_cm_id: int
    program_family: str
    amount: Decimal

    def placement(self, transaction_cm_id: int) -> Placement:
        return Placement(transaction_cm_id, self.person_cm_id, self.session_cm_id, self.program_family)

    def fields(self) -> dict[str, Any]:
        """The part as aid_attribution_overrides.split stores it: the amount as its exact string (D74)."""
        return {
            "person_cm_id": self.person_cm_id,
            "session_cm_id": self.session_cm_id,
            "program_family": self.program_family,
            "amount": str(self.amount),
        }


def _finite_amount(value: Any) -> Decimal:
    """A split part's amount; NaN and the infinities are unreadable like any other bad value."""
    amount = Decimal(str(value))
    if not amount.is_finite():
        raise ValueError(f"non-finite split amount {value!r}")
    return amount


def override_split(fields: Mapping[str, Any]) -> tuple[SplitPart, ...]:
    """The parts of a split override (its `split` JSON, a list or its text); () for an override that
    places or reclassifies a line whole."""
    raw = fields.get("split")
    try:
        if isinstance(raw, str):
            raw = json.loads(raw) if raw.strip() else None
        return tuple(
            SplitPart(
                int(part.get("person_cm_id") or 0),
                int(part.get("session_cm_id") or 0),
                str(part.get("program_family") or ""),
                _finite_amount(part["amount"]),
            )
            for part in raw or ()
        )
    except (ValueError, TypeError, AttributeError, KeyError, ArithmeticError) as exc:
        # An unreadable split must not fail the season read: a part with no amount reads as a bad record,
        # and _pieces leaves the line at family level, where To place shows it.
        logger.warning("Unreadable aid split override ignored: %s: %s", type(exc).__name__, exc)
        return (SplitPart(0, 0, "", ZERO),)


@dataclass(frozen=True)
class LineOverride:
    """One aid_attribution_overrides record: its id (the key its log rows carry) and what it places."""

    id: str
    transaction_cm_id: int
    attributed_person_cm_id: int
    attributed_session_cm_id: int
    program_family: str
    split: tuple[SplitPart, ...] = ()  # a split across requests (SP11-rest); () places the line whole

    def fields(self) -> dict[str, Any]:
        """The record in the shape its log rows carry (the replay's `current`). `split` only when set:
        the overrides written before SP11-rest logged none."""
        out: dict[str, Any] = {
            "transaction_cm_id": self.transaction_cm_id,
            "attributed_person_cm_id": self.attributed_person_cm_id,
            "attributed_session_cm_id": self.attributed_session_cm_id,
            "program_family": self.program_family,
        }
        if self.split:
            out["split"] = [part.fields() for part in self.split]
        return out


def override_placement(fields: Mapping[str, Any]) -> Placement | None:
    """A placement from an override's fields; None for a reclassify-only override (no person, no session).
    A Family Camp placement names a session and no person, so a session alone places a line."""
    person = int(fields.get("attributed_person_cm_id") or 0)
    session = int(fields.get("attributed_session_cm_id") or 0)
    if person <= 0 and session <= 0:
        return None
    return Placement(
        int(fields.get("transaction_cm_id") or 0), person, session, str(fields.get("program_family") or "")
    )


def request_scope(request: RequestRecord, shares: Iterable[PayerShareRecord]) -> frozenset[int]:
    """D26 / D58: the application's household and every household holding a payer share of the request."""
    return frozenset({request.household_cm_id, *(s.household_cm_id for s in shares if s.request_id == request.id)})


@dataclass(frozen=True)
class PageScope:
    request_ids: tuple[str, ...]  # chip order of the applying household, then request id
    households: tuple[int, ...]  # the opened household first, then by id


def page_scope(
    household_cm_id: int,
    requests: Mapping[str, RequestRecord],
    shares: Mapping[str, Sequence[PayerShareRecord]],
) -> PageScope:
    mine = [
        rid
        for rid, request in requests.items()
        if request.household_cm_id == household_cm_id
        or any(s.household_cm_id == household_cm_id for s in shares.get(rid, ()))
    ]
    others = {requests[rid].household_cm_id for rid in mine} | {
        s.household_cm_id for rid in mine for s in shares.get(rid, ())
    }
    households = (household_cm_id, *sorted(others - {household_cm_id}))
    chip = {h: i for i, h in enumerate(households)}
    shown = [rid for rid, request in requests.items() if request.household_cm_id in chip]
    ordered = sorted(shown, key=lambda rid: (chip[requests[rid].household_cm_id], rid))
    return PageScope(request_ids=tuple(ordered), households=households)


@dataclass(frozen=True)
class SeasonLedger:
    """The season's camp-aid lines, placed. `read` is False for a season read that loaded no ledger
    (a past date), so nothing is reconciled on it."""

    by_request: Mapping[str, tuple[CampLine, ...]] = field(default_factory=dict)
    by_closed_request: Mapping[str, tuple[CampLine, ...]] = field(default_factory=dict)
    unplaced_by_household: Mapping[int, Decimal] = field(default_factory=dict)
    unplaced_lines_by_household: Mapping[int, tuple[CampLine, ...]] = field(default_factory=dict)
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

    def family_lines(self, households: Iterable[int]) -> tuple[CampLine, ...]:
        """The live lines behind `family_unplaced`: what a clawback reads, by post date."""
        return tuple(line for h in sorted(set(households)) for line in self.unplaced_lines_by_household.get(h, ()))


FAMILY_CAMP = "family_camp"


class _Miss(Enum):
    """Why the live pass placed nothing. Only NONE lets the closed-request pass run: several live
    candidates, or one rejected on attribution, are AMBIGUOUS and stay at family level."""

    NONE = "none"
    AMBIGUOUS = "ambiguous"


def _one(candidates: Sequence[PlaceableRequest]) -> str | _Miss:
    ids = {r.id for r in candidates}
    if not ids:
        return _Miss.NONE
    return next(iter(ids)) if len(ids) == 1 else _Miss.AMBIGUOUS


def _household_request(
    line: CampLine, by_household: Mapping[int, Sequence[PlaceableRequest]], own_closed: bool
) -> str | _Miss:
    """The household's own (Family Camp) request, only when it is the household's only live request
    and Go did not tag the line with another program. With none of those (person 0) it is NONE when
    the household holds nothing live, or holds only a person-level request and the line's person's
    own request is closed (a sibling's request is not theirs); otherwise other live requests make
    the line AMBIGUOUS. A line on a person whose own request is closed is NONE first, whatever the
    household holds: the closed-request pass takes it (D54), never a Family Camp request. The one
    exception is a live line Go tags Family Camp: that person left summer but stays in Family Camp,
    so the line is the household's Family Camp request's by the rule above."""
    if own_closed and (line.is_reversed or line.program_family != FAMILY_CAMP):
        return _Miss.NONE
    if line.program_family not in ("", FAMILY_CAMP):
        return _Miss.NONE
    held = by_household.get(line.household_cm_id, ())
    own = [r for r in held if r.person_cm_id == 0]
    if not own:
        return _Miss.NONE if not held else _Miss.AMBIGUOUS
    if len({r.id for r in held}) != 1:
        return _Miss.AMBIGUOUS
    return _one(own)


def _holds_household_request(line: CampLine, by_household: Mapping[int, Sequence[PlaceableRequest]]) -> bool:
    return any(r.person_cm_id == 0 for r in by_household.get(line.household_cm_id, ()))


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
    closed_by_person: Mapping[int, Sequence[PlaceableRequest]],
) -> str | _Miss:
    """A staff placement decides: the named person's request it matches (one only); else, when
    the placement names Family Camp, the household's own request it matches (one only); else, for a
    session placement, the person's closed request with posted money on exactly that session (NONE
    here, so the closed pass takes it); and only when nothing matched there, that person's only live
    request if unmatched. The staff placement names the session, so the withdrawn request on it beats
    a live request that merely has no session yet."""
    own = list(by_person.get(placement.person_cm_id, ())) if placement.person_cm_id > 0 else []
    matched = _matching(own, placement)
    if matched:
        return _one(matched)
    if placement.program_family == FAMILY_CAMP or placement.session_cm_id:
        household = [r for r in by_household.get(line.household_cm_id, ()) if r.person_cm_id == 0]
        fallback = _matching(household, placement)
        if fallback:
            return _one(fallback)
    if placement.session_cm_id and any(
        r.session_cm_id == placement.session_cm_id for r in closed_by_person.get(placement.person_cm_id, ())
    ):
        return _Miss.NONE
    if own and placement.session_cm_id and len({r.id for r in own}) == 1 and own[0].session_cm_id == 0:
        return own[0].id
    return _Miss.NONE


def _place(
    line: CampLine,
    placement: Placement | None,
    by_person: Mapping[int, Sequence[PlaceableRequest]],
    by_household: Mapping[int, Sequence[PlaceableRequest]],
    own_closed: bool = False,
    closed_by_person: Mapping[int, Sequence[PlaceableRequest]] | None = None,
    ignore_program: bool = False,
) -> str | _Miss:
    """One line's request, or why none. `ignore_program` (the closed pass, on a reversed line) skips
    Go's program: a reversal follows the person's closed request, however Go re-tagged it since."""
    if placement is not None:
        return _place_by_staff(line, placement, by_person, by_household, closed_by_person or {})
    if line.person_cm_id > 0:
        mine = by_person.get(line.person_cm_id, ())
        if not mine:
            return _household_request(line, by_household, own_closed)
        only = _one(mine)
        if isinstance(only, _Miss):
            return only  # several candidates: never narrowed by Go's attribution
        request = mine[0]
        named = line.attributed_person_cm_id == line.person_cm_id and not ignore_program
        if named and line.program_family and request.program_family and line.program_family != request.program_family:
            return _Miss.AMBIGUOUS
        if named and not line.program_family and _holds_household_request(line, by_household):
            return _Miss.AMBIGUOUS  # enrolled in two programs: the household's request could own it too
        return only
    return _household_request(line, by_household, False)


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


def _split_is_sound(line: CampLine, parts: Sequence[SplitPart]) -> bool:
    """A split places a line only when every part is positive, no two parts name one request, and the
    parts add up to the line (CampMinder never changes a posted amount, so anything else is a bad record)."""
    if any(part.amount <= 0 for part in parts):
        return False
    if len({(p.person_cm_id, p.session_cm_id, p.program_family) for p in parts}) != len(parts):
        return False
    return sum((part.amount for part in parts), ZERO) == line.amount


def split_placed(
    ledger: SeasonLedger, splits: Mapping[int, Sequence[SplitPart]], lines: Iterable[CampLine]
) -> dict[int, Decimal]:
    """D151: each line a person split across requests, and the dollars of it this ledger placed on a request (live
    or closed). A part no request takes stays at family level and is not counted. A split whose parts don't add up
    places nothing (build_ledger leaves the whole line unplaced), so it is not listed even if a rule then placed the
    whole line."""
    sound = {
        line.transaction_cm_id
        for line in lines
        if line.transaction_cm_id in splits and _split_is_sound(line, splits[line.transaction_cm_id])
    }
    placed: dict[int, Decimal] = defaultdict(Decimal)
    for pieces in (*ledger.by_request.values(), *ledger.by_closed_request.values()):
        for piece in pieces:
            if piece.transaction_cm_id in sound:
                placed[piece.transaction_cm_id] += piece.amount
    return dict(placed)


def _pieces(
    lines: Iterable[CampLine], placements: Mapping[int, Placement], splits: Mapping[int, Sequence[SplitPart]]
) -> Iterable[tuple[CampLine, Placement | None]]:
    """Each line with its staff placement, or each part of a split line with the part's own placement.
    A split whose parts don't add up to the line yields the line unplaced."""
    for line in lines:
        parts = splits.get(line.transaction_cm_id)
        if not parts:
            yield line, placements.get(line.transaction_cm_id)
        elif _split_is_sound(line, parts):
            for part in parts:
                yield replace(line, amount=part.amount), part.placement(line.transaction_cm_id)
        else:
            logger.warning(
                "Aid split on transaction %s is not usable; the line stays at family level", line.transaction_cm_id
            )
            yield line, None


def build_ledger(
    lines: Iterable[CampLine],
    placements: Mapping[int, Placement],
    requests: Iterable[PlaceableRequest],
    synced_at: datetime | None,
    posted_request_ids: frozenset[str] = frozenset(),
    at: datetime | None = None,
    *,
    splits: Mapping[int, Sequence[SplitPart]] | None = None,
) -> SeasonLedger:
    """Every camp-aid line placed on its one request, or left at family level. Only live requests
    (active, unmatched) take a line, as the grants register's split does.

    A second pass (D54, SP10a Decision 13) places a line the first pass left unplaced on a closed
    request (withdrawn, duplicate, duplicate_pending) that holds posted money, named by
    `posted_request_ids`, by the same rules. Those lines go to `by_closed_request` only, so they
    can never tick a request, add to Needs an offer or change demand; they exist so CampMinder
    reversing a withdrawn request's posted money can claw it back.

    `at` is a past instant (3c-1's as-of reads): family-level money counts only where it was live then,
    posted by `at` and not yet reversed. The default is the live read.

    `splits` (SP11-rest, D12) are the lines a person split across requests: each part is placed as its
    own line, by its own placement, for its own amount, and a part no request takes waits at family
    level alone. A split whose parts don't add up to the line places nothing: CampMinder never changes
    a posted amount, so that is a bad record, and the whole line waits for a person."""
    everyone = list(requests)
    by_person, by_household = _index(r for r in everyone if r.status in LIVE_REQUEST_STATUSES)
    closed_person, closed_household = _index(
        r for r in everyone if r.status not in LIVE_REQUEST_STATUSES and r.id in posted_request_ids
    )
    placed: dict[str, list[CampLine]] = defaultdict(list)
    closed: dict[str, list[CampLine]] = defaultdict(list)
    unplaced: dict[int, Decimal] = defaultdict(Decimal)
    unplaced_lines: dict[int, list[CampLine]] = defaultdict(list)
    for piece, placement in _pieces(lines, placements, splits or {}):
        own_closed = piece.person_cm_id > 0 and bool(closed_person.get(piece.person_cm_id))
        outcome = _place(piece, placement, by_person, by_household, own_closed, closed_person)
        if isinstance(outcome, str):
            placed[outcome].append(piece)
            continue
        # The second pass runs on ABSENCE only: several live candidates are ambiguity, and stay at family level.
        # A reversed line ignores Go's program there: after a cancel Go re-tags it from what the person is
        # still enrolled in, and the reversal must still reach the closed request for its clawback (D54).
        closed_outcome = (
            _place(piece, placement, closed_person, closed_household, ignore_program=piece.is_reversed)
            if outcome is _Miss.NONE
            else outcome
        )
        if isinstance(closed_outcome, str):
            closed[closed_outcome].append(piece)
        elif piece.live(at):
            unplaced[piece.household_cm_id] += piece.amount
            unplaced_lines[piece.household_cm_id].append(piece)
    return SeasonLedger(
        by_request={rid: tuple(lns) for rid, lns in placed.items()},
        by_closed_request={rid: tuple(lns) for rid, lns in closed.items()},
        unplaced_by_household=dict(unplaced),
        unplaced_lines_by_household={h: tuple(lns) for h, lns in unplaced_lines.items()},
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


def clawed_back_on(
    lines: Sequence[CampLine],
    first_posted_on: date,
    at: datetime | None = None,
    *,
    family_lines: Sequence[CampLine],
) -> date | None:
    """D54: the day CampMinder took back what it held for this request, or None. Nothing placed on it
    is live, and a placed line was reversed on or after its first posted day. A reversal that leaves
    money live reads short instead, and an appeal's reverse-and-repost is never one (the repost is
    live). Derived on every read: a later repost makes the money posted again.

    `family_lines` are the live family-level lines of its D26 households. An unplaced repost may be
    the appeal (reversed on the camper, reposted on a parent), so a family-level line posted on or
    after the request's earliest reversal day blocks the clawback: CampMinder may still hold the money.
    One posted before it cannot be that repost (a repost follows its reversal), so it blocks nothing;
    otherwise a sibling's unplaceable money would switch clawback off for the whole household. A line
    with no post date can't be ordered, so it blocks. A reversed line with no reversal_date never
    counts as a reversal; CampMinder data is not expected to carry one."""
    if any(line.live(at) for line in lines):
        return None
    days = [
        camp_date(line.reversal_date)
        for line in lines
        if line.reversal_date is not None and line.reversed_by(at) and camp_date(line.reversal_date) >= first_posted_on
    ]
    if not days:
        return None
    first_reversed = min(days)
    if any(
        line.post_date is None or camp_date(line.post_date) >= first_reversed for line in family_lines if line.live(at)
    ):
        return None
    return max(days)


def clawback_eligible(status: str, *, cancelled: bool) -> bool:
    """Owner ruling 2026-10-02 (option B, a change to D54): only a request that is cancelled (in CampMinder or in
    Kindred) or closed (withdrawn, or a confirmed duplicate) is clawed back when CampMinder reverses its money,
    which is "To reverse" territory. A LIVE request whose money was fully reversed with no repost stays in Posted,
    and every posted round reads unconfirmed. So does a duplicate_pending one: it is not confirmed, staff still
    resolve it in Requests > Duplicates, and its money stays Posted meanwhile. The one gate the live read, the
    past-date read and To place all pass through."""
    return cancelled or status not in (STATUS_ACTIVE, STATUS_UNMATCHED, STATUS_DUPLICATE_PENDING)


def apply_clawback(
    priced: PricedRequest,
    rounds: Mapping[int, RoundState],
    lines: Sequence[CampLine],
    *,
    eligible: bool,
    at: datetime | None = None,
    family_lines: Sequence[CampLine],
) -> tuple[PricedRequest, date | None]:
    """The request with every posted round marked clawed back when its money came back, and the
    reversal's day; otherwise the same request and None. All of a request's posted rounds go
    together, because reconciliation is by the request's net total (main spec §11). `family_lines`
    is `SeasonLedger.family_lines` over the request's D26 households (`request_scope`). `eligible` is
    `clawback_eligible`'s answer; False returns the request unchanged."""
    posted = [view for view in priced.rounds if view.status == "posted"]
    if not eligible or not posted:
        return priced, None
    first_posted_on = min(_posted_day(rounds.get(view.round)) for view in posted)
    day = clawed_back_on(lines, first_posted_on, at, family_lines=family_lines)
    if day is None:
        return priced, None
    views = tuple(replace(view, clawed_back=True) if view.status == "posted" else view for view in priced.rounds)
    return replace(priced, rounds=views), day


# --- the confirmation state (D59) and the Note (D81) -------------------------------------------

ConfirmationStatus = Literal["awaiting_sync", "confirmed", "short", "over", "not_in_campminder", "reversed"]
NOTE_NOT_TICKED: Final = "in_campminder_not_ticked"


@dataclass(frozen=True)
class ShareConfirmation:
    """One payer share against its own household's lines (main spec §11): `expected` is its
    whole-dollar part of the locked total (split_award)."""

    household_cm_id: int
    expected: Decimal
    in_campminder: Decimal
    status: ConfirmationStatus


@dataclass(frozen=True)
class Confirmation:
    """Beside every Posted figure (D59). `locked` is the locked total of the request's posted rounds
    still counted; `in_campminder` is the net of the live camp-aid lines placed on it. `on` is the
    day behind "confirmed (date)" (the latest live line's camp day), or a reversal's day.
    `family_unplaced` is the family's camp aid no single request takes: shown as its own figure
    (D81), it never enters `status`, `in_campminder` or `gap`."""

    status: ConfirmationStatus
    locked: Decimal
    in_campminder: Decimal
    on: date | None
    shares: tuple[ShareConfirmation, ...]
    family_unplaced: Decimal

    @property
    def gap(self) -> Decimal:
        """In CampMinder minus locked: negative is short, positive is over."""
        return self.in_campminder - self.locked

    @property
    def reconciled(self) -> bool:
        """Off Requests > Not reconciled (D59): confirmed with every share confirmed, or reversed."""
        if self.status == "reversed":
            return True
        return self.status == "confirmed" and all(s.status == "confirmed" for s in self.shares)


def _status(awaiting: bool, held: Decimal, due: Decimal) -> ConfirmationStatus:
    if awaiting:
        return "awaiting_sync"
    if held == due:
        return "confirmed"  # first: a $0 lock with $0 held is a real, confirmed zero (D74)
    if held == 0:
        return "not_in_campminder"
    return "short" if held < due else "over"


# Locks made from money already in CampMinder: the ledger's own tick (D78) and the tick a registrar's
# placement makes (D81, SP11-rest). Neither waits for tonight's sync.
FROM_THE_LEDGER: Final = frozenset({"ledger", "placement"})


def _awaiting(state: RoundState | None, synced_at: datetime | None) -> bool:
    """The tick was made after the last successful ledger sync ("awaiting tonight's sync", D59).
    A tick made from money already in CampMinder never waits for it (FROM_THE_LEDGER)."""
    if state is None or state.lock_source in FROM_THE_LEDGER:
        return False
    return synced_at is None or state.locked_at is None or state.locked_at > synced_at


def _live_net(lines: Iterable[CampLine], at: datetime | None = None) -> Decimal:
    return sum((line.amount for line in lines if line.live(at)), ZERO)


def live_net(lines: Iterable[CampLine]) -> Decimal:
    """The net of the live lines: what CampMinder holds now (main spec §11)."""
    return _live_net(lines)


def locked_total(priced: PricedRequest) -> Decimal:
    """The locked total of the request's posted rounds still counted (a clawed-back round counts nowhere)."""
    return _locked(priced)


def _locked(priced: PricedRequest) -> Decimal:
    """The locked total of the posted rounds still counted (a clawed-back round counts nowhere)."""
    return sum(
        (view.locked or ZERO for view in priced.rounds if view.status == "posted" and not view.clawed_back), ZERO
    )


def _share_lines(
    locked: Decimal,
    shares: Sequence[PayerShareRecord],
    application_household_cm_id: int,
    by_household: Mapping[int, Decimal],
    awaiting: bool,
) -> tuple[ShareConfirmation, ...]:
    if len(shares) < 2:
        return ()  # one payer: the request's own line is the share's
    try:
        due = split_award(locked, shares, application_household_cm_id)
    except PayerShareError:
        return ()  # shares not adding to 100% hold the request (§6.3): no split to check
    return tuple(
        ShareConfirmation(h, amount, by_household.get(h, ZERO), _status(awaiting, by_household.get(h, ZERO), amount))
        for h, amount in sorted(due.items())
    )


def confirmation(
    priced: PricedRequest,
    rounds: Mapping[int, RoundState],
    lines: Sequence[CampLine],
    shares: Sequence[PayerShareRecord],
    application_household_cm_id: int,
    *,
    synced_at: datetime | None,
    family_unplaced: Decimal = ZERO,
    reversed_on: date | None = None,
) -> Confirmation | None:
    """The request's confirmation state, or None while nothing on it is posted. `lines` are the
    lines placed on this request (a closed request passes `SeasonLedger.closed_lines`), never
    family-level money. For a clawed-back request `reversed_on` must be the day `apply_clawback`
    returned: without it the request is read against a locked total of 0, so it reads confirmed when
    nothing is live and over when anything is, never reversed. The season gate (no confirmation
    before the first ticked season) is the caller's."""
    posted = [view for view in priced.rounds if view.status == "posted"]
    if not posted:
        return None
    if reversed_on is not None:
        return Confirmation("reversed", ZERO, ZERO, reversed_on, (), family_unplaced)
    live = [line for line in lines if line.live()]
    held = _live_net(live)
    locked = _locked(priced)
    awaiting = any(_awaiting(rounds.get(view.round), synced_at) for view in posted)
    days = [camp_date(line.post_date) for line in live if line.post_date is not None]
    by_household: dict[int, Decimal] = defaultdict(Decimal)
    for line in live:
        by_household[line.household_cm_id] += line.amount
    return Confirmation(
        status=_status(awaiting, held, locked),
        locked=locked,
        in_campminder=held,
        on=max(days) if days else None,
        shares=_share_lines(locked, shares, application_household_cm_id, by_household, awaiting),
        family_unplaced=family_unplaced,
    )


def _dues_by_payer(
    locks: Mapping[int, Decimal], shares: Sequence[PayerShareRecord], application_household_cm_id: int
) -> dict[int, dict[int, Decimal]] | None:
    """Each payer's part of each round's lock: the move in its whole-dollar share of the cumulative locked total
    (Decision 5), so a payer's parts add up to its share of the whole, as confirmation()'s `expected` reads it.
    None for one payer, or for shares not adding to 100% (read as one payer, as _share_lines does)."""
    if len(shares) < 2:
        return None
    dues: dict[int, dict[int, Decimal]] = defaultdict(dict)
    before: dict[int, Decimal] = {}
    total = ZERO
    try:
        for n in sorted(locks):
            total += locks[n]
            now = split_award(total, shares, application_household_cm_id)
            for household, amount in now.items():
                dues[household][n] = max(amount - before.get(household, ZERO), ZERO)
            before = now
    except PayerShareError:
        return None
    return dues


def round_ledger(
    priced: PricedRequest,
    rounds: Mapping[int, RoundState],
    lines: Sequence[CampLine],
    shares: Sequence[PayerShareRecord],
    application_household_cm_id: int,
    *,
    synced_at: datetime | None,
) -> dict[int, RoundLedger]:
    """Owner ruling ⚠10 (2026-10-02): how much of each posted round CampMinder's live camp-aid net confirms. The net
    fills the request's posted rounds still counted (not clawed back), oldest round first; a round's unconfirmed part
    is its lock less what the net filled. A split request fills each payer's part from that household's own lines,
    and the parts are summed. Money beyond the locked total confirms nothing more (it stays in Not reconciled). Only
    the live net is read, so one line per round and a reverse-and-repost give the same answer. `lines` are the lines
    placed on the request, as confirmation() takes them; the season gate is the caller's."""
    posted = [view for view in priced.rounds if view.status == "posted" and not view.clawed_back]
    if not posted:
        return {}
    locks = {view.round: view.locked or ZERO for view in posted}
    live = [line for line in lines if line.live()]
    dues = _dues_by_payer(locks, shares, application_household_cm_id)
    if dues is None:
        dues, held = {0: dict(locks)}, {0: _live_net(live)}
    else:
        held = {h: _live_net(line for line in live if line.household_cm_id == h) for h in dues}
    unfilled: dict[int, Decimal] = defaultdict(Decimal)
    for payer, due in dues.items():
        left = max(held[payer], ZERO)
        for n in sorted(due):
            filled = min(due[n], left)
            unfilled[n] += due[n] - filled
            left -= filled
    return {
        n: RoundLedger(unconfirmed=unfilled[n], awaiting=_awaiting(rounds.get(n), synced_at)) for n in sorted(locks)
    }


def ledger_note(
    priced: PricedRequest, lines: Sequence[CampLine], family_unplaced: Decimal, *, at: datetime | None = None
) -> CalcIssue | None:
    """D81's amber Note, on a live request with a round not yet ticked, when CampMinder already holds
    money for the family beyond what the request's ticks lock: placed on it, or at family level. A
    Note never stops anything (§4.4); it is there so the registrar doesn't post the family twice.
    The season gate (no Note before the first ticked season) is the caller's. `at`: a past instant
    (3c-2), when only the lines live then count, as `family_unplaced` was built."""
    if not priced.live or all(view.status == "posted" for view in priced.rounds):
        return None
    extra = max(ZERO, _live_net(lines, at) - _locked(priced)) + family_unplaced
    if extra <= 0:
        return None
    return CalcIssue(
        code=NOTE_NOT_TICKED,
        severity="warn",
        message=f"CampMinder shows {dollars(extra)} for this family; not yet ticked",
        step="ledger",
    )


# --- the automatic tick (D78, D81) ----------------------------------------------------------------


@dataclass(frozen=True)
class LedgerTick:
    """One round the ledger ticks: locked at its decided amount (D78), dated the posting's day."""

    request_id: str
    round: int
    amount: Decimal
    posted_on: date
    in_campminder: Decimal


def ledger_ticks(
    priced: Iterable[PricedRequest],
    ledger: SeasonLedger,
    *,
    today: date,
    undone: Collection[tuple[str, int]] = frozenset(),
) -> list[LedgerTick]:
    """D78: where the live camp aid placed on a live request is more than its posted rounds lock,
    tick the oldest round that needs an offer, at its decided amount, and go on to the next while the
    money still covers more. Stop at the first round that can't be ticked (held, pending approval,
    refused, not decided), so a later round is never ticked before the one before it (SP10a). A
    falling net never ticks. Family-level lines are not placed on any request, so they never tick
    (D81). A round a person un-ticked (`undone`) is left for a person to tick again.

    Every round, the first included, needs full cover (in CampMinder >= locked + decided), whichever
    night it runs (D146): a generic camp-aid ("<camp> FA") line can be an outside grant posted before the camp's
    award, so a sliver or a short posting never ticks, and the registrar ticks it by hand. Over-postings
    still tick, at the decided amount. That includes a payer share's Round 2: it waits until the shares
    posted cover it in full."""
    ticks: list[LedgerTick] = []
    for request in priced:
        if not request.live:
            continue
        live = [line for line in ledger.lines(request.request_id) if line.live()]
        in_campminder = sum((line.amount for line in live), ZERO)
        locked = _locked(request)
        if in_campminder <= locked:
            continue
        days = [camp_date(line.post_date) for line in live if line.post_date is not None]
        posted_on = min(max(days), today) if days else today
        for view in sorted(request.rounds, key=lambda v: v.round):
            if view.status == "posted":
                continue
            if (
                view.status != "needs_offer"
                or view.decided is None
                or (request.request_id, view.round) in undone
                # Full cover below implies this for any round above $0; it stops a $0 round ticking on
                # money the earlier rounds already lock.
                or in_campminder <= locked
            ):
                break
            if in_campminder < locked + view.decided:
                break
            ticks.append(LedgerTick(request.request_id, view.round, view.decided, posted_on, in_campminder))
            locked += view.decided
    return ticks


def undone_rounds(events: Iterable[DecisionEvent]) -> frozenset[tuple[str, int]]:
    """The rounds a person un-ticked (SP10a's undo) that nobody has ticked since. The ledger leaves
    them for a person: an undo says the tick was wrong (a wrong family), and a nightly re-tick would
    fight it (SP10b Decision 8)."""
    last: dict[tuple[str, int], str] = {}
    for event in sorted(events, key=lambda e: (e.created, e.id)):
        if event.kind in ("post", "unpost"):
            last[(event.request_id, event.round)] = event.kind
    return frozenset(key for key, kind in last.items() if kind == "unpost")
