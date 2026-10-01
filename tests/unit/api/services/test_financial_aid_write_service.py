"""Campership ledger writes (sub-project 4). Fictional data only.

Every write goes through sub-project 4a's commit_aid_writes. The tests spy on it
at its import site and assert on the AidWrites it receives; the spy runs the real
helper, so each AidWrite is validated as in production, and only the PocketBase
batch call is faked."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from api.schemas.financial_aid import (
    AidSourceUpdate,
    DispositionBulkLoad,
    DispositionRow,
    HouseholdLinkCreate,
    OverrideBulkLoad,
    OverrideRow,
    SourceGrantorIn,
)
from api.services.financial_aid_ledger_service import FinancialAidNotFoundError, FinancialAidValidationError
from api.services.financial_aid_write_service import FinancialAidWriteService
from bunking.financial_aid.change_log import CONFLICT_MESSAGE, AidWrite, AidWriteConflictError, commit_aid_writes
from bunking.pocketbase_batch import BatchRequest, BatchRequestFailedError, BatchResult

ACTOR = "finance@example.com"
SOURCE_ID = "src000000000001"
LINK_ID = "lnk000000000001"
OVERRIDE_ID = "ovr000000000001"
OVERRIDE_ID_3 = "ovr000000000003"
DISPOSITION_ID = "dsp000000000001"


def _source(**kw: Any) -> SimpleNamespace:
    base = {
        "id": SOURCE_ID,
        "description_key": "regional grant - north",
        "description": "Regional Grant - North",
        "source_name": "",
        "source_family": "unclassified",
        "funder_type": "unknown",
        "counts_as_aid": False,
        "counts_toward_budget": False,
        "grantor_key": "",
        "implied_program_families": [],
        "classified_by": "unclassified",
        "note": "",
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _link(**kw: Any) -> SimpleNamespace:
    base = {
        "id": LINK_ID,
        "year": 2026,
        "household_cm_id": 400,
        "family_key": "hh-100",
        "source": "auto",
        "excluded": False,
        "note": "",
        "actor": "",
    }
    base.update(kw)
    return SimpleNamespace(**base)


class _Spy:
    """commit_aid_writes spied at its import site, running the real helper over a fake batch."""

    def __init__(self) -> None:
        self.commit = MagicMock(wraps=commit_aid_writes)
        self.batches: list[list[BatchRequest]] = []

    def send_batch(self, pb: Any, requests: list[BatchRequest], *, max_requests: int) -> list[BatchResult]:
        self.batches.append(list(requests))
        return [BatchResult(status=200, body=dict(r.body) if r.body is not None else None) for r in requests]

    @property
    def writes(self) -> list[AidWrite]:
        return list(self.commit.call_args.args[1])

    @property
    def kwargs(self) -> dict[str, Any]:
        return dict(self.commit.call_args.kwargs)

    def log_rows(self) -> list[dict[str, Any]]:
        return [
            dict(r.body or {}) for batch in self.batches for r in batch if r.url.endswith("/aid_change_log/records")
        ]


def _service(repo: MagicMock) -> tuple[FinancialAidWriteService, _Spy]:
    spy = _Spy()
    patch("bunking.financial_aid.change_log.send_batch", side_effect=spy.send_batch).start()
    patch("api.services.financial_aid_write_service.commit_aid_writes", spy.commit).start()
    patch("api.services.financial_aid_write_service.current_season_year", AsyncMock(return_value=2026)).start()
    return FinancialAidWriteService(repo), spy


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


# --- sources ------------------------------------------------------------------


def _classification(**kw: Any) -> AidSourceUpdate:
    base: dict[str, Any] = {
        "source_name": "Regional grant",
        "source_family": "other_outside",
        "funder_type": "outside",
        "counts_as_aid": True,
        "counts_toward_budget": False,
        "implied_program_families": ["teen", "summer", "teen"],
        "note": "Confirmed with finance",
    }
    base.update(kw)
    return AidSourceUpdate(**base)


@pytest.mark.asyncio
async def test_classify_source_marks_it_staff_in_one_logged_write() -> None:
    repo = MagicMock()
    repo.get_source = AsyncMock(return_value=_source())
    service, spy = _service(repo)

    row = await service.classify_source(SOURCE_ID, _classification(), ACTOR)

    [write] = spy.writes
    assert (write.collection, write.action, write.record_id, write.year) == ("aid_sources", "update", SOURCE_ID, 2026)
    assert write.data is not None
    assert write.before is not None
    assert write.data["classified_by"] == "staff"
    assert write.data["implied_program_families"] == ["summer", "teen"]
    assert write.before["classified_by"] == "unclassified"
    assert spy.commit.call_args.args[0] is repo.pb
    assert (spy.kwargs["actor"], spy.kwargs["reason"], spy.kwargs["require_reason"]) == (
        ACTOR,
        "Confirmed with finance",
        True,
    )
    assert (row.id, row.classified_by, row.source_family, row.counts_toward_budget) == (
        SOURCE_ID,
        "staff",
        "other_outside",
        False,
    )


@pytest.mark.asyncio
async def test_the_write_and_its_log_row_go_in_one_batch_with_only_the_changed_fields() -> None:
    repo = MagicMock()
    repo.get_source = AsyncMock(return_value=_source())
    service, spy = _service(repo)

    await service.classify_source(SOURCE_ID, _classification(), ACTOR)

    [batch] = spy.batches
    assert [(r.method, r.url) for r in batch] == [
        ("PATCH", f"/api/collections/aid_sources/records/{SOURCE_ID}"),
        ("POST", "/api/collections/aid_change_log/records"),
    ]
    [log] = spy.log_rows()
    assert (log["entity"], log["entity_id"], log["action"], log["actor"]) == (
        "aid_sources",
        SOURCE_ID,
        "update",
        ACTOR,
    )
    assert log["reason"] == "Confirmed with finance"
    assert len(log["operation_id"]) == 15
    assert log["before"]["classified_by"] == "unclassified"
    assert log["after"]["classified_by"] == "staff"
    # counts_toward_budget stayed False: not logged.
    assert "counts_toward_budget" not in log["after"]


@pytest.mark.asyncio
async def test_an_unset_program_list_is_not_logged_as_a_change() -> None:
    repo = MagicMock()
    repo.get_source = AsyncMock(return_value=_source(implied_program_families=None))  # an unset json field
    service, spy = _service(repo)

    await service.classify_source(SOURCE_ID, _classification(implied_program_families=[]), ACTOR)

    [log] = spy.log_rows()
    assert "implied_program_families" not in log["after"]


@pytest.mark.asyncio
async def test_reclassifying_to_what_the_source_already_holds_writes_nothing() -> None:
    repo = MagicMock()
    repo.get_source = AsyncMock(
        return_value=_source(
            source_name="Regional grant",
            source_family="other_outside",
            funder_type="outside",
            counts_as_aid=True,
            implied_program_families=["summer", "teen"],
            classified_by="staff",
            note="Confirmed with finance",
        )
    )
    service, spy = _service(repo)

    row = await service.classify_source(SOURCE_ID, _classification(), ACTOR)

    spy.commit.assert_not_called()
    assert (row.classified_by, row.source_family) == ("staff", "other_outside")


@pytest.mark.asyncio
async def test_classify_source_unknown_id_is_not_found() -> None:
    repo = MagicMock()
    repo.get_source = AsyncMock(return_value=None)
    service, spy = _service(repo)
    with pytest.raises(FinancialAidNotFoundError):
        await service.classify_source("nope", _classification(), ACTOR)
    spy.commit.assert_not_called()


# --- links --------------------------------------------------------------------


def _link_repo(existing: list[SimpleNamespace]) -> MagicMock:
    repo = MagicMock()
    repo.fetch_links = AsyncMock(return_value=existing)
    repo.get_link = AsyncMock(return_value=None)
    return repo


@pytest.mark.asyncio
async def test_create_a_staff_merge_link() -> None:
    service, spy = _service(_link_repo([]))
    row = await service.create_link(
        HouseholdLinkCreate(year=2026, household_cm_id=600, family_key="hh-100", note="Same family"),
        ACTOR,
    )
    [write] = spy.writes
    assert (write.collection, write.action, write.year, write.before) == ("aid_household_links", "create", 2026, None)
    assert write.data == {
        "year": 2026,
        "household_cm_id": 600,
        "family_key": "hh-100",
        "source": "staff",
        "excluded": False,
        "note": "Same family",
        "actor": ACTOR,
    }
    assert (spy.kwargs["reason"], spy.kwargs["require_reason"]) == ("Same family", True)
    created = spy.batches[0][0].body
    assert created is not None
    assert row.id == created["id"]  # the id the helper generated for the create
    assert (row.source, row.excluded, row.actor) == ("staff", False, ACTOR)


@pytest.mark.asyncio
async def test_an_exclusion_converts_the_auto_row() -> None:
    service, spy = _service(_link_repo([_link()]))
    row = await service.create_link(
        HouseholdLinkCreate(year=2026, household_cm_id=400, family_key="hh-100", excluded=True, note="Not family"),
        ACTOR,
    )
    [write] = spy.writes
    assert (write.action, write.record_id) == ("update", LINK_ID)
    assert write.before is not None
    assert write.data is not None
    assert (write.before["source"], write.data["source"], write.data["excluded"]) == ("auto", "staff", True)
    assert (row.id, row.source, row.excluded) == (LINK_ID, "staff", True)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("existing", "excluded"),
    [
        ([_link(source="staff")], False),  # a second staff row
        ([_link()], False),  # duplicates the auto row
        ([], True),  # nothing to exclude
    ],
)
async def test_link_requests_that_change_nothing_are_refused(existing: list[SimpleNamespace], excluded: bool) -> None:
    service, spy = _service(_link_repo(existing))
    with pytest.raises(FinancialAidValidationError):
        await service.create_link(
            HouseholdLinkCreate(year=2026, household_cm_id=400, family_key="hh-100", excluded=excluded, note="n"), ACTOR
        )
    spy.commit.assert_not_called()


@pytest.mark.asyncio
async def test_only_staff_links_can_be_deleted() -> None:
    repo = _link_repo([])
    repo.get_link = AsyncMock(return_value=_link(source="auto"))
    service, spy = _service(repo)
    with pytest.raises(FinancialAidValidationError):
        await service.delete_link(LINK_ID, ACTOR, "wrong")
    spy.commit.assert_not_called()

    repo.get_link = AsyncMock(return_value=_link(source="staff"))
    await service.delete_link(LINK_ID, ACTOR, "merged by mistake")
    [write] = spy.writes
    assert (write.collection, write.action, write.record_id, write.data) == (
        "aid_household_links",
        "delete",
        LINK_ID,
        None,
    )
    assert write.before is not None
    assert write.before["source"] == "staff"
    assert spy.kwargs["reason"] == "merged by mistake"


# --- overrides ----------------------------------------------------------------


def _override_repo(existing: list[SimpleNamespace] | None = None) -> MagicMock:
    repo = MagicMock()
    repo.fetch_posting_transaction_ids = AsyncMock(return_value={9001, 9002, 9003, 9004, 9005, 9006})
    repo.fetch_session_ids = AsyncMock(return_value={11, 21})
    repo.fetch_sources = AsyncMock(
        return_value=[
            _source(
                id="src000000000002",
                description_key="example camp financial assistance",
                source_family="camp_fa",
                funder_type="camp",
                counts_as_aid=True,
                counts_toward_budget=True,
                classified_by="config_file",
            ),
            _source(
                id="src000000000003",
                description_key="outside program award (reclassified)",
                source_family="other_outside",
                funder_type="outside",
                counts_as_aid=True,
                classified_by="config_file",
            ),
            _source(id="src000000000004", description_key="mystery grant"),  # unclassified
        ]
    )
    repo.fetch_overrides = AsyncMock(return_value=existing or [])
    return repo


def _existing_override(**kw: Any) -> SimpleNamespace:
    base = {
        "id": OVERRIDE_ID,
        "transaction_cm_id": 9002,
        "year": 2026,
        "attributed_person_cm_id": 1001,
        "attributed_session_cm_id": 11,
        "program_family": "",
        "source_key_override": "",
        "source": "sheet_2026_match",
        "note": "",
        "actor": "x",
    }
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_load_overrides_creates_updates_skips_and_rejects_in_one_operation() -> None:
    repo = _override_repo(
        [
            _existing_override(),
            _existing_override(
                id=OVERRIDE_ID_3,
                transaction_cm_id=9003,
                program_family="teen",
                attributed_person_cm_id=0,
                attributed_session_cm_id=0,
            ),
        ]
    )
    service, spy = _service(repo)
    body = OverrideBulkLoad(
        year=2026,
        source="sheet_2026_match",
        reason="Reviewed 2026 attribution",
        rows=[
            OverrideRow(transaction_cm_id=9001, attributed_person_cm_id=1002, attributed_session_cm_id=21),
            OverrideRow(transaction_cm_id=9002, attributed_person_cm_id=1001, attributed_session_cm_id=21),  # moved
            OverrideRow(transaction_cm_id=9003, program_family="teen"),  # same
            OverrideRow(transaction_cm_id=9099, program_family="summer"),  # no posting
            OverrideRow(transaction_cm_id=9004, attributed_session_cm_id=99),  # bad session
        ],
    )

    got = await service.load_overrides(body, ACTOR)

    assert (got.created, got.updated, got.unchanged) == (1, 1, 1)
    assert [r.transaction_cm_id for r in got.rejected] == [9099, 9004]
    assert "no aid posting" in got.rejected[0].reason
    assert "session 99 does not exist" in got.rejected[1].reason
    spy.commit.assert_called_once()  # one staff action, one operation
    assert [(w.collection, w.action, w.record_id) for w in spy.writes] == [
        ("aid_attribution_overrides", "create", None),
        ("aid_attribution_overrides", "update", OVERRIDE_ID),
    ]
    created, moved = spy.writes
    assert created.data is not None
    assert (created.data["source"], created.data["actor"]) == ("sheet_2026_match", ACTOR)
    assert moved.before is not None
    assert moved.after is not None
    assert (moved.before["attributed_session_cm_id"], moved.after["attributed_session_cm_id"]) == (11, 21)
    assert "actor" not in moved.after  # the log's actor column says who; the diff is the placement
    assert (spy.kwargs["reason"], spy.kwargs["require_reason"]) == (
        "Reviewed 2026 attribution",
        True,
    )
    assert "allow_chunking" not in spy.kwargs  # a reviewed load is atomic, never chunked
    logs = spy.log_rows()
    assert len(spy.batches) == 1
    assert len(logs) == 2
    assert {row["operation_id"] for row in logs} == {got.operation_id}
    assert {row["reason"] for row in logs} == {"Reviewed 2026 attribution"}  # no row note: the load's reason


# Review Focus 7: outside money booked as camp aid is reclassified.
@pytest.mark.asyncio
async def test_a_reclassify_only_override_must_name_a_classified_aid_source() -> None:
    service, spy = _service(_override_repo())
    body = OverrideBulkLoad(
        year=2026,
        source="staff",
        reason="Outside money reclassified",
        rows=[
            OverrideRow(
                transaction_cm_id=9005,
                source_key_override="Outside Program Award (reclassified)",
                note="Outside money booked as camp aid",
            ),
            OverrideRow(transaction_cm_id=9006, source_key_override="no such source"),
            OverrideRow(transaction_cm_id=9001, source_key_override="mystery grant"),
        ],
    )

    got = await service.load_overrides(body, ACTOR)

    assert got.created == 1
    [write] = spy.writes
    assert write.after is not None
    assert (
        write.after["source_key_override"],
        write.after["attributed_person_cm_id"],
        write.after["program_family"],
    ) == (
        "outside program award (reclassified)",
        0,
        "",
    )  # stored normalized; places nothing
    assert write.reason == "Outside money booked as camp aid"  # the row's note is its own reason
    assert [(r.transaction_cm_id, r.reason) for r in got.rejected] == [
        (9006, "source 'no such source' is not in aid_sources"),
        (9001, "source 'mystery grant' is not classified as aid"),
    ]


@pytest.mark.asyncio
async def test_dry_run_writes_and_logs_nothing() -> None:
    service, spy = _service(_override_repo())
    body = OverrideBulkLoad(
        year=2026,
        source="staff",
        reason="r",
        dry_run=True,
        rows=[OverrideRow(transaction_cm_id=9001, program_family="summer")],
    )
    got = await service.load_overrides(body, ACTOR)
    assert (got.dry_run, got.created, got.operation_id) == (True, 1, None)
    spy.commit.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("dry_run", [False, True])
async def test_a_load_that_changes_more_rows_than_one_batch_holds_is_refused_whole(dry_run: bool) -> None:
    patch("api.services.financial_aid_write_service.MAX_ROWS_CHANGED_PER_LOAD", 1).start()
    service, spy = _service(_override_repo())
    body = OverrideBulkLoad(
        year=2026,
        source="staff",
        reason="r",
        dry_run=dry_run,
        rows=[
            OverrideRow(transaction_cm_id=9001, program_family="summer"),
            OverrideRow(transaction_cm_id=9002, program_family="teen"),
        ],
    )
    with pytest.raises(FinancialAidValidationError, match="split"):
        await service.load_overrides(body, ACTOR)
    spy.commit.assert_not_called()


# --- dispositions ------------------------------------------------------------


def _disposition_repo(existing: list[SimpleNamespace] | None = None) -> MagicMock:
    repo = MagicMock()
    repo.fetch_posting_transaction_ids = AsyncMock(return_value={9001, 9002})
    repo.fetch_dispositions = AsyncMock(return_value=existing or [])
    repo.get_disposition = AsyncMock(return_value=None)
    return repo


def _existing_disposition(**kw: Any) -> SimpleNamespace:
    base = {
        "id": DISPOSITION_ID,
        "year": 2026,
        "transaction_cm_id": 9002,
        "flag": "implied_program_mismatch",
        "disposition": "accepted_let_stand",
        "note": "Let stand",
        "actor": "x",
    }
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_load_dispositions_creates_updates_skips_and_rejects_in_one_operation() -> None:
    repo = _disposition_repo(
        [
            _existing_disposition(),
            _existing_disposition(id="dsp000000000002", flag="unclassified_source", note="Billed to the household"),
        ]
    )
    service, spy = _service(repo)
    body = DispositionBulkLoad(
        year=2026,
        rows=[
            DispositionRow(
                transaction_cm_id=9001,
                flag="live_aid_on_cancelled_enrollment",
                disposition="accepted_let_stand",
                note="Staff let it stand",
            ),
            DispositionRow(
                transaction_cm_id=9002,
                flag="implied_program_mismatch",
                disposition="accepted_late_grant",
                note="Grant arrived after the offer",
            ),  # changed
            DispositionRow(
                transaction_cm_id=9002,
                flag="unclassified_source",
                disposition="accepted_let_stand",
                note="Billed to the household",
            ),  # same
            DispositionRow(
                transaction_cm_id=9077, flag="implied_program_mismatch", disposition="accepted_other", note="n"
            ),
        ],
    )

    got = await service.load_dispositions(body, ACTOR)

    assert (got.created, got.updated, got.unchanged) == (1, 1, 1)
    assert [(r.transaction_cm_id, r.flag) for r in got.rejected] == [(9077, "implied_program_mismatch")]
    spy.commit.assert_called_once()
    assert [(w.collection, w.action, w.record_id, w.reason) for w in spy.writes] == [
        ("aid_flag_dispositions", "create", None, "Staff let it stand"),
        ("aid_flag_dispositions", "update", DISPOSITION_ID, "Grant arrived after the offer"),
    ]
    created = spy.writes[0]
    assert created.data is not None
    assert created.data["actor"] == ACTOR
    assert spy.kwargs["require_reason"] is True
    assert {row["operation_id"] for row in spy.log_rows()} == {got.operation_id}


@pytest.mark.asyncio
async def test_deleting_a_disposition_reopens_the_flag_and_is_logged() -> None:
    repo = _disposition_repo()
    service, spy = _service(repo)
    with pytest.raises(FinancialAidNotFoundError):
        await service.delete_disposition("nope", ACTOR, "r")
    spy.commit.assert_not_called()

    repo.get_disposition = AsyncMock(return_value=_existing_disposition())
    await service.delete_disposition(DISPOSITION_ID, ACTOR, "Recorded against the wrong posting")
    [write] = spy.writes
    assert (write.collection, write.action, write.record_id, write.year, write.data) == (
        "aid_flag_dispositions",
        "delete",
        DISPOSITION_ID,
        2026,
        None,
    )
    assert spy.kwargs["reason"] == "Recorded against the wrong posting"
    [log] = spy.log_rows()
    assert (log["action"], log["after"]) == ("delete", None)


# --- blank note / reason handling (fix round 1) -------------------------------
#
# A whitespace-only note is not a note. Without stripping at the schema, it is
# truthy, so it overrides the operation's required reason; 4a's change_row then
# strips it to "" and raises ValueError (an unhandled 500), and a dry run -
# which never reaches change_row - reports success right before the real run
# fails on the same file. Stripping at the schema (api/schemas/financial_aid.py)
# makes a blank override row note fall back to the load's reason before
# anything is sent, and makes a blank required note/reason a 422 at the door
# in dry run and real run alike.


@pytest.mark.asyncio
async def test_a_whitespace_only_override_note_falls_back_to_the_loads_reason() -> None:
    service, spy = _service(_override_repo())
    rows = [OverrideRow(transaction_cm_id=9001, program_family="summer", note="   ")]

    # The row's note is stripped to "" at the schema, not left as whitespace.
    assert rows[0].note == ""

    dry = await service.load_overrides(
        OverrideBulkLoad(year=2026, source="staff", reason="Reviewed 2026 attribution", dry_run=True, rows=rows),
        ACTOR,
    )
    real = await service.load_overrides(
        OverrideBulkLoad(year=2026, source="staff", reason="Reviewed 2026 attribution", dry_run=False, rows=rows),
        ACTOR,
    )

    assert (dry.created, dry.rejected) == (1, [])
    assert (real.created, real.rejected) == (1, [])  # dry run and real run agree
    [write] = spy.writes
    assert write.reason is None  # nothing of its own to log
    assert spy.kwargs["reason"] == "Reviewed 2026 attribution"
    [log] = spy.log_rows()
    assert log["reason"] == "Reviewed 2026 attribution"


@pytest.mark.parametrize("note", ["   ", "\t\n"])
def test_a_blank_disposition_note_is_refused_at_the_schema(note: str) -> None:
    with pytest.raises(ValidationError):
        DispositionRow(
            transaction_cm_id=9001, flag="implied_program_mismatch", disposition="accepted_let_stand", note=note
        )


def test_a_blank_source_classification_note_is_refused_at_the_schema() -> None:
    with pytest.raises(ValidationError):
        _classification(note="   ")


def test_a_blank_household_link_note_is_refused_at_the_schema() -> None:
    with pytest.raises(ValidationError):
        HouseholdLinkCreate(year=2026, household_cm_id=600, family_key="hh-100", note="   ")


def test_a_blank_override_load_reason_is_still_refused_at_the_schema() -> None:
    with pytest.raises(ValidationError):
        OverrideBulkLoad(
            year=2026, source="staff", reason="   ", rows=[OverrideRow(transaction_cm_id=9001, program_family="summer")]
        )


# --- a description names its grantor (sub-project 6-core) ------------------------


def _mapping(key: str | None = "regional_fund", note: str = "Grantor list, finance") -> SourceGrantorIn:
    return SourceGrantorIn(grantor_key=key, note=note)


def _mapping_repo(source: SimpleNamespace, grantor: SimpleNamespace | None = None) -> MagicMock:
    repo = MagicMock()
    repo.get_source = AsyncMock(return_value=source)
    repo.get_grantor = AsyncMock(return_value=grantor)
    return repo


_GRANTOR = SimpleNamespace(id="gra000000000001", key="regional_fund", name="Regional Fund")


@pytest.mark.asyncio
async def test_mapping_a_description_to_a_grantor_writes_only_grantor_key() -> None:
    source = _source(
        source_family="other_outside", funder_type="outside", counts_as_aid=True, classified_by="config_file"
    )
    service, spy = _service(_mapping_repo(source, _GRANTOR))
    out = await service.map_source_grantor(SOURCE_ID, _mapping(), ACTOR)
    assert out.grantor_key == "regional_fund"
    assert out.classified_by == "config_file"  # a mapping is not a classification
    (write,) = spy.writes
    assert write.collection == "aid_sources"
    assert write.data == {"grantor_key": "regional_fund"}
    assert write.log_action == "map_grantor"
    assert spy.kwargs["reason"] == "Grantor list, finance"
    assert spy.kwargs["require_reason"] is True


@pytest.mark.asyncio
async def test_unmapping_a_description_clears_its_grantor() -> None:
    source = _source(funder_type="outside", counts_as_aid=True, grantor_key="regional_fund")
    service, spy = _service(_mapping_repo(source))
    out = await service.map_source_grantor(SOURCE_ID, _mapping(None), ACTOR)
    assert out.grantor_key == ""
    assert spy.writes[0].data == {"grantor_key": ""}


@pytest.mark.asyncio
async def test_mapping_to_the_grantor_it_already_names_writes_nothing() -> None:
    source = _source(funder_type="outside", counts_as_aid=True, grantor_key="regional_fund")
    service, spy = _service(_mapping_repo(source, _GRANTOR))
    await service.map_source_grantor(SOURCE_ID, _mapping(), ACTOR)
    assert not spy.commit.called


@pytest.mark.asyncio
async def test_mapping_to_an_unknown_grantor_is_not_found() -> None:
    service, spy = _service(_mapping_repo(_source(funder_type="outside"), None))
    with pytest.raises(FinancialAidNotFoundError, match="grantor"):
        await service.map_source_grantor(SOURCE_ID, _mapping(), ACTOR)
    assert not spy.commit.called


@pytest.mark.asyncio
@pytest.mark.parametrize("funder", ["camp", "unknown"])
async def test_only_an_outside_or_incentive_description_names_a_grantor(funder: str) -> None:
    service, spy = _service(_mapping_repo(_source(funder_type=funder), _GRANTOR))
    with pytest.raises(FinancialAidValidationError, match="outside grant or incentive"):
        await service.map_source_grantor(SOURCE_ID, _mapping(), ACTOR)
    assert not spy.commit.called


@pytest.mark.asyncio
async def test_reclassifying_a_mapped_description_as_camp_aid_clears_its_grantor() -> None:
    source = _source(
        source_family="other_outside", funder_type="outside", counts_as_aid=True, grantor_key="regional_fund"
    )
    service, spy = _service(_mapping_repo(source))
    body = AidSourceUpdate(
        source_name="Camp aid",
        source_family="camp_fa",
        funder_type="camp",
        counts_as_aid=True,
        counts_toward_budget=True,
        note="It was the camp's own aid",
    )
    out = await service.classify_source(SOURCE_ID, body, ACTOR)
    assert out.grantor_key == ""
    assert spy.writes[0].data is not None
    assert spy.writes[0].data["grantor_key"] == ""


@pytest.mark.asyncio
async def test_an_exclusion_whose_auto_row_the_sync_just_swept_is_a_conflict_not_a_500() -> None:
    """G6 (Ruling 2026-10-01): the sync's sweep deleted the automatic row after create_link read it, so
    PocketBase answers the update 404 inside the batch. The exclusion is refused whole; the person reloads."""
    service, spy = _service(_link_repo([_link()]))

    def swept(pb: Any, requests: list[BatchRequest], *, max_requests: int) -> list[BatchResult]:
        raise BatchRequestFailedError(
            index=0,
            total=len(requests),
            request=requests[0],
            status=404,
            message="The requested resource wasn't found.",
            field_errors={},
            response=None,
        )

    patch("bunking.financial_aid.change_log.send_batch", side_effect=swept).start()
    with pytest.raises(AidWriteConflictError) as refused:
        await service.create_link(
            HouseholdLinkCreate(year=2026, household_cm_id=400, family_key="hh-100", excluded=True, note="Not family"),
            ACTOR,
        )
    assert (refused.value.collection, refused.value.record_id, str(refused.value)) == (
        "aid_household_links",
        LINK_ID,
        CONFLICT_MESSAGE,
    )


@pytest.mark.asyncio
async def test_a_new_staff_link_that_fails_for_another_reason_is_not_dressed_as_a_conflict() -> None:
    """Only the update branch's 404 is the sweep race. A create's failure is a real fault and goes through."""
    service, _ = _service(_link_repo([]))

    def broken(pb: Any, requests: list[BatchRequest], *, max_requests: int) -> list[BatchResult]:
        raise BatchRequestFailedError(
            index=0,
            total=len(requests),
            request=requests[0],
            status=404,
            message="Missing collection.",
            field_errors={},
            response=None,
        )

    patch("bunking.financial_aid.change_log.send_batch", side_effect=broken).start()
    with pytest.raises(BatchRequestFailedError):
        await service.create_link(
            HouseholdLinkCreate(
                year=2026, household_cm_id=400, family_key="hh-100", excluded=False, note="Same family"
            ),
            ACTOR,
        )


@pytest.mark.asyncio
async def test_a_new_staff_link_whose_row_the_sync_just_created_is_a_conflict_not_a_500() -> None:
    """The mirror of the sweep race: create_link read no row, then the aid_postings sync created the automatic
    one, so the staff create hits the (household, family key, year) unique index. Refused whole, like every
    other G6 conflict: the person reloads and sees the automatic link."""
    service, _ = _service(_link_repo([]))

    def raced(pb: Any, requests: list[BatchRequest], *, max_requests: int) -> list[BatchResult]:
        raise BatchRequestFailedError(
            index=0,
            total=len(requests),
            request=requests[0],
            status=400,
            message="Failed to create record.",
            field_errors={"household_cm_id": "Value must be unique."},
            response=None,
        )

    patch("bunking.financial_aid.change_log.send_batch", side_effect=raced).start()
    with pytest.raises(AidWriteConflictError) as refused:
        await service.create_link(
            HouseholdLinkCreate(
                year=2026, household_cm_id=400, family_key="hh-100", excluded=False, note="Same family"
            ),
            ACTOR,
        )
    assert (refused.value.collection, str(refused.value)) == ("aid_household_links", CONFLICT_MESSAGE)
