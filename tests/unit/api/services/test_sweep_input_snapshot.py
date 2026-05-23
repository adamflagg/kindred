"""TDD tests for sweep input snapshotting."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.sweep_input_snapshot import snapshot_session_input


@pytest.mark.asyncio
async def test_assembles_complete_solver_input_for_session() -> None:
    pb = MagicMock()
    fake_input = MagicMock()
    fake_input.persons = [MagicMock(), MagicMock()]
    fake_input.bunks = [MagicMock()]
    fake_input.requests = []
    fake_input.lock_groups_data = {}

    with (
        patch(
            "api.services.sweep_input_snapshot.fetch_session_data_v2",
            AsyncMock(return_value=([], [], [], [], [])),
        ),
        patch(
            "api.services.sweep_input_snapshot.fetch_historical_bunking",
            AsyncMock(return_value={}),
        ),
        patch(
            "api.services.sweep_input_snapshot.prepare_direct_solver_input",
            return_value=fake_input,
        ),
    ):
        result = await snapshot_session_input(pb, session_cm_id=2, year=2026, scenario=None)

    assert result is fake_input


@pytest.mark.asyncio
async def test_includes_lock_groups_for_scenario_runs() -> None:
    pb = MagicMock()
    fake_input = MagicMock()
    fake_input.lock_groups_data = {}

    with (
        patch(
            "api.services.sweep_input_snapshot.fetch_session_data_v2",
            AsyncMock(return_value=([], [], [], [], [])),
        ),
        patch(
            "api.services.sweep_input_snapshot.fetch_historical_bunking",
            AsyncMock(return_value={}),
        ),
        patch(
            "api.services.sweep_input_snapshot.prepare_direct_solver_input",
            return_value=fake_input,
        ),
        patch(
            "api.services.sweep_input_snapshot.fetch_lock_groups",
            AsyncMock(return_value={"locked_pair": [1, 2]}),
        ),
    ):
        result = await snapshot_session_input(pb, session_cm_id=2, year=2026, scenario="scen_abc")

    assert result.lock_groups_data == {"locked_pair": [1, 2]}


@pytest.mark.asyncio
async def test_propagates_underlying_failure() -> None:
    pb = MagicMock()
    with patch(
        "api.services.sweep_input_snapshot.fetch_session_data_v2",
        AsyncMock(side_effect=ValueError("session not found")),
    ):
        with pytest.raises(ValueError, match="session not found"):
            await snapshot_session_input(pb, session_cm_id=99, year=2026, scenario=None)
