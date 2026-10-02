"""Reports' response and request shapes (Reports back end, Part A; clean spec §9.2, §9.3, §9.7, §10, §11).

Money is aid dollars, rounded to cents, sent as a JSON number; a percentage is to one decimal place, also a number
(42.5 means 42.5%); `null` is "nothing to show" (no denominator, not typed, not rebuilt) and `0` is a real zero
(D74). Every table says what it is as of, and on which basis: "P" = awarded = Posted (D80), "r" = as reported
(typed once), so a copied table carries both in its header (RPT-33, §11).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from api.schemas.financial_aid_decisions import NotRebuiltOut
from bunking.financial_aid.scenarios.request_set import RequestSetNote

BasisCode = Literal["P", "r"]
RowKind = Literal["pool", "no_pool", "headline", "reconciliation"]  # a pool's row, money in no pool, every pool,
# or "headline − Σ pools" (a typed season whose pools don't sum, O-930-14)
StatisticsBasis = Literal["posted", "posted_and_decided"]


class ChipOut(BaseModel):
    key: str
    label: str


class NotBuiltOut(BaseModel):
    """A figure Reports doesn't show yet, and what it waits on. Unlike a past date's NotRebuiltOut, it never names a
    request: development's summary reads it too (D65)."""

    figure: str
    reason: str


# --- Statistics (§9.2; RPT-5, RPT-9, RPT-10, RPT-22, RPT-23) ---------------------------------------------------


class StatisticsRowOut(BaseModel):
    tier: int | None  # None: "no tier" (a row), or the totals
    income_from: float | None
    income_to: float | None
    fee_pct: float | None  # None: varies (All tables), or no table value (Round 3)
    apps: int
    cancelled: int | None  # None on a past date: cancellations aren't rebuilt (3c-1)
    asked: float
    asks: int  # apps with an ask: the average ask's population
    average_ask: float | None
    amount: float  # awarded (Posted); with basis posted_and_decided, plus `decided`
    decided: float  # "Decided (not yet offered)": 0 on the posted basis
    awarded_count: int  # live apps whose AWARDED (Posted) money is above $0: the average award's population
    decided_count: int  # live apps with decided money not yet offered (0 on the posted basis)
    average_award: float | None  # awarded ÷ awarded_count, on either basis (O-930-16; D130)
    live_asked: float  # the live apps' asks: % of ask's denominator
    pct_of_ask: float | None
    grants: float | None  # Round 1 and All rounds only
    pct_of_ask_with_grants: float | None


class CancelledRowOut(BaseModel):
    reason: str  # one of D141's nine, or "not_recorded"
    reason_label: str
    pool: str | None
    round: int
    requests: int
    posted: float


class TierAppealsRowOut(BaseModel):
    tier: int | None
    income_from: float | None
    income_to: float | None
    round1_apps: int
    round1_fee_pct: float | None
    appeals: int
    round2_max_pct: float | None  # a rules value, not an outcome
    round3_awarded: float
    appeal_rate: float | None  # Kindred-derived


class OutcomeRowOut(BaseModel):
    pool: str | None  # None: all pools
    pool_label: str
    accepted: int
    accepted_amount: float
    appealed: int
    appealed_asked: float
    waiting: int


class StatisticsResponse(BaseModel):
    year: int
    as_of: date | None  # None: live
    as_of_axis: Literal["campminder", "recorded"] | None
    figures_on: date  # the day the figures are as of: today (camp time) or as_of
    rules_version: int | None
    basis: StatisticsBasis
    table: str | None  # the award-table chip; None: All award tables
    round: int | None  # the round chip; None: All rounds
    tables: list[ChipOut]  # every award table of the rules, for the chips
    rows: list[StatisticsRowOut]
    total: StatisticsRowOut
    cancelled_applicants: int | None  # D131's line beside apps (the total's `cancelled`)
    recipients_cancelled: list[CancelledRowOut]
    tier_appeals: list[TierAppealsRowOut]  # RPT-9, for the same table chip
    outcomes: list[OutcomeRowOut]  # RPT-23, every pool
    request_set: RequestSetNote | None  # D138: "requests received through <date>" when a control is on
    not_rebuilt: list[NotRebuiltOut]


# --- Programs (§9.3; RPT-11) -------------------------------------------------------------------------------------


class RoundBlockOut(BaseModel):
    apps: int
    requested: float
    asks: int
    awarded: float
    awarded_count: int
    average_request: float | None
    average_award: float | None
    pct_awarded: float | None


class ProgramRowOut(BaseModel):
    session_cm_id: int  # 0: session not matched (or a subtotal / total)
    session_name: str
    round1: RoundBlockOut
    round2: RoundBlockOut
    round3: RoundBlockOut
    total_awarded: float


class PoolGroupOut(BaseModel):
    pool: str | None
    pool_label: str
    sessions: list[ProgramRowOut]
    subtotal: ProgramRowOut


class ProgramsResponse(BaseModel):
    year: int
    as_of: date | None
    as_of_axis: Literal["campminder", "recorded"] | None
    figures_on: date
    rules_version: int | None
    pools: list[PoolGroupOut]
    total: ProgramRowOut
    request_set: RequestSetNote | None
    not_rebuilt: list[NotRebuiltOut]


# --- the committee's year-over-year tables (§9.7) ----------------------------------------------------------------


class BandOut(BaseModel):
    low_pct: float
    high_pct: float
    low: float | None
    high: float | None
    position: Literal["below", "within", "above"] | None


class PhaseRowOut(BaseModel):
    year: int
    basis: BasisCode
    phases: list[float | None]  # by the deadline, rolling after it, appeals (Rounds 2 and 3)
    phase_as_of: list[date | None]
    total: float | None
    total_as_of: date | None
    budget: float | None
    pct_of_budget: list[float | None]
    total_pct_of_budget: float | None
    share_of_phases: list[float | None]
    reconciliation: float | None  # total − Σ phases
    variance: float | None  # total − budget: positive is over
    side: Literal["over", "under", "on"] | None
    bands: list[BandOut | None]
    gaps: list[str]


class CountedOut(BaseModel):
    apps: int | None
    asked: float | None
    average: float | None


class ApplicationsRowOut(BaseModel):
    year: int
    basis: BasisCode
    kind: RowKind
    pool: str | None  # None unless kind is "pool"
    pool_label: str
    cutoff: date | None
    at_cutoff: CountedOut | None
    since: CountedOut | None
    season_end: CountedOut | None
    season_end_as_of: date | None
    change_apps: int | None
    change_asked: float | None
    unknown_received: int


class BudgetRowOut(BaseModel):
    year: int
    basis: BasisCode
    kind: RowKind
    pool: str | None  # None unless kind is "pool"
    pool_label: str
    budget: float | None
    awarded: float | None
    variance: float | None
    side: Literal["over", "under", "on"] | None
    pct_of_budget: float | None
    pool_share: float | None
    rules_split_pct: float | None
    note: str


class AppealsRowOut(BaseModel):
    year: int
    basis: BasisCode
    applications: int | None
    appeals: int | None
    rate: float | None


class Round1PctRowOut(BaseModel):
    year: int
    basis: BasisCode
    kind: RowKind
    pool: str | None
    pool_label: str
    awarded: float | None
    asked: float | None
    pct_of_ask: float | None


class CommitteeResponse(BaseModel):
    year: int
    figures_on: date
    seasons: list[int]  # the seasons with any row, oldest first
    phases: list[PhaseRowOut]  # RPT-1
    applications: list[ApplicationsRowOut]  # RPT-2, RPT-6
    budget: list[BudgetRowOut]  # RPT-7, RPT-24
    appeals: list[AppealsRowOut]  # RPT-8
    round1_pct: list[Round1PctRowOut]  # RPT-13 (end of season)
    not_built: list[NotBuiltOut]  # what waits on an owner or staff answer, named


# --- finance's typed history (O-930-13) -------------------------------------------------------------------------


class ReportedFigureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    year: int = Field(ge=2017, le=2100)
    view: Literal["finance", "development"] = "finance"
    metric: str = Field(min_length=1, max_length=60)
    pool: str = Field(default="", max_length=60)
    tier: int = Field(default=0, ge=0, le=50)
    phase: int = Field(default=0, ge=0, le=3)
    at: Literal["pull", "season_end"]
    as_of: date
    value: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    source: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=2000)


class ReportedLoadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    figures: list[ReportedFigureIn] = Field(min_length=1, max_length=2000)


class ReportedFigureOut(BaseModel):
    id: str
    year: int
    view: Literal["finance", "development"]
    metric: str
    pool: str
    tier: int
    phase: int
    at: Literal["pull", "season_end"]
    as_of: date
    value: float
    source: str
    note: str


class ReportedLoadOut(BaseModel):
    created: int
    updated: int
    unchanged: int


class ReportedHistoryResponse(BaseModel):
    figures: list[ReportedFigureOut]
