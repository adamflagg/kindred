import inspect
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.services.solver_runner as sr_module
from api.services.solver_runner import run_solver_task_v2
from bunking.models_v2 import DirectBunkAssignment, DirectSolverInput


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


# ---------------------------------------------------------------------------
# allow_unassigned derivation inside run_solver_task_v2
# ---------------------------------------------------------------------------


def _make_frozen_with_assignments() -> DirectSolverInput:
    """Frozen input with a camper already assigned to bunk 2001."""
    return DirectSolverInput(
        persons=[],
        requests=[],
        bunks=[],
        existing_assignments=[
            DirectBunkAssignment(person_cm_id=1001, session_cm_id=1000001, bunk_cm_id=2001, year=2026),
        ],
    )


def _patch_solver_pipeline_minimal():
    return {
        "fetch_session_data_v2": patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock),
        "fetch_historical_bunking": patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock),
        "prepare_direct_solver_input": patch.object(sr_module, "prepare_direct_solver_input"),
        "fetch_lock_groups": patch.object(sr_module, "fetch_lock_groups", new_callable=AsyncMock),
        "ConfigLoader": patch.object(sr_module, "ConfigLoader"),
        "DirectBunkingSolver": patch.object(sr_module, "DirectBunkingSolver"),
        "PocketBase": patch.object(sr_module, "PocketBase"),
        "get_settings": patch.object(sr_module, "get_settings"),
    }


@pytest.mark.asyncio
async def test_allow_unassigned_true_when_locked_bunk_cm_ids_provided() -> None:
    """When locked_bunk_cm_ids is non-empty and resolves occupants, the runner must set
    solver_input.allow_unassigned = True (partial-mode flag, #1609)."""
    frozen = _make_frozen_with_assignments()
    mock_runs: dict[str, dict[str, object]] = {"run-allow": {"status": "pending"}}
    patches = _patch_solver_pipeline_minimal()
    captured_input: list[DirectSolverInput] = []

    with (
        patches["fetch_session_data_v2"],
        patches["fetch_historical_bunking"],
        patches["prepare_direct_solver_input"],
        patches["fetch_lock_groups"],
        patches["ConfigLoader"] as cfg,
        patches["DirectBunkingSolver"] as solver_cls,
        patches["PocketBase"] as pb_cls,
        patches["get_settings"] as settings,
        patch.object(sr_module, "solver_runs", mock_runs),
    ):
        cfg.get_instance.return_value = MagicMock()
        mock_pb = MagicMock()
        mock_pb.collection.return_value.auth_with_password.return_value = {}
        mock_pb.collection.return_value.create.return_value = MagicMock(id="pb_rec")
        pb_cls.return_value = mock_pb
        settings.return_value = MagicMock(pocketbase_admin_email="x", pocketbase_admin_password="x")

        mock_solver = MagicMock()
        mock_result = MagicMock()
        mock_result.assignments = []
        mock_result.stats = {"status": "OPTIMAL"}
        mock_result.satisfied_requests = {}
        mock_solver.solve.return_value = mock_result

        # Capture the input passed to the solver constructor
        def capture_solver(input_data, **_kwargs):
            captured_input.append(input_data)
            return mock_solver

        solver_cls.side_effect = capture_solver

        await sr_module.run_solver_task_v2(
            run_id="run-allow",
            session_cm_id=1000001,
            year=2026,
            time_limit=30,
            frozen_input=frozen,
            locked_bunk_cm_ids=[2001],  # non-empty → partial mode
        )

    assert captured_input, "DirectBunkingSolver was never constructed"
    assert captured_input[0].allow_unassigned is True, (
        f"Expected allow_unassigned=True when locked_bunk_cm_ids=[2001], got {captured_input[0].allow_unassigned}"
    )


@pytest.mark.asyncio
async def test_allow_unassigned_false_when_no_locked_bunk_cm_ids() -> None:
    """When locked_bunk_cm_ids is empty (full solve), allow_unassigned must remain False."""
    frozen = _make_frozen_with_assignments()
    mock_runs: dict[str, dict[str, object]] = {"run-full": {"status": "pending"}}
    patches = _patch_solver_pipeline_minimal()
    captured_input: list[DirectSolverInput] = []

    with (
        patches["fetch_session_data_v2"],
        patches["fetch_historical_bunking"],
        patches["prepare_direct_solver_input"],
        patches["fetch_lock_groups"],
        patches["ConfigLoader"] as cfg,
        patches["DirectBunkingSolver"] as solver_cls,
        patches["PocketBase"] as pb_cls,
        patches["get_settings"] as settings,
        patch.object(sr_module, "solver_runs", mock_runs),
    ):
        cfg.get_instance.return_value = MagicMock()
        mock_pb = MagicMock()
        mock_pb.collection.return_value.auth_with_password.return_value = {}
        mock_pb.collection.return_value.create.return_value = MagicMock(id="pb_rec")
        pb_cls.return_value = mock_pb
        settings.return_value = MagicMock(pocketbase_admin_email="x", pocketbase_admin_password="x")

        mock_solver = MagicMock()
        mock_result = MagicMock()
        mock_result.assignments = []
        mock_result.stats = {"status": "OPTIMAL"}
        mock_result.satisfied_requests = {}
        mock_solver.solve.return_value = mock_result

        def capture_solver(input_data, **_kwargs):
            captured_input.append(input_data)
            return mock_solver

        solver_cls.side_effect = capture_solver

        await sr_module.run_solver_task_v2(
            run_id="run-full",
            session_cm_id=1000001,
            year=2026,
            time_limit=30,
            frozen_input=frozen,
            locked_bunk_cm_ids=None,  # full solve → no partial mode
        )

    assert captured_input, "DirectBunkingSolver was never constructed"
    assert captured_input[0].allow_unassigned is False, (
        f"Expected allow_unassigned=False for full solve, got {captured_input[0].allow_unassigned}"
    )
