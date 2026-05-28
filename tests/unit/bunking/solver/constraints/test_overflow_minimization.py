"""Unit tests for the overflow minimization objective (Stream C).

The module introduces a per-bunk ``is_overflowed`` Boolean and appends
``-LEX_DOMINANT_OVERFLOW_WEIGHT × sum(is_overflowed)`` to the objective.
These tests verify the linearization (is_overflowed iff count > 12) and the
preference for un-overflowed solutions when one exists.
"""

from typing import Any

from ortools.sat.python import cp_model

from bunking.solver.constants import DEFAULT_BUNK_CAPACITY
from bunking.solver.constraints.cabin_capacity import add_cabin_capacity_constraints
from bunking.solver.constraints.overflow_minimization import (
    LEX_DOMINANT_OVERFLOW_WEIGHT,
    add_overflow_minimization_objective,
)

from ..conftest import FICTIONAL_CAMPER_NAMES, build_solver_context, create_bunk, create_person


class TestOverflowMinimizationObjective:
    def test_is_overflowed_true_when_count_is_13(self):
        """13 campers, 1 bunk, allow_overflow=True → is_overflowed = 1."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(13)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY)
        ctx = build_solver_context(persons=campers, bunks=[bunk], allow_overflow=True)
        add_cabin_capacity_constraints(ctx)

        objective_terms: list[Any] = []
        add_overflow_minimization_objective(ctx, objective_terms)
        ctx.model.Maximize(sum(objective_terms))

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        assert solver.ObjectiveValue() == -LEX_DOMINANT_OVERFLOW_WEIGHT

    def test_is_overflowed_false_when_count_is_12(self):
        """12 campers, 1 bunk, allow_overflow=True → is_overflowed = 0."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(12)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY)
        ctx = build_solver_context(persons=campers, bunks=[bunk], allow_overflow=True)
        add_cabin_capacity_constraints(ctx)

        objective_terms: list[Any] = []
        add_overflow_minimization_objective(ctx, objective_terms)
        ctx.model.Maximize(sum(objective_terms))

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        assert solver.ObjectiveValue() == 0

    def test_penalty_prefers_balanced_split_over_overflow(self):
        """13 campers across 2 bunks: prefers 7+6 (no overflow) over 13+0."""
        campers = [
            create_person(
                cm_id=1001 + i,
                first_name=FICTIONAL_CAMPER_NAMES[i][0],
                last_name=FICTIONAL_CAMPER_NAMES[i][1],
                gender="M",
                grade=5,
            )
            for i in range(13)
        ]
        bunks = [
            create_bunk(cm_id=2001, name="B-1", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
            create_bunk(cm_id=2002, name="B-2", gender="M", capacity=DEFAULT_BUNK_CAPACITY),
        ]
        ctx = build_solver_context(persons=campers, bunks=bunks, allow_overflow=True)
        add_cabin_capacity_constraints(ctx)

        objective_terms: list[Any] = []
        add_overflow_minimization_objective(ctx, objective_terms)
        ctx.model.Maximize(sum(objective_terms))

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        assert solver.ObjectiveValue() == 0
        for bunk_idx in range(2):
            count = sum(solver.Value(ctx.assignments[(p, bunk_idx)]) for p in range(len(campers)))
            assert count <= DEFAULT_BUNK_CAPACITY
