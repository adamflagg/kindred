"""Request and response models for the campership rules routes (the rules loader).

The rules document itself is bunking.financial_aid.rules.AidRules: FastAPI
validates a posted document against it, so a malformed one is a 422 before any
service call. Every route needs financial_aid.rules, except D76's approved read
(financial_aid.view).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from bunking.financial_aid.change_diff import FieldChange
from bunking.financial_aid.rules import AidRules, SectionName, ValidationReport
from bunking.financial_aid.rules.lifecycle import SectionState, SectionStatus

_PastReason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class RulesDocumentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: AidRules
    # A done season (spec §11.2) is unlocked with a reason, logged on the write.
    past_season_reason: _PastReason | None = None


class RulesApproveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sections: list[SectionName] = Field(min_length=1)
    # D39: an approval names the approving body ("Finance, Oct 7 meeting"); stored as the log row's reason.
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    # Each ticked section's fingerprint as the approver saw it (the Rules tab's draft read): a section saved since is a 409.
    fingerprints: dict[SectionName, str]
    # A done season (spec §11.2) is unlocked with a reason, logged on the write.
    past_season_reason: _PastReason | None = None

    @model_validator(mode="after")
    def _fingerprints_match_sections(self) -> RulesApproveIn:
        if set(self.fingerprints) != set(self.sections):
            raise ValueError("fingerprints must name exactly the sections being approved")
        return self


class RulesVersionOut(BaseModel):
    """One version of a season's rules, each section's status, and the document's validation report."""

    year: int
    version: int
    parent_year: int | None
    parent_version: int | None
    document: AidRules
    section_status: dict[SectionName, SectionStatus]
    report: ValidationReport


class SectionSaveIn(BaseModel):
    """One section editor's save: the section's whole JSON, and the rules draft version the editor opened."""

    model_config = ConfigDict(extra="forbid")

    base_version: int = Field(ge=1)
    content: dict[str, Any]
    # The section's fingerprint as the editor opened it (DraftSectionOut.fingerprint): saved since is a 409.
    expected_fingerprint: str = Field(min_length=1)
    # A done season (spec §11.2) is unlocked with a reason, logged on the write.
    past_season_reason: _PastReason | None = None


class DiscardDraftIn(BaseModel):
    """Discard the rules draft (owner 2026-10-08): the draft version the page showed, so a draft that moved on since
    is refused rather than discarded unseen."""

    model_config = ConfigDict(extra="forbid")

    base_version: int = Field(ge=1)
    past_season_reason: _PastReason | None = None


class SectionsSaveIn(BaseModel):
    """Several sections' editors saved as one operation (the Programs and costs card: programs and cost)."""

    model_config = ConfigDict(extra="forbid")

    base_version: int = Field(ge=1)
    contents: dict[SectionName, dict[str, Any]] = Field(min_length=1)
    # Each section's fingerprint as the editor opened it: a section saved since is a 409 naming it.
    expected_fingerprints: dict[SectionName, str]
    # A done season (spec §11.2) is unlocked with a reason, logged on the write.
    past_season_reason: _PastReason | None = None

    @model_validator(mode="after")
    def _fingerprints_match_contents(self) -> SectionsSaveIn:
        if set(self.expected_fingerprints) != set(self.contents):
            raise ValueError("expected_fingerprints must name exactly the sections being saved")
        return self


class NewVersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Locked sections the new version lifts; every other lock is kept (spec §7.5).
    unlock: list[SectionName] = Field(default_factory=list)
    # A done season (spec §11.2) is unlocked with a reason, logged on the write.
    past_season_reason: _PastReason | None = None


class StartFromLastYearIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # A done season (spec §11.2) is unlocked with a reason, logged on the write.
    past_season_reason: _PastReason | None = None


class FieldChangeOut(BaseModel):
    """One changed setting: its path inside the section, and its value before and after."""

    path: list[str]
    kind: Literal["added", "removed", "changed"]
    before: Any = None
    after: Any = None


def field_change_out(change: FieldChange) -> FieldChangeOut:
    return FieldChangeOut(
        path=[str(part) for part in change.path], kind=change.kind, before=change.before, after=change.after
    )


class DraftSectionOut(BaseModel):
    section: SectionName
    status: SectionStatus
    changes: list[FieldChangeOut]  # against the approved rules pricing the season: "Draft · n changes"
    errors: int
    warnings: int
    fingerprint: str  # sha256 of the section's stored content; saves and approvals send it back


class GroupOut(BaseModel):
    """One group (spec §4.1): a budget pool, its label, and the equity class its programs share."""

    pool: str
    label: str
    equity_class: str | None


class RulesDraftOut(BaseModel):
    """The Rules tab: the rules draft (the latest version) section by section (spec §7.5, D39)."""

    year: int
    version: int
    parent_year: int | None
    parent_version: int | None
    approved_version: int | None  # the version pricing the season, which `changes` compare against
    document: AidRules
    sections: list[DraftSectionOut]
    report: ValidationReport
    branched_from: int | None = None  # a save that made this version from the one it names
    budget_total_locked: bool = False  # owner 10-06 (b): Round 1 has posted; the total is read-only, the shares edit
    groups: list[GroupOut] = Field(default_factory=list)
    # Spec §11.1: the season is earlier than the configured one. `configured_year` is None when the service has no
    # reader for it; the screen only reads it when `season_done` is true.
    season_done: bool = False
    configured_year: int | None = None


class ApprovedSectionOut(BaseModel):
    section: SectionName
    version: int | None  # the version this section is served from (D76 reads section by section)
    state: SectionState
    approved_by: str | None
    approved_at: datetime | None
    note: str | None
    locked_at: datetime | None
    content: dict[str, Any] | None  # None: not approved in this version (never shown, D76)


class ApprovedRulesOut(BaseModel):
    """D76: the approved rules, read only."""

    year: int
    version: int | None  # the version pricing the season (or the `version` asked for); None while none prices
    sections: list[ApprovedSectionOut]
    groups: list[GroupOut] = Field(default_factory=list)
    season_done: bool = False  # spec §11.1, as on RulesDraftOut
    configured_year: int | None = None
