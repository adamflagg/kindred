"""Tests for solver_runner PocketBase record saving.

Verifies that run_solver_task_v2 saves correct field names and values
to the solver_runs PocketBase collection on both success and failure paths.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.services.solver_runner as sr_module
from bunking.models_v2 import DirectSolverInput


class TestSolverRunnerPocketBaseSave:
    """Test that solver_runner saves correct data to solver_runs collection."""

    @pytest.fixture
    def mock_solver_input(self):
        """Create a minimal DirectSolverInput."""
        return DirectSolverInput(
            persons=[],
            requests=[],
            bunks=[],
        )

    def _setup_mocks(self, mock_solver_input, solver_succeeds=True):
        """Return a context manager stack with all required mocks."""
        mock_runs: dict[str, dict[str, object]] = {}
        patches = {
            "fetch_session_data_v2": patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock),
            "fetch_historical_bunking": patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock),
            "prepare_direct_solver_input": patch.object(sr_module, "prepare_direct_solver_input"),
            "fetch_lock_groups": patch.object(sr_module, "fetch_lock_groups", new_callable=AsyncMock),
            "ConfigLoader": patch.object(sr_module, "ConfigLoader"),
            "DirectBunkingSolver": patch.object(sr_module, "DirectBunkingSolver"),
            "PocketBase": patch.object(sr_module, "PocketBase"),
            "get_settings": patch.object(sr_module, "get_settings"),
            "solver_runs": patch.object(sr_module, "solver_runs", mock_runs),
        }
        return patches, mock_runs

    def _configure_mocks(self, mocks, mock_solver_input, solver_succeeds=True):
        """Configure mock return values."""
        mocks["fetch_session_data_v2"].return_value = ([], [], [], [], [])
        mocks["fetch_historical_bunking"].return_value = []
        mocks["prepare_direct_solver_input"].return_value = mock_solver_input

        mock_pb_instance = MagicMock()
        mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
        mock_pb_instance.collection.return_value.create.return_value = MagicMock(id="pb_record_123")
        mocks["PocketBase"].return_value = mock_pb_instance

        mock_config = MagicMock()
        mocks["ConfigLoader"].get_instance.return_value = mock_config

        mock_solver = MagicMock()
        if solver_succeeds:
            mock_result = MagicMock()
            mock_result.assignments = []
            mock_result.stats = {"status": "OPTIMAL", "solve_time": 5.0}
            mock_result.satisfied_requests = {}
            mock_solver.solve.return_value = mock_result
        else:
            mock_solver.solve.side_effect = ValueError("Solver failed to find a solution")
        mocks["DirectBunkingSolver"].return_value = mock_solver

        mocks["get_settings"].return_value = MagicMock(
            pocketbase_admin_email="admin@camp.local",
            pocketbase_admin_password="pass",
        )

        return mock_pb_instance

    @pytest.mark.asyncio
    async def test_success_path_sends_run_id(self, mock_solver_input):
        """run_id field must be sent (required by schema)."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                respect_locks=True,
                time_limit=60,
            )

            # Get the data passed to collection().create()
            create_calls = mock_pb.collection.return_value.create.call_args_list
            assert len(create_calls) == 1
            pb_data = create_calls[0][0][0]
            assert "run_id" in pb_data
            assert pb_data["run_id"] == "test_run"

    @pytest.mark.asyncio
    async def test_success_path_sends_session_field(self, mock_solver_input):
        """Schema field is 'session' (text), not 'session_cm_id'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                respect_locks=True,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "session" in pb_data
            assert "session_cm_id" not in pb_data
            assert pb_data["session"] == "100"

    @pytest.mark.asyncio
    async def test_success_path_sends_status_success(self, mock_solver_input):
        """Schema enum allows 'success', not 'completed'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                respect_locks=True,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert pb_data["status"] == "success"

    @pytest.mark.asyncio
    async def test_success_path_sends_result_field(self, mock_solver_input):
        """Schema field is 'result' (singular), not 'results'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                respect_locks=True,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "result" in pb_data
            assert "results" not in pb_data

    @pytest.mark.asyncio
    async def test_success_path_sends_details_not_config(self, mock_solver_input):
        """Schema field is 'details' (json), not 'config'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                respect_locks=True,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "details" in pb_data
            assert "config" not in pb_data

    @pytest.mark.asyncio
    async def test_success_path_sends_session_id_as_number(self, mock_solver_input):
        """Schema has 'session_id' (number) for the CM ID."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                respect_locks=True,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "session_id" in pb_data
            assert pb_data["session_id"] == 100

    @pytest.mark.asyncio
    async def test_failure_path_sends_correct_fields(self, mock_solver_input):
        """Error path must also use correct field names and status='failed'."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = self._configure_mocks(mocks, mock_solver_input, solver_succeeds=False)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                respect_locks=True,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert pb_data["run_id"] == "test_run"
            assert pb_data["session"] == "100"
            assert pb_data["session_id"] == 100
            assert pb_data["status"] == "failed"
            assert "session_cm_id" not in pb_data

    @pytest.mark.asyncio
    async def test_failure_path_sends_error_as_json(self, mock_solver_input):
        """Error should go to 'error' field (json), not 'error_message' (doesn't exist)."""
        patches, mock_runs = self._setup_mocks(mock_solver_input)

        with (
            patches["fetch_session_data_v2"] as m1,
            patches["fetch_historical_bunking"] as m2,
            patches["prepare_direct_solver_input"] as m3,
            patches["fetch_lock_groups"] as m4,
            patches["ConfigLoader"] as m5,
            patches["DirectBunkingSolver"] as m6,
            patches["PocketBase"] as m7,
            patches["get_settings"] as m8,
            patches["solver_runs"],
        ):
            mocks = {
                "fetch_session_data_v2": m1,
                "fetch_historical_bunking": m2,
                "prepare_direct_solver_input": m3,
                "fetch_lock_groups": m4,
                "ConfigLoader": m5,
                "DirectBunkingSolver": m6,
                "PocketBase": m7,
                "get_settings": m8,
            }
            mock_pb = self._configure_mocks(mocks, mock_solver_input, solver_succeeds=False)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                respect_locks=True,
                time_limit=60,
            )

            pb_data = mock_pb.collection.return_value.create.call_args_list[0][0][0]
            assert "error" in pb_data
            assert "error_message" not in pb_data
