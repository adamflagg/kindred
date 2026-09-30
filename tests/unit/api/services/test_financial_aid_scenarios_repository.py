"""ScenarioRepository over a mocked PocketBase (sub-project 9b): its queries, record parsing, the snapshot cache and
the unique-code conflict. Fictional only."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from api.services import financial_aid_scenarios_repository as repository_module
from api.services.financial_aid_scenario_pricing import SeasonSnapshot, SnapshotError, encode_snapshot
from api.services.financial_aid_scenarios_repository import (
    OptionCodeTakenError,
    ScenarioRepository,
    SnapshotMissingError,
    option_record,
)
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.scenarios import ScenarioResults
from bunking.pocketbase_batch import BatchRequestFailedError
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules

CREATED = "2027-01-14 17:40:00.000Z"
FINANCE = "finance@example.com"
RESULTS = ScenarioResults(
    requests=0,
    families=0,
    round1=Decimal(0),
    round2=Decimal(0),
    round3=Decimal(0),
    round1_allocated=None,
    round1_remaining=None,
    remaining=None,
    at_minimum=0,
    held=0,
    held_asked=Decimal(0),
    round1_unmet=Decimal(0),
    pools=[],
    by_tier=[],
)


def _pb(items: list[Any] | None = None, total: int = 0) -> MagicMock:
    pb = MagicMock()
    pb.collection.return_value.get_list.return_value = SimpleNamespace(items=items or [], total_items=total)
    pb.collection.return_value.get_full_list.return_value = items or []
    return pb


def _option(**fields: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": "opt000000000001",
        "year": YEAR,
        "code": "A1",
        "starting_point": "A",
        "from_code": "A",
        "origin_version": 1,
        "document": intake_rules().model_dump(mode="json"),
        "results": RESULTS.model_dump(mode="json"),
        "snapshot": "snp000000000001",
        "actor": FINANCE,
        "created": CREATED,
    }
    return SimpleNamespace(**{**base, **fields})


def _trail(**fields: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": "trl000000000001",
        "year": YEAR,
        "actor": FINANCE,
        "from_code": "A",
        "change": "Round 1 % +5 pts",
        "results": RESULTS.model_dump(mode="json"),
        "snapshot": "snp000000000001",
        "kept_code": "",
        "created": CREATED,
    }
    return SimpleNamespace(**{**base, **fields})


@pytest.mark.asyncio
async def test_the_latest_snapshot_is_read_without_its_inputs() -> None:
    pb = _pb(
        [SimpleNamespace(id="snp000000000001", year=YEAR, requests=2, awaiting_rules=1, actor=FINANCE, created=CREATED)]
    )
    meta = await ScenarioRepository(pb).latest_snapshot(YEAR)
    assert meta is not None
    assert (meta.id, meta.requests, meta.awaiting_rules, meta.actor, meta.created.day) == (
        "snp000000000001",
        2,
        1,
        FINANCE,
        14,
    )
    pb.collection.assert_called_with("aid_scenario_snapshots")
    assert pb.collection.return_value.get_list.call_args.args == (
        1,
        1,
        {"filter": f"year = {YEAR}", "sort": "-created,-id", "fields": "id,year,requests,awaiting_rules,actor,created"},
    )


@pytest.mark.asyncio
async def test_a_snapshot_is_decoded_once() -> None:
    encoded = encode_snapshot(
        SeasonSnapshot(year=YEAR, requests=0, frozen_at=datetime(2027, 1, 12, tzinfo=UTC), calls={}, register=())
    )
    pb = _pb([SimpleNamespace(id="snp000000000009", inputs=json.dumps(encoded))])
    repository = ScenarioRepository(pb)
    first = await repository.snapshot_inputs("snp000000000009")
    second = await repository.snapshot_inputs("snp000000000009")
    assert first is second
    assert first.year == YEAR
    assert pb.collection.return_value.get_full_list.call_count == 1


@pytest.mark.asyncio
async def test_a_missing_snapshot_is_not_found() -> None:
    with pytest.raises(SnapshotMissingError):
        await ScenarioRepository(_pb([])).snapshot_inputs("snp000000000008")


@pytest.mark.asyncio
async def test_options_are_read_in_order_without_their_per_request_figures() -> None:
    pb = _pb([_option()])
    [option] = await ScenarioRepository(pb).options(YEAR)
    assert (option.code, option.starting_point, option.origin_version) == ("A1", "A", 1)
    assert option.document == intake_rules()
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query["sort"] == "created,id"
    assert "round1_by_request" not in query["fields"]


def test_an_option_stored_as_json_text_still_parses() -> None:
    record = _option(
        document=json.dumps(intake_rules().model_dump(mode="json")), results=json.dumps(RESULTS.model_dump(mode="json"))
    )
    assert option_record(record).results == RESULTS


@pytest.mark.asyncio
async def test_an_options_per_request_figures_come_back_as_money() -> None:
    pb = _pb([SimpleNamespace(id="opt000000000001", round1_by_request={"reqemma00000001": "1500"})])
    assert await ScenarioRepository(pb).option_round1("opt000000000001") == {"reqemma00000001": Decimal(1500)}


@pytest.mark.asyncio
async def test_the_draft_is_the_persons_newest_trail_row() -> None:
    pb = _pb([_trail(document=intake_rules().model_dump(mode="json"))])
    row = await ScenarioRepository(pb).latest_trail(YEAR, FINANCE)
    assert row is not None
    assert (row.from_code, row.document) == ("A", intake_rules())
    assert pb.collection.return_value.get_list.call_args.args == (
        1,
        1,
        {"filter": f'year = {YEAR} && actor = "{FINANCE}"', "sort": "-created,-id"},
    )


@pytest.mark.asyncio
async def test_an_actor_that_would_break_the_filter_is_refused() -> None:
    with pytest.raises(ValueError):
        await ScenarioRepository(_pb()).latest_trail(YEAR, 'x" || year > 0 || "')


@pytest.mark.asyncio
async def test_a_trail_page_leaves_the_documents_out_and_counts_every_row() -> None:
    pb = _pb([_trail()], total=61)
    rows, total = await ScenarioRepository(pb).trail_page(YEAR, 2, 50)
    assert (total, rows[0].document, rows[0].change) == (61, None, "Round 1 % +5 pts")
    assert pb.collection.return_value.get_list.call_args.args == (
        2,
        50,
        {
            "filter": f"year = {YEAR}",
            "sort": "-created,-id",
            "fields": "id,year,actor,from_code,change,results,snapshot,kept_code,created",
        },
    )


@pytest.mark.asyncio
async def test_a_malformed_record_id_is_refused() -> None:
    with pytest.raises(ValueError):
        await ScenarioRepository(_pb()).trail_row('x" || year > 0 || "')


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


@pytest.mark.asyncio
async def test_a_unique_code_collision_is_a_conflict() -> None:
    with (
        patch(
            "api.services.financial_aid_scenarios_repository.commit_aid_writes",
            side_effect=_batch_failure({"code": "Value must be unique."}),
        ),
        pytest.raises(OptionCodeTakenError),
    ):
        await ScenarioRepository(_pb()).commit([], actor=FINANCE)


@pytest.mark.asyncio
async def test_any_other_batch_failure_propagates() -> None:
    with (
        patch(
            "api.services.financial_aid_scenarios_repository.commit_aid_writes",
            side_effect=_batch_failure({"change": "Cannot be blank."}),
        ),
        pytest.raises(BatchRequestFailedError),
    ):
        await ScenarioRepository(_pb()).commit([], actor=FINANCE)


def _snapshot_write(inputs: dict[str, Any]) -> AidWrite:
    return AidWrite(
        collection="aid_scenario_snapshots", action="create", year=YEAR, data={"year": YEAR, "inputs": inputs}
    )


@pytest.mark.asyncio
async def test_a_snapshot_over_the_fields_cap_is_refused_before_the_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(repository_module, "SNAPSHOT_INPUTS_MAX_BYTES", 50)
    with (
        patch("api.services.financial_aid_scenarios_repository.commit_aid_writes") as batch,
        pytest.raises(SnapshotError, match=r"cap of 50"),
    ):
        await ScenarioRepository(_pb()).commit([_snapshot_write({"calls": "x" * 100})], actor=FINANCE)
    batch.assert_not_called()


@pytest.mark.asyncio
async def test_a_snapshot_under_the_cap_is_committed() -> None:
    with patch("api.services.financial_aid_scenarios_repository.commit_aid_writes") as batch:
        await ScenarioRepository(_pb()).commit([_snapshot_write({"calls": {}})], actor=FINANCE)
    batch.assert_called_once()
