"""FinancialAidRulesService over an in-memory store, and AidRulesRepository over a mocked PocketBase."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from api.services.financial_aid_rules_effect import ApprovalEffect
from api.services.financial_aid_rules_service import (
    PAGE_SIZE,
    PRICING_SECTIONS,
    AidRulesRepository,
    FinancialAidRulesService,
    NoSectionsNamedError,
    NotLatestVersionError,
    RulesHistoryIncompleteError,
    RulesNotFoundError,
    VersionExistsError,
    YearMismatchError,
    _dump,
    _stored,
    _to_version,
)
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules import AidRules, SectionName, SessionRef
from bunking.financial_aid.rules.lifecycle import (
    DocumentHasErrorsError,
    LockedSectionError,
    LockedSectionInvalidatedError,
    SectionHasErrorsError,
    SectionNotApprovedError,
    SectionStatusMissingError,
    initial_status,
    status_to_json,
)
from bunking.pocketbase_batch import BatchRequestFailedError
from tests.unit.api.services.rules_fakes import FakeStore
from tests.unit.bunking.financial_aid.fixtures import (
    FICTIONAL_SESSION_IDS,
    fictional_rules,
    fictional_rules_json,
    with_lever,
)

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)
FINANCE = "finance@example.com"


def _service(store: FakeStore | None = None) -> FinancialAidRulesService:
    return FinancialAidRulesService(store or FakeStore(), clock=lambda: AT)


@pytest.mark.asyncio
async def test_versions_number_from_one_within_a_year() -> None:
    service = _service()
    first = await service.create_version(fictional_rules(), actor=FINANCE)
    second = await service.create_version(fictional_rules(), actor=FINANCE)
    assert (first.version, second.version) == (1, 2)
    assert (await service.load(2031)).version == 2
    assert (await service.load(2031, 1)).record_id == first.record_id
    assert {s.state for s in first.section_status.values()} == {"draft"}


@pytest.mark.asyncio
async def test_bootstrap_creates_version_one_for_an_empty_season() -> None:
    store = FakeStore()
    service = _service(store)
    created = await service.bootstrap(fictional_rules(), actor=FINANCE)
    assert created.version == 1
    assert {s.state for s in created.section_status.values()} == {"draft"}
    [operation] = store.operations
    assert [r["action"] for r in operation] == ["create"]


@pytest.mark.asyncio
async def test_bootstrap_refuses_a_season_that_already_has_rules() -> None:
    store = FakeStore()
    service = _service(store)
    await service.bootstrap(fictional_rules(), actor=FINANCE)
    written = len(store.operations)
    # The whole-document PUT is retired (queue 23), so the refusal points at the section editor.
    with pytest.raises(VersionExistsError, match="2031 already has aid rules; edit them in the section editor instead"):
        await service.bootstrap(fictional_rules(), actor=FINANCE)
    assert len(store.operations) == written
    assert (await service.load(2031)).version == 1


@pytest.mark.asyncio
async def test_a_stored_document_comes_back_equal() -> None:
    # (Review Focus) Through JSON the Decimals are strings and tier keys are string keys.
    store = FakeStore()
    service = _service(store)
    created = await service.create_version(fictional_rules(), actor=FINANCE)
    assert store.rows[0].document["award_tables"]["camp"]["tiers"]["2"]["r1_pct"] == "75"
    assert (await service.load(2031, created.version)).document == fictional_rules()


@pytest.mark.asyncio
async def test_loading_what_is_not_there_raises() -> None:
    service = _service()
    with pytest.raises(RulesNotFoundError):
        await service.load(2031)
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(RulesNotFoundError):
        await service.load(2031, 9)


@pytest.mark.asyncio
async def test_saving_an_approved_section_sends_it_back_to_draft() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note="Board, Jan 15")
    changed = with_lever(fictional_rules(), "income.medical_threshold", "4500")
    saved, report = await service.save(2031, 1, changed, actor=FINANCE)
    assert saved.section_status["income"].state == "draft"
    assert saved.document == changed
    assert report.ok


@pytest.mark.asyncio
async def test_saving_over_a_locked_section_is_refused_and_writes_nothing() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    with pytest.raises(LockedSectionError):
        await service.save(2031, 1, with_lever(fictional_rules(), "income.medical_threshold", "4500"), actor=FINANCE)
    assert (await service.load(2031, 1)).document == fictional_rules()


@pytest.mark.asyncio
async def test_a_draft_with_errors_saves_and_reports_them() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    broken = with_lever(fictional_rules(), "budget.pools.camp_pool.share_pct", "79")
    saved, report = await service.save(2031, 1, broken, actor=FINANCE)
    assert saved.document == broken
    assert "pool_shares_not_100" in report.codes()


@pytest.mark.asyncio
async def test_a_document_for_another_year_is_refused() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(YearMismatchError):
        await service.save(2032, 1, fictional_rules(), actor=FINANCE)


@pytest.mark.asyncio
async def test_approval_validates_against_the_seasons_sessions() -> None:
    sessions = [SessionRef(cm_id=s) for s in FICTIONAL_SESSION_IDS] + [SessionRef(cm_id=1000999, session_type="hebrew")]
    service = _service(FakeStore(sessions))
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(SectionHasErrorsError, match="programs"):
        await service.approve_section(2031, 1, "programs", actor=FINANCE, note=None)
    approved, _ = await service.approve_section(2031, 1, "income", actor=FINANCE, note="Board, Jan 15")
    income = approved.section_status["income"]
    assert (income.state, income.approved_by, income.approved_at, income.note) == (
        "approved",
        FINANCE,
        AT,
        "Board, Jan 15",
    )


@pytest.mark.asyncio
async def test_approving_several_sections_is_one_operation_naming_the_body() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    approved, _ = await service.approve_sections(
        2031, 1, ["programs", "cost", "programs"], actor=FINANCE, note="Finance, Oct 7 meeting"
    )
    assert (approved.section_status["programs"].state, approved.section_status["cost"].state) == (
        "approved",
        "approved",
    )
    assert approved.section_status["programs"].note == "Finance, Oct 7 meeting"
    [operation] = store.operations[1:]
    assert [r["entity_id"] for r in operation] == ["2031:1:programs", "2031:1:cost"]  # duplicates once, in order
    assert {r["action"] for r in operation} == {"approve"}
    assert {r["reason"] for r in operation} == {"Finance, Oct 7 meeting"}
    assert len({r["operation_id"] for r in operation}) == 1
    # Each row carries only its own section's change.
    assert set(operation[1]["after"]["section_status"]) == {"cost"}


@pytest.mark.asyncio
async def test_if_one_section_cannot_be_approved_none_is() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    # Pools summing to other than 100% is a budget error; income is clean.
    await service.save(2031, 1, with_lever(fictional_rules(), "budget.pools.camp_pool.share_pct", "79"), actor=FINANCE)
    written = len(store.operations)
    with pytest.raises(SectionHasErrorsError, match="budget"):
        await service.approve_sections(2031, 1, ["income", "budget"], actor=FINANCE, note="Finance")
    assert len(store.operations) == written
    assert (await service.load(2031, 1)).section_status["income"].state == "draft"


@pytest.mark.asyncio
async def test_approving_no_sections_is_refused() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(NoSectionsNamedError):
        await service.approve_sections(2031, 1, [], actor=FINANCE, note="Finance")


@pytest.mark.asyncio
async def test_only_an_approved_section_locks() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(SectionNotApprovedError):
        await service.lock_section(2031, 1, "income", actor=FINANCE)


@pytest.mark.asyncio
async def test_locking_an_already_locked_section_is_a_no_op() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    written = len(store.operations)
    relocked = await service.lock_section(2031, 1, "income", actor=FINANCE)
    assert len(store.operations) == written
    assert relocked.section_status["income"].state == "locked"


@pytest.mark.asyncio
async def test_a_new_version_copies_the_document_and_keeps_approvals_and_locks() -> None:
    # Changed specification (staff call 2026-09-25): a mid-season version keeps every lock
    # it is not told to lift, so re-setting Round 2 never re-opens Round 1.
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    for section in ("income", "tiers"):
        await service.approve_section(2031, 1, section, actor=FINANCE, note=None)
        await service.lock_section(2031, 1, section, actor=FINANCE)
    created = await service.new_version(2031, 1, actor=FINANCE)
    assert (created.version, created.parent_year, created.parent_version) == (2, 2031, 1)
    assert created.document == fictional_rules()
    assert created.section_status["income"].state == "locked"
    assert created.section_status["equity"].state == "draft"
    unlocked = await service.new_version(2031, 2, actor=FINANCE, unlock=["income"])
    assert (unlocked.section_status["income"].state, unlocked.section_status["tiers"].state) == ("approved", "locked")


@pytest.mark.asyncio
async def test_start_from_last_year() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    started, _ = await service.start_from_last_year(2032, actor=FINANCE)
    assert (started.year, started.version, started.parent_year, started.parent_version) == (2032, 1, 2031, 1)
    assert started.document.year == 2032
    assert started.document.income == fictional_rules().income
    assert started.document.milestones.r1_run is None  # dates belong to a season
    assert {s.state for s in started.section_status.values()} == {"draft"}  # a new season needs the board again
    # start_from_last_year is a write too, and is logged like the rest.
    [row] = store.operations[-1]
    assert (row["action"], row["entity_id"]) == ("start_from_last_year", "2032:1")
    with pytest.raises(VersionExistsError):
        await service.start_from_last_year(2032, actor=FINANCE)
    with pytest.raises(RulesNotFoundError):
        await service.start_from_last_year(2040, actor=FINANCE)


@pytest.mark.asyncio
async def test_every_write_commits_with_its_log_row() -> None:
    store = FakeStore()
    service = _service(store)
    changed = with_lever(fictional_rules(), "income.medical_threshold", "4500")
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.save(2031, 1, changed, actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    await service.new_version(2031, 1, actor=FINANCE)
    # One operation per write, one log row each, all in aid_rules, all by the signed-in person.
    assert [len(op) for op in store.operations] == [1, 1, 1, 1, 1]
    rows = [op[0] for op in store.operations]
    assert [r["action"] for r in rows] == ["create", "save", "approve", "lock", "new_version"]
    assert [r["entity_id"] for r in rows] == ["2031:1", "2031:1", "2031:1:income", "2031:1:income", "2031:2"]
    assert {r["entity"] for r in rows} == {"aid_rules"}
    assert {r["actor"] for r in rows} == {FINANCE}
    assert len({r["operation_id"] for r in rows}) == 5
    # A save logs only what changed: the one lever, not the whole document.
    assert rows[1]["after"] == {"document": {"income": {"medical_threshold": "4500"}}}
    assert rows[1]["before"] == {"document": {"income": {"medical_threshold": "4000"}}}
    # An approval logs the section's status moving from draft to approved, by whom.
    approved = rows[2]["after"]["section_status"]["income"]
    assert (rows[2]["before"]["section_status"]["income"]["state"], approved["state"]) == ("draft", "approved")
    assert approved["approved_by"] == FINANCE
    assert rows[3]["after"]["section_status"]["income"]["state"] == "locked"


# --- Ruling P3: writes to a superseded version are refused ------------------------------


@pytest.mark.asyncio
async def test_saving_a_superseded_version_is_refused() -> None:
    service = _service()
    first = await service.create_version(fictional_rules(), actor=FINANCE)
    await service.create_version(fictional_rules(), actor=FINANCE)  # version 2 is now latest
    with pytest.raises(NotLatestVersionError, match="latest version"):
        await service.save(
            2031, first.version, with_lever(fictional_rules(), "income.medical_threshold", "4500"), actor=FINANCE
        )


@pytest.mark.asyncio
async def test_approving_a_section_on_a_superseded_version_is_refused() -> None:
    service = _service()
    first = await service.create_version(fictional_rules(), actor=FINANCE)
    await service.create_version(fictional_rules(), actor=FINANCE)  # version 2 is now latest
    with pytest.raises(NotLatestVersionError, match="latest version"):
        await service.approve_section(2031, first.version, "income", actor=FINANCE, note=None)


@pytest.mark.asyncio
async def test_locking_a_section_on_a_superseded_version_is_refused() -> None:
    service = _service()
    first = await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, first.version, "income", actor=FINANCE, note=None)
    await service.create_version(fictional_rules(), actor=FINANCE)  # version 2 is now latest
    with pytest.raises(NotLatestVersionError, match="latest version"):
        await service.lock_section(2031, first.version, "income", actor=FINANCE)


@pytest.mark.asyncio
async def test_new_version_may_branch_from_an_older_version_and_becomes_latest() -> None:
    service = _service()
    first = await service.create_version(fictional_rules(), actor=FINANCE)
    await service.create_version(fictional_rules(), actor=FINANCE)  # version 2
    branched = await service.new_version(2031, first.version, actor=FINANCE)
    assert (branched.version, branched.parent_year, branched.parent_version) == (3, 2031, first.version)
    assert (await service.load(2031)).version == branched.version


# --- the repository -------------------------------------------------------------------


def _pb(rows: list[Any] | None = None) -> MagicMock:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = rows or []
    return pb


@pytest.mark.asyncio
async def test_list_versions_is_year_scoped_ordered_and_paged_with_a_stable_sort() -> None:
    pb = _pb()
    await AidRulesRepository(pb).list_versions(2031)
    pb.collection.assert_called_with("aid_rules")
    kwargs = pb.collection.return_value.get_full_list.call_args.kwargs
    assert kwargs["batch"] == PAGE_SIZE
    assert kwargs["query_params"] == {"filter": "year = 2031", "sort": "version,id"}


@pytest.mark.asyncio
async def test_fetch_version_filters_on_year_and_version() -> None:
    pb = _pb([SimpleNamespace(id="rec1")])
    row = await AidRulesRepository(pb).fetch_version(2031, 2)
    assert row is not None
    assert row.id == "rec1"
    params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert params["filter"] == "year = 2031 && version = 2"


@pytest.mark.asyncio
async def test_session_refs_come_from_the_seasons_camp_sessions() -> None:
    pb = _pb(
        [
            SimpleNamespace(cm_id=1000101, session_type="main", name="Session A"),
            SimpleNamespace(cm_id=1000201, session_type="", name=""),
        ]
    )
    refs = await AidRulesRepository(pb).fetch_session_refs(2031)
    pb.collection.assert_called_with("camp_sessions")
    params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert params["filter"] == "year = 2031"
    assert params["sort"].split(",")[-1] == "id"
    assert refs == [
        SessionRef(cm_id=1000101, session_type="main", name="Session A"),
        SessionRef(cm_id=1000201, session_type=None, name=None),
    ]


def _batch_failure(field_errors: dict[str, str]) -> BatchRequestFailedError:
    return BatchRequestFailedError(
        index=0,
        total=2,
        request=None,
        status=400,
        message="Failed to create record.",
        field_errors=field_errors,
        response=None,
    )


_A_CREATE = [AidWrite(collection="aid_rules", action="create", year=2031, data={"year": 2031, "version": 1})]


@pytest.mark.asyncio
async def test_commit_sends_the_writes_through_commit_aid_writes() -> None:
    pb = MagicMock()
    result = AidOperationResult(operation_id="a" * 15, record_ids=("r" * 15,), records=(None,), batches=1)
    with patch("api.services.financial_aid_rules_service.commit_aid_writes", return_value=result) as commit:
        assert await AidRulesRepository(pb).commit(_A_CREATE, actor=FINANCE, reason="Finance, Oct 7") is result
    commit.assert_called_once_with(pb, _A_CREATE, actor=FINANCE, reason="Finance, Oct 7")


@pytest.mark.asyncio
async def test_commit_maps_a_unique_index_collision_to_version_exists_error() -> None:
    failure = _batch_failure({"year": "Value must be unique.", "version": "Value must be unique."})
    with patch("api.services.financial_aid_rules_service.commit_aid_writes", side_effect=failure):
        with pytest.raises(VersionExistsError) as exc_info:
            await AidRulesRepository(MagicMock()).commit(_A_CREATE, actor=FINANCE)
    assert "2031" in str(exc_info.value)
    assert "version 1" in str(exc_info.value)


@pytest.mark.asyncio
async def test_commit_reraises_any_other_batch_failure() -> None:
    failure = _batch_failure({"document": "Must be no more than 2000000 bytes."})
    with patch("api.services.financial_aid_rules_service.commit_aid_writes", side_effect=failure):
        with pytest.raises(BatchRequestFailedError):
            await AidRulesRepository(MagicMock()).commit(_A_CREATE, actor=FINANCE)


@pytest.mark.asyncio
async def test_a_read_only_repository_refuses_to_write() -> None:
    with patch("api.services.financial_aid_rules_service.commit_aid_writes") as commit:
        with pytest.raises(RuntimeError, match="only reads aid_rules"):
            await AidRulesRepository(MagicMock(), read_only=True).commit(_A_CREATE, actor=FINANCE)
    commit.assert_not_called()


# --- Fix round 1, item 5: a document/section_status field may arrive as a JSON string --------


def test_to_version_accepts_a_document_and_section_status_that_arrive_as_json_strings() -> None:
    # Mirrors lodging_write_service._json_list's reasoning: the SDK hands back native
    # dicts, but a mock repository -- or a differently-configured client -- can still
    # hand back the raw serialised column instead.
    row = SimpleNamespace(
        id="rec1",
        year=2031,
        version=1,
        document=json.dumps(fictional_rules_json()),
        section_status=json.dumps(status_to_json(initial_status())),
        parent_year=0,
        parent_version=0,
    )
    version = _to_version(row)
    assert version.document == fictional_rules()
    assert {s.state for s in version.section_status.values()} == {"draft"}


# --- final review: a missing section_status never means all-draft --------------------------


@pytest.mark.parametrize("section_status", [None, "", "{}", {}])
def test_a_record_with_no_section_status_raises_on_load(section_status: Any) -> None:
    row = SimpleNamespace(
        id="rec1",
        year=2031,
        version=1,
        document=fictional_rules_json(),
        section_status=section_status,
        parent_year=0,
        parent_version=0,
    )
    with pytest.raises(SectionStatusMissingError):
        _to_version(row)


# --- I3 (final review): an edit elsewhere must not leave an approved/locked section invalid ---


def _without_teen_table() -> AidRules:
    doc = fictional_rules_json()
    del doc["award_tables"]["teen"]
    return AidRules.model_validate(doc)


@pytest.mark.asyncio
async def test_an_approved_section_an_edit_breaks_returns_to_draft_and_is_logged() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "programs", actor=FINANCE, note="Board, Jan 15")
    # Renaming a table away: programs.teen.r1_table now names no table (unknown_table).
    saved, report = await service.save(2031, 1, _without_teen_table(), actor=FINANCE)
    assert "unknown_table" in {i.code for i in report.errors_in("programs")}
    assert saved.section_status["programs"].state == "draft"
    # The revert is in the save's own row (4a pairs every log row with a record write).
    [row] = store.operations[-1]
    assert row["action"] == "save"
    assert row["before"]["section_status"]["programs"]["state"] == "approved"
    assert row["after"]["section_status"]["programs"]["state"] == "draft"


@pytest.mark.asyncio
async def test_a_save_that_would_break_a_locked_section_is_refused() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "award_tables", actor=FINANCE, note=None)
    await service.lock_section(2031, 1, "award_tables", actor=FINANCE)
    bands = [*fictional_rules_json()["tiers"]["bands"], {"lower": "300001"}]
    with pytest.raises(LockedSectionInvalidatedError, match="award_tables"):
        await service.save(2031, 1, with_lever(fictional_rules(), "tiers.bands", bands), actor=FINANCE)
    assert (await service.load(2031, 1)).document == fictional_rules()


@pytest.mark.asyncio
async def test_lock_is_refused_while_the_document_has_errors_elsewhere() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    await service.save(2031, 1, with_lever(fictional_rules(), "budget.pools.camp_pool.share_pct", "79"), actor=FINANCE)
    with pytest.raises(DocumentHasErrorsError, match="budget"):
        await service.lock_section(2031, 1, "income", actor=FINANCE)
    assert (await service.load(2031, 1)).section_status["income"].state == "approved"


@pytest.mark.asyncio
async def test_lock_writes_lock_approved_sections_for_the_caller_to_commit() -> None:
    """Sub-project 10a: a round's first Posted tick locks the sections it read, in the tick's own
    operation, so lock_writes returns the writes and commits nothing itself."""
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, ["income", "tiers"], actor=FINANCE, note="Finance committee")
    committed = len(store.operations)
    writes, not_locked = await service.lock_writes(2031, 1, ["tiers", "income", "round2"])
    assert len(store.operations) == committed
    assert [w.entity_id for w in writes] == ["2031:1:income", "2031:1:tiers"]
    assert not_locked == ["round2"]  # still a draft, so it can't lock
    await store.commit(writes, actor=FINANCE)
    status = (await service.load(2031, 1)).section_status
    assert (status["income"].state, status["tiers"].state, status["round2"].state) == ("locked", "locked", "draft")


@pytest.mark.asyncio
async def test_lock_writes_skip_a_locked_section() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, ["income", "tiers"], actor=FINANCE, note="Finance committee")
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    assert await service.lock_writes(2031, 1, ["income"]) == ([], [])


@pytest.mark.asyncio
async def test_lock_writes_report_sections_they_cannot_lock_while_the_rules_have_an_error() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    await service.save(2031, 1, with_lever(fictional_rules(), "budget.pools.camp_pool.share_pct", "79"), actor=FINANCE)
    assert await service.lock_writes(2031, 1, ["income"]) == ([], ["income"])


# --- final review minors -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_approving_with_no_synced_sessions_warns_instead_of_skipping() -> None:
    service = _service(FakeStore(sessions=[]))
    await service.create_version(fictional_rules(), actor=FINANCE)
    approved, report = await service.approve_section(2031, 1, "programs", actor=FINANCE, note=None)
    assert approved.section_status["programs"].state == "approved"
    assert "no_sessions_to_check" in {w.code for w in report.warnings}


@pytest.mark.asyncio
async def test_the_approval_note_is_the_log_rows_reason() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.save(2031, 1, with_lever(fictional_rules(), "income.medical_threshold", "4500"), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note="Board, Jan 15")
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    assert [(op[0]["action"], op[0]["reason"]) for op in store.operations] == [
        ("create", ""),
        ("save", ""),
        ("approve", "Board, Jan 15"),
        ("lock", ""),
    ]


@pytest.mark.asyncio
async def test_a_save_that_changes_nothing_writes_nothing() -> None:
    """Re-running a load PUTs the same document again: that must answer, not 500
    (change_row refuses a change that changes nothing)."""
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note="Board, Jan 15")
    written = len(store.operations)
    saved, report = await service.save(2031, 1, fictional_rules(), actor=FINANCE)
    assert len(store.operations) == written
    assert saved.section_status["income"].state == "approved"
    assert not report.errors


@pytest.mark.asyncio
async def test_start_from_last_year_clears_prices_and_warns() -> None:
    # CampMinder reuses session ids across years, so last year's price keyed by a
    # session id would silently price this year's session of the same id.
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    started, report = await service.start_from_last_year(2032, actor=FINANCE)
    assert (started.document.cost.tuition, started.document.cost.family_rates) == ({}, [])
    assert started.document.cost.override_reasons == fictional_rules().cost.override_reasons
    warning = next(w for w in report.warnings if w.code == "prices_cleared_for_new_season")
    assert (warning.section, warning.path) == ("cost", "cost.tuition")


def test_every_service_refusal_is_a_financial_aid_error_and_pydantic_is_not() -> None:
    for error in (
        NoSectionsNamedError,
        NotLatestVersionError,
        RulesNotFoundError,
        VersionExistsError,
        YearMismatchError,
    ):
        assert issubclass(error, FinancialAidError), error
    assert not issubclass(ValidationError, FinancialAidError)


# --- latest_approved (Task 6: intake reads approved rules only) -------------------------


@pytest.mark.asyncio
async def test_latest_approved_is_none_until_every_named_section_is_approved() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    assert await service.latest_approved(2031, ("programs", "cost")) is None
    await service.approve_section(2031, 1, "programs", actor=FINANCE, note="Finance approved.")
    assert await service.latest_approved(2031, ("programs", "cost")) is None  # cost is still a draft
    await service.approve_section(2031, 1, "cost", actor=FINANCE, note="Finance approved.")
    found = await service.latest_approved(2031, ("programs", "cost"))
    assert found is not None
    assert found.version == 1


async def _knock_back_programs(
    service: FinancialAidRulesService, store: FakeStore, version: int, document: AidRules
) -> None:
    """Seed what a whole-document save once wrote: `document` stored on `version` with `programs` sent back to draft,
    logged as a "save". Written through the store because `save` now refuses this knock-back (ruling 1)."""
    current = await service.load(2031, version)
    status = {**current.section_status, "programs": initial_status()["programs"]}
    data = {"document": _dump(document), "section_status": status_to_json(status)}
    write = AidWrite(
        collection="aid_rules",
        action="update",
        year=2031,
        record_id=current.record_id,
        before=_stored(current),
        data=data,
        log_action="save",
        entity_id=f"2031:{version}",
        expected_revision=current.revision,
    )
    await store.commit([write], actor=FINANCE)


@pytest.mark.asyncio
async def test_latest_approved_skips_a_newer_version_whose_section_went_back_to_draft() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    for section in ("programs", "cost"):
        await service.approve_section(2031, 1, section, actor=FINANCE, note="Approved.")
    await service.new_version(2031, 1, actor=FINANCE)
    edited = with_lever(fictional_rules(), "programs.summer.label", "Summer, renamed")
    await _knock_back_programs(service, store, 2, edited)  # programs back to draft (`save` now refuses this)
    found = await service.latest_approved(2031, ("programs", "cost"))
    assert found is not None
    assert (found.version, found.document.programs["summer"].label) == (1, "Summer")
    await service.approve_section(2031, 2, "programs", actor=FINANCE, note="Approved again.")
    again = await service.latest_approved(2031, ("programs", "cost"))
    assert again is not None
    assert again.version == 2


@pytest.mark.asyncio
async def test_a_locked_section_counts_as_approved() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    for section in ("programs", "cost"):
        await service.approve_section(2031, 1, section, actor=FINANCE, note="Approved.")
    await service.lock_section(2031, 1, "programs", actor=FINANCE)
    found = await service.latest_approved(2031, ("programs", "cost"))
    assert found is not None
    assert found.section_status["programs"].state == "locked"


# --- approved_as_of (3c: the rules that priced a past date, replayed from the log) -----------

JAN, FEB, MAR = (datetime(2031, month, 15, 18, 0, tzinfo=UTC) for month in (1, 2, 3))
_PRICING: tuple[SectionName, ...] = ("programs", "cost")
DAY = timedelta(days=1)


class _Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def _label_in_order(store: FakeStore, *, reverse: bool) -> None:
    """Rows sharing an instant replay in id order, and the fake's ids are random, as PocketBase's are.
    Label them in commit order, or reversed, so a clash test meets both orders on every run."""
    last = len(store.log_rows) - 1
    store.log_rows = [
        dataclasses.replace(row, id=f"log{(last - n) if reverse else n:012d}") for n, row in enumerate(store.log_rows)
    ]


async def _made_jan_approved_feb() -> tuple[FinancialAidRulesService, FakeStore, _Clock]:
    clock = _Clock(JAN)
    store = FakeStore(clock=clock)
    service = FinancialAidRulesService(store, clock=clock)
    await service.create_version(fictional_rules(), actor=FINANCE)
    clock.now = FEB
    for section in _PRICING:
        await service.approve_section(2031, 1, section, actor=FINANCE, note="Approved.")
    return service, store, clock


@pytest.mark.asyncio
async def test_the_rules_as_of_a_date_are_the_version_approved_by_then() -> None:
    service, _, _ = await _made_jan_approved_feb()
    assert await service.approved_as_of(2031, _PRICING, JAN + DAY) is None  # made, not yet approved
    found = await service.approved_as_of(2031, _PRICING, FEB + DAY)
    assert found is not None
    assert (found.version, found.section_status["programs"].approved_at) == (1, FEB)


@pytest.mark.asyncio
async def test_a_re_approval_after_the_date_does_not_change_what_the_date_shows() -> None:
    service, _, clock = await _made_jan_approved_feb()
    clock.now = MAR
    await service.approve_section(2031, 1, "programs", actor=FINANCE, note="Approved again.")
    found = await service.approved_as_of(2031, _PRICING, FEB + DAY)
    assert found is not None
    assert found.section_status["programs"].approved_at == FEB


@pytest.mark.asyncio
@pytest.mark.parametrize("reverse", [False, True])
async def test_an_edit_after_the_date_does_not_change_the_document_the_date_shows(reverse: bool) -> None:
    service, store, clock = await _made_jan_approved_feb()
    clock.now = MAR
    renamed = with_lever(fictional_rules(), "programs.summer.label", "Summer, renamed")
    await _knock_back_programs(service, store, 1, renamed)  # `save` now refuses this knock-back (ruling 1)
    await service.approve_section(2031, 1, "programs", actor=FINANCE, note="Approved again.")
    _label_in_order(store, reverse=reverse)  # the save and the approval share March's instant
    then = await service.approved_as_of(2031, _PRICING, FEB + DAY)
    later = await service.approved_as_of(2031, _PRICING, MAR + DAY)
    assert then is not None
    assert later is not None
    assert (then.document.programs["summer"].label, later.document.programs["summer"].label) == (
        "Summer",
        "Summer, renamed",
    )


@pytest.mark.asyncio
async def test_a_version_made_after_the_date_never_prices_it() -> None:
    service, _, clock = await _made_jan_approved_feb()
    clock.now = MAR
    await service.new_version(2031, 1, actor=FINANCE)  # carries February's approvals
    before = await service.approved_as_of(2031, _PRICING, MAR - DAY)
    after = await service.approved_as_of(2031, _PRICING, MAR + DAY)
    assert before is not None
    assert after is not None
    assert (before.version, after.version) == (1, 2)


@pytest.mark.asyncio
async def test_a_version_whose_history_cannot_be_replayed_is_refused_not_skipped() -> None:
    service, store, _ = await _made_jan_approved_feb()
    store.log_rows = [r for r in store.log_rows if r.before is not None]  # lose the create
    with pytest.raises(RulesHistoryIncompleteError):
        await service.approved_as_of(2031, _PRICING, FEB + DAY)


APR = datetime(2031, 4, 15, 18, 0, tzinfo=UTC)
_PROGRAMS: tuple[SectionName, ...] = ("programs",)


@pytest.mark.asyncio
async def test_a_newer_version_with_no_log_at_all_is_refused_not_skipped() -> None:
    service, store, clock = await _made_jan_approved_feb()
    clock.now = MAR
    await service.new_version(2031, 1, actor=FINANCE)
    store.log_rows = [r for r in store.log_rows if not r.entity_id.startswith("2031:2")]
    with pytest.raises(RulesHistoryIncompleteError):
        await service.approved_as_of(2031, _PRICING, MAR + DAY)


@pytest.mark.asyncio
async def test_a_newer_version_whose_create_row_is_lost_is_refused_not_skipped() -> None:
    service, store, clock = await _made_jan_approved_feb()
    clock.now = MAR
    await service.new_version(2031, 1, actor=FINANCE)
    clock.now = APR
    # `save` now refuses this knock-back (ruling 1), so seed it through the store.
    await _knock_back_programs(service, store, 2, with_lever(fictional_rules(), "programs.summer.label", "Renamed"))
    store.log_rows = [r for r in store.log_rows if not (r.entity_id == "2031:2" and r.before is None)]
    for at in (MAR + DAY, APR + DAY):
        with pytest.raises(RulesHistoryIncompleteError):
            await service.approved_as_of(2031, _PRICING, at)


@pytest.mark.asyncio
async def test_a_locked_section_counts_as_approved_as_of_the_date() -> None:
    service, _, clock = await _made_jan_approved_feb()
    clock.now = MAR
    await service.lock_section(2031, 1, "programs", actor=FINANCE)
    found = await service.approved_as_of(2031, _PRICING, MAR + DAY)
    assert found is not None
    assert found.section_status["programs"].state == "locked"
    earlier = await service.approved_as_of(2031, _PRICING, FEB + DAY)
    assert earlier is not None
    assert earlier.section_status["programs"].state == "approved"


@pytest.mark.asyncio
@pytest.mark.parametrize("reverse", [False, True])
async def test_a_same_instant_clash_is_settled_from_a_later_row_not_from_the_record_now(reverse: bool) -> None:
    """Approval then edit-to-draft then re-approval, the first two in one instant (a save that sends
    the section back to draft, then an approval): the later row's `before` says what the clash left."""
    clock = _Clock(JAN)
    store = FakeStore(clock=clock)
    service = FinancialAidRulesService(store, clock=clock)
    await service.create_version(fictional_rules(), actor=FINANCE)
    day1, day5 = JAN + DAY, JAN + 5 * DAY
    clock.now = day1
    await service.approve_section(2031, 1, "programs", actor=FINANCE, note="Approved.")
    await service.save(2031, 1, with_lever(fictional_rules(), "programs.summer.label", "Renamed"), actor=FINANCE)
    clock.now = day5
    await service.approve_section(2031, 1, "programs", actor=FINANCE, note="Approved again.")
    _label_in_order(store, reverse=reverse)
    then = await service.approved_as_of(2031, _PROGRAMS, day1 + timedelta(hours=1))
    assert then is None  # the save sent programs back to draft within day 1
    now = await service.approved_as_of(2031, _PROGRAMS, day5 + DAY)
    assert now is not None
    assert now.section_status["programs"].approved_at == day5


@pytest.mark.asyncio
async def test_the_rules_as_of_several_dates_come_from_one_read_and_agree_with_each_date() -> None:
    """D16b: To place asks for the rules at the end of each posting day; one list and one log read answer
    them all (never a read per day), each exactly as approved_as_of would."""
    service, store, clock = await _made_jan_approved_feb()
    clock.now = MAR
    await service.new_version(2031, 1, actor=FINANCE)
    ats = (JAN + DAY, FEB + DAY, MAR + DAY)
    reads: list[str] = []
    list_versions, fetch_log = store.list_versions, store.fetch_log

    async def counted_list(year: int) -> list[Any]:
        reads.append("list_versions")
        return await list_versions(year)

    async def counted_log(year: int) -> list[Any]:
        reads.append("fetch_log")
        return await fetch_log(year)

    store.list_versions, store.fetch_log = counted_list, counted_log  # type: ignore[method-assign]
    found, unknown = await service.approved_as_of_each(2031, _PRICING, ats)
    assert reads == ["list_versions", "fetch_log"]
    assert unknown == frozenset()
    for at in ats:
        assert found[at] == await service.approved_as_of(2031, _PRICING, at)
    assert [found[at].version if found[at] is not None else None for at in ats] == [None, 1, 2]  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_a_date_whose_rules_history_cannot_be_replayed_is_named_not_answered() -> None:
    service, store, _ = await _made_jan_approved_feb()
    store.log_rows = [r for r in store.log_rows if r.before is not None]  # lose the create
    found, unknown = await service.approved_as_of_each(2031, _PRICING, (FEB + DAY,))
    assert (found, unknown) == ({}, frozenset({FEB + DAY}))


# --- An approval's recorded effect (Season › History back-end ask H3) --------------------------------------------


class _Effects:
    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[tuple[int, int, int]] = []
        self.error = error

    async def measure(self, year: int, before: int, after: int) -> ApprovalEffect:
        self.calls.append((year, before, after))
        if self.error is not None:
            raise self.error
        return ApprovalEffect(before, after, 41 if before != after else 0)


def _ticking_clock() -> Any:
    """Each log row one second after the last, as production's writes are: the effect row lands after the approval."""
    ticks = iter(AT + timedelta(seconds=n) for n in range(1, 1000))
    return lambda: next(ticks)


@pytest.mark.asyncio
async def test_an_approval_that_makes_a_version_price_the_season_records_its_effect_on_its_own_operation() -> None:
    store, effects = FakeStore(clock=_ticking_clock()), _Effects()
    service = FinancialAidRulesService(store, clock=lambda: AT, effects=effects)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(PRICING_SECTIONS), actor=FINANCE, note="Board, Jan 8")
    assert effects.calls == [(2031, 0, 1)]
    (row,) = store.recorded
    assert (row["entity"], row["entity_id"], row["action"], row["actor"], row["reason"]) == (
        "aid_rules_effect",
        "2031:1",
        "effect",
        FINANCE,
        "",
    )
    assert row["after"] == {"from_version": 0, "to_version": 1, "repriced": 41}
    assert row["operation_id"] == store.operations[-1][0]["operation_id"]  # the approval's own operation
    assert any(r.entity == "aid_rules_effect" for r in store.log_rows)  # it IS in the shared table...
    assert (
        await service.approved_as_of(2031, PRICING_SECTIONS, AT + timedelta(days=1))
    ) is not None  # ...the replay skips it


@pytest.mark.asyncio
async def test_an_approval_that_moves_no_pricing_records_a_zero_effect() -> None:
    store, effects = FakeStore(), _Effects()
    service = FinancialAidRulesService(store, clock=lambda: AT, effects=effects)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, ["programs"], actor=FINANCE, note="Finance")
    assert effects.calls == [(2031, 0, 0)]
    assert store.recorded[0]["after"] == {"from_version": 0, "to_version": 0, "repriced": 0}


@pytest.mark.asyncio
async def test_an_effect_that_fails_never_undoes_the_approval() -> None:
    """Review Focus 6: the approval has committed; a failed measure or record is logged, never raised."""
    for store, effects in (
        (FakeStore(), _Effects(error=RuntimeError("pricing failed"))),
        (FakeStore(), _Effects()),
    ):
        store.fail_record = effects.error is None
        service = FinancialAidRulesService(store, clock=lambda: AT, effects=effects)
        await service.create_version(fictional_rules(), actor=FINANCE)
        approved, _ = await service.approve_sections(2031, 1, list(PRICING_SECTIONS), actor=FINANCE, note="Board")
        assert approved.section_status["budget"].state == "approved"
        assert store.recorded == []
    # The before-read runs BEFORE the commit: a failure there must never fail the approval either.
    store, effects = FakeStore(), _Effects()
    service = FinancialAidRulesService(store, clock=lambda: AT, effects=effects)
    service._pricing_version = AsyncMock(side_effect=RuntimeError("read failed"))  # type: ignore[method-assign]
    await service.create_version(fictional_rules(), actor=FINANCE)
    approved, _ = await service.approve_sections(2031, 1, list(PRICING_SECTIONS), actor=FINANCE, note="Board")
    assert approved.section_status["budget"].state == "approved"
    assert (store.recorded, effects.calls) == ([], [])  # no effect, and nothing measured


class _SlowEffects(_Effects):
    async def measure(self, year: int, before: int, after: int) -> ApprovalEffect:
        await asyncio.sleep(1.0)
        return await super().measure(year, before, after)


@pytest.mark.asyncio
async def test_an_effect_that_measures_too_slowly_is_dropped_and_the_approval_answers_promptly(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The request waits on the effect, so a slow measure must not hold the answer to an approval that has committed."""
    from api.services import financial_aid_rules_service as module

    monkeypatch.setattr(module, "EFFECT_TIMEOUT_SECONDS", 0.05, raising=False)
    store, effects = FakeStore(), _SlowEffects()
    service = FinancialAidRulesService(store, clock=lambda: AT, effects=effects)
    await service.create_version(fictional_rules(), actor=FINANCE)
    started = time.monotonic()
    with caplog.at_level("WARNING"):
        approved, _ = await service.approve_sections(2031, 1, list(PRICING_SECTIONS), actor=FINANCE, note="Board")
    assert time.monotonic() - started < 0.5  # not the full second the measure takes
    assert approved.section_status["budget"].state == "approved"
    assert store.recorded == []
    assert "took too long" in caplog.text


@pytest.mark.asyncio
async def test_without_effects_an_approval_measures_and_records_nothing() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, list(PRICING_SECTIONS), actor=FINANCE, note="Board")
    assert store.recorded == []


@pytest.mark.asyncio
async def test_the_repository_records_a_log_only_row_and_a_read_only_one_refuses() -> None:
    pb = MagicMock()
    with patch("api.services.financial_aid_rules_service.record_change") as recorded:
        await AidRulesRepository(pb).record(
            entity="aid_rules_effect",
            entity_id="2031:1",
            year=2031,
            action="effect",
            after={"from_version": 0, "to_version": 1, "repriced": 0},
            actor=FINANCE,
            operation_id="a" * 15,
        )
    recorded.assert_called_once()
    assert recorded.call_args.kwargs["before"] is None
    assert recorded.call_args.kwargs["operation_id"] == "a" * 15
    with pytest.raises(RuntimeError, match="only reads"):
        await AidRulesRepository(pb, read_only=True).record(
            entity="aid_rules_effect",
            entity_id="2031:1",
            year=2031,
            action="effect",
            after={},
            actor=FINANCE,
            operation_id="a" * 15,
        )


@pytest.mark.asyncio
async def test_a_stored_status_with_a_stages_entry_loads_and_the_next_write_drops_it() -> None:
    """§9.9: status_from_json reads only SECTION_NAMES, so no backfill is needed."""
    store = FakeStore()
    service = FinancialAidRulesService(store, clock=lambda: AT)
    await service.create_version(fictional_rules(), actor=FINANCE)
    store.rows[0].section_status = {**store.rows[0].section_status, "stages": {"state": "approved"}}
    assert "stages" not in (await service.load(2031)).section_status
    await service.save_section(2031, 1, "awards", fictional_rules_json()["awards"] | {"minimum": "150"}, actor=FINANCE)
    assert "stages" not in store.rows[0].section_status
