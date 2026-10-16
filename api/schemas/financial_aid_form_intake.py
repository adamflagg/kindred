"""Requests › Form intake (PR 3; spec 71 §2.4): every aid form answer and registration ask, the request it became or
why not, and CampMinder's camp aid on the family. Read-only shapes; the writes are the additions routes'."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from api.schemas.financial_aid_intake import RequestOrigin

# Why a row has no request, or a session no request holds. Computed at read time from intake's own inputs (no table).
WhyNot = Literal[
    "no_household",
    "registration_only",
    "adult_not_registered",
    "enrolled_no_request",
    "not_enrolled",
    "answer_edited",
]
# Why a row is in Needs a look (owner Q3-A: a registration-only row only through campminder_aid).
LookReason = Literal["campminder_aid", "enrolled_no_request", "session_unclear", "registration_ask_unreviewed"]
BecameStatus = Literal["active", "session_unclear", "duplicate_pending", "duplicate", "withdrawn", "cancelled"]
# Why one request is not (or no longer) on a session: the form no longer produces it, no enrolled candidate, or staff
# removed an added request.
BecameWhy = Literal["answer_edited", "not_enrolled", "removed"]


class FormAnswerOut(BaseModel):
    """One program answer on the aid form: the option text as the family wrote it and its ask."""

    program_key: str
    option_text: str
    ask: float
    named_session_cm_id: int = 0  # the one session the text names on its own; 0 when none or several


class RegistrationAskOut(BaseModel):
    """The registration form's "financial assistance" ask. `on` is its date once PR 4 mirrors it; None until then."""

    amount: float
    on: str | None = None


class BecameOut(BaseModel):
    request_id: str
    program_key: str
    session_cm_id: int  # 0 while the session is unclear
    candidate_session_cm_ids: list[int] = Field(default_factory=list)
    status: BecameStatus
    origin: RequestOrigin
    ask: float
    why: BecameWhy | None = None
    addition_id: str = ""  # the aid_request_additions row behind an added or rule-made request (Remove…, Mark Reviewed)
    added_by: str = ""
    added_at: str = ""
    added_reason: str = ""
    reviewed: bool | None = None  # rule-made requests only: False is "reg. ask · review"
    reviewed_by: str = ""
    reviewed_at: str = ""
    # The rounds posted on it (Remove… is refused while any is: "Round N is posted: undo Posted first"), and Round 1's
    # posted amount (Add a Request…'s recorded CampMinder money included).
    posted_rounds: list[int] = Field(default_factory=list)
    round1_posted: float | None = None


class CampMinderAidOut(BaseModel):
    """Live camp aid CampMinder posted on this family x session. on_request False: no request holds it (D170's money:
    shown, never counted). session_cm_id 0: CampMinder's lines name no session the dashboard can tell."""

    session_cm_id: int
    amount: float
    posted_on: str | None = None  # the latest line's day, camp time
    on_request: bool


class GapSessionOut(BaseModel):
    """A session Add a Request… may add: enrolled, held by no live request, nameable by a program."""

    session_cm_id: int
    program_key: str
    # CampMinder's money on no request on this family x session: the Round 1 Add a Request… offers to record (Q5-A).
    campminder_amount: float | None = None


class FormIntakeRowOut(BaseModel):
    key: str  # "<household>:<person>"
    household_cm_id: int  # 0: CampMinder links the camper to no household
    household_label: str = ""
    household_tiebreak: str = ""
    person_cm_id: int  # 0: a household (Family Camp) row
    camper_name: str = ""
    filed: bool  # the household filed the aid form (a program answer or income)
    registration_only: bool  # no aid form at all, a registration ask on this row
    answers: list[FormAnswerOut] = Field(default_factory=list)
    registration_ask: RegistrationAskOut | None = None
    enrolled_session_cm_ids: list[int] = Field(default_factory=list)
    became: list[BecameOut] = Field(default_factory=list)
    campminder_aid: list[CampMinderAidOut] = Field(default_factory=list)
    why_not: WhyNot | None = None
    gap_sessions: list[GapSessionOut] = Field(default_factory=list)
    can_add: bool = False
    needs_look: bool = False
    look_reasons: list[LookReason] = Field(default_factory=list)


class FormIntakeCountsOut(BaseModel):
    needs_look: int
    registration_only: int
    all: int


class IntakeSessionOut(BaseModel):
    session_cm_id: int
    name: str
    session_type: str
    program_key: str  # the program whose requests can name it; "" when none


class FormIntakeResponse(BaseModel):
    year: int
    rows: list[FormIntakeRowOut]
    counts: FormIntakeCountsOut
    sessions: list[IntakeSessionOut]
    grants_waiting_for_camper: int  # "N outside grants wait for a camper → Grants › Needs a camper"
    campminder_aid_on_no_request: float  # every row's amber money: D170's TOTAL for the season


class FormIntakeSummaryOut(BaseModel):
    """The Requests band link's count (owner Q1-A), the same numbers /forms gives."""

    year: int
    needs_look: int
    registration_only: int
    all: int


class AddPrefillOut(BaseModel):
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int  # 0: no session can be told (pick one from gap_sessions; no Round 1 checkbox)
    ask: float  # the posted amount (owner Q4-A)
    round1_campminder: float | None  # the Q5 checkbox's amount; None when no session can be told


class AidOnNoRequestLineOut(BaseModel):
    """Season's D170 line opened in place (owner Q4-A): one family x session."""

    row_key: str  # the Form intake row it is on
    household_cm_id: int
    household_label: str = ""
    household_tiebreak: str = ""
    person_cm_id: int
    camper_name: str = ""
    session_cm_id: int
    pool: str | None  # the session's budget pool; None for a session no program claims (or none told)
    amount: float
    posted_on: str | None = None
    prefill: AddPrefillOut
    can_add: bool
    gap_sessions: list[GapSessionOut] = Field(default_factory=list)


class AidOnNoRequestResponse(BaseModel):
    year: int
    total: float  # = Season's D170 TOTAL (one function computes both)
    families: int
    lines: list[AidOnNoRequestLineOut]
    sessions: list[IntakeSessionOut]


class UnlistedResponse(BaseModel):
    """Find a Camper Not Listed…: enrolled campers on no row, in the row shape so Add a Request… works on them."""

    year: int
    rows: list[FormIntakeRowOut]
    sessions: list[IntakeSessionOut]
