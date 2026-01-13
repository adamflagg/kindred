"""
Age Spread Constraints - Limit age range within bunks.

This is a soft constraint that penalizes bunks where the age spread
(max age - min age in months) exceeds the configured limit.
Uses TRUE min/max aggregation to reduce constraint count from O(n²) to O(bunks).
"""

from __future__ import annotations

import logging

from .base import SolverContext
from .helpers import get_eligible_campers_for_bunk, is_ag_session_bunk

logger = logging.getLogger(__name__)


def _age_to_months(age: float) -> int:
    """Convert CampMinder age format (years.months) to total months."""
    years = int(age)
    months = round((age - years) * 100)
    return years * 12 + months


def add_age_spread_constraints(ctx: SolverContext) -> None:
    """Add aggregated soft constraints for age spread within bunks.

    Uses TRUE min/max aggregation to reduce constraint count from O(n²) to O(bunks).
    For each bunk, tracks the minimum and maximum age in months and penalizes
    when the spread exceeds the configured limit.
    """
    if ctx.is_constraint_disabled("age_spread"):
        logger.info("Age spread constraints DISABLED via debug settings")
        return

    max_age_spread_months = ctx.config.get_constraint("age_spread", "months", default=24)

    # Get weight for age spread violations - high weight to prioritize
    age_spread_weight = ctx.config.get_soft_constraint_weight("age_spread", default=4000)

    logger.info(
        f"Adding TRUE min/max age spread constraints (max {max_age_spread_months} months, weight {age_spread_weight})"
    )

    constraints_added = 0

    # For each bunk, track min and max age
    for bunk_idx, bunk in enumerate(ctx.bunks):
        # Skip AG bunks - they have no constraints
        if is_ag_session_bunk(bunk):
            continue

        # Get only eligible campers for this bunk
        eligible_campers = get_eligible_campers_for_bunk(ctx, bunk)

        if len(eligible_campers) < 2:
            continue

        # Convert ages to months for all eligible campers
        age_months_data = []
        for person_idx, person in eligible_campers:
            if hasattr(person, "age"):
                age_months = _age_to_months(person.age)
            else:
                # Fallback: estimate based on grade
                age_months = person.grade * 12 + 120  # Assume grade 1 = 10 years old
            age_months_data.append((person_idx, age_months))

        # Find possible min/max age values
        all_ages = [age for _, age in age_months_data]
        min_possible = min(all_ages)
        max_possible = max(all_ages)

        # Create variables for min and max age in this bunk
        min_age_in_bunk = ctx.model.NewIntVar(min_possible, max_possible, f"min_age_months_b{bunk_idx}")
        max_age_in_bunk = ctx.model.NewIntVar(min_possible, max_possible, f"max_age_months_b{bunk_idx}")

        # For each eligible camper, update min/max when they're assigned
        for person_idx, age_months in age_months_data:
            is_in_bunk = ctx.assignments[(person_idx, bunk_idx)]

            # When person is in bunk, their age constrains min/max
            # min_age <= age_months when person is in bunk
            ctx.model.Add(min_age_in_bunk <= age_months).OnlyEnforceIf(is_in_bunk)

            # max_age >= age_months when person is in bunk
            ctx.model.Add(max_age_in_bunk >= age_months).OnlyEnforceIf(is_in_bunk)

        # Ensure min <= max always
        ctx.model.Add(min_age_in_bunk <= max_age_in_bunk)

        # Calculate the spread
        spread = ctx.model.NewIntVar(0, max_possible - min_possible, f"age_spread_b{bunk_idx}")
        ctx.model.Add(spread == max_age_in_bunk - min_age_in_bunk)

        # Create excess spread variable (how much over the limit)
        excess_spread = ctx.model.NewIntVar(0, max_possible - min_possible, f"excess_age_spread_b{bunk_idx}")

        # excess = max(0, spread - max_age_spread_months)
        ctx.model.AddMaxEquality(excess_spread, [0, spread - max_age_spread_months])

        # Create violation indicator (true when excess > 0)
        has_violation = ctx.model.NewBoolVar(f"age_spread_violation_b{bunk_idx}")
        ctx.model.Add(excess_spread > 0).OnlyEnforceIf(has_violation)
        ctx.model.Add(excess_spread == 0).OnlyEnforceIf(has_violation.Not())

        # Store violation with penalty
        if age_spread_weight > 0:
            ctx.soft_constraint_violations[f"age_spread_b{bunk_idx}"] = (has_violation, age_spread_weight)

            constraints_added += 1

    logger.info(f"Age spread: Using TRUE min/max aggregation for {constraints_added} bunks")
