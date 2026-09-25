"""Data-quality checks: staff-set severity and thresholds, and they never change the status."""

from typing import Any

import pytest

from bunking.financial_aid.calculator.engine import calculate
from bunking.financial_aid.calculator.result import CalcResult
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever


def _run(rules: AidRules | None = None, app_fields: dict[str, Any] | None = None, **request: Any) -> CalcResult:
    return calculate(app(**(app_fields or {})), req(**request), rules or fictional_rules())


def _codes(result: CalcResult) -> dict[str, str]:
    return {i.code: i.severity for i in result.issues}


def test_a_clean_request_raises_nothing() -> None:
    assert _run().issues == []


@pytest.mark.parametrize(
    ("app_fields", "request_fields", "code", "severity"),
    [
        ({}, {"ask": "4500"}, "ask_above_cost", "warn"),
        ({"prior_year_gross": "500000", "current_year_gross": "500000"}, {}, "income_above", "warn"),
        ({"medical_expenses": "36000"}, {}, "expense_above", "warn"),
        (
            {},
            {"grants_applicable": [{"amount": "100", "state": "committed"}, {"amount": "200", "state": "committed"}]},
            "multiple_grants",
            "warn",
        ),
        ({"prior_year_gross": "0", "current_year_gross": "0"}, {}, "placeholder_income", "block"),
        (
            {"prior_year_gross": "100000", "current_year_gross": "100000"},
            {"ask": "5000", "decision_type": "full_cost_program"},
            "award_above_cost",
            "warn",
        ),
        ({}, {"ask": "3200", "appeal_amount": "1000"}, "appeal_above_ask", "warn"),
        ({"dependents": 20}, {}, "implausible_dependents", "warn"),
        (
            {},
            {"person_cm_id": None, "program_key": "family_camp", "session_cm_id": 1000201},
            "family_cost_missing",
            "block",
        ),
        ({"prior_year_confirmed": "90000"}, {}, "py_confirm_tier_change", "warn"),
    ],
)
def test_each_check_fires_with_its_severity(
    app_fields: dict[str, Any], request_fields: dict[str, Any], code: str, severity: str
) -> None:
    # (pytest reserves the name "request" for its own fixture.)
    result = _run(app_fields=app_fields, **request_fields)
    assert _codes(result).get(code) == severity


def test_a_blocking_check_does_not_change_the_status() -> None:
    result = _run(app_fields={"prior_year_gross": "0", "current_year_gross": "0"})
    assert result.status == "ok"


def test_expense_above_compares_the_counted_excess() -> None:
    # 33,000 medical is a 29,000 excess over the 4,000 threshold: under 30,000.
    assert "expense_above" not in _codes(_run(app_fields={"medical_expenses": "33000"}))


def test_a_confirmed_figure_that_keeps_the_tier_is_not_flagged() -> None:
    assert "py_confirm_tier_change" not in _codes(_run(app_fields={"prior_year_confirmed": "61000"}))


def test_a_disabled_check_is_silent() -> None:
    rules = with_lever(fictional_rules(), "quality_checks.checks.ask_above_cost.enabled", False)
    assert "ask_above_cost" not in _codes(_run(rules, ask="4500"))


def test_severity_is_a_lever() -> None:
    rules = with_lever(fictional_rules(), "quality_checks.checks.ask_above_cost.severity", "block")
    assert _codes(_run(rules, ask="4500"))["ask_above_cost"] == "block"


def test_threshold_is_a_lever() -> None:
    rules = with_lever(fictional_rules(), "quality_checks.checks.income_above.threshold", "50000")
    assert "income_above" in _codes(_run(rules))
