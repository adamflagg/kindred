"""The registration-ask rule (PR 4b; owner ruling #8 = 8a, 2026-10-16): a registration aid ask makes a request, 2027 on.

CampMinder keeps one "financial assistance" ask per camper per season (CA-FinancialAssistanceAmount), typed on the
registration form, with no session on it. PR 4a keeps our own dated copy of every value it held
(aid_registration_ask_history). This module ties each captured ask to the registration it was typed at, by date, and
for a camper whose household filed the season's aid form, makes the request the family asked for there: a TWR, a
B*Mitzvah, or a summer session for a sibling the form did not name. Pure: intake's build reads the inputs, calls
`registration_ask_additions`, and writes what it returns in its own one operation; Form intake calls it to explain
why a session got no request.

THE MATCH (design §3). For each history row H of the camper with an ask above $0 and a time that parses, S(H) is the
camper's registrations this season, ANY status, whose registration day (`effective_date`, kept by a status change) is
within one day of H's UTC date, or whose status date (`enrollment_date`) is within 24 hours of H. An AG or embedded
session and the main session it sits under (`parent_cm_id`) count as one registration. Then:
  - S(H) is one registration: H is ATTRIBUTED to it; of several rows attributed to one session, the latest wins;
  - S(H) is two or more: H is AMBIGUOUS (one ask, several sessions that day). Family Camp and adult sessions count
    here, so they can make an ask ambiguous, but they are never a target;
  - S(H) is empty: H belongs to no registration.

THE FIRING RULE (design §4.1). A camper's enrollment gets one addition when all hold:
  1. year >= REGISTRATION_ASK_RULE_FIRST_SEASON (2027);
  2. the household filed this season's aid form: some form row in it has a program answer (build_request_specs'
     `filled`);
  3. the enrollment is status 2, in a session the summer program can name (TWR's `teen` included) or a B*Mitzvah;
     never Hebrew school, school or other;
  4. the session is not HELD for the camper (below);
  5. an ask above $0 is attributed to it;
  6. NO aid_request_additions row of any source, live or retired, exists for (year, camper, session). This is what
     makes the rule idempotent and makes Remove permanent: a removed rule-made request is never made again.

HELD (design §4.2). A session is held for the camper when one of their specs this run resolved to it, when it is a
candidate of an unmatched spec or request of theirs, or when they have a request on it in any status but withdrawn.
The one exception: a TWR (`teen`) candidate of an unmatched spec that also has a non-TWR candidate is NOT held. The
resolver counts TWR as summer, so an in-training camper also in TWR has an unmatched summer request between the two;
without the exception the rule would never fire for exactly the TWR asks it exists for. Once the TWR addition exists,
PR 1's drop takes TWR out of that request's candidates and it resolves.

DURABLE (design §4.3). The addition is a stored input with its ask frozen at the attributed amount. A later amount,
a $0 or a new registration in CampMinder never touches it; staff Remove it (permanently) or Cancel it.

The facts it returns beside the additions are the open enrollments the rule could NOT tie to an ask: AMBIGUOUS (the
ask's day registered more than one session) and UNATTRIBUTED (the camper has an ask, but none typed at this
registration; `predates` when every ask is older than it). Intake's report counts them and Form intake shows them as
a why-not."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final

from api.constants.collections import AID_REQUEST_ADDITIONS
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_household import RequestSpec
from api.services.financial_aid_intake_types import (
    ADDITION_SOURCE_REGISTRATION_ASK,
    PROGRAM_BMITZVAH,
    PROGRAM_SUMMER,
    STATUS_WITHDRAWN,
    AdditionRecord,
    FaRow,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_session_resolver import PROGRAM_SESSION_TYPES
from bunking.financial_aid.change_log import AidWrite, new_record_id

# Its own gate, deliberately not FIRST_TICKED_SEASON (financial_aid_decisions_service): that one means "the ledger
# checks Posted from here", and coupling the two would move one with the other. The emergency off is this line.
REGISTRATION_ASK_RULE_FIRST_SEASON: Final = 2027
REGISTRATION_ASK_ACTOR: Final = "system:registration_ask"
# CampMinder's custom-field DEFINITION id for CA-FinancialAssistanceAmount (configuration, not a person). PR 4a also
# records WW-FA Amount (209090), the adult-weekend slot; this rule reads only the camper ask.
REGISTRATION_ASK_FIELD_CM_ID: Final = 28906
ASK_HISTORY_COLLECTION: Final = "aid_registration_ask_history"

ENROLLED: Final = 2
TWR_SESSION_TYPE: Final = "teen"
_DAY_WINDOW: Final = timedelta(days=1)
_STATUS_WINDOW: Final = timedelta(hours=24)
_UNMATCHED_FLAG: Final = "unmatched_session"


@dataclass(frozen=True)
class AskHistoryRow:
    """One aid_registration_ask_history row for the camper ask (field 28906): the value CampMinder held from
    `source_changed_at` (its last_updated, verbatim text). `created` orders rows of one instant (the table's
    autodate)."""

    person_cm_id: int
    amount: float
    source_changed_at: str
    observed_at: str = ""
    created: str = ""


@dataclass(frozen=True)
class AttendeeDates:
    """One attendees row of the season, ANY status, with its two dates (PocketBase strings, "" when unknown):
    `effective_date` the registration day (CampMinder's EffectiveDate: a status change keeps it, a CampMinder bulk
    action can re-date it), `enrollment_date` the date the status last changed (PostDate)."""

    person_cm_id: int
    household_cm_id: int
    session_cm_id: int
    status_id: int
    effective_date: str
    enrollment_date: str


@dataclass(frozen=True)
class AskFact:
    """An open enrollment the rule could not tie to an ask (ambiguous or unattributed). `amount` is the camper's
    newest ask above $0; `predates` (unattributed only): every ask is older than this registration."""

    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    amount: float
    predates: bool = False


@dataclass(frozen=True)
class RegistrationAskResult:
    additions: tuple[AdditionRecord, ...] = ()
    ambiguous: tuple[AskFact, ...] = ()
    unattributed: tuple[AskFact, ...] = ()


def parse_instant(text: Any) -> datetime | None:
    """A time as CampMinder or PocketBase writes it ("2027-10-01T17:02:11.000+00:00", "2027-10-01 17:02:11.000Z",
    "2027-10-01"), in UTC; a naive one is UTC. None when blank or unparseable: such a row is never matched."""
    if isinstance(text, datetime):
        at = text
    else:
        value = str(text or "").strip()
        if not value:
            return None
        try:
            at = datetime.fromisoformat(value)
        except ValueError:
            return None
    return at.replace(tzinfo=UTC) if at.tzinfo is None else at.astimezone(UTC)


def _day(text: str) -> date | None:
    at = parse_instant(text)
    return at.date() if at is not None else None


def target_program(session: SessionRow | None) -> str | None:
    """The program a rule-made request names for this session: summer (TWR's `teen` and the in-training types
    included) or B*Mitzvah. None for everything else: Family Camp, adult weekends, Hebrew school, school, other."""
    if session is None:
        return None
    if session.session_type in PROGRAM_SESSION_TYPES[PROGRAM_BMITZVAH]:
        return PROGRAM_BMITZVAH
    if session.session_type in PROGRAM_SESSION_TYPES[PROGRAM_SUMMER]:
        return PROGRAM_SUMMER
    return None


def filed_households(fa_rows: Iterable[FaRow]) -> frozenset[int]:
    """The households that filed this season's aid form: a program answer (summer, B*Mitzvah or Family Camp) on any
    row, the same predicate as build_request_specs' `filled`."""
    return frozenset(
        r.household_cm_id
        for r in fa_rows
        if r.household_cm_id > 0 and (r.summer_program.strip() or r.tbm_program.strip() or r.fc_program.strip())
    )


def _held_candidates(candidates: Sequence[int], types: Mapping[int, str]) -> set[int]:
    """The candidates of an unmatched spec or request that hold their sessions: all of them, except a TWR candidate
    beside a non-TWR one (§4.2's exception)."""
    non_twr = [c for c in candidates if types.get(c) != TWR_SESSION_TYPE]
    return set(non_twr or candidates)


def _request_candidates(request: RequestRecord) -> list[int]:
    for flag in request.flags:
        if flag.get("code") == _UNMATCHED_FLAG:
            return [int(c) for c in (flag.get("detail") or {}).get("candidates", [])]
    return []


def held_sessions(
    specs: Iterable[RequestSpec], requests: Iterable[RequestRecord], sessions: Sequence[SessionRow]
) -> dict[int, set[int]]:
    """Per camper, the sessions held this run (§4.2): resolved specs, candidates of unmatched specs and requests
    (with the TWR exception), and every request in any status but withdrawn."""
    types = {s.cm_id: s.session_type for s in sessions}
    held: dict[int, set[int]] = defaultdict(set)
    for spec in specs:
        if spec.person_cm_id <= 0:
            continue
        if spec.resolution.session_cm_id:
            held[spec.person_cm_id].add(spec.resolution.session_cm_id)
        else:
            held[spec.person_cm_id].update(_held_candidates(spec.resolution.candidates, types))
    for request in requests:
        if request.person_cm_id <= 0 or request.status == STATUS_WITHDRAWN:
            continue
        if request.session_cm_id:
            held[request.person_cm_id].add(request.session_cm_id)
        else:
            held[request.person_cm_id].update(_held_candidates(_request_candidates(request), types))
    return held


def _matches(ask_at: datetime, row: AttendeeDates) -> bool:
    registered = _day(row.effective_date)
    if registered is not None and abs(ask_at.date() - registered) <= _DAY_WINDOW:
        return True
    status_at = parse_instant(row.enrollment_date)
    return status_at is not None and abs(ask_at - status_at) <= _STATUS_WINDOW


def _registrations(matched: set[int], sessions: Mapping[int, SessionRow]) -> dict[int, set[int]]:
    """The matched sessions as registrations: an AG or embedded session and its parent main session, both matched,
    are one registration, keyed by the parent."""
    units: dict[int, set[int]] = defaultdict(set)
    for sid in matched:
        parent = sessions[sid].parent_cm_id if sid in sessions else 0
        units[parent if parent > 0 and parent in matched else sid].add(sid)
    return units


def _money(amount: float) -> str:
    return f"${amount:,.0f}" if float(amount).is_integer() else f"${amount:,.2f}"


def ask_reason(amount: float, typed_at: datetime) -> str:
    """The evidence in words, the day in camp time (a Pacific evening ask is the next UTC day)."""
    day = typed_at.astimezone(CAMP_TZ).date().isoformat()
    return f"CampMinder registration ask {_money(amount)}, typed {day} at this session's registration"


@dataclass(frozen=True)
class _Ask:
    at: datetime
    order: tuple[str, str]
    amount: float


def registration_ask_additions(
    year: int,
    *,
    fa_rows: Sequence[FaRow],
    sessions: Sequence[SessionRow],
    attendees: Sequence[AttendeeDates],
    history: Sequence[AskHistoryRow],
    additions: Sequence[AdditionRecord],
    requests: Sequence[RequestRecord],
    specs: Iterable[RequestSpec] = (),
) -> RegistrationAskResult:
    """The additions the rule makes this run, and the open enrollments it could not tie to an ask (module docstring).
    `specs` are intake's for this run (Form intake, reading after the run, passes none and reads the requests);
    `additions` are the season's, retired ones included. Nothing at all before the rule's first season."""
    if year < REGISTRATION_ASK_RULE_FIRST_SEASON:
        return RegistrationAskResult()
    by_id = {s.cm_id: s for s in sessions}
    filed = filed_households(fa_rows)
    held = held_sessions(specs, requests, sessions)
    taken = {(a.person_cm_id, a.session_cm_id) for a in additions if a.person_cm_id > 0}

    asks: dict[int, list[_Ask]] = defaultdict(list)
    for row in history:
        at = parse_instant(row.source_changed_at)
        if row.person_cm_id > 0 and row.amount > 0 and at is not None:
            asks[row.person_cm_id].append(_Ask(at, (row.created, row.observed_at), float(row.amount)))
    rows_by_person: dict[int, list[AttendeeDates]] = defaultdict(list)
    for a in attendees:
        rows_by_person[a.person_cm_id].append(a)

    made: list[AdditionRecord] = []
    ambiguous: list[AskFact] = []
    unattributed: list[AskFact] = []
    for person in sorted(asks):
        rows = rows_by_person.get(person, [])
        open_targets = _open_targets(person, rows, by_id, filed, held, taken)
        if not open_targets:
            continue
        attributed: dict[int, _Ask] = {}
        unclear: set[int] = set()
        # Sessions of a registration an ask was tied to: one registration is one request, so an AG (or embedded)
        # session and its parent are one slot. Held or taken on either side closes both (else run 2 would make the
        # parent's request beside the AG's), and the member that is not the target is no "unattributed" gap.
        covered: set[int] = set()
        closed = held.get(person, set()) | {sid for p, sid in taken if p == person}
        for found in asks[person]:
            units = _registrations({r.session_cm_id for r in rows if _matches(found.at, r)}, by_id)
            if len(units) > 1:
                unclear.update(sid for unit in units.values() for sid in unit)
                continue
            for unit in units.values():
                covered.update(unit)
                target = 0 if unit & closed else _unit_target(unit, open_targets, by_id)
                best = attributed.get(target) if target else None
                if target and (best is None or (found.at, found.order) > (best.at, best.order)):
                    attributed[target] = found
        newest = max(asks[person], key=lambda a: (a.at, a.order))
        for sid, (household, program) in sorted(open_targets.items()):
            chosen = attributed.get(sid)
            if chosen is not None:
                made.append(
                    AdditionRecord(
                        id=new_record_id(),
                        year=year,
                        household_cm_id=household,
                        person_cm_id=person,
                        program_key=program,
                        session_cm_id=sid,
                        ask=round(chosen.amount, 2),
                        source=ADDITION_SOURCE_REGISTRATION_ASK,
                        reason=ask_reason(chosen.amount, chosen.at),
                        actor=REGISTRATION_ASK_ACTOR,
                    )
                )
            elif sid in covered:
                continue
            elif sid in unclear:
                ambiguous.append(AskFact(household, person, sid, newest.amount))
            else:
                registered = min(
                    (d for d in (_day(r.effective_date) for r in rows if r.session_cm_id == sid) if d is not None),
                    default=None,
                )
                predates = registered is not None and all(a.at.date() < registered - _DAY_WINDOW for a in asks[person])
                unattributed.append(AskFact(household, person, sid, newest.amount, predates))
    return RegistrationAskResult(tuple(made), tuple(ambiguous), tuple(unattributed))


def _open_targets(
    person: int,
    rows: Sequence[AttendeeDates],
    sessions: Mapping[int, SessionRow],
    filed: frozenset[int],
    held: Mapping[int, set[int]],
    taken: set[tuple[int, int]],
) -> dict[int, tuple[int, str]]:
    """The camper's enrollments the rule may still make a request for, session -> (household, program): status 2 and
    a program the rule names (condition 3), a household that filed (2), not held (4), no addition of any kind (6)."""
    out: dict[int, tuple[int, str]] = {}
    for r in rows:
        sid = r.session_cm_id
        program = target_program(sessions.get(sid))
        if (
            program is not None
            and r.status_id == ENROLLED
            and r.household_cm_id in filed
            and sid not in held.get(person, set())
            and (person, sid) not in taken
        ):
            out[sid] = (r.household_cm_id, program)
    return out


def _unit_target(unit: set[int], open_targets: Mapping[int, object], sessions: Mapping[int, SessionRow]) -> int:
    """The session one registration's ask is for: its open target; of an AG (or embedded) session and its parent both
    open, the one under the parent. 0 when the registration has no open target."""
    found = sorted(sid for sid in unit if sid in open_targets)
    if len(found) > 1:
        under = [sid for sid in found if sessions[sid].parent_cm_id in unit]
        found = under or found
    return found[0] if found else 0


def addition_writes(year: int, additions: Sequence[AdditionRecord]) -> list[AidWrite]:
    """The rule's additions as writes in intake's one operation, each logged `add_request` with its evidence as the
    reason, as a staff add logs its addition (Season › History reads it as "Request added")."""
    return [
        AidWrite(
            collection=AID_REQUEST_ADDITIONS,
            action="create",
            year=year,
            record_id=a.id,
            data={
                "year": a.year,
                "household_cm_id": a.household_cm_id,
                "person_cm_id": a.person_cm_id,
                "program_key": a.program_key,
                "session_cm_id": a.session_cm_id,
                "ask": a.ask,
                "source": a.source,
                "reason": a.reason,
                "actor": a.actor,
            },
            log_action="add_request",
            reason=a.reason,
        )
        for a in additions
    ]
