"""Grants (campership sub-project 6-core): the grantor directory, the register built from the
CampMinder ledger, camper placements and hand-entered commitments (spec §8.2, D55–D57, D86).

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), the
same as the ledger read. Every figure is live: the register has no as-of view in this PR.
"""

from __future__ import annotations

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
    and recorded only for a full-coverage grantor. Tawonga's own aid never pays canteen."""

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
