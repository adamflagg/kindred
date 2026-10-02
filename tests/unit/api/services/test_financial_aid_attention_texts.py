"""The owner-approved wording of the Needs-attention texts the server writes (2026-10-02 review).

Each text is a complete sentence that reads on its own: the household page prints a note's message
with no pill, and a hold release stores the message as its fact. Money prints as money ("$150,000").
Codes, severities and triggers are pinned elsewhere; this file pins the WORDS, one per review id.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from api.services.financial_aid_calc_inputs import priced_program, request_issues
from api.services.financial_aid_corrections import APPLICATION_CORRECTABLE, effective_values
from api.services.financial_aid_household import BOOL_FIELDS, INCOME_FIELDS, NUMBER_FIELDS, TEXT_FIELDS
from api.services.financial_aid_intake_types import (
    FLAG_AWAITING_RULES,
    FLAG_DUPLICATE_SURVIVOR_WITHDRAWN,
    RequestRecord,
)
from bunking.financial_aid.calculator import calculate
from bunking.financial_aid.calculator.grants import grants_offset
from bunking.financial_aid.money import dollars
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever, with_levers
from tests.unit.bunking.financial_aid.test_grants import DECIDED, LATE, _grant


def _request(session: int = 1000101, flags: tuple[dict[str, Any], ...] = ()) -> RequestRecord:
    return RequestRecord(
        "req000000000001", 2031, "app000000000001", 1000001, 1000011, session, "summer",
        "Session 2", "session 2", "exact", 1500.0, 0, 0, "", "active", "", flags=flags,
    )  # fmt: skip


def _answers() -> dict[str, Any]:
    values: dict[str, Any] = dict.fromkeys((*INCOME_FIELDS, *NUMBER_FIELDS))
    values.update(dict.fromkeys(BOOL_FIELDS, False))
    values.update(dict.fromkeys(TEXT_FIELDS, ""))
    return effective_values(values, APPLICATION_CORRECTABLE, [])


def _intake_message(code: str, request: RequestRecord, app_flags: tuple[dict[str, Any], ...] = ()) -> str:
    issues = request_issues(request, app_flags, _answers(), [], None)
    return next(i.message for i in issues if i.code == code)


def _messages(result: Any) -> dict[str, str]:
    return {i.code: i.message for i in result.issues}


def _calc(rules: Any = None, application: Any = None, **request: Any) -> Any:
    return calculate(application or app(), req(**request), rules or fictional_rules())


# --- intake holds (financial_aid_calc_inputs) ---------------------------------------------------


def test_s1_income_conflict() -> None:
    flags = ({"code": "income_conflict", "detail": {"fields": {"total_gross_income": [1, 2]}}},)
    assert _intake_message("household_income_conflict", _request(), flags) == (
        "The applications differ: call the family and enter the income to use"
    )


def test_s2_awaiting_rules_clears_at_the_next_intake_run_not_on_approval() -> None:
    request = _request(flags=({"code": FLAG_AWAITING_RULES},))
    assert _intake_message(FLAG_AWAITING_RULES, request) == (
        "Clears at the next intake run after finance approves this season's programs and cost rules"
    )


def test_s3_names_the_withdrawn_original_not_the_duplicate() -> None:
    request = _request(flags=({"code": FLAG_DUPLICATE_SURVIVOR_WITHDRAWN, "detail": {"withdrawn_survivor": "x"}},))
    assert _intake_message(FLAG_DUPLICATE_SURVIVOR_WITHDRAWN, request) == (
        "The original request was withdrawn but kept the payer shares and any decision: check them before awarding"
    )


def test_s4_unmatched_session() -> None:
    assert _intake_message("unmatched_session", _request(session=0)) == "Resolve the session"


def test_s7a_no_program_claims_the_session_keeps_the_session_id() -> None:
    program, why = priced_program(_request(session=777), {}, fictional_rules())
    assert (program, why) == (None, "No program in the rules claims session 777")


# --- calculator holds (engine, income, cost) ----------------------------------------------------


def test_e1_nothing_reported() -> None:
    result = _calc(application=app(prior_year_gross=None, current_year_gross=None))
    assert _messages(result)["income_missing"] == "No income figure reported and no income override"


@pytest.mark.parametrize(
    ("application", "expected"),
    [
        (
            {"prior_year_gross": "100000", "current_year_gross": None},
            "The current-year gross income figure is needed but was not reported",
        ),
        (
            {"prior_year_gross": None, "current_year_gross": None, "prior_year_agi": "90000"},
            "The prior-year gross and current-year gross income figures are needed but were not reported",
        ),
    ],
)
def test_e2_some_figures_missing_pluralises(application: dict[str, Any], expected: str) -> None:
    assert _messages(_calc(application=app(**application)))["income_missing"] == expected


def test_e3_income_below_first_band_is_kept() -> None:
    rules = with_levers(
        fictional_rules(), {"income.per_dependent_reduction": "3000", "income.floor_applies_after": "deductions"}
    )
    result = _calc(rules, application=app(prior_year_gross="10000", current_year_gross="10000", dependents=4))
    assert _messages(result)["income_below_first_band"] == (
        "Adjusted income is below the first income band, so it has no tier"
    )


def test_e4_cost_unknown_hold_capitalises_the_cause() -> None:
    rules = with_lever(fictional_rules(), "awards.minimum_when_cost_unknown", False)
    assert _messages(_calc(rules, session_cm_id=1000999))["cost_unknown"] == (
        "No tuition for session 1000999; Round 1 cannot be computed"
    )


def test_e5_cost_unknown_note_capitalises_the_cause() -> None:
    assert _messages(_calc(session_cm_id=1000999))["cost_unknown"] == (
        "No tuition for session 1000999; the minimum award was used"
    )


def test_e6_ask_missing_round_1() -> None:
    assert _messages(_calc(ask=None))["ask_missing"] == "Enter the ask: it caps Round 1 this season"


def test_e7_ask_missing_round_2() -> None:
    rules = with_levers(fictional_rules(), {"awards.ask_cap": False, "round2.cap_by_original_ask": True})
    assert _messages(_calc(rules, ask=None, appeal_amount="400"))["ask_missing"] == (
        "Enter the original ask: it caps Round 2 this season"
    )


def test_e8_no_round_1_table_keeps_the_program_key() -> None:
    rules = with_lever(fictional_rules(), "awards.minimum_without_table", False)
    result = _calc(rules, program_key="adult_weekend", session_cm_id=1000401)
    assert _messages(result)["no_round1_table"] == "Program 'adult_weekend' has no Round 1 table: finance names one"


# --- quality checks ------------------------------------------------------------------------------


def test_q1_ask_above_cost_keeps_its_full_sentence() -> None:
    assert _messages(_calc(ask="4500"))["ask_above_cost"] == "The ask is above the cost"


def test_q2_high_income_prints_money() -> None:
    rules = with_lever(fictional_rules(), "quality_checks.checks.income_above.threshold", "150000")
    result = _calc(rules, application=app(prior_year_gross="500000", current_year_gross="500000"))
    assert _messages(result)["income_above"] == "Adjusted income is above $150,000"


def test_q3_high_expense_prints_money() -> None:
    rules = with_lever(fictional_rules(), "quality_checks.checks.expense_above.threshold", "25000")
    result = _calc(rules, application=app(medical_expenses="36000"))
    assert _messages(result)["expense_above"] == "A counted expense or reduction is above $25,000"


def test_q4_several_grants_does_not_say_this_camper() -> None:
    grants = [{"amount": "100", "state": "committed"}, {"amount": "200", "state": "committed"}]
    assert _messages(_calc(grants_applicable=grants))["multiple_grants"] == "More than one outside grant"


def test_q5_placeholder_income_keeps_its_reason_and_prints_money() -> None:
    result = _calc(application=app(prior_year_gross="0", current_year_gross="0"))
    assert _messages(result)["placeholder_income"] == ("Reported income is at or below $1,000; it may be a placeholder")


def test_q9_family_camp_cost_names_the_headcount() -> None:
    result = _calc(person_cm_id=None, program_key="family_camp", session_cm_id=1000201)
    assert _messages(result)["family_cost_missing"] == "Enter the family-camp headcount"


# --- note ---------------------------------------------------------------------------------------


def test_n1_late_grant_keeps_its_subject() -> None:
    request = req(r1_decided_at=DECIDED, grants_applicable=[_grant("600", recorded_at=LATE)])
    (issue,) = grants_offset(request, fictional_rules())[1]
    assert issue.message == "A grant recorded after Round 1 was left out of it; the offer stands"


# --- money formatter ----------------------------------------------------------------------------


def test_the_shared_money_formatter() -> None:
    assert (dollars(Decimal(150000)), dollars(Decimal("1250.50"))) == ("$150,000", "$1,250.50")
