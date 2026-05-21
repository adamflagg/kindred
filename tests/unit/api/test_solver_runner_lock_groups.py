"""Tests for lock group integration in solver_runner."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.services.solver_runner as sr_module
from bunking.models_v2 import DirectSolverInput


class TestSolverRunnerLockGroups:
    """Test that solver_runner wires lock groups into solver input."""

    @pytest.fixture
    def mock_solver_input(self):
        """Create a minimal DirectSolverInput."""
        return DirectSolverInput(
            persons=[],
            requests=[],
            bunks=[],
        )

    @pytest.mark.asyncio
    async def test_lock_groups_fetched_when_scenario_provided(self, mock_solver_input):
        """When a scenario is provided, fetch_lock_groups should be called."""
        mock_runs: dict[str, dict[str, str]] = {}
        with (
            patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
            patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock) as mock_hist,
            patch.object(sr_module, "prepare_direct_solver_input") as mock_prepare,
            patch.object(sr_module, "fetch_lock_groups", new_callable=AsyncMock) as mock_lock_groups,
            patch.object(sr_module, "ConfigLoader") as mock_config_cls,
            patch.object(sr_module, "DirectBunkingSolver") as mock_solver_cls,
            patch.object(sr_module, "PocketBase") as mock_pb_cls,
            patch.object(sr_module, "get_settings") as mock_settings,
            patch.object(sr_module, "solver_runs", mock_runs),
        ):
            mock_fetch.return_value = ([], [], [], [], [])
            mock_hist.return_value = []
            mock_prepare.return_value = mock_solver_input
            mock_lock_groups.return_value = {"grp_1": [1001, 1002, 1003]}

            mock_pb_instance = MagicMock()
            mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
            mock_pb_cls.return_value = mock_pb_instance

            mock_config = MagicMock()
            mock_config_cls.get_instance.return_value = mock_config

            mock_solver = MagicMock()
            mock_result = MagicMock()
            mock_result.assignments = []
            mock_result.stats = {}
            mock_result.satisfied_requests = {}
            mock_solver.solve.return_value = mock_result
            mock_solver_cls.return_value = mock_solver

            mock_settings.return_value = MagicMock(
                pocketbase_admin_email="admin@camp.local",
                pocketbase_admin_password="pass",
            )

            # Pre-populate solver_runs dict
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
                scenario="scenario_123",
            )

            # fetch_lock_groups should have been called with the scenario
            mock_lock_groups.assert_called_once_with(
                scenario="scenario_123",
                session_cm_id=100,
                year=2026,
                pb_client=mock_pb_instance,
            )

            # lock_groups_data should be populated on solver_input
            assert mock_solver_input.lock_groups_data == {"grp_1": [1001, 1002, 1003]}

    @pytest.mark.asyncio
    async def test_lock_groups_not_fetched_without_scenario(self, mock_solver_input):
        """When no scenario is provided, fetch_lock_groups should not be called."""
        mock_runs: dict[str, dict[str, str]] = {}
        with (
            patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock) as mock_fetch,
            patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock) as mock_hist,
            patch.object(sr_module, "prepare_direct_solver_input") as mock_prepare,
            patch.object(sr_module, "fetch_lock_groups", new_callable=AsyncMock) as mock_lock_groups,
            patch.object(sr_module, "ConfigLoader") as mock_config_cls,
            patch.object(sr_module, "DirectBunkingSolver") as mock_solver_cls,
            patch.object(sr_module, "PocketBase") as mock_pb_cls,
            patch.object(sr_module, "get_settings") as mock_settings,
            patch.object(sr_module, "solver_runs", mock_runs),
        ):
            mock_fetch.return_value = ([], [], [], [], [])
            mock_hist.return_value = []
            mock_prepare.return_value = mock_solver_input

            mock_pb_instance = MagicMock()
            mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
            mock_pb_cls.return_value = mock_pb_instance

            mock_config = MagicMock()
            mock_config_cls.get_instance.return_value = mock_config

            mock_solver = MagicMock()
            mock_result = MagicMock()
            mock_result.assignments = []
            mock_result.stats = {}
            mock_result.satisfied_requests = {}
            mock_solver.solve.return_value = mock_result
            mock_solver_cls.return_value = mock_solver

            mock_settings.return_value = MagicMock(
                pocketbase_admin_email="admin@camp.local",
                pocketbase_admin_password="pass",
            )

            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
                scenario=None,
            )

            mock_lock_groups.assert_not_called()
