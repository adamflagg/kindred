"""Per-section lifecycle of a rules version (campership design section 7.1).

draft -> approved (who, when, a note such as the board meeting) -> locked.
A section locks when the first decision uses it (sub-project 10 calls lock);
after that it cannot change in this version -- changing it means a new version.
Editing an approved section sends it back to draft, because the board approved
the old values, not the new ones.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from bunking.financial_aid.rules.schema import SECTION_NAMES, AidRules, SectionName
from bunking.financial_aid.rules.validation import ValidationReport

SectionState = Literal["draft", "approved", "locked"]


class SectionStatus(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    state: SectionState = "draft"
    approved_by: str | None = None
    approved_at: datetime | None = None
    note: str | None = None
    locked_at: datetime | None = None


StatusMap = dict[SectionName, SectionStatus]


class LockedSectionError(ValueError):
    def __init__(self, sections: list[SectionName]) -> None:
        super().__init__(f"Locked sections cannot change in this version: {', '.join(sections)}; make a new version")
        self.sections = sections


class SectionNotApprovedError(ValueError):
    """Only an approved section can lock."""


class SectionHasErrorsError(ValueError):
    """A section with validation errors cannot be approved."""


def initial_status() -> StatusMap:
    return {name: SectionStatus() for name in SECTION_NAMES}


def changed_sections(old: AidRules, new: AidRules) -> list[SectionName]:
    return [name for name in SECTION_NAMES if getattr(old, name) != getattr(new, name)]


def apply_edit(old: AidRules, new: AidRules, status: StatusMap) -> StatusMap:
    changed = changed_sections(old, new)
    locked = [name for name in changed if status[name].state == "locked"]
    if locked:
        raise LockedSectionError(locked)
    updated = dict(status)
    for name in changed:
        if status[name].state == "approved":
            updated[name] = SectionStatus()
    return updated


def approve(
    status: StatusMap,
    section: SectionName,
    *,
    by: str,
    at: datetime,
    note: str | None,
    report: ValidationReport,
) -> StatusMap:
    if status[section].state == "locked":
        raise LockedSectionError([section])
    errors = report.errors_in(section)
    if errors:
        raise SectionHasErrorsError(f"{section} has {len(errors)} validation error(s): {errors[0].message}")
    updated = dict(status)
    updated[section] = SectionStatus(state="approved", approved_by=by, approved_at=at, note=note)
    return updated


def lock(status: StatusMap, section: SectionName, *, at: datetime) -> StatusMap:
    current = status[section]
    if current.state == "locked":
        return status
    if current.state != "approved":
        raise SectionNotApprovedError(f"{section} must be approved before it can lock")
    updated = dict(status)
    updated[section] = current.model_copy(update={"state": "locked", "locked_at": at})
    return updated


def carry_forward(status: StatusMap) -> StatusMap:
    """Status for a new version copied from this one: approvals kept, locks lifted."""
    return {
        name: s.model_copy(update={"state": "approved", "locked_at": None}) if s.state == "locked" else s
        for name, s in status.items()
    }


def status_to_json(status: StatusMap) -> dict[str, Any]:
    return {name: status[name].model_dump(mode="json") for name in SECTION_NAMES}


def status_from_json(raw: Mapping[str, Any]) -> StatusMap:
    return {name: SectionStatus.model_validate(raw[name]) if name in raw else SectionStatus() for name in SECTION_NAMES}
