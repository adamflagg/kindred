"""
Unit tests for cabin capacity constraints.

Hard-only after Phase 2 cleanup: solver caps at
``min(bunk.capacity, DEFAULT_BUNK_CAPACITY)`` and the soft penalty path was
deleted along with ``constraint.cabin_capacity.{mode, penalty}``. The
"never used soft" rationale is captured in
``docs/reference/solver-config-decisions.md``.
"""

from ortools.sat.python import cp_model

from bunking.solver.constants import DEFAULT_BUNK_CAPACITY
from bunking.solver.constraints.cabin_capacity import add_cabin_capacity_constraints
from bunking.solver.constraints.gender import add_gender_constraints

from ..conftest import (
    build_solver_context,
    create_bunk,
    create_person,
    is_infeasible,
    is_optimal_or_feasible,
)


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

    def test_caps_at_default_even_when_bunk_capacity_higher(self):
        """Hard constraint caps at DEFAULT_BUNK_CAPACITY even if bunk.capacity is higher.

        Phase 2: this used to test that the config ``constraint.cabin_capacity.max``
        clamped per-bunk capacity. The config key was deleted; the constant
        ``DEFAULT_BUNK_CAPACITY`` is now the cap (=12). A bunk with capacity 20
        gets clamped to 12 — placing more than 12 campers is infeasible.
        """
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(DEFAULT_BUNK_CAPACITY + 1)  # 13 campers — one over the cap
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=20)

        ctx = build_solver_context(persons=campers, bunks=[bunk])

        add_cabin_capacity_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Solver caps at DEFAULT_BUNK_CAPACITY (=12); 13 campers in 1 bunk is infeasible
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


class TestOverflowCapacity:
    def test_overflow_allows_13(self):
        # allow_overflow=True → cap raised to 13.
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(13)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=20)
        ctx = build_solver_context(persons=campers, bunks=[bunk])
        ctx.input.allow_overflow = True
        add_cabin_capacity_constraints(ctx)
        assert is_optimal_or_feasible(cp_model.CpSolver().Solve(ctx.model))  # 13 fits

    def test_overflow_caps_at_13_not_14(self):
        # Even with overflow, 14 campers in a single bunk is still infeasible.
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(14)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=20)
        ctx = build_solver_context(persons=campers, bunks=[bunk])
        ctx.input.allow_overflow = True
        add_cabin_capacity_constraints(ctx)
        assert is_infeasible(cp_model.CpSolver().Solve(ctx.model))  # 14 > 13

    def test_overflow_respects_smaller_per_bunk_capacity(self):
        # Overflow raises the cap by exactly one seat above the bunk's own capacity;
        # it must NOT jump a sub-standard cabin straight to 13. A capacity-8 specialty
        # cabin tops out at 9 under overflow, not 13.
        campers = [
            create_person(cm_id=1001 + i, first_name=f"Camper{i}", last_name="Test", gender="M", grade=5)
            for i in range(10)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=8)
        ctx = build_solver_context(persons=campers, bunks=[bunk])
        ctx.input.allow_overflow = True
        add_cabin_capacity_constraints(ctx)
        assert is_infeasible(cp_model.CpSolver().Solve(ctx.model))  # 10 > 9 (8 + 1)
