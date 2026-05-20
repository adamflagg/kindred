"""
Age Spread Constraints - cap on age range within non-AG bunks.

Enforces ``max_age_months - min_age_months <= MAX_AGE_SPREAD_MONTHS`` per
non-AG bunk. Middle bunks treat this as a hard constraint; edge bunks (lowest
or highest level for their gender+session) get a soft escape hatch with
``EDGE_AGE_OVERFLOW_PENALTY`` so structurally forced overflow (e.g., hard
MSO chains into the top cabin) is feasible. Bunks with spread within
``PREFERRED_AGE_SPREAD_MONTHS`` earn a configurable soft bonus
(``constraint.age_spread.preferred_bonus``). Uses TRUE min/max aggregation
to reduce constraint count from O(n²) to O(bunks).

Phase 2 collapsed the prior all-bunks soft penalty path (``excess_spread`` /
``has_violation`` reified machinery, absorbed by ~6% of bunks in production)
into the current hard-middle / soft-edge split — the validator
(``bunking/bunking_validator.py``) still warns post-solve on any >24mo
spread regardless of edge/middle, and the feasibility-warning hook in
``bunking/solver/feasibility.py`` surfaces a staff-actionable message when
a middle bunk forces infeasibility.
"""

from __future__ import annotations

from bunking.logging_config import get_logger
from bunking.solver.constants import (
    EDGE_AGE_OVERFLOW_PENALTY,
    MAX_AGE_SPREAD_MONTHS,
    PREFERRED_AGE_SPREAD_MONTHS,
)

from .base import SolverContext
from .helpers import get_eligible_campers_for_bunk, is_ag_session_bunk, is_edge_bunk_for_grades

logger = get_logger(__name__)


def _age_to_months(age: float) -> int:
    """Convert CampMinder age format (years.months) to total months."""
    years = int(age)
    months = round((age - years) * 100)
    return years * 12 + months


def add_age_spread_constraints(ctx: SolverContext) -> None:
    """Add age spread constraints per non-AG bunk.

    Three-tier system:
    - **Middle bunks** (not lowest/highest for their gender+session): hard cap
      ``spread <= MAX_AGE_SPREAD_MONTHS``. Solver is INFEASIBLE if two campers
      >24mo apart are forced in — there are always adjacent bunks to absorb
      outliers, so no structural exception is warranted.
    - **Edge bunks** (lowest or highest level for gender+session, including the
      only bunk in a session): soft escape hatch via a reified
      ``edge_age_overflow_b{idx}`` BoolVar. The 24mo cap is enforced only when
      the bool is False; when True, ``EDGE_AGE_OVERFLOW_PENALTY`` is charged.
      Since MSO satisfaction is a hard constraint, the solver sets this True only
      when structurally forced (e.g., a hard bunk-with chain into the top cabin) —
      never as a casual optimization choice.
    - **Preferred bonus** (soft): bunks with spread <= ``PREFERRED_AGE_SPREAD_MONTHS``
      earn a configurable bonus, regardless of edge/middle status. Disabled when
      the configured bonus weight is 0.
    """
    if ctx.is_constraint_disabled("age_spread"):
        logger.info("Age spread constraints DISABLED via debug settings")
        return

    preferred_age_spread_bonus = ctx.config.get_constraint("age_spread", "preferred_bonus")
    preferred_active = preferred_age_spread_bonus > 0

    logger.debug(
        f"Adding age spread constraints (max {MAX_AGE_SPREAD_MONTHS}mo,"
        f" preferred {PREFERRED_AGE_SPREAD_MONTHS}mo, bonus {preferred_age_spread_bonus},"
        f" preferred_active={preferred_active})"
    )

    bonus_count = 0
    bunk_count = 0
    edge_count = 0

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

        is_edge, _ = is_edge_bunk_for_grades(bunk, ctx.bunks)
        if is_edge:
            # Soft escape hatch: solver pays EDGE_AGE_OVERFLOW_PENALTY to exceed 24mo.
            # Only fires when a hard constraint (MSO, locked group) forces it.
            edge_overflow = ctx.model.NewBoolVar(f"edge_age_overflow_b{bunk_idx}")
            ctx.model.Add(spread <= MAX_AGE_SPREAD_MONTHS).OnlyEnforceIf(edge_overflow.Not())
            ctx.soft_constraint_violations[f"edge_age_overflow_b{bunk_idx}"] = (
                edge_overflow,
                EDGE_AGE_OVERFLOW_PENALTY,
            )
            edge_count += 1
        else:
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

    logger.debug(
        f"Age spread: hard cap across {bunk_count - edge_count} middle bunks,"
        f" escape hatch across {edge_count} edge bunks, {bonus_count} preferred-bonus entries"
    )
