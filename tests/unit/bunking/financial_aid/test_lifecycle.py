"""Per-section approval: an edit un-approves, a lock refuses edits, a new version carries approvals."""

from datetime import UTC, datetime

import pytest

from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules import SECTION_NAMES, SectionName, SessionRef, ValidationContext, validate_rules
from bunking.financial_aid.rules.lifecycle import (
    DocumentHasErrorsError,
    LockedSectionError,
    LockedSectionInvalidatedError,
    SectionHasErrorsError,
    SectionNotApprovedError,
    SectionStatusMissingError,
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
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, fictional_rules_json, with_lever

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)


def _edit(old: AidRules, new: AidRules, status: StatusMap) -> StatusMap:
    return apply_edit(old, new, status, before=validate_rules(old), after=validate_rules(new)).status


def _approved(section: SectionName = "income") -> StatusMap:
    report = validate_rules(fictional_rules())
    return approve(initial_status(), section, by="finance@example.com", at=AT, note="Board, Jan 15", report=report)


def _lock(status: StatusMap, section: SectionName) -> StatusMap:
    return lock(status, section, at=AT, report=validate_rules(fictional_rules()))


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
    status = _edit(old, with_lever(old, "income.medical_threshold", "4500"), status)
    assert status["income"].state == "draft"
    assert status["income"].approved_by is None


def test_editing_a_locked_section_is_refused() -> None:
    old = fictional_rules()
    status = _lock(_approved("income"), "income")
    with pytest.raises(LockedSectionError) as caught:
        _edit(old, with_lever(old, "income.medical_threshold", "4500"), status)
    assert caught.value.sections == ["income"]
    # Changing a different, unlocked section is fine.
    assert _edit(old, with_lever(old, "tiers.floor_tier", 2), status)["income"].state == "locked"


def test_only_an_approved_section_can_lock() -> None:
    with pytest.raises(SectionNotApprovedError):
        _lock(initial_status(), "income")
    assert _lock(_approved(), "income")["income"].locked_at == AT


def test_a_locked_section_cannot_be_re_approved() -> None:
    status = _lock(_approved(), "income")
    with pytest.raises(LockedSectionError):
        approve(status, "income", by="f@example.com", at=AT, note=None, report=validate_rules(fictional_rules()))


def test_a_new_version_keeps_approvals_but_unlocks() -> None:
    status = carry_forward(_lock(_approved(), "income"))
    assert status["income"].state == "approved"
    assert status["income"].approved_by == "finance@example.com"
    assert status["income"].locked_at is None
    assert status["tiers"].state == "draft"


def test_status_json_round_trips() -> None:
    status = _lock(_approved(), "income")
    raw = status_to_json(status)
    assert raw["income"]["state"] == "locked"
    assert status_from_json(raw) == status


@pytest.mark.parametrize("raw", [None, {}, {"income": {"state": "approved"}}])
def test_a_missing_status_raises_and_never_means_all_draft(raw: dict[str, object] | None) -> None:
    # A record with no section_status (or one missing sections) used to load as
    # all-draft, silently un-approving and UN-LOCKING what the board had signed off.
    with pytest.raises(SectionStatusMissingError):
        status_from_json(raw)


def test_an_empty_entry_raises_like_a_missing_one() -> None:
    # {"income": {}} used to validate as SectionStatus() (all fields default) and
    # load as draft -- the same silent un-approval a missing entry would cause.
    raw = status_to_json(_lock(_approved(), "income"))
    raw["income"] = {}
    with pytest.raises(SectionStatusMissingError, match="income"):
        status_from_json(raw)


# --- I3 (final review): an edit elsewhere must not leave an approved/locked section invalid ---


def _without_teen_table() -> AidRules:
    doc = fictional_rules_json()
    del doc["award_tables"]["teen"]
    return AidRules.model_validate(doc)


def test_an_approved_section_an_edit_elsewhere_breaks_goes_back_to_draft() -> None:
    old = fictional_rules()
    status = _approved("programs")
    new = _without_teen_table()  # programs.teen.r1_table now names no table
    outcome = apply_edit(old, new, status, before=validate_rules(old), after=validate_rules(new))
    assert outcome.status["programs"].state == "draft"
    assert outcome.reverted == ["programs"]


def test_an_edit_that_would_break_a_locked_section_is_refused() -> None:
    old = fictional_rules()
    status = _lock(_approved("award_tables"), "award_tables")
    bands = [*old.model_dump(mode="json")["tiers"]["bands"], {"lower": "300001"}]
    new = with_lever(old, "tiers.bands", bands)  # the camp table no longer covers every band
    with pytest.raises(LockedSectionInvalidatedError) as caught:
        apply_edit(old, new, status, before=validate_rules(old), after=validate_rules(new))
    assert caught.value.sections == ["award_tables"]
    assert "award_tables" in str(caught.value)


def test_a_no_op_save_does_not_revert_an_approved_section_with_a_pre_existing_error() -> None:
    # Mirrors test_a_locked_section_that_already_had_an_error_does_not_block_unrelated_edits,
    # but for "approved": a save that changes nothing must not un-approve a section over
    # an error it already carried before the save (e.g. a session synced later).
    old = with_lever(fictional_rules(), "programs.teen.r1_table", "gone")
    status = _approved("programs")
    new = old  # no-op save
    outcome = apply_edit(old, new, status, before=validate_rules(old), after=validate_rules(new))
    assert outcome.status["programs"].state == "approved"
    assert outcome.reverted == []


def test_a_locked_section_that_already_had_an_error_does_not_block_unrelated_edits() -> None:
    # "Would GAIN errors": an error the locked section already carried (for example a
    # session synced after the lock) is not this edit's doing.
    old = with_lever(fictional_rules(), "programs.teen.r1_table", "gone")
    approved = _approved("programs")
    status = {**approved, "programs": approved["programs"].model_copy(update={"state": "locked", "locked_at": AT})}
    new = with_lever(old, "income.medical_threshold", "4500")
    outcome = apply_edit(old, new, status, before=validate_rules(old), after=validate_rules(new))
    assert outcome.status["programs"].state == "locked"


def test_lock_refuses_while_the_document_has_errors_anywhere() -> None:
    broken = with_lever(fictional_rules(), "budget.pools.camp_pool.share_pct", "79")
    with pytest.raises(DocumentHasErrorsError, match="budget"):
        lock(_approved("income"), "income", at=AT, report=validate_rules(broken))


def test_every_lifecycle_refusal_is_a_financial_aid_error() -> None:
    for error in (
        LockedSectionError,
        LockedSectionInvalidatedError,
        SectionHasErrorsError,
        SectionNotApprovedError,
        DocumentHasErrorsError,
        SectionStatusMissingError,
    ):
        assert issubclass(error, FinancialAidError), error
