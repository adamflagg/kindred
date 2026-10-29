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
# Where a request came from: the aid form, a staff addition, or (2027 on) a dated registration ask.
RequestOrigin = Literal["form", "added", "registration_ask"]
# Which aid form made a form-origin request (adult-aid form design PR 2): CampMinder's, or the adult aid Google Form.
FormSource = Literal["campminder", "google_form"]


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
    origin: RequestOrigin = "form"
    # None for an added or rule-made request (no form made it).
    form_source: FormSource | None = None
    # GF-2 = B: "google_form" when the request carries its OWN answer set (the adult aid form's figures), which prices
    # it in place of the household application's; `answers` is that set with its request-scoped corrections. None
    # (and "") for every other request.
    answers_source: Literal["", "google_form"] = ""
    answers: list[AnswerOut] | None = None


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


class AdditionCreate(BaseModel):
    """One staff-added request: a camper (person_cm_id) or, for Family Camp, a household (person_cm_id 0) and an
    enrolled session. The program follows the session. The ask must be above $0 and the reason non-blank; the
    service refuses either with a message, as it does every other guard."""

    household_cm_id: int = Field(gt=0)
    person_cm_id: int = Field(ge=0)
    session_cm_id: int = Field(gt=0)
    ask: float = Field(ge=0, le=1_000_000)
    reason: str = Field(default="", max_length=2000)
    # Owner Q5-A (PR 3): "Record CampMinder's $X as Round 1, posted". The amount the screen showed; the service refuses
    # it unless it is, to the cent, CampMinder's live camp aid on that family x session that no request holds and that
    # is this camper's (a household request: the household's). None: the request only.
    round1_campminder: float | None = Field(default=None, gt=0, le=1_000_000)


class AdditionBulkCreate(BaseModel):
    """A load of additions, all or nothing. `reason` is the operation's, and stands in for an item left blank."""

    reason: str = Field(min_length=1, max_length=2000)
    dry_run: bool = False
    items: list[AdditionCreate] = Field(min_length=1, max_length=200)


class AdditionRetire(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class AdditionOut(BaseModel):
    id: str
    year: int
    household_cm_id: int
    person_cm_id: int
    program_key: str
    session_cm_id: int
    ask: float
    source: str
    reason: str
    actor: str
    retired_at: str
    retired_by: str
    retire_reason: str
    request_id: str  # the request it stands for; "" when none exists
    reviewed_at: str = ""  # Mark Reviewed (owner Q2-A): a rule-made request a person checked; "" until then
    reviewed_by: str = ""
    round1_posted: float | None = None  # the request's posted Round 1 amount (Q5's recorded one included); None if none


class AddedRequestOut(BaseModel):
    addition: AdditionOut
    request: RequestOut


class AdditionItemReport(BaseModel):
    """One item of a bulk load: what it would add (dry run) or added, or why it was refused."""

    index: int
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    ask: float
    program_key: str  # "" when the session names no program
    ok: bool
    error: str = ""
    holder_id: str = ""  # the live request already holding the slot, when that is why
    addition_id: str = ""
    request_id: str = ""
    round1_campminder: float | None = None  # the Round 1 the item records at CampMinder's money (Q5-A); None if none


class AdditionBulkResult(BaseModel):
    """`written` is true only when every item passed and the load committed, as one aid_change_log operation."""

    year: int
    dry_run: bool
    written: bool
    operation_id: str | None = None
    items: list[AdditionItemReport]
