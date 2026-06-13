"""run_solver_task_v2 routes compute through the subprocess executor.

Gate semantics: settings.solver_subprocess=True (default) → config snapshot +
run_solve_in_subprocess; False (SOLVER_SUBPROCESS kill-switch) → legacy
in-thread solve_and_diagnose with the live ConfigLoader. Failure outcomes map
onto the same solver_runs keys the diagnostics frontend reads (#1638/#1656).
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.services.solver_runner as sr_module
from api.services.solve_executor import SolveOutcome
from bunking.models_v2 import DirectSolverInput


def _mock_result() -> MagicMock:
    result = MagicMock()
    result.assignments = []
    result.stats = {"status": "OPTIMAL"}
    result.satisfied_requests = {}
    result.overflow_used = 0
    result.break_glass_used = False
    result.infeasibility_diagnosis = None
    return result


def _base_patches(mock_runs: dict[str, dict[str, Any]], *, subprocess_on: bool) -> dict[str, Any]:
    solver_input = DirectSolverInput(persons=[], requests=[], bunks=[])
    settings = MagicMock(
        pocketbase_admin_email="admin@camp.local",
        pocketbase_admin_password="pass",
        solver_subprocess=subprocess_on,
    )
    return {
        "fetch": patch.object(
            sr_module, "fetch_session_data_v2", new_callable=AsyncMock, return_value=([], [], [], [], [])
        ),
        "hist": patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock, return_value=[]),
        "prep": patch.object(sr_module, "prepare_direct_solver_input", return_value=solver_input),
        "config": patch.object(sr_module, "ConfigLoader"),
        "pb": patch.object(sr_module, "PocketBase"),
        "settings": patch.object(sr_module, "get_settings", return_value=settings),
        "runs": patch.object(sr_module, "solver_runs", mock_runs),
        "tag": patch.object(sr_module, "build_run_details", new_callable=AsyncMock, return_value={}),
    }


@pytest.mark.asyncio
async def test_gate_on_snapshots_config_and_runs_subprocess() -> None:
    mock_runs: dict[str, dict[str, Any]] = {"r1": {}}
    patches = _base_patches(mock_runs, subprocess_on=True)
    outcome = SolveOutcome(result=_mock_result())
    with (
        patches["fetch"],
        patches["hist"],
        patches["prep"],
        patches["config"],
        patches["pb"] as pb_cls,
        patches["settings"],
        patches["runs"],
        patches["tag"],
        patch.object(sr_module, "snapshot_config", return_value={"k": 1}) as snap,
        patch.object(sr_module, "run_solve_in_subprocess", new_callable=AsyncMock, return_value=outcome) as sub,
        patch.object(sr_module, "solve_and_diagnose") as in_thread,
    ):
        pb_cls.return_value.collection.return_value.create.return_value = MagicMock(id="rec_1")
        await sr_module.run_solver_task_v2(run_id="r1", session_cm_id=1, year=2026, time_limit=60)

    snap.assert_called_once()
    sub.assert_awaited_once()
    in_thread.assert_not_called()
    assert sub.await_args is not None
    assert sub.await_args.args[3] == {"k": 1}  # snapshot crosses the boundary
    assert mock_runs["r1"]["status"] == "completed"
    assert mock_runs["r1"]["results"]["assignments"] == {}


@pytest.mark.asyncio
async def test_gate_off_runs_in_thread_with_live_config() -> None:
    mock_runs: dict[str, dict[str, Any]] = {"r1": {}}
    patches = _base_patches(mock_runs, subprocess_on=False)
    outcome = SolveOutcome(result=_mock_result())
    with (
        patches["fetch"],
        patches["hist"],
        patches["prep"],
        patches["config"] as config_cls,
        patches["pb"] as pb_cls,
        patches["settings"],
        patches["runs"],
        patches["tag"],
        patch.object(sr_module, "run_solve_in_subprocess", new_callable=AsyncMock) as sub,
        patch.object(sr_module, "solve_and_diagnose", return_value=outcome) as in_thread,
    ):
        pb_cls.return_value.collection.return_value.create.return_value = MagicMock(id="rec_1")
        await sr_module.run_solver_task_v2(run_id="r1", session_cm_id=1, year=2026, time_limit=60)

    sub.assert_not_awaited()
    in_thread.assert_called_once()
    # The live (singleton) ConfigLoader is what reaches the in-thread path.
    assert in_thread.call_args.args[3] is config_cls.get_instance.return_value
    assert mock_runs["r1"]["status"] == "completed"


@pytest.mark.asyncio
async def test_failure_outcome_maps_to_solver_runs_keys() -> None:
    mock_runs: dict[str, dict[str, Any]] = {"r1": {}}
    patches = _base_patches(mock_runs, subprocess_on=True)
    outcome = SolveOutcome(
        result=None,
        impossibility_report={"total_impossible": 2},
        infeasibility_cause="The parent_paramount conflict",
        parent_paramount_iis={"singleton_critical_cms": [1001]},
        localization={"campers": [{"cm_id": 1001}]},
    )
    with (
        patches["fetch"],
        patches["hist"],
        patches["prep"],
        patches["config"],
        patches["pb"] as pb_cls,
        patches["settings"],
        patches["runs"],
        patches["tag"],
        patch.object(sr_module, "snapshot_config", return_value={}),
        patch.object(sr_module, "run_solve_in_subprocess", new_callable=AsyncMock, return_value=outcome),
    ):
        pb_cls.return_value.collection.return_value.create.return_value = MagicMock(id="rec_1")
        await sr_module.run_solver_task_v2(run_id="r1", session_cm_id=1, year=2026, time_limit=60)

    assert mock_runs["r1"]["status"] == "failed"
    assert mock_runs["r1"]["impossibility_report"] == {"total_impossible": 2}
    assert mock_runs["r1"]["infeasibility_cause"] == "The parent_paramount conflict"
    assert mock_runs["r1"]["parent_paramount_iis"] == {"singleton_critical_cms": [1001]}
    assert mock_runs["r1"]["localization"] == {"campers": [{"cm_id": 1001}]}
