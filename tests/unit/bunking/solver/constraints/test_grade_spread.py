"""
Unit tests for grade spread constraints.

Phase 2 (Grade Spread): the soft path was deleted, ``constraint.grade_spread.{mode,
penalty}`` config rows were removed, and the phantom
``constraint.grade_spread.max_spread`` collapsed into
``MAX_UNIQUE_GRADES_PER_BUNK`` in ``bunking.solver.constants``. Solver is
hard-only; staff can override on the bunking board.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from bunking.solver.constants import MAX_UNIQUE_GRADES_PER_BUNK
from bunking.solver.constraints.grade_spread import add_grade_spread_constraints

from ..conftest import (
    build_solver_context,
    create_bunk,
    create_person,
    is_infeasible,
    is_optimal_or_feasible,
)


class TestHardGradeSpreadConstraint:
    """Test hard grade spread constraints."""

    def test_same_grade_allowed(self):
        """Campers of same grade can be in same bunk."""
        campers = [
            create_person(cm_id=1001, first_name="Camper1", last_name="Test", gender="M", grade=5),
            create_person(cm_id=1002, first_name="Camper2", last_name="Test", gender="M", grade=5),
            create_person(cm_id=1003, first_name="Camper3", last_name="Test", gender="M", grade=5),
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(persons=campers, bunks=[bunk])

        add_grade_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible (all same grade = 1 unique grade)
        assert is_optimal_or_feasible(status)

    def test_two_grades_allowed(self):
        """Two different grades can be in same bunk (max is 2)."""
        campers = [
            create_person(cm_id=1001, first_name="Camper1", last_name="Test", gender="M", grade=4),
            create_person(cm_id=1002, first_name="Camper2", last_name="Test", gender="M", grade=4),
            create_person(cm_id=1003, first_name="Camper3", last_name="Test", gender="M", grade=5),
            create_person(cm_id=1004, first_name="Camper4", last_name="Test", gender="M", grade=5),
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(persons=campers, bunks=[bunk])

        add_grade_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible (2 unique grades, max is 2)
        assert is_optimal_or_feasible(status)
        assert MAX_UNIQUE_GRADES_PER_BUNK == 2

    def test_three_grades_infeasible_in_single_bunk(self):
        """Three different grades in one bunk exceeds limit."""
        # 3 campers from 3 different grades, only 1 bunk
        campers = [
            create_person(cm_id=1001, first_name="Camper1", last_name="Test", gender="M", grade=4),
            create_person(cm_id=1002, first_name="Camper2", last_name="Test", gender="M", grade=5),
            create_person(cm_id=1003, first_name="Camper3", last_name="Test", gender="M", grade=6),
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(persons=campers, bunks=[bunk])

        add_grade_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be INFEASIBLE (3 grades > 2 max)
        assert is_infeasible(status)

    def test_three_grades_feasible_with_two_bunks(self):
        """Three grades can be distributed across two bunks."""
        campers = [
            create_person(cm_id=1001, first_name="Grade4", last_name="Test", gender="M", grade=4),
            create_person(cm_id=1002, first_name="Grade5", last_name="Test", gender="M", grade=5),
            create_person(cm_id=1003, first_name="Grade6", last_name="Test", gender="M", grade=6),
        ]
        bunks = [
            create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12),
            create_bunk(cm_id=2002, name="B-2", gender="M", capacity=12),
        ]

        ctx = build_solver_context(persons=campers, bunks=bunks)

        add_grade_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible - solver can split grades across bunks
        # E.g., grades 4,5 in B-1 and grade 6 in B-2
        assert is_optimal_or_feasible(status)

        # Verify each bunk has at most MAX_UNIQUE_GRADES_PER_BUNK unique grades
        for bunk in bunks:
            bunk_idx = ctx.bunk_idx_map[bunk.campminder_id]
            grades_in_bunk = set()
            for camper in campers:
                person_idx = ctx.person_idx_map[camper.campminder_person_id]
                if solver.Value(ctx.assignments[(person_idx, bunk_idx)]) == 1:
                    grades_in_bunk.add(camper.grade)
            assert len(grades_in_bunk) <= MAX_UNIQUE_GRADES_PER_BUNK

    def test_constraint_can_be_disabled(self):
        """Grade spread constraint can be disabled via debug_constraints."""
        # Setup that would normally be infeasible
        campers = [
            create_person(cm_id=1001, first_name="Camper1", last_name="Test", gender="M", grade=4),
            create_person(cm_id=1002, first_name="Camper2", last_name="Test", gender="M", grade=5),
            create_person(cm_id=1003, first_name="Camper3", last_name="Test", gender="M", grade=6),
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            debug_constraints={"grade_spread": True},  # Disable grade spread
        )

        add_grade_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible since constraint is disabled
        assert is_optimal_or_feasible(status)


class TestGradeSpreadWithMixedBunks:
    """Test grade spread with AG/Mixed bunks."""

    def test_mixed_bunks_have_no_grade_constraint(self):
        """AG/Mixed bunks should not have grade spread constraints."""
        # 3 grades in AG bunk should be fine
        campers = [
            create_person(cm_id=1001, first_name="Camper1", last_name="Test", gender="M", grade=4),
            create_person(cm_id=1002, first_name="Camper2", last_name="Test", gender="F", grade=5),
            create_person(cm_id=1003, first_name="Camper3", last_name="Test", gender="M", grade=6),
        ]
        # Mixed bunk accepts all genders and has no grade spread constraint
        mixed_bunk = create_bunk(cm_id=2001, name="AG-1", gender="Mixed", capacity=12)

        ctx = build_solver_context(persons=campers, bunks=[mixed_bunk])

        add_grade_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible - AG bunks exempt from grade spread
        assert is_optimal_or_feasible(status)
