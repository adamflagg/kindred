"""Tests for type-level budget config fetching (scit, tli)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.services.metrics_repository import MetricsRepository


def _mk_record(config_key: str, value: object) -> SimpleNamespace:
    return SimpleNamespace(config_key=config_key, value=value)


def _make_repo() -> tuple[MetricsRepository, MagicMock]:
    """Construct a MetricsRepository with a mocked PB client."""
    pb = MagicMock()
    repo = MetricsRepository(pb=pb)
    return repo, pb


@pytest.mark.asyncio
async def test_fetch_budget_config_returns_type_keyed_entries() -> None:
    """Type-level configs (config_key='type_scit') are returned in a separate map."""
    repo, pb = _make_repo()
    pb.collection.return_value.get_full_list.return_value = [
        _mk_record("session_1235404", {"participant_goal": 200, "session_fee": 5000}),
        _mk_record("type_scit", {"participant_goal": 50, "session_fee": 1500}),
        _mk_record("type_tli", {"participant_goal": 40, "session_fee": 2000}),
    ]
    result = await repo.fetch_budget_config(2026)

    assert 1235404 in result
    assert result[1235404]["participant_goal"] == 200

    assert "type:scit" in result
    assert result["type:scit"]["participant_goal"] == 50
    assert result["type:scit"]["session_fee"] == 1500
    assert "type:tli" in result
    assert result["type:tli"]["participant_goal"] == 40


@pytest.mark.asyncio
async def test_fetch_budget_config_ignores_malformed_keys() -> None:
    repo, pb = _make_repo()
    pb.collection.return_value.get_full_list.return_value = [
        _mk_record("bogus_key", {"participant_goal": 1}),
        _mk_record("type_", {"participant_goal": 2}),  # empty type name
        _mk_record("session_notanumber", {"participant_goal": 3}),
    ]
    result = await repo.fetch_budget_config(2026)
    assert result == {}


@pytest.mark.asyncio
async def test_fetch_budget_config_skips_non_dict_values() -> None:
    repo, pb = _make_repo()
    pb.collection.return_value.get_full_list.return_value = [
        _mk_record("session_1234", "not a dict"),
        _mk_record("type_scit", None),
    ]
    result = await repo.fetch_budget_config(2026)
    assert result == {}
