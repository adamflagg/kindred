"""Edit stamps on a rules section's status (SP9): who last changed a section in the rules draft, when, and
from which kept scenario option. Approval clears them; a status stored before SP9 has none; and an empty stamp is
never stored, so a rolled-back deploy (code from before SP9) still loads every section with no live edit."""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict

from bunking.financial_aid.rules.lifecycle import (
    SectionStatus,
    StatusMap,
    approve,
    carry_forward,
    initial_status,
    lock,
    stamp_edits,
    status_from_json,
    status_to_json,
)
from bunking.financial_aid.rules.validation import ValidationReport

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)
LATER = datetime(2031, 1, 16, 9, 0, tzinfo=UTC)
FINANCE = "finance@example.com"
TREASURER = "treasurer@example.com"


def _approved() -> StatusMap:
    """Every section draft except income, approved by finance."""
    return approve(initial_status(), "income", by=FINANCE, at=AT, note="Board", report=ValidationReport())


def test_stamping_marks_only_the_named_sections_and_keeps_their_state() -> None:
    status = _approved()
    stamped = stamp_edits(status, ["awards", "tiers"], by=TREASURER, at=LATER, via="B2")
    awards = stamped["awards"]
    assert (awards.edited_by, awards.edited_at, awards.edited_via) == (TREASURER, LATER, "B2")
    assert stamped["tiers"].state == "draft"
    assert stamped["income"] == status["income"]  # not named: untouched
    assert stamped["income"].edited_by is None


def test_approving_a_stamped_section_clears_its_stamp() -> None:
    stamped = stamp_edits(initial_status(), ["awards"], by=TREASURER, at=AT, via=None)
    approved = approve(stamped, "awards", by=FINANCE, at=LATER, note="Board", report=ValidationReport())
    assert (approved["awards"].state, approved["awards"].edited_by, approved["awards"].edited_at) == (
        "approved",
        None,
        None,
    )


def test_carrying_a_version_forward_keeps_the_stamps_and_a_lifted_lock_keeps_its_approval() -> None:
    status = lock(_approved(), "income", at=AT, report=ValidationReport())
    status = stamp_edits(status, ["awards"], by=TREASURER, at=AT, via="A1")
    carried = carry_forward(status, unlock=["income"])
    assert carried["awards"].edited_via == "A1"
    assert (carried["income"].state, carried["income"].approved_by) == ("approved", FINANCE)


def test_an_unedited_status_is_stored_without_the_stamp_keys_and_loads_as_unedited() -> None:
    stored = status_to_json(initial_status())
    assert all(not {"edited_by", "edited_at", "edited_via"} & entry.keys() for entry in stored.values())
    assert status_from_json(stored)["awards"] == SectionStatus()


class _PreSP9Status(BaseModel):
    """SectionStatus as released before SP9 (unknown keys forbidden): what a rolled-back deploy runs."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    state: str = "draft"
    approved_by: str | None = None
    approved_at: datetime | None = None
    note: str | None = None
    locked_at: datetime | None = None


def test_code_from_before_the_stamps_still_loads_every_section_with_no_live_edit() -> None:
    edited_then_approved = approve(
        stamp_edits(initial_status(), ["awards"], by=TREASURER, at=AT, via="B2"),
        "awards",
        by=FINANCE,
        at=LATER,
        note="Board",
        report=ValidationReport(),
    )
    for entry in status_to_json(edited_then_approved).values():
        _PreSP9Status.model_validate(entry)


def test_the_stamps_round_trip_through_json() -> None:
    stamped = stamp_edits(initial_status(), ["awards"], by=TREASURER, at=AT, via="B2")
    assert status_from_json(status_to_json(stamped)) == stamped


def test_a_replayed_or_stored_status_without_the_stamp_keys_still_loads() -> None:
    """3c-1's replay and any pre-SP9 row hand back entries with no stamp keys at all."""
    stored = {
        name: {"state": "approved", "approved_by": FINANCE, "approved_at": AT.isoformat(), "note": "Board"}
        for name in status_to_json(initial_status())
    }
    loaded = status_from_json(stored)
    assert all(s.state == "approved" and s.edited_by is None and s.edited_via is None for s in loaded.values())
