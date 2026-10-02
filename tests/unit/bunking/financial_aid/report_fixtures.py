"""Builders for the Reports tests (Reports back end): received requests as every finance report reads them, under
the fictional rules (fixtures.fictional_rules: award tables camp / family / teen; pools camp_pool / weekend_pool /
bmitzvah_pool; six tiers, camp's Round 1 % 90 / 75 / 55 / 35 / 15 / 2). Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from bunking.financial_aid.reports.facts import ReportRequest, RoundFacts, Standing


def rnd(
    n: int,
    *,
    ask: str | None = None,
    posted: str | None = None,
    clawed_back: bool = False,
    decided: str | None = None,
    accepted: bool = False,
    posted_on: date | None = None,
    tier: int | None = 2,
    pool: str | None = "camp_pool",
    outside_budget: bool = False,
    outside_posted: str | None = None,
    outside_decided: str | None = None,
) -> RoundFacts:
    return RoundFacts(
        round=n,
        ask=Decimal(ask) if ask is not None else None,
        locked=Decimal(posted) if posted is not None else None,
        clawed_back=clawed_back,
        decided=Decimal(decided) if decided is not None else None,
        accepted=accepted,
        posted_on=posted_on,
        tier=tier,
        pool=pool,
        outside_budget=outside_budget,
        outside_posted=Decimal(outside_posted) if outside_posted is not None else None,
        outside_decided=Decimal(outside_decided) if outside_decided is not None else None,
    )


def req(
    request_id: str,
    *rounds: RoundFacts,
    household: int = 1000001,
    person: int = 1000011,
    program: str | None = "summer",
    session: int = 1000101,
    pool: str | None = "camp_pool",
    table: str = "camp",
    round2_table: str = "camp",
    standing: Standing = "live",
    reason: str | None = None,
    received_at: datetime | None = datetime(2027, 1, 10, 18, 0, tzinfo=UTC),
    grants: str = "0",
) -> ReportRequest:
    return ReportRequest(
        request_id=request_id,
        household_cm_id=household,
        person_cm_id=person,
        program_key=program,
        session_cm_id=session,
        pool=pool,
        table=table,
        round2_table=round2_table,
        standing=standing,
        cancel_reason=reason,
        received_at=received_at,
        rounds=rounds or (rnd(1),),
        grants=Decimal(grants),
    )
