"""Money > Ledger's family rows (campership slice 3, ask 1). Task 5 writes the module docstring and the functions."""

from __future__ import annotations

from dataclasses import dataclass

from api.services.financial_aid_reconciliation import CampLine


@dataclass(frozen=True)
class LedgerLine:
    """One aid_postings row of any funder, as Money > Ledger reads it. `line` carries its money (aid dollars, positive)
    and its dates, so CampLine's live, reversed_by and as_recorded apply whatever the funder; the rest is its
    classification after any reclassification (aid_postings materializes it)."""

    line: CampLine
    funder_type: str  # camp, outside or incentive; "unknown" while its description is unclassified
    source_key: str  # aid_postings.effective_source_key
    source_family: str  # "unclassified" when blank
    flags: tuple[str, ...] = ()  # Go's posting flags (implied_program_mismatch, ...)
