"""Data-quality checks the calculator can see (spec section 10.5).

Severity and thresholds are rules settings. A check never changes the award or
the result's status: "hold" tells sub-project 10 not to finalize until staff
look; "warn" only informs. `award_above_cost` is not a setting: it always runs
and always holds (spec section 2 item 19). Checks that need data the calculator does not have
(an unmatched session, stage vs enrollment, a household's applications
disagreeing on income) are evaluated where that data is (sub-projects 5, 10).

Messages name the check and the threshold, never the family's own figures.
"""

from __future__ import annotations

from decimal import Decimal

from bunking.financial_aid.calculator.grants import grants_known_at_offer
from bunking.financial_aid.calculator.income import IncomeResult, household_income
from bunking.financial_aid.calculator.inputs import ApplicationInputs, IncomeOverride, RequestInputs
from bunking.financial_aid.calculator.result import CalcIssue
from bunking.financial_aid.calculator.tiers import income_tier as tier_of
from bunking.financial_aid.rules.schema import AidRules, ProgramProfile, QualityCheck, QualityCheckKey


def run_quality_checks(
    application: ApplicationInputs,
    request: RequestInputs,
    rules: AidRules,
    program: ProgramProfile,
    income: IncomeResult,
    *,
    income_tier: int | None,
    cost: Decimal | None,
    total: Decimal | None,
    r1: Decimal | None,
    extra_amount: Decimal,
) -> list[CalcIssue]:
    checks = rules.quality_checks.checks
    issues: list[CalcIssue] = []

    def active(key: QualityCheckKey) -> QualityCheck | None:
        check = checks.get(key)
        return check if check is not None and check.enabled else None

    def fire(key: QualityCheckKey, check: QualityCheck, message: str) -> None:
        issues.append(CalcIssue(code=key, severity=check.severity, message=message, step="quality"))

    if (check := active("ask_above_cost")) and cost is not None and request.ask is not None and request.ask > cost:
        fire("ask_above_cost", check, "The ask is above the cost")
    adjusted = income.adjusted_income
    if (
        (check := active("income_above"))
        and check.threshold is not None
        and adjusted is not None
        and adjusted > check.threshold
    ):
        fire("income_above", check, f"Adjusted income is above {check.threshold}")
    largest_expense = max(income.medical_excess, income.education_excess, income.dependent_reduction)
    if (check := active("expense_above")) and check.threshold is not None and largest_expense > check.threshold:
        fire("expense_above", check, f"A counted expense or reduction is above {check.threshold}")
    if (check := active("multiple_grants")) and len(request.grants_applicable) > 1:
        fire("multiple_grants", check, "This camper has more than one outside grant")
    # Absent gross figures are unknown, not 0: a household with only a staff override or only
    # a confirmed prior-year figure has no gross figure to call a placeholder, so the check
    # is silent rather than comparing an invented 0 to the threshold.
    reported_grosses = [g for g in (application.prior_year_gross, application.current_year_gross) if g is not None]
    if reported_grosses:
        reported = max(reported_grosses)
        if (check := active("placeholder_income")) and check.threshold is not None and reported <= check.threshold:
            fire(
                "placeholder_income",
                check,
                f"Reported income is at or below {check.threshold}; it may be a placeholder",
            )
    # Always on and always a hold, whatever the season lists. A full_cost decision type's named
    # extra_amount is a deliberate lever (Round 1 = cost - grants + extra, by design), so it
    # raises the bar rather than tripping the check itself.
    if cost is not None and total is not None and total + grants_known_at_offer(request) > cost + extra_amount:
        issues.append(
            CalcIssue(
                code="award_above_cost",
                severity="hold",
                message="Aid plus the outside grants known at the offer is above the cost",
                step="quality",
            )
        )
    if (
        (check := active("appeal_above_ask"))
        and request.appeal_amount is not None
        and request.ask is not None
        and r1 is not None
        and request.appeal_amount > request.ask - r1
    ):
        fire("appeal_above_ask", check, "The appeal is above what is left of the original ask")
    if (
        (check := active("implausible_dependents"))
        and check.threshold is not None
        and application.dependents is not None
        and application.dependents > check.threshold
    ):
        fire("implausible_dependents", check, f"More than {check.threshold} dependents")
    if (check := active("family_cost_missing")) and program.cost_source == "per_person" and cost is None:
        fire("family_cost_missing", check, "Family-camp cost is missing: enter the headcount")
    if (
        (check := active("py_confirm_tier_change"))
        and income_tier is not None
        and application.prior_year_confirmed is not None
        and application.income_override is None
    ):
        confirmed = application.model_copy(update={"income_override": IncomeOverride(mode="confirmed_prior_year")})
        confirmed_income = household_income(confirmed, rules).adjusted_income
        # Silent when the confirmed figure cannot be priced (a needed figure is absent):
        # there is no tier to compare, and the missing figure is reported elsewhere.
        if confirmed_income is not None and tier_of(confirmed_income, rules) != income_tier:
            fire("py_confirm_tier_change", check, "The confirmed prior-year income would change the tier")
    return issues
