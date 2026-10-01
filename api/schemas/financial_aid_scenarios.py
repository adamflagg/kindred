"""Request and response models for the campership scenario routes (sub-project 9b; spec §7.4; D35–D39). Every route
needs financial_aid.rules. Money is float dollars (rounded to cents); None means nothing there, 0 is a real zero.
The rules document is bunking.financial_aid.rules.AidRules, so a malformed one is a 422 before any service call."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.schemas.financial_aid_rules import FieldChangeOut
from bunking.financial_aid.rules import AidRules, SectionName, ValidationReport

OptionCode = Annotated[str, Field(pattern=r"^[A-Z]+[0-9]*$", max_length=12)]
RecordId = Annotated[str, Field(pattern=r"^[a-z0-9]{15}$")]


class PoolResultOut(BaseModel):
    pool: str
    label: str
    round1: float
    round2: float
    round3: float
    round1_allocated: float | None
    round1_remaining: float | None
    remaining: float | None
    round1_unmet: float  # below the line, never subtracted (§5.9)


class TierRowOut(BaseModel):
    tier: int
    requests: int
    families: int
    round1: float
    asked: float | None = None  # the tier's Round 1 asks; filled by SP9c (RPT-17)


class RequestSetOut(BaseModel):
    """The request set the figures were priced on (D138): every affected figure is labelled with `label`."""

    basis: Literal["round1_deadline", "date"]
    through: date
    label: str  # "requests received through <date>"
    left_out: int  # requests first recorded after the date
    unknown: int  # requests with no recorded received date, left out too


class ResultsOut(BaseModel):
    """A scenario's figures. Round n = Posted + Needs an offer + Pending approval (spec §5.3); Round 2 is only the
    appeals keyed so far, and `round1_unmet` (below the line) is the forward signal for Round 2 (plan Decision 10).
    `request_set` is None when every frozen request is counted."""

    requests: int
    families: int
    round1: float
    round2: float
    round3: float
    round1_allocated: float | None
    round1_remaining: float | None
    remaining: float | None
    at_minimum: int
    held: int
    held_asked: float
    round1_unmet: float  # below the line: §5.9's forward signal for sizing Round 2 (Decision 10 (b), RULED 2026-09-30)
    pools: list[PoolResultOut]
    by_tier: list[TierRowOut]
    # Round 1 on requests in no tier (a withdrawn request's posted round): the tier rows plus this are `round1`.
    not_in_tiers: float
    request_set: RequestSetOut | None = None
    # "Round 2's allocation" and what is left of it (spec §5.3): RPT-32's "against the appeals allocation" (SP9c).
    # 0 when the rules set no Round 2 reserves; None only with no rules.
    round2_allocated: float | None = None
    round2_remaining: float | None = None


class SnapshotOut(BaseModel):
    id: str
    taken_at: datetime
    taken_by: str
    requests: int
    # Live requests frozen while waiting for approved programs and cost rules: held in every scenario until the
    # season is frozen again after approval (plan Decision 8). Shown, never a refusal.
    awaiting_rules: int


class OptionOut(BaseModel):
    code: str
    starting_point: str | None  # None for a starting point
    from_code: str | None  # None when started from the rules
    origin_version: int
    label: str
    kept_by: str
    kept_at: datetime
    results: ResultsOut
    stale: bool  # its figures are from an older snapshot


class DraftOut(BaseModel):
    trail_id: str
    from_code: str
    label: str
    document: AidRules
    changes: list[FieldChangeOut]
    results: ResultsOut | None
    report: ValidationReport
    recorded_at: datetime


class WorkspaceOut(BaseModel):
    year: int
    rules_version: int  # the rules draft: the latest version
    pricing_version: int | None  # the version pricing the season (every pricing section approved); None while none
    snapshot: SnapshotOut | None
    draft: DraftOut | None
    options: list[OptionOut]


class DocumentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: AidRules


class ViewIn(DocumentIn):
    """A read of a document on the frozen season, optionally on a request set (D138): the "through the Round 1
    deadline" switch or the "received through" date, never both. Off by default."""

    through_round1_deadline: bool = False
    received_through: date | None = None

    @model_validator(mode="after")
    def _one_request_set(self) -> Self:
        if self.through_round1_deadline and self.received_through is not None:
            raise ValueError("choose the Round 1 deadline or a received-through date, not both")
        return self


class EvaluateIn(ViewIn):
    # The draft's relative sizing settings, applied to `document` (the one the sliders started from).
    tier_shift: Decimal = Field(default=Decimal(0), ge=-100, le=100, max_digits=9, decimal_places=2)
    band_width_delta: Decimal = Field(default=Decimal(0), ge=-1000000, le=1000000, max_digits=9, decimal_places=2)


class EvaluateOut(BaseModel):
    document: AidRules
    results: ResultsOut
    report: ValidationReport


class LoadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option: OptionCode | None = None
    trail_row: RecordId | None = None

    @model_validator(mode="after")
    def _one_source(self) -> Self:
        if self.option is None and self.trail_row is None:
            raise ValueError("name a kept option or a trail row to load")
        return self


class KeepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starting_point: bool = False


class TierCompareOut(BaseModel):
    """One Round 1 row of what the committee compares (RPT-17): an award table's tier, or All's (`table` None)."""

    table: str | None  # the award table ("" for a program with none); None: All
    tier: int
    requests: int
    families: int
    asked: float  # the Round 1 asks of the requests the row counts
    average_ask: float | None
    fee_pct: float | None  # the table's Round 1 % for the tier: a rules value, never computed; None for All
    pct_of_ask: float | None  # Round 1 of the requests with an ask ÷ asked, one decimal; None when nothing was asked
    round1: float
    average_round1: float | None  # Round 1 ÷ requests (the requests the row counts)
    held: int  # the tier's live requests whose Round 1 is held (a check's hold has a tier): in none of the above
    # Counted requests with no Round 1 ask: in `requests` and `round1`, out of `asked`, `average_ask` and `pct_of_ask`
    no_ask: int


class Round2CompareOut(BaseModel):
    """One Round 2 row (RPT-32): a Round 2 table's tier, or All's (`table` None)."""

    table: str | None
    tier: int
    appeals: int  # requests with a Round 2 ask, held ones included
    asked: float  # their Round 2 asks
    max_pct: float | None  # the Round 2 table's cap (total %): a rules value; None for All
    priced: int  # appeals whose Round 2 the budget counts
    priced_asked: float  # those appeals' asks: what pct_of_ask divides by
    round2: float
    average_round2: float | None  # Round 2 ÷ priced
    pct_of_ask: float | None  # Round 2 ÷ the priced appeals' asks


class CommitteeOut(BaseModel):
    """What the committee compares for one column (spec §9.7 RPT-17, RPT-32)."""

    budget_total: float | None  # the column's own total budget
    round1: float
    round1_pct_of_budget: float | None  # Round 1 ÷ the total budget, one decimal (RPT-17's and RPT-18's headline)
    round2: float
    round1_by_tier: list[TierCompareOut]  # each award table's tiers, then All
    round2_by_tier: list[Round2CompareOut]  # each Round 2 table's tiers, then All
    not_in_tiers: float  # Round 1 no row holds (a withdrawn request's posted round): All's rows + this = round1
    round2_not_in_tiers: float  # the same for Round 2


class LastSeasonOut(BaseModel):
    """Last season's posted money, at each lock, beside the compare (RPT-17's and RPT-32's last-season columns).
    `view` is None until last season is loaded, and `label` says so: never zeros, never an estimate."""

    year: int
    loaded: bool
    label: str
    rules_version: int | None
    view: CommitteeOut | None


class CompareColumnOut(BaseModel):
    code: str  # "draft" for the draft
    label: str
    document: AidRules
    changes: list[FieldChangeOut]
    results: ResultsOut
    up: int | None
    down: int | None
    committee: CommitteeOut | None = None


class CompareOut(BaseModel):
    year: int
    snapshot: SnapshotOut
    columns: list[CompareColumnOut]
    last_season: LastSeasonOut | None = None  # only with ?last_season=true


class FitOut(BaseModel):
    tier_shift: float
    outcome: Literal["fits", "over_at_lowest", "under_at_highest"]
    tightest_pool: str | None  # information only: the pool with the least Round 1 Remaining (Decision 11 (a), D119)
    tried: int
    document: AidRules
    results: ResultsOut
    report: ValidationReport


class LeverEffectOut(BaseModel):
    lever: str
    label: str
    step: float | None  # None: a yes/no switch (dollar-for-dollar, D137), whose step is flipping it
    on: bool | None  # a switch's state in the document; None for a stepped lever
    round1_change: float


class SensitivityOut(BaseModel):
    results: ResultsOut  # the document's own figures, which each step moves from
    levers: list[LeverEffectOut]


class TrailRowOut(BaseModel):
    id: str
    recorded_at: datetime
    actor: str
    from_code: str
    change: str
    kept_code: str | None
    round1: float | None
    round1_remaining: float | None
    at_minimum: int | None
    stale: bool  # its figures are from an older snapshot than the newest


class TrailPageOut(BaseModel):
    page: int
    per_page: int
    total: int
    rows: list[TrailRowOut]


class ReplacementWarningOut(BaseModel):
    kind: Literal["unapproved_edit", "changed_since"]
    by: str | None
    at: datetime | None
    via: str | None
    token: str  # send back in MakeRulesDraftIn.acknowledged to confirm replacing exactly what was shown


class PromotionSectionOut(BaseModel):
    section: SectionName
    changes: list[FieldChangeOut]
    warning: ReplacementWarningOut | None


class PromotionPreviewOut(BaseModel):
    code: str
    origin_version: int
    base_version: int
    sections: list[PromotionSectionOut]
    unchanged: list[SectionName]


class MakeRulesDraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_version: int = Field(ge=1)
    # section -> the token its preview warning carried (SP9a's promote accepts an acknowledgement only with it)
    acknowledged: dict[SectionName, Annotated[str, Field(max_length=128)]] = Field(default_factory=dict)
