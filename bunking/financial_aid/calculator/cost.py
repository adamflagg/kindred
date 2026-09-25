"""The one cost resolver (spec section 8): every program, the award math and the report ratios.

Order: a staff override (with a reason code) wins; otherwise the program's
cost_source decides -- catalog tuition for the session, family-camp headcount x
the season's per-person rates, or "typed" (the program has no price; staff must
type one). Anything missing comes back as amount None with the reason in
`missing`; the engine decides whether that is a warning or needs input.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from bunking.financial_aid.calculator.inputs import RequestInputs
from bunking.financial_aid.calculator.result import CalcIssue
from bunking.financial_aid.rules.schema import AidRules

CostSource = Literal["override", "catalog", "per_person", "typed", "unknown"]


class CostResolution(BaseModel):
    model_config = ConfigDict(frozen=True)

    amount: Decimal | None
    source: CostSource
    missing: str | None = None
    issues: list[CalcIssue] = Field(default_factory=list)


def _unknown(missing: str) -> CostResolution:
    return CostResolution(amount=None, source="unknown", missing=missing)


def resolve_cost(request: RequestInputs, rules: AidRules) -> CostResolution:
    program = rules.programs.get(request.program_key)
    if program is None:
        return _unknown(f"program '{request.program_key}' is not in the rules")
    override = request.cost_override
    if override is not None:
        issues = []
        if override.reason not in rules.cost.override_reasons:
            issues.append(
                CalcIssue(
                    code="unknown_override_reason",
                    severity="warn",
                    message=f"Cost override reason '{override.reason}' is not one of this season's reason codes",
                    step="cost",
                )
            )
        return CostResolution(amount=override.amount, source="override", issues=issues)
    if program.cost_source == "catalog":
        if request.session_cm_id is None:
            return _unknown("the request has no session")
        price = rules.cost.tuition.get(request.session_cm_id)
        if price is None:
            return _unknown(f"no tuition for session {request.session_cm_id}")
        return CostResolution(amount=price, source="catalog")
    if program.cost_source == "per_person":
        return _per_person(request, rules)
    return _unknown("this program has no price; staff must type the cost")


def _per_person(request: RequestInputs, rules: AidRules) -> CostResolution:
    headcount = request.headcount
    if headcount is None or headcount.standard + headcount.infants + headcount.children == 0:
        return _unknown("no family-camp headcount")
    rate = next((r for r in rules.cost.family_rates if r.session_cm_id == request.session_cm_id), None)
    if rate is None:
        return _unknown(f"no family-camp rate for session {request.session_cm_id}")
    child_rate = rate.child if rate.child is not None else rate.standard
    amount = rate.standard * headcount.standard + rate.infant * headcount.infants + child_rate * headcount.children
    return CostResolution(amount=amount, source="per_person")
