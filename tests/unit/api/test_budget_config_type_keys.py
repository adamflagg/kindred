"""Budget config now also parses per-session-type keys (config_key='type_<name>').

Per-session keys ('session_<cm_id>') stay int-keyed; per-type keys land under a
'type:<name>' string namespace so the forecast service can aggregate teen rows.
Covers BOTH repositories (METRICS_SQL_ENABLED defaults to true → SQL repo is live).
"""

import json
import sqlite3
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.services.metrics_repository import MetricsRepository
from api.services.metrics_sql_repository import MetricsSQLRepository


def _pb_record(config_key: str, value: dict) -> SimpleNamespace:
    return SimpleNamespace(config_key=config_key, value=value)


@pytest.mark.asyncio
async def test_pb_repo_parses_session_and_type_keys():
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = [
        _pb_record("session_1235404", {"participant_goal": 200, "session_fee": 5000}),
        _pb_record("type_scit", {"participant_goal": 50, "session_fee": 1500}),
        _pb_record("type_tli", {"participant_goal": 40, "session_fee": 2000}),
    ]
    repo = MetricsRepository(pb)
    result = await repo.fetch_budget_config(2026)

    assert result[1235404]["participant_goal"] == 200  # int key retained
    assert result["type:scit"] == {"participant_goal": 50, "session_fee": 1500}
    assert result["type:tli"]["session_fee"] == 2000


@pytest.mark.asyncio
async def test_pb_repo_ignores_malformed_keys():
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = [
        _pb_record("bogus_key", {"participant_goal": 1}),
        _pb_record("type_", {"participant_goal": 2}),  # empty type name
        _pb_record("session_notanumber", {"participant_goal": 3}),
    ]
    repo = MetricsRepository(pb)
    assert await repo.fetch_budget_config(2026) == {}


def _sql_conn_with_budget(rows: list[tuple[str, dict]]) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE config (config_key TEXT, value TEXT, category TEXT, subcategory TEXT)")
    for key, val in rows:
        conn.execute(
            "INSERT INTO config (config_key, value, category, subcategory) VALUES (?,?,?,?)",
            (key, json.dumps(val), "budget", "2026"),
        )
    conn.commit()
    return conn


@pytest.mark.asyncio
async def test_sql_repo_parses_session_and_type_keys():
    conn = _sql_conn_with_budget(
        [
            ("session_1235404", {"participant_goal": 200, "session_fee": 5000}),
            ("type_scit", {"participant_goal": 50, "session_fee": 1500}),
            ("type_tli", {"participant_goal": 40, "session_fee": 2000}),
        ]
    )
    repo = MetricsSQLRepository(conn)
    result = await repo.fetch_budget_config(2026)

    assert result[1235404]["participant_goal"] == 200
    assert result["type:scit"] == {"participant_goal": 50, "session_fee": 1500}
    assert result["type:tli"]["session_fee"] == 2000


@pytest.mark.asyncio
async def test_sql_repo_ignores_malformed_keys():
    conn = _sql_conn_with_budget([("bogus_key", {"x": 1}), ("type_", {"x": 2}), ("session_NaN", {"x": 3})])
    repo = MetricsSQLRepository(conn)
    assert await repo.fetch_budget_config(2026) == {}
