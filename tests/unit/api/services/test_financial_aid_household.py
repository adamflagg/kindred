"""Household grouping and request specs (campership sub-project 5; spec 2 item 22, 8, 9.1, 9.2)."""

from __future__ import annotations

from typing import get_args

import pytest

from api.services.financial_aid_household import (
    HOUSEHOLD_ANSWER_FIELDS,
    NUMBER_FIELDS,
    build_request_specs,
    choose_household_answers,
)
from api.services.financial_aid_intake_types import AttendeeRow, Flag, SessionRow
from bunking.financial_aid.rules.schema import IncomeFigure
from tests.unit.api.services.financial_aid_fakes import SESSIONS, YEAR, fa_row


def test_identical_income_on_every_row_raises_no_flag() -> None:
    answers, flags = choose_household_answers(
        [fa_row(1000011, total_gross_income=85000.0), fa_row(1000012, total_gross_income=85000.0)]
    )
    assert answers["total_gross_income"] == 85000.0
    assert flags == ()


def test_disagreeing_income_is_left_unknown_and_flagged_with_every_variant() -> None:
    answers, flags = choose_household_answers(
        [
            fa_row(1000013, total_gross_income=90000.0),
            fa_row(1000011, total_gross_income=85000.0),
            fa_row(1000012, total_gross_income=85000.0),
        ]
    )
    assert answers["total_gross_income"] is None  # never picked, not even by majority (spec 8)
    assert flags == (
        Flag(
            "income_conflict",
            {
                "fields": {
                    "total_gross_income": [
                        {"value": 85000.0, "person_cm_ids": [1000011, 1000012]},
                        {"value": 90000.0, "person_cm_ids": [1000013]},
                    ]
                }
            },
        ),
    )


def test_a_blank_income_on_one_row_is_not_a_conflict() -> None:  # Review Focus 3
    answers, flags = choose_household_answers(
        [fa_row(1000011, total_gross_income=0.0), fa_row(1000012, total_gross_income=85000.0)]
    )
    assert answers["total_gross_income"] == 85000.0
    assert flags == ()


def test_a_blank_gross_income_is_unknown_not_zero() -> None:  # Review Focus 6
    answers, flags = choose_household_answers([fa_row(1000011, total_gross_income=0.0), fa_row(1000012)])
    assert answers["total_gross_income"] is None
    assert answers["total_adjusted_income"] is None
    assert flags == ()


def test_a_reported_zero_gross_is_kept_as_zero() -> None:
    answers, flags = choose_household_answers(
        [fa_row(1000011, total_gross_income=0.0, reported=("total_gross_income",))]
    )
    assert answers["total_gross_income"] is not None
    assert answers["total_gross_income"] == 0.0
    assert flags == ()


def test_a_reported_zero_next_to_a_figure_is_a_conflict() -> None:
    answers, flags = choose_household_answers(
        [
            fa_row(1000011, total_gross_income=0.0, reported=("total_gross_income",)),
            fa_row(1000012, total_gross_income=85000.0),
        ]
    )
    assert answers["total_gross_income"] is None
    assert [f.code for f in flags] == ["income_conflict"]


def test_non_income_disagreements_get_their_own_flag_and_booleans_and_text_combine() -> None:
    answers, flags = choose_household_answers(
        [
            fa_row(1000011, num_children=3.0, unemployment=False, special_circumstances="Moved in spring."),
            fa_row(1000012, num_children=4.0, unemployment=True, special_circumstances="Moved in spring."),
        ]
    )
    assert answers["num_children"] == 3.0  # a tie goes to the lowest person id
    assert answers["unemployment"] is True
    assert answers["special_circumstances"] == "Moved in spring."
    assert [f.code for f in flags] == ["household_answer_conflict"]


def test_every_financial_field_is_carried_and_an_unanswered_number_is_none() -> None:
    answers, _ = choose_household_answers(
        [
            fa_row(
                1000011,
                total_rent=1800.0,
                total_housing_expenses=2400.0,
                unemployment=True,
                gov_subsidies=True,
                special_circumstances="Moved in spring.",
            )
        ]
    )
    assert set(answers) == set(HOUSEHOLD_ANSWER_FIELDS)
    assert (answers["total_rent"], answers["total_housing_expenses"]) == (1800.0, 2400.0)
    assert answers["unemployment"] is True
    assert answers["gov_subsidies"] is True
    assert answers["special_circumstances"] == "Moved in spring."
    assert answers["num_children"] is None  # an unanswered number stays unknown, not 0


# Former household fields the FA mirror still stores (the Go sync and its migration are
# unchanged) but the current CampMinder form no longer asks (owner ruling 2026-09-27): the
# engine must never read them, whatever a row's raw answers happen to hold.
_RETIRED_HOUSEHOLD_FIELDS = (
    "student_debt",
    "retirement_accounts",
    "other_support_amount",
    "still_unemployed",
    "owns_home",
    "total_exemptions",
    "gov_subsidies_detail",
    "other_financial_support",
)


def test_single_parent_is_a_live_optional_answer_carried_into_household_answers() -> None:
    answers, _ = choose_household_answers([fa_row(1000011, single_parent=True)])
    assert answers["single_parent"] is True
    blank, _ = choose_household_answers([fa_row(1000011)])
    assert blank["single_parent"] is False


def test_retired_fields_are_never_carried_into_household_answers() -> None:
    answers, _ = choose_household_answers(
        [
            fa_row(
                1000011,
                student_debt=30000.0,
                retirement_accounts=5000.0,
                other_support_amount=1200.0,
                still_unemployed=True,
                owns_home=False,
                total_exemptions=2.0,
                gov_subsidies_detail="Housing voucher.",
                other_financial_support="Church fund.",
            )
        ]
    )
    assert not set(_RETIRED_HOUSEHOLD_FIELDS) & set(answers)
    assert set(answers) == set(HOUSEHOLD_ANSWER_FIELDS)


def test_every_figure_the_calculator_can_read_is_carried() -> None:
    # SP3's income.extra_terms read ApplicationInputs.figures, keyed by IncomeFigure.
    assert set(get_args(IncomeFigure)) <= set(NUMBER_FIELDS)


def _attendees() -> list[AttendeeRow]:
    return [
        AttendeeRow(1000011, 1000001, 1000101, 2),
        AttendeeRow(1000011, 1000001, 1000301, 2),
        AttendeeRow(1000012, 1000001, 1000202, 2),
        AttendeeRow(1000019, 1000001, 1000202, 2),  # a parent with no FA row, same household
        AttendeeRow(1000031, 1000003, 1000401, 2),
    ]


def test_summer_and_bmitzvah_requests_are_per_camper() -> None:
    specs = build_request_specs(
        1000001,
        [fa_row(1000011, summer="Session 2", summer_ask=1500.0, tbm="B*Mitzvah Program Year 1 - North", tbm_ask=400.0)],
        SESSIONS,
        _attendees(),
        year=YEAR,
    )
    assert [(s.person_cm_id, s.program_key, s.resolution.session_cm_id, s.ask) for s in specs] == [
        (1000011, "summer", 1000101, 1500.0),
        (1000011, "bmitzvah", 1000301, 400.0),
    ]
    assert specs[0].enrolled_session_ids == frozenset({1000101, 1000301})


def test_siblings_family_camp_answers_merge_into_one_household_request() -> None:
    specs = build_request_specs(
        1000001,
        [fa_row(1000011, fc="Family Camp 6", fc_ask=900.0), fa_row(1000012, fc="family camp 6", fc_ask=900.0)],
        SESSIONS,
        _attendees(),
        year=YEAR,
    )
    assert len(specs) == 1
    spec = specs[0]
    assert (spec.person_cm_id, spec.program_key, spec.resolution.session_cm_id, spec.ask) == (
        0,
        "family_camp",
        1000202,
        900.0,
    )
    assert spec.enrolled_session_ids == frozenset({1000101, 1000202, 1000301})
    assert spec.flags == ()


def test_siblings_disagreeing_on_the_family_camp_ask_keep_the_larger_and_flag_it() -> None:
    specs = build_request_specs(
        1000001,
        [fa_row(1000011, fc="Family Camp 6", fc_ask=900.0), fa_row(1000012, fc="Family Camp 6", fc_ask=1200.0)],
        SESSIONS,
        _attendees(),
        year=YEAR,
    )
    assert specs[0].ask == 1200.0
    assert specs[0].flags == (Flag("ask_conflict", {"asks": [900.0, 1200.0], "person_cm_ids": [1000011, 1000012]}),)


def test_a_program_answer_with_no_amount_is_flagged_not_zeroed_silently() -> None:
    specs = build_request_specs(1000001, [fa_row(1000011, summer="Session 2")], SESSIONS, _attendees(), year=YEAR)
    assert specs[0].ask == 0.0
    assert specs[0].flags == (Flag("ask_missing", {}),)


def test_an_adult_weekend_request_builds_from_ww_fa_and_the_adults_registration_in_2026() -> None:
    specs = build_request_specs(
        1000003, [fa_row(1000031, 1000003, interest=True, registration_ask=600.0)], SESSIONS, _attendees(), year=2026
    )
    assert [(s.person_cm_id, s.program_key, s.resolution.session_cm_id, s.ask) for s in specs] == [
        (1000031, "adult_weekend", 1000401, 600.0)
    ]


def test_a_camper_with_only_a_registration_interest_answer_gets_no_request() -> None:
    specs = build_request_specs(
        1000001, [fa_row(1000011, interest=True, registration_ask=500.0)], SESSIONS, _attendees(), year=YEAR
    )
    assert specs == ()


def test_only_an_enrolled_registration_sets_a_session() -> None:
    # Registration first (owner ruling 2026-09-27): waitlisted (8), applied (4), cancelled (32)
    # never decide. With no ENROLLED session in the program the request stays unmatched.
    rows = [fa_row(1000021, 1000002, summer="Taste of Camp 2", summer_ask=800.0)]
    for status_id in (4, 8, 32, 256, 512):
        attendees = [AttendeeRow(1000021, 1000002, 1000105, status_id)]
        (spec,) = build_request_specs(1000002, rows, SESSIONS, attendees, year=YEAR)
        assert (spec.resolution.session_cm_id, spec.resolution.candidates) == (0, ()), status_id


def test_registration_decides_even_when_the_answer_names_another_session() -> None:
    attendees = [AttendeeRow(1000021, 1000002, 1000102, 2), AttendeeRow(1000021, 1000002, 1000105, 8)]
    (spec,) = build_request_specs(
        1000002, [fa_row(1000021, 1000002, summer="Session 2", summer_ask=800.0)], SESSIONS, attendees, year=YEAR
    )
    assert (spec.resolution.session_cm_id, spec.resolution.method) == (1000102, "enrollment")
    assert spec.named_session_cm_id == 1000101  # the answer named Session 2: the planner flags the difference


def test_an_answer_naming_several_sessions_names_none() -> None:
    attendees = [AttendeeRow(1000021, 1000002, 1000105, 2)]
    (spec,) = build_request_specs(
        1000002, [fa_row(1000021, 1000002, summer="Taste of Camp", summer_ask=800.0)], SESSIONS, attendees, year=YEAR
    )
    assert (spec.resolution.session_cm_id, spec.named_session_cm_id) == (1000105, 0)


def test_family_camp_resolves_from_the_households_enrolled_weekend() -> None:
    attendees = [AttendeeRow(1000012, 1000001, 1000201, 2), AttendeeRow(1000011, 1000001, 1000202, 8)]
    (spec,) = build_request_specs(
        1000001, [fa_row(1000011, fc="Family Camp 6", fc_ask=900.0)], SESSIONS, attendees, year=YEAR
    )
    assert (spec.resolution.session_cm_id, spec.named_session_cm_id) == (1000201, 1000202)


def test_a_waitlisted_adult_gets_a_request_that_stays_unmatched_until_enrolled_in_2026() -> None:
    rows = [fa_row(1000031, 1000003, interest=True, registration_ask=600.0)]
    waitlisted = [AttendeeRow(1000031, 1000003, 1000401, 8)]
    (spec,) = build_request_specs(1000003, rows, SESSIONS, waitlisted, year=2026)
    assert (spec.program_key, spec.resolution.session_cm_id, spec.resolution.candidates) == ("adult_weekend", 0, ())
    enrolled = [AttendeeRow(1000031, 1000003, 1000401, 2)]
    (spec,) = build_request_specs(1000003, rows, SESSIONS, enrolled, year=2026)
    assert (spec.resolution.session_cm_id, spec.resolution.method) == (1000401, "enrollment")


def test_a_cancelled_adult_gets_no_request_in_2026() -> None:
    rows = [fa_row(1000031, 1000003, interest=True, registration_ask=600.0)]
    assert build_request_specs(1000003, rows, SESSIONS, [AttendeeRow(1000031, 1000003, 1000401, 32)], year=2026) == ()


def test_an_adult_reg_only_household_family_camp_request_resolves_to_the_weekend() -> None:
    # kindred#3213 (owner ruling 2026-10-14): the household's only enrollment is Adult Reg.
    sessions = (*SESSIONS, SessionRow(1000212, "Adult Reg: Family Camp 6", "family_adult", parent_cm_id=1000202))
    attendees = [AttendeeRow(1000051, 1000005, 1000212, 2)]
    (spec,) = build_request_specs(
        1000005, [fa_row(1000051, 1000005, fc="Family Camp 6", fc_ask=700.0)], sessions, attendees, year=YEAR
    )
    assert (spec.program_key, spec.resolution.session_cm_id, spec.resolution.method) == (
        "family_camp",
        1000202,
        "enrollment",
    )
    assert spec.enrolled_session_ids == frozenset({1000212, 1000202})  # the enrollment and the weekend it counts as


# -- IN-FORM-ONLY = A (owner 2026-10-28): from 2027 a registration ask alone is not an adult-weekend request ----------
# The registrar: intake starts only when someone fills out the aid FORM; an amount typed on the registration form is a
# signal the adult may file later. Adult-weekend requests come from the adult-weekend aid form (not built yet) or
# staff's Add a Request. 2026, the tie-off season, keeps the requests this path already made (owner guidance 10-17).

_ADULT_ASKS = (
    pytest.param(True, 0.0, id="interest-only"),
    pytest.param(False, 600.0, id="amount-only"),
    pytest.param(True, 600.0, id="interest-and-amount"),
)
_REGISTERED = (
    pytest.param(2, id="enrolled"),
    pytest.param(4, id="applied"),
    pytest.param(8, id="waitlisted"),
    pytest.param(512, id="incomplete"),
)


@pytest.mark.parametrize("status_id", _REGISTERED)
@pytest.mark.parametrize(("interest", "amount"), _ADULT_ASKS)
def test_from_2027_a_registration_ask_with_no_aid_form_makes_no_adult_weekend_request(
    status_id: int, interest: bool, amount: float
) -> None:
    rows = [fa_row(1000031, 1000003, interest=interest, registration_ask=amount)]
    attendees = [AttendeeRow(1000031, 1000003, 1000401, status_id)]
    assert build_request_specs(1000003, rows, SESSIONS, attendees, year=2027) == ()
    assert build_request_specs(1000003, rows, SESSIONS, attendees, year=2028) == ()


@pytest.mark.parametrize("status_id", _REGISTERED)
@pytest.mark.parametrize(("interest", "amount"), _ADULT_ASKS)
def test_2026_keeps_the_adult_weekend_request_a_registration_ask_made(
    status_id: int, interest: bool, amount: float
) -> None:
    rows = [fa_row(1000031, 1000003, interest=interest, registration_ask=amount)]
    attendees = [AttendeeRow(1000031, 1000003, 1000401, status_id)]
    (spec,) = build_request_specs(1000003, rows, SESSIONS, attendees, year=2026)
    assert (spec.person_cm_id, spec.program_key, spec.program_option_key, spec.ask) == (
        1000031,
        "adult_weekend",
        "",
        amount,
    )
    expected = 1000401 if status_id == 2 else 0  # only an ENROLLED registration sets the session
    assert spec.resolution.session_cm_id == expected


def test_summer_bmitzvah_and_family_camp_form_answers_build_the_same_in_2027_as_in_2026() -> None:
    rows = [
        fa_row(1000011, summer="Session 2", summer_ask=1500.0, tbm="B*Mitzvah Program Year 1 - North", tbm_ask=400.0),
        fa_row(1000012, fc="Family Camp 6", fc_ask=900.0, interest=True, registration_ask=700.0),
        fa_row(1000019, interest=True, registration_ask=300.0),  # a parent on a family-camp weekend: no adult session
    ]
    built = build_request_specs(1000001, rows, SESSIONS, _attendees(), year=2027)
    assert built == build_request_specs(1000001, rows, SESSIONS, _attendees(), year=2026)
    assert [(s.person_cm_id, s.program_key) for s in built] == [
        (1000011, "summer"),
        (1000011, "bmitzvah"),
        (0, "family_camp"),
    ]


def test_an_adult_who_answered_a_program_on_the_aid_form_is_unchanged_in_2027() -> None:
    # The aid form itself still makes requests: an adult row with a summer answer builds its summer request.
    rows = [fa_row(1000031, 1000003, summer="Session 2", summer_ask=500.0, interest=True, registration_ask=600.0)]
    built = build_request_specs(1000003, rows, SESSIONS, _attendees(), year=2027)
    assert built == build_request_specs(1000003, rows, SESSIONS, _attendees(), year=2026)
    assert [s.program_key for s in built] == ["summer"]
