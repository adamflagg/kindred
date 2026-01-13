"""
Grade Spread Constraints - Limit the number of unique grades in each bunk.

Supports two modes via constraint.grade_spread.mode config:
1. HARD mode (default): Solver fails if any bunk exceeds max unique grades
2. SOFT mode: Allows violation but penalizes in objective function

This helps maintain age-appropriate groupings within each bunk.
"""

from __future__ import annotations

import logging
from typing import Any

from .base import SolverContext
from .helpers import get_eligible_campers_for_bunk, is_ag_session_bunk

logger = logging.getLogger(__name__)


def add_grade_spread_constraints(ctx: SolverContext) -> None:
    """Add hard constraints to limit the number of unique grades in each bunk.

    Counts distinct grades in each bunk and enforces a maximum limit.
    This is a hard constraint - bunks cannot exceed the configured limit.
    """
    if ctx.is_constraint_disabled("grade_spread"):
        logger.info("Grade spread constraints DISABLED via debug settings")
        return

    max_unique_grades = ctx.config.get_constraint("grade_spread", "max_spread", default=2)

    logger.info(f"Adding hard grade limit constraints (max {max_unique_grades} unique grades per bunk)")

    constraints_added = 0

    # For each bunk, count unique grades
    for bunk_idx, bunk in enumerate(ctx.bunks):
        # Skip AG bunks - they have no constraints
        if is_ag_session_bunk(bunk):
            continue

        # Get only eligible campers for this bunk
        eligible_campers = get_eligible_campers_for_bunk(ctx, bunk)

        if len(eligible_campers) < 2:
            continue

        # Get all unique grades among eligible campers
        unique_grades = sorted(set(person.grade for _, person in eligible_campers))

        # Skip if all eligible campers have same grade
        if len(unique_grades) == 1:
            continue

        # Create boolean variables to track which grades are present in the bunk
        grade_present_vars = {}
        for grade in unique_grades:
            # Grade is present if at least one camper with that grade is assigned
            campers_with_grade = [
                ctx.assignments[(person_idx, bunk_idx)]
                for person_idx, person in eligible_campers
                if person.grade == grade
            ]

            # Only create constraint if there are actually campers with this grade
            if campers_with_grade:
                grade_present = ctx.model.NewBoolVar(f"grade_{grade}_present_b{bunk_idx}")
                grade_present_vars[grade] = grade_present

                # Grade is present if any camper with that grade is in the bunk
                ctx.model.AddBoolOr(campers_with_grade).OnlyEnforceIf(grade_present)
                # Grade is not present if no camper with that grade is in the bunk
                ctx.model.AddBoolAnd([var.Not() for var in campers_with_grade]).OnlyEnforceIf(grade_present.Not())

        # Hard constraint: Number of unique grades must not exceed the limit
        # Only add if we have any grade tracking variables
        if grade_present_vars:
            ctx.model.Add(sum(grade_present_vars.values()) <= max_unique_grades)
            constraints_added += 1

    ctx.constraint_logger.log_constraint(
        "hard",
        "grade_spread",
        f"Grade limit constraints (max {max_unique_grades} unique grades per bunk). "
        f"Created {constraints_added} bunk-level constraints.",
    )

    logger.info(f"Grade limits: Added hard constraints for {constraints_added} bunks")


def add_grade_spread_soft_constraint(ctx: SolverContext, objective_terms: list[Any]) -> None:
    """Add soft constraint penalties for exceeding grade spread limits.

    When grade spread is configured as soft, we penalize bunks that have
    more than the configured number of unique grades.

    Args:
        ctx: Solver context with model, assignments, and mappings
        objective_terms: List to append penalty terms to (negative values)
    """
    max_unique_grades = ctx.config.get_constraint("grade_spread", "max_spread", default=2)

    # Get penalty weight for violations
    penalty_weight = ctx.config.get_int("constraint.grade_spread.penalty", default=3000)

    logger.info(f"Adding grade spread soft constraints (max {max_unique_grades} grades, penalty: {penalty_weight})")

    penalties_added = 0

    # For each bunk, create penalty for exceeding grade limit
    for bunk_idx, bunk in enumerate(ctx.bunks):
        # Skip AG bunks - they have no constraints
        if is_ag_session_bunk(bunk):
            continue

        # Get only eligible campers for this bunk
        eligible_campers = get_eligible_campers_for_bunk(ctx, bunk)

        if len(eligible_campers) < 2:
            continue

        # Get all unique grades among eligible campers
        unique_grades = sorted(set(person.grade for _, person in eligible_campers))

        # Skip if impossible to exceed limit
        if len(unique_grades) <= max_unique_grades:
            continue

        # Create boolean variables to track which grades are present
        grade_present_vars = {}
        for grade in unique_grades:
            campers_with_grade = [
                ctx.assignments[(person_idx, bunk_idx)]
                for person_idx, person in eligible_campers
                if person.grade == grade
            ]

            if campers_with_grade:
                grade_present = ctx.model.NewBoolVar(f"soft_grade_{grade}_present_b{bunk_idx}")
                grade_present_vars[grade] = grade_present

                # Grade is present if any camper with that grade is in the bunk
                ctx.model.AddBoolOr(campers_with_grade).OnlyEnforceIf(grade_present)
                # Grade is not present if no camper with that grade is in the bunk
                ctx.model.AddBoolAnd([var.Not() for var in campers_with_grade]).OnlyEnforceIf(grade_present.Not())

        if grade_present_vars:
            # Create variable for number of grades exceeding limit
            excess_grades = ctx.model.NewIntVar(0, len(unique_grades), f"excess_grades_b{bunk_idx}")

            # excess_grades = max(0, total_grades - max_unique_grades)
            # Use >= instead of == to handle when total < max (allows 0 via domain floor)
            # The objective's negative penalty naturally minimizes this value
            total_grades_expr = sum(grade_present_vars.values())
            ctx.model.Add(excess_grades >= total_grades_expr - max_unique_grades)

            # Create boolean for whether limit is exceeded
            limit_exceeded = ctx.model.NewBoolVar(f"grade_limit_exceeded_b{bunk_idx}")
            ctx.model.Add(excess_grades > 0).OnlyEnforceIf(limit_exceeded)
            ctx.model.Add(excess_grades == 0).OnlyEnforceIf(limit_exceeded.Not())

            # Add penalty to objective (negative because we're maximizing)
            # Penalty scales with how much we exceed the limit
            objective_terms.append(-penalty_weight * excess_grades)
            penalties_added += 1

    logger.info(f"Added grade spread soft penalties for {penalties_added} bunks")
