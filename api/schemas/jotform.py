"""Jotform admin API models (kindred#2759). Every endpoint is bunking.manage-only."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class JotformQuestion(BaseModel):
    question_id: str
    text: str = ""
    type: str = ""


RoleSource = Literal["staff", "carried", "guessed"]
RoleFlag = Literal["wording_changed", "missing", "needs_pick"]


class JotformRoleMeta(BaseModel):
    """How the pull resolved one role (kindred#2828). `source` is absent for a
    role nothing resolved; `flag` is what staff should look at, if anything."""

    question_id: str = ""
    text: str = ""
    source: RoleSource | None = None
    flag: RoleFlag | None = None


class JotformFormRow(BaseModel):
    """One active-season adult weekend and its form setting (absent = not set up)."""

    session_cm_id: int
    session_name: str
    form_id: str = ""
    # The title in Jotform, read by the pull: shown so a wrong year's form is noticed.
    form_title: str = ""
    # The EFFECTIVE map the pull resolved (staff, carried or guessed per role).
    field_map: dict[str, str] = Field(default_factory=dict)
    field_map_meta: dict[str, JotformRoleMeta] = Field(default_factory=dict)
    # The form's questions at the last pull, from its definition; empty until then.
    questions: list[JotformQuestion] = Field(default_factory=list)
    enabled: bool = False
    last_pulled_at: str = ""
    last_pull_status: str = ""
    submission_count: int = 0


class JotformFormsResponse(BaseModel):
    year: int
    rows: list[JotformFormRow] = Field(default_factory=list)


class JotformFormWrite(BaseModel):
    # A numeric id, or any Jotform link that contains it (see parse_form_id).
    form_ref: str = Field(min_length=1, max_length=500)
    field_map: dict[str, str] = Field(default_factory=dict)
    enabled: bool = False


SuggestionKind = Literal["likely_duplicate", "did_you_mean", "probably_different"]
# `cancelled`: the pull matched the filer to a registration of the weekend
# that is not enrolled (kindred#2759 follow-up). `write_in`: staff linked the
# filing to a board write-in.
MatchStatus = Literal["auto", "staff", "unmatched", "ignored", "cancelled", "write_in"]


class JotformSuggestion(BaseModel):
    kind: SuggestionKind
    label: str
    person_cm_id: int = 0
    guest_name: str = ""
    other_submission_id: str = ""
    score: float = 0.0
    # The candidate is named in this submission's own bunking request.
    demoted: bool = False


class JotformQueueItem(BaseModel):
    submission_id: str
    session_cm_id: int
    session_name: str = ""
    submitted_name: str
    nametag: str = ""
    submitted_at: str
    bunking_request: str = ""
    match_status: MatchStatus
    person_cm_id: int = 0
    guest_name: str = ""
    suggestions: list[JotformSuggestion] = Field(default_factory=list)
    # A `cancelled` match: the registration's status (cancelled, incomplete...).
    registration_status: str = ""
    # A `write_in` link: the write-in's occupant name and unit.
    write_in_name: str = ""
    write_in_unit: str = ""
    # Needs a guest: the write-in option pre-selected for it, or "" for none.
    write_in_suggestion: str = ""


class JotformGuest(BaseModel):
    person_cm_id: int
    display_name: str
    session_cm_id: int
    has_submission: bool = False


class JotformDuplicateGroup(BaseModel):
    person_cm_id: int
    guest_name: str
    session_cm_id: int
    change_kind: Literal["list", "prose", "identical", "none"] = "none"
    submissions: list[JotformQueueItem] = Field(default_factory=list)


class JotformUnmappedForm(BaseModel):
    """A weekend whose form has submissions but no first + last name mapped, so
    matching has not run: its submissions are not listed as needing a guest."""

    session_cm_id: int
    session_name: str = ""


class JotformWriteInOption(BaseModel):
    """One of a weekend's board write-ins a filing can be linked to: a
    (unit, occupant name) on the live board or in any scenario, listed once."""

    option_id: str
    session_cm_id: int
    unit_id: str
    unit_name: str = ""
    occupant_name: str


class JotformQueueResponse(BaseModel):
    year: int
    unmatched: list[JotformQueueItem] = Field(default_factory=list)
    unmapped: list[JotformUnmappedForm] = Field(default_factory=list)
    # Staff-linked and ignored submissions, so a link can be undone.
    resolved: list[JotformQueueItem] = Field(default_factory=list)
    # Filers matched to a registration that is not enrolled. No action needed.
    cancelled: list[JotformQueueItem] = Field(default_factory=list)
    # Filings linked to a board write-in that still exists.
    write_ins: list[JotformQueueItem] = Field(default_factory=list)
    write_in_options: list[JotformWriteInOption] = Field(default_factory=list)
    duplicates: list[JotformDuplicateGroup] = Field(default_factory=list)
    guests: list[JotformGuest] = Field(default_factory=list)


class JotformLinkRequest(BaseModel):
    person_cm_id: int = Field(gt=0)


class JotformWriteInLinkRequest(BaseModel):
    """The write-in to link a filing to, by the address the board uses."""

    unit_id: str = Field(min_length=1, max_length=64)
    occupant_name: str = Field(min_length=1, max_length=500)
