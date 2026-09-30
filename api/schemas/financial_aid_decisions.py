"""Campership decisions (sub-project 10a): the Requests grid, Rounds & budget and the Remaining line
(reads), and each round's asks and decisions (writes). Spec §5.1–§5.3, §6.1, §7.1–§7.3.

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), as in the
ledger and grants reads. None is "nothing there"; 0 is a real zero (D74). The basis words are
decided and posted (D20, D59). No field here is named "awarded", which is finance's report label
for Posted, or "Total Awards Granted", which is development's all-money figure (§5.6, D80, D87).
A test pins it.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel

from api.schemas.financial_aid_intake import IssueOut

RoundStatusOut = Literal["posted", "held", "pending_approval", "refused", "not_decided", "needs_offer"]


class RoundOut(BaseModel):
    round: int
    status: RoundStatusOut
    ask: float | None
    asked_on: date | None
    decided: float | None
    posted: float | None
    posted_on: date | None
    accepted: bool
    pending_approval: float | None
    would_change_by: float | None
    counts_toward_budget: bool
    rules_version: int | None


class GridRowOut(BaseModel):
    request_id: str
    household_cm_id: int
    family_name: str
    person_cm_id: int
    camper_name: str
    session_cm_id: int
    session_name: str
    program_key: str | None
    pool: str | None
    request_status: str
    tier: int | None
    cost: float | None
    rounds: list[RoundOut]
    total_decided: float | None
    total_posted: float | None
    holds: list[IssueOut]
    notes: list[IssueOut]


class RequestsGridResponse(BaseModel):
    year: int
    rules_version: int | None
    rows: list[GridRowOut]


class CountOut(BaseModel):
    families: int
    requests: int


class CellOut(BaseModel):
    allocated: float | None
    posted: float
    accepted: float
    needs_offer: float
    pending_approval: float
    remaining: float | None


class RoundCellOut(CellOut):
    round: int


class BelowTheLineOut(BaseModel):
    held: CountOut
    held_asked: float
    outside_grants: float
    outside_budget: float


class ForwardDemandOut(BaseModel):
    round2_asks: CountOut
    round2_asked: float
    round2_computed: float
    round1_unmet: float


class PoolBudgetOut(BaseModel):
    pool: str
    label: str
    rounds: list[RoundCellOut]
    total: CellOut
    below: BelowTheLineOut
    demand: ForwardDemandOut


class RoundCountsOut(BaseModel):
    round: int
    needs_offer: CountOut
    posted: CountOut
    accepted: CountOut
    held: CountOut
    pending_approval: CountOut


class BudgetResponse(BaseModel):
    year: int
    rules_version: int | None
    pools: list[PoolBudgetOut]
    total: PoolBudgetOut
    strip: list[RoundCountsOut]
    outside_grants_off_requests: float


class RemainingPoolOut(BaseModel):
    pool: str
    label: str
    remaining: float | None


class RemainingResponse(BaseModel):
    year: int
    pools: list[RemainingPoolOut]
    total: float | None
