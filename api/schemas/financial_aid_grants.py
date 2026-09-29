"""Grants (campership sub-project 6-core): the grantor directory, the register built from the
CampMinder ledger, camper placements and hand-entered commitments (spec §8.2, D55–D57, D86).

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), the
same as the ledger read. Every figure is live: the register has no as-of view in this PR.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

GrantorKey = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60, pattern=r"^[a-z][a-z0-9_]*$")
]
CoversCanteen = Literal["unknown", "yes", "no"]
_Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
_Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
_Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class GrantorFields(BaseModel):
    """The grantor facts, each in one home (owner ruling 2026-09-28). covers_canteen (D86) is
    whether a FULL-COVERAGE grant includes the canteen deposit: "unknown" until staff answer,
    and recorded only for a full-coverage grantor. The camp's own aid never pays canteen."""

    name: _Name
    aliases: list[_Name] = Field(default_factory=list, max_length=50)
    full_coverage: bool = False
    covers_canteen: CoversCanteen = "unknown"
    eligibility: _Text = ""
    contacts: _Text = ""

    @model_validator(mode="after")
    def _canteen_needs_full_coverage(self) -> GrantorFields:
        if self.covers_canteen != "unknown" and not self.full_coverage:
            raise ValueError("covers_canteen is recorded only for a full-coverage grantor")
        return self


class GrantorCreate(GrantorFields):
    key: GrantorKey
    note: _Note


class GrantorSave(GrantorFields):
    """A whole-record save of an existing grantor; the key never changes."""

    note: _Note


class GrantorDescription(BaseModel):
    """One CampMinder description mapped to the grantor, read from aid_sources (D58)."""

    source_id: str
    description_key: str
    description: str
    source_family: str


class GrantorOut(BaseModel):
    key: str
    name: str
    aliases: list[str]
    full_coverage: bool
    covers_canteen: CoversCanteen
    eligibility: str
    contacts: str
    descriptions: list[GrantorDescription]


class GrantorsResponse(BaseModel):
    grantors: list[GrantorOut]


# --- the register read (one aggregate for Grants, D21 / spec §10) -----------------------

CamperBasis = Literal["ledger", "placed", "commitment", "household", "none"]
WaitingReason = Literal["not_posted", "posted_then_reversed", "possible_match", "camper_cancelled"]


class RequestShareOut(BaseModel):
    request_id: str
    amount: float


class GrantRowOut(BaseModel):
    """One register row: a CampMinder grant line (live or reversed), or an open commitment not yet
    posted. person_cm_id 0 = needs a camper, except camper_basis "household": a household
    program's grant (Family Camp), which needs none. counts = a live grant with a confirmed camper
    (or a household target), or an open commitment whose camper hasn't cancelled; whether it
    reduces an award is the rules' call (offset_programs, incentive modes). requests = the aid
    requests it sits on; [] = didn't apply."""

    kind: Literal["ledger", "commitment"]
    transaction_cm_id: int
    commitment_id: str
    household_cm_id: int
    family_name: str
    person_cm_id: int
    camper_name: str
    camper_basis: CamperBasis
    session_cm_id: int
    session_name: str
    program_family: str
    grantor_key: str
    grantor_name: str
    description: str
    source_family: str
    funder_type: str
    amount: float
    recorded_on: str
    is_reversed: bool
    reversal_date: str
    cancelled: bool
    counts: bool
    fulfils_commitment_id: str
    requests: list[RequestShareOut]


class CamperSuggestionOut(BaseModel):
    person_cm_id: int
    camper_name: str
    session_cm_id: int
    program_family: str
    basis: Literal["commitment", "attribution"]
    method: str
    commitment_id: str
    amount_matches: bool


class CamperCandidateOut(BaseModel):
    person_cm_id: int
    name: str


class NeedsCamperOut(BaseModel):
    grant: GrantRowOut
    household_applied: bool
    suggestion: CamperSuggestionOut | None
    candidates: list[CamperCandidateOut]


class UnmappedDescriptionOut(BaseModel):
    """A grant description (outside or incentive) with live lines this season and no grantor
    (opens Money › Sources). An incentive description names a grantor too: JFAM is a grant."""

    source_id: str
    description_key: str
    description: str
    lines: int
    amount: float


class WaitingCommitmentOut(BaseModel):
    """A commitment still counting on its own, and why. transaction_cm_id is the line that shows it
    (0 when there is none): a reversal of its grant, or a line that may be it."""

    grant: GrantRowOut
    days_waiting: int
    reason: WaitingReason
    transaction_cm_id: int


class ExpectedOut(BaseModel):
    """D56: never a grant, never counted."""

    household_cm_id: int
    family_name: str
    kind: Literal["one_happy_camper", "synagogue"]
    person_cm_ids: list[int]
    camper_names: list[str]


class GrantsResponse(BaseModel):
    """Grants' one aggregate read: the register, the three needs-attention groups and Expected.
    Family level, for financial_aid.view (D57); development gets aggregates from Reports."""

    year: int
    grants: list[GrantRowOut]
    needs_camper: list[NeedsCamperOut]
    unmapped: list[UnmappedDescriptionOut]
    waiting: list[WaitingCommitmentOut]
    expected: list[ExpectedOut]


# --- placing a camper (casework) --------------------------------------------------------------


class PlacementIn(BaseModel):
    transaction_cm_id: int = Field(gt=0)
    person_cm_id: int = Field(gt=0)
    session_cm_id: int | None = Field(default=None, gt=0)


class PlaceGrantsIn(BaseModel):
    """Confirms the camper (and optionally the session) of grant lines: one, or a class in bulk
    (D16). One logged operation, all or nothing (Decision 11). The note is optional (a
    confirmation, like a tick; Decision 12). 500 placements is 1,000 batch requests, inside one
    atomic batch."""

    placements: list[PlacementIn] = Field(min_length=1, max_length=500)
    note: _Text = ""

    @model_validator(mode="after")
    def _each_line_once(self) -> PlaceGrantsIn:
        ids = [p.transaction_cm_id for p in self.placements]
        if len(ids) != len(set(ids)):
            raise ValueError("each transaction_cm_id may appear once per placement")
        return self


class PlaceGrantsOut(BaseModel):
    year: int
    placed: int
    unchanged: int
    operation_id: str | None


# --- hand-entered commitments (casework; D55: only for a grant committed but not yet posted) ---


class CommitmentIn(BaseModel):
    """A whole commitment (create and save take the same body). The camper is required: the
    caseworker enters the commitment because they know who it's for. The session is optional; the
    program family comes from the camper's enrollments."""

    grantor_key: GrantorKey
    household_cm_id: int = Field(gt=0)
    person_cm_id: int = Field(gt=0)
    session_cm_id: int | None = Field(default=None, gt=0)
    amount: Decimal = Field(gt=0, max_digits=9, decimal_places=2)
    committed_on: date
    note: _Text = ""


class WithdrawIn(BaseModel):
    reason: _Note


class CommitmentOut(BaseModel):
    id: str
    year: int
    grantor_key: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    program_family: str
    amount: float
    committed_on: str
    status: Literal["open", "withdrawn"]
    withdrawn_at: str
    note: str
