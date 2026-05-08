"""TDD tests for stats helpers added to direct_solver.

These tests define the expected behavior of the new helpers used to capture
CP-SAT internals on every solver run. Implementation must conform to these
tests, not the other way around.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from ortools.sat.python import cp_model

from bunking.models_v2 import DirectBunk, DirectPerson, DirectSolverInput
from bunking.solver.direct_solver import DirectBunkingSolver, _compute_optimality_gap, _count_constraint_types


class TestCountConstraintTypes:
    def test_empty_model_returns_empty_dict(self) -> None:
        model = cp_model.CpModel()
        result = _count_constraint_types(model.Proto())
        assert result == {}

    def test_counts_bool_and_constraints(self) -> None:
        model = cp_model.CpModel()
        a = model.NewBoolVar("a")
        b = model.NewBoolVar("b")
        model.AddBoolAnd([a, b])
        model.AddBoolAnd([a, b.Not()])
        result = _count_constraint_types(model.Proto())
        assert result["bool_and"] == 2

    def test_counts_mixed_types(self) -> None:
        model = cp_model.CpModel()
        a = model.NewBoolVar("a")
        b = model.NewBoolVar("b")
        x = model.NewIntVar(0, 10, "x")
        model.AddBoolAnd([a, b])
        model.AddBoolOr([a, b])
        model.Add(x >= 5)
        result = _count_constraint_types(model.Proto())
        assert result["bool_and"] == 1
        assert result["bool_or"] == 1
        assert result["linear"] == 1


class TestComputeOptimalityGap:
    def test_returns_zero_when_objective_equals_bound(self) -> None:
        assert _compute_optimality_gap(100.0, 100.0) == 0.0

    def test_returns_none_when_objective_is_none(self) -> None:
        assert _compute_optimality_gap(None, 100.0) is None

    def test_returns_none_when_bound_is_none(self) -> None:
        assert _compute_optimality_gap(100.0, None) is None

    def test_computes_relative_gap(self) -> None:
        # |102 - 100| / max(|102|, 1) = 2 / 102 ≈ 0.0196
        result = _compute_optimality_gap(102.0, 100.0)
        assert result is not None
        assert abs(result - (2.0 / 102.0)) < 1e-9

    def test_handles_zero_objective(self) -> None:
        # |0 - 0| / max(|0|, 1) = 0
        assert _compute_optimality_gap(0.0, 0.0) == 0.0


class TestBuildStatsDict:
    """Tests for _build_stats_dict — the always-on CP-SAT internals capture."""

    def _make_solver(self, **overrides: object) -> object:
        """Build a MagicMock standing in for cp_model.CpSolver with sensible defaults."""
        from unittest.mock import MagicMock

        solver = MagicMock()
        solver.StatusName.return_value = "OPTIMAL"
        solver.ObjectiveValue.return_value = 100.0
        solver.WallTime.return_value = 23.1
        solver.UserTime.return_value = 47.1
        solver.DeterministicTime.return_value = 4.3e8
        solver.BestObjectiveBound.return_value = 100.0
        solver.NumBranches.return_value = 3210
        solver.NumConflicts.return_value = 147
        solver.NumBooleans.return_value = 14801
        solver.NumIntegers.return_value = 433
        response = MagicMock(gap_integral=67.2, num_solutions=7, solution_info="feasibility_jump_search worker 3")
        solver.ResponseProto.return_value = response
        for k, v in overrides.items():
            getattr(solver, k).return_value = v
        return solver

    def _make_proto(self, num_vars: int = 0) -> object:
        from unittest.mock import MagicMock

        proto = MagicMock()
        proto.variables = [MagicMock()] * num_vars
        proto.constraints = []  # constraint_type_breakdown tested separately
        return proto

    def test_includes_existing_back_compat_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(15234),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=98,
            num_bunks=12,
            num_requests=240,
            satisfied_count=235,
        )

        # Existing back-compat fields preserved
        assert stats["status"] == "OPTIMAL"
        assert stats["objective_value"] == 100.0
        assert stats["solve_time"] == 23.1
        assert stats["total_persons"] == 98
        assert stats["total_bunks"] == 12
        assert stats["total_requests"] == 240
        assert stats["satisfied_request_count"] == 235

    def test_includes_new_timing_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )
        assert stats["walltime_seconds"] == 23.1
        assert stats["user_time_seconds"] == 47.1
        assert stats["deterministic_time"] == 4.3e8
        assert stats["time_budget_seconds"] == 60
        assert stats["num_workers"] == 8

    def test_includes_new_quality_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )
        assert stats["best_objective_bound"] == 100.0
        assert stats["optimality_gap"] == 0.0
        assert stats["gap_integral"] == 67.2
        assert stats["num_solutions_found"] == 7
        assert stats["solution_info"] == "feasibility_jump_search worker 3"

    def test_includes_new_search_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )
        assert stats["num_branches"] == 3210
        assert stats["num_conflicts"] == 147
        assert stats["num_booleans"] == 14801
        assert stats["num_integer_variables"] == 433

    def test_includes_new_model_fields(self) -> None:
        from bunking.solver.direct_solver import _build_stats_dict

        stats = _build_stats_dict(
            solver=self._make_solver(),
            status=4,
            model_proto=self._make_proto(15234),
            time_limit_seconds=60,
            num_workers=8,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )
        assert stats["model_num_variables"] == 15234
        assert stats["model_num_constraints"] == 0
        assert stats["constraint_type_breakdown"] == {}

    def test_handles_missing_ortools_methods_gracefully(self) -> None:
        """getattr guards must return None when OR-Tools API drifts, not raise."""
        from unittest.mock import MagicMock

        from bunking.solver.direct_solver import _build_stats_dict

        # spec= limits which methods exist; missing ones must default to None
        solver = MagicMock(
            spec=[
                "StatusName",
                "ObjectiveValue",
                "WallTime",
                "NumBranches",
                "NumConflicts",
                "NumBooleans",
                "ResponseProto",
            ]
        )
        solver.StatusName.return_value = "FEASIBLE"
        solver.ObjectiveValue.return_value = 50.0
        solver.WallTime.return_value = 10.0
        solver.NumBranches.return_value = 100
        solver.NumConflicts.return_value = 5
        solver.NumBooleans.return_value = 200
        solver.ResponseProto.return_value = MagicMock(gap_integral=None, num_solutions=None, solution_info="")

        stats = _build_stats_dict(
            solver=solver,
            status=2,
            model_proto=self._make_proto(),
            time_limit_seconds=30,
            num_workers=4,
            num_persons=1,
            num_bunks=1,
            num_requests=1,
            satisfied_count=1,
        )

        assert stats["user_time_seconds"] is None
        assert stats["deterministic_time"] is None
        assert stats["best_objective_bound"] is None
        assert stats["num_integer_variables"] is None
        assert stats["optimality_gap"] is None  # bound was None


class TestSingleBunkPathStats:
    """Single-bunk sessions (e.g. AG) take a simplified path that bypasses CP-SAT.

    The new impact-analysis flow persists `solver_runs.stats`; without a stats
    payload single-bunk runs would appear as empty rows in the debug table.
    A minimal stats dict with the same shape as the multi-bunk path keeps
    them consistent — even if many CP-SAT-only fields are None.
    """

    def _make_input(self, num_persons: int = 3) -> DirectSolverInput:
        bunk = DirectBunk(
            id="bunk-1",
            campminder_id=9001,
            name="AG-1",
            capacity=12,
            gender="Mixed",
            session_cm_id=500,
        )
        persons = [
            DirectPerson(
                campminder_person_id=1000 + i,
                first_name=f"Camper{i}",
                last_name="Test",
                grade=8,
                birthdate="2014-01-01",
                gender="M" if i % 2 == 0 else "F",
                session_cm_id=500,
            )
            for i in range(num_persons)
        ]
        return DirectSolverInput(persons=persons, requests=[], bunks=[bunk])

    def test_single_bunk_solve_populates_stats(self) -> None:
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert isinstance(result.stats, dict)
        assert result.stats, "single-bunk runs must populate stats so the debug UI is consistent"

    def test_single_bunk_stats_includes_marker(self) -> None:
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.stats.get("single_bunk_session") is True

    def test_single_bunk_stats_includes_persons_and_bunks_counts(self) -> None:
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.stats.get("total_persons") == 3
        assert result.stats.get("total_bunks") == 1

    def test_single_bunk_stats_status_is_optimal(self) -> None:
        """Trivial: every camper assigned to the only bunk → 'OPTIMAL'."""
        solver = DirectBunkingSolver(input_data=self._make_input(3), config_service=MagicMock())
        result = solver.solve(time_limit_seconds=10)
        assert result is not None
        assert result.stats.get("status") == "OPTIMAL"
