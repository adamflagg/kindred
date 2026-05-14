"""Unit tests for solver progress + best-bound capture surfaces.

Implementation must conform to these tests, not the other way around.
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock

from ortools.sat.python import cp_model

from bunking.solver.callbacks import _MAX_TRAJECTORY_POINTS, BestBoundCallback, SolverProgressCallback
from bunking.solver.logging import ConstraintLogger


class TestBestBoundCallback:
    def test_records_points_with_t_and_bound(self) -> None:
        cb = BestBoundCallback(time.monotonic())
        cb(100.0)
        cb(90.0)
        assert len(cb.bound_trajectory) == 2
        assert cb.bound_trajectory[0]["bound"] == 100.0
        assert cb.bound_trajectory[1]["bound"] == 90.0
        assert all(set(p) == {"t", "bound"} for p in cb.bound_trajectory)
        assert all(p["t"] >= 0.0 for p in cb.bound_trajectory)
        assert cb.truncated is False

    def test_caps_at_max_points_and_sets_truncated(self) -> None:
        cb = BestBoundCallback(time.monotonic())
        for i in range(_MAX_TRAJECTORY_POINTS + 50):
            cb(float(i))
        assert len(cb.bound_trajectory) == _MAX_TRAJECTORY_POINTS
        assert cb.truncated is True


class TestSolverProgressCallbackTrajectory:
    def test_records_objective_trajectory_during_solve(self) -> None:
        model = cp_model.CpModel()
        xs = [model.NewIntVar(0, 50, f"x{i}") for i in range(8)]
        model.Add(sum(xs) <= 100)
        model.Maximize(sum((i + 1) * xs[i] for i in range(8)))
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        solver.parameters.max_time_in_seconds = 0.5

        cb = SolverProgressCallback(MagicMock(spec=ConstraintLogger), time.monotonic())
        solver.Solve(model, cb)

        assert len(cb.objective_trajectory) >= 1
        for p in cb.objective_trajectory:
            assert set(p) == {"t", "objective", "bound"}
            assert p["t"] >= 0.0
        ts = [p["t"] for p in cb.objective_trajectory]
        assert ts == sorted(ts)

    def test_caps_objective_trajectory_and_sets_truncated(self) -> None:
        """objective_trajectory is capped in lockstep with the bound surface."""

        class _StubProgressCallback(SolverProgressCallback):
            # on_solution_callback reads these off the CP-SAT base class; stub
            # them so the cap can be exercised without a live 2000-solution solve.
            def ObjectiveValue(self) -> float:  # noqa: N802 — matches OR-Tools API
                return 1.0

            def BestObjectiveBound(self) -> float:  # noqa: N802 — matches OR-Tools API
                return 0.0

        cb = _StubProgressCallback(MagicMock(spec=ConstraintLogger), time.monotonic())
        for _ in range(_MAX_TRAJECTORY_POINTS + 50):
            cb.on_solution_callback()
        assert len(cb.objective_trajectory) == _MAX_TRAJECTORY_POINTS
        assert cb.truncated is True
