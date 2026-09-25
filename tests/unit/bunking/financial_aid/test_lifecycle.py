"""Per-section approval: an edit un-approves, a lock refuses edits, a new version carries approvals."""

from datetime import UTC, datetime

import pytest

from bunking.financial_aid.rules import SECTION_NAMES, SectionName, SessionRef, ValidationContext, validate_rules
from bunking.financial_aid.rules.lifecycle import (
    LockedSectionError,
    SectionHasErrorsError,
    SectionNotApprovedError,
    StatusMap,
    apply_edit,
    approve,
    carry_forward,
    changed_sections,
    initial_status,
    lock,
    status_from_json,
    status_to_json,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_lever

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)


def _approved(section: SectionName = "income") -> StatusMap:
    report = validate_rules(fictional_rules())
    return approve(initial_status(), section, by="finance@example.com", at=AT, note="Board, Jan 15", report=report)


def test_every_section_starts_as_draft() -> None:
    status = initial_status()
    assert tuple(status) == SECTION_NAMES
    assert {s.state for s in status.values()} == {"draft"}


def test_approve_records_who_when_and_why() -> None:
    status = _approved()
    assert status["income"].state == "approved"
    assert status["income"].approved_by == "finance@example.com"
    assert status["income"].approved_at == AT
    assert status["income"].note == "Board, Jan 15"
    assert status["tiers"].state == "draft"


def test_a_section_with_errors_cannot_be_approved_but_others_can() -> None:
    rules = fictional_rules()
    report = validate_rules(rules, ValidationContext(sessions=[SessionRef(cm_id=1000999)]))
    with pytest.raises(SectionHasErrorsError, match="programs"):
        approve(initial_status(), "programs", by="f@example.com", at=AT, note=None, report=report)
    assert approve(initial_status(), "income", by="f@example.com", at=AT, note=None, report=report)["income"].state == (
        "approved"
    )


def test_changed_sections_names_only_what_moved() -> None:
    old = fictional_rules()
    new = with_lever(old, "income.medical_threshold", "4500")
    assert changed_sections(old, new) == ["income"]
    assert changed_sections(old, old) == []


def test_editing_an_approved_section_sends_it_back_to_draft() -> None:
    old = fictional_rules()
    status = _approved("income")
    status = apply_edit(old, with_lever(old, "income.medical_threshold", "4500"), status)
    assert status["income"].state == "draft"
    assert status["income"].approved_by is None


def test_editing_a_locked_section_is_refused() -> None:
    old = fictional_rules()
    status = lock(_approved("income"), "income", at=AT)
    with pytest.raises(LockedSectionError) as caught:
        apply_edit(old, with_lever(old, "income.medical_threshold", "4500"), status)
    assert caught.value.sections == ["income"]
    # Changing a different, unlocked section is fine.
    assert apply_edit(old, with_lever(old, "tiers.floor_tier", 2), status)["income"].state == "locked"


def test_only_an_approved_section_can_lock() -> None:
    with pytest.raises(SectionNotApprovedError):
        lock(initial_status(), "income", at=AT)
    assert lock(_approved(), "income", at=AT)["income"].locked_at == AT


def test_a_locked_section_cannot_be_re_approved() -> None:
    status = lock(_approved(), "income", at=AT)
    with pytest.raises(LockedSectionError):
        approve(status, "income", by="f@example.com", at=AT, note=None, report=validate_rules(fictional_rules()))


def test_a_new_version_keeps_approvals_but_unlocks() -> None:
    status = carry_forward(lock(_approved(), "income", at=AT))
    assert status["income"].state == "approved"
    assert status["income"].approved_by == "finance@example.com"
    assert status["income"].locked_at is None
    assert status["tiers"].state == "draft"


def test_status_json_round_trip_fills_missing_sections_with_draft() -> None:
    status = lock(_approved(), "income", at=AT)
    raw = status_to_json(status)
    assert raw["income"]["state"] == "locked"
    assert status_from_json(raw) == status
    assert status_from_json({})["milestones"].state == "draft"
