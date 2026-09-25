"""FinancialAidRulesService over an in-memory store, and AidRulesRepository over a mocked PocketBase."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_rules_service import (
    PAGE_SIZE,
    AidRulesRepository,
    FinancialAidRulesService,
    NotLatestVersionError,
    RulesNotFoundError,
    VersionExistsError,
    YearMismatchError,
)
from bunking.financial_aid.rules import SectionName, SessionRef
from bunking.financial_aid.rules.lifecycle import LockedSectionError, SectionHasErrorsError, SectionNotApprovedError
from tests.unit.bunking.financial_aid.fixtures import FICTIONAL_SESSION_IDS, fictional_rules, with_lever

AT = datetime(2031, 1, 15, 18, 0, tzinfo=UTC)
FINANCE = "finance@example.com"


class FakeStore:
    """aid_rules in memory. Bodies pass through JSON, as they do through PocketBase."""

    def __init__(self, sessions: list[SessionRef] | None = None) -> None:
        self.rows: list[SimpleNamespace] = []
        self.sessions = sessions if sessions is not None else [SessionRef(cm_id=s) for s in FICTIONAL_SESSION_IDS]

    async def list_versions(self, year: int) -> list[Any]:
        return sorted((r for r in self.rows if r.year == year), key=lambda r: r.version)

    async def fetch_version(self, year: int, version: int) -> Any | None:
        return next((r for r in self.rows if r.year == year and r.version == version), None)

    async def fetch_session_refs(self, year: int) -> list[SessionRef]:
        return list(self.sessions)

    async def create(self, body: dict[str, Any]) -> Any:
        if any(r.year == body["year"] and r.version == body["version"] for r in self.rows):
            raise ValueError("unique index (year, version)")
        row = SimpleNamespace(id=f"rec{len(self.rows) + 1:012d}", **json.loads(json.dumps(body)))
        self.rows.append(row)
        return row

    async def update(self, record_id: str, body: dict[str, Any]) -> Any:
        row = next(r for r in self.rows if r.id == record_id)
        for key, value in json.loads(json.dumps(body)).items():
            setattr(row, key, value)
        return row


class Recorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __call__(
        self,
        *,
        action: str,
        year: int,
        version: int,
        section: SectionName | None,
        record_id: str,
        actor: str,
        before: dict[str, Any] | None,
        after: dict[str, Any] | None,
    ) -> None:
        self.calls.append(
            {
                "action": action,
                "year": year,
                "version": version,
                "section": section,
                "record_id": record_id,
                "actor": actor,
            }
        )


def _service(store: FakeStore | None = None, recorder: Recorder | None = None) -> FinancialAidRulesService:
    return FinancialAidRulesService(store or FakeStore(), clock=lambda: AT, recorder=recorder or Recorder())


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
    approved = await service.approve_section(2031, 1, "income", actor=FINANCE, note="Board, Jan 15")
    income = approved.section_status["income"]
    assert (income.state, income.approved_by, income.approved_at, income.note) == (
        "approved",
        FINANCE,
        AT,
        "Board, Jan 15",
    )


@pytest.mark.asyncio
async def test_only_an_approved_section_locks() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    with pytest.raises(SectionNotApprovedError):
        await service.lock_section(2031, 1, "income", actor=FINANCE)


@pytest.mark.asyncio
async def test_a_new_version_copies_the_document_and_keeps_approvals_unlocked() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    await service.lock_section(2031, 1, "income", actor=FINANCE)
    created = await service.new_version(2031, 1, actor=FINANCE)
    assert (created.version, created.parent_year, created.parent_version) == (2, 2031, 1)
    assert created.document == fictional_rules()
    assert created.section_status["income"].state == "approved"
    assert created.section_status["tiers"].state == "draft"


@pytest.mark.asyncio
async def test_start_from_last_year() -> None:
    service = _service()
    await service.create_version(fictional_rules(), actor=FINANCE)
    await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    started = await service.start_from_last_year(2032, actor=FINANCE)
    assert (started.year, started.version, started.parent_year, started.parent_version) == (2032, 1, 2031, 1)
    assert started.document.year == 2032
    assert started.document.income == fictional_rules().income
    assert started.document.milestones.r1_run is None  # dates belong to a season
    assert {s.state for s in started.section_status.values()} == {"draft"}  # a new season needs the board again
    with pytest.raises(VersionExistsError):
        await service.start_from_last_year(2032, actor=FINANCE)
    with pytest.raises(RulesNotFoundError):
        await service.start_from_last_year(2040, actor=FINANCE)


@pytest.mark.asyncio
async def test_every_write_is_recorded() -> None:
    recorder = Recorder()
    service = _service(recorder=recorder)
    created = await service.create_version(fictional_rules(), actor=FINANCE)
    saved, _ = await service.save(
        2031, 1, with_lever(fictional_rules(), "income.medical_threshold", "4500"), actor=FINANCE
    )
    approved = await service.approve_section(2031, 1, "income", actor=FINANCE, note=None)
    locked = await service.lock_section(2031, 1, "income", actor=FINANCE)
    new_version = await service.new_version(2031, 1, actor=FINANCE)
    assert [c["action"] for c in recorder.calls] == ["create", "save", "approve", "lock", "new_version"]
    assert recorder.calls[2]["section"] == "income"
    assert {c["actor"] for c in recorder.calls} == {FINANCE}
    # (Ruling P19) The recorder carries the PocketBase record id of the version written --
    # the same record for save/approve/lock (all version 1), a new one for new_version.
    assert [c["record_id"] for c in recorder.calls] == [
        created.record_id,
        saved.record_id,
        approved.record_id,
        locked.record_id,
        new_version.record_id,
    ]
    assert new_version.record_id != created.record_id


# --- Ruling P1: the recorder is required ------------------------------------------------


def test_the_service_requires_a_recorder() -> None:
    with pytest.raises(TypeError):
        FinancialAidRulesService(FakeStore(), clock=lambda: AT)  # type: ignore[call-arg]


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


@pytest.mark.asyncio
async def test_create_and_update_go_to_aid_rules() -> None:
    pb = _pb()
    repo = AidRulesRepository(pb)
    await repo.create({"year": 2031})
    await repo.update("rec1", {"version": 2})
    pb.collection.return_value.create.assert_called_once_with({"year": 2031})
    pb.collection.return_value.update.assert_called_once_with("rec1", {"version": 2})
