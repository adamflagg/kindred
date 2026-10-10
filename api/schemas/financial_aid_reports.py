"""Reports' response and request shapes (Reports back end, Part A; clean spec §9.2, §9.3, §9.7, §10, §11).

Money is aid dollars, rounded to cents, sent as a JSON number; a percentage is to one decimal place, also a number
(42.5 means 42.5%); `null` is "nothing to show" (no denominator, not typed, not rebuilt) and `0` is a real zero
(D74). Every table says what it is as of, and on which basis: "P" = awarded = Posted (D80), "r" = as reported
(typed once), so a copied table carries both in its header (RPT-33, §11).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.schemas.financial_aid import SourceChangeOut
from api.schemas.financial_aid_decisions import NotRebuiltOut
from bunking.financial_aid.scenarios.request_set import RequestSetNote

BasisCode = Literal["P", "r"]
RowKind = Literal["pool", "no_pool", "headline", "reconciliation"]  # a pool's row, money in no pool, every pool,
# or "headline − Σ pools" (a typed season whose pools don't sum, O-930-14)
StatisticsBasis = Literal["posted", "posted_and_decided"]


class ChipOut(BaseModel):
    key: str
    label: str
    pools: list[str] = []  # the budget pools this table's programs sit in, in the rules' pool order (may span several)


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
    cancelled: int  # received requests cancelled (D131); on a past date, cancelled by that day
    asked: float  # capped (owner A1/A2, 2026-10-09): All rounds is Development's need at most the cost; a round chip
    # its ask at most the cost less the awards posted before it. No cost known: as typed.
    asked_as_typed: float = 0.0  # A3: the asks as keyed, summed, uncapped: the CSV and Copy's "Asked (as typed)"
    asks: int  # apps with an ask: the average ask's population
    average_ask: float | None
    amount: float  # awarded (Posted); with basis posted_and_decided, plus `decided`
    decided: float  # "Decided (not yet offered)": 0 on the posted basis
    awarded: float  # Posted alone (D80), net of clawback, live requests, on either basis: amount − decided
    awarded_count: int  # live apps whose AWARDED (Posted) money is above $0: the average award's population
    decided_count: int  # live apps with decided money not yet offered (0 on the posted basis)
    average_award: float | None  # awarded ÷ awarded_count, on either basis (O-930-16; D130)
    live_asked: float  # the live apps' in-budget capped asks (A5): % of ask's denominator (not % incl. grants')
    pct_of_ask: float | None
    grants: float | None  # Round 1 and All rounds only
    pct_of_ask_with_grants: float | None
    requests_capped: int = 0  # Rule M: requests whose need is above their session's cost (All-rounds basis, A1)


class CancelledRowOut(BaseModel):
    reason: str  # one of D141's nine, "not_recorded", "withdrawn_in_kindred" (a withdrawn request with a posted award), or "duplicate_in_kindred" (a confirmed duplicate with one)
    reason_label: str
    pool: str | None
    pool_label: str  # the season's rules' label; "No pool" when pool is null; the key when the rules don't name it
    round: int
    requests: int = Field(
        description="Requests in THIS reason, pool and round row. Rows are per reason, pool and round, so one request "
        "that was posted in two rounds is in two rows: never sum `requests` across rows (use the Statistics "
        "total's `cancelled` for the number of cancelled requests)."
    )
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
    pool: str | None  # None: no pool or all pools; see kind
    kind: RowKind  # "pool", "no_pool" or "headline" (the every-request row)
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
    pct_of_ask_label: str  # the % of ask column's heading: names its numerator on the decided basis
    pct_of_ask_with_grants_label: str  # "% of ask incl. grants": names its numerator on the decided basis (ask 4)
    table: str | None  # the award-table chip; None: All award tables
    round: int | None  # the round chip; None: All rounds
    tables: list[ChipOut]  # every award table of the rules, for the chips
    rows: list[StatisticsRowOut]
    total: StatisticsRowOut
    cancelled_applicants: int  # D131's line beside apps (the total's `cancelled`)
    recipients_cancelled: list[CancelledRowOut]
    tier_appeals: list[TierAppealsRowOut]  # RPT-9, for the same table chip
    outcomes: list[OutcomeRowOut]  # RPT-23, every pool
    request_set: RequestSetNote | None  # D138: "requests received through <date>" when a control is on
    not_rebuilt: list[NotRebuiltOut]


# --- Programs (§9.3; RPT-11) -------------------------------------------------------------------------------------


class RoundBlockOut(BaseModel):
    apps: int
    requested: float  # capped as Statistics' round chip (owner A1/A2, 2026-10-09)
    requested_as_typed: float = 0.0  # A3: the asks as keyed, for the CSV and Copy
    asks: int
    awarded: float
    awarded_count: int
    average_request: float | None
    average_award: float | None
    pct_awarded: float | None


class ProgramRowOut(BaseModel):
    session_cm_id: int  # 0: session not matched (or a subtotal / total)
    session_name: str
    session_type: str = ""  # the session's type ("family", "main", ...) for the short name; "" on a subtotal or total
    # The CampMinder sessions the row counts and their full names, in the reader's order: one, or a shared row's two
    # (SCIT: Counselor + Specialist In-Training, owner 2026-10-10); none on "session not matched", a subtotal or total.
    session_cm_ids: list[int] = []
    session_names: list[str] = []
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
    requests_capped: int = 0  # received requests whose need is above their session's cost (All-rounds basis, A1)
    request_set: RequestSetNote | None
    not_rebuilt: list[NotRebuiltOut]


# --- the requests behind a count (slice 4 asks 1 and 8; D20) ----------------------------------------------------


class ReportRequestIdsOut(BaseModel):
    """The requests behind one Statistics or Programs count: exactly the requests that count counts, on the same read
    (the same chips, basis, reporting control and date). `financial_aid.view` only: development's summary never sees
    a request (D65)."""

    year: int
    as_of: date | None  # None: live
    as_of_axis: Literal["campminder", "recorded"] | None  # the axis `as_of` was read on, as the parent reads send it
    figures_on: date  # the day the ids are as of: today (camp time) or as_of
    request_set: RequestSetNote | None  # D138: set when a reporting control is on
    request_ids: list[str]  # sorted; their number is the count's


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
    # Two figure columns per phase (owner N2 = C, RULED 2026-10-02): "As offered" (`offered*`) and "End of season"
    # (`phases`, `pct_of_budget`, `share_of_phases`, `total`, `reconciliation`, `variance`: net of cancellations).
    # Each is None where unknown; neither is ever filled from the other. Bands compare against As offered.
    offered_label: str  # "As offered"
    end_of_season_label: str  # "End of season", or "End of season (to date)" while the season is open
    to_date: bool  # End of season is still moving: a priced (P) row of a season whose last aided session hasn't ended
    offered: list[float | None]  # by the deadline, rolling after it, appeals (Rounds 2 and 3)
    offered_as_of: list[date | None]  # a typed row: that deck pull's date
    offered_pct_of_budget: list[float | None]
    offered_share_of_phases: list[float | None]
    phases: list[float | None]  # End of season: by the deadline, rolling after it, appeals (Rounds 2 and 3)
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
    asks_basis: Literal["as_of_cutoff", "now"] | None
    asks_reason: str | None


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
    asked_in_budget: float | None  # `asked` less rounds outside the budget (D121): % of ask's denominator
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


# --- Development (§9.4; Part B) ----------------------------------------------------------------------------------
# Aggregates only (D65, D66, D90): no field here names or identifies a family, a camper or a request. A test walks
# every model below and fails on one that could (the summary containment test, main spec §14.3).


class DevelopmentGroupOut(BaseModel):
    key: str
    label: str
    kind: Literal["summer", "families", "campers"]
    # The program families the season's rules send to this pool, sorted: what Set a Group... writes for it and what
    # Money > Funders' "Covers:" line names. Empty on the development view, which has no use for it.
    families: list[str] = []


class DevelopmentColumnOut(BaseModel):
    season: int
    basis: BasisCode
    as_of: date | None  # the day it is as of: an r column's typed date, a P column's read date
    basis_unconfirmed: bool  # D96's premise is contested (O-930-1): a 2022–2025 column is noted
    label: str  # "2026 (as reported)", "2027"
    not_rebuilt: list[str] = []  # a dated column's row keys a past read can't rebuild: their cells are null
    # Rule M (owner 10-08, per request): a P column's requests whose asks add up to more than their session's cost,
    # counted AT the cost in Total Requests and % of need met; 0 on an r column (typed: no demand computed there)
    requests_capped: int = 0


class DevelopmentRowOut(BaseModel):
    key: str
    section: Literal["money", "counts", "appeals"]
    label: str
    group: str | None  # a development group (a pool); None: every group
    unit: Literal["dollars", "count", "percent"]
    definition: str  # the line's stated definition where it varies by who asks (first-time, D99); else ""
    values: list[float | None]  # one per column, in `columns` order; None: not available on that basis


class DevelopmentSourceOut(BaseModel):
    """One source by name with its three facts (D88): who paid, incentive or need-based, the source."""

    source_key: str  # "" for the camp's own awards
    name: str
    who_paid: Literal["the camp", "another funder"]
    incentive: bool
    group: str
    group_label: str
    amount: float
    awards: int


class DevelopmentResponse(BaseModel):
    year: int
    figures_on: date
    groups: list[DevelopmentGroupOut]
    columns: list[DevelopmentColumnOut]
    rows: list[DevelopmentRowOut]
    sources: list[DevelopmentSourceOut]  # this season's P column, by source
    not_built: list[NotBuiltOut]


# --- Funding sources (§9.4, D88, D100; Part C) --------------------------------------------------------------------


GROUP_CHANGE_WARNING: Final = "Changing this re-places household-level lines on the next ledger sync."  # D43, D159


class FundingSourceOut(BaseModel):
    """One outside funding source with its three facts (D88) and its reporting group (D100). No family data."""

    source_id: str
    description_key: str
    name: str
    funder_type: Literal["outside", "incentive", "camp", "unknown"]
    editable: bool = True  # False: the camp's own aid or an unclassified source (D159, N3: listed read-only)
    families_changed: bool = False  # a save's answer: the families changed, so the next ledger sync re-places (D43)
    incentive: bool
    group: str | None  # the season's pool its program families fund; None: none set, or several
    group_label: str
    needs_group: bool  # D100's "needs a group" line: an outside or incentive source with no program family set
    families: list[str]  # the stored program families (implied_program_families)
    lines: int | None = None  # the season's live lines this classifies now; None: not counted (a save's answer)
    amount: float | None = None  # their net, in aid dollars
    last_change: SourceChangeOut | None = None  # the last logged edit; None: never edited in the app, or not read


class FundingSourceRowOut(BaseModel):
    """One Funding sources row (D159): a funder the grantor directory groups descriptions under, or one description.
    `group` / `incentive` show only when every description agrees (else None: "several groups" / mixed)."""

    kind: Literal["funder", "description"]
    section: Literal["outside", "camp", "unclassified"]  # N3: an unknown funder type is listed, read-only
    grantor_key: str  # "" for a description row
    name: str  # the grantor's name, or the description's source name
    retired: bool  # a retired grantor, kept for history
    editable: bool  # False for the camp's own sources and the unclassified (read-only)
    incentive: bool | None
    group: str | None
    group_label: str
    needs_group: bool  # every description lacks a group (D100's "needs a group")
    descriptions: list[FundingSourceOut]
    families_changed: bool = False  # a funder save's answer
    lines: int | None = None  # the season's live lines this classifies now; None: not counted (a save's answer)
    amount: float | None = None  # their net, in aid dollars
    last_change: SourceChangeOut | None = None  # the last logged edit; None: never edited in the app, or not read


class FundingSourcesResponse(BaseModel):
    year: int
    groups: list[DevelopmentGroupOut]
    sources: list[FundingSourceOut]
    rows: list[FundingSourceRowOut] = Field(default_factory=list)
    group_change_warning: str = GROUP_CHANGE_WARNING


class FundingSourceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # a pool of the season's rules. ABSENT keeps each description's program families as they are; an explicit null
    # clears the group; a value sets it (the group shown unchanged also keeps its families: several groups stay
    # several). The service tells absent from null by `model_fields_set`.
    group: str | None = Field(default=None, max_length=60)
    # several pools at once (Set a Group... as a multi-select): the families written are the sorted union of what each
    # picked pool funds. ABSENT keeps them; `[]` or an explicit null clears; the pools the source reaches now, picked
    # exactly, keep them as they are. Sent together with `group` it is a 422.
    groups: list[Annotated[str, Field(max_length=60)]] | None = Field(default=None, max_length=24)
    # None keeps each description's own flag (a group-only save never flattens a funder that mixes incentive and
    # need-based descriptions); True/False sets it on every description the save reaches
    incentive: bool | None = None
    note: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def _one_group_field(self) -> FundingSourceIn:
        if "group" in self.model_fields_set and "groups" in self.model_fields_set:
            raise ValueError("send either group or groups, not both")
        return self


# --- Development's dated columns and ZIP codes (§9.4, D90; Part C) -------------------------------------------------


class DatedColumn(BaseModel):
    """ "+ Add a dated column": a season as of a day (a query over dated records, never a frozen copy)."""

    model_config = ConfigDict(extra="forbid")

    season: int = Field(ge=2017, le=2100)
    as_of: date


class ReportColumnsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[DatedColumn] = Field(max_length=24)


class ReportColumnsResponse(BaseModel):
    report: Literal["development"]
    columns: list[DatedColumn]


class ZipRowOut(BaseModel):
    zip: str  # five digits, "Outside the US", "No ZIP on file"; "" on the totals row
    kind: Literal["us", "outside_us", "none"]
    campers: int
    families: int
    dollars: float | None  # None on the every-camper table


class ZipTableOut(BaseModel):
    rows: list[ZipRowOut]
    total: ZipRowOut
    zips: int


class ZipGroupOut(BaseModel):
    key: str  # a pool key from the season's rules, or "all" (last)
    label: str


class ZipResponse(BaseModel):
    year: int
    figures_on: date
    group: str | None  # the group the tables count: a pool key, or "all"; the summer group when none was asked for
    group_label: str
    groups: list[ZipGroupOut] = Field(default_factory=list)  # every group the read takes, "all" last
    every_camper: ZipTableOut
    with_aid: ZipTableOut | None  # None until the season's decisions exist (2026: D67's load)
    not_built: list[NotBuiltOut]
