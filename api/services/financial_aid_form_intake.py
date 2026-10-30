"""Requests › Form intake: the explain service (PR 3; spec 71 §2.4; owner rulings Q1-Q5 all A, 2026-10-15).

Read-only. One row per camper (or per household for a Family Camp request) that the season's aid form, a
registration ask, a request, a staff or rule-made addition, or CampMinder's camp aid on no request names. Each row
says what the form asked, where the camper is enrolled, what intake made of it (every request, any status, and where
it came from), the camp aid CampMinder posted on the family, and why not: a code computed here from intake's own
inputs (the FA mirror, registrations, additions and requests), so there is no table of reasons to keep in step.

The pieces it reuses rather than repeats:
  - intake's own reads (financial_aid_intake_repository) and its enrolled-session sets (financial_aid_household
    .enrolled_for), so a gap is the session intake would see;
  - the program a session belongs to (casework's _program_for, the same guard Add a Request… applies), so every gap
    is one Add a Request… accepts;
  - D170's own line-by-line read (financial_aid_campminder_money.aid_on_no_request_lines), so Form intake's amber money,
    Season's "CampMinder aid on no request" figure and its drill-in lines are one computation.

Needs a look (spec §2.4, owner Q3-A): CampMinder aid on no request; an enrolled session no request holds (not for a
registration-only family: that one counts only once CampMinder posted aid on it); a request whose session is unclear
between enrolled candidates; a rule-made request nobody has marked reviewed (Q2-A).

Registration ask only is judged per person and per bucket from 2027 (IN-BUCKETS, owner 2026-10-28; IB-1 the buckets
are summer, Quest and the teen programs included, B*Mitzvah, Family Camp and adult weekends; IB-2 2027 on). A person
row's camper registration ask (CA-) is for the buckets they are registered in, their adult-weekend ask (WW-) for
adult weekends, each read from its own column pair. A bucket the household filed no aid form for makes the ask
Registration ask only for it (`registration_only_programs`), whatever else the household filed. From 2027 a
person's matched, live adult aid Google Form response is the aid form for its bucket, for that person (PR 2,
IN-FORM-ONLY), so it files Family Camp or adult weekends for them alone. A registration-ask-only bucket's enrolled
sessions need no look, as a registration-only family's never did. 2026, the tie-off season, reads every row exactly as
before: by the household's filing, from the legacy ask pair.

From 2027 the registration-ask rule's own facts explain an enrolled session it made no request for (PR 4b,
financial_aid_registration_ask, run here over the requests intake made): `registration_ask_ambiguous` when the ask's
day also registered another session, `registration_ask_unattributed` when no ask was typed at this registration
(detail `ask_predates_registration` when every ask is older than it). A camper the rule could not decide for gets a
row even when the form never named them.
"""

from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from collections.abc import Awaitable, Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Final, Protocol

from api.schemas.financial_aid_form_intake import (
    AddPrefillOut,
    AidOnNoRequestLineOut,
    AidOnNoRequestResponse,
    BecameOut,
    BecameStatus,
    BecameWhy,
    CampMinderAidOut,
    FormAnswerOut,
    FormCandidateOut,
    FormChangeOut,
    FormFigureOut,
    FormIntakeCountsOut,
    FormIntakeResponse,
    FormIntakeRowOut,
    FormIntakeSummaryOut,
    FormResponseOut,
    FormYesNoOut,
    GapSessionOut,
    GoogleFormStatusOut,
    IntakeSessionOut,
    LookReason,
    RegistrationAskOut,
    SupersededOut,
    UnlistedResponse,
    WhyNot,
    WhyNotDetail,
)
from api.services.aid_season_state import SeasonDoneRead
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_addition_view import addition_view, additions_by_request_key, posted_rounds
from api.services.financial_aid_calc_inputs import session_program_key
from api.services.financial_aid_campminder_money import (
    D170Reads,
    NoRequestAid,
    aid_on_no_request_lines,
    aid_on_request,
    d170_person,
    family_camp_sessions,
)
from api.services.financial_aid_cancellations import CancelEvent, fold_cancellations
from api.services.financial_aid_casework_service import _program_for
from api.services.financial_aid_decisions_service import session_pools
from api.services.financial_aid_google_form import (
    FLAG_FORM_RESPONSE_DELETED,
    FORM_CHANGE_FLAGS,
    GOOGLE_FORM_FIRST_SEASON,
    MATCH_SUPERSEDED,
    FormResponseRow,
    form_filed_programs,
    is_form_request,
    linked_by_key,
)
from api.services.financial_aid_grants_register import program_family_for_session_type
from api.services.financial_aid_household import INCOME_FIELDS, enrolled_for
from api.services.financial_aid_household_page import HouseholdLabeler
from api.services.financial_aid_intake_types import (
    PROGRAM_ADULT_WEEKEND,
    PROGRAM_BMITZVAH,
    PROGRAM_FAMILY_CAMP,
    PROGRAM_SUMMER,
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_DUPLICATE_PENDING,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    AdditionRecord,
    AttendeeRow,
    FaRow,
    RequestRecord,
    SessionRow,
    request_origin,
)
from api.services.financial_aid_ledger_service import family_household_set
from api.services.financial_aid_reconciliation import CampLine
from api.services.financial_aid_registration_ask import (
    REGISTRATION_ASK_RULE_FIRST_SEASON,
    AskFact,
    AskHistoryRow,
    AttendeeDates,
    RegistrationAskResult,
    filed_programs,
    registration_ask_additions,
)
from api.services.financial_aid_session_resolver import FAMILY_ADULT, session_named_by
from bunking.financial_aid.decisions.rounds import DecisionEvent, fold_rounds
from bunking.financial_aid.rules.schema import AidRules

Subject = tuple[int, int]  # (household CampMinder id, person CampMinder id); person 0 = the household's own row
_LIVE: Final = frozenset({STATUS_ACTIVE, STATUS_UNMATCHED, STATUS_DUPLICATE_PENDING})
_ENROLLED: Final = 2
_STATUS_WORDS: Final[Mapping[str, BecameStatus]] = {
    STATUS_ACTIVE: "active",
    STATUS_UNMATCHED: "session_unclear",
    STATUS_DUPLICATE_PENDING: "duplicate_pending",
    STATUS_DUPLICATE: "duplicate",
    STATUS_WITHDRAWN: "withdrawn",
}
_STATUS_ORDER: Final[Mapping[str, int]] = {s: n for n, s in enumerate(_STATUS_WORDS)}
_CLOSED_WORDS: Final[frozenset[BecameStatus]] = frozenset({"duplicate", "withdrawn", "cancelled"})
UNLISTED_MAX: Final = 25
_MIN_QUERY: Final = 2
_CAMPER_PROGRAMS: Final = ((PROGRAM_SUMMER, "summer_program", "summer_amount_requested"),
                           (PROGRAM_BMITZVAH, "tbm_program", "tbm_amount_requested"))  # fmt: skip

# IN-BUCKETS (owner 2026-10-28; IB-2 = 2027 forward only): from this season a person row is judged per bucket, each on
# its own filing, registrations and ask. Earlier seasons keep the household-level reading they were worked under:
# 2026 is the tie-off season (owner guidance 2026-10-17) and its Form intake must read exactly as it did, and history
# before 2026 is loaded from spreadsheets, not intake. Never earlier than ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON: this
# lists an adult-weekend ask as registration-ask-only, which is right only once the ask itself makes no request.
IN_BUCKETS_FIRST_SEASON: Final = 2027
# The order a row names its registration-ask-only buckets in.
_BUCKET_ORDER: Final = (PROGRAM_SUMMER, PROGRAM_BMITZVAH, PROGRAM_FAMILY_CAMP, PROGRAM_ADULT_WEEKEND)
# The buckets a camper registration ask (CA-) can be for: every one but adult weekends, which have their own ask.
_CAMPER_ASK_BUCKETS: Final = frozenset({PROGRAM_SUMMER, PROGRAM_BMITZVAH, PROGRAM_FAMILY_CAMP})


class FormIntakeStore(Protocol):
    async def fetch_fa_rows(self, year: int) -> list[FaRow]: ...
    async def fetch_sessions(self, year: int) -> list[SessionRow]: ...
    async def fetch_registered_attendees(self, year: int) -> list[AttendeeRow]: ...
    async def fetch_request_additions(self, year: int) -> list[AdditionRecord]: ...
    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[RequestRecord]: ...
    async def fetch_decision_events(self, year: int) -> list[DecisionEvent]: ...
    async def fetch_cancellations(self, year: int) -> list[CancelEvent]: ...
    async def fetch_camp_lines(self, year: int, *, recorded_times: bool = False) -> list[CampLine]: ...
    async def fetch_household_links(self, year: int) -> list[Any]: ...
    async def load_intake_rules(self, year: int) -> AidRules | None: ...
    async def fetch_registration_ask_history(self, year: int) -> list[AskHistoryRow]: ...
    async def fetch_attendee_dates(self, year: int) -> list[AttendeeDates]: ...
    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]: ...
    # The adult aid Google Form (PR 2), read from GOOGLE_FORM_FIRST_SEASON only.
    async def fetch_form_response_rows(self, year: int) -> list[FormResponseRow]: ...
    async def fetch_google_form_status(self, year: int) -> dict[str, str] | None: ...


PeopleSearch = Callable[[int, Sequence[str]], Awaitable[list[Any]]]  # (year, name words) -> persons rows (cm_id)
GrantsWaiting = Callable[
    [int], Awaitable[int]
]  # year -> outside grants that wait for a camper (Grants › Needs a camper)


@dataclass(frozen=True)
class _Season:
    """One season's reads, taken once per call."""

    year: int
    fa_rows: list[FaRow]
    sessions: list[SessionRow]
    attendees: list[AttendeeRow]
    additions: list[AdditionRecord]
    requests: list[RequestRecord]
    events: list[DecisionEvent]
    cancellations: list[CancelEvent]
    lines: list[CampLine]
    links: list[Any]
    rules: AidRules | None
    by_id: dict[int, SessionRow] = field(default_factory=dict)
    no_request: list[NoRequestAid] = field(default_factory=list)
    # CampMinder's money a request holds, per (household, whose, session): whose is d170_person's (0: the household's).
    on_request: dict[tuple[int, int, int], Decimal] = field(default_factory=dict)
    # The registration-ask rule's open enrollments it could not tie to an ask (PR 4b; empty before 2027).
    asked: RegistrationAskResult = field(default_factory=RegistrationAskResult)
    # The adult aid Google Form's responses and its last pull (PR 2; empty / None before 2027).
    form_responses: list[FormResponseRow] = field(default_factory=list)
    google_form: Mapping[str, str] | None = None


def _session_key(sessions: Mapping[int, SessionRow]) -> Callable[[int], tuple[str, int]]:
    return lambda sid: (sessions[sid].start_date if sid in sessions else "", sid)


def _day(line: CampLine) -> date | None:
    return line.post_date.astimezone(CAMP_TZ).date() if line.post_date is not None else None


def _latest(lines: Iterable[CampLine]) -> str | None:
    days = [d for d in (_day(line) for line in lines) if d is not None]
    return max(days).isoformat() if days else None


def _filed(rows: Iterable[FaRow]) -> bool:
    """The household filed the aid form: a program answer or an income answer on any of its rows."""
    return any(
        r.summer_program.strip() or r.tbm_program.strip() or r.fc_program.strip() or r.reported_income_fields
        for r in rows
    )


def _asks_camper(row: FaRow) -> bool:
    """The camper registration form's ask (CA-) on this row: its own column pair (IN-BUCKETS, 2027 on)."""
    return row.camper_interest or row.camper_registration_ask > 0


def _asks_weekend(row: FaRow) -> bool:
    """The adult-weekend registration form's ask (WW-) on this row: its own column pair (IN-BUCKETS, 2027 on)."""
    return row.adult_weekend_interest or row.adult_weekend_registration_ask > 0


def _candidates(request: RequestRecord) -> list[int]:
    for flag in request.flags:
        if flag.get("code") == "unmatched_session":
            return [int(c) for c in (flag.get("detail") or {}).get("candidates", [])]
    return []


def _flagged_not_enrolled(request: RequestRecord) -> bool:
    return any(flag.get("code") == "not_enrolled" for flag in request.flags)


class _Explainer:
    """The pure part: rows from one season's reads. Names are filled by the service afterwards."""

    def __init__(self, season: _Season) -> None:
        self.s = season
        sessions = season.by_id
        self.key = _session_key(sessions)
        self.rows_by_household: dict[int, list[FaRow]] = defaultdict(list)
        for row in season.fa_rows:
            self.rows_by_household[row.household_cm_id].append(row)
        self.enrolled_by_person: dict[int, set[int]] = defaultdict(set)
        self.registered_by_person: dict[int, set[int]] = defaultdict(set)  # any status intake reads (enrolled too)
        self.households_of: dict[int, set[int]] = defaultdict(set)
        for a in season.attendees:
            self.households_of[a.person_cm_id].add(a.household_cm_id)
            self.registered_by_person[a.person_cm_id].add(a.session_cm_id)
            if a.status_id == _ENROLLED:
                self.enrolled_by_person[a.person_cm_id].add(a.session_cm_id)
        self.cancelled = {rid for rid, state in fold_cancellations(season.cancellations).items() if state.reason}
        self.rounds = fold_rounds(season.events)
        self.additions_by_key = additions_by_request_key(season.additions)
        self.families: dict[int, frozenset[int]] = {}
        # IN-BUCKETS (2027 on): each bucket judged on its own facts. Set before _homes reads _named_subjects.
        self.by_bucket = season.year >= IN_BUCKETS_FIRST_SEASON
        self.filed_buckets: dict[int, frozenset[str]] = filed_programs(season.fa_rows) if self.by_bucket else {}
        # IN-FORM-ONLY (PR 2): a matched, live adult aid form response IS the aid form for its bucket, for its person.
        self.form_linked = list(linked_by_key(season.form_responses).values())
        self.form_filed: dict[int, frozenset[str]] = form_filed_programs(season.form_responses)
        self.homes = self._homes()
        self.aid_by_subject: dict[Subject, list[NoRequestAid]] = defaultdict(list)
        for found in season.no_request:
            self.aid_by_subject[self.d170_subject(found)].append(found)
        self.ask_facts: tuple[AskFact, ...] = (*season.asked.ambiguous, *season.asked.unattributed)

    # -- who a row is for ----------------------------------------------------------------------------------------------

    def program(self, sid: int) -> str | None:
        session = self.s.by_id.get(sid)
        return _program_for(session) if session is not None else None

    def family(self, household: int) -> frozenset[int]:
        """The household and the households linked to it (aid_household_links), as D170 and the guard read a line."""
        if household not in self.families:
            self.families[household] = frozenset(family_household_set(self.s.links, household) or [household])
        return self.families[household]

    def _raw_subject(self, found: NoRequestAid) -> Subject:
        household = found.group[0] if found.group is not None else found.line.household_cm_id
        return household, d170_person(found, self.family_camp, self.s.attendees)

    def _homes(self) -> dict[tuple[frozenset[int], int], int]:
        """Which household's row a camper's D170 money sits on, per (family, whose): the camper's own row in the
        linked family (a form row, a request or an addition names it), else the lowest household id the money is on.
        So the camper's money across the family is one row's, which is what Add a Request…'s guard accepts (scan row
        2, coordinator ruling)."""
        named: dict[tuple[frozenset[int], int], set[int]] = defaultdict(set)
        for household, person in self._named_subjects():
            if household > 0:
                named[(self.family(household), person)].add(household)
        homes: dict[tuple[frozenset[int], int], int] = {}
        for found in self.s.no_request:
            household, person = self._raw_subject(found)
            key = (self.family(household), person)
            rows = named.get(key)
            if rows:
                homes[key] = min(rows)
            else:
                homes[key] = min(homes.get(key, household), household)
        return homes

    def d170_subject(self, found: NoRequestAid) -> Subject:
        """The row a D170 line belongs on: the camper's row in the linked family (_homes) and whose money it is
        (d170_person: the household's own row on a Family Camp session, or for money no one camper can take)."""
        household, person = self._raw_subject(found)
        return self.homes.get((self.family(household), person), household), person

    def family_camp(self, sid: int) -> bool:
        return self.program(sid) == PROGRAM_FAMILY_CAMP

    def _named_subjects(self) -> set[Subject]:
        """Every row the form, a request or an addition names (CampMinder's money on no request adds the rest)."""
        found: set[Subject] = set()
        for row in self.s.fa_rows:
            person_answer = row.summer_program.strip() or row.tbm_program.strip()
            if self.by_bucket:
                # A Family Camp answer is the household row's, so it hides the person's camper ask only when that ask
                # is for a bucket the household filed (IN-BUCKETS). An adult-weekend ask is never the household row's.
                subject = (row.household_cm_id, row.person_cm_id)
                hidden = bool(row.fc_program.strip()) and not self.unfiled_buckets(subject)
                if person_answer or _asks_weekend(row) or (_asks_camper(row) and not hidden):
                    found.add(subject)
            elif person_answer or (not row.fc_program.strip() and (row.interest_expressed or row.registration_ask > 0)):
                found.add((row.household_cm_id, row.person_cm_id))
            if row.fc_program.strip():
                found.add((row.household_cm_id, 0))
        found.update((r.household_cm_id, r.person_cm_id) for r in self.form_linked if r.household_cm_id > 0)
        found.update((r.household_cm_id, r.person_cm_id) for r in self.s.requests)
        found.update((a.household_cm_id, a.person_cm_id) for a in self.s.additions)
        return found

    def subjects(self) -> list[Subject]:
        asked = {(f.household_cm_id, f.person_cm_id) for f in self.ask_facts}
        return sorted(self._named_subjects() | set(self.aid_by_subject) | asked)

    # -- one row -------------------------------------------------------------------------------------------------------

    def enrolled(self, subject: Subject) -> list[int]:
        household, person = subject
        if person:
            sessions = self.enrolled_by_person.get(person, set())
        else:
            # A household row is its Family Camp request's: its Family Camp weekends, not its campers' sessions.
            sessions = {
                sid
                for sid in enrolled_for(household, 0, self.s.sessions, self.s.attendees)
                if self.program(sid) == PROGRAM_FAMILY_CAMP
            }
        return sorted(sessions, key=self.key)

    def answers(self, subject: Subject) -> list[FormAnswerOut]:
        household, person = subject
        rows = self.rows_by_household.get(household, [])
        out: list[FormAnswerOut] = []
        if person:
            out.extend(
                FormAnswerOut(
                    program_key=r.program_key,
                    option_text=r.program_choice,
                    ask=float(r.ask),
                    named_session_cm_id=r.weekend_session_cm_id,
                    form_source="google_form",
                )
                for r in sorted(self.form_linked, key=lambda r: (r.last_submitted_at, r.response_id))
                if (r.household_cm_id, r.person_cm_id) == subject
            )
            for row in rows:
                if row.person_cm_id != person:
                    continue
                for program, text_attr, ask_attr in _CAMPER_PROGRAMS:
                    text = str(getattr(row, text_attr)).strip()
                    if text:
                        out.append(
                            FormAnswerOut(
                                program_key=program,
                                option_text=text,
                                ask=float(getattr(row, ask_attr) or 0),
                                named_session_cm_id=session_named_by(text, program, self.s.sessions),
                            )
                        )
            return out
        merged: dict[str, FormAnswerOut] = {}
        for row in sorted(rows, key=lambda r: r.person_cm_id):
            text = row.fc_program.strip()
            if not text:
                continue
            known = merged.get(text.casefold())
            ask = max(float(row.fc_amount_requested or 0), known.ask if known else 0.0)
            merged[text.casefold()] = FormAnswerOut(
                program_key=PROGRAM_FAMILY_CAMP,
                option_text=text,
                ask=ask,
                named_session_cm_id=session_named_by(text, PROGRAM_FAMILY_CAMP, self.s.sessions),
            )
        return list(merged.values())

    def own_rows(self, subject: Subject) -> list[FaRow]:
        household, person = subject
        return [r for r in self.rows_by_household.get(household, []) if r.person_cm_id == person]

    def registration_ask(self, subject: Subject) -> RegistrationAskOut | None:
        if not subject[1]:
            return None
        rows = self.own_rows(subject)
        if self.by_bucket:
            # The amount of the ask the row is about: the adult-weekend one when that is its only registration-ask-only
            # bucket, else the camper one, else whichever there is.
            camper = max((r.camper_registration_ask for r in rows), default=0.0)
            weekend = max((r.adult_weekend_registration_ask for r in rows), default=0.0)
            weekend_first = self.unfiled_buckets(subject) == [PROGRAM_ADULT_WEEKEND]
            first, second = (weekend, camper) if weekend_first else (camper, weekend)
            ask = first if first > 0 else second
        else:
            ask = max((r.registration_ask for r in rows), default=0.0)
        return RegistrationAskOut(amount=float(ask)) if ask > 0 else None

    # -- IN-BUCKETS (2027 on) -------------------------------------------------------------------------------------------

    def bucket(self, sid: int) -> str | None:
        """The bucket a session's registration is in: its program, an Adult Reg session its Family Camp weekend's."""
        session = self.s.by_id.get(sid)
        if session is not None and session.session_type == FAMILY_ADULT:
            return PROGRAM_FAMILY_CAMP
        return self.program(sid)

    def asked_at_registration(self, subject: Subject) -> bool:
        return any(_asks_camper(r) or _asks_weekend(r) for r in self.own_rows(subject))

    def ask_buckets(self, subject: Subject) -> set[str]:
        """The buckets the person's registration ask is for: the camper ask (CA-) is for every bucket but adult
        weekends they are registered in (any status intake reads), the adult-weekend ask (WW-) for adult weekends when
        they are registered for one. An ask with no registration in its bucket is for none ("they can't ask for that
        aid without being registered for the correct type of session")."""
        rows = self.own_rows(subject)
        registered = {self.bucket(sid) for sid in self.registered_by_person.get(subject[1], set())}
        out: set[str] = set()
        if any(_asks_camper(r) for r in rows):
            out.update(b for b in registered if b in _CAMPER_ASK_BUCKETS)
        if any(_asks_weekend(r) for r in rows) and PROGRAM_ADULT_WEEKEND in registered:
            out.add(PROGRAM_ADULT_WEEKEND)
        return out

    def unfiled_buckets(self, subject: Subject) -> list[str]:
        """The ask's buckets the household filed no aid form for, in bucket order: registration ask only there."""
        household, person = subject
        if not person or household <= 0:
            return []
        filed = self.filed_buckets.get(household, frozenset()) | self.form_filed.get(person, frozenset())
        asked = self.ask_buckets(subject)
        return [b for b in _BUCKET_ORDER if b in asked and b not in filed]

    def interest_only(self, subject: Subject) -> bool:
        household, person = subject
        return any(
            r.person_cm_id == person
            and not (r.summer_program.strip() or r.tbm_program.strip() or r.fc_program.strip())
            and (r.interest_expressed or r.registration_ask > 0)
            for r in self.rows_by_household.get(household, [])
        )

    def became(self, request: RequestRecord) -> BecameOut:
        origin = request_origin(request.program_option_key)
        rounds = self.rounds.get(request.id, {})
        # The household page's request card builds its addition with the same function, so the two agree.
        addition = addition_view(request, self.additions_by_key, rounds)
        candidates = _candidates(request) if request.status == STATUS_UNMATCHED else []
        status: BecameStatus = _STATUS_WORDS.get(request.status, "withdrawn")
        if request.status in _LIVE and request.id in self.cancelled:
            status = "cancelled"
        why: BecameWhy | None = None
        if request.status == STATUS_WITHDRAWN:
            removed = addition is not None and not addition.live
            why = "answer_edited" if origin == "form" else "removed" if removed else None
        elif (request.status == STATUS_UNMATCHED and not candidates) or _flagged_not_enrolled(request):
            why = "not_enrolled"
        round1 = rounds.get(1)
        return BecameOut(
            request_id=request.id,
            program_key=request.program_key,
            session_cm_id=request.session_cm_id,
            candidate_session_cm_ids=sorted(candidates, key=self.key),
            status=status,
            origin=origin,
            ask=float(request.ask),
            why=why,
            addition_id=addition.addition_id if addition is not None else "",
            added_by=addition.added_by if addition is not None else "",
            added_at=addition.added_at if addition is not None else "",
            added_reason=addition.added_reason if addition is not None else "",
            reviewed=addition.reviewed if addition is not None else None,
            reviewed_by=addition.reviewed_by if addition is not None else "",
            reviewed_at=addition.reviewed_at if addition is not None else "",
            posted_rounds=posted_rounds(rounds),
            round1_posted=float(round1.locked_amount)
            if round1 is not None and round1.posted and round1.locked_amount is not None
            else None,
            form_source="google_form" if is_form_request(request) else None,
            form_change=form_change_out(request),
            price_missing=self.price_missing(request) if self.s.year >= GOOGLE_FORM_FIRST_SEASON else None,
        )

    def price_missing(self, request: RequestRecord) -> bool | None:
        """From 2027: the rules give the request's session no price yet (PR 3's "no price yet"). None when the request
        is not live or has no session: there is nothing to price."""
        if request.status not in _LIVE or request.session_cm_id <= 0:
            return None
        return not session_priced(request.session_cm_id, self.s.by_id, self.s.rules)

    def became_order(self, b: BecameOut) -> tuple[bool, bool, tuple[str, int], str, str]:
        """The Became cell's order (approved polish): live requests first (active, session unclear, duplicate
        pending), then closed ones (duplicate, withdrawn, cancelled), each in session date order (an unclear request
        at its first candidate's; one with no session the season knows, last in its group)."""
        sid = b.session_cm_id or next(iter(b.candidate_session_cm_ids), 0)
        return b.status in _CLOSED_WORDS, sid not in self.s.by_id, self.key(sid), b.program_key, b.request_id

    def requests_of(self, subject: Subject) -> list[RequestRecord]:
        household, person = subject
        return sorted(
            (r for r in self.s.requests if (r.household_cm_id, r.person_cm_id) == (household, person)),
            key=lambda r: (_STATUS_ORDER.get(r.status, 9), r.program_key, r.id),
        )

    def gaps(self, subject: Subject, requests: Sequence[RequestRecord], enrolled: Sequence[int]) -> list[GapSessionOut]:
        person = subject[1]
        held: set[int] = set()
        for r in requests:
            if r.status in _LIVE:
                held.update({r.session_cm_id} if r.session_cm_id else set())
                held.update(_candidates(r))
        out: list[GapSessionOut] = []
        for sid in enrolled:
            program = self.program(sid)
            if program is None or sid in held or (program == PROGRAM_FAMILY_CAMP) != (person == 0):
                continue
            # The camper's own D170 money there, as the amber cell shows it (d170_person), and the guard accepts.
            money = sum(
                (
                    a.line.amount
                    for a in self.aid_by_subject.get(subject, [])
                    if a.group is not None and a.group[1] == sid
                ),
                Decimal(0),
            )
            out.append(
                GapSessionOut(session_cm_id=sid, program_key=program, campminder_amount=float(money) if money else None)
            )
        return out

    def campminder_aid(self, subject: Subject, requests: Sequence[RequestRecord]) -> list[CampMinderAidOut]:
        by_session: dict[int, list[CampLine]] = defaultdict(list)
        for found in self.aid_by_subject.get(subject, []):
            by_session[found.group[1] if found.group is not None else 0].append(found.line)
        out = [
            CampMinderAidOut(
                session_cm_id=sid,
                amount=float(sum((line.amount for line in lines), Decimal(0))),
                posted_on=_latest(lines),
                on_request=False,
            )
            for sid, lines in sorted(by_session.items(), key=lambda kv: self.key(kv[0]))
        ]
        household, person = subject
        family = self.family(household) if household > 0 else frozenset({household})
        seen: set[int] = set()
        for r in requests:
            if r.status in _LIVE and r.session_cm_id and r.session_cm_id not in seen:
                seen.add(r.session_cm_id)
                # #49 (owner ruling: PER CAMPER): only the row's own money on its request, never a sibling's.
                money = sum(
                    (self.s.on_request.get((h, person, r.session_cm_id), Decimal(0)) for h in family), Decimal(0)
                )
                if money:
                    out.append(CampMinderAidOut(session_cm_id=r.session_cm_id, amount=float(money), on_request=True))
        return out

    def ask_why(self, person: int, gaps: Sequence[GapSessionOut]) -> tuple[WhyNot, WhyNotDetail | None]:
        """An enrolled session no request holds: the registration-ask rule's reason when it could not decide for one
        of them (ambiguous before unattributed), else plain enrolled_no_request."""
        sids = {g.session_cm_id for g in gaps}
        facts = [f for f in self.ask_facts if f.person_cm_id == person and f.session_cm_id in sids]
        if any(f in self.s.asked.ambiguous for f in facts):
            return "registration_ask_ambiguous", None
        if facts:
            return "registration_ask_unattributed", (
                "ask_predates_registration" if all(f.predates for f in facts) else None
            )
        return "enrolled_no_request", None

    def _judged_by_household(
        self,
        subject: Subject,
        filed: bool,
        answers: Sequence[FormAnswerOut],
        registration: RegistrationAskOut | None,
        enrolled: Sequence[int],
        became: Sequence[BecameOut],
        live: Sequence[BecameOut],
        gaps: Sequence[GapSessionOut],
    ) -> tuple[bool, WhyNot | None, WhyNotDetail | None]:
        """Before IN_BUCKETS_FIRST_SEASON (2026, the tie-off season): the household's filing decides, from the legacy
        ask pair. Frozen: 2026's Form intake reads exactly as it did."""
        household, person = subject
        registration_only = (
            bool(person) and household > 0 and (registration is not None or self.interest_only(subject)) and not filed
        )
        why: WhyNot | None = None
        detail: WhyNotDetail | None = None
        if household <= 0:
            why = "no_household"
        elif registration_only and not live:
            why = "registration_only"
        elif person and not answers and self.interest_only(subject) and not enrolled and not live:
            why = "adult_not_registered"
        elif gaps:
            why, detail = self.ask_why(person, gaps)
        elif not any(b.status == "active" for b in live) and (
            any(b.why == "not_enrolled" for b in became) or (answers and not enrolled)
        ):
            why = "not_enrolled"
        elif not live and any(b.why == "answer_edited" for b in became):
            why = "answer_edited"
        return registration_only, why, detail

    def _judged_by_bucket(
        self,
        subject: Subject,
        filed: bool,
        answers: Sequence[FormAnswerOut],
        became: Sequence[BecameOut],
        live: Sequence[BecameOut],
        gaps: Sequence[GapSessionOut],
    ) -> tuple[list[str], bool, WhyNot | None, WhyNotDetail | None, list[GapSessionOut]]:
        """From IN_BUCKETS_FIRST_SEASON: the row judged per bucket (IN-BUCKETS). Returns its registration-ask-only
        buckets, registration_only, the why-not and its detail, and the gaps that need a look."""
        household, person = subject
        unfiled = self.unfiled_buckets(subject)
        asked = bool(person) and household > 0 and self.asked_at_registration(subject)
        buckets = self.ask_buckets(subject) if asked else set()
        # A household that filed nothing at all keeps today's reading of an ask with no bucket: registration ask only.
        nowhere = asked and not buckets and not filed
        registration_only = asked and (bool(unfiled) or nowhere)
        # An enrolment in a registration-ask-only bucket needs no look, as a registration-only family's never did.
        look_gaps = [] if nowhere else [g for g in gaps if g.program_key not in unfiled]
        why: WhyNot | None = None
        detail: WhyNotDetail | None = None
        if household <= 0:
            why = "no_household"
        elif registration_only and not look_gaps and (not live or gaps):
            # A gap in a bucket the household filed is the row's first why (it needs a look); else the ask is.
            why = "registration_only"
        elif asked and not answers and not live and not look_gaps and not buckets:
            why = "registration_ask_not_registered"
        elif asked and not answers and not live and not look_gaps and not self.enrolled_in(person, buckets):
            why = "registration_ask_not_enrolled"
        elif look_gaps:
            why, detail = self.ask_why(person, look_gaps)
        elif not any(b.status == "active" for b in live) and (
            any(b.why == "not_enrolled" for b in became)
            or any(not self.enrolled_in(person, {a.program_key}) for a in answers)
        ):
            # Only the answered program's own bucket says whether they are enrolled for it (a Family Camp or B*Mitzvah
            # enrolment says nothing about a summer answer).
            why = "not_enrolled"
        elif not live and any(b.why == "answer_edited" for b in became):
            why = "answer_edited"
        return unfiled, registration_only, why, detail, look_gaps

    def enrolled_in(self, person: int, buckets: Collection[str]) -> bool:
        """The person is enrolled (status 2) in a session of one of these buckets."""
        return any(self.bucket(sid) in buckets for sid in self.enrolled_by_person.get(person, set()))

    def row(self, subject: Subject) -> FormIntakeRowOut:
        household, person = subject
        rows = self.rows_by_household.get(household, []) if household else []
        filed = _filed(rows) or bool(person and self.form_filed.get(person))
        answers = self.answers(subject)
        registration = self.registration_ask(subject)
        enrolled = self.enrolled(subject)
        requests = self.requests_of(subject)
        became = sorted((self.became(r) for r in requests), key=self.became_order)
        live = [b for b in became if b.status not in _CLOSED_WORDS]
        gaps = self.gaps(subject, requests, enrolled)
        aid = self.campminder_aid(subject, requests)
        if self.by_bucket:
            unfiled, registration_only, why, detail, look_gaps = self._judged_by_bucket(
                subject, filed, answers, became, live, gaps
            )
        else:
            unfiled, look_gaps = [], gaps
            registration_only, why, detail = self._judged_by_household(
                subject, filed, answers, registration, enrolled, became, live, gaps
            )
            if registration_only:
                look_gaps = []
        reasons: list[LookReason] = []
        if any(not a.on_request for a in aid):
            reasons.append("campminder_aid")
        if look_gaps:
            reasons.append("enrolled_no_request")
        if any(b.status == "session_unclear" and b.candidate_session_cm_ids for b in became):
            reasons.append("session_unclear")
        if any(b.reviewed is False and b.status in ("active", "session_unclear", "duplicate_pending") for b in became):
            reasons.append("registration_ask_unreviewed")
        # GF-4 (PR 2): a decided request's response changed or vanished in Google, not applied.
        codes = {str(f.get("code")) for r in requests if r.status in _LIVE for f in r.flags}
        reasons.extend(code for code in ("form_changed_after_decision", "form_response_deleted") if code in codes)
        if any(
            (r.household_cm_id, r.person_cm_id) == subject and r.weekend_session_cm_id <= 0 for r in self.form_linked
        ):
            reasons.append("form_choice_unclear")
        return FormIntakeRowOut(
            key=f"{household}:{person}",
            household_cm_id=max(household, 0),
            person_cm_id=person,
            filed=filed,
            registration_only=registration_only,
            registration_only_programs=unfiled,
            answers=answers,
            registration_ask=registration,
            enrolled_session_cm_ids=enrolled,
            became=became,
            campminder_aid=aid,
            why_not=why,
            why_not_detail=detail,
            gap_sessions=gaps,
            can_add=household > 0 and bool(gaps),
            needs_look=bool(reasons),
            look_reasons=reasons,
        )


def _counts(
    rows: Sequence[FormIntakeRowOut], responses: Sequence[FormResponseOut] = (), pull_refused: bool = False
) -> FormIntakeCountsOut:
    """The segment counts. A refused pull (PR 2) is one more Needs a look: its banner shows in every segment."""
    return FormIntakeCountsOut(
        needs_look=sum(1 for r in rows if r.needs_look) + int(pull_refused),
        registration_only=sum(1 for r in rows if r.registration_only),
        all=len(rows),
        to_link=sum(1 for r in responses if r.to_link),
    )


# The figures an adult aid form response gives, in the form's order (design §2).
_FORM_FIGURES: Final = (
    "ask",
    "total_gross_income",
    "income_confirmed",
    "total_adjusted_income",
    "expected_gross_income",
    "total_housing_expenses",
    "non_retirement_savings",
    "total_rent",
    "total_medical_expenses",
    "student_debt",
)
_FORM_YES_NO: Final = ("unemployment", "gov_subsidies")


def _note(row: FormResponseRow, name: str) -> Mapping[str, Any]:
    note = row.parse_notes.get(name)
    return note if isinstance(note, Mapping) else {}


def _figure(row: FormResponseRow, name: str) -> FormFigureOut:
    """A figure as read: unknown (None) when its parse note read nothing, or an income answer left blank."""
    note = _note(row, name)
    raw = row.ask if name == "ask" else row.answers.get(name)
    value: float | None = float(raw or 0)
    if (note and note.get("read") is None) or (
        name in INCOME_FIELDS and not value and name not in row.reported_income_fields
    ):
        value = None
    return FormFigureOut(field=name, value=value, typed=str(note.get("typed") or ""), note=str(note.get("note") or ""))


def form_change_out(request: RequestRecord) -> FormChangeOut | None:
    """GF-4: a decided request's adult aid form change that was not applied: open (its flag), or Mark Reviewed."""
    for flag in request.flags:
        code = str(flag.get("code"))
        if code in FORM_CHANGE_FLAGS:
            detail = dict(flag.get("detail") or {})
            return FormChangeOut(
                kind="deleted" if code == FLAG_FORM_RESPONSE_DELETED else "changed_after_decision",
                at=str(detail.get("submitted_at") or ""),
            )
    if request.form_change_reviewed:
        code = request.form_change_reviewed.partition(":")[0]
        return FormChangeOut(
            kind="deleted" if code == FLAG_FORM_RESPONSE_DELETED else "changed_after_decision",
            at=request.form_change_reviewed_at,
            reviewed=True,
            reviewed_by=request.form_change_reviewed_by,
        )
    return None


def session_priced(session_cm_id: int, sessions: Mapping[int, SessionRow], rules: AidRules | None) -> bool:
    """Whether the approved rules price this session: a catalog program's tuition, or a per-person program's family
    rate (an AG session's parent's when it has none of its own), as the calculator's cost step reads them."""
    if rules is None:
        return False
    program_key = session_program_key(session_cm_id, sessions, rules)
    program = rules.programs.get(program_key) if program_key is not None else None
    if program is None:
        return False
    session = sessions.get(session_cm_id)
    ids = [session_cm_id]
    if session is not None and session.session_type == "ag" and session.parent_cm_id > 0:
        ids.append(session.parent_cm_id)
    if program.cost_source == "catalog":
        return any(rules.cost.tuition.get(sid) is not None for sid in ids)
    if program.cost_source == "per_person":
        return any(r.session_cm_id in ids for r in rules.cost.family_rates)
    return False


# attendees.status_id -> the word a candidate's registration reads (the registered statuses intake reads).
_REGISTRATION_WORDS: Final[dict[int, str]] = {2: "enrolled", 4: "applied", 8: "waitlisted", 512: "incomplete"}


def registration_status(rows: Sequence[AttendeeRow], session_cm_ids: Collection[int]) -> str:
    """A candidate's best registration status in the sessions the evidence names (else any of theirs): enrolled
    before applied, waitlisted, incomplete."""
    named = [a for a in rows if a.session_cm_id in session_cm_ids] or list(rows)
    for status in (2, 4, 8, 512):
        if any(a.status_id == status for a in named):
            return _REGISTRATION_WORDS[status]
    return ""


def candidate_out(raw: Mapping[str, Any]) -> FormCandidateOut:
    return FormCandidateOut(
        person_cm_id=int(raw.get("person_cm_id") or 0),
        household_cm_id=int(raw.get("household_cm_id") or 0),
        signals=[str(s) for s in raw.get("signals") or []],
        session_cm_ids=[int(s) for s in raw.get("session_cm_ids") or []],
        elsewhere=bool(raw.get("elsewhere")),
    )


def _deleted_with_person(row: FormResponseRow) -> bool:
    return row.form_status == "deleted" and row.person_cm_id > 0 and row.household_cm_id > 0


def form_responses_out(season: _Season) -> list[FormResponseOut]:
    """Every response of the season, newest first, as the opened Form intake row shows it (PR 2)."""
    replaced: dict[str, list[FormResponseRow]] = defaultdict(list)
    for row in season.form_responses:
        if row.match_status == MATCH_SUPERSEDED and row.superseded_by:
            replaced[row.superseded_by].append(row)
    out: list[FormResponseOut] = []
    for row in sorted(season.form_responses, key=lambda r: (r.last_submitted_at, r.response_id), reverse=True):
        reasons: list[LookReason] = []
        if row.form_status == "live" and row.program_choice and row.weekend_session_cm_id <= 0:
            reasons.append("form_choice_unclear")
        children = row.answers.get("num_children")
        children_note = _note(row, "num_children")
        out.append(
            FormResponseOut(
                id=row.id,
                response_id=row.response_id,
                # A linked response's row; a deleted one keeps its person's row too (marked, never dropped: PR 3).
                row_key=f"{row.household_cm_id}:{row.person_cm_id}" if row.linked or _deleted_with_person(row) else "",
                match_status=row.match_status,
                form_status="deleted" if row.form_status == "deleted" else "live",
                to_link=row.to_link,
                program_key=row.program_key,
                program_choice=row.program_choice,
                weekend_session_cm_id=row.weekend_session_cm_id,
                person_cm_id=row.person_cm_id,
                household_cm_id=row.household_cm_id,
                submitted_at=row.last_submitted_at,
                created_at=row.created_at_google,
                ask=_figure(row, "ask").value,
                figures=[_figure(row, name) for name in _FORM_FIGURES],
                yes_no=[
                    FormYesNoOut(
                        field=name,
                        value=None if _note(row, name) else bool(row.answers.get(name)),
                        note=str(_note(row, name).get("note") or ""),
                    )
                    for name in _FORM_YES_NO
                ],
                unemployment=None if _note(row, "unemployment") else bool(row.answers.get("unemployment")),
                num_children=None if children_note or children is None else int(float(children)),
                county=row.county,
                special_circumstances=str(row.answers.get("special_circumstances") or ""),
                name_typed=row.name_typed,
                signature_typed=row.signature_typed,
                agreement_date=row.agreement_date,
                match_tier=row.match_tier,
                candidates=[candidate_out(c) for c in row.match_candidates],
                superseded_by=row.superseded_by,
                superseded=[
                    SupersededOut(
                        response_id=r.response_id,
                        submitted_at=r.last_submitted_at,
                        ask=_figure(r, "ask").value,
                        total_gross_income=_figure(r, "total_gross_income").value,
                        replaced_at=row.last_submitted_at,
                    )
                    for r in sorted(replaced.get(row.response_id, []), key=lambda r: r.last_submitted_at)
                ],
                linked_by=row.linked_by,
                linked_at=row.linked_at,
                ignored_kind=row.ignored_kind if row.ignored_kind in _IGNORE_KINDS else "",
                ignored_reason=row.ignored_reason,
                ignored_by=row.ignored_by,
                ignored_at=row.ignored_at,
                look_reasons=reasons,
            )
        )
    return out


_IGNORE_KINDS: Final = frozenset({"test", "duplicate", "not_asking", "other"})
# The job's status line (pocketbase/sync/aid_google_form_responses.go aidFormPullStatus): "refused: N of M responses
# missing" names the live rows the pull expected, and "R responses" what it returned.
_EXPECTED = re.compile(r"refused: \d+ of (\d+) responses missing")
_RETURNED = re.compile(r"(?:^|· )(\d+) responses")


def google_form_out(season: _Season) -> GoogleFormStatusOut | None:
    if season.google_form is None:
        return None
    status = str(season.google_form.get("last_pull_status") or "")
    expected = _EXPECTED.search(status)
    returned = _RETURNED.search(status)
    return GoogleFormStatusOut(
        last_pulled_at=str(season.google_form.get("last_pulled_at") or ""),
        last_pull_status=status,
        refused=status.startswith("refused"),
        returned=int(returned.group(1)) if returned else None,
        expected=int(expected.group(1)) if expected else None,
    )


def _response_sessions(responses: Iterable[FormResponseOut]) -> set[int]:
    """The weekends the adult aid form's responses chose and their candidates registered for (PR 3), so the screen
    names a response no row holds."""
    out: set[int] = set()
    for r in responses:
        out.add(r.weekend_session_cm_id)
        for c in r.candidates:
            out.update(c.session_cm_ids)
    out.discard(0)
    return out


def _referenced(rows: Iterable[FormIntakeRowOut]) -> set[int]:
    out: set[int] = set()
    for r in rows:
        out.update(r.enrolled_session_cm_ids)
        out.update(a.named_session_cm_id for a in r.answers)
        out.update(g.session_cm_id for g in r.gap_sessions)
        out.update(c.session_cm_id for c in r.campminder_aid)
        for b in r.became:
            out.add(b.session_cm_id)
            out.update(b.candidate_session_cm_ids)
    out.discard(0)
    return out


# The Became statuses of a request still waiting with no round when its season closed: they read Closed (CSD-1).
_WAITING_BECAME: Final = frozenset({"session_unclear", "duplicate_pending"})


def close_intake_row(row: FormIntakeRowOut) -> FormIntakeRowOut:
    """A done season's Form intake row (CLOSED-SEASONS-DONE; owner ruling NG-01): it needs no look and offers no Add a
    Request…, and a request still waiting with no posted round (Session unclear, Duplicate pending) became Closed. CampMinder's
    aid stays on the row at its own amounts. Display only: no request changes."""
    return row.model_copy(
        update={
            "needs_look": False,
            "look_reasons": [],
            "can_add": False,
            "became": [
                # A request with a posted round keeps Posted in the grid (close_row), so its entry stays as it is.
                b.model_copy(update={"status": "closed"}) if b.status in _WAITING_BECAME and not b.posted_rounds else b
                for b in row.became
            ],
        }
    )


@dataclass(frozen=True)
class FormIntakeLook:
    """Today's to-do line (PR 3): Form intake's Needs a look rows, named, in the page's own order; and (PR 2) the
    adult aid form responses to link, and whether the form's last pull was refused."""

    rows: tuple[FormIntakeRowOut, ...]
    to_link: int = 0
    pull_refused: bool = False


class FormIntakeService:
    def __init__(
        self,
        store: FormIntakeStore,
        *,
        labels: HouseholdLabeler | None = None,
        grants_waiting: GrantsWaiting | None = None,
        people_search: PeopleSearch | None = None,
        season_done: SeasonDoneRead | None = None,
    ) -> None:
        self._store = store
        self._season_done = season_done  # CLOSED-SEASONS-DONE: a done season's rows read as history (close_intake_row)
        self._labels = labels
        self._grants_waiting = grants_waiting
        self._people_search = people_search

    async def _season(self, year: int) -> _Season:
        store = self._store
        fa_rows, sessions, attendees, additions, requests, events = await asyncio.gather(
            store.fetch_fa_rows(year),
            store.fetch_sessions(year),
            store.fetch_registered_attendees(year),
            store.fetch_request_additions(year),
            store.fetch_requests(year),
            store.fetch_decision_events(year),
        )
        cancellations, lines, links, rules = await asyncio.gather(
            store.fetch_cancellations(year),
            store.fetch_camp_lines(year),
            store.fetch_household_links(year),
            store.load_intake_rules(year),
        )
        # D170's own read, as Season's figure and Add a Request…'s guard make it: the raw requests and additions (an
        # added request staff removed holds no money), and whose each line is (#49: a request holds only its own).
        responses: list[FormResponseRow] = []
        google_form: Mapping[str, str] | None = None
        if year >= GOOGLE_FORM_FIRST_SEASON:
            responses, google_form = await asyncio.gather(
                store.fetch_form_response_rows(year), store.fetch_google_form_status(year)
            )
        d170 = D170Reads(requests, additions, list(links), family_camp_sessions(sessions), attendees)
        asked = RegistrationAskResult()
        if year >= REGISTRATION_ASK_RULE_FIRST_SEASON:
            history, dated = await asyncio.gather(
                store.fetch_registration_ask_history(year), store.fetch_attendee_dates(year)
            )
            asked = registration_ask_additions(
                year,
                fa_rows=fa_rows,
                sessions=sessions,
                attendees=dated,
                history=history,
                additions=additions,
                requests=requests,
            )
        return _Season(
            year=year,
            fa_rows=fa_rows,
            sessions=sessions,
            attendees=attendees,
            additions=additions,
            requests=requests,
            events=events,
            cancellations=cancellations,
            lines=lines,
            links=list(links),
            rules=rules,
            by_id={s.cm_id: s for s in sessions},
            no_request=aid_on_no_request_lines(lines, d170),
            on_request=aid_on_request(lines, d170),
            asked=asked,
            form_responses=responses,
            google_form=google_form,
        )

    async def _named(self, year: int, rows: list[FormIntakeRowOut]) -> list[FormIntakeRowOut]:
        households = {r.household_cm_id for r in rows if r.household_cm_id > 0}
        people = {r.person_cm_id for r in rows if r.person_cm_id > 0}
        family_names, camper_names = await self._store.fetch_names(year, households, people)
        labels = await self._labels(year, households) if self._labels is not None and households else {}
        named: list[FormIntakeRowOut] = []
        for r in rows:
            label = labels.get(r.household_cm_id)
            named.append(
                r.model_copy(
                    update={
                        "camper_name": camper_names.get(r.person_cm_id, "") if r.person_cm_id else "",
                        "household_label": (label.label if label is not None and label.label else "")
                        or (family_names.get(r.household_cm_id, "") if r.household_cm_id else ""),
                        "household_tiebreak": label.tiebreak if label is not None else "",
                    }
                )
            )
        return sorted(named, key=lambda r: ((r.camper_name or r.household_label).casefold(), r.key))

    async def _named_candidates(
        self, year: int, season: _Season, responses: list[FormResponseOut]
    ) -> list[FormResponseOut]:
        """Each response's candidates named as the rows are (PR 3): their name, household label and best
        registration, so Responses to link says who a response may be."""
        found = [c for r in responses for c in r.candidates]
        if not found:
            return responses
        households = {c.household_cm_id for c in found if c.household_cm_id > 0}
        people = {c.person_cm_id for c in found if c.person_cm_id > 0}
        family_names, camper_names = await self._store.fetch_names(year, households, people)
        labels = await self._labels(year, households) if self._labels is not None and households else {}
        registered: dict[int, list[AttendeeRow]] = defaultdict(list)
        for a in season.attendees:
            if a.person_cm_id in people:
                registered[a.person_cm_id].append(a)

        def named(c: FormCandidateOut) -> FormCandidateOut:
            label = labels.get(c.household_cm_id)
            return c.model_copy(
                update={
                    "camper_name": camper_names.get(c.person_cm_id, ""),
                    "household_label": (label.label if label is not None and label.label else "")
                    or family_names.get(c.household_cm_id, ""),
                    "registration_status": registration_status(registered[c.person_cm_id], c.session_cm_ids),
                }
            )

        return [r.model_copy(update={"candidates": [named(c) for c in r.candidates]}) for r in responses]

    @staticmethod
    def _sessions(season: _Season, ids: Iterable[int]) -> list[IntakeSessionOut]:
        key = _session_key(season.by_id)
        return [
            IntakeSessionOut(
                session_cm_id=sid,
                name=season.by_id[sid].name,
                session_type=season.by_id[sid].session_type,
                program_key=_program_for(season.by_id[sid]) or "",
                program_family=program_family_for_session_type(season.by_id[sid].session_type),
            )
            for sid in sorted(set(ids), key=key)
            if sid in season.by_id
        ]

    async def _done(self, year: int) -> bool:
        return await self._season_done(year) if self._season_done is not None else False

    async def _rows(self, year: int) -> tuple[_Season, list[FormIntakeRowOut]]:
        season, done = await asyncio.gather(self._season(year), self._done(year))
        explainer = _Explainer(season)
        rows = [explainer.row(subject) for subject in explainer.subjects()]
        return season, [close_intake_row(r) for r in rows] if done else rows

    async def forms(self, year: int) -> FormIntakeResponse:
        (season, rows), done = await asyncio.gather(self._rows(year), self._done(year))
        named = await self._named(year, rows)
        # A done season's outside grants wait for no camper (nothing here needs doing).
        waiting = await self._grants_waiting(year) if self._grants_waiting is not None and not done else 0
        responses, pull = self._form(season, done)
        responses = await self._named_candidates(year, season, responses)
        return FormIntakeResponse(
            year=year,
            rows=named,
            counts=_counts(named, responses, pull is not None and pull.refused),
            form_responses=responses,
            google_form=pull,
            sessions=self._sessions(season, _referenced(named) | _response_sessions(responses)),
            grants_waiting_for_camper=waiting,
            campminder_aid_on_no_request=float(sum((a.line.amount for a in season.no_request), Decimal(0))),
            season_done=done,
        )

    @staticmethod
    def _form(season: _Season, done: bool) -> tuple[list[FormResponseOut], GoogleFormStatusOut | None]:
        """The adult aid form's responses and pull status (PR 2). A done season has nothing to link and no banner."""
        responses = form_responses_out(season)
        pull = google_form_out(season)
        if done:
            responses = [r.model_copy(update={"to_link": False, "look_reasons": []}) for r in responses]
            pull = pull.model_copy(update={"refused": False}) if pull is not None else None
        return responses, pull

    async def summary(self, year: int) -> FormIntakeSummaryOut:
        (season, rows), done = await asyncio.gather(self._rows(year), self._done(year))
        responses, pull = self._form(season, done)
        counts = _counts(rows, responses, pull is not None and pull.refused)
        return FormIntakeSummaryOut(
            year=year,
            needs_look=counts.needs_look,
            registration_only=counts.registration_only,
            all=counts.all,
            season_done=done,
            to_link=counts.to_link,
        )

    async def needs_a_look(self, year: int) -> FormIntakeLook:
        """Today's to-do line: the Needs a look rows, named (one read of the season, as /forms), the responses to link
        and a refused pull."""
        (season, rows), done = await asyncio.gather(self._rows(year), self._done(year))
        responses, pull = self._form(season, done)
        look = [r for r in rows if r.needs_look]
        return FormIntakeLook(
            tuple(await self._named(year, look)) if look else (),
            to_link=sum(1 for r in responses if r.to_link),
            pull_refused=pull is not None and pull.refused,
        )

    async def aid_on_no_request(self, year: int) -> AidOnNoRequestResponse:
        """Season's D170 line opened in place (owner Q4-A): one line per Form intake row x session (the camper's own
        money, d170_person, or the household's), each with what Add a Request… pre-fills (session = the posting's, ask
        = the posted amount, and Round 1 = it when the money is that camper's or a Family Camp household's)."""
        (season, rows), done = await asyncio.gather(self._rows(year), self._done(year))
        explainer = _Explainer(season)
        by_key = {r.key: r for r in await self._named(year, rows)}
        pools = session_pools(season.by_id, season.rules)
        # One line per row x session: a camper's own money (d170_person), so two credited siblings in one session are
        # two lines, each offering its own amount; money no one camper can take is the household's line, offered to
        # no camper (no Round 1 box), as on Form intake.
        groups: dict[tuple[int, int, int], list[NoRequestAid]] = defaultdict(list)
        for found in season.no_request:
            household, person = explainer.d170_subject(found)
            groups[(household, person, found.group[1] if found.group is not None else 0)].append(found)
        lines: list[AidOnNoRequestLineOut] = []
        for (household, person, sid), items in groups.items():
            row = by_key[f"{household}:{person}"]
            amount = float(sum((a.line.amount for a in items), Decimal(0)))
            offered = bool(sid) and (bool(person) or explainer.family_camp(sid))
            lines.append(
                AidOnNoRequestLineOut(
                    row_key=row.key,
                    household_cm_id=household,
                    household_label=row.household_label,
                    household_tiebreak=row.household_tiebreak,
                    person_cm_id=person,
                    camper_name=row.camper_name,
                    session_cm_id=sid,
                    pool=pools.get(sid) if sid else None,
                    amount=amount,
                    posted_on=_latest(a.line for a in items),
                    prefill=AddPrefillOut(
                        household_cm_id=household,
                        person_cm_id=person,
                        session_cm_id=sid,
                        ask=amount,
                        round1_campminder=amount if offered else None,
                    ),
                    can_add=row.can_add,
                    gap_sessions=row.gap_sessions,
                )
            )
        lines.sort(key=lambda line: (-line.amount, (line.camper_name or line.household_label).casefold()))
        return AidOnNoRequestResponse(
            year=year,
            total=float(sum((a.line.amount for a in season.no_request), Decimal(0))),
            families=len({a.line.household_cm_id for a in season.no_request}),
            lines=lines,
            # Every session a line's row names (its gaps above all): the Add a Request… picker offers them by name.
            sessions=self._sessions(
                season, {line.session_cm_id for line in lines} | _referenced(by_key[line.row_key] for line in lines)
            ),
            season_done=done,
        )

    async def unlisted(self, year: int, query: str) -> UnlistedResponse:
        """Find a Camper Not Listed…: campers enrolled this season (status 2) on no row, by name words or a person
        id, in the row shape so Add a Request… works on them."""
        text = query.strip()
        if len(text) < _MIN_QUERY:
            return UnlistedResponse(year=year, rows=[], sessions=[])
        season = await self._season(year)
        explainer = _Explainer(season)
        listed = {person for _, person in explainer.subjects() if person}
        if text.isdigit():
            wanted = {int(text)}
        else:
            words = [w[:40] for w in text.split()][:4]
            found = await self._people_search(year, words) if self._people_search is not None else []
            wanted = {int(getattr(p, "cm_id", 0) or 0) for p in found}
        subjects: list[Subject] = []
        for person in sorted(wanted - listed - {0}):
            if not explainer.enrolled_by_person.get(person):
                continue
            households = sorted(explainer.households_of.get(person, set()))
            subjects.append((households[0] if households else 0, person))
        rows = [explainer.row(subject) for subject in subjects[:UNLISTED_MAX]]
        if await self._done(year):
            rows = [close_intake_row(r) for r in rows]
        named = await self._named(year, rows)
        return UnlistedResponse(year=year, rows=named, sessions=self._sessions(season, _referenced(named)))
