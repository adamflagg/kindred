"""Outside grants and family incentives (catalogue section 2.6).

Only programs in grants.offset_programs are offset (2026: Summer, a staff
ruling). Grants arrive already matched to the camper by person id (sub-project
6); this module decides which of them COUNT: committed vs received, what a grant
recorded after the Round 1 decision does, and which grants an appeal counts: one
recorded before the appeal is decided counts in it (owner ruling 2026-09-25).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from bunking.financial_aid.calculator.inputs import GrantInput, RequestInputs
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
        if _recorded_after(grant, request.r1_decided_at) and settings.late_grant_policy != "recalculate":
            late += 1
            if settings.late_grant_policy == "flag":
                issues.append(
                    CalcIssue(
                        code="late_grant",
                        severity="warn",
                        message="A grant recorded after the Round 1 decision was left out of Round 1; "
                        "the award already offered stands",
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


def grants_since_round1(request: RequestInputs, rules: AidRules) -> Decimal:
    """Counted grants that Round 1 left out as late but that were recorded before the appeal
    was decided (or while it is still open). They count in the appeal, reducing Round 2 and
    what follows it; the Round 1 award already offered stands."""
    settings = rules.grants
    if (
        request.program_key not in settings.offset_programs
        or settings.late_grant_policy == "recalculate"  # Round 1 already counted them
        or request.r1_decided_at is None
    ):
        return ZERO
    return sum(
        (
            g.amount
            for g in request.grants_applicable
            if (settings.count_when == "committed" or g.state == "received")
            and _recorded_after(g, request.r1_decided_at)
            and not _recorded_after(g, request.r2_decided_at)
        ),
        start=ZERO,
    )


def grants_known_at_offer(request: RequestInputs) -> Decimal:
    """Every grant the family had when the camp made its latest offer: any program, committed
    or received. The offer is the appeal decision when there is an appeal, else Round 1's.

    The never-above-cost check (spec section 2 item 19) counts these whether or not they
    offset this program's award. Only a grant recorded after that decision is left out,
    because a family may end above cost that way.
    """
    offered_at = request.r2_decided_at if request.appeal_amount is not None else request.r1_decided_at
    return sum((g.amount for g in request.grants_applicable if not _recorded_after(g, offered_at)), start=ZERO)


def _recorded_after(grant: GrantInput, decided_at: datetime | None) -> bool:
    return decided_at is not None and grant.recorded_at is not None and grant.recorded_at > decided_at


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
