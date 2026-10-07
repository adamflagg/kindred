"""Outside grants (catalogue section 2.6); the family-incentive step is a no-op seam since the cull.

Only programs in grants.offset_programs are offset (2026: Summer, a staff
ruling). Grants arrive already matched to the camper by person id (sub-project
6); this module decides which of them COUNT: committed vs received, what a grant
recorded after the Round 1 decision does, and which grants an appeal counts: one
recorded before the appeal is decided counts in it (owner ruling 2026-09-25, reversed by D139: an appeal never
subtracts outside grants. That figure is read only where round2.cap_subtracts_grants or round2.total_cap.include_grants
is on, and both are off in the 2027 rules).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

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
                        message="A grant recorded after Round 1 was left out of it; the offer stands",
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
    what follows it; the Round 1 award already offered stands. Read only where round2.cap_subtracts_grants or
    round2.total_cap.include_grants is on (D139: an appeal otherwise never subtracts grants)."""
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


GrantRound = Literal["not_offset_program", "not_received", "round_1", "after_round_1", "after_appeal"]


def grant_round(grant: GrantInput, request: RequestInputs, rules: AidRules) -> GrantRound:
    """When this grant became known, against the request's posted decisions: the one rule the grants Register reads
    (slice 3 ask 10). It reads dates and the rules' two exclusions only: no `late_grant_policy` and no cap lever, so
    it never changes what `grants_offset` or `grants_since_round1` sum (those feed the receipt and stay as they are).

    round_1: not recorded after Round 1's decision (a Round 1 not yet posted has no decision, so every grant is).
    after_round_1: recorded after Round 1's decision and not after the appeal's (an appeal still open, or not asked,
    included). after_appeal: recorded after the appeal's decision. A grant recorded after a posted Round 1 is after it
    whatever `late_grant_policy` says: a posted amount stands (D43). Whether an appeal counts an after_round_1 grant is
    the rules' call (D139: it does not, unless `round2.cap_subtracts_grants` or `round2.total_cap.include_grants` is
    on); the Register applies that, not this."""
    settings = rules.grants
    if request.program_key not in settings.offset_programs:
        return "not_offset_program"
    if settings.count_when == "received" and grant.state != "received":
        return "not_received"
    if not _recorded_after(grant, request.r1_decided_at):
        return "round_1"
    if not _recorded_after(grant, request.r2_decided_at):
        return "after_round_1"
    return "after_appeal"


def grants_known_at_offer(request: RequestInputs, *, appeal_paid: bool) -> Decimal:
    """Every grant the family had when the camp made its latest offer: any program, committed
    or received. The offer is the appeal decision when the appeal (or Round 3) paid something,
    else Round 1's: an appeal that adds nothing offers nothing new, and a grant that arrived
    after the Round 1 offer is accepted.

    The never-above-cost check (spec section 2 item 19) counts these whether or not they
    offset this program's award. Only a grant recorded after that decision is left out,
    because a family may end above cost that way.
    """
    offered_at = request.r2_decided_at if appeal_paid else request.r1_decided_at
    return sum((g.amount for g in request.grants_applicable if not _recorded_after(g, offered_at)), start=ZERO)


def _recorded_after(grant: GrantInput, decided_at: datetime | None) -> bool:
    return decided_at is not None and grant.recorded_at is not None and grant.recorded_at > decided_at


def incentive_adjustments(request: RequestInputs, rules: AidRules) -> tuple[Decimal, Decimal, list[CalcIssue]]:
    """Family incentives are met as "ignore", the only mode any season set (owner 10-06 cull, explainer fn 2): no
    request carries one, and none reduces the cost or the award. Kept as the engine's seam."""
    return ZERO, ZERO, []
