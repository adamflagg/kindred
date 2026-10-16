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
"""

from __future__ import annotations

import asyncio
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
    FormIntakeCountsOut,
    FormIntakeResponse,
    FormIntakeRowOut,
    FormIntakeSummaryOut,
    GapSessionOut,
    IntakeSessionOut,
    LookReason,
    RegistrationAskOut,
    UnlistedResponse,
    WhyNot,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_addition_view import addition_view, additions_by_request_key, posted_rounds
from api.services.financial_aid_campminder_money import NoRequestAid, aid_on_no_request_lines, campminder_money
from api.services.financial_aid_cancellations import CancelEvent, fold_cancellations
from api.services.financial_aid_casework_service import _program_for
from api.services.financial_aid_decisions_service import session_pools
from api.services.financial_aid_grants_register import program_family_for_session_type
from api.services.financial_aid_household import enrolled_for
from api.services.financial_aid_household_page import HouseholdLabeler
from api.services.financial_aid_intake_types import (
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
from api.services.financial_aid_reconciliation import CampLine
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
UNLISTED_MAX: Final = 25
_MIN_QUERY: Final = 2
_CAMPER_PROGRAMS: Final = ((PROGRAM_SUMMER, "summer_program", "summer_amount_requested"),
                           (PROGRAM_BMITZVAH, "tbm_program", "tbm_amount_requested"))  # fmt: skip


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
    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]: ...


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
    on_request: dict[tuple[int, int], Decimal] = field(default_factory=dict)


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
        self.households_of: dict[int, set[int]] = defaultdict(set)
        for a in season.attendees:
            self.households_of[a.person_cm_id].add(a.household_cm_id)
            if a.status_id == _ENROLLED:
                self.enrolled_by_person[a.person_cm_id].add(a.session_cm_id)
        self.cancelled = {rid for rid, state in fold_cancellations(season.cancellations).items() if state.reason}
        self.rounds = fold_rounds(season.events)
        self.additions_by_key = additions_by_request_key(season.additions)
        self.aid_by_subject: dict[Subject, list[NoRequestAid]] = defaultdict(list)
        for found in season.no_request:
            self.aid_by_subject[self.d170_subject(found)].append(found)
        self.family_d170: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        for found in season.no_request:
            if found.group is not None:
                self.family_d170[found.group] += found.line.amount

    # -- who a row is for ----------------------------------------------------------------------------------------------

    def program(self, sid: int) -> str | None:
        session = self.s.by_id.get(sid)
        return _program_for(session) if session is not None else None

    def d170_subject(self, found: NoRequestAid) -> Subject:
        """The row a D170 line belongs on: a Family Camp session's is the household's; otherwise the line's camper,
        or the household's one camper enrolled in that session; else the household's own row."""
        line = found.line
        household = found.group[0] if found.group is not None else line.household_cm_id
        session = found.group[1] if found.group is not None else 0
        camper = line.attributed_person_cm_id or line.person_cm_id
        if session and self.program(session) == PROGRAM_FAMILY_CAMP:
            return household, 0
        if camper:
            return household, camper
        if session:
            members = sorted(
                {
                    a.person_cm_id
                    for a in self.s.attendees
                    if a.household_cm_id == household and a.session_cm_id == session and a.status_id == _ENROLLED
                }
            )
            if len(members) == 1:
                return household, members[0]
        return household, 0

    def subjects(self) -> list[Subject]:
        found: set[Subject] = set()
        for row in self.s.fa_rows:
            person_answer = row.summer_program.strip() or row.tbm_program.strip()
            if person_answer or (not row.fc_program.strip() and (row.interest_expressed or row.registration_ask > 0)):
                found.add((row.household_cm_id, row.person_cm_id))
            if row.fc_program.strip():
                found.add((row.household_cm_id, 0))
        found.update((r.household_cm_id, r.person_cm_id) for r in self.s.requests)
        found.update((a.household_cm_id, a.person_cm_id) for a in self.s.additions)
        found.update(self.aid_by_subject)
        return sorted(found)

    # -- one row -------------------------------------------------------------------------------------------------------

    def enrolled(self, subject: Subject) -> list[int]:
        household, person = subject
        if person:
            sessions = self.enrolled_by_person.get(person, set())
        else:
            sessions = set(enrolled_for(household, 0, self.s.sessions, self.s.attendees))
        return sorted(sessions, key=self.key)

    def answers(self, subject: Subject) -> list[FormAnswerOut]:
        household, person = subject
        rows = self.rows_by_household.get(household, [])
        out: list[FormAnswerOut] = []
        if person:
            for row in rows:
                if row.person_cm_id != person:
                    continue
                for program, text_attr, ask_attr in _CAMPER_PROGRAMS:
                    text = str(getattr(row, text_attr)).strip()
                    if text:
                        out.append(
                            FormAnswerOut(program_key=program, option_text=text, ask=float(getattr(row, ask_attr) or 0))
                        )
            return out
        merged: dict[str, FormAnswerOut] = {}
        for row in sorted(rows, key=lambda r: r.person_cm_id):
            text = row.fc_program.strip()
            if not text:
                continue
            known = merged.get(text.casefold())
            ask = max(float(row.fc_amount_requested or 0), known.ask if known else 0.0)
            merged[text.casefold()] = FormAnswerOut(program_key=PROGRAM_FAMILY_CAMP, option_text=text, ask=ask)
        return list(merged.values())

    def registration_ask(self, subject: Subject) -> RegistrationAskOut | None:
        household, person = subject
        if not person:
            return None
        asks = [r.registration_ask for r in self.rows_by_household.get(household, []) if r.person_cm_id == person]
        ask = max(asks, default=0.0)
        return RegistrationAskOut(amount=float(ask)) if ask > 0 else None

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
        )

    def requests_of(self, subject: Subject) -> list[RequestRecord]:
        household, person = subject
        return sorted(
            (r for r in self.s.requests if (r.household_cm_id, r.person_cm_id) == (household, person)),
            key=lambda r: (_STATUS_ORDER.get(r.status, 9), r.program_key, r.id),
        )

    def gaps(self, subject: Subject, requests: Sequence[RequestRecord], enrolled: Sequence[int]) -> list[GapSessionOut]:
        household, person = subject
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
            money = self.family_d170.get((household, sid))
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
        household = subject[0]
        seen: set[int] = set()
        for r in requests:
            if r.status in _LIVE and r.session_cm_id and r.session_cm_id not in seen:
                seen.add(r.session_cm_id)
                money = self.s.on_request.get((household, r.session_cm_id))
                if money:
                    out.append(CampMinderAidOut(session_cm_id=r.session_cm_id, amount=float(money), on_request=True))
        return out

    def row(self, subject: Subject) -> FormIntakeRowOut:
        household, person = subject
        rows = self.rows_by_household.get(household, []) if household else []
        filed = _filed(rows)
        answers = self.answers(subject)
        registration = self.registration_ask(subject)
        registration_only = (
            bool(person) and household > 0 and not filed and (registration is not None or self.interest_only(subject))
        )
        enrolled = self.enrolled(subject)
        requests = self.requests_of(subject)
        became = [self.became(r) for r in requests]
        live = [b for b in became if b.status not in ("withdrawn", "duplicate", "cancelled")]
        gaps = self.gaps(subject, requests, enrolled)
        aid = self.campminder_aid(subject, requests)
        why: WhyNot | None = None
        if household <= 0:
            why = "no_household"
        elif registration_only and not live:
            why = "registration_only"
        elif person and not answers and self.interest_only(subject) and not enrolled and not live:
            why = "adult_not_registered"
        elif gaps:
            why = "enrolled_no_request"
        elif not any(b.status == "active" for b in live) and (
            any(b.why == "not_enrolled" for b in became) or (answers and not enrolled)
        ):
            why = "not_enrolled"
        elif not live and any(b.why == "answer_edited" for b in became):
            why = "answer_edited"
        reasons: list[LookReason] = []
        if any(not a.on_request for a in aid):
            reasons.append("campminder_aid")
        if gaps and not registration_only:
            reasons.append("enrolled_no_request")
        if any(b.status == "session_unclear" and b.candidate_session_cm_ids for b in became):
            reasons.append("session_unclear")
        if any(b.reviewed is False and b.status in ("active", "session_unclear", "duplicate_pending") for b in became):
            reasons.append("registration_ask_unreviewed")
        return FormIntakeRowOut(
            key=f"{household}:{person}",
            household_cm_id=max(household, 0),
            person_cm_id=person,
            filed=filed,
            registration_only=registration_only,
            answers=answers,
            registration_ask=registration,
            enrolled_session_cm_ids=enrolled,
            became=became,
            campminder_aid=aid,
            why_not=why,
            gap_sessions=gaps,
            can_add=household > 0 and bool(gaps),
            needs_look=bool(reasons),
            look_reasons=reasons,
        )


def _counts(rows: Sequence[FormIntakeRowOut]) -> FormIntakeCountsOut:
    return FormIntakeCountsOut(
        needs_look=sum(1 for r in rows if r.needs_look),
        registration_only=sum(1 for r in rows if r.registration_only),
        all=len(rows),
    )


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


@dataclass(frozen=True)
class FormIntakeLook:
    """Today's to-do line (PR 3): Form intake's Needs a look rows, named, in the page's own order."""

    rows: tuple[FormIntakeRowOut, ...]


class FormIntakeService:
    def __init__(
        self,
        store: FormIntakeStore,
        *,
        labels: HouseholdLabeler | None = None,
        grants_waiting: GrantsWaiting | None = None,
        people_search: PeopleSearch | None = None,
    ) -> None:
        self._store = store
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
        placed, _, _ = campminder_money(lines, requests, links)
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
            no_request=aid_on_no_request_lines(lines, requests, links),
            on_request=placed,
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

    async def _rows(self, year: int) -> tuple[_Season, list[FormIntakeRowOut]]:
        season = await self._season(year)
        explainer = _Explainer(season)
        return season, [explainer.row(subject) for subject in explainer.subjects()]

    async def forms(self, year: int) -> FormIntakeResponse:
        season, rows = await self._rows(year)
        named = await self._named(year, rows)
        waiting = await self._grants_waiting(year) if self._grants_waiting is not None else 0
        return FormIntakeResponse(
            year=year,
            rows=named,
            counts=_counts(named),
            sessions=self._sessions(season, _referenced(named)),
            grants_waiting_for_camper=waiting,
            campminder_aid_on_no_request=float(sum((a.line.amount for a in season.no_request), Decimal(0))),
        )

    async def summary(self, year: int) -> FormIntakeSummaryOut:
        _, rows = await self._rows(year)
        counts = _counts(rows)
        return FormIntakeSummaryOut(
            year=year, needs_look=counts.needs_look, registration_only=counts.registration_only, all=counts.all
        )

    async def needs_a_look(self, year: int) -> FormIntakeLook:
        """Today's to-do line: the Needs a look rows, named (one read of the season, as /forms)."""
        _, rows = await self._rows(year)
        look = [r for r in rows if r.needs_look]
        return FormIntakeLook(tuple(await self._named(year, look)) if look else ())

    async def aid_on_no_request(self, year: int) -> AidOnNoRequestResponse:
        """Season's D170 line opened in place (owner Q4-A): one line per family x session, each with what Add a
        Request… pre-fills (session = the posting's, ask and Round 1 = the posted amount)."""
        season, rows = await self._rows(year)
        explainer = _Explainer(season)
        by_key = {r.key: r for r in await self._named(year, rows)}
        pools = session_pools(season.by_id, season.rules)
        groups: dict[tuple[int, int], list[NoRequestAid]] = defaultdict(list)
        for found in season.no_request:
            group = found.group if found.group is not None else (found.line.household_cm_id, 0)
            groups[group].append(found)
        lines: list[AidOnNoRequestLineOut] = []
        for (household, sid), items in groups.items():
            household_of, person = explainer.d170_subject(items[0])
            row = by_key[f"{household_of}:{person}"]
            amount = float(sum((a.line.amount for a in items), Decimal(0)))
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
                        round1_campminder=amount if sid else None,
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
        named = await self._named(year, rows)
        return UnlistedResponse(year=year, rows=named, sessions=self._sessions(season, _referenced(named)))
