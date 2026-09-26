"""Adjusted household income (catalogue section 2.1, chain items 1-3).

    weighted  = prior-year weight x PY + current-year weight x CY   (or an override)
    base      = weighted - medical excess - education excess + savings excess +/- extra terms
    adjusted  = base - dependents x per-dependent reduction          (income mode only)
    result    = floor if round(tested) <= floor else round(adjusted)

`tested` is `base` when income.floor_applies_after == "deductions" (the 2026
order, where a large family can end below zero) and `adjusted` otherwise.
Income belongs to the household: compute it once per application.

An income figure the calculation NEEDS but the family did not report is unknown,
never 0 (spec principle 5): `missing_figures` names it, `weighted_income` and
`adjusted_income` stay None, and the engine returns needs_input. A figure is
needed when it carries a weight above 0 -- the basis's prior-year figure, the
current-year gross in a blend -- or when an override picks it. A figure whose
weight is 0 is not needed. The confirmed basis still falls back to gross when a
family has no confirmed figure; only when both are absent is it missing.
"""

from __future__ import annotations

from decimal import Decimal
from typing import NamedTuple

from pydantic import BaseModel, ConfigDict

from bunking.financial_aid.calculator.inputs import ApplicationInputs
from bunking.financial_aid.calculator.result import TraceStep
from bunking.financial_aid.money import ONE, ZERO, round_dollars, zero_if_blank
from bunking.financial_aid.rules.schema import AidRules, IncomeSection

_FIGURE_LABELS = {
    "prior_year_gross": "prior-year gross",
    "prior_year_agi": "prior-year AGI",
    "prior_year_confirmed": "confirmed prior-year income",
    "current_year_gross": "current-year gross",
}


class IncomeResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    weighted_income: Decimal | None
    medical_excess: Decimal
    education_excess: Decimal
    savings_excess: Decimal
    # The net of income.extra_terms: negative when the terms deduct more than they add.
    extra_terms: Decimal
    dependent_reduction: Decimal
    adjusted_income: Decimal | None
    income_missing: bool
    # ApplicationInputs field names of the needed figures that were not reported.
    missing_figures: tuple[str, ...] = ()
    trace: list[TraceStep]


class _Weighted(NamedTuple):
    """The blended figure plus everything an auditor needs to see WHY it is what it is."""

    value: Decimal | None
    note: str | None
    prior_used: Decimal | None
    weight_prior: Decimal | None
    weight_current: Decimal | None
    basis_used: str | None
    override_mode: str | None
    missing: tuple[str, ...] = ()


class _Prior(NamedTuple):
    value: Decimal | None
    note: str | None
    # The field(s) that would have supplied it, named when value is None.
    wanted: tuple[str, ...]


def household_income(application: ApplicationInputs, rules: AidRules) -> IncomeResult:
    income = rules.income
    weighted = _weighted_income(application, income)
    missing = weighted.missing
    medical = _excess(application.medical_expenses, income.medical_threshold, income.medical_rate)
    education = _excess(application.education_expenses, income.education_threshold, income.education_rate)
    savings = _excess(application.savings, income.savings_threshold, income.savings_inclusion_rate)
    extra = _extra_terms(application, income)
    dependents = application.dependents or 0
    reduction = income.per_dependent_reduction * dependents if income.dependents_mode == "income_reduction" else ZERO
    adjustments = savings - medical - education + extra
    base: Decimal | None = None
    adjusted: Decimal | None = None
    result: Decimal | None = None
    bound: str | None = None
    if weighted.value is not None:
        base = weighted.value + adjustments
        adjusted = base - reduction
        tested = base if income.floor_applies_after == "deductions" else adjusted
        if round_dollars(tested) <= income.floor:
            result, bound = income.floor, "floor"
        else:
            result = round_dollars(adjusted)
    trace = [
        TraceStep(
            key="weighted_income",
            label="Weighted income",
            value=weighted.value,
            inputs={
                "prior_year": weighted.prior_used,
                "current_year": application.current_year_gross,
                "weight_prior": weighted.weight_prior,
                "weight_current": weighted.weight_current,
                "basis": weighted.basis_used,
                "override_mode": weighted.override_mode,
            },
            note=_missing_note(application, missing) if missing else weighted.note,
        ),
        TraceStep(
            key="income_adjustments",
            label="Income adjustments",
            value=adjustments,
            inputs={
                "medical_excess": medical,
                "education_excess": education,
                "savings_excess": savings,
                "extra_terms": extra,
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
        extra_terms=extra,
        dependent_reduction=reduction,
        adjusted_income=result,
        income_missing=bool(missing),
        missing_figures=missing,
        trace=trace,
    )


def describe_missing(missing: tuple[str, ...]) -> str:
    """The missing figures as staff read them, e.g. "prior-year AGI and current-year gross"."""
    return " and ".join(_FIGURE_LABELS.get(name, name) for name in missing)


def nothing_reported(application: ApplicationInputs) -> bool:
    """No income figure at all and no override -- as opposed to one needed figure absent."""
    figures = (
        application.prior_year_gross,
        application.prior_year_agi,
        application.prior_year_confirmed,
        application.current_year_gross,
    )
    return all(figure is None for figure in figures) and application.income_override is None


def _missing_note(application: ApplicationInputs, missing: tuple[str, ...]) -> str:
    if nothing_reported(application):
        return "no income figures reported"
    return f"Not reported, but needed by this season's rules: {describe_missing(missing)}"


def _excess(amount: Decimal | None, threshold: Decimal, rate: Decimal) -> Decimal:
    # A blank expense or savings figure means the family has none: 0 is right here.
    value = zero_if_blank(amount)
    return (value - threshold) * rate if value > threshold else ZERO


def _extra_terms(application: ApplicationInputs, income: IncomeSection) -> Decimal:
    total = ZERO
    for term in income.extra_terms:
        amount = _excess(application.figures.get(term.figure), term.threshold, term.rate)
        total += amount if term.direction == "add" else -amount
    return total


def _prior_year(application: ApplicationInputs, basis: str) -> _Prior:
    if basis == "agi":
        return _Prior(application.prior_year_agi, None, ("prior_year_agi",))
    if basis == "confirmed":
        if application.prior_year_confirmed is not None:
            return _Prior(application.prior_year_confirmed, None, ("prior_year_confirmed",))
        if application.prior_year_gross is not None:
            return _Prior(
                application.prior_year_gross,
                "No confirmed prior-year figure; used prior-year gross",
                ("prior_year_gross",),
            )
        return _Prior(None, None, ("prior_year_confirmed", "prior_year_gross"))
    return _Prior(application.prior_year_gross, None, ("prior_year_gross",))


def _blend(
    prior: _Prior, current: Decimal | None, weight_prior: Decimal, weight_current: Decimal
) -> tuple[Decimal | None, tuple[str, ...]]:
    """weight x figure summed over the figures that carry weight; a weighted figure that is absent is missing."""
    missing: list[str] = []
    total = ZERO
    if weight_prior > 0:
        if prior.value is None:
            missing.extend(prior.wanted)
        else:
            total += weight_prior * prior.value
    if weight_current > 0:
        if current is None:
            missing.append("current_year_gross")
        else:
            total += weight_current * current
    return (None, tuple(missing)) if missing else (total, ())


def _weighted_income(application: ApplicationInputs, income: IncomeSection) -> _Weighted:
    prior = _prior_year(application, income.basis)
    current = application.current_year_gross
    weights = income.weights
    override = application.income_override
    if override is not None:
        if override.mode == "staff_entered":
            # The validator guarantees an amount for staff_entered.
            return _Weighted(override.amount, "Staff-entered income", None, None, None, None, override.mode)
        if override.mode == "prior_year_only":
            value, missing = _blend(prior, None, ONE, ZERO)
            return _Weighted(
                value, "Override: prior year only", prior.value, ONE, ZERO, income.basis, override.mode, missing
            )
        if override.mode == "current_year_only":
            value, missing = _blend(_Prior(None, None, ()), current, ZERO, ONE)
            return _Weighted(value, "Override: current year only", None, ZERO, ONE, None, override.mode, missing)
        confirmed = _prior_year(application, "confirmed")
        value, missing = _blend(confirmed, current, weights.prior_year, weights.current_year)
        note_out = confirmed.note or "Override: confirmed prior-year figure"
        return _Weighted(
            value,
            note_out,
            confirmed.value,
            weights.prior_year,
            weights.current_year,
            "confirmed",
            override.mode,
            missing,
        )
    if (
        current is not None
        and current == 0
        and prior.value is not None
        and prior.value > 0
        and income.current_year_zero_fallback == "prior_year_only"
    ):
        return _Weighted(
            prior.value,
            "Current-year income is 0; used the prior year alone",
            prior.value,
            ONE,
            ZERO,
            income.basis,
            None,
        )
    value, missing = _blend(prior, current, weights.prior_year, weights.current_year)
    return _Weighted(
        value, prior.note, prior.value, weights.prior_year, weights.current_year, income.basis, None, missing
    )
