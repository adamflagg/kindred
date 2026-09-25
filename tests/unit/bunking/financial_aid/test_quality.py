"""Data-quality checks: staff-set severity and thresholds, and they never change the status."""

from typing import Any

import pytest

from bunking.financial_aid.calculator.engine import calculate
from bunking.financial_aid.calculator.result import CalcResult
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, req, with_lever, with_levers


def _run(rules: AidRules | None = None, app_fields: dict[str, Any] | None = None, **request: Any) -> CalcResult:
    return calculate(app(**(app_fields or {})), req(**request), rules or fictional_rules())


def _codes(result: CalcResult) -> dict[str, str]:
    return {i.code: i.severity for i in result.issues}


def test_a_clean_request_raises_nothing() -> None:
    assert _run().issues == []


@pytest.mark.parametrize(
    ("app_fields", "request_fields", "code", "severity", "lever_changes"),
    [
        ({}, {"ask": "4500"}, "ask_above_cost", "warn", None),
        ({"prior_year_gross": "500000", "current_year_gross": "500000"}, {}, "income_above", "warn", None),
        ({"medical_expenses": "36000"}, {}, "expense_above", "warn", None),
        (
            {},
            {"grants_applicable": [{"amount": "100", "state": "committed"}, {"amount": "200", "state": "committed"}]},
            "multiple_grants",
            "warn",
            None,
        ),
        ({"prior_year_gross": "0", "current_year_gross": "0"}, {}, "placeholder_income", "block", None),
        (
            # Tier 2's total percentage is raised to the maximum (100%), which lands R1+R2 at
            # exactly cost; a Round 3 award on top then genuinely exceeds it. (A full-cost award
            # with its named extra is a separate, by-design case -- see
            # test_a_full_cost_awards_named_extra_does_not_raise_it.)
            {},
            {"appeal_amount": "2000", "round2_decided": True, "round3_amount": "500", "round3_statement_of_need": True},
            "award_above_cost",
            "warn",
            {"award_tables.camp.tiers.2.total_pct": "100"},
        ),
        ({}, {"ask": "3200", "appeal_amount": "1000"}, "appeal_above_ask", "warn", None),
        ({"dependents": 20}, {}, "implausible_dependents", "warn", None),
        (
            {},
            {"person_cm_id": None, "program_key": "family_camp", "session_cm_id": 1000201},
            "family_cost_missing",
            "block",
            None,
        ),
        ({"prior_year_confirmed": "90000"}, {}, "py_confirm_tier_change", "warn", None),
    ],
)
def test_each_check_fires_with_its_severity(
    app_fields: dict[str, Any],
    request_fields: dict[str, Any],
    code: str,
    severity: str,
    lever_changes: dict[str, Any] | None,
) -> None:
    # (pytest reserves the name "request" for its own fixture.)
    rules = with_levers(fictional_rules(), lever_changes) if lever_changes else None
    result = _run(rules, app_fields=app_fields, **request_fields)
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


def test_placeholder_income_ignores_a_staff_entered_override_with_no_gross_figures() -> None:
    # No gross figures were ever reported; the override is the real income. That is not
    # a placeholder, even though both gross fields read as "at or below the threshold" if
    # treated as absent-means-zero.
    app_fields = {
        "prior_year_gross": None,
        "current_year_gross": None,
        "income_override": {"mode": "staff_entered", "amount": "80000"},
    }
    assert "placeholder_income" not in _codes(_run(app_fields=app_fields))


def test_placeholder_income_ignores_a_confirmed_only_application_with_no_gross_figures() -> None:
    app_fields = {"prior_year_gross": None, "current_year_gross": None, "prior_year_confirmed": "80000"}
    assert "placeholder_income" not in _codes(_run(app_fields=app_fields))


def test_a_full_cost_awards_named_extra_does_not_raise_it() -> None:
    # Same shape as the sheet's Round 1: 100% of cost plus the decision type's own extra_amount
    # lands the total above cost by design. The extra is a lever staff set on purpose, not a
    # quality problem.
    result = _run(
        app_fields={"prior_year_gross": "100000", "current_year_gross": "100000"},
        ask="5000",
        decision_type="full_cost_program",
    )
    assert "award_above_cost" not in _codes(result)


def test_ask_above_cost_and_award_above_cost_are_silent_when_cost_is_unknown() -> None:
    result = _run(app_fields={}, person_cm_id=None, program_key="family_camp", session_cm_id=1000201)
    assert result.cost is None
    codes = _codes(result)
    assert "ask_above_cost" not in codes
    assert "award_above_cost" not in codes


def test_appeal_above_ask_is_silent_when_r1_is_unknown() -> None:
    rules = with_lever(fictional_rules(), "awards.minimum_when_cost_unknown", False)
    result = _run(rules, session_cm_id=1000999, appeal_amount="1000")
    assert result.status == "needs_input"
    assert result.r1 is None
    assert "appeal_above_ask" not in _codes(result)
