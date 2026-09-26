"""Shared fixtures for the campership intake tests (sub-project 5).

Fictional data only: generic session names, and person/household ids from
1000001 up (tests/CLAUDE.md). Nothing here is, or resembles, a real family.
"""

from __future__ import annotations

from typing import Any

from api.services.financial_aid_intake_types import FaRow, SessionRow

YEAR = 2027

# The fourth field is the session's first day (camp_sessions.start_date); the
# infant cutoff is measured on it (spec 2 item 22).
SESSIONS: tuple[SessionRow, ...] = (
    SessionRow(1000101, "Session 2", "main", "2027-06-20"),
    SessionRow(1000102, "Session 2a", "embedded", "2027-06-20"),
    SessionRow(1000103, "All-Gender Cabin-Session 2 (7th & 8th grades)", "ag", "2027-06-20"),
    SessionRow(1000104, "Taste of Camp 1", "main", "2027-06-13"),
    SessionRow(1000105, "Taste of Camp 2", "embedded", "2027-07-25"),
    SessionRow(1000106, "River `n` Ridge Quest", "quest", "2027-07-05"),
    SessionRow(1000107, "Counselor In-Training", "scit", "2027-06-20"),
    SessionRow(1000108, "Specialist In-Training", "scit", "2027-06-20"),
    SessionRow(1000201, "Family Camp 3: Riverside Weekend (w/ kids 10 and under)", "family", "2027-05-28"),
    SessionRow(1000202, "Family Camp 6", "family", "2027-08-20"),
    SessionRow(1000301, "The Camp's B*Mitzvah Program Year 1 - North", "bmitzvah", "2027-01-10"),
    SessionRow(1000401, "Adult Weekend A", "adult", "2027-09-10"),
    SessionRow(1000402, "Adult Weekend B", "adult", "2027-09-24"),
)

_INCOME_COLUMNS = ("total_gross_income", "expected_gross_income", "total_adjusted_income", "income_confirmed")


def fa_row(
    person_cm_id: int,
    household_cm_id: int = 1000001,
    *,
    summer: str = "",
    summer_ask: float = 0.0,
    fc: str = "",
    fc_ask: float = 0.0,
    tbm: str = "",
    tbm_ask: float = 0.0,
    interest: bool = False,
    registration_ask: float = 0.0,
    reported: tuple[str, ...] | None = None,
    **answers: Any,
) -> FaRow:
    """`reported` names the income columns the family answered (Task 1b). Left as None,
    it is every income column given a non-zero value here, so `total_gross_income=0.0`
    alone reads as a BLANK; pass `reported=("total_gross_income",)` for a real $0."""
    if reported is None:
        reported = tuple(name for name in _INCOME_COLUMNS if answers.get(name))
    return FaRow(
        person_cm_id=person_cm_id,
        household_cm_id=household_cm_id,
        answers=answers,
        summer_program=summer,
        summer_amount_requested=summer_ask,
        fc_program=fc,
        fc_amount_requested=fc_ask,
        tbm_program=tbm,
        tbm_amount_requested=tbm_ask,
        interest_expressed=interest,
        registration_ask=registration_ask,
        reported_income_fields=frozenset(reported),
    )
