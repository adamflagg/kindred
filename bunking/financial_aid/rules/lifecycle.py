"""Per-section lifecycle of a rules version (campership design section 7.1).

draft -> approved (who, when, a note such as the board meeting) -> locked.
A section locks when the first decision uses it (sub-project 10 calls lock);
after that it cannot change in this version -- changing it means a new version.
Editing an approved section sends it back to draft, because the board approved
the old values, not the new ones.

Sections refer to each other (a program names an award table; a table must
cover every tier band), so an edit to one section can break another without
touching it. `apply_edit` therefore judges the whole document after the edit:
an approved section that now has validation errors goes back to draft too, and
an edit that would give a LOCKED section new errors is refused -- the rules a
decision was made under must stay valid. `lock` refuses while the document has
any error anywhere.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal, NamedTuple

from pydantic import BaseModel, ConfigDict

from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules.schema import SECTION_NAMES, AidRules, SectionName
from bunking.financial_aid.rules.validation import ValidationIssue, ValidationReport

SectionState = Literal["draft", "approved", "locked"]


class SectionStatus(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    state: SectionState = "draft"
    approved_by: str | None = None
    approved_at: datetime | None = None
    note: str | None = None
    locked_at: datetime | None = None


StatusMap = dict[SectionName, SectionStatus]


class LockedSectionError(FinancialAidError, ValueError):
    def __init__(self, sections: list[SectionName]) -> None:
        super().__init__(f"Locked sections cannot change in this version: {', '.join(sections)}; make a new version")
        self.sections = sections


class LockedSectionInvalidatedError(FinancialAidError, ValueError):
    """The edit would give a locked section validation errors it did not have."""

    def __init__(self, sections: list[SectionName], report: ValidationReport) -> None:
        details = "; ".join(f"{name}: {_first_error(report, name)}" for name in sections)
        super().__init__(
            f"This change would make locked sections invalid ({details}); a locked section's rules must stay "
            "valid -- make a new version instead"
        )
        self.sections = sections


class SectionNotApprovedError(FinancialAidError, ValueError):
    """Only an approved section can lock."""


class SectionHasErrorsError(FinancialAidError, ValueError):
    """A section with validation errors cannot be approved."""


class DocumentHasErrorsError(FinancialAidError, ValueError):
    """No section can lock while the document has validation errors anywhere."""


class SectionStatusMissingError(FinancialAidError, ValueError):
    """A stored version has no status for some section; it is never assumed to be draft."""


class EditOutcome(NamedTuple):
    status: StatusMap
    # Approved sections the edit sent back to draft, in section order.
    reverted: list[SectionName]


def initial_status() -> StatusMap:
    return {name: SectionStatus() for name in SECTION_NAMES}


def changed_sections(old: AidRules, new: AidRules) -> list[SectionName]:
    return [name for name in SECTION_NAMES if getattr(old, name) != getattr(new, name)]


def _first_error(report: ValidationReport, section: SectionName) -> str:
    errors = report.errors_in(section)
    return errors[0].message if errors else "no errors"


def _error_keys(report: ValidationReport, section: SectionName) -> set[tuple[str, str, str]]:
    return {_key(i) for i in report.errors_in(section)}


def _key(issue: ValidationIssue) -> tuple[str, str, str]:
    return (issue.code, issue.path, issue.message)


def apply_edit(
    old: AidRules,
    new: AidRules,
    status: StatusMap,
    *,
    before: ValidationReport,
    after: ValidationReport,
) -> EditOutcome:
    """The status after saving `new` over `old`.

    `before` and `after` validate `old` and `new` against the same context. Raises
    LockedSectionError when the edit changes a locked section, and
    LockedSectionInvalidatedError when it gives a locked section errors it did not
    already have (an error that was there before -- a session synced after the lock,
    say -- is not this edit's doing and does not block it).
    """
    changed = changed_sections(old, new)
    locked = [name for name in changed if status[name].state == "locked"]
    if locked:
        raise LockedSectionError(locked)
    invalidated = [
        name
        for name in SECTION_NAMES
        if status[name].state == "locked" and _error_keys(after, name) - _error_keys(before, name)
    ]
    if invalidated:
        raise LockedSectionInvalidatedError(invalidated, after)
    updated = dict(status)
    reverted: list[SectionName] = []
    for name in SECTION_NAMES:
        if status[name].state == "approved" and (name in changed or after.errors_in(name)):
            updated[name] = SectionStatus()
            reverted.append(name)
    return EditOutcome(updated, reverted)


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


def lock(status: StatusMap, section: SectionName, *, at: datetime, report: ValidationReport) -> StatusMap:
    """Lock an approved section. `report` validates the whole current document."""
    current = status[section]
    if current.state == "locked":
        return status
    if current.state != "approved":
        raise SectionNotApprovedError(f"{section} must be approved before it can lock")
    if report.errors:
        sections = sorted({i.section for i in report.errors})
        raise DocumentHasErrorsError(
            f"{section} cannot lock while the rules have {len(report.errors)} validation error(s), "
            f"in {', '.join(sections)}: {report.errors[0].message}"
        )
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


def status_from_json(raw: Mapping[str, Any] | None) -> StatusMap:
    """Every section's stored status. A missing one raises: assuming "draft" would
    silently un-approve -- and un-lock -- what the board signed off."""
    stored = raw or {}
    missing = [name for name in SECTION_NAMES if stored.get(name) is None]
    if missing:
        raise SectionStatusMissingError(f"The stored section status has no entry for: {', '.join(missing)}")
    return {name: SectionStatus.model_validate(stored[name]) for name in SECTION_NAMES}
