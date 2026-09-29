"""Request and response models for the campership rules routes (the rules loader).

The rules document itself is bunking.financial_aid.rules.AidRules: FastAPI
validates a posted document against it, so a malformed one is a 422 before any
service call. Every route needs financial_aid.rules.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from bunking.financial_aid.rules import AidRules, SectionName, ValidationReport
from bunking.financial_aid.rules.lifecycle import SectionStatus


class RulesDocumentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: AidRules


class RulesApproveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sections: list[SectionName] = Field(min_length=1)
    # D39: an approval names the approving body ("Finance, Oct 7 meeting"); stored as the log row's reason.
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class RulesVersionOut(BaseModel):
    """One version of a season's rules, each section's status, and the document's validation report."""

    year: int
    version: int
    parent_year: int | None
    parent_version: int | None
    document: AidRules
    section_status: dict[SectionName, SectionStatus]
    report: ValidationReport
