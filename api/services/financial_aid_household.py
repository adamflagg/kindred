"""One household application from per-person FA rows, plus its request specs.

financial_aid_applications is one row per PERSON, and the family's financial
answers are copied onto every camper (analysis 5.4 item 4). Income is a
household fact (spec 8), so the answers collapse to one set here, and every
financial field is carried (spec 2 item 22: stored and shown):

* an INCOME figure counts on a row when it is non-zero or the row's
  `reported_income_fields` names it (the FA sync records which income answers
  were given, because the mirror stores a blank as 0). No counted value is
  None: unknown, never 0 (spec principle 5). Two different counted figures are
  ALSO None, with an `income_conflict` flag listing every variant: Kindred
  never picks a figure itself; staff call the family and correct it (spec 8).
* any OTHER number takes the value most rows agree on, ties to the lowest
  person id; 0 means none given, so a field no row answers is None; a
  disagreement raises `household_answer_conflict` for staff.
* a yes/no is true if any row says true; text joins the distinct answers.

Requests are per camper for summer and B*Mitzvah, and per HOUSEHOLD for family
camp (spec 2 item 9): siblings' family-camp answers for the same option merge
into one request carrying the larger ask, with `ask_conflict` when they differ.
Through 2026 an adult-weekend request also built from the registration ask alone,
WW-FA / WW-FA Amount (spec 9.4): the row names no program, and the adult is
registered for an adult weekend. From 2027 it does not (IN-FORM-ONLY = A, owner
2026-10-28; the registrar: intake starts only when someone fills out the aid
FORM, and a registration ask is a signal they may file later). An adult-weekend
request then comes only from the adult-weekend aid form or staff's Add a Request;
the ask stays in the ask history and on Form intake's Registration ask only list.

A request's session comes from REGISTRATION (owner ruling 2026-09-27): the
camper's ENROLLED sessions, or the household's for family camp, resolved by
financial_aid_session_resolver. The answer's option text only breaks a tie, and
the one session it names on its own is carried for the planner's
`session_differs_from_answer` flag.

A second spec source is staff's: every LIVE aid_request_additions row is one
request on its own session, keyed `added:<session_cm_id>`, with a staff
resolution the planner keeps (`addition_request_spec`). A session an addition
holds is not a candidate for the same camper's (or household's) OTHER requests:
a form answer left "Session unclear" between that session and another resolves
to the other once the addition exists. A winter retreat is a summer session type,
so a camper in an in-training session and the retreat has two summer candidates
until the retreat has its own request. Only an UNMATCHED resolution is retried:
an answer that already lands somewhere, the added session included, keeps it,
so a form answer naming the added session becomes duplicate_pending beside it.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from api.constants.filters import ACTIVE_ENROLLED_STATUS_ID
from api.services.financial_aid_intake_types import (
    OPTION_TEXT_MAX_LENGTH,
    PROGRAM_ADULT_WEEKEND,
    PROGRAM_BMITZVAH,
    PROGRAM_FAMILY_CAMP,
    PROGRAM_SUMMER,
    REGISTERED_STATUS_IDS,
    RESOLUTION_STAFF,
    AdditionRecord,
    AttendeeRow,
    FaRow,
    Flag,
    RequestKey,
    SessionResolution,
    SessionRow,
)
from api.services.financial_aid_session_resolver import (
    counted_enrollments,
    normalize_option_text,
    resolve_adult_session,
    resolve_session,
    session_named_by,
)
from bunking.financial_aid.rules.schema import YES_NO_ANSWER_FIELDS

INCOME_FIELDS: Final = ("total_gross_income", "expected_gross_income", "total_adjusted_income", "income_confirmed")
# LIVE QUESTIONS ONLY (owner ruling 2026-09-27): `total_exemptions`, `retirement_accounts`,
# `student_debt` and `other_support_amount` were 0 in 2025 and 2026 alike -- dropped from
# the current CampMinder form -- and are never read here even though the FA mirror still
# stores them.
NUMBER_FIELDS: Final = (
    "total_medical_expenses",
    "total_edu_expenses",
    "total_housing_expenses",
    "total_rent",
    "non_retirement_savings",
    "num_children",
)
# One list, owned by the rules schema: validation and the season warning read the same fields.
BOOL_FIELDS: Final = YES_NO_ANSWER_FIELDS
# `gov_subsidies_detail` (last typed in 2021) and `other_financial_support` (0 in 2025 and
# 2026) are retired the same way (owner ruling 2026-09-27).
TEXT_FIELDS: Final = (
    "special_circumstances",
    "other_support_expectations",
)
HOUSEHOLD_ANSWER_FIELDS: Final = (*INCOME_FIELDS, *NUMBER_FIELDS, *BOOL_FIELDS, *TEXT_FIELDS)

# IN-FORM-ONLY = A (owner 2026-10-28): from this season a registration ask with no aid form makes no adult-weekend
# request. Earlier seasons keep the rule that made their requests: 2026 is the tie-off season (owner guidance
# 2026-10-17), and its adult-weekend requests carry decisions.
ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON: Final = 2027

_PERSON_PROGRAMS: Final = (
    (PROGRAM_SUMMER, "summer_program", "summer_amount_requested"),
    (PROGRAM_BMITZVAH, "tbm_program", "tbm_amount_requested"),
)


def _number(row: FaRow, name: str) -> float:
    return round(float(row.answers.get(name) or 0), 2)


def _holders(values: Sequence[tuple[int, float]]) -> dict[float, list[int]]:
    holders: dict[float, list[int]] = {}
    for person_cm_id, number in values:
        holders.setdefault(number, []).append(person_cm_id)
    return holders


def _variants(holders: dict[float, list[int]]) -> list[dict[str, Any]]:
    return [{"value": value, "person_cm_ids": ids} for value, ids in sorted(holders.items())]


def _choose_income(name: str, rows: Sequence[FaRow]) -> tuple[float | None, list[dict[str, Any]]]:
    counted = [
        (row.person_cm_id, _number(row, name))
        for row in rows
        if _number(row, name) != 0 or name in row.reported_income_fields
    ]
    holders = _holders(counted)
    if len(holders) == 1:
        (value,) = holders
        return value, []
    return None, _variants(holders)  # nothing reported -> []; several figures -> every variant


def _choose_number(name: str, rows: Sequence[FaRow]) -> tuple[float | None, list[dict[str, Any]]]:
    holders = _holders([(row.person_cm_id, _number(row, name)) for row in rows if _number(row, name) != 0])
    if not holders:
        return None, []
    chosen = max(holders, key=lambda value: (len(holders[value]), -min(holders[value])))
    return chosen, (_variants(holders) if len(holders) > 1 else [])


def choose_household_answers(rows: Sequence[FaRow]) -> tuple[dict[str, Any], tuple[Flag, ...]]:
    ordered = sorted(rows, key=lambda row: row.person_cm_id)
    answers: dict[str, Any] = {}
    income: dict[str, list[dict[str, Any]]] = {}
    other: dict[str, list[dict[str, Any]]] = {}
    for name in INCOME_FIELDS:
        value, variants = _choose_income(name, ordered)
        answers[name] = value
        if variants:
            income[name] = variants
    for name in NUMBER_FIELDS:
        value, variants = _choose_number(name, ordered)
        answers[name] = value
        if variants:
            other[name] = variants
    for name in BOOL_FIELDS:
        answers[name] = any(bool(row.answers.get(name)) for row in ordered)
    for name in TEXT_FIELDS:
        texts = (str(row.answers.get(name) or "").strip() for row in ordered)
        answers[name] = "\n\n".join(dict.fromkeys(text for text in texts if text))
    flags: list[Flag] = []
    if income:
        flags.append(Flag("income_conflict", {"fields": income}))
    if other:
        flags.append(Flag("household_answer_conflict", {"fields": other}))
    return answers, tuple(flags)


@dataclass(frozen=True)
class OwnAnswers:
    """A request's own answer set (GF-2 = B, adult-aid form design PR 2): the adult aid form response's figures, in
    the household answers' shape, that price this request alone. `response_id` / `submitted_at` name the response
    applied (Google's responseId and lastSubmittedTime)."""

    answers: Mapping[str, Any]
    source: str
    response_id: str
    submitted_at: str


@dataclass(frozen=True)
class RequestSpec:
    household_cm_id: int
    person_cm_id: int  # 0 for a household-level family-camp request
    program_key: str
    program_option_text: str
    program_option_key: str
    ask: float
    resolution: SessionResolution
    enrolled_session_ids: frozenset[int]
    flags: tuple[Flag, ...]
    # The one in-program session the option text names on its own; 0 when none or several.
    named_session_cm_id: int = 0
    # The request's own answers (an adult aid form response); None prices it from its household application.
    own: OwnAnswers | None = None

    @property
    def key(self) -> RequestKey:
        return (self.household_cm_id, self.person_cm_id, self.program_key, self.program_option_key)


def _ask(value: float) -> float:
    """The family's ask. A negative figure is no ask at all: it is stored as 0 and flagged
    `ask_missing` (aid_requests.ask has a minimum of 0, so PocketBase would refuse it)."""
    return max(float(value or 0), 0.0)


def _ask_flags(ask: float) -> list[Flag]:
    return [Flag("ask_missing", {})] if ask <= 0 else []


def _option_text(value: str) -> str:
    """The FA answer's option text, clipped to what aid_requests.program_option_text holds."""
    return value.strip()[:OPTION_TEXT_MAX_LENGTH]


def _enrolled_sessions(attendees: Sequence[AttendeeRow], match: Any) -> frozenset[int]:
    return frozenset(a.session_cm_id for a in attendees if match(a) and a.status_id == ACTIVE_ENROLLED_STATUS_ID)


def enrolled_for(
    household_cm_id: int, person_cm_id: int, sessions: Sequence[SessionRow], attendees: Sequence[AttendeeRow]
) -> frozenset[int]:
    """The sessions a request's subject is ENROLLED in (status 2): the camper's own, or for a household-level
    (family camp) request the household's, counted as family camp counts them (an Adult Reg enrollment also enrolls
    its weekend). The same sets build_request_specs records for `not_enrolled`."""
    if person_cm_id:
        return _enrolled_sessions(attendees, lambda a: a.person_cm_id == person_cm_id)
    return counted_enrollments(
        PROGRAM_FAMILY_CAMP, sessions, _enrolled_sessions(attendees, lambda a: a.household_cm_id == household_cm_id)
    )


def addition_request_spec(
    addition: AdditionRecord, sessions: Sequence[SessionRow], attendees: Sequence[AttendeeRow]
) -> RequestSpec:
    """The request a live addition stands for. Its session is staff's, so the planner keeps it on every rebuild;
    the subject's enrollments are still carried, so `not_enrolled` fires if they leave the session. The option text
    is the session's name, for display only: the key is `added:<session_cm_id>`."""
    name = next((s.name for s in sessions if s.cm_id == addition.session_cm_id), "")
    ask = _ask(addition.ask)
    return RequestSpec(
        addition.household_cm_id,
        addition.person_cm_id,
        addition.program_key,
        _option_text(name),
        addition.option_key,
        ask,
        SessionResolution(addition.session_cm_id, RESOLUTION_STAFF, (addition.session_cm_id,)),
        enrolled_for(addition.household_cm_id, addition.person_cm_id, sessions, attendees),
        tuple(_ask_flags(ask)),
    )


def _resolve_around(
    text: str,
    program_key: str,
    sessions: Sequence[SessionRow],
    enrolled: frozenset[int],
    held: frozenset[int],
) -> SessionResolution:
    """resolve_session, then once more without the sessions an addition holds when the first try is unmatched
    between candidates that include one. A resolution that already lands is never moved; nor is one that drops to
    no candidates at all."""
    resolution = resolve_session(text, program_key, sessions, enrolled)
    if resolution.session_cm_id or not held.intersection(resolution.candidates):
        return resolution
    narrowed = resolve_session(text, program_key, sessions, enrolled - held)
    return narrowed if narrowed.session_cm_id else resolution


def build_request_specs(
    household_cm_id: int,
    rows: Sequence[FaRow],
    sessions: Sequence[SessionRow],
    attendees: Sequence[AttendeeRow],
    additions: Sequence[AdditionRecord] = (),
    *,
    year: int,
) -> tuple[RequestSpec, ...]:
    """The household's requests for season `year`: one per form answer, then one per LIVE addition (`additions` may
    name any household's; only this one's are used). Before ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON, a registration ask
    alone also makes an adult's adult-weekend request."""

    def sessions_of(match: Any, statuses: frozenset[int]) -> frozenset[int]:
        return frozenset(a.session_cm_id for a in attendees if match(a) and a.status_id in statuses)

    live = [a for a in additions if a.live and a.household_cm_id == household_cm_id]

    def held(person_cm_id: int) -> frozenset[int]:
        return frozenset(a.session_cm_id for a in live if a.person_cm_id == person_cm_id)

    enrolled_only = frozenset({ACTIVE_ENROLLED_STATUS_ID})
    specs: list[RequestSpec] = []
    family: dict[str, list[tuple[int, str, float]]] = {}
    for row in sorted(rows, key=lambda r: r.person_cm_id):
        registered = sessions_of(lambda a, p=row.person_cm_id: a.person_cm_id == p, REGISTERED_STATUS_IDS)
        enrolled = sessions_of(lambda a, p=row.person_cm_id: a.person_cm_id == p, enrolled_only)
        filled = False
        for program_key, text_attr, ask_attr in _PERSON_PROGRAMS:
            text = _option_text(str(getattr(row, text_attr)))
            if not text:
                continue
            filled = True
            ask = _ask(getattr(row, ask_attr))
            resolution = _resolve_around(text, program_key, sessions, enrolled, held(row.person_cm_id))
            specs.append(
                RequestSpec(
                    household_cm_id,
                    row.person_cm_id,
                    program_key,
                    text,
                    normalize_option_text(text),
                    ask,
                    resolution,
                    enrolled,
                    tuple(_ask_flags(ask)),
                    session_named_by(text, program_key, sessions),
                )
            )
        if row.fc_program.strip():
            filled = True
            text = _option_text(row.fc_program)
            family.setdefault(normalize_option_text(text), []).append(
                (row.person_cm_id, text, _ask(row.fc_amount_requested))
            )
        # Before ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON only: the request exists once the adult is REGISTERED for an adult weekend (a
        # waitlisted adult included); its session is set only by an ENROLLED one.
        registration_ask_only = not filled and (row.interest_expressed or row.registration_ask > 0)
        if registration_ask_only and year < ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON:
            if resolve_adult_session(sessions, registered).candidates:
                resolution = resolve_adult_session(sessions, enrolled)
                ask = _ask(row.registration_ask)
                specs.append(
                    RequestSpec(
                        household_cm_id,
                        row.person_cm_id,
                        PROGRAM_ADULT_WEEKEND,
                        "",
                        "",
                        ask,
                        resolution,
                        enrolled,
                        tuple(_ask_flags(ask)),
                    )
                )
    # Counted as family camp counts them: an Adult Reg enrollment also enrolls its weekend.
    household_enrolled = counted_enrollments(
        PROGRAM_FAMILY_CAMP, sessions, sessions_of(lambda a: a.household_cm_id == household_cm_id, enrolled_only)
    )
    for option_key, entries in sorted(family.items()):
        asks = sorted({ask for _, _, ask in entries if ask > 0})
        ask = asks[-1] if asks else 0.0
        flags = _ask_flags(ask)
        if len(asks) > 1:
            flags.append(Flag("ask_conflict", {"asks": asks, "person_cm_ids": [p for p, _, _ in entries]}))
        text = entries[0][1]
        resolution = _resolve_around(text, PROGRAM_FAMILY_CAMP, sessions, household_enrolled, held(0))
        specs.append(
            RequestSpec(
                household_cm_id,
                0,
                PROGRAM_FAMILY_CAMP,
                text,
                option_key,
                ask,
                resolution,
                household_enrolled,
                tuple(flags),
                session_named_by(text, PROGRAM_FAMILY_CAMP, sessions),
            )
        )
    specs.extend(addition_request_spec(a, sessions, attendees) for a in sorted(live, key=lambda a: a.request_key))
    return tuple(specs)
