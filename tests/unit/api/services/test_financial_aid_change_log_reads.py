"""aid_change_log rows as replay input (3c). Fictional only."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_change_log_reads import fetch_change_log, fetch_entity_log, log_row


def test_a_create_row_has_no_before_and_json_text_is_parsed() -> None:
    row = log_row(
        SimpleNamespace(
            id="log000000000001",
            entity="aid_requests",
            entity_id="reqemma00000001",
            before=None,
            after='{"ask": 4000, "status": "active"}',
            created="2027-03-01 17:00:00.123Z",
        )
    )
    assert (row.kind, row.after, row.created) == (
        "create",
        {"ask": 4000, "status": "active"},
        datetime(2027, 3, 1, 17, 0, 0, 123000, tzinfo=UTC),
    )


def test_an_update_keeps_an_empty_before_as_a_dict() -> None:
    row = log_row(
        SimpleNamespace(
            id="l2", entity="aid_requests", entity_id="r", before={}, after={"a": 1}, created="2027-03-01 17:00:00.000Z"
        )
    )
    assert row.kind == "update"


@pytest.mark.asyncio
async def test_the_log_is_read_by_season_and_entity_in_recorded_order() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await fetch_change_log(pb, 2027, "aid_requests")
    pb.collection.assert_called_with("aid_change_log")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query == {"filter": 'year = 2027 && entity = "aid_requests"', "sort": "created,id"}


@pytest.mark.asyncio
async def test_only_an_aid_collection_name_is_read() -> None:
    with pytest.raises(ValueError, match="entity"):
        await fetch_change_log(MagicMock(), 2027, 'aid_requests" || year > 0 || "')


# --- the household page's timeline (slice 1) ------------------------------------------------------------


def _log_pb(rows: list[object]) -> tuple[MagicMock, list[dict[str, object]]]:
    calls: list[dict[str, object]] = []
    pb = MagicMock()

    def get_full_list(batch: int, query_params: dict[str, object]) -> list[object]:
        calls.append(query_params)
        return list(rows)

    pb.collection.return_value.get_full_list.side_effect = get_full_list
    return pb, calls


@pytest.mark.asyncio
async def test_the_entity_log_matches_request_ids_inside_entity_ids_and_other_ids_exactly() -> None:
    """A request's own rows are entity_id = the request id, or "<request id>:<round|code|household>"."""
    pb, calls = _log_pb([])
    await fetch_entity_log(pb, 2027, exact=["app000001000001"], containing=["reqemma00000001"])
    (call,) = calls
    assert call["filter"] == "year = 2027 && (entity_id ~ 'reqemma00000001' || entity_id = 'app000001000001')"
    assert call["sort"] == "created,id"


@pytest.mark.asyncio
async def test_the_entity_log_chunks_a_long_filter_and_merges_the_rows_once_each() -> None:
    row = SimpleNamespace(id="log000000000001", created="2027-03-01 17:00:00.000Z")
    pb, calls = _log_pb([row])
    ids = [f"req{n:012d}" for n in range(200)]
    out = await fetch_entity_log(pb, 2027, exact=[], containing=ids)
    assert len(calls) > 1
    assert all(len(str(c["filter"])) <= 3000 for c in calls)
    assert out == [row]


@pytest.mark.asyncio
async def test_no_ids_reads_nothing() -> None:
    pb, calls = _log_pb([])
    assert await fetch_entity_log(pb, 2027, exact=[], containing=[]) == []
    assert calls == []


@pytest.mark.asyncio
async def test_an_entity_id_is_escaped_into_the_filter() -> None:
    pb, calls = _log_pb([])
    await fetch_entity_log(pb, 2027, exact=["x' || year > 0 || '"], containing=[])
    assert "\\'" in str(calls[0]["filter"])


@pytest.mark.asyncio
async def test_the_season_log_is_read_without_its_json() -> None:
    from api.services.financial_aid_change_log_reads import fetch_season_log

    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await fetch_season_log(pb, 2027)
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query["filter"] == "year = 2027"
    assert query["sort"] == "created,id"
    assert set(query["fields"].split(",")) == {
        "id",
        "entity",
        "entity_id",
        "action",
        "actor",
        "reason",
        "operation_id",
        "created",
    }


@pytest.mark.asyncio
async def test_one_operation_is_read_whole_and_only_by_a_well_formed_id() -> None:
    from api.services.financial_aid_change_log_reads import fetch_operation

    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await fetch_operation(pb, 2027, "abc123def456ghi")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query == {"filter": 'year = 2027 && operation_id = "abc123def456ghi"', "sort": "created,id"}
    with pytest.raises(ValueError, match="operation"):
        await fetch_operation(pb, 2027, 'x" || year > 0 || "')
