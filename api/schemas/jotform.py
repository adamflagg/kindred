"""Jotform admin API models (kindred#2759). Every endpoint is bunking.manage-only."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class JotformQuestion(BaseModel):
    question_id: str
    text: str = ""
    type: str = ""


class JotformFormRow(BaseModel):
    """One active-season adult weekend and its form setting (absent = not set up)."""

    session_cm_id: int
    session_name: str
    form_id: str = ""
    field_map: dict[str, str] = Field(default_factory=dict)
    # From the stored questions' text; empty until the first pull brings them in.
    suggested_field_map: dict[str, str] = Field(default_factory=dict)
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
MatchStatus = Literal["auto", "staff", "unmatched", "ignored"]


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


class JotformQueueResponse(BaseModel):
    year: int
    unmatched: list[JotformQueueItem] = Field(default_factory=list)
    # Staff-linked and ignored submissions, so a link can be undone.
    resolved: list[JotformQueueItem] = Field(default_factory=list)
    duplicates: list[JotformDuplicateGroup] = Field(default_factory=list)
    guests: list[JotformGuest] = Field(default_factory=list)


class JotformLinkRequest(BaseModel):
    person_cm_id: int = Field(gt=0)
