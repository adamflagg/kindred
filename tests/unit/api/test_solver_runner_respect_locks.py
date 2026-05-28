import inspect
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.services.solver_runner as sr_module
from api.services.solver_runner import run_solver_task_v2
from bunking.models_v2 import DirectSolverInput


def test_run_solver_task_v2_accepts_respect_locks():
    """run_solver_task_v2 should accept a respect_locks parameter."""
    sig = inspect.signature(run_solver_task_v2)
    assert "respect_locks" in sig.parameters
    # Default should be True
    assert sig.parameters["respect_locks"].default is True


def test_run_solver_task_v2_accepts_partial_resolve_params():
    """run_solver_task_v2 should accept locked_bunk_cm_ids and allow_overflow (#1609)."""
    sig = inspect.signature(run_solver_task_v2)
    assert "locked_bunk_cm_ids" in sig.parameters
    assert sig.parameters["locked_bunk_cm_ids"].default is None
    assert "allow_overflow" in sig.parameters
    assert sig.parameters["allow_overflow"].default is False


class TestAllowOverflowPropagation:
    """allow_overflow must reach solver_input on every code path (Stream A)."""

    @pytest.fixture
    def mock_solver_input(self):
        return DirectSolverInput(persons=[], requests=[], bunks=[])

    def _setup_mocks(self, mock_solver_input):
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

    def _configure_mocks(self, mocks, mock_solver_input):
        mocks["fetch_session_data_v2"].return_value = ([], [], [], [], [])
        mocks["fetch_historical_bunking"].return_value = []
        mocks["prepare_direct_solver_input"].return_value = mock_solver_input

        mock_pb_instance = MagicMock()
        mock_pb_instance.collection.return_value.auth_with_password.return_value = {}
        mock_pb_instance.collection.return_value.create.return_value = MagicMock(id="pb_record_123")
        mocks["PocketBase"].return_value = mock_pb_instance

        mocks["ConfigLoader"].get_instance.return_value = MagicMock()

        mock_solver = MagicMock()
        mock_result = MagicMock()
        mock_result.assignments = []
        mock_result.stats = {"status": "OPTIMAL", "solve_time": 5.0}
        mock_result.satisfied_requests = {}
        mock_solver.solve.return_value = mock_result
        mocks["DirectBunkingSolver"].return_value = mock_solver

        mocks["get_settings"].return_value = MagicMock(
            pocketbase_admin_email="admin@camp.local",
            pocketbase_admin_password="pass",
        )

    @pytest.mark.asyncio
    async def test_allow_overflow_propagates_without_locked_bunks(self, mock_solver_input):
        """allow_overflow=True must reach solver_input.allow_overflow even when
        locked_bunk_cm_ids is None (Stream A — full-solve overflow path)."""
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
            self._configure_mocks(mocks, mock_solver_input)
            mock_runs["test_run"] = {"status": "pending"}

            await sr_module.run_solver_task_v2(
                run_id="test_run",
                session_cm_id=100,
                year=2026,
                time_limit=60,
                locked_bunk_cm_ids=None,
                allow_overflow=True,
            )

            # DirectBunkingSolver is invoked with `input_data=solver_input` — that's
            # the captured DirectSolverInput post-mutation. allow_overflow must
            # reflect the parameter passed to run_solver_task_v2.
            assert mocks["DirectBunkingSolver"].call_count == 1
            passed_input = mocks["DirectBunkingSolver"].call_args.kwargs["input_data"]
            assert passed_input.allow_overflow is True
