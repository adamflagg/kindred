"""Household income: the blend, the adjustments, the floor, and half-up rounding."""

from decimal import Decimal
from typing import Any

import pytest

from bunking.financial_aid.calculator.income import household_income
from bunking.financial_aid.calculator.inputs import ApplicationInputs
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import app, fictional_rules, with_lever, with_levers


def _income(rules: AidRules | None = None, **fields: Any) -> Decimal:
    adjusted = household_income(app(**fields), rules or fictional_rules()).adjusted_income
    assert adjusted is not None
    return adjusted


def test_the_blend_weights_prior_and_current_year() -> None:
    rules = with_levers(fictional_rules(), {"income.weights.prior_year": "0.7", "income.weights.current_year": "0.3"})
    assert _income(rules, prior_year_gross="100000", current_year_gross="50000") == Decimal(85000)


def test_the_two_weights_are_independent_levers() -> None:
    rules = with_levers(fictional_rules(), {"income.weights.prior_year": "1", "income.weights.current_year": "0"})
    assert _income(rules, prior_year_gross="100000", current_year_gross="50000") == Decimal(100000)


@pytest.mark.parametrize(
    ("basis", "fields", "expected"),
    [
        ("gross", {"prior_year_agi": "90000"}, 85000),
        ("agi", {"prior_year_agi": "90000"}, 78000),
        ("confirmed", {"prior_year_confirmed": "110000"}, 92000),
        ("confirmed", {}, 85000),
    ],
)
def test_the_basis_picks_the_prior_year_figure(basis: str, fields: dict[str, str], expected: int) -> None:
    rules = with_lever(fictional_rules(), "income.basis", basis)
    assert _income(rules, prior_year_gross="100000", current_year_gross="50000", **fields) == Decimal(expected)


def test_a_missing_confirmed_figure_falls_back_to_gross_and_says_so() -> None:
    rules = with_lever(fictional_rules(), "income.basis", "confirmed")
    result = household_income(app(prior_year_gross="100000", current_year_gross="50000"), rules)
    assert "gross" in (result.trace[0].note or "")


@pytest.mark.parametrize(("fallback", "expected"), [("blend", 70000), ("prior_year_only", 100000)])
def test_the_current_year_zero_fallback(fallback: str, expected: int) -> None:
    rules = with_lever(fictional_rules(), "income.current_year_zero_fallback", fallback)
    assert _income(rules, prior_year_gross="100000", current_year_gross="0") == Decimal(expected)


@pytest.mark.parametrize(
    ("override", "expected"),
    [
        ({"mode": "prior_year_only"}, 100000),
        ({"mode": "current_year_only"}, 50000),
        ({"mode": "confirmed_prior_year"}, 92000),
        ({"mode": "staff_entered", "amount": "42000"}, 42000),
    ],
)
def test_a_per_application_income_override(override: dict[str, str], expected: int) -> None:
    got = _income(
        prior_year_gross="100000",
        current_year_gross="50000",
        prior_year_confirmed="110000",
        income_override=override,
    )
    assert got == Decimal(expected)


def test_staff_entered_income_still_takes_the_adjustments() -> None:
    rules = with_lever(fictional_rules(), "income.medical_threshold", "4000")
    got = _income(rules, income_override={"mode": "staff_entered", "amount": "42000"}, medical_expenses="6000")
    assert got == Decimal(40000)


@pytest.mark.parametrize(("medical", "expected"), [("4000", 60000), ("4001", 59999), (None, 60000)])
def test_medical_is_deducted_only_strictly_above_the_threshold(medical: str | None, expected: int) -> None:
    rules = with_lever(fictional_rules(), "income.medical_threshold", "4000")
    assert _income(rules, medical_expenses=medical) == Decimal(expected)


def test_the_medical_rate() -> None:
    rules = with_levers(fictional_rules(), {"income.medical_threshold": "4000", "income.medical_rate": "0.5"})
    assert _income(rules, medical_expenses="6000") == Decimal(59000)


def test_the_education_threshold_and_rate() -> None:
    rules = with_levers(fictional_rules(), {"income.education_threshold": "1000", "income.education_rate": "1"})
    assert _income(rules, education_expenses="3000") == Decimal(58000)
    assert _income(with_lever(rules, "income.education_rate", "0.5"), education_expenses="3000") == Decimal(59000)


def test_savings_above_the_threshold_are_added_at_the_rate() -> None:
    rules = with_levers(fictional_rules(), {"income.savings_threshold": "150000", "income.savings_inclusion_rate": "1"})
    assert _income(rules, savings="150000") == Decimal(60000)
    assert _income(rules, savings="200000") == Decimal(110000)
    assert _income(with_lever(rules, "income.savings_inclusion_rate", "0.1"), savings="200000") == Decimal(65000)


def test_the_per_dependent_reduction_applies_only_in_income_mode() -> None:
    rules = with_levers(
        fictional_rules(), {"income.dependents_mode": "income_reduction", "income.per_dependent_reduction": "5000"}
    )
    assert _income(rules, dependents=3) == Decimal(45000)
    assert _income(with_lever(rules, "income.dependents_mode", "tier_shift"), dependents=3) == Decimal(60000)
    assert _income(with_lever(rules, "income.dependents_mode", "none"), dependents=3) == Decimal(60000)


def test_the_floor_tested_after_all_reductions() -> None:
    rules = with_levers(
        fictional_rules(), {"income.per_dependent_reduction": "3000", "income.floor_applies_after": "all_reductions"}
    )
    assert _income(rules, prior_year_gross="10000", current_year_gross="10000", dependents=4) == Decimal(0)


def test_the_2026_floor_order_lets_income_go_negative() -> None:
    # The sheet tested the floor BEFORE the dependent reduction: 10,000 passes, then
    # 4 x 3,000 takes it to -2,000.
    rules = with_levers(
        fictional_rules(), {"income.per_dependent_reduction": "3000", "income.floor_applies_after": "deductions"}
    )
    assert _income(rules, prior_year_gross="10000", current_year_gross="10000", dependents=4) == Decimal(-2000)


def test_a_raised_income_floor() -> None:
    rules = with_lever(fictional_rules(), "income.floor", "5000")
    assert _income(rules, prior_year_gross="3000", current_year_gross="3000") == Decimal(5000)


def test_a_negative_reported_income_floors_at_zero() -> None:
    # (Review Focus) A business loss: 0.7 x -20,000 + 0.3 x 10,000 = -11,000 -> 0, never "no tier".
    assert _income(prior_year_gross="-20000", current_year_gross="10000") == Decimal(0)


def test_income_rounds_half_up_to_whole_dollars() -> None:
    # 0.7 x 79,999 + 0.3 x 80,004 = 80,000.5 -> 80,001 (banker's rounding would give 80,000).
    assert _income(prior_year_gross="79999", current_year_gross="80004") == Decimal(80001)


def test_the_trace_names_each_step_and_the_parts_are_exposed() -> None:
    result = household_income(app(medical_expenses="5000"), fictional_rules())
    assert [s.key for s in result.trace] == ["weighted_income", "income_adjustments", "adjusted_income"]
    assert result.medical_excess == Decimal(1000)
    assert result.adjusted_income == Decimal(59000)


def test_the_trace_records_the_prior_year_figure_actually_used_and_the_weights() -> None:
    rules = with_lever(fictional_rules(), "income.basis", "agi")
    result = household_income(app(prior_year_gross="100000", prior_year_agi="90000", current_year_gross="50000"), rules)
    step = result.trace[0]
    assert step.inputs["prior_year"] == Decimal(90000)
    assert step.inputs["weight_prior"] == Decimal("0.7")
    assert step.inputs["weight_current"] == Decimal("0.3")
    assert step.inputs["basis"] == "agi"
    assert step.inputs["override_mode"] is None


def test_a_household_with_no_income_figures_is_explicitly_missing() -> None:
    result = household_income(ApplicationInputs(), fictional_rules())
    assert result.income_missing is True
    assert "no income figures reported" in (result.trace[0].note or "")


def test_explicit_zero_income_is_not_missing() -> None:
    result = household_income(
        ApplicationInputs(prior_year_gross=Decimal(0), current_year_gross=Decimal(0)), fictional_rules()
    )
    assert result.income_missing is False


# --- C1 (final review): a figure the rules NEED that is not reported is never priced as 0 ---


def test_an_agi_basis_with_only_gross_reported_is_missing_not_zero() -> None:
    # Pricing the absent AGI at 0 put this household on tier 1, the most generous.
    rules = with_lever(fictional_rules(), "income.basis", "agi")
    result = household_income(app(prior_year_gross="100000", current_year_gross="50000"), rules)
    assert result.income_missing is True
    assert result.missing_figures == ("prior_year_agi",)
    assert (result.weighted_income, result.adjusted_income) == (None, None)
    assert result.trace[0].value is None
    assert result.trace[0].inputs["prior_year"] is None


def test_a_blend_with_the_current_year_missing_is_missing_not_zero() -> None:
    # The blend used to price the absent current year at 0 and understate income by a tier.
    result = household_income(app(prior_year_gross="100000", current_year_gross=None), fictional_rules())
    assert result.income_missing is True
    assert result.missing_figures == ("current_year_gross",)
    assert result.adjusted_income is None
    assert result.trace[0].inputs["current_year"] is None


@pytest.mark.parametrize(
    ("override", "fields", "missing"),
    [
        ("prior_year_only", {"prior_year_gross": None, "current_year_gross": "50000"}, "prior_year_gross"),
        ("current_year_only", {"prior_year_gross": "100000", "current_year_gross": None}, "current_year_gross"),
        ("confirmed_prior_year", {"prior_year_gross": None, "current_year_gross": "50000"}, "prior_year_gross"),
    ],
)
def test_an_override_on_an_absent_figure_is_missing_not_zero(
    override: str, fields: dict[str, Any], missing: str
) -> None:
    result = household_income(app(income_override={"mode": override}, **fields), fictional_rules())
    assert result.income_missing is True
    assert missing in result.missing_figures
    assert result.adjusted_income is None


def test_a_figure_whose_weight_is_zero_is_not_needed() -> None:
    rules = with_levers(fictional_rules(), {"income.weights.prior_year": "1", "income.weights.current_year": "0"})
    result = household_income(app(prior_year_gross="100000", current_year_gross=None), rules)
    assert (result.income_missing, result.missing_figures, result.adjusted_income) == (False, (), Decimal(100000))
    prior_zero = with_levers(fictional_rules(), {"income.weights.prior_year": "0", "income.weights.current_year": "1"})
    result = household_income(app(prior_year_gross=None, current_year_gross="50000"), prior_zero)
    assert (result.income_missing, result.adjusted_income) == (False, Decimal(50000))


def test_the_confirmed_basis_still_falls_back_to_gross_and_is_missing_only_when_both_are() -> None:
    rules = with_lever(fictional_rules(), "income.basis", "confirmed")
    fallback = household_income(app(prior_year_gross="100000", current_year_gross="50000"), rules)
    assert (fallback.income_missing, fallback.adjusted_income) == (False, Decimal(85000))
    assert "gross" in (fallback.trace[0].note or "")
    neither = household_income(app(prior_year_gross=None, prior_year_agi="90000", current_year_gross="50000"), rules)
    assert neither.income_missing is True
    # Either figure would do, so both are named: neither was reported.
    assert neither.missing_figures == ("prior_year_confirmed", "prior_year_gross")


def test_a_staff_entered_income_needs_no_reported_figure() -> None:
    result = household_income(
        ApplicationInputs(income_override={"mode": "staff_entered", "amount": Decimal(42000)}), fictional_rules()
    )
    assert (result.income_missing, result.adjusted_income) == (False, Decimal(42000))
