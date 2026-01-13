"""
Unit tests for gender constraint - CRITICAL safety constraint.

This constraint prevents:
- Male campers in female cabins (B- prefix)
- Female campers in male cabins (G- prefix)

Mixed/AG cabins accept any gender.

This is the highest-risk constraint - a bug here means wrong-gender assignments.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from bunking.solver.constraints.gender import add_gender_constraints

from ..conftest import build_solver_context, create_bunk, create_person, is_infeasible, is_optimal_or_feasible


class TestGenderConstraintBasics:
    """Test core gender constraint behavior."""

    def test_male_cannot_be_in_female_cabin(self):
        """A male camper must be forbidden from female cabins."""
        # Setup: 1 male camper, 1 female bunk, 1 male bunk
        male = create_person(cm_id=1001, first_name="John", last_name="Doe", gender="M", grade=5)
        female_bunk = create_bunk(cm_id=2001, name="G-1", gender="F")
        male_bunk = create_bunk(cm_id=2002, name="B-1", gender="M")

        ctx = build_solver_context(persons=[male], bunks=[female_bunk, male_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible (male can go to male bunk)
        assert is_optimal_or_feasible(status)

        # Verify: male is in male bunk (B-1), not female bunk (G-1)
        male_idx = ctx.person_idx_map[1001]
        female_bunk_idx = ctx.bunk_idx_map[2001]
        male_bunk_idx = ctx.bunk_idx_map[2002]

        assert solver.Value(ctx.assignments[(male_idx, female_bunk_idx)]) == 0
        assert solver.Value(ctx.assignments[(male_idx, male_bunk_idx)]) == 1

    def test_female_cannot_be_in_male_cabin(self):
        """A female camper must be forbidden from male cabins."""
        # Setup: 1 female camper, 1 male bunk, 1 female bunk
        female = create_person(cm_id=1001, first_name="Jane", last_name="Smith", gender="F", grade=5)
        male_bunk = create_bunk(cm_id=2001, name="B-1", gender="M")
        female_bunk = create_bunk(cm_id=2002, name="G-1", gender="F")

        ctx = build_solver_context(persons=[female], bunks=[male_bunk, female_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible (female can go to female bunk)
        assert is_optimal_or_feasible(status)

        # Verify: female is in female bunk (G-1), not male bunk (B-1)
        female_idx = ctx.person_idx_map[1001]
        male_bunk_idx = ctx.bunk_idx_map[2001]
        female_bunk_idx = ctx.bunk_idx_map[2002]

        assert solver.Value(ctx.assignments[(female_idx, male_bunk_idx)]) == 0
        assert solver.Value(ctx.assignments[(female_idx, female_bunk_idx)]) == 1

    def test_mixed_cabin_accepts_any_gender(self):
        """Mixed/AG cabins should accept both male and female campers."""
        # Setup: 1 male, 1 female, 1 mixed bunk (only option)
        male = create_person(cm_id=1001, first_name="John", last_name="Doe", gender="M", grade=5)
        female = create_person(cm_id=1002, first_name="Jane", last_name="Smith", gender="F", grade=5)
        mixed_bunk = create_bunk(cm_id=2001, name="AG-1", gender="Mixed", capacity=12)

        ctx = build_solver_context(persons=[male, female], bunks=[mixed_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible - both can go to mixed bunk
        assert is_optimal_or_feasible(status)

        # Verify: both campers are in mixed bunk
        male_idx = ctx.person_idx_map[1001]
        female_idx = ctx.person_idx_map[1002]
        mixed_bunk_idx = ctx.bunk_idx_map[2001]

        assert solver.Value(ctx.assignments[(male_idx, mixed_bunk_idx)]) == 1
        assert solver.Value(ctx.assignments[(female_idx, mixed_bunk_idx)]) == 1

    def test_ag_gender_value_allows_any(self):
        """AG bunks (gender='AG') should also accept any gender."""
        male = create_person(cm_id=1001, first_name="John", last_name="Doe", gender="M", grade=5)
        ag_bunk = create_bunk(cm_id=2001, name="AG-8", gender="AG", capacity=12)

        ctx = build_solver_context(persons=[male], bunks=[ag_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be feasible
        assert is_optimal_or_feasible(status)

        # Verify male is in AG bunk
        male_idx = ctx.person_idx_map[1001]
        ag_bunk_idx = ctx.bunk_idx_map[2001]
        assert solver.Value(ctx.assignments[(male_idx, ag_bunk_idx)]) == 1


class TestGenderConstraintInfeasibility:
    """Test scenarios where gender constraint makes solution infeasible."""

    def test_male_only_with_female_bunks_infeasible(self):
        """A male camper with only female bunks should be infeasible."""
        male = create_person(cm_id=1001, first_name="John", last_name="Doe", gender="M", grade=5)
        female_bunk = create_bunk(cm_id=2001, name="G-1", gender="F")

        ctx = build_solver_context(persons=[male], bunks=[female_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be INFEASIBLE - no valid placement
        assert is_infeasible(status)

    def test_female_only_with_male_bunks_infeasible(self):
        """A female camper with only male bunks should be infeasible."""
        female = create_person(cm_id=1001, first_name="Jane", last_name="Smith", gender="F", grade=5)
        male_bunk = create_bunk(cm_id=2001, name="B-1", gender="M")

        ctx = build_solver_context(persons=[female], bunks=[male_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # Should be INFEASIBLE - no valid placement
        assert is_infeasible(status)


class TestGenderConstraintEdgeCases:
    """Test edge cases for gender constraint."""

    def test_missing_gender_data_not_constrained(self):
        """Campers with no gender data should not be constrained."""
        # Person with None gender
        no_gender = create_person(cm_id=1001, first_name="Alex", last_name="Unknown", gender=None, grade=5)
        # Workaround: create_person sets gender to the value, but we need None
        no_gender.gender = None

        female_bunk = create_bunk(cm_id=2001, name="G-1", gender="F")

        ctx = build_solver_context(persons=[no_gender], bunks=[female_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve - should be feasible (no constraint applied for unknown gender)
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

    def test_bunk_with_no_gender_not_constrained(self):
        """Bunks with no gender specified should accept any camper."""
        male = create_person(cm_id=1001, first_name="John", last_name="Doe", gender="M", grade=5)
        no_gender_bunk = create_bunk(cm_id=2001, name="Cabin-1", gender=None)
        # Workaround
        no_gender_bunk.gender = None

        ctx = build_solver_context(persons=[male], bunks=[no_gender_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve - should be feasible
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

    def test_constraint_can_be_disabled(self):
        """Gender constraint should be skippable via debug_constraints."""
        # Setup that would normally be infeasible
        male = create_person(cm_id=1001, first_name="John", last_name="Doe", gender="M", grade=5)
        female_bunk = create_bunk(cm_id=2001, name="G-1", gender="F")

        ctx = build_solver_context(
            persons=[male],
            bunks=[female_bunk],
            debug_constraints={"gender": True},  # Disable gender constraint
        )

        # Apply gender constraint (should be skipped)
        add_gender_constraints(ctx)

        # Solve - should be feasible since constraint was disabled
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)


class TestGenderConstraintMultipleCampers:
    """Test gender constraint with multiple campers."""

    def test_multiple_campers_correct_segregation(self):
        """Multiple campers of both genders should be correctly segregated."""
        # 3 males, 2 females
        males = [
            create_person(cm_id=1001, first_name="John", last_name="Doe", gender="M", grade=5),
            create_person(cm_id=1002, first_name="Jake", last_name="Smith", gender="M", grade=5),
            create_person(cm_id=1003, first_name="Jim", last_name="Brown", gender="M", grade=5),
        ]
        females = [
            create_person(cm_id=1004, first_name="Jane", last_name="Doe", gender="F", grade=5),
            create_person(cm_id=1005, first_name="Jill", last_name="Smith", gender="F", grade=5),
        ]
        persons = males + females

        male_bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)
        female_bunk = create_bunk(cm_id=2002, name="G-1", gender="F", capacity=12)

        ctx = build_solver_context(persons=persons, bunks=[male_bunk, female_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Verify: all males in male bunk, all females in female bunk
        male_bunk_idx = ctx.bunk_idx_map[2001]
        female_bunk_idx = ctx.bunk_idx_map[2002]

        for male in males:
            male_idx = ctx.person_idx_map[male.campminder_person_id]
            assert solver.Value(ctx.assignments[(male_idx, male_bunk_idx)]) == 1
            assert solver.Value(ctx.assignments[(male_idx, female_bunk_idx)]) == 0

        for female in females:
            female_idx = ctx.person_idx_map[female.campminder_person_id]
            assert solver.Value(ctx.assignments[(female_idx, female_bunk_idx)]) == 1
            assert solver.Value(ctx.assignments[(female_idx, male_bunk_idx)]) == 0

    def test_mixed_and_gendered_bunks_together(self):
        """Males can go to either male bunks or mixed bunks (not female bunks)."""
        # 2 males, male bunk has capacity 1, mixed bunk has capacity 12
        males = [
            create_person(cm_id=1001, first_name="John", last_name="Doe", gender="M", grade=5),
            create_person(cm_id=1002, first_name="Jake", last_name="Smith", gender="M", grade=5),
        ]

        male_bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=1)
        mixed_bunk = create_bunk(cm_id=2002, name="AG-1", gender="Mixed", capacity=12)
        female_bunk = create_bunk(cm_id=2003, name="G-1", gender="F", capacity=12)

        ctx = build_solver_context(persons=males, bunks=[male_bunk, mixed_bunk, female_bunk])

        # Apply gender constraint
        add_gender_constraints(ctx)

        # Add capacity constraint (male bunk can only hold 1)
        male_bunk_idx = ctx.bunk_idx_map[2001]
        ctx.model.Add(sum(ctx.assignments[(i, male_bunk_idx)] for i in range(len(males))) <= 1)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Verify: no males in female bunk (the key constraint)
        female_bunk_idx = ctx.bunk_idx_map[2003]
        mixed_bunk_idx = ctx.bunk_idx_map[2002]

        for male in males:
            male_idx = ctx.person_idx_map[male.campminder_person_id]
            # Must NOT be in female bunk
            assert solver.Value(ctx.assignments[(male_idx, female_bunk_idx)]) == 0
            # Must be in either male or mixed bunk
            in_male = solver.Value(ctx.assignments[(male_idx, male_bunk_idx)])
            in_mixed = solver.Value(ctx.assignments[(male_idx, mixed_bunk_idx)])
            assert in_male + in_mixed == 1

        # Verify capacity respected
        male_bunk_count = sum(
            solver.Value(ctx.assignments[(ctx.person_idx_map[m.campminder_person_id], male_bunk_idx)]) for m in males
        )
        assert male_bunk_count <= 1
