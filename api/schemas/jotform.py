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
    # A `write_in` link read for one weekend's Requests tab (kindred#2828
    # ruling 2026-09-25): whether a write-in of the VIEWED scenario (or the
    # live board) carries the link. `write_in_unit` is then that row's unit,
    # and blank when not placed. None on the year-wide read, which views no
    # scenario.
    write_in_placed: bool | None = None
    # Needs a guest: the write-in option pre-selected for it, or "" for none.
    write_in_suggestion: str = ""
    # Needs a guest: the filer's folded names in `suggest_write_in`'s exact
    # tiers, best first (`jotform_queue.name_tiers`). The board's write-in box
    # matches a typed name against them (kindred#2839 follow-up); empty on
    # every other list.
    name_tiers: list[list[str]] = Field(default_factory=list)


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


class JotformWriteInLinkSuggestion(BaseModel):
    """An unlinked write-in of the viewed scenario that looks like a filer
    (kindred#2828 ruling 2026-09-25): a label and a one-click link, never a
    link made on its own. `linked_in` names where the filing is already
    linked ("the live board" or a scenario's name), or is "" for a filing
    still needing a guest."""

    option_id: str
    unit_id: str
    unit_name: str = ""
    occupant_name: str
    submission_id: str
    filer_name: str
    linked_in: str = ""
    label: str
    # Offered because the name is only CLOSE to the filer's (Jaro-Winkler),
    # not one of `suggest_write_in`'s exact tiers. The filer's own row says
    # so; a similar name never pre-selects the dropdown.
    similar: bool = False


class JotformQueueResponse(BaseModel):
    year: int
    # Set when the read is one weekend's Requests tab, with the scenario it
    # was read in ("" = the live board).
    session_cm_id: int | None = None
    scenario: str = ""
    unmatched: list[JotformQueueItem] = Field(default_factory=list)
    unmapped: list[JotformUnmappedForm] = Field(default_factory=list)
    # Staff-linked and ignored submissions, so a link can be undone.
    resolved: list[JotformQueueItem] = Field(default_factory=list)
    # Filers matched to a registration that is not enrolled. No action needed.
    cancelled: list[JotformQueueItem] = Field(default_factory=list)
    # Filings linked to a board write-in that still exists.
    write_ins: list[JotformQueueItem] = Field(default_factory=list)
    write_in_options: list[JotformWriteInOption] = Field(default_factory=list)
    # One weekend's read only: unlinked write-ins of the viewed scenario that match a filer.
    write_in_link_suggestions: list[JotformWriteInLinkSuggestion] = Field(default_factory=list)
    duplicates: list[JotformDuplicateGroup] = Field(default_factory=list)
    guests: list[JotformGuest] = Field(default_factory=list)


class JotformLinkRequest(BaseModel):
    person_cm_id: int = Field(gt=0)


class JotformWriteInLinkRequest(BaseModel):
    """The write-in to link a filing to, by the address the board uses."""

    unit_id: str = Field(min_length=1, max_length=64)
    occupant_name: str = Field(min_length=1, max_length=500)


class JotformSiblingFiling(BaseModel):
    """Another filing of the same weekend by an identical submitter that a
    staff action moved along with the one clicked."""

    submission_id: str
    submitted_name: str
    submitted_at: str


class JotformActionResult(BaseModel):
    """What a link, ignore, unlink or restore did (kindred#2839 follow-up):
    one filer, one decision. `also` names the filer's other filings of the
    weekend the same decision reached."""

    action: Literal["linked", "ignored", "unlinked", "restored"]
    also: list[JotformSiblingFiling] = Field(default_factory=list)
