"""Shared fixtures for the adult aid Google Form tests (adult-aid form design, PR 2).

A response as the PR 1 job mirrors it into aid_form_responses: the figures under the same column names as
financial_aid_applications, `reported_income_fields` naming the income answers given (0 included), and a
`parse_notes` entry with `read` null for every figure Kindred could not read (stored as 0: unknown, never 0).
Fictional data only (tests/CLAUDE.md): ids from 1000001 up, generic session names.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from typing import Any

from api.services.financial_aid_google_form import FormResponseRow
from api.services.financial_aid_intake_types import AttendeeRow, FaRow, SessionRow
from tests.unit.api.services.financial_aid_fakes import SESSIONS, FakeAidStore, intake_rules

ACTOR = "registrar@example.com"

ADULT_WEEKEND_A = 1000401  # "Adult Weekend A", session type adult
ADULT_WEEKEND_B = 1000402
FAMILY_CAMP_6 = 1000202  # "Family Camp 6", session type family
ADULT_REG_6 = 1000203  # "Adult Reg: Family Camp 6", family_adult, parent = Family Camp 6

GFORM_SESSIONS: tuple[SessionRow, ...] = (
    *SESSIONS,
    SessionRow(ADULT_REG_6, "Adult Reg: Family Camp 6", "family_adult", "2027-08-20", parent_cm_id=FAMILY_CAMP_6),
)

# Rachel Garcia, an adult-weekend guest whose household files no CampMinder aid form.
RACHEL_HOUSEHOLD, RACHEL = 1000009, 1000091
# Grace Chen, an adult-only Family Camp attendee (Adult Reg) in her own household.
GRACE_HOUSEHOLD, GRACE = 1000010, 1000101
# Dana Okafor, her partner Riley Sam: two adults of one adult-only household at the same weekend.
DANA_HOUSEHOLD, DANA, RILEY = 1000011, 1000111, 1000112

_INCOME = ("total_gross_income", "expected_gross_income", "total_adjusted_income", "income_confirmed")

_WEEKEND_CHOICE = {
    ADULT_WEEKEND_A: "Adult Weekend A (Sep 10-12)",
    ADULT_WEEKEND_B: "Adult Weekend B (Sep 24-26)",
    FAMILY_CAMP_6: "Family Camp 6 (Aug 20-23)",
}


def form_response(
    response_id: str = "resp-rachel-1",
    *,
    person: int = RACHEL,
    household: int = RACHEL_HOUSEHOLD,
    program: str = "adult_weekend",
    weekend: int = ADULT_WEEKEND_A,
    choice: str | None = None,
    match_status: str = "auto",
    form_status: str = "live",
    submitted: str = "2026-11-05T17:00:00Z",
    created: str | None = None,
    ask: float = 400.0,
    reported: tuple[str, ...] | None = None,
    notes: Mapping[str, Any] | None = None,
    superseded_by: str = "",
    candidates: tuple[Mapping[str, Any], ...] = (),
    ignored_reason: str = "",
    **answers: Any,
) -> FormResponseRow:
    """One mirrored response. Income figures default to $80,000 (2026 gross) and $72,000 (2027 expected); pass
    `reported` to say which income answers were given, else every income column given a non-zero value counts."""
    figures: dict[str, Any] = {"total_gross_income": 80000.0, "expected_gross_income": 72000.0, **answers}
    if reported is None:
        reported = tuple(name for name in _INCOME if figures.get(name))
    return FormResponseRow(
        id=hashlib.md5(response_id.encode()).hexdigest()[:15],
        year=2027,
        response_id=response_id,
        form_status=form_status,
        match_status=match_status,
        person_cm_id=person if match_status in ("auto", "staff", "superseded") else 0,
        household_cm_id=household if match_status in ("auto", "staff", "superseded") else 0,
        program_key=program,
        weekend_session_cm_id=weekend,
        program_choice=choice if choice is not None else _WEEKEND_CHOICE.get(weekend, "Family Camp 3 (Aug 26-29)"),
        ask=ask,
        answers=figures,
        reported_income_fields=frozenset(reported),
        parse_notes=dict(notes or {}),
        created_at_google=created or submitted,
        last_submitted_at=submitted,
        superseded_by=superseded_by,
        match_candidates=candidates,
        ignored_reason=ignored_reason,
        name_typed="Rachel Garcia",
        signature_typed="Rachel Garcia",
        agreement_date="2026-11-05",
        county="Riverside",
    )


def gform_store(
    *responses: FormResponseRow, attendees: list[AttendeeRow], fa_rows: Sequence[FaRow] = ()
) -> FakeAidStore:
    store = FakeAidStore()
    store.rules = intake_rules()
    store.sessions = list(GFORM_SESSIONS)
    store.fa_rows = list(fa_rows)
    store.attendees = attendees
    store.form_responses = list(responses)
    return store


def enrolled(person: int, household: int, *sessions: int, status: int = 2) -> list[AttendeeRow]:
    return [AttendeeRow(person, household, session, status) for session in sessions]
