"""The adult aid Google Form's requests (adult-aid form design PR 2; owner and registrar answers 2026-10-29).

From 2027 adult-only Family Camp attendees (an "Adult Reg: Family Camp N" registration) and adult-weekend guests ask
for aid on a Google Form. PR 1's Go job `aid_google_form_responses` mirrors each response into aid_form_responses and
matches it to a 2027 person. This module is the pure part of reading that mirror:

  - `form_response_specs`: intake's request specs from the matched, live responses, a spec source BESIDE the
    CampMinder rows and staff's additions, never merged into the household's rows;
  - `form_filed_programs`: the buckets each person filed this form for, so Form intake reads the response as the
    aid form for its bucket (IN-FORM-ONLY).

The rulings it carries:

  - GF-3 = B (owner: "can be the same shape as an adult attending an adult session eg: women's weekend"): each
    response is its own PERSON-level request on the adult's own household (the mirror's household_cm_id, the
    person's own 2027 household), Family Camp included. Two adults of one household at one weekend are two requests.
  - GF-2 = B (owner: "the additional adult may not be the same household, or may be individually employed, not a
    parent, etc."; registrar: "yes, separate payment, separate FA application"): the response's own figures price
    the request. They ride on the spec as `own` answers (aid_requests.answers), in the household answers' shape and
    with its unknown-never-0 rule (choose_household_answers over the one response), and never reach
    choose_household_answers with the household's CampMinder rows, so a household that filed both forms has no
    cross-form income_conflict.
  - The key is "gform:<weekend session id>" (the weekend, not the label, so a relabelled choice is the same
    request), "gform:<normalised choice>" only while the choice maps to no one weekend. request_origin reads it as a
    form answer; form_source as google_form.
  - The session follows registration, as every request's does: the person's ENROLLED sessions in the response's
    weekend set (the weekend and its Adult Reg sessions; counted_enrollments counts an Adult Reg enrolment as its
    weekend). Not enrolled there: Session unclear.
  - Several responses: the newest (last_submitted_at, then responseId) of a person's live linked responses for one
    weekend makes the request; PR 1 marks the job's own older ones superseded, and a staff link it never touches.
  - GF-4 = C / moot (owner: the form is "now uneditedable"; Q6: a second response after a decision is flagged, not
    applied). Before any decision on the request, an edit or a newer response re-applies, and a response deleted in
    Google withdraws it (no spec), as a vanished CampMinder answer does. Once a decision exists (any aid_decisions
    event but a family's ask), a change is NOT applied: the request keeps the figures, ask and response it was
    decided on, and is flagged `form_changed_after_decision` or `form_response_deleted`, until staff Mark Reviewed
    that change (aid_requests.form_change_reviewed holds its fingerprint) or a different one arrives. "Deleted" is
    any response no longer live and linked: deleted in Google, or Ignored or re-linked to someone else by staff.

2026 is frozen: nothing here runs before GOOGLE_FORM_FIRST_SEASON.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

from api.constants.filters import ACTIVE_ENROLLED_STATUS_ID
from api.services.financial_aid_household import (
    OwnAnswers,
    RequestSpec,
    _ask,
    _ask_flags,
    _option_text,
    choose_household_answers,
)
from api.services.financial_aid_intake_types import (
    ANSWERS_SOURCE_GOOGLE_FORM,
    GOOGLE_FORM_KEY_PREFIX,
    PROGRAM_ADULT_WEEKEND,
    PROGRAM_FAMILY_CAMP,
    STATUS_WITHDRAWN,
    AttendeeRow,
    FaRow,
    Flag,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_session_resolver import (
    FAMILY_ADULT,
    counted_enrollments,
    normalize_option_text,
    resolve_session,
)

# IB-2-style year gate, as ADULT_WEEKEND_FORM_ONLY_FIRST_SEASON and IN_BUCKETS_FIRST_SEASON: the adult aid Google
# Form exists from 2027. Every read of the mirror is behind it, so 2026 (the tie-off season) is untouched.
GOOGLE_FORM_FIRST_SEASON: Final = 2027

# aid_form_responses.match_status (PR 1's migration 1500000255): the job's own outcomes, then staff's two and the
# job's supersession. Only a confirmed (auto) or staff-linked response makes a request.
MATCH_AUTO: Final = "auto"
MATCH_STAFF: Final = "staff"
MATCH_IGNORED: Final = "ignored"
MATCH_SUPERSEDED: Final = "superseded"
LINKED_STATUSES: Final = frozenset({MATCH_AUTO, MATCH_STAFF})
# Form intake's "Responses to link": what staff Link… or Ignore….
TO_LINK_STATUSES: Final = frozenset({"suggested", "registered_elsewhere", "not_registered", "unmatched"})
FORM_LIVE: Final = "live"
FORM_DELETED: Final = "deleted"
FORM_PROGRAMS: Final = frozenset({PROGRAM_FAMILY_CAMP, PROGRAM_ADULT_WEEKEND})

# GF-4: a change to a decided request's response, not applied. Information for staff and a Form intake look, never
# a hold: the request is priced on the figures it was decided on.
FLAG_FORM_CHANGED_AFTER_DECISION: Final = "form_changed_after_decision"
FLAG_FORM_RESPONSE_DELETED: Final = "form_response_deleted"
FORM_CHANGE_FLAGS: Final = frozenset({FLAG_FORM_CHANGED_AFTER_DECISION, FLAG_FORM_RESPONSE_DELETED})
# aid_decisions events that are not a decision: a family's Round 2/3 ask is keyed before anything is decided.
_NOT_A_DECISION: Final = frozenset({"ask"})


@dataclass(frozen=True)
class FormResponseRow:
    """One aid_form_responses record, as intake and Form intake read it: never the respondent email, POC,
    race/ethnicity or gender identity (FORM_RESPONSE_READ_FIELDS). `answers` holds the figures under
    financial_aid_applications' column names; an unread figure is 0 with a parse_notes entry whose `read` is null."""

    id: str
    year: int
    response_id: str
    form_status: str
    match_status: str
    person_cm_id: int
    household_cm_id: int
    program_key: str
    weekend_session_cm_id: int
    program_choice: str
    ask: float
    answers: Mapping[str, Any]
    reported_income_fields: frozenset[str] = frozenset()
    parse_notes: Mapping[str, Any] = field(default_factory=dict)
    created_at_google: str = ""
    last_submitted_at: str = ""
    superseded_by: str = ""
    registered_session_cm_id: int = 0
    match_tier: int = 0
    match_candidates: tuple[Mapping[str, Any], ...] = ()
    linked_by: str = ""
    linked_at: str = ""
    ignored_reason: str = ""
    ignored_kind: str = ""  # test | duplicate | not_asking | other ("" until ignored)
    ignored_by: str = ""
    ignored_at: str = ""
    name_typed: str = ""
    county: str = ""
    signature_typed: str = ""
    agreement_date: str = ""

    @property
    def linked(self) -> bool:
        """Live, attached to a person, and confirmed or staff-linked: a response that makes a request."""
        return (
            self.form_status == FORM_LIVE
            and self.match_status in LINKED_STATUSES
            and self.person_cm_id > 0
            and self.program_key in FORM_PROGRAMS
        )

    @property
    def to_link(self) -> bool:
        return self.form_status == FORM_LIVE and self.match_status in TO_LINK_STATUSES

    @property
    def option_key(self) -> str:
        return form_option_key(self.weekend_session_cm_id, self.program_choice)


def form_option_key(weekend_session_cm_id: int, program_choice: str) -> str:
    """The request key of a response: its weekend's id, or its normalised choice while the weekend is unclear."""
    if weekend_session_cm_id > 0:
        return f"{GOOGLE_FORM_KEY_PREFIX}:{int(weekend_session_cm_id)}"
    return f"{GOOGLE_FORM_KEY_PREFIX}:{normalize_option_text(program_choice)}"


def is_form_request(request: RequestRecord) -> bool:
    return request.program_option_key.partition(":")[0] == GOOGLE_FORM_KEY_PREFIX and ":" in request.program_option_key


def decided_request_ids(events: Iterable[Any]) -> frozenset[str]:
    """The requests with a decision: any aid_decisions event but a family's ask (an award, approval, refusal, the
    Posted or Accepted tick, or their undo: staff acted on it)."""
    return frozenset(str(e.request_id) for e in events if str(getattr(e, "kind", "")) not in _NOT_A_DECISION)


def own_answers(row: FormResponseRow) -> dict[str, Any]:
    """The response's figures in the household answers' shape, read exactly as a household's one CampMinder row
    would be (choose_household_answers): an income answer counts only when non-zero or reported, so an unread figure
    stays unknown (None), never 0."""
    as_row = FaRow(
        person_cm_id=row.person_cm_id,
        household_cm_id=row.household_cm_id,
        answers=row.answers,
        summer_program="",
        summer_amount_requested=0.0,
        fc_program="",
        fc_amount_requested=0.0,
        tbm_program="",
        tbm_amount_requested=0.0,
        interest_expressed=False,
        registration_ask=0.0,
        reported_income_fields=row.reported_income_fields,
    )
    answers, _ = choose_household_answers([as_row])
    return answers


def _newest(rows: Iterable[FormResponseRow]) -> FormResponseRow:
    return max(rows, key=lambda r: (r.last_submitted_at, r.response_id))


def linked_by_key(responses: Iterable[FormResponseRow]) -> dict[tuple[int, str, str], FormResponseRow]:
    """Per (person, program, key), the newest live linked response: the one that makes (or would make) the request."""
    groups: dict[tuple[int, str, str], list[FormResponseRow]] = defaultdict(list)
    for row in responses:
        if row.linked:
            groups[(row.person_cm_id, row.program_key, row.option_key)].append(row)
    return {key: _newest(rows) for key, rows in groups.items()}


def weekend_set(weekend_session_cm_id: int, sessions: Sequence[SessionRow]) -> frozenset[int]:
    """The weekend and the Adult Reg sessions paired with it (parent_id)."""
    return frozenset(
        {weekend_session_cm_id}
        | {s.cm_id for s in sessions if s.session_type == FAMILY_ADULT and s.parent_cm_id == weekend_session_cm_id}
    )


@dataclass(frozen=True)
class FormSpecs:
    by_household: Mapping[int, tuple[RequestSpec, ...]] = field(default_factory=dict)
    without_household: int = 0


def _flag(code: str, fingerprint: str, reviewed: str, **detail: Any) -> list[Flag]:
    """A GF-4 flag, unless staff Marked Reviewed this very change."""
    if reviewed == fingerprint:
        return []
    return [Flag(code, {**detail, "fingerprint": fingerprint})]


def form_response_specs(
    year: int,
    responses: Sequence[FormResponseRow],
    sessions: Sequence[SessionRow],
    attendees: Sequence[AttendeeRow],
    requests: Sequence[RequestRecord] = (),
    decided: Collection[str] = frozenset(),
) -> FormSpecs:
    """Intake's request specs from the adult aid form, by household (module docstring). `requests` are the season's
    (the decided ones keep what they were decided on); `decided` the request ids with a decision."""
    if year < GOOGLE_FORM_FIRST_SEASON:
        return FormSpecs()
    enrolled: dict[int, set[int]] = defaultdict(set)
    for a in attendees:
        if a.status_id == ACTIVE_ENROLLED_STATUS_ID:
            enrolled[a.person_cm_id].add(a.session_cm_id)
    chosen = linked_by_key(responses)
    live_by_id = {r.response_id: r for r in responses if r.linked}
    frozen: dict[tuple[int, str, str], RequestSpec] = {}
    held_back: set[str] = set()  # responses a decided request did not apply: they make no request of their own
    for request in sorted(requests, key=lambda r: r.id):
        if not (is_form_request(request) and request.id in decided and request.status != STATUS_WITHDRAWN):
            continue
        if not request.form_response_id:
            continue
        key = (request.person_cm_id, request.program_key, request.program_option_key)
        current = chosen.get(key)
        if current is not None and (current.response_id, current.last_submitted_at) == (
            request.form_response_id,
            request.form_submitted_at,
        ):
            continue  # the response it was decided on, unchanged: built as usual
        changed = current or live_by_id.get(request.form_response_id)
        if changed is not None:
            held_back.add(changed.response_id)
            flags = _flag(
                FLAG_FORM_CHANGED_AFTER_DECISION,
                f"{FLAG_FORM_CHANGED_AFTER_DECISION}:{changed.response_id}@{changed.last_submitted_at}",
                request.form_change_reviewed,
                response_id=changed.response_id,
                submitted_at=changed.last_submitted_at,
            )
        else:
            flags = _flag(
                FLAG_FORM_RESPONSE_DELETED,
                f"{FLAG_FORM_RESPONSE_DELETED}:{request.form_response_id}",
                request.form_change_reviewed,
                response_id=request.form_response_id,
            )
        frozen[key] = _spec(
            request.household_cm_id,
            request.person_cm_id,
            request.program_key,
            request.program_option_key,
            request.program_option_text,
            _weekend_of(request.program_option_key),
            request.ask,
            OwnAnswers(
                dict(request.answers or {}),
                request.answers_source or ANSWERS_SOURCE_GOOGLE_FORM,
                request.form_response_id,
                request.form_submitted_at,
            ),
            sessions,
            frozenset(enrolled.get(request.person_cm_id, set())),
            flags,
        )
    by_household: dict[int, list[RequestSpec]] = defaultdict(list)
    without_household = 0
    for key, row in sorted(chosen.items()):
        if key in frozen or row.response_id in held_back:
            continue
        if row.household_cm_id <= 0:
            without_household += 1
            continue
        by_household[row.household_cm_id].append(
            _spec(
                row.household_cm_id,
                row.person_cm_id,
                row.program_key,
                row.option_key,
                row.program_choice,
                row.weekend_session_cm_id,
                row.ask,
                OwnAnswers(own_answers(row), ANSWERS_SOURCE_GOOGLE_FORM, row.response_id, row.last_submitted_at),
                sessions,
                frozenset(enrolled.get(row.person_cm_id, set())),
                [],
            )
        )
    for spec in frozen.values():
        by_household[spec.household_cm_id].append(spec)
    return FormSpecs({h: tuple(specs) for h, specs in sorted(by_household.items())}, without_household)


def _weekend_of(option_key: str) -> int:
    rest = option_key.partition(":")[2]
    return int(rest) if rest.isdigit() else 0


def _spec(
    household_cm_id: int,
    person_cm_id: int,
    program_key: str,
    option_key: str,
    option_text: str,
    weekend: int,
    ask_value: float,
    own: OwnAnswers,
    sessions: Sequence[SessionRow],
    person_enrolled: frozenset[int],
    extra: list[Flag],
) -> RequestSpec:
    """One person-level request on the response's weekend: registration decides the session, within the weekend set
    when the choice names one weekend, else among the person's enrolments in the program (the choice text breaking a
    tie, as a CampMinder answer's does)."""
    pool = person_enrolled & weekend_set(weekend, sessions) if weekend > 0 else person_enrolled
    text = _option_text(option_text)
    ask = _ask(ask_value)
    return RequestSpec(
        household_cm_id,
        person_cm_id,
        program_key,
        text,
        option_key,
        ask,
        resolve_session(text, program_key, sessions, pool),
        counted_enrollments(program_key, sessions, person_enrolled),
        (*_ask_flags(ask), *extra),
        weekend,
        own,
    )


def form_filed_programs(responses: Iterable[FormResponseRow]) -> dict[int, frozenset[str]]:
    """Per person, the buckets a live linked response of theirs files the aid form for (IN-FORM-ONLY: a matched
    response IS the form for its bucket, for that person)."""
    found: dict[int, set[str]] = defaultdict(set)
    for row in responses:
        if row.linked:
            found[row.person_cm_id].add(row.program_key)
    return {person: frozenset(programs) for person, programs in found.items()}
