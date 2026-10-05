"""Request and response models for campership intake (sub-project 5)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from bunking.financial_aid.calculator.result import IssueSeverity

RequestStatus = Literal["active", "unmatched_session", "duplicate_pending", "duplicate", "withdrawn"]
# "" for a closed request; see api/services/financial_aid_payer_shares.py.
PayerShareStatus = Literal["", "complete", "incomplete"]
# Request flags the queue can narrow to (Task 12): the rules-dependent states of owner ruling Q4.
RequestFlagFilter = Literal["awaiting_approved_rules", "no_program_for_session"]


class FlagOut(BaseModel):
    code: str
    detail: dict[str, Any] = Field(default_factory=dict)


class IssueOut(BaseModel):
    """An SP5-evaluated check with its severity (spec 10.5): "hold" stops the award until staff
    look. The type is SP3's IssueSeverity; intake only ever raises "hold" or "warn"."""

    code: str
    severity: IssueSeverity
    message: str


class PayerShareOut(BaseModel):
    """Who pays the family's part (spec 9.2): a household and its %. `amount` is READ-ONLY,
    computed from the request's current award (whole dollars); None while there is no award."""

    id: str
    household_cm_id: int
    share_pct: Decimal
    amount: Decimal | None = None
    source: str
    actor: str
    note: str


class CorrectionOut(BaseModel):
    id: str
    field: str
    request_id: str
    new_value: str
    original_value: str
    reason: str
    actor: str
    created: str


class AnswerOut(BaseModel):
    field: str
    synced: str
    effective: str
    corrected: bool
    changed_since_correction: bool
    history: list[CorrectionOut]


class RequestOut(BaseModel):
    id: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    program_key: str
    program_option_text: str
    session_resolution: str
    status: str
    duplicate_of: str
    ask: AnswerOut
    headcount_non_infant: int
    headcount_infant: int
    headcount_source: str
    flags: list[FlagOut]
    payer_shares: list[PayerShareOut] = Field(default_factory=list)
    payer_share_status: PayerShareStatus = ""
    issues: list[IssueOut] = Field(default_factory=list)


class ApplicationSummaryOut(BaseModel):
    household_cm_id: int
    status: str
    member_person_cm_ids: list[int]
    requests_by_status: dict[str, int]
    flag_codes: list[str]
    corrected_fields: int


class ApplicationListResponse(BaseModel):
    year: int
    applications: list[ApplicationSummaryOut]


class ApplicationDetailResponse(BaseModel):
    year: int
    household_cm_id: int
    status: str
    member_person_cm_ids: list[int]
    # Every numeric and yes/no financial answer, synced and effective, plus the income override.
    answers: list[AnswerOut]
    # The free-text financial answers, keyed by field (special circumstances, other support
    # expectations). Shown, never corrected.
    notes: dict[str, str]
    requests: list[RequestOut]
    flags: list[FlagOut]


class RequestQueueResponse(BaseModel):
    year: int
    status: str
    requests: list[RequestOut]


class CorrectionCreate(BaseModel):
    field: str = Field(min_length=1, max_length=64)
    new_value: str | None = Field(default=None, max_length=64)
    # B30 (owner 2026-10-05): a correction's reason is optional; a blank one is stored as "". Other forms' stay required.
    reason: str = Field(default="", max_length=2000)
    request_id: str = Field(default="", max_length=15)


class UseFormIn(BaseModel):
    """Use X's Form (owner-approved, household-v3 section 3): apply one sibling's form to every answer the household's
    forms disagree on. `person_cm_id` names the form; the reason is optional, as a correction's is (B30)."""

    person_cm_id: int = Field(gt=0)
    reason: str = Field(default="", max_length=2000)


class UseFormOut(BaseModel):
    """What a Use X's Form wrote: one operation of ordinary corrections (`applied`, as POST …/corrections returns
    them). `skipped_blank`: disagreeing answers this form left blank (no write). `unchanged`: answers already corrected
    to this form's value (no write). `still_disagreeing`: disagreeing answers still not corrected afterwards; the
    income hold clears once no income answer is left in it."""

    household_cm_id: int
    person_cm_id: int
    operation_id: str  # "" when every answer was already at this form's value and nothing was written
    applied: list[CorrectionOut]
    skipped_blank: list[str]
    unchanged: list[str]
    still_disagreeing: list[str]


class SessionResolve(BaseModel):
    session_cm_id: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=2000)


class DuplicateMark(BaseModel):
    duplicate_of: str = Field(min_length=1, max_length=15)
    reason: str = Field(min_length=1, max_length=2000)


class HeadcountSet(BaseModel):
    non_infant: int = Field(ge=0, le=50)
    infant: int = Field(ge=0, le=20)
    source: Literal["declared", "override"]
    reason: str = Field(min_length=1, max_length=2000)
    # Decision 6: a code from the season's cost.override_reasons; optional until the frontend's form sends it.
    reason_code: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]*$", max_length=64)


class CapacitySet(BaseModel):
    capacity: int = Field(ge=0, le=5000)
    note: str = Field(default="", max_length=2000)


class CapacityOut(BaseModel):
    year: int
    session_cm_id: int
    capacity: int
    note: str
    actor: str


class CapacityListOut(BaseModel):
    """What finance stored per session this season (Season › Rules; slice 2 Decision 23). Live only."""

    year: int
    sessions: list[CapacityOut]  # by session id


class PayerShareIn(BaseModel):
    household_cm_id: int = Field(gt=0)
    share_pct: Decimal = Field(gt=0, le=100, decimal_places=4)


class PayerSharesSet(BaseModel):
    """The whole set of a request's shares, as percentages (they should add to 100%)."""

    shares: list[PayerShareIn] = Field(min_length=1, max_length=10)
    reason: str = Field(min_length=1, max_length=2000)


class HouseholdShareSet(BaseModel):
    """One household's share, as a % only (owner ruling 2026-10-02). The other share of a
    two-way split gets the remainder. An old client's `amount` is ignored unread."""

    share_pct: Decimal = Field(gt=0, le=100, decimal_places=4)
    reason: str = Field(min_length=1, max_length=2000)
