"""
Unit tests for age spread constraints.

Phase 2 shape (post soft→hard collapse):
- Hard constraint: ``spread <= MAX_AGE_SPREAD_MONTHS`` per non-AG bunk. Solver
  is INFEASIBLE if two campers >24mo apart are forced into the same bunk.
- Preferred bonus (soft): bunks with spread <= ``PREFERRED_AGE_SPREAD_MONTHS``
  earn ``constraint.age_spread.preferred_bonus`` in the objective. Disabled
  when the configured bonus weight is 0.

The pre-Phase-2 ``excess_spread`` / ``has_violation`` machinery is gone —
``soft_constraint_violations`` no longer contains any ``age_spread_*`` keys.
"""

from __future__ import annotations

from datetime import UTC, datetime

from ortools.sat.python import cp_model

from bunking.models_v2 import DirectPerson
from bunking.solver.constraints.age_spread import add_age_spread_constraints

from ..conftest import (
    build_solver_context,
    create_bunk,
    create_person,
    is_optimal_or_feasible,
)


def _person_with_age_months(cm_id: int, total_months: int, gender: str = "M") -> DirectPerson:
    """Create a test person whose age converts to exactly total_months."""
    today = datetime.now(tz=UTC)
    birth_year = today.year - (total_months // 12)
    birth_month = today.month - (total_months % 12)
    if birth_month <= 0:
        birth_month += 12
        birth_year -= 1
    birth_day = min(today.day, 28)
    birthdate = f"{birth_year:04d}-{birth_month:02d}-{birth_day:02d}"

    return create_person(
        cm_id=cm_id,
        first_name=f"Camper{cm_id}",
        last_name="Test",
        gender=gender,
        grade=5,
        birthdate=birthdate,
    )


class TestHard24moConstraint:
    """The hard cap: solver is INFEASIBLE if forced over the 24mo threshold."""

    def test_spread_at_24mo_boundary_is_feasible(self):
        """Spread of exactly 24mo is allowed (boundary inclusive)."""
        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m
            _person_with_age_months(1002, 168),  # 14y 0m  → 24mo spread
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={"constraint.age_spread.preferred_bonus": 500},
        )

        add_age_spread_constraints(ctx)
        # Force both campers into the same bunk
        ctx.model.Add(ctx.assignments[(0, 0)] == 1)
        ctx.model.Add(ctx.assignments[(1, 0)] == 1)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

    def test_spread_over_24mo_with_forced_assignment_is_infeasible(self):
        """Two campers 25mo apart cannot share a non-edge (middle) bunk."""
        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m
            _person_with_age_months(1002, 169),  # 14y 1m  → 25mo spread
        ]
        # Three bunks so B-5 is the middle (non-edge) bunk — hard cap applies there.
        bunk_low = create_bunk(cm_id=2001, name="B-3", gender="M", capacity=12)
        bunk_mid = create_bunk(cm_id=2002, name="B-5", gender="M", capacity=12)
        bunk_high = create_bunk(cm_id=2003, name="B-7", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk_low, bunk_mid, bunk_high],
            config_overrides={"constraint.age_spread.preferred_bonus": 500},
        )

        add_age_spread_constraints(ctx)
        # Force both campers into B-5 (bunk_idx=1 after sorting bunks by cm_id).
        ctx.model.Add(ctx.assignments[(0, 1)] == 1)
        ctx.model.Add(ctx.assignments[(1, 1)] == 1)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert status == cp_model.INFEASIBLE

    def test_no_age_spread_entries_in_soft_violations(self):
        """The soft penalty path is deleted — no `age_spread_*` violation keys."""
        campers = [
            _person_with_age_months(1001, 144),
            _person_with_age_months(1002, 156),  # 12mo spread (well within)
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={"constraint.age_spread.preferred_bonus": 500},
        )

        add_age_spread_constraints(ctx)

        age_spread_violation_keys = [k for k in ctx.soft_constraint_violations if "age_spread" in k]
        assert age_spread_violation_keys == []

    def test_skips_ag_bunks(self):
        """AG bunks are exempt from the hard cap (existing behavior)."""
        campers = [
            _person_with_age_months(1001, 144),
            _person_with_age_months(1002, 200),  # 56mo spread, would normally bind
        ]
        # AG bunks identified by name containing "AG"; gender-mixed is fine here.
        bunk = create_bunk(cm_id=2001, name="AG-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={"constraint.age_spread.preferred_bonus": 500},
        )

        add_age_spread_constraints(ctx)
        ctx.model.Add(ctx.assignments[(0, 0)] == 1)
        ctx.model.Add(ctx.assignments[(1, 0)] == 1)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        # AG bunk → no constraint → feasible
        assert is_optimal_or_feasible(status)


class TestPreferred18moBonus:
    """The preferred-bonus path: bunks with spread <= 18mo earn the configured bonus."""

    def test_tight_cabin_earns_bonus_when_spread_within_18mo(self):
        """A cabin with <=18mo spread gets a preferred-bonus entry that resolves to 1."""
        # Spread = 10mo (well within 18mo preferred)
        campers = [
            _person_with_age_months(1001, 144),
            _person_with_age_months(1002, 150),
            _person_with_age_months(1003, 154),
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={"constraint.age_spread.preferred_bonus": 500},
        )

        add_age_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert is_optimal_or_feasible(status)

        bunk_bonuses = {k: v for k, v in ctx.soft_constraint_bonuses.items() if "age_spread_preferred" in k}
        assert len(bunk_bonuses) == 1
        for key, (var, weight) in bunk_bonuses.items():
            assert solver.Value(var) == 1, f"Expected bonus active for {key} (10mo <= 18mo)"
            assert weight == 500

    def test_spread_between_18mo_and_24mo_earns_no_bonus(self):
        """A cabin with 18mo < spread <= 24mo: feasible (hard) but no bonus."""
        campers = [
            _person_with_age_months(1001, 144),
            _person_with_age_months(1002, 164),  # 20mo spread → between 18 and 24
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={"constraint.age_spread.preferred_bonus": 500},
        )

        add_age_spread_constraints(ctx)
        ctx.model.Add(ctx.assignments[(0, 0)] == 1)
        ctx.model.Add(ctx.assignments[(1, 0)] == 1)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert is_optimal_or_feasible(status)

        for key, (var, _weight) in ctx.soft_constraint_bonuses.items():
            if "age_spread_preferred" in key:
                assert solver.Value(var) == 0, f"Expected no bonus for {key} (20mo > 18mo)"

    def test_preferred_bonus_disabled_when_bonus_zero(self):
        """When ``preferred_bonus=0``, no bonus entries are created."""
        campers = [
            _person_with_age_months(1001, 144),
            _person_with_age_months(1002, 150),
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={"constraint.age_spread.preferred_bonus": 0},
        )

        add_age_spread_constraints(ctx)

        preferred_bonuses = [k for k in ctx.soft_constraint_bonuses if "age_spread_preferred" in k]
        assert preferred_bonuses == []

    def test_two_cabins_tighter_cabin_gets_bonus_wider_does_not(self):
        """With two bunks of different age spreads, only the tight one earns the bonus."""
        bunk_a = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=2)
        bunk_b = create_bunk(cm_id=2002, name="B-2", gender="M", capacity=2)

        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m → bunk A
            _person_with_age_months(1002, 152),  # 12y 8m → bunk A  (8mo spread)
            _person_with_age_months(1003, 156),  # 13y 0m → bunk B
            _person_with_age_months(1004, 176),  # 14y 8m → bunk B (20mo spread > 18mo preferred)
        ]

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk_a, bunk_b],
            config_overrides={"constraint.age_spread.preferred_bonus": 500},
        )

        add_age_spread_constraints(ctx)

        from bunking.solver.constraints.cabin_capacity import add_cabin_capacity_constraints

        add_cabin_capacity_constraints(ctx)

        # Maximise bonuses
        objective_terms = [weight * var for var, weight in ctx.soft_constraint_bonuses.values()]
        if objective_terms:
            ctx.model.Maximize(sum(objective_terms))

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert is_optimal_or_feasible(status)

        preferred_bonuses = {k: v for k, v in ctx.soft_constraint_bonuses.items() if "age_spread_preferred" in k}
        assert len(preferred_bonuses) == 2  # one per non-AG bunk

        active_bonuses = sum(1 for var, _w in preferred_bonuses.values() if solver.Value(var) == 1)
        # Only the tight cabin (8mo) earns the bonus; the loose one (20mo) does not.
        assert active_bonuses == 1, f"Expected exactly 1 bunk to earn preferred bonus, got {active_bonuses}"
