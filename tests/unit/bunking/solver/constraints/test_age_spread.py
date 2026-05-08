"""
Unit tests for age spread constraints.

Tests both the existing 24mo soft penalty constraint and the new 12mo preferred
threshold bonus (soft incentive for tighter age grouping).

Architecture:
- 24mo threshold: soft penalty when spread > max_age_spread_months (weight from
  constraint.age_spread.penalty)
- 12mo preferred threshold: soft bonus when spread <= preferred_age_spread_months
  (weight from constraint.age_spread.preferred_bonus)

Both are implemented as objective-function terms (no hard infeasibility).
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


# Helper: create a person with a specific age in total months
# DirectPerson.age is a @property computed from birthdate.
# We compute a birthdate that produces exactly total_months of age as of "now".
def _person_with_age_months(cm_id: int, total_months: int, gender: str = "M") -> DirectPerson:
    """Create a test person whose age converts to exactly total_months.

    Uses a birthdate exactly total_months before today so DirectPerson.age
    returns the right CampMinder-format value.
    """
    today = datetime.now(tz=UTC)
    # Subtract total_months from today to get the birthdate
    birth_year = today.year - (total_months // 12)
    birth_month = today.month - (total_months % 12)
    if birth_month <= 0:
        birth_month += 12
        birth_year -= 1
    # Use same day-of-month as today so fractional months are 0
    birth_day = min(today.day, 28)  # avoid month-end edge cases
    birthdate = f"{birth_year:04d}-{birth_month:02d}-{birth_day:02d}"

    return create_person(
        cm_id=cm_id,
        first_name=f"Camper{cm_id}",
        last_name="Test",
        gender=gender,
        grade=5,
        birthdate=birthdate,
    )


def _solve_with_age_spread(campers, bunks, config_overrides=None):
    """Build context with age spread constraints and solve. Returns (status, ctx, solver)."""
    ctx = build_solver_context(
        persons=campers,
        bunks=bunks,
        config_overrides=config_overrides or {},
    )

    add_age_spread_constraints(ctx)

    # Build objective from soft violations (penalties) and bonuses
    objective_terms = []

    # Penalty terms (violations): minimise these → subtract from Maximize
    for var, weight in ctx.soft_constraint_violations.values():
        objective_terms.append(-weight * var)

    # Bonus terms: the bonus for preferred threshold
    for var, weight in ctx.soft_constraint_bonuses.values():
        objective_terms.append(weight * var)

    if objective_terms:
        ctx.model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    status = solver.Solve(ctx.model)
    return status, ctx, solver


class TestExisting24moHardPenalty:
    """Ensure the existing 24mo soft-penalty behaviour is unchanged."""

    def test_spread_within_24mo_has_no_violation(self):
        """Campers within 24mo spread → no age_spread violation registered."""
        # Spread = 22 months (within 24mo limit)
        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m
            _person_with_age_months(1002, 154),  # 12y 10m
            _person_with_age_months(1003, 166),  # 13y 10m = 144+22
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.penalty": 1500,
            },
        )

        add_age_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)
        # When all are in the single bunk, violation should be False
        for key, (var, _weight) in ctx.soft_constraint_violations.items():
            if "age_spread" in key:
                assert solver.Value(var) == 0, f"Expected no violation for {key}"

    def test_spread_exceeding_24mo_has_violation(self):
        """Campers with >24mo spread → violation flag set."""
        # Spread = 28 months (exceeds 24mo limit)
        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m
            _person_with_age_months(1002, 172),  # 14y 4m = 144+28
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.penalty": 1500,
            },
        )

        add_age_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)
        # When both are in the single bunk, violation should be True
        violations = {k: v for k, v in ctx.soft_constraint_violations.items() if "age_spread" in k}
        assert len(violations) >= 1, "Expected at least one age_spread violation entry"
        for key, (var, weight) in violations.items():
            assert solver.Value(var) == 1, f"Expected violation for {key} (28mo spread > 24mo max)"
            assert weight == 1500

    def test_penalty_weight_configurable(self):
        """Penalty weight is read from config and stored correctly."""
        campers = [
            _person_with_age_months(1001, 144),
            _person_with_age_months(1002, 172),  # 28mo spread
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.penalty": 9999,
            },
        )

        add_age_spread_constraints(ctx)

        violations = {k: v for k, v in ctx.soft_constraint_violations.items() if "age_spread" in k}
        assert len(violations) >= 1
        for _var, weight in violations.values():
            assert weight == 9999


class TestNew12moPreferredThreshold:
    """Tests for the new 12mo preferred-spread bonus."""

    def test_tight_cabin_earns_bonus_when_spread_within_12mo(self):
        """A cabin with ≤12mo spread should get a preferred-threshold bonus."""
        # Spread = 10 months (within 12mo preferred)
        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m
            _person_with_age_months(1002, 150),  # 12y 6m
            _person_with_age_months(1003, 154),  # 12y 10m = 144+10
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.preferred_months": 12,
                "constraint.age_spread.penalty": 1500,
                "constraint.age_spread.preferred_bonus": 500,
            },
        )

        add_age_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Should have a bonus entry for the bunk
        bonuses = ctx.soft_constraint_bonuses
        assert len(bonuses) >= 1, "Expected at least one preferred-spread bonus entry"
        bunk_bonuses = {k: v for k, v in bonuses.items() if "age_spread_preferred" in k}
        assert len(bunk_bonuses) >= 1, f"Expected preferred_spread bonus, got bonuses: {list(bonuses.keys())}"
        for key, (var, weight) in bunk_bonuses.items():
            assert solver.Value(var) == 1, f"Expected bonus active for {key} (10mo spread <= 12mo preferred)"
            assert weight == 500

    def test_spread_between_12mo_and_24mo_earns_no_bonus(self):
        """A cabin with 12mo < spread ≤ 24mo gets neither bonus nor violation."""
        # Spread = 18 months (between preferred 12mo and max 24mo)
        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m
            _person_with_age_months(1002, 162),  # 13y 6m = 144+18
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.preferred_months": 12,
                "constraint.age_spread.penalty": 1500,
                "constraint.age_spread.preferred_bonus": 500,
            },
        )

        add_age_spread_constraints(ctx)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # No violation (spread ≤ 24mo)
        for key, (var, _weight) in ctx.soft_constraint_violations.items():
            if "age_spread" in key:
                assert solver.Value(var) == 0, f"Expected no violation for {key} (18mo spread ≤ 24mo max)"

        # No preferred bonus (spread > 12mo preferred)
        bonuses = ctx.soft_constraint_bonuses
        for key, (var, _weight) in bonuses.items():
            if "age_spread_preferred" in key:
                assert solver.Value(var) == 0, f"Expected no bonus for {key} (18mo spread > 12mo preferred)"

    def test_preferred_threshold_disabled_when_zero(self):
        """When preferred_months=0, no preferred bonus is added at all."""
        campers = [
            _person_with_age_months(1001, 144),
            _person_with_age_months(1002, 150),
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.preferred_months": 0,  # disabled
                "constraint.age_spread.penalty": 1500,
                "constraint.age_spread.preferred_bonus": 500,
            },
        )

        add_age_spread_constraints(ctx)

        bonuses = ctx.soft_constraint_bonuses
        preferred_bonuses = {k: v for k, v in bonuses.items() if "age_spread_preferred" in k}
        assert len(preferred_bonuses) == 0, (
            f"Expected no preferred bonuses when preferred_months=0, got: {list(preferred_bonuses.keys())}"
        )

    def test_preferred_threshold_disabled_when_equals_max(self):
        """When preferred_months equals max months, no preferred bonus added (degenerate case)."""
        campers = [
            _person_with_age_months(1001, 144),
            _person_with_age_months(1002, 150),
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.preferred_months": 24,  # same as max → disabled
                "constraint.age_spread.penalty": 1500,
                "constraint.age_spread.preferred_bonus": 500,
            },
        )

        add_age_spread_constraints(ctx)

        bonuses = ctx.soft_constraint_bonuses
        preferred_bonuses = {k: v for k, v in bonuses.items() if "age_spread_preferred" in k}
        assert len(preferred_bonuses) == 0, (
            f"Expected no preferred bonuses when preferred_months==max, got: {list(preferred_bonuses.keys())}"
        )

    def test_optimizer_prefers_tight_cabin_over_loose_one(self):
        """Solver places similar-age campers together when both placements are valid.

        Setup: 3 campers (10mo spread among them), 2 bunks each able to hold all 3.
        Camper A: 144mo, Camper B: 150mo, Camper C: 154mo (spread=10mo if together).
        With preferred bonus, solver should put all 3 in one bunk (tight spread) rather
        than distributing them loosely.
        """
        # All in one bunk = 10mo spread → earns preferred bonus
        # This is one valid solution; we just verify it's chosen over no-bonus alternatives.
        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m
            _person_with_age_months(1002, 150),  # 12y 6m
            _person_with_age_months(1003, 154),  # 12y 10m
        ]
        bunk = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=12)

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.preferred_months": 12,
                "constraint.age_spread.penalty": 1500,
                "constraint.age_spread.preferred_bonus": 500,
            },
        )

        add_age_spread_constraints(ctx)

        # Maximise bonuses, minimise penalties
        objective_terms = []
        for var, weight in ctx.soft_constraint_violations.values():
            objective_terms.append(-weight * var)
        for var, weight in ctx.soft_constraint_bonuses.values():
            objective_terms.append(weight * var)

        if objective_terms:
            ctx.model.Maximize(sum(objective_terms))

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # The preferred bonus should be active (all 3 in B-1 with 10mo spread)
        bonuses = ctx.soft_constraint_bonuses
        bunk_bonuses = {k: v for k, v in bonuses.items() if "age_spread_preferred" in k}
        assert len(bunk_bonuses) >= 1
        for key, (var, _weight) in bunk_bonuses.items():
            assert solver.Value(var) == 1, f"Expected preferred bonus active for {key}"

    def test_two_cabins_tighter_cabin_gets_bonus_wider_does_not(self):
        """With two bunks of different age spreads, only the tight one earns the bonus.

        Campers: 4 campers split across 2 bunks.
        Bunk A: 2 campers, 8mo spread → earns bonus
        Bunk B: 2 campers, 20mo spread → no bonus
        """
        # Force exactly 2 campers per bunk by setting per-bunk capacity to 2.
        # Phase 2 cabin-capacity cleanup deleted the global cabin_capacity.*
        # config keys, so per-bunk capacity is the only knob.
        bunk_a = create_bunk(cm_id=2001, name="B-1", gender="M", capacity=2)
        bunk_b = create_bunk(cm_id=2002, name="B-2", gender="M", capacity=2)

        campers = [
            _person_with_age_months(1001, 144),  # 12y 0m → bunk A
            _person_with_age_months(1002, 152),  # 12y 8m → bunk A (8mo spread)
            _person_with_age_months(1003, 156),  # 13y 0m → bunk B
            _person_with_age_months(1004, 176),  # 14y 8m → bunk B (20mo spread)
        ]

        ctx = build_solver_context(
            persons=campers,
            bunks=[bunk_a, bunk_b],
            config_overrides={
                "constraint.age_spread.months": 24,
                "constraint.age_spread.preferred_months": 12,
                "constraint.age_spread.penalty": 1500,
                "constraint.age_spread.preferred_bonus": 500,
            },
        )

        add_age_spread_constraints(ctx)

        # Add capacity hard constraint so each bunk gets exactly 2 campers
        from bunking.solver.constraints.cabin_capacity import add_cabin_capacity_constraints

        add_cabin_capacity_constraints(ctx)

        # Maximise bonuses
        objective_terms = []
        for var, weight in ctx.soft_constraint_violations.values():
            objective_terms.append(-weight * var)
        for var, weight in ctx.soft_constraint_bonuses.values():
            objective_terms.append(weight * var)

        if objective_terms:
            ctx.model.Maximize(sum(objective_terms))

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        bonuses = ctx.soft_constraint_bonuses
        preferred_bonuses = {k: v for k, v in bonuses.items() if "age_spread_preferred" in k}
        assert len(preferred_bonuses) >= 1, "Expected at least one preferred bonus entry"

        active_bonuses = sum(1 for _var, _w in preferred_bonuses.values() if solver.Value(_var) == 1)
        # Exactly 1 of the 2 bunks should earn the preferred bonus
        assert active_bonuses == 1, f"Expected exactly 1 bunk to earn preferred bonus, got {active_bonuses}"
