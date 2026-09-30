"""aid_change_log rows as replay input (3c). Fictional only."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_change_log_reads import fetch_change_log, log_row


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
