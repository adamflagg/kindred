"""run_solver_task_v2 surfaces diagnostics on the result-is-None failure path (#1638)."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import api.services.solver_runner as sr_module
from bunking.solver.impossibility import ImpossibilityReport


def test_failure_branch_stores_localization_and_impossibility_report() -> None:
    run_id = "run-diag-1"
    mock_runs: dict[str, dict[str, Any]] = {run_id: {"id": run_id, "status": "pending", "config": {}}}

    mock_solver = MagicMock()
    mock_solver.solve.return_value = None  # force the result-is-None failure branch
    mock_solver.find_infeasibility_cause.return_value = "The parent_paramount constraint is causing infeasibility"
    mock_solver.impossibility_report = ImpossibilityReport()  # empty, real dataclass → asdict works

    mock_solver_input = MagicMock()
    mock_solver_input.persons = []
    mock_solver_input.existing_assignments = []
    mock_solver_input.lock_groups_data = {}
    mock_solver_input.person_by_cm_id = {}

    fake_iis = {
        "approach": "singleton",
        "candidate_count": 0,
        "singleton_critical_cms": [],
        "minimal_correction_set": [],
        "notes": "n/a",
    }

    with (
        patch.object(sr_module, "fetch_session_data_v2", new_callable=AsyncMock) as m_fetch,
        patch.object(sr_module, "fetch_historical_bunking", new_callable=AsyncMock) as m_hist,
        patch.object(sr_module, "prepare_direct_solver_input", return_value=mock_solver_input),
        patch.object(sr_module, "ConfigLoader") as m_config,
        patch.object(sr_module, "DirectBunkingSolver", return_value=mock_solver),
        patch.object(sr_module, "PocketBase") as m_pb,
        patch.object(sr_module, "get_settings"),
        patch.object(sr_module, "localize_hard_mso_infeasibility", return_value=fake_iis),
        patch.object(sr_module, "solver_runs", mock_runs),
    ):
        m_fetch.return_value = ([], [], [], [], [])
        m_hist.return_value = []
        m_config.get_instance.return_value = MagicMock()
        m_pb.return_value.collection.return_value.auth_with_password.return_value = {}

        asyncio.run(sr_module.run_solver_task_v2(run_id, 1000001, 2026, 5))

    assert mock_runs[run_id]["status"] == "failed"
    assert "parent_paramount" in mock_runs[run_id]["infeasibility_cause"]
    assert mock_runs[run_id]["localization"]["campers"] == []
    assert mock_runs[run_id]["impossibility_report"]["total_impossible"] == 0
    assert "by_reason" in mock_runs[run_id]["impossibility_report"]
