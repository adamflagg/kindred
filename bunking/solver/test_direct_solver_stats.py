"""TDD tests for stats helpers added to direct_solver.

These tests define the expected behavior of the new helpers used to capture
CP-SAT internals on every solver run. Implementation must conform to these
tests, not the other way around.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from bunking.solver.direct_solver import _compute_optimality_gap, _count_constraint_types


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
