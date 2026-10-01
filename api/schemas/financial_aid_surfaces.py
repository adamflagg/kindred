"""Slice 1's reads (clean spec §12.2 "Slice 1's own reads"; §3.5, §4.8, §6.4): the definitions
registry, the jump-box index and Today. The household page is api/schemas/financial_aid_household_page.py.

Money is aid dollars, positive, rounded to cents (Decimal half-up, then float for JSON), as in the
decisions, grants and ledger reads. None is "nothing there"; 0 is a real zero (D74). Counts of work
(Today) carry no basis word and no definition (D20).
"""

from __future__ import annotations

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
