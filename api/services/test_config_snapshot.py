"""TDD tests for solver_config snapshot capture."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.config_snapshot import snapshot_solver_config


@pytest.mark.asyncio
async def test_returns_dict_of_key_value_pairs() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list = AsyncMock(
        return_value=[
            MagicMock(config_key="constraint.grade_spread.max", config_value="2"),
            MagicMock(config_key="objective.first_request_multiplier", config_value="10"),
        ]
    )

    result = await snapshot_solver_config(pb)

    assert result == {
        "constraint.grade_spread.max": "2",
        "objective.first_request_multiplier": "10",
    }
    pb.collection.assert_called_once_with("solver_config")


@pytest.mark.asyncio
async def test_returns_empty_dict_on_empty_collection() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list = AsyncMock(return_value=[])
    result = await snapshot_solver_config(pb)
    assert result == {}


@pytest.mark.asyncio
async def test_returns_empty_dict_on_fetch_failure() -> None:
    """Snapshot is best-effort; a failure here must not block the solver run."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list = AsyncMock(side_effect=RuntimeError("PB down"))
    result = await snapshot_solver_config(pb)
    assert result == {}
