"""Slice 1's reads (clean spec §12.2 "Slice 1's own reads"; §3.5, §4.8, §6.4): the definitions
registry, the jump-box index and Today. The household page is api/schemas/financial_aid_household_page.py.

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), as in the
decisions, grants and ledger reads. None is "nothing there"; 0 is a real zero (D74). Counts of work
(Today) carry no basis word and no definition (D20).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

# --- the definitions registry (§4.8, D20) ---------------------------------------------------------


class DefinitionNoteOut(BaseModel):
    """One numbered note: a signed meaning (§5), the camp's name filled in, numbered from 1 on its surface."""

    key: str
    n: int
    text: str


class DefinitionsResponse(BaseModel):
    surface: str
    notes: list[DefinitionNoteOut]


# --- the jump box's index (§3.5, D13, D27) ---------------------------------------------------------


class JumpIndexPerson(BaseModel):
    """A camper (with a request, a posting or a commitment in the household) or a parent its records name.
    A parent has no CampMinder id here (the camper record's parent names carry none): person_cm_id None."""

    person_cm_id: int | None
    name: str  # "" when a camper isn't in this season's persons: the id still finds the household
    role: Literal["camper", "parent"]


class JumpIndexHousehold(BaseModel):
    """One household with aid activity this season: an application, a request or a payer share, a posting
    (live or reversed) or a grant commitment. The browser matches the family name, a person's name or either
    CampMinder id, and Enter opens /aid/households/:household_cm_id."""

    household_cm_id: int
    family_name: str
    people: list[JumpIndexPerson]


class JumpIndexResponse(BaseModel):
    year: int
    households: list[JumpIndexHousehold]
