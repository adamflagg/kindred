"""
Unit tests for cabin capacity constraints.

Tests both hard and soft capacity modes:
- Hard mode: Strict max capacity - solver fails if exceeded
- Soft mode: Allows overflow up to max but penalizes assignments beyond standard capacity

Also tests the unavoidable overflow exception where extra campers are exempt from penalty.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from bunking.solver.constraints.cabin_capacity import (
    add_cabin_capacity_constraints,
    add_cabin_capacity_soft_constraint,
)
from bunking.solver.constraints.gender import add_gender_constraints

from ..conftest import build_solver_context, create_bunk, create_person, is_infeasible, is_optimal_or_feasible


class TestHardCapacityConstraint:
    """Test hard cabin capacity constraints."""

    def test_respects_bunk_capacity(self):
        """Solver cannot assign more campers than capacity."""
        # 5 campers, 1 bunk with capacity 3 = infeasible
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(5)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=3)

        ctx = build_solver_context(persons=campers, bunks=[bunk])

        # Apply capacity constraint
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be INFEASIBLE - 5 campers can't fit in capacity-3 bunk
        assert is_infeasible(status)

    def test_feasible_at_exact_capacity(self):
        """Solver can assign exactly capacity campers."""
        # 3 campers, 1 bunk with capacity 3 = feasible
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(3)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=3)

        ctx = build_solver_context(persons=campers, bunks=[bunk])

        # Apply capacity constraint
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible
        assert is_optimal_or_feasible(status)

        # All 3 campers in the bunk
        bunk_idx = ctx.bunk_idx_map[2001]
        count = sum(
            solver.Value(ctx.assignments[(ctx.person_idx_map[c.campminder_person_id], bunk_idx)]) for c in campers
        )
        assert count == 3

    def test_feasible_under_capacity(self):
        """Solver can assign fewer campers than capacity."""
        # 2 campers, 1 bunk with capacity 3 = feasible
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(2)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=3)

        ctx = build_solver_context(persons=campers, bunks=[bunk])

        # Apply capacity constraint
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible
        assert is_optimal_or_feasible(status)

    def test_distributes_across_bunks_when_needed(self):
        """Solver distributes campers across bunks to satisfy capacity."""
        # 6 campers, 2 bunks with capacity 4 each = feasible with distribution
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(6)
        ]
        bunk1 = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=4)
        bunk2 = create_bunk(cm_id=2002, name="B-2", gender="M", capacity=4)

        ctx = build_solver_context(persons=campers, bunks=[bunk1, bunk2])

        # Apply capacity constraint
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible
        assert is_optimal_or_feasible(status)

        # Each bunk should have at most 4 campers
        bunk1_idx = ctx.bunk_idx_map[2001]
        bunk2_idx = ctx.bunk_idx_map[2002]

        count1 = sum(
            solver.Value(ctx.assignments[(ctx.person_idx_map[c.campminder_person_id], bunk1_idx)]) for c in campers
        )
        count2 = sum(
            solver.Value(ctx.assignments[(ctx.person_idx_map[c.campminder_person_id], bunk2_idx)]) for c in campers
        )

        assert count1 <= 4
        assert count2 <= 4
        assert count1 + count2 == 6

    def test_respects_max_capacity_config(self):
        """Hard constraint respects max capacity from config even if bunk.capacity is higher."""
        # Bunk has capacity 20, but config max is 14
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(16)  # More than config max (14)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=20)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={"constraint.cabin_capacity.max": 14},
        )

        # Apply capacity constraint
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be INFEASIBLE - 16 > 14 (config max)
        assert is_infeasible(status)


class TestSoftCapacityConstraint:
    """Test soft cabin capacity constraints with penalties."""

    def test_allows_overflow_up_to_max(self):
        """Soft constraint allows overflow up to max capacity."""
        # 14 campers, bunk with capacity 14 (max), standard is 12
        # Soft constraint penalizes the 2 over standard but allows it
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(14)
        ]
        # Set bunk capacity to max (14) - hard constraint allows this
        # Soft constraint will penalize 13th and 14th camper
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=14)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.cabin_capacity.max": 14,
                "constraint.cabin_capacity.standard": 12,
                "constraint.cabin_capacity.mode": "soft",
                "constraint.cabin_capacity.penalty": 50000,
            },
        )

        # Apply hard capacity (max) and soft penalties
        add_cabin_capacity_constraints(ctx)
        objective_terms: list[cp_model.LinearExprT] = []
        add_cabin_capacity_soft_constraint(ctx, objective_terms)

        # Add objective to maximize (with penalties as negative)
        ctx.model.Maximize(sum(objective_terms))

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible (allows up to 14)
        assert is_optimal_or_feasible(status)

    def test_prevents_exceeding_max_even_in_soft_mode(self):
        """Even in soft mode, cannot exceed max capacity."""
        # 15 campers, bunk with max capacity 14
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(15)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.cabin_capacity.max": 14,
                "constraint.cabin_capacity.standard": 12,
                "constraint.cabin_capacity.mode": "soft",
            },
        )

        # Apply hard capacity constraint
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be INFEASIBLE - 15 > 14 max
        assert is_infeasible(status)


class TestCapacityWithGenderConstraints:
    """Test capacity constraints combined with gender constraints."""

    def test_gender_plus_capacity(self):
        """Capacity and gender constraints work together."""
        # 6 males, 6 females, 2 bunks (1 male cap 4, 1 female cap 4) = infeasible
        males = [
            create_person(cm_id=1001 + i, first_name=f"Male{i}", last_name="Test", gender="M", grade=5)
            for i in range(6)
        ]
        females = [
            create_person(cm_id=2001 + i, first_name=f"Female{i}", last_name="Test", gender="F", grade=5)
            for i in range(6)
        ]
        male_bunk = create_bunk(cm_id=3001, name="B-1", gender="M", capacity=4)
        female_bunk = create_bunk(cm_id=3002, name="G-1", gender="F", capacity=4)

        ctx = build_solver_context(
            persons=males + females,
            bunks=[male_bunk, female_bunk],
        )

        # Apply both constraints
        add_gender_constraints(ctx)
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Infeasible: 6 males can't fit in 4-capacity male bunk
        assert is_infeasible(status)

    def test_gender_plus_capacity_feasible(self):
        """Gender and capacity work together when feasible."""
        # 4 males, 4 females, 2 bunks (1 male cap 6, 1 female cap 6) = feasible
        males = [
            create_person(cm_id=1001 + i, first_name=f"Male{i}", last_name="Test", gender="M", grade=5)
            for i in range(4)
        ]
        females = [
            create_person(cm_id=2001 + i, first_name=f"Female{i}", last_name="Test", gender="F", grade=5)
            for i in range(4)
        ]
        male_bunk = create_bunk(cm_id=3001, name="B-1", gender="M", capacity=6)
        female_bunk = create_bunk(cm_id=3002, name="G-1", gender="F", capacity=6)

        ctx = build_solver_context(
            persons=males + females,
            bunks=[male_bunk, female_bunk],
        )

        # Apply both constraints
        add_gender_constraints(ctx)
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Verify segregation
        male_bunk_idx = ctx.bunk_idx_map[3001]
        female_bunk_idx = ctx.bunk_idx_map[3002]

        male_count = sum(
            solver.Value(ctx.assignments[(ctx.person_idx_map[m.campminder_person_id], male_bunk_idx)]) for m in males
        )
        female_count = sum(
            solver.Value(ctx.assignments[(ctx.person_idx_map[f.campminder_person_id], female_bunk_idx)])
            for f in females
        )

        assert male_count == 4
        assert female_count == 4


class TestCapacityMultipleBunks:
    """Test capacity constraints with multiple bunks."""

    def test_distributes_evenly_when_possible(self):
        """Solver can distribute campers evenly across multiple bunks."""
        # 8 campers, 4 bunks with capacity 3 each = feasible
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(8)
        ]
        bunks = [create_bunk(cm_id=2001 + i, name=f"B-{i + 1}", gender="M", capacity=3) for i in range(4)]

        ctx = build_solver_context(persons=campers, bunks=bunks)

        # Apply capacity constraint
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Verify each bunk has at most 3 campers
        for bunk in bunks:
            bunk_idx = ctx.bunk_idx_map[bunk.campminder_id]
            count = sum(
                solver.Value(ctx.assignments[(ctx.person_idx_map[c.campminder_person_id], bunk_idx)]) for c in campers
            )
            assert count <= 3

    def test_infeasible_with_insufficient_total_capacity(self):
        """Infeasible when total capacity across all bunks is insufficient."""
        # 10 campers, 3 bunks with capacity 3 each = 9 total capacity = infeasible
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(10)
        ]
        bunks = [create_bunk(cm_id=2001 + i, name=f"B-{i + 1}", gender="M", capacity=3) for i in range(3)]

        ctx = build_solver_context(persons=campers, bunks=bunks)

        # Apply capacity constraint
        add_cabin_capacity_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # 10 campers > 9 total capacity = infeasible
        assert is_infeasible(status)
