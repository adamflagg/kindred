"""solve_executor: pure solve+diagnose logic and the SolveOutcome bundle.

The diagnostic chain here is transplanted from run_solver_task_v2 — these tests
freeze that behavior at the new boundary: orchestrator-diagnosis short-circuit,
impossibility-report capture, parent_paramount IIS gating, exception tolerance.
"""

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import api.services.solve_executor as sx
from bunking.models_v2 import DirectSolverInput, DirectSolverOutput


def _minimal_input() -> DirectSolverInput:
    return DirectSolverInput(persons=[], requests=[], bunks=[])


def _mock_result(assignments: list[Any], diagnosis: str | None = None) -> MagicMock:
    result = MagicMock()
    result.assignments = assignments
    result.infeasibility_diagnosis = diagnosis
    return result


class TestSolveAndDiagnose:
    def test_success_returns_result_only(self) -> None:
        result = _mock_result([MagicMock()])
        with patch.object(sx, "DirectBunkingSolver") as solver_cls:
            solver_cls.return_value.solve.return_value = result
            outcome = sx.solve_and_diagnose(_minimal_input(), 60, None, MagicMock())
        assert outcome.result is result
        assert outcome.impossibility_report is None
        assert outcome.infeasibility_cause is None
        assert outcome.parent_paramount_iis is None
        assert outcome.localization is None

    def test_solver_receives_inputs(self) -> None:
        solver_input = _minimal_input()
        config = MagicMock()
        debug = {"age_spread": True}
        with patch.object(sx, "DirectBunkingSolver") as solver_cls:
            solver_cls.return_value.solve.return_value = _mock_result([MagicMock()])
            sx.solve_and_diagnose(solver_input, 120, debug, config)
        solver_cls.assert_called_once_with(input_data=solver_input, config_service=config, debug_constraints=debug)
        solver_cls.return_value.solve.assert_called_once_with(time_limit_seconds=120)

    def test_orchestrator_diagnosis_short_circuits_cause_analysis(self) -> None:
        result = _mock_result([], diagnosis="Locked group spans 36 months")
        with (
            patch.object(sx, "DirectBunkingSolver") as solver_cls,
            patch.object(sx, "filter_immaterial_requests"),
            patch.object(sx, "asdict", return_value={"impossible": 1}),
        ):
            solver_cls.return_value.solve.return_value = result
            outcome = sx.solve_and_diagnose(_minimal_input(), 60, None, MagicMock())
        assert outcome.result is None
        assert outcome.infeasibility_cause == "Locked group spans 36 months"
        solver_cls.return_value.find_infeasibility_cause.assert_not_called()
        assert outcome.impossibility_report == {"impossible": 1}

    def test_none_result_runs_cause_analysis(self) -> None:
        with (
            patch.object(sx, "DirectBunkingSolver") as solver_cls,
            patch.object(sx, "filter_immaterial_requests"),
            patch.object(sx, "asdict", return_value={}),
        ):
            solver_cls.return_value.solve.return_value = None
            solver_cls.return_value.find_infeasibility_cause.return_value = "capacity"
            outcome = sx.solve_and_diagnose(_minimal_input(), 60, None, MagicMock())
        assert outcome.result is None
        assert outcome.infeasibility_cause == "capacity"
        assert outcome.parent_paramount_iis is None
        assert outcome.localization is None

    def test_parent_paramount_triggers_iis_and_localization(self) -> None:
        config = MagicMock()
        with (
            patch.object(sx, "DirectBunkingSolver") as solver_cls,
            patch.object(sx, "filter_immaterial_requests"),
            patch.object(sx, "asdict", return_value={}),
            patch.object(sx, "localize_hard_mso_infeasibility", return_value={"iis": True}) as loc,
            patch.object(sx, "resolve_localization", return_value={"campers": []}) as resolve,
        ):
            solver_cls.return_value.solve.return_value = None
            solver_cls.return_value.find_infeasibility_cause.return_value = "parent_paramount conflict"
            solver_input = _minimal_input()
            outcome = sx.solve_and_diagnose(solver_input, 60, None, config)
        assert outcome.parent_paramount_iis == {"iis": True}
        assert outcome.localization == {"campers": []}
        loc.assert_called_once_with(solver_input, config, sx.IIS_PROBE_TIME_LIMIT_SECONDS)
        resolve.assert_called_once()

    def test_analysis_exception_tolerated(self) -> None:
        with (
            patch.object(sx, "DirectBunkingSolver") as solver_cls,
            patch.object(sx, "asdict", side_effect=RuntimeError("boom")),
        ):
            solver_cls.return_value.solve.return_value = None
            solver_cls.return_value.find_infeasibility_cause.side_effect = RuntimeError("boom2")
            outcome = sx.solve_and_diagnose(_minimal_input(), 60, None, MagicMock())
        assert outcome.result is None
        assert outcome.impossibility_report is None
        assert outcome.infeasibility_cause is None


def _pid_probe_entry(
    solver_input: DirectSolverInput,
    time_limit: int,
    debug_constraints: dict[str, Any] | None,
    config_values: dict[str, Any],
) -> sx.SolveOutcome:
    """Module-level so the spawn context can pickle it by reference."""
    out = DirectSolverOutput(
        assignments=[],
        stats={"child_pid": os.getpid(), "echo": config_values.get("k")},
    )
    return sx.SolveOutcome(result=out)


def _suicidal_entry(
    solver_input: DirectSolverInput,
    time_limit: int,
    debug_constraints: dict[str, Any] | None,
    config_values: dict[str, Any],
) -> sx.SolveOutcome:
    """Simulates an OOM kill: the worker vanishes without returning."""
    os._exit(3)


class TestRunSolveInSubprocess:
    @pytest.mark.asyncio
    async def test_executes_in_child_process_and_pickles_back(self) -> None:
        outcome = await sx.run_solve_in_subprocess(_minimal_input(), 5, None, {"k": "v"}, _entry=_pid_probe_entry)
        assert outcome.result is not None
        assert outcome.result.stats["child_pid"] != os.getpid()
        assert outcome.result.stats["echo"] == "v"

    @pytest.mark.asyncio
    async def test_dead_child_raises_solver_process_died(self) -> None:
        with pytest.raises(sx.SolverProcessDiedError):
            await sx.run_solve_in_subprocess(_minimal_input(), 5, None, {}, _entry=_suicidal_entry)
