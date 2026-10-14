"""FA program answer -> CampMinder session (campership sub-project 5, spec 9.1).

Registration first (owner ruling 2026-09-27): the camper's ENROLLED sessions in the
answer's program decide; the option text only breaks a tie between them.
"""

from __future__ import annotations

from api.services.financial_aid_intake_types import SessionResolution, SessionRow
from api.services.financial_aid_session_resolver import (
    normalize_option_text,
    resolve_adult_session,
    resolve_session,
    session_named_by,
)
from tests.unit.api.services.financial_aid_fakes import SESSIONS


def test_one_enrolled_session_in_the_program_decides_whatever_the_text_says() -> None:
    assert resolve_session("Session 9", "summer", SESSIONS, frozenset({1000102})) == SessionResolution(
        1000102, "enrollment", (1000102,)
    )


def test_two_enrolled_sessions_are_decided_by_the_one_the_text_names() -> None:
    assert resolve_session("Taste of Camp 2", "summer", SESSIONS, frozenset({1000101, 1000105})) == (
        SessionResolution(1000105, "enrollment_text", (1000101, 1000105))
    )


def test_the_text_decides_by_containment_when_no_session_name_is_exact() -> None:
    enrolled = frozenset({1000101, 1000106})
    assert resolve_session("River 'n' Ridge", "summer", SESSIONS, enrolled) == SessionResolution(
        1000106, "enrollment_text", (1000101, 1000106)
    )


def test_two_enrolled_sessions_the_text_names_neither_or_both_of_stay_unmatched() -> None:
    enrolled = frozenset({1000104, 1000105})
    assert resolve_session("Session 2", "summer", SESSIONS, enrolled) == SessionResolution(
        0, "unmatched", (1000104, 1000105)
    )
    assert resolve_session("Taste of Camp", "summer", SESSIONS, enrolled) == SessionResolution(
        0, "unmatched", (1000104, 1000105)
    )


def test_session_2_text_with_enrollment_in_2_and_2a_takes_session_2() -> None:
    assert resolve_session("Session 2", "summer", SESSIONS, frozenset({1000101, 1000102})) == SessionResolution(
        1000101, "enrollment_text", (1000101, 1000102)
    )


def test_no_enrolled_session_is_unmatched_with_no_candidates() -> None:
    # The builder passes ENROLLED sessions only: waitlisted or cancelled never reach here.
    assert resolve_session("Session 2", "summer", SESSIONS, frozenset()) == SessionResolution(0, "unmatched", ())


def test_a_summer_answer_never_lands_on_a_family_weekend() -> None:
    assert resolve_session("Family Camp 6", "summer", SESSIONS, frozenset({1000202})) == SessionResolution(
        0, "unmatched", ()
    )
    assert resolve_session("Family Camp 6", "family_camp", SESSIONS, frozenset({1000101, 1000202})) == (
        SessionResolution(1000202, "enrollment", (1000202,))
    )


def test_typographic_quotes_and_spacing_still_break_a_tie() -> None:  # Review Focus 1
    enrolled = frozenset({1000101, 1000106})
    for text in ("River ’n’ Ridge Quest", "River 'n' Ridge Quest", "RIVER  `n` ridge quest"):
        assert resolve_session(text, "summer", SESSIONS, enrolled).session_cm_id == 1000106, text
    assert normalize_option_text("River ’n’  Ridge") == "river 'n' ridge"


def test_the_session_an_option_names_is_one_in_program_session_or_none() -> None:
    assert session_named_by("Session 2", "summer", SESSIONS) == 1000101
    assert session_named_by("Family Camp 3: Riverside Weekend", "family_camp", SESSIONS) == 1000201
    assert session_named_by("Taste of Camp", "summer", SESSIONS) == 0  # names two
    assert session_named_by("Session 9", "summer", SESSIONS) == 0  # names none
    assert session_named_by("Family Camp 6", "summer", SESSIONS) == 0  # another program's
    assert session_named_by("  ", "summer", SESSIONS) == 0


def test_an_adult_request_takes_the_one_adult_weekend_the_person_is_enrolled_in() -> None:
    assert resolve_adult_session(SESSIONS, frozenset({1000401, 1000101})) == SessionResolution(
        1000401, "enrollment", (1000401,)
    )
    assert resolve_adult_session(SESSIONS, frozenset({1000401, 1000402})) == SessionResolution(
        0, "unmatched", (1000401, 1000402)
    )
    assert resolve_adult_session(SESSIONS, frozenset()) == SessionResolution(0, "unmatched", ())


# Adult Reg (kindred#3213, owner ruling 2026-10-14): an adult-only Family Camp guest enrolls in
# an Adult Reg session (`family_adult`) whose parent_id names its weekend. For a family camp
# answer that enrollment counts as the weekend's, so an adult-only household resolves.
ADULT_REG_FC6 = SessionRow(1000212, "Adult Reg: Family Camp 6", "family_adult", "2027-08-20", parent_cm_id=1000202)
ADULT_REG_FC3 = SessionRow(1000211, "Adult Reg: Family Camp 3", "family_adult", "2027-05-28", parent_cm_id=1000201)
ADULT_REG_UNPAIRED = SessionRow(1000219, "Adult Reg: Prospective Weekend", "family_adult", "2027-04-10")
WITH_ADULT_REG = (*SESSIONS, ADULT_REG_FC6, ADULT_REG_FC3, ADULT_REG_UNPAIRED)


def test_an_adult_reg_only_household_resolves_to_its_paired_weekend() -> None:
    assert resolve_session("Family Camp 6", "family_camp", WITH_ADULT_REG, frozenset({1000212})) == (
        SessionResolution(1000202, "enrollment", (1000202,))
    )


def test_an_adult_reg_enrollment_and_its_own_weekend_count_once() -> None:
    assert resolve_session("Family Camp 3", "family_camp", WITH_ADULT_REG, frozenset({1000202, 1000212})) == (
        SessionResolution(1000202, "enrollment", (1000202,))
    )


def test_adult_reg_weekends_tie_like_any_two_weekends_and_the_text_breaks_it() -> None:
    enrolled = frozenset({1000202, 1000211})
    assert resolve_session("Family Camp 3", "family_camp", WITH_ADULT_REG, enrolled) == SessionResolution(
        1000201, "enrollment_text", (1000201, 1000202)
    )
    assert resolve_session("Family Camp", "family_camp", WITH_ADULT_REG, enrolled) == SessionResolution(
        0, "unmatched", (1000201, 1000202)
    )


def test_an_unpaired_adult_reg_enrollment_names_no_weekend() -> None:
    # parent_id 0: the sync could not pair it. It is never itself the answer (Rules/Costs
    # price weekends), so it stays unmatched for staff to re-point.
    assert resolve_session("Family Camp 6", "family_camp", WITH_ADULT_REG, frozenset({1000219})) == (
        SessionResolution(0, "unmatched", ())
    )


def test_adult_reg_counts_for_family_camp_only() -> None:
    for program in ("summer", "adult_weekend", "bmitzvah"):
        assert resolve_session("Family Camp 6", program, WITH_ADULT_REG, frozenset({1000212})) == (
            SessionResolution(0, "unmatched", ())
        ), program
    assert resolve_adult_session(WITH_ADULT_REG, frozenset({1000212})) == SessionResolution(0, "unmatched", ())
    assert session_named_by("Adult Reg: Family Camp 6", "family_camp", WITH_ADULT_REG) == 0
