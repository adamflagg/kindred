"""Outside grants and family incentives (catalogue section 2.6).

Only programs in grants.offset_programs are offset (2026: Summer, a staff
ruling). Grants arrive already matched to the camper by person id (sub-project
6); this module decides which of them COUNT: committed vs received, and what a
grant recorded after the Round 1 decision does.
"""

from __future__ import annotations

from decimal import Decimal

from bunking.financial_aid.calculator.inputs import RequestInputs
from bunking.financial_aid.calculator.result import CalcIssue, TraceStep
from bunking.financial_aid.money import ZERO
from bunking.financial_aid.rules.schema import AidRules


def grants_offset(request: RequestInputs, rules: AidRules) -> tuple[Decimal, list[CalcIssue], TraceStep]:
    settings = rules.grants
    issues: list[CalcIssue] = []
    if request.program_key not in settings.offset_programs:
        step = TraceStep(
            key="grants",
            label="Outside grants",
            value=ZERO,
            note=f"Grants do not offset '{request.program_key}' this season",
        )
        return ZERO, issues, step
    total = ZERO
    late = 0
    for grant in request.grants_applicable:
        if settings.count_when == "received" and grant.state != "received":
            continue
        is_late = (
            request.r1_decided_at is not None
            and grant.recorded_at is not None
            and grant.recorded_at > request.r1_decided_at
        )
        if is_late and settings.late_grant_policy != "recalculate":
            late += 1
            if settings.late_grant_policy == "flag":
                issues.append(
                    CalcIssue(
                        code="late_grant",
                        severity="warn",
                        message="A grant recorded after the Round 1 decision was left out of Round 1; "
                        "finance decides whether to recalculate",
                        step="grants",
                    )
                )
            continue
        total += grant.amount
    step = TraceStep(
        key="grants",
        label="Outside grants",
        value=total,
        inputs={"count_when": settings.count_when, "offset_mode": settings.offset_mode, "late_left_out": late},
    )
    return total, issues, step


def incentive_adjustments(request: RequestInputs, rules: AidRules) -> tuple[Decimal, Decimal, list[CalcIssue]]:
    reduce_cost = ZERO
    reduce_award = ZERO
    issues: list[CalcIssue] = []
    for incentive in request.incentives:
        rule = rules.grants.incentives.get(incentive.key)
        if rule is None:
            issues.append(
                CalcIssue(
                    code="unknown_incentive",
                    severity="warn",
                    message=f"Incentive '{incentive.key}' has no rule this season; it was ignored",
                    step="cost",
                )
            )
        elif rule.mode == "reduce_cost":
            reduce_cost += incentive.amount
        elif rule.mode == "reduce_award":
            reduce_award += incentive.amount
    return reduce_cost, reduce_award, issues
