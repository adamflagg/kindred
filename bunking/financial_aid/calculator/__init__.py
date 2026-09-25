"""The financial-aid calculator: a pure function from (application, request, rules) to an award and its trace.

Fixed contract for sub-projects 5, 9 and 10:

    from bunking.financial_aid.calculator import calculate, ApplicationInputs, RequestInputs, CalcResult, TraceStep
    from bunking.financial_aid.rules.schema import AidRules
"""

from bunking.financial_aid.calculator.cost import CostResolution, resolve_cost
from bunking.financial_aid.calculator.engine import calculate
from bunking.financial_aid.calculator.income import IncomeResult, household_income
from bunking.financial_aid.calculator.inputs import (
    ApplicationInputs,
    CostOverride,
    GrantInput,
    Headcount,
    IncentiveInput,
    IncomeOverride,
    RequestInputs,
)
from bunking.financial_aid.calculator.result import CalcIssue, CalcResult, TraceStep
from bunking.financial_aid.calculator.tiers import income_tier

__all__ = [
    "ApplicationInputs",
    "CalcIssue",
    "CalcResult",
    "CostOverride",
    "CostResolution",
    "GrantInput",
    "Headcount",
    "IncentiveInput",
    "IncomeOverride",
    "IncomeResult",
    "RequestInputs",
    "TraceStep",
    "calculate",
    "household_income",
    "income_tier",
    "resolve_cost",
]
