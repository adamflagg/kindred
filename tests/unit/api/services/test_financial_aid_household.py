"""Household grouping and request specs (campership sub-project 5; spec 2 item 22, 8, 9.1, 9.2)."""

from __future__ import annotations

from typing import get_args

from api.services.financial_aid_household import (
    HOUSEHOLD_ANSWER_FIELDS,
    NUMBER_FIELDS,
    build_request_specs,
    choose_household_answers,
)
from api.services.financial_aid_intake_types import AttendeeRow, Flag
from bunking.financial_aid.rules.schema import IncomeFigure
from tests.unit.api.services.financial_aid_fakes import SESSIONS, fa_row


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
                student_debt=30000.0,
                retirement_accounts=5000.0,
                other_support_amount=1200.0,
                still_unemployed=True,
                gov_subsidies=True,
                gov_subsidies_detail="Housing voucher.",
            )
        ]
    )
    assert set(answers) == set(HOUSEHOLD_ANSWER_FIELDS)
    assert (answers["total_rent"], answers["student_debt"], answers["other_support_amount"]) == (
        1800.0,
        30000.0,
        1200.0,
    )
    assert answers["still_unemployed"] is True
    assert answers["gov_subsidies"] is True
    assert answers["gov_subsidies_detail"] == "Housing voucher."
    assert answers["total_exemptions"] is None


def test_every_figure_the_calculator_can_read_is_carried() -> None:
    # SP3's income.extra_terms read ApplicationInputs.figures, keyed by IncomeFigure.
    assert set(get_args(IncomeFigure)) <= set(NUMBER_FIELDS)


def _attendees() -> list[AttendeeRow]:
    return [
        AttendeeRow(1000011, 1000001, 1000101, 2),
        AttendeeRow(1000012, 1000001, 1000202, 2),
        AttendeeRow(1000019, 1000001, 1000202, 2),  # a parent with no FA row, same household
        AttendeeRow(1000031, 1000003, 1000401, 2),
    ]


def test_summer_and_bmitzvah_requests_are_per_camper() -> None:
    specs = build_request_specs(
        1000001,
        [fa_row(1000011, summer="Session 2", summer_ask=1500.0, tbm="B*Mitzvah Program Year 1 - North", tbm_ask=400.0)],
        SESSIONS,
        (),
        _attendees(),
    )
    assert [(s.person_cm_id, s.program_key, s.resolution.session_cm_id, s.ask) for s in specs] == [
        (1000011, "summer", 1000101, 1500.0),
        (1000011, "bmitzvah", 1000301, 400.0),
    ]
    assert specs[0].enrolled_session_ids == frozenset({1000101})


def test_siblings_family_camp_answers_merge_into_one_household_request() -> None:
    specs = build_request_specs(
        1000001,
        [fa_row(1000011, fc="Family Camp 6", fc_ask=900.0), fa_row(1000012, fc="family camp 6", fc_ask=900.0)],
        SESSIONS,
        (),
        _attendees(),
    )
    assert len(specs) == 1
    spec = specs[0]
    assert (spec.person_cm_id, spec.program_key, spec.resolution.session_cm_id, spec.ask) == (
        0,
        "family_camp",
        1000202,
        900.0,
    )
    assert spec.enrolled_session_ids == frozenset({1000101, 1000202})
    assert spec.flags == ()


def test_siblings_disagreeing_on_the_family_camp_ask_keep_the_larger_and_flag_it() -> None:
    specs = build_request_specs(
        1000001,
        [fa_row(1000011, fc="Family Camp 6", fc_ask=900.0), fa_row(1000012, fc="Family Camp 6", fc_ask=1200.0)],
        SESSIONS,
        (),
        _attendees(),
    )
    assert specs[0].ask == 1200.0
    assert specs[0].flags == (Flag("ask_conflict", {"asks": [900.0, 1200.0], "person_cm_ids": [1000011, 1000012]}),)


def test_a_program_answer_with_no_amount_is_flagged_not_zeroed_silently() -> None:
    specs = build_request_specs(1000001, [fa_row(1000011, summer="Session 2")], SESSIONS, (), _attendees())
    assert specs[0].ask == 0.0
    assert specs[0].flags == (Flag("ask_missing", {}),)


def test_an_adult_weekend_request_builds_from_ww_fa_and_the_adults_registration() -> None:
    specs = build_request_specs(
        1000003, [fa_row(1000031, 1000003, interest=True, registration_ask=600.0)], SESSIONS, (), _attendees()
    )
    assert [(s.person_cm_id, s.program_key, s.resolution.session_cm_id, s.ask) for s in specs] == [
        (1000031, "adult_weekend", 1000401, 600.0)
    ]


def test_a_camper_with_only_a_registration_interest_answer_gets_no_request() -> None:
    specs = build_request_specs(
        1000001, [fa_row(1000011, interest=True, registration_ask=500.0)], SESSIONS, (), _attendees()
    )
    assert specs == ()
