"""Nothing the calculator did not compute reads as 0 (final review I5 and minors).

A result field stays None until its step runs; a missing ask is needs_input when
the ask caps the award; and a later round never blames cost for an R1 that failed
for another reason.
"""

from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from bunking.financial_aid.calculator.engine import calculate
from bunking.financial_aid.calculator.inputs import ApplicationInputs, RequestInputs
from bunking.financial_aid.calculator.result import CalcResult
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever, with_levers


def _calc(rules: AidRules | None = None, application: ApplicationInputs | None = None, **request: Any) -> CalcResult:
    return calculate(application or app(), req(**request), rules or fictional_rules())


# --- I5: fields never computed are None, not 0 ------------------------------------------


@pytest.mark.parametrize(
    ("application", "request_fields"),
    [
        (app(), {"program_key": "nosuch"}),  # stops at the program
        (app(prior_year_gross=None, current_year_gross=None), {}),  # stops at income
    ],
)
def test_a_result_that_stops_early_leaves_later_fields_none(
    application: ApplicationInputs, request_fields: dict[str, Any]
) -> None:
    result = _calc(application=application, **request_fields)
    assert (result.equity_shift, result.grants_offset, result.top_up) == (None, None, None)


def test_a_complete_result_reports_zero_for_what_it_evaluated_as_zero() -> None:
    result = _calc()
    assert (result.status, result.equity_shift, result.grants_offset, result.top_up) == (
        "ok",
        0,
        Decimal(0),
        Decimal(0),
    )


def test_a_top_up_that_could_not_be_computed_is_none() -> None:
    # A full-cost decision with an unknown cost: the top-up step cannot run.
    result = _calc(session_cm_id=1000999, decision_type="full_cost_program")
    assert result.status == "needs_input"
    assert result.top_up is None


# --- ask is optional; a missing ask is needs_input when it caps the award ----------------


def test_ask_must_be_given_but_may_be_none() -> None:
    with pytest.raises(ValidationError, match="ask"):
        RequestInputs.model_validate({"program_key": "summer"})
    assert RequestInputs.model_validate({"program_key": "summer", "ask": None}).ask is None


def test_a_missing_ask_needs_input_when_the_ask_caps_round_1() -> None:
    result = _calc(ask=None)
    assert (result.status, result.r1, result.total) == ("needs_input", None, None)
    issue = next(i for i in result.issues if i.code == "ask_missing")
    assert (issue.severity, issue.step) == ("needs_input", "r1")
    assert result.r1_potential == Decimal(3000)  # the potential does not need the ask


def test_a_missing_ask_is_not_needed_when_the_ask_does_not_cap() -> None:
    rules = with_lever(fictional_rules(), "awards.ask_cap", False)
    result = _calc(rules, ask=None)
    assert (result.status, result.r1, result.total) == ("ok", Decimal(3000), Decimal(3000))


def test_a_missing_ask_needs_input_when_it_caps_round_2() -> None:
    rules = with_levers(fictional_rules(), {"awards.ask_cap": False, "round2.cap_by_original_ask": True})
    result = _calc(rules, ask=None, appeal_amount="400")
    assert (result.status, result.r1, result.r2, result.total) == ("needs_input", Decimal(3000), None, None)
    assert ("ask_missing", "r2_cap") in {(i.code, i.step) for i in result.issues}


def test_quality_checks_that_compare_the_ask_are_silent_without_one() -> None:
    rules = with_lever(fictional_rules(), "awards.ask_cap", False)
    result = _calc(rules, ask=None, appeal_amount="400")
    assert not {"ask_above_cost", "appeal_above_ask"} & result.issue_codes()


# --- a later round never blames cost for an R1 that failed for another reason -----------


def test_after_a_round_1_rules_error_no_round_blames_the_cost() -> None:
    rules = with_levers(
        fictional_rules(),
        {
            "programs.summer.r1_table": "no_such_table",
            "awards.total_cap": {"pct_of_cost": "100", "include_grants": True},
            "round3.max_total_pct_of_cost": "100",
        },
    )
    result = _calc(
        rules,
        appeal_amount="400",
        round3_amount="200",
        round2_decided=True,
        round3_statement_of_need=True,
    )
    assert result.status == "error"
    assert result.issue_codes() == {"rules_error"}
    assert (result.r2, result.r3, result.total) == (None, None, None)


def test_a_full_cost_top_up_after_a_missing_ask_does_not_blame_the_cost() -> None:
    # A full-cost R1 skips the table, so the one way it ends None with a known cost is a
    # missing ask; the top-up must not then add a cost_unknown the cost did not cause.
    result = _calc(ask=None, decision_type="full_cost_program")
    assert result.issue_codes() == {"ask_missing"}
    assert (result.status, result.top_up, result.total) == ("needs_input", None, None)
