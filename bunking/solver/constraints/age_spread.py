"""
Age Spread Constraints - Hard cap on age range within non-AG bunks.

Enforces ``max_age_months - min_age_months <= MAX_AGE_SPREAD_MONTHS`` per
non-AG bunk. Bunks with spread within ``PREFERRED_AGE_SPREAD_MONTHS`` earn a
configurable soft bonus (``constraint.age_spread.preferred_bonus``). Uses TRUE
min/max aggregation to reduce constraint count from O(n²) to O(bunks).

Phase 2 collapsed the prior soft penalty path (``excess_spread`` /
``has_violation`` reified machinery) into the single hard constraint above —
the soft path was being absorbed by ~6% of bunks in production, and the
hard cap moves that infeasibility upstream where the feasibility-warning hook
in ``bunking/solver/feasibility.py`` can surface a staff-actionable message.
"""

from __future__ import annotations

from bunking.logging_config import get_logger
from bunking.solver.constants import (
    MAX_AGE_SPREAD_MONTHS,
    PREFERRED_AGE_SPREAD_MONTHS,
)

from .base import SolverContext
from .helpers import get_eligible_campers_for_bunk, is_ag_session_bunk

logger = get_logger(__name__)


def _age_to_months(age: float) -> int:
    """Convert CampMinder age format (years.months) to total months."""
    years = int(age)
    months = round((age - years) * 100)
    return years * 12 + months


def add_age_spread_constraints(ctx: SolverContext) -> None:
    """Add hard age spread constraint + soft preferred-bonus path per non-AG bunk.

    Two-tier age spread system:
    - Hard ceiling: ``spread <= MAX_AGE_SPREAD_MONTHS`` per non-AG bunk. Solver
      never emits a bunk that violates this; staff can override on the
      bunking board (board flags >24mo with a warning via the validator).
    - Preferred bonus (soft): when ``spread <= PREFERRED_AGE_SPREAD_MONTHS``,
      an objective bonus is added — encouraging tighter age clusters that
      approximate single-grade cabins. Disabled when the configured bonus
      weight is 0.

    Uses TRUE min/max aggregation to reduce constraint count from O(n²) to
    O(bunks).
    """
    if ctx.is_constraint_disabled("age_spread"):
        logger.info("Age spread constraints DISABLED via debug settings")
        return

    preferred_age_spread_bonus = ctx.config.get_constraint("age_spread", "preferred_bonus")
    preferred_active = preferred_age_spread_bonus > 0

    logger.debug(
        f"Adding hard age spread constraints (max {MAX_AGE_SPREAD_MONTHS}mo,"
        f" preferred {PREFERRED_AGE_SPREAD_MONTHS}mo, bonus {preferred_age_spread_bonus},"
        f" preferred_active={preferred_active})"
    )

    bonus_count = 0
    bunk_count = 0

    for bunk_idx, bunk in enumerate(ctx.bunks):
        if is_ag_session_bunk(bunk):
            continue

        eligible_campers = get_eligible_campers_for_bunk(ctx, bunk)
        if len(eligible_campers) < 2:
            continue

        bunk_count += 1

        age_months_data = []
        for person_idx, person in eligible_campers:
            if hasattr(person, "age"):
                age_months = _age_to_months(person.age)
            else:
                age_months = person.grade * 12 + 120
            age_months_data.append((person_idx, age_months))

        all_ages = [age for _, age in age_months_data]
        min_possible = min(all_ages)
        max_possible = max(all_ages)

        min_age_in_bunk = ctx.model.NewIntVar(min_possible, max_possible, f"min_age_months_b{bunk_idx}")
        max_age_in_bunk = ctx.model.NewIntVar(min_possible, max_possible, f"max_age_months_b{bunk_idx}")

        for person_idx, age_months in age_months_data:
            is_in_bunk = ctx.assignments[(person_idx, bunk_idx)]
            ctx.model.Add(min_age_in_bunk <= age_months).OnlyEnforceIf(is_in_bunk)
            ctx.model.Add(max_age_in_bunk >= age_months).OnlyEnforceIf(is_in_bunk)

        ctx.model.Add(min_age_in_bunk <= max_age_in_bunk)

        spread = ctx.model.NewIntVar(0, max_possible - min_possible, f"age_spread_b{bunk_idx}")
        ctx.model.Add(spread == max_age_in_bunk - min_age_in_bunk)

        # HARD: solver may never emit spread > MAX_AGE_SPREAD_MONTHS
        ctx.model.Add(spread <= MAX_AGE_SPREAD_MONTHS)

        if preferred_active:
            within_preferred = ctx.model.NewBoolVar(f"age_spread_preferred_b{bunk_idx}")
            ctx.model.Add(spread <= PREFERRED_AGE_SPREAD_MONTHS).OnlyEnforceIf(within_preferred)
            ctx.model.Add(spread > PREFERRED_AGE_SPREAD_MONTHS).OnlyEnforceIf(within_preferred.Not())
            ctx.soft_constraint_bonuses[f"age_spread_preferred_b{bunk_idx}"] = (
                within_preferred,
                preferred_age_spread_bonus,
            )
            bonus_count += 1

    logger.debug(f"Age spread: hard cap applied across {bunk_count} bunks with {bonus_count} preferred-bonus entries")
