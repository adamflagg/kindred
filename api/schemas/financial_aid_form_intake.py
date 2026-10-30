"""Requests › Form intake (PR 3; spec 71 §2.4): every aid form answer and registration ask, the request it became or
why not, and CampMinder's camp aid on the family. Read-only shapes; the writes are the additions routes'."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from api.schemas.financial_aid_intake import FormSource, RequestOrigin

# Why a row has no request, or a session no request holds. Computed at read time from intake's own inputs (no table).
WhyNot = Literal[
    "no_household",
    "registration_only",
    "adult_not_registered",
    "enrolled_no_request",
    "not_enrolled",
    "answer_edited",
    # The registration-ask rule (PR 4b, 2027 on) made no request for an enrolled session: the ask's day also registered
    # another session, so it can't tell which the ask was for; or no ask was typed at this registration.
    "registration_ask_ambiguous",
    "registration_ask_unattributed",
    # IN-BUCKETS (2027 on), in place of adult_not_registered: a registration ask in a household that filed for the
    # ask's bucket, from someone registered for no session the ask could be for, or registered but not enrolled.
    "registration_ask_not_registered",
    "registration_ask_not_enrolled",
]
# More about a why-not: registration_ask_unattributed's ask is older than this registration (design 96 §3.2).
WhyNotDetail = Literal["ask_predates_registration"]
# Why a row is in Needs a look (owner Q3-A: a registration-only row only through campminder_aid).
LookReason = Literal[
    "campminder_aid",
    "enrolled_no_request",
    "session_unclear",
    "registration_ask_unreviewed",
    # The adult aid Google Form (adult-aid form design PR 2), 2027 on. GF-4: a decided request's response changed or
    # was deleted in Google, and the change was not applied (Mark Reviewed clears it until the next different one).
    "form_changed_after_decision",
    "form_response_deleted",
    # The response's program choice maps to no one 2027 weekend (§6); a refused pull is the season's (§3.4).
    "form_choice_unclear",
    "form_pull_refused",
]
# Why staff ignored a response (aid_form_responses.ignored_kind).
IgnoreKind = Literal["test", "duplicate", "not_asking", "other"]
# aid_form_responses.match_status (PR 1's vocabulary).
FormMatchStatus = Literal[
    "auto", "suggested", "staff", "unmatched", "registered_elsewhere", "not_registered", "ignored", "superseded"
]
# "closed": CLOSED-SEASONS-DONE (CSD-1), a done season's request that was still waiting with no round (Session unclear,
# Duplicate pending). Display only: the request's own status is unchanged.
BecameStatus = Literal[
    "active", "session_unclear", "duplicate_pending", "duplicate", "withdrawn", "cancelled", "closed"
]
# Why one request is not (or no longer) on a session: the form no longer produces it, no enrolled candidate, or staff
# removed an added request.
BecameWhy = Literal["answer_edited", "not_enrolled", "removed"]


class FormAnswerOut(BaseModel):
    """One program answer on the aid form: the option text as the family wrote it and its ask."""

    program_key: str
    option_text: str
    ask: float
    named_session_cm_id: int = 0  # the one session the text names on its own; 0 when none or several
    # Which form: left out of the JSON for CampMinder's (so a 2026 row serializes exactly as before); "google_form"
    # for an adult aid form response (PR 2), whose named session is its weekend.
    form_source: FormSource = Field(default="campminder", exclude_if=lambda v: v == "campminder")


class RegistrationAskOut(BaseModel):
    """The registration form's "financial assistance" ask. `on` is its date once PR 4 mirrors it; None until then."""

    amount: float
    on: str | None = None


class RequestAdditionOut(BaseModel):
    """The addition behind an added or rule-made request (Form intake's Became and the household request card share
    it): who added it, when and why; a rule-made one's Mark Reviewed; and the rounds posted on its request, so Remove…
    can say "Round N is posted: undo Posted first" before it is refused, and whether it is cancelled in Kindred (Remove…
    is refused then too: Reopen… it first)."""

    addition_id: str
    origin: RequestOrigin
    added_by: str
    added_at: str
    added_reason: str
    reviewed: bool | None  # rule-made (registration_ask) only; None for a staff addition
    reviewed_by: str = ""
    reviewed_at: str = ""
    posted_rounds: list[int] = Field(default_factory=list)
    # Cancelled in Kindred (Cancel Request…): Remove… is refused until Reopen…, or the cancellation would stay on it.
    cancelled: bool = False
    live: bool = True  # False once Remove… retired it
    # Who removed it, when and why ("Removed by …" on the household card); blank while it is live.
    retired_by: str = ""
    retired_at: str = ""
    retire_reason: str = ""


class FormChangeOut(BaseModel):
    """A change to a decided request's adult aid form that was not applied (GF-4)."""

    kind: Literal["deleted", "changed_after_decision"]
    at: str = ""  # the newer response's submitted time; for a reviewed one, when it was reviewed
    reviewed: bool = False
    reviewed_by: str = ""


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
    # "google_form" for a request the adult aid form made (PR 2); left out of the JSON otherwise.
    form_source: FormSource | None = Field(default=None, exclude_if=lambda v: v is None)
    # GF-4 (PR 2): the request's adult aid form changed or was deleted after a decision, not applied; Mark Reviewed
    # sets reviewed. Left out of the JSON when there is none.
    form_change: FormChangeOut | None = Field(default=None, exclude_if=lambda v: v is None)
    # From 2027 (PR 2): the rules give its session no price yet (no tuition, no family rate): "no price yet". Left
    # out of the JSON before 2027, for a request with no session, and for one that is not live.
    price_missing: bool | None = Field(default=None, exclude_if=lambda v: v is None)


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
    # This row's own CampMinder money on no request in this session (the camper's: d170_person; a household row's
    # household x session): the Round 1 Add a Request… offers to record (Q5-A).
    campminder_amount: float | None = None


class FormIntakeRowOut(BaseModel):
    key: str  # "<household>:<person>"
    household_cm_id: int  # 0: CampMinder links the camper to no household
    household_label: str = ""
    household_tiebreak: str = ""
    person_cm_id: int  # 0: a household (Family Camp) row
    camper_name: str = ""
    filed: bool  # the household filed the aid form (a program answer or income)
    # A registration ask on this row and no aid form for its bucket: the household filed none, or (from 2027,
    # IN-BUCKETS) the household filed none for a bucket the ask is for, and (PR 2) the person has no matched adult aid
    # form response for it.
    registration_only: bool
    # From 2027 (IN-BUCKETS): the buckets (program keys) the row's ask is registration-ask-only for, so a household
    # that filed for another bucket reads "no aid form for <program>". Left out of the JSON when empty, so a 2026 row
    # serializes exactly as before.
    registration_only_programs: list[str] = Field(default_factory=list, exclude_if=lambda v: not v)
    answers: list[FormAnswerOut] = Field(default_factory=list)
    registration_ask: RegistrationAskOut | None = None
    enrolled_session_cm_ids: list[int] = Field(default_factory=list)
    became: list[BecameOut] = Field(default_factory=list)
    campminder_aid: list[CampMinderAidOut] = Field(default_factory=list)
    why_not: WhyNot | None = None
    why_not_detail: WhyNotDetail | None = None
    gap_sessions: list[GapSessionOut] = Field(default_factory=list)
    can_add: bool = False
    needs_look: bool = False
    look_reasons: list[LookReason] = Field(default_factory=list)


class FormIntakeCountsOut(BaseModel):
    needs_look: int
    registration_only: int
    all: int
    # Adult aid form responses waiting for staff to Link… or Ignore… (PR 2): suggested, registered elsewhere, not
    # registered, unmatched. 0 before 2027.
    to_link: int = 0


# -- The adult aid Google Form (adult-aid form design PR 2) ----------------------------------------------------------


class FormFigureOut(BaseModel):
    """One figure as the response gave it: `value` None when Kindred could not read it (unknown, never 0), with what
    was typed and the note staff see; a clean read has no note."""

    field: str
    value: float | None
    typed: str = ""
    note: str = ""


class FormYesNoOut(BaseModel):
    field: str
    value: bool | None
    note: str = ""


class FormCandidateOut(BaseModel):
    """A person the response could be, with the evidence (PR 1's match_candidates: CampMinder ids and signals)."""

    person_cm_id: int
    household_cm_id: int
    signals: list[str] = Field(default_factory=list)
    session_cm_ids: list[int] = Field(default_factory=list)
    elsewhere: bool = False  # registered for another weekend than the response chose


class LinkCandidateOut(FormCandidateOut):
    """A candidate on Link…'s dialog: named, with their household, registration and CampMinder birthdate and email
    beside the response's own (this read only; the Form intake list never carries them)."""

    camper_name: str = ""
    household_label: str = ""
    registration_status: Literal["", "enrolled", "applied", "waitlisted", "incomplete"] = ""
    birthdate: str = ""
    email: str = ""


class SupersededOut(BaseModel):
    """An earlier response from the same person for the same weekend, replaced by this one (information)."""

    response_id: str
    submitted_at: str
    ask: float | None = None
    total_gross_income: float | None = None
    replaced_at: str = ""  # when the newer response was submitted


class FormResponseOut(BaseModel):
    """One adult aid form response, as the opened Form intake row shows it. Never the respondent email (the
    link-candidates read has it), the typed birthdate, POC, race/ethnicity or gender identity."""

    id: str  # the aid_form_responses record id (Link…, Ignore…)
    response_id: str
    row_key: str = ""  # "<household>:<person>" once linked to a person; "" until then
    form_source: FormSource = "google_form"
    match_status: FormMatchStatus
    form_status: Literal["live", "deleted"]
    to_link: bool = False
    program_key: str = ""  # family_camp | adult_weekend; "" when the choice is unknown
    program_choice: str = ""
    weekend_session_cm_id: int = 0  # 0: the choice maps to no one weekend
    person_cm_id: int = 0
    household_cm_id: int = 0
    submitted_at: str = ""
    created_at: str = ""
    ask: float | None = None
    figures: list[FormFigureOut] = Field(default_factory=list)
    yes_no: list[FormYesNoOut] = Field(default_factory=list)
    unemployment: bool | None = None
    num_children: int | None = None
    county: str = ""
    special_circumstances: str = ""
    name_typed: str = ""
    signature_typed: str = ""
    agreement_date: str = ""
    match_tier: int = 0
    candidates: list[FormCandidateOut] = Field(default_factory=list)
    superseded_by: str = ""
    superseded: list[SupersededOut] = Field(default_factory=list)
    linked_by: str = ""
    linked_at: str = ""
    ignored_kind: IgnoreKind | Literal[""] = ""
    ignored_reason: str = ""
    ignored_by: str = ""
    ignored_at: str = ""
    look_reasons: list[LookReason] = Field(default_factory=list)


class GoogleFormStatusOut(BaseModel):
    """The season's form as the job last read it: "Last read from Google: 14:20", and a refused pull's banner."""

    last_pulled_at: str = ""
    last_pull_status: str = ""
    refused: bool = False
    # Read from the status line: how many responses the last pull returned, and (a refused pull) how many live ones
    # were expected. None when the line doesn't say.
    returned: int | None = None
    expected: int | None = None


class FormResponseActionOut(BaseModel):
    """A response after Link… or Ignore…."""

    id: str
    response_id: str
    match_status: FormMatchStatus
    person_cm_id: int = 0
    household_cm_id: int = 0
    linked_by: str = ""
    linked_at: str = ""
    ignored_kind: IgnoreKind | Literal[""] = ""
    ignored_reason: str = ""
    ignored_by: str = ""
    ignored_at: str = ""


class LinkCandidatesOut(BaseModel):
    """Link…'s dialog: the response's identity evidence, the respondent email included (read for this dialog only),
    and its candidates, named."""

    id: str
    response_id: str
    respondent_email: str = ""
    name_typed: str = ""
    birthdate_typed: str = ""
    program_choice: str = ""
    # The response's own candidates, or (with ?q=) the season's registered people the search found.
    candidates: list[LinkCandidateOut] = Field(default_factory=list)


class FormChangeReviewedOut(BaseModel):
    request_id: str
    reviewed_by: str
    reviewed_at: str


class FormResponseLink(BaseModel):
    person_cm_id: int = Field(gt=0)
    reason: str = Field(default="", max_length=2000)


class FormResponseIgnore(BaseModel):
    kind: IgnoreKind
    reason: str = Field(default="", max_length=1000)  # required when kind is "other"


class IntakeSessionOut(BaseModel):
    session_cm_id: int
    name: str
    session_type: str
    program_key: str  # the program whose requests can name it; "" when none
    # The program family its session type belongs to (summer, quest, teen, bmitzvah, family_camp, adult_weekend, ...):
    # Form asked names an answer by it, in the Requests grid's words (At Camp, Quests, Teen Programs).
    program_family: str = ""


class FormIntakeResponse(BaseModel):
    year: int
    rows: list[FormIntakeRowOut]
    counts: FormIntakeCountsOut
    sessions: list[IntakeSessionOut]
    grants_waiting_for_camper: int  # "N outside grants wait for a camper → Grants › Needs a camper"
    campminder_aid_on_no_request: float  # every row's amber money: D170's TOTAL for the season
    # CLOSED-SEASONS-DONE: the season is done: nothing needs a look, nothing can be added (CSD-6 opens on All forms).
    season_done: bool = False
    # The adult aid Google Form (PR 2): every response of the season (Responses to link are those with to_link; an
    # ignored one stays here with its reason), and the form's last pull. Empty / None before 2027.
    form_responses: list[FormResponseOut] = Field(default_factory=list)
    google_form: GoogleFormStatusOut | None = None


class FormIntakeSummaryOut(BaseModel):
    """The Requests band link's count (owner Q1-A), the same numbers /forms gives."""

    year: int
    needs_look: int
    registration_only: int
    all: int
    season_done: bool = False  # CLOSED-SEASONS-DONE: as FormIntakeResponse's
    to_link: int = 0  # adult aid form responses to Link… or Ignore… (PR 2)


class AddPrefillOut(BaseModel):
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int  # 0: no session can be told (pick one from gap_sessions; no Round 1 checkbox)
    ask: float  # the posted amount (owner Q4-A)
    round1_campminder: float | None  # the Q5 checkbox's amount; None when no session can be told


class AidOnNoRequestLineOut(BaseModel):
    """Season's D170 line opened in place (owner Q4-A): one Form intake row x session (a camper's own money, or the
    household's: a Family Camp weekend's, or money no one camper can take, which offers no Round 1)."""

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
    season_done: bool = False  # CLOSED-SEASONS-DONE: as FormIntakeResponse's (no line offers Add a Request…)


class UnlistedResponse(BaseModel):
    """Find a Camper Not Listed…: enrolled campers on no row, in the row shape so Add a Request… works on them."""

    year: int
    rows: list[FormIntakeRowOut]
    sessions: list[IntakeSessionOut]
