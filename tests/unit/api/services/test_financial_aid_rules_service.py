"""FinancialAidRulesService over an in-memory store, and AidRulesRepository over a mocked PocketBase."""

from __future__ import annotations

import copy
import json
from collections.abc import Sequence
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from api.services.financial_aid_rules_service import (
    PAGE_SIZE,
    AidRulesRepository,
    FinancialAidRulesService,
    NoSectionsNamedError,
    NotLatestVersionError,
    RulesNotFoundError,
    VersionExistsError,
    YearMismatchError,
    _to_version,
)
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, change_row, new_operation_id, new_record_id
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.rules import AidRules, SessionRef
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
from tests.unit.bunking.financial_aid.fixtures import (
    FICTIONAL_SESSION_IDS,
    fictional_rules,
    fictional_rules_json,
    with_lever,
)

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)
FINANCE = "finance@example.com"


class FakeStore:
    """aid_rules in memory, written only through `commit`, the one write path (4a).

    Each committed operation is kept as the aid_change_log rows commit_aid_writes would write
    for it, built with the same `change_row`, so a write the real helper would refuse (a
    change that changes nothing) fails here too. An operation applies whole or not at all.
    """

    def __init__(self, sessions: list[SessionRef] | None = None) -> None:
        self.rows: list[SimpleNamespace] = []
        self.sessions = sessions if sessions is not None else [SessionRef(cm_id=s) for s in FICTIONAL_SESSION_IDS]
        self.operations: list[list[dict[str, Any]]] = []

    async def list_versions(self, year: int) -> list[Any]:
        return sorted((r for r in self.rows if r.year == year), key=lambda r: r.version)

    async def fetch_version(self, year: int, version: int) -> Any | None:
        return next((r for r in self.rows if r.year == year and r.version == version), None)

    async def fetch_session_refs(self, year: int) -> list[SessionRef]:
        return list(self.sessions)

    async def commit(self, writes: Sequence[AidWrite], *, actor: str, reason: str | None = None) -> AidOperationResult:
        operation_id = new_operation_id()
        staged = copy.deepcopy(self.rows)
        log: list[dict[str, Any]] = []
        ids: list[str] = []
        for write in writes:
            data = json.loads(json.dumps(dict(write.data or {})))
            if write.action == "create":
                if any(r.year == data["year"] and r.version == data["version"] for r in staged):
                    raise VersionExistsError("unique index (year, version)")
                record_id = write.record_id or new_record_id()
                staged.append(SimpleNamespace(id=record_id, **data))
                after: dict[str, Any] | None = data
            else:
                assert write.record_id is not None
                assert write.before is not None
                record_id = write.record_id
                row = next(r for r in staged if r.id == record_id)
                for key, value in data.items():
                    setattr(row, key, value)
                after = {**write.before, **data}
            log.append(
                change_row(
                    entity=write.collection,
                    entity_id=write.entity_id or record_id,
                    year=write.year,
                    action=write.log_action or write.action,
                    before=write.before,
                    after=after,
                    actor=actor,
                    reason=write.reason if write.reason is not None else reason,
                    operation_id=operation_id,
                )
            )
            ids.append(record_id)
        self.rows = staged
        self.operations.append(log)
        return AidOperationResult(
            operation_id=operation_id, record_ids=tuple(ids), records=tuple(None for _ in ids), batches=1
        )


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
    with pytest.raises(VersionExistsError):
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
async def test_lock_writes_skip_a_locked_section_and_a_superseded_version() -> None:
    store = FakeStore()
    service = _service(store)
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_sections(2031, 1, ["income", "tiers"], actor=FINANCE, note="Finance committee")
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    assert await service.lock_writes(2031, 1, ["income"]) == ([], [])
    await service.new_version(2031, 1, actor=FINANCE)
    assert await service.lock_writes(2031, 1, ["tiers"]) == ([], [])  # version 1 is read-only now


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


@pytest.mark.asyncio
async def test_latest_approved_skips_a_newer_version_whose_section_went_back_to_draft() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    for section in ("programs", "cost"):
        await service.approve_section(2031, 1, section, actor=FINANCE, note="Approved.")
    await service.new_version(2031, 1, actor=FINANCE)
    edited = with_lever(fictional_rules(), "programs.summer.label", "Summer, renamed")
    await service.save(2031, 2, edited, actor=FINANCE)  # an edit sends programs back to draft
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
