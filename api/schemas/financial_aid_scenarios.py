"""Request and response models for the campership scenario routes (sub-project 9b; spec §7.4; D35–D39). Every route
needs financial_aid.rules. Money is float dollars (rounded to cents); None means nothing there, 0 is a real zero.
The rules document is bunking.financial_aid.rules.AidRules, so a malformed one is a 422 before any service call."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    allocated: float | None = None  # the pool's Allocated: the bar's scale (§S11.4); round1_allocated stays for Fit


class TierRowOut(BaseModel):
    tier: int
    requests: int
    families: int
    round1: float
    asked: float | None = None  # the tier's Round 1 asks; filled by SP9c (RPT-17)
    round2: float = 0  # the tier's Round 2 across the tables (§S11.4)


class RequestSetOut(BaseModel):
    """The request set the figures were priced on (D138): every affected figure is labelled with `label`."""

    basis: Literal["round1_deadline", "date"]
    through: date
    label: str  # "requests received through <date>"
    left_out: int  # requests first recorded after the date
    unknown: int  # requests with no recorded received date, left out too


class PoolProjectionOut(BaseModel):
    pool: str
    remaining: float | None


class ProjectionOut(BaseModel):
    """Where the season would land if the rest of the applications arrive like last year's (Scenarios addendum
    §S11.7): every figure ÷ last year's share in by this point. Never a real figure: the screen mutes it, rounds it to
    $1,000 and never colours it amber or red."""

    share: float  # 0-1, 3 decimals
    through: date
    basis_year: int
    aligned_on: Literal["application_deadline", "calendar"]
    requests: int
    round1: float
    round1_and_2: float
    remaining: float | None
    pools: list[PoolProjectionOut]


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
    allocated: float | None = None  # the whole Allocated (§S11.4); round1_allocated stays for Fit
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
    # The appeals keyed so far and their asks: Below the line once Round 1 posts (§S11.4).
    appeals: int = 0
    appeals_asked: float = 0
    # Filled on evaluate, the draft and each priced compare column; never on a kept option's stored results or last season.
    projection: ProjectionOut | None = None


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
    name: str = ""  # the staff-given name, else the label (§S11.1)
    promotable: bool = False  # Make it the Rules Draft would copy something (Task 57 fills it)
    blocked: str | None = None  # why it can't, in staff words (Task 57)


class DraftOut(BaseModel):
    trail_id: str | None = None  # None: nothing recorded yet; the draft is the rules in effect (§S11.2)
    from_code: str  # a kept code, or "rules" | "rules_draft" | "last_rules"
    label: str
    document: AidRules
    changes: list[FieldChangeOut]
    results: ResultsOut | None
    report: ValidationReport
    recorded_at: datetime | None = None
    source_document: AidRules | None = None  # what it is from, read now: the strip's starting point, "was …"
    same_as: str | None = None  # a kept code whose document equals the draft, else "rules", else None


class WorkspaceOut(BaseModel):
    year: int
    rules_version: int  # the rules draft: the latest version
    pricing_version: int | None  # the version pricing the season (every pricing section approved); None while none
    snapshot: SnapshotOut | None
    draft: DraftOut | None
    options: list[OptionOut]
    # the rules draft's version while it differs from the rules in effect: the cue for Start from's third entry
    rules_draft_version: int | None = None
    # a posted round locked these (§S11.3): the screen greys from them alone
    locked_sections: list[SectionName] = Field(default_factory=list)
    locked_by_round: int | None = None


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
    start: Literal["rules", "rules_draft", "last_rules"] | None = None  # a built-in start (§S11.2)

    @model_validator(mode="after")
    def _one_source(self) -> Self:
        if sum(value is not None for value in (self.option, self.trail_row, self.start)) != 1:
            raise ValueError("name one kept option, one trail row or one starting point to load")
        return self


class KeepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=80)  # blank or missing: the draft's label (§S11.1)
    # Accepted and ignored: every keep is the next flat letter (§S11.1). PR 12 stops sending it and removes it.
    starting_point: bool = False


class RenameIn(BaseModel):
    """A kept option's new name: trimmed, at most 80 characters. A blank one reaches the service, which refuses it
    in staff words ("Give it a name")."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=200)

    @field_validator("name")
    @classmethod
    def _trimmed(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 80:
            raise ValueError("A name is at most 80 characters")
        return value


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
    held_asked: float  # their Round 1 asks, counted apart: a held family's grant can't be counted yet
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
    held_asked: float  # the held appeals' asks: inside `asked`, outside `priced_asked` and pct_of_ask


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
    requests: int = 0  # the All rows summed (disagreement 3)
    average_round1: float | None = None  # their Round 1 over their requests; the server divides


class LastSeasonOut(BaseModel):
    """Last season's posted money, at each lock, beside the compare (RPT-17's and RPT-32's last-season columns).
    `view` is None until last season is loaded, and `label` says so: never zeros, never an estimate. The pools are
    each pool's Posted cells, empty until last season is loaded."""

    year: int
    loaded: bool
    label: str
    rules_version: int | None
    view: CommitteeOut | None
    round3: float = 0
    pools: list[PoolResultOut] = Field(default_factory=list)  # each pool's Posted cells; empty until loaded


class CompareColumnOut(BaseModel):
    code: str  # "rules", "last_rules", "draft", or a kept code
    label: str
    document: AidRules
    changes: list[FieldChangeOut]
    results: ResultsOut
    up: int | None
    down: int | None
    committee: CommitteeOut | None = None
    version: int | None = None
    approved_at: datetime | None = None
    via: str | None = None


class CompareOut(BaseModel):
    year: int
    snapshot: SnapshotOut
    columns: list[CompareColumnOut]
    last_season: LastSeasonOut | None = None  # only with ?last_season=true
    # The server's words when "last season's rules" was asked for and can't be built (disagreement 16)
    last_rules_refused: str | None = None


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
    fixed_kept: int = 0  # fixed settings left as the rules draft has them (§S11.3)


class MakeRulesDraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_version: int = Field(ge=1)
    # section -> the token its preview warning carried (SP9a's promote accepts an acknowledgement only with it)
    acknowledged: dict[SectionName, Annotated[str, Field(max_length=128)]] = Field(default_factory=dict)
