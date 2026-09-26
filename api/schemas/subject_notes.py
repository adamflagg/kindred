"""Board notes -- request and response models for /api/subject-notes.

A Note belongs to one subject's registration for one session
(`session_cm_id` is the SUBJECT'S OWN session: an AG camper keeps the AG id).
`scenario` is '' for the standard note every plan shows, or a saved_scenarios
id for that scenario's plan-only note, which adds to the standard note.
"""

from typing import Literal

from pydantic import BaseModel, Field

NOTE_BODY_MAX = 2000
"""Same cap as lodging_write_ins.note, and subject_notes.body's own max."""

SubjectKind = Literal["person", "household"]

# A PocketBase record id is 15 alphanumerics. Refusing anything else keeps a
# scenario id from ever carrying filter syntax into a PocketBase filter.
_SCENARIO_ID = r"^[A-Za-z0-9]*$"


class SubjectNoteKey(BaseModel):
    """Which note: subject, its own registration session, year, and layer."""

    subject_kind: SubjectKind
    subject_cm_id: int = Field(..., gt=0, description="persons.cm_id, or the household cm id")
    session_cm_id: int = Field(..., gt=0, description="The subject's OWN registration session")
    year: int = Field(..., ge=2000, le=2100)
    scenario: str = Field(default="", max_length=32, pattern=_SCENARIO_ID, description="'' is the standard note")


class SubjectNoteWriteRequest(SubjectNoteKey):
    """Upsert one note. An empty or whitespace-only body deletes it."""

    body: str = Field(..., max_length=NOTE_BODY_MAX)


class SubjectNotePromoteRequest(SubjectNoteKey):
    """ "Keep on all plans": move this scenario's plan-only note into the standard note."""

    scenario: str = Field(..., min_length=1, max_length=32, pattern=_SCENARIO_ID)


class SubjectNoteOut(BaseModel):
    subject_kind: SubjectKind
    subject_cm_id: int
    session_cm_id: int
    scenario: str
    body: str
    updated_by: str
    updated: str


class SubjectNotesResponse(BaseModel):
    """The board read: standard notes plus the viewed scenario's plan-only notes."""

    notes: list[SubjectNoteOut]


class SubjectNoteWriteResponse(BaseModel):
    """One shape for PUT and promote. Both fields required, so the generated
    TypeScript type has no optional members to `??` around."""

    note: SubjectNoteOut | None
    deleted: bool
