"""Request and response models for the campership ledger (sub-project 4).

Every model is served behind a financial_aid.* permission. Amounts are AID
DOLLARS: positive numbers, the negation of CampMinder's posted (negative)
credit, except fields named net_posted, which keep CampMinder's sign. The
Literal vocabularies mirror the selects in pb_migrations/1500000196..199; the Go
side pins its own copy with TestAidVocabularyMatchesMigration. Every as-of
figure here is POSTED money (basis "posted"), which lags decided money by the
posting delay.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from api.schemas.source_family_labels import SourceFamilyLabelled

ProgramFamily = Literal["summer", "quest", "teen", "bmitzvah", "family_camp", "adult_weekend", "family_school", "other"]
# A posting's reporting bucket: its program family, or "ambiguous" (placed on a
# household or person spanning families), or "unattributed" (no enrollment).
ProgramBucket = Literal[
    "summer",
    "quest",
    "teen",
    "bmitzvah",
    "family_camp",
    "adult_weekend",
    "family_school",
    "other",
    "ambiguous",
    "unattributed",
]
AttributionLevel = Literal["override", "decision", "session", "person", "program_family", "ambiguous", "none"]
ClassifiedSourceFamily = Literal[
    "camp_fa",
    "one_happy_camper",
    "synagogue_federation",
    "new_israeli",
    "pj",
    "jfcs",
    "jfam_incentive",
    "named_fund",
    "other_outside",
    "application_marker",
    "placeholder",
]
SourceFamily = Literal[
    "camp_fa",
    "one_happy_camper",
    "synagogue_federation",
    "new_israeli",
    "pj",
    "jfcs",
    "jfam_incentive",
    "named_fund",
    "other_outside",
    "application_marker",
    "placeholder",
    "unclassified",
]
FunderType = Literal["camp", "outside", "incentive"]
# D88's first fact, in the words Reports' Development sources use (DevelopmentSourceOut.who_paid).
WhoPaid = Literal["the camp", "another funder"]
OverrideSource = Literal["sheet_2026_match", "staff"]


class AidPostingLine(SourceFamilyLabelled):
    """One aid_postings row. source_key is the posting's own description;
    effective_source_key, source_family, funder_type and counts_toward_budget are
    after any per-posting reclassification. A reversed row is history: is_reversed
    with its reversal_date. open_flags are the flags no disposition has accepted;
    accepted_flags maps each accepted flag to its disposition."""

    transaction_cm_id: int
    household_cm_id: int
    amount: float
    source_key: str
    effective_source_key: str
    source_family: str
    funder_type: str
    counts_toward_budget: bool
    post_date: str
    is_reversed: bool
    reversal_date: str
    transaction_note: str
    attribution_level: str
    attribution_method: str
    program_family: str
    attributed_person_cm_id: int
    attributed_session_cm_id: int
    candidate_program_families: list[str]
    open_flags: list[str]
    accepted_flags: dict[str, str]


class FaRequested(BaseModel):
    summer: float = 0.0
    family_camp: float = 0.0
    bmitzvah: float = 0.0


class HouseholdEnrollment(BaseModel):
    person_cm_id: int
    name: str
    session_cm_id: int
    session_name: str
    session_type: str
    status: str


class HouseholdDetailResponse(BaseModel):
    """The family's posting history: live rows and reversed rows, oldest first.
    total_aid counts live rows only."""

    year: int
    household_cm_id: int
    display_name: str
    family_households: list[int]
    total_aid: float
    postings: list[AidPostingLine]
    enrollments: list[HouseholdEnrollment]
    fa_requested: FaRequested


class SummaryCell(SourceFamilyLabelled):
    program: str
    program_label: str = ""  # the season's rules label for the program family; "" for a bucket the rules don't name
    source_family: str
    amount: float
    postings: int
    households: int


class ProgramSplit(BaseModel):
    """F10's pivot row (money-v2 "Posted in CampMinder by program and source"; owner 10-08, R3-2): one program's
    posted aid by who paid, from the posting's funder type after any reclassification (D97). camp_aid: funder type
    camp (net); outside_grants: outside and incentive (D55); unclassified: a source nobody classified yet.
    total = the three. program is program_bucket's key (a program family, "ambiguous" or "unattributed")."""

    program: str
    # The season's rules label for that program family (programs.<key>.label), for screens to show instead of the key.
    # "" for "ambiguous" and "unattributed" (no rules label exists) or when the season has no rules.
    program_label: str = ""
    camp_aid: float
    outside_grants: float
    unclassified: float
    total: float
    postings: int
    households: int


# How far camp aid was placed, for the mock's shares line: placed = override, decision, session, person;
# household = program_family, ambiguous; not_placed = none (and any level Go adds later).
CampAidGroup = Literal["placed", "household", "not_placed"]


class CampAidLevel(BaseModel):
    """One share of camp aid (money-v2: "each share of camp aid"). share = amount / camp_aid, half-up to 4
    places; 0 when the season has no camp aid."""

    group: CampAidGroup
    amount: float
    share: float


class SummaryResponse(BaseModel):
    """Unsuppressed, finance-facing. as_of None means live now; otherwise money
    live at the end of that day in camp time. undated_postings were left out of
    an as-of figure because they carry no post date."""

    year: int
    as_of: str | None
    basis: Literal["posted"] = "posted"
    total_aid: float
    counts_toward_budget: float
    by_level: dict[str, float]
    # "placements": a live read from 2027, where a split camp-aid line's placed dollars count at "override" (D151).
    # "attribution": Go's levels alone (a past day, or a season before To place).
    by_level_basis: Literal["placements", "attribution"] = "attribution"
    cells: list[SummaryCell]
    undated_postings: int = 0
    # F10 as money-v2 draws it (owner 10-08, R3-2): per program by who paid, the season's three figures (the
    # pivot's footer; they add up to total_aid), and camp aid's shares by how far it was placed. Defaults keep
    # every older reader whole.
    by_program: list[ProgramSplit] = Field(default_factory=list)
    camp_aid: float = 0.0
    outside_grants: float = 0.0
    unclassified: float = 0.0
    camp_aid_levels: list[CampAidLevel] = Field(default_factory=list)


class NetAidTotal(SourceFamilyLabelled):
    """Net aid dollars for one group of postings, for sub-project 11's
    reconciliation and for as-of reads. posting_household_cm_id is the household
    the postings were posted to (a payer share is checked against its own
    household); family_id is the smallest household id in that household's
    family set (aid_household_links), and family_households the whole set."""

    posting_household_cm_id: int
    family_id: int
    family_households: list[int]
    effective_source_key: str
    source_family: str
    funder_type: str
    counts_toward_budget: bool
    program: str
    attributed_person_cm_id: int
    attributed_session_cm_id: int
    amount: float
    postings: int
    levels: dict[str, int]
    last_post_date: str


class NetTotalsResponse(BaseModel):
    year: int
    as_of: str | None
    basis: Literal["posted"] = "posted"
    total_aid: float
    undated_postings: int = 0
    rows: list[NetAidTotal]


class UnclassifiedSource(BaseModel):
    source_key: str
    description: str
    postings: int
    amount: float


class OrphanReversal(BaseModel):
    transaction_cm_id: int
    household_cm_id: int
    net_posted: float


class StaleStaffLink(BaseModel):
    id: str
    household_cm_id: int
    family_key: str


class DanglingDisposition(BaseModel):
    transaction_cm_id: int
    flag: str


class SessionMismatch(BaseModel):
    """Live transactions of the season carrying a session the season's
    camp_sessions do not hold: cross-season when another season holds it (spec
    §6.1 hands these to SP4), unknown when no season does."""

    session_cm_id: int
    transactions: int
    net_posted: float
    other_seasons: list[int]


class AidLikeOutside(BaseModel):
    category_cm_id: int
    description: str
    transactions: int
    net_posted: float


class DataQualityResponse(BaseModel):
    year: int
    unclassified_sources: list[UnclassifiedSource]
    orphan_reversal_legs: list[OrphanReversal]
    flag_counts: dict[str, int]
    accepted_flag_counts: dict[str, int]
    flagged_postings: list[AidPostingLine]
    no_enrollment_postings: int
    dangling_overrides: list[int]
    dangling_dispositions: list[DanglingDisposition]
    stale_staff_links: list[StaleStaffLink]
    cross_season_sessions: list[SessionMismatch]
    unknown_sessions: list[SessionMismatch]
    aid_like_outside_categories: list[AidLikeOutside]


class SourceChangeOut(BaseModel):
    """A source's last logged edit (D105: logged with who and why), from aid_change_log."""

    by: str  # the signed-in person who made it, as aid_change_log.actor holds it (an email)
    at: datetime  # UTC
    note: str  # the reason logged with it


class AidSourceRow(SourceFamilyLabelled):
    id: str
    description_key: str
    description: str
    source_name: str
    source_family: str
    funder_type: str
    counts_as_aid: bool
    counts_toward_budget: bool
    grantor_key: str
    implied_program_families: list[str]
    classified_by: str
    note: str
    # Slice 3 PR-B (ask 2). The record's own facts, on every read and write echo:
    needs_group: bool = False  # D100: an outside or incentive source with no reporting group
    who_paid: WhoPaid | None = None  # D88: the camp's own money or another funder's; None while unclassified
    incentive: bool = False  # D88's per-source flag (aid_sources.incentive); never funder_type
    # The list read only (a PATCH/PUT echo leaves these at their defaults):
    grantor_name: str = ""  # the mapped grantor's name; "" when none is mapped
    lines: int | None = None  # with ?year=: the season's live lines this description classifies now
    amount: float | None = None  # with ?year=: their net, in aid dollars
    last_change: SourceChangeOut | None = None  # the last logged edit; None: never edited in the app


class AidSourcesResponse(BaseModel):
    year: int | None = None  # the season lines and amount count; None when ?year= was not sent
    sources: list[AidSourceRow]


class AidSourceUpdate(BaseModel):
    """A staff classification. Only the camp's own aid (camp_fa) may count toward the budget:
    every outside grant and fund is external to it. full_coverage is NOT here: it is a grantor
    fact on aid_grantors (owner ruling 2026-09-28), and an unknown field is refused so a stale
    client can't believe it set one."""

    model_config = ConfigDict(extra="forbid")

    source_name: str = Field(min_length=1, max_length=200)
    source_family: ClassifiedSourceFamily
    funder_type: FunderType
    counts_as_aid: bool
    counts_toward_budget: bool
    implied_program_families: list[ProgramFamily] = Field(default_factory=list)
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]

    @model_validator(mode="after")
    def _budget(self) -> AidSourceUpdate:
        if self.counts_toward_budget and self.source_family != "camp_fa":
            raise ValueError("only the camp's own financial aid may count toward the budget")
        if self.counts_toward_budget and not self.counts_as_aid:
            raise ValueError("a source that counts toward the budget must also count as aid")
        return self


class SourceGrantorIn(BaseModel):
    """Names the description's grantor (D58: descriptions map to grantors through aid_sources, the
    one registry); None unmaps it. Staff data: the config file only seeds new descriptions (D105) and
    never writes or clears an existing row, so every later change goes through the app."""

    grantor_key: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60, pattern=r"^[a-z][a-z0-9_]*$")
        ]
        | None
    )
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class HouseholdLinkCreate(BaseModel):
    year: int = Field(ge=2017, le=2100)
    household_cm_id: int = Field(gt=0)
    family_key: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    excluded: bool = False
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class HouseholdLinkRow(BaseModel):
    id: str
    year: int
    household_cm_id: int
    family_key: str
    source: str
    excluded: bool
    note: str
    actor: str


class OverrideRow(BaseModel):
    """Places a posting, reclassifies its source, or both. source_key_override is
    an aid_sources description_key. It exists for outside money booked under the
    camp's own aid description: the target is a private-config source classed
    outside and not counted toward the budget."""

    transaction_cm_id: int = Field(gt=0)
    attributed_person_cm_id: int | None = Field(default=None, gt=0)
    attributed_session_cm_id: int | None = Field(default=None, gt=0)
    program_family: ProgramFamily | None = None
    source_key_override: str | None = Field(default=None, min_length=1, max_length=5000)
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""

    @model_validator(mode="after")
    def _places_or_reclassifies(self) -> OverrideRow:
        placed = self.attributed_person_cm_id or self.attributed_session_cm_id or self.program_family
        if not (placed or self.source_key_override):
            raise ValueError("an override must name a person, a session, a program family or a source to reclassify to")
        return self


class OverrideBulkLoad(BaseModel):
    """One reviewed load: one aid_change_log operation. reason is required
    (spec §14.4: overrides need a reason) and is logged on every row that has
    no note of its own."""

    year: int = Field(ge=2017, le=2100)
    source: OverrideSource
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    dry_run: bool = False
    rows: list[OverrideRow] = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def _unique_transactions(self) -> OverrideBulkLoad:
        ids = [r.transaction_cm_id for r in self.rows]
        if len(ids) != len(set(ids)):
            raise ValueError("each CampMinder line may appear once per load")
        return self


class LoadRejection(BaseModel):
    transaction_cm_id: int
    flag: str = ""
    reason: str


class BulkLoadResult(BaseModel):
    """operation_id is the aid_change_log operation holding every row this load
    wrote; None for a dry run or a load that changed nothing."""

    year: int
    dry_run: bool
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    rejected: list[LoadRejection] = Field(default_factory=list)
    operation_id: str | None = None
