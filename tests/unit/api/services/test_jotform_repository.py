"""kindred#2759: the Jotform admin's PocketBase reads and writes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.jotform_repository import PAGE_SIZE, JotformRepository


def _pb(rows: list[Any] | None = None) -> MagicMock:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = rows or []
    return pb


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "read",
    [
        pytest.param(lambda r: r.fetch_adult_sessions(2026), id="fetch_adult_sessions"),
        pytest.param(lambda r: r.fetch_forms(2026), id="fetch_forms"),
        pytest.param(lambda r: r.fetch_submissions(2026), id="fetch_submissions"),
        pytest.param(lambda r: r.fetch_answers(2026), id="fetch_answers"),
        pytest.param(lambda r: r.fetch_enrolled_guests(2026), id="fetch_enrolled_guests"),
        pytest.param(lambda r: r.fetch_submission("6600000000000000001"), id="fetch_submission"),
    ],
)
async def test_every_paged_read_pins_the_batch_and_a_unique_sort_tiebreak(
    read: Callable[[JotformRepository], Awaitable[Any]],
) -> None:
    # LIMIT/OFFSET paging without a total order can skip or repeat a row.
    pb = _pb()
    await read(JotformRepository(pb))
    kwargs = pb.collection.return_value.get_full_list.call_args.kwargs
    assert kwargs["batch"] == PAGE_SIZE
    assert kwargs["query_params"]["sort"].split(",")[-1] == "id"


@pytest.mark.asyncio
async def test_enrolled_guests_are_active_adult_attendees_of_the_year() -> None:
    pb = _pb()
    await JotformRepository(pb).fetch_enrolled_guests(2026)
    params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert "year = 2026" in params["filter"]
    assert "status_id = 2" in params["filter"]
    assert "session.session_type = 'adult'" in params["filter"]
    assert params["expand"] == "person,session"


@pytest.mark.asyncio
async def test_a_submission_id_is_escaped_into_its_filter() -> None:
    pb = _pb()
    await JotformRepository(pb).fetch_submission("66' || id != '")
    params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert params["filter"] == "submission_id = '66\\' || id != \\''"


@pytest.mark.asyncio
async def test_upsert_updates_the_existing_row_or_creates_one() -> None:
    expected = {
        "year": 2026,
        "session_cm_id": 1000002,
        "form_id": "261700000000001",
        "field_map": {"first_name": "3"},
        "enabled": True,
    }
    for pb, method in ((_pb([SimpleNamespace(id="form_ww")]), "update"), (_pb(), "create")):
        await JotformRepository(pb).upsert_form(
            year=2026, session_cm_id=1000002, form_id="261700000000001", field_map={"first_name": "3"}, enabled=True
        )
        collection = pb.collection.return_value
        if method == "update":
            collection.update.assert_called_once_with("form_ww", expected)
            collection.create.assert_not_called()
        else:
            collection.create.assert_called_once_with(expected)
            collection.update.assert_not_called()
