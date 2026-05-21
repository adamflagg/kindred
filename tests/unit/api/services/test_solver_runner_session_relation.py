"""Test resolve_session_relation: cm_id+year -> camp_sessions PB id or None."""

from unittest.mock import MagicMock

import pytest

from api.services.solver_runner import resolve_session_relation


@pytest.mark.asyncio
async def test_returns_pb_id_when_session_exists():
    """Happy path: cm_id matches a camp_sessions row in the given year."""
    pb = MagicMock()
    fake_session = MagicMock()
    fake_session.id = "sessions_pb_id_abc"
    pb.collection.return_value.get_first_list_item = MagicMock(return_value=fake_session)

    result = await resolve_session_relation(pb, session_cm_id=1000001, year=2026)

    assert result == "sessions_pb_id_abc"
    pb.collection.assert_called_with("camp_sessions")
    pb.collection.return_value.get_first_list_item.assert_called_once()
    filter_arg = pb.collection.return_value.get_first_list_item.call_args[0][0]
    assert "cm_id = 1000001" in filter_arg
    assert "year = 2026" in filter_arg


@pytest.mark.asyncio
async def test_returns_none_when_no_match():
    """Orphan path: no camp_sessions row for that cm_id+year -> None, no raise."""
    from pocketbase.errors import ClientResponseError

    pb = MagicMock()
    pb.collection.return_value.get_first_list_item = MagicMock(
        side_effect=ClientResponseError(url="x", status=404, data={})
    )

    result = await resolve_session_relation(pb, session_cm_id=1000002, year=2026)

    assert result is None


@pytest.mark.asyncio
async def test_propagates_non_404_errors():
    """Transient errors (500/503/timeout) re-raise so callers know writes are at risk."""
    from pocketbase.errors import ClientResponseError

    pb = MagicMock()
    pb.collection.return_value.get_first_list_item = MagicMock(
        side_effect=ClientResponseError(url="x", status=503, data={})
    )

    with pytest.raises(ClientResponseError):
        await resolve_session_relation(pb, session_cm_id=1000001, year=2026)
