"""CampMinder's live camp aid by family x session: the 2026 loader's rule (scripts/financial_aid/load_2026_decisions.py),
and D170's "CampMinder aid on no request", which Rounds & budget shows for 2026 and every season from 2027 from the same split.

Pure functions over records a caller read. Nothing here writes.

The family x session rule (owner, 10-07) is NOT the live ledger's placement (financial_aid_reconciliation.build_ledger):
the ledger puts a line on ONE request, and leaves a household line with several candidates at family level; the loader
asks only which family x session the money is for, so it can put CampMinder's money on that group's requests. D170's
line is the money on no request: a family x session with no request at all (what the drift audit's residue counted),
and, since #49 (owner ruling: PER CAMPER), a camper's own money (d170_person) where only a sibling has a request."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from api.constants.filters import ACTIVE_ENROLLED_STATUS_ID
from api.services.financial_aid_intake_types import (
    PROGRAM_FAMILY_CAMP,
    STATUS_WITHDRAWN,
    AdditionRecord,
    AttendeeRow,
    RequestKey,
    SessionRow,
)
from api.services.financial_aid_ledger_service import family_household_set
from api.services.financial_aid_reconciliation import CampLine
from api.services.financial_aid_session_resolver import PROGRAM_SESSION_TYPES
from bunking.financial_aid.decisions.budget import NO_POOL, TOTAL, OffRequestAid
from bunking.financial_aid.money import ZERO

Group = tuple[int, int]  # (household CampMinder id, session CampMinder id): the family x session (owner, 10-07)


class GroupRequest(Protocol):
    """What the rule reads of a request, of any status: the loader's LoadRequest and the service's RequestRecord."""

    @property
    def household_cm_id(self) -> int: ...
    @property
    def person_cm_id(self) -> int: ...
    @property
    def session_cm_id(self) -> int: ...


def _line_group(
    line: CampLine, requests: Sequence[GroupRequest], linked: Collection[int] = ()
) -> tuple[Group | None, str]:
    """The family x session a live camp-aid line is for, from its own household's requests: Go's attributed session
    (or a staff/sheet pin's), else the session of the attributed camper's one request there, else the household's one
    session. ("", group) when found; else why not: "no_request" (a session the household asked no aid for) or
    "unplaced" (it can't be told).

    The exception is a session-less line Go attributed only to a person (attribution_level "person": one camper with
    several active enrollments, aid_attribution.go). It is "unplaced" before any request is looked at, in its own
    household and in linked ones alike: "the camper's one request" would be a guess, and it would move the money when
    the camper gets a second request. A pin sets the session (or, as a staff person-only override, level "override",
    the person), and only that is a safe signal.

    CampMinder sometimes posts a family's aid under another of its household ids (aid_household_links, D26). Only when
    the line's own household has no request that could take it are the households `linked` to it read the same way,
    and the line then joins the one linked household's family x session that can; the household's own requests always
    come first, so a link never moves money off them."""
    session, person = line.attributed_session_cm_id, line.attributed_person_cm_id
    if not session and person and line.attribution_level == "person":
        return None, "unplaced"

    def takers(households: Collection[int]) -> set[Group]:
        return {
            (r.household_cm_id, r.session_cm_id)
            for r in requests
            if r.household_cm_id in households
            and r.session_cm_id
            and (r.session_cm_id == session if session else not person or r.person_cm_id in (person, 0))
        }

    found = takers({line.household_cm_id}) or takers(set(linked) - {line.household_cm_id})
    if len(found) == 1:
        return found.pop(), ""
    if session:
        return (line.household_cm_id, session), "no_request"
    return None, "unplaced"


def campminder_money(
    lines: Iterable[CampLine],
    requests: Sequence[HoldingRequest],
    links: Iterable[Any] = (),
    *,
    additions: Iterable[AdditionRecord],
) -> tuple[dict[Group, Decimal], dict[Group, Decimal], dict[int, Decimal]]:
    """CampMinder's net live camp aid per family x session that has an aid request; per family x session that has
    none; and per household, what no family x session could take. `links` are the season's aid_household_links rows
    (family_household_set reads them: an excluded row joins nothing).

    `requests` are the season's, every status, and `additions` its aid_request_additions rows: the requests that hold
    money are holding_requests' (an added request staff removed holds none), applied here so no caller can differ."""
    links = list(links)
    holding = holding_requests(requests, additions)
    families: dict[int, list[int]] = {}
    placed: dict[Group, Decimal] = defaultdict(lambda: ZERO)
    no_request: dict[Group, Decimal] = defaultdict(lambda: ZERO)
    unplaced: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for line in lines:
        if not line.live():
            continue
        if line.household_cm_id not in families:
            families[line.household_cm_id] = family_household_set(links, line.household_cm_id)
        group, why = _line_group(line, holding, families[line.household_cm_id])
        if group is None:
            unplaced[line.household_cm_id] += line.amount
        elif why:
            no_request[group] += line.amount
        else:
            placed[group] += line.amount
    return dict(placed), dict(no_request), dict(unplaced)


class HoldingRequest(GroupRequest, Protocol):
    """What holding_requests also reads: the request's status and its key (an addition's request_key)."""

    @property
    def status(self) -> str: ...
    @property
    def key(self) -> RequestKey: ...


def holding_requests[R: HoldingRequest](requests: Iterable[R], additions: Iterable[AdditionRecord]) -> list[R]:
    """The season's requests that hold CampMinder's money for D170: every request of any status (a cancelled or a
    form-withdrawn one still holds its family x session), except an added request staff removed (Remove…: its
    addition retired, its request withdrawn). That one asks for nothing any more, so the money it held is on no
    request again and shows on D170 and in Form intake's amber cell (owner: aid CampMinder posted always shows).
    A removed addition that was added again is live once more, and its request holds the money.

    The D170 functions (campminder_money, D170Reads) apply it themselves: callers pass the raw requests."""
    additions = list(additions)
    live_keys = {a.request_key for a in additions if a.live}
    removed_keys = {a.request_key for a in additions if not a.live} - live_keys
    if not removed_keys:
        return list(requests)
    return [r for r in requests if not (r.status == STATUS_WITHDRAWN and r.key in removed_keys)]


@dataclass(frozen=True)
class NoRequestAid:
    """One live camp-aid line D170 counts: the family x session it is on (`group`), or None when no session can be told
    on a family with no request at all (it counts in TOTAL only)."""

    line: CampLine
    group: Group | None


def d170_person(found: NoRequestAid, family_camp: Callable[[int], bool], attendees: Iterable[AttendeeRow]) -> int:
    """Whose a D170 line's money is (coordinator ruling, follow-up A to PR 3): 0, the household's, on a Family Camp
    session (its request is the household's); else the camper the line credits; else, for a line credited to no
    camper, the household's ONE camper enrolled (status 2) in its session; else 0:
    with two or more siblings there it is offered to none of them and stays on D170.

    Form intake's amber cell, its gaps' campminder_amount, Season's D170 drill-in prefill and Add a Request…'s Round 1
    guard all read this, so a camper is offered exactly the money shown on their row, never the family x session's.
    It also decides which request holds a line (#49, D170Reads): the camper's own, or for the household's money (0)
    any request on the family x session."""
    line = found.line
    household = found.group[0] if found.group is not None else line.household_cm_id
    session = found.group[1] if found.group is not None else 0
    if session and family_camp(session):
        return 0
    camper = line.attributed_person_cm_id or line.person_cm_id
    if camper:
        return camper
    if session:
        members = {
            a.person_cm_id
            for a in attendees
            if a.household_cm_id == household
            and a.session_cm_id == session
            and a.status_id == ACTIVE_ENROLLED_STATUS_ID
        }
        if len(members) == 1:
            return members.pop()
    return 0


def family_camp_sessions(sessions: Iterable[SessionRow]) -> Callable[[int], bool]:
    """D170Reads.family_camp from the season's sessions: a session Family Camp's requests name (casework's
    _program_for, by the same PROGRAM_SESSION_TYPES). An unknown session is not."""
    weekends = {s.cm_id for s in sessions if s.session_type in PROGRAM_SESSION_TYPES[PROGRAM_FAMILY_CAMP]}
    return weekends.__contains__


@dataclass(frozen=True)
class D170Reads:
    """Everything D170 reads besides the lines: the season's requests (EVERY status, unfiltered), its
    aid_request_additions rows, its aid_household_links rows, which sessions are Family Camp's, and its registered
    attendees. The functions below apply holding_requests and d170_person themselves, so Season's figure, its
    drill-in, Form intake and Add a Request…'s guard cannot read the money differently."""

    requests: Sequence[HoldingRequest]
    additions: Sequence[AdditionRecord]
    links: Sequence[Any]
    family_camp: Callable[[int], bool]
    attendees: Sequence[AttendeeRow]


@dataclass(frozen=True)
class _Split:
    no_request: list[NoRequestAid]
    # A line a request holds: its family x session and whose (d170_person). Every line with a group is in exactly one
    # of the two lists (the scan's conservation test pins it).
    held: list[tuple[Group, int, CampLine]]


def _split(lines: Iterable[CampLine], reads: D170Reads) -> _Split:
    holding = holding_requests(reads.requests, reads.additions)
    links = list(reads.links)
    asked = {r.household_cm_id for r in holding}
    sessionless: dict[int, set[int]] = defaultdict(set)
    held_by: set[tuple[int, int, int]] = set()  # (household, camper, session) a holding request names
    for request in holding:
        if not request.session_cm_id:
            sessionless[request.household_cm_id].add(request.person_cm_id)
        else:
            held_by.add((request.household_cm_id, request.person_cm_id, request.session_cm_id))
    families_of: dict[int, list[int]] = {}
    out = _Split([], [])
    for line in lines:
        if not line.live() or not line.amount:
            continue
        household = line.household_cm_id
        if household not in families_of:
            families_of[household] = family_household_set(links, household) or [household]
        family = families_of[household]
        group, why = _line_group(line, holding, family)
        if group is None:
            if asked.isdisjoint(family):
                out.no_request.append(NoRequestAid(line, None))
            continue
        found = NoRequestAid(line, group)
        whose = d170_person(found, reads.family_camp, reads.attendees)
        if why != "no_request" and (not whose or any((h, whose, group[1]) in held_by for h in family)):
            out.held.append((group, whose, line))
            continue
        # #49 (owner ruling: PER CAMPER): a sibling's request does not hold this camper's money; an unmatched request
        # that may be theirs does (the loader may post it at this session). A line credited to no camper is the sole
        # enrolled camper's (d170_person) or, on a Family Camp weekend or with two enrolled, anyone's.
        camper = line.attributed_person_cm_id or line.person_cm_id or whose
        if any(not camper or not p or p == camper for h in family for p in sessionless.get(h, ())):
            out.held.append((group, whose, line))  # held: on the unmatched request, never on D170 as well
        else:
            out.no_request.append(found)
    return out


def aid_on_no_request_lines(lines: Iterable[CampLine], reads: D170Reads) -> list[NoRequestAid]:
    """D170 line by line: each live camp-aid line that matches no request, in the order given. aid_on_no_request sums
    exactly these, so Season's figure, its drill-in (one line per row x session) and Form intake agree.

    Each live line is read by the loader's family x session rule (_line_group, with the household's links, over
    holding_requests), and counts when it lands on:
      - a family x session with no request of any status (a family with no application, a sibling's session the
        household asked nothing for), unless the family holds a request intake matched to no session whose camper is
        the line's (for a line credited to no camper, d170_person's sole enrolled camper), or either camper is unknown
        (0): the loader posts such a request at the sheet's session when an
        override loads a sheet row onto it, and this read, having no sheet, takes any such request to hold that money;
      - a family x session that has requests, none of them its camper's (#49, owner ruling: PER CAMPER). Whose the
        money is is d170_person's: a credited camper's, or for a line credited to no camper the household's one
        enrolled camper's. Only that camper's own request holds it (or, as above, an unmatched one that may be
        theirs). The household's money (a Family Camp weekend's, or a line two enrolled siblings could share) is
        held by any request on the family x session, as before;
      - nothing it can be told, on a family (its household and the households linked to it) with no request at all.
        It has no session (group None).
    Money no one request can take on a family that did ask is not counted: the loader leaves the sheet's decision
    standing for it (its "not placeable on one request"), so it is on a decision already. (Not quite true of a
    person-level credit that waits for a pin beside a pinned award: no decision stands for it, and it is reported
    unplaced until a pin places it.)"""
    return _split(lines, reads).no_request


def aid_on_request(lines: Iterable[CampLine], reads: D170Reads) -> dict[tuple[int, int, int], Decimal]:
    """The other side of D170: CampMinder's live camp aid a request holds, per (household, whose, session), whose
    being d170_person's (0: the household's). Form intake's on-request cell shows a row only its own. With
    aid_on_no_request_lines it covers every line that has a family x session exactly once (an unmatched request's
    money is here, though no on-request cell shows a request with no session)."""
    out: dict[tuple[int, int, int], Decimal] = defaultdict(lambda: ZERO)
    for (household, session), whose, line in _split(lines, reads).held:
        out[(household, whose, session)] += line.amount
    return dict(out)


def aid_on_no_request(
    lines: Iterable[CampLine], reads: D170Reads, pool_of_session: Callable[[int], str | None]
) -> dict[str, OffRequestAid]:
    """D170: CampMinder's live camp aid that matches no request (aid_on_no_request_lines), by budget pool (its
    session's; NO_POOL for a session no program claims) and TOTAL, each with the households it is on. Only scopes
    holding some are keyed. A line with no session counts in TOTAL only."""
    amounts: dict[str, Decimal] = defaultdict(lambda: ZERO)
    families: dict[str, set[int]] = defaultdict(set)
    for found in aid_on_no_request_lines(lines, reads):
        scopes = (TOTAL,) if found.group is None else (pool_of_session(found.group[1]) or NO_POOL, TOTAL)
        for scope in scopes:
            amounts[scope] += found.line.amount
            families[scope].add(found.line.household_cm_id)
    return {scope: OffRequestAid(amounts[scope], len(families[scope])) for scope in amounts}
