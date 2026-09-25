"""Adjusted household income (catalogue section 2.1, chain items 1-3).

    weighted  = prior-year weight x PY + current-year weight x CY   (or an override)
    base      = weighted - medical excess - education excess + savings excess
    adjusted  = base - dependents x per-dependent reduction          (income mode only)
    result    = floor if round(tested) <= floor else round(adjusted)

`tested` is `base` when income.floor_applies_after == "deductions" (the 2026
order, where a large family can end below zero) and `adjusted` otherwise.
Income belongs to the household: compute it once per application.
"""

from __future__ import annotations

from decimal import Decimal
from typing import NamedTuple

from pydantic import BaseModel, ConfigDict

from bunking.financial_aid.calculator.inputs import ApplicationInputs
from bunking.financial_aid.calculator.result import TraceStep
from bunking.financial_aid.money import ONE, ZERO, round_dollars, to_money
from bunking.financial_aid.rules.schema import AidRules, IncomeSection


class IncomeResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    weighted_income: Decimal
    medical_excess: Decimal
    education_excess: Decimal
    savings_excess: Decimal
    dependent_reduction: Decimal
    adjusted_income: Decimal
    income_missing: bool
    trace: list[TraceStep]


class _Weighted(NamedTuple):
    """The blended figure plus everything an auditor needs to see WHY it is what it is."""

    value: Decimal
    note: str | None
    prior_used: Decimal | None
    weight_prior: Decimal | None
    weight_current: Decimal | None
    basis_used: str | None
    override_mode: str | None


def household_income(application: ApplicationInputs, rules: AidRules) -> IncomeResult:
    income = rules.income
    weighted = _weighted_income(application, income)
    missing = _income_missing(application)
    medical = _excess(application.medical_expenses, income.medical_threshold, income.medical_rate)
    education = _excess(application.education_expenses, income.education_threshold, income.education_rate)
    savings = _excess(application.savings, income.savings_threshold, income.savings_inclusion_rate)
    dependents = application.dependents or 0
    reduction = income.per_dependent_reduction * dependents if income.dependents_mode == "income_reduction" else ZERO
    base = weighted.value - medical - education + savings
    adjusted = base - reduction
    tested = base if income.floor_applies_after == "deductions" else adjusted
    if round_dollars(tested) <= income.floor:
        result, bound = income.floor, "floor"
    else:
        result, bound = round_dollars(adjusted), None
    trace = [
        TraceStep(
            key="weighted_income",
            label="Weighted income",
            value=weighted.value,
            inputs={
                "prior_year": weighted.prior_used,
                "current_year": to_money(application.current_year_gross),
                "weight_prior": weighted.weight_prior,
                "weight_current": weighted.weight_current,
                "basis": weighted.basis_used,
                "override_mode": weighted.override_mode,
            },
            note="no income figures reported" if missing else weighted.note,
        ),
        TraceStep(
            key="income_adjustments",
            label="Income adjustments",
            value=base - weighted.value,
            inputs={
                "medical_excess": medical,
                "education_excess": education,
                "savings_excess": savings,
                "dependent_reduction": reduction,
            },
        ),
        TraceStep(
            key="adjusted_income",
            label="Adjusted household income",
            value=result,
            inputs={"base": base, "after_dependents": adjusted, "floor": income.floor},
            bound=bound,
            note=f"floor tested after {income.floor_applies_after.replace('_', ' ')}",
        ),
    ]
    return IncomeResult(
        weighted_income=weighted.value,
        medical_excess=medical,
        education_excess=education,
        savings_excess=savings,
        dependent_reduction=reduction,
        adjusted_income=result,
        income_missing=missing,
        trace=trace,
    )


def _income_missing(application: ApplicationInputs) -> bool:
    """True only when every income figure is unreported (None) and nothing overrides them.

    A figure reported as 0 is a real answer, not a missing one -- only the absence
    of all four figures, with no income_override to supply a value instead, counts.
    """
    figures = (
        application.prior_year_gross,
        application.prior_year_agi,
        application.prior_year_confirmed,
        application.current_year_gross,
    )
    return all(figure is None for figure in figures) and application.income_override is None


def _excess(amount: Decimal | None, threshold: Decimal, rate: Decimal) -> Decimal:
    value = to_money(amount)
    return (value - threshold) * rate if value > threshold else ZERO


def _prior_year(application: ApplicationInputs, basis: str) -> tuple[Decimal, str | None]:
    if basis == "agi":
        return to_money(application.prior_year_agi), None
    if basis == "confirmed":
        if application.prior_year_confirmed is not None:
            return application.prior_year_confirmed, None
        return to_money(application.prior_year_gross), "No confirmed prior-year figure; used prior-year gross"
    return to_money(application.prior_year_gross), None


def _weighted_income(application: ApplicationInputs, income: IncomeSection) -> _Weighted:
    prior, note = _prior_year(application, income.basis)
    current = to_money(application.current_year_gross)
    weights = income.weights
    override = application.income_override
    if override is not None:
        if override.mode == "staff_entered":
            return _Weighted(to_money(override.amount), "Staff-entered income", None, None, None, None, override.mode)
        if override.mode == "prior_year_only":
            return _Weighted(prior, "Override: prior year only", prior, ONE, ZERO, income.basis, override.mode)
        if override.mode == "current_year_only":
            return _Weighted(current, "Override: current year only", None, ZERO, ONE, None, override.mode)
        confirmed, confirmed_note = _prior_year(application, "confirmed")
        blended = weights.prior_year * confirmed + weights.current_year * current
        note_out = confirmed_note or "Override: confirmed prior-year figure"
        return _Weighted(
            blended, note_out, confirmed, weights.prior_year, weights.current_year, "confirmed", override.mode
        )
    if current == 0 and prior > 0 and income.current_year_zero_fallback == "prior_year_only":
        return _Weighted(
            prior, "Current-year income is 0; used the prior year alone", prior, ONE, ZERO, income.basis, None
        )
    blended = weights.prior_year * prior + weights.current_year * current
    return _Weighted(blended, note, prior, weights.prior_year, weights.current_year, income.basis, None)
