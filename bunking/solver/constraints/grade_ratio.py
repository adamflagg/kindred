"""
Grade Ratio Constraints - Limit single grade dominance in bunks.

This is a soft constraint that penalizes bunks where a single grade
makes up more than the configured percentage (default 67%) of the cabin.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from ortools.sat.python import cp_model

from .base import SolverContext
from .helpers import get_eligible_campers_for_bunk, is_ag_session_bunk, should_exempt_edge_bunk_from_ratio

logger = logging.getLogger(__name__)


def add_grade_ratio_constraints(ctx: SolverContext) -> None:
    """Add soft constraints for grade ratio percentage within bunks.

    Creates a penalty when a single grade makes up more than the configured
    percentage (default 67%) of a cabin when the cabin has more than one grade.

    OPTIMIZED: Only considers campers eligible for each bunk,
    respecting session and gender boundaries.
    """
    if ctx.is_constraint_disabled("grade_ratio"):
        logger.info("Grade ratio constraints DISABLED via debug settings")
        return

    max_percentage = ctx.config.get_constraint("grade_ratio", "max_percentage", default=67) / 100.0

    # Get penalty weight for violations
    penalty_weight = ctx.config.get_constraint("grade_ratio", "penalty", default=5000)

    # Get standard capacity for edge exemption threshold calculation
    standard_capacity = ctx.config.get_int("constraint.cabin_capacity.standard", default=12)

    logger.info(
        f"Adding grade ratio soft constraints with max percentage: {max_percentage:.0%}, penalty: {penalty_weight}"
    )

    total_bunks_checked = 0
    total_bunks_skipped = 0
    edge_exempted_bunks = 0

    # For each bunk, check grade ratios
    for bunk_idx, bunk in enumerate(ctx.bunks):
        # Skip AG bunks - they have no constraints
        if is_ag_session_bunk(bunk):
            continue

        # Skip if bunk capacity is too small
        if bunk.capacity < 3:
            total_bunks_skipped += 1
            continue

        # Get only eligible campers for this bunk
        eligible_campers = get_eligible_campers_for_bunk(ctx, bunk)

        # Check if edge bunk should be exempt from grade ratio penalty
        # This handles cases where 1-3 oldest/youngest kids MUST be minorities
        # in edge bunks, making grade dominance by adjacent grade unavoidable
        eligible_persons = [person for _, person in eligible_campers]
        should_exempt, reason = should_exempt_edge_bunk_from_ratio(
            bunk, ctx.bunks, eligible_persons, standard_capacity, max_percentage
        )
        if should_exempt:
            logger.debug(f"Edge exemption for {bunk.name}: {reason}")
            edge_exempted_bunks += 1
            continue  # Skip grade_ratio constraints for this bunk

        # Count students per grade in this bunk (only eligible ones)
        grade_counts: dict[int, list[cp_model.IntVar]] = defaultdict(list)  # grade -> list of assignment vars

        for person_idx, person in eligible_campers:
            grade_counts[person.grade].append(ctx.assignments[(person_idx, bunk_idx)])

        # Skip single-grade constraint if only one grade exists among eligible campers
        if len(grade_counts) <= 1:
            total_bunks_skipped += 1
            continue

        total_bunks_checked += 1

        # Create variables for tracking if cabin has multiple grades
        has_multiple_grades = ctx.model.NewBoolVar(f"bunk_{bunk_idx}_has_multiple_grades")

        # Check if at least two different grades have students
        grade_present_vars = []
        for grade in grade_counts:
            grade_present = ctx.model.NewBoolVar(f"bunk_{bunk_idx}_grade_{grade}_present")
            # Grade is present if at least one student of that grade is in the bunk
            ctx.model.Add(sum(grade_counts[grade]) >= 1).OnlyEnforceIf(grade_present)
            ctx.model.Add(sum(grade_counts[grade]) == 0).OnlyEnforceIf(grade_present.Not())
            grade_present_vars.append(grade_present)

        # Cabin has multiple grades if sum of grade_present_vars >= 2
        ctx.model.Add(sum(grade_present_vars) >= 2).OnlyEnforceIf(has_multiple_grades)
        ctx.model.Add(sum(grade_present_vars) <= 1).OnlyEnforceIf(has_multiple_grades.Not())

        # Only apply ratio constraint if cabin has multiple grades
        # For each grade, check if it exceeds max percentage
        for grade, assignment_vars in grade_counts.items():
            # Count total eligible students in bunk (only those who can be assigned)
            total_in_bunk = sum(ctx.assignments[(p_idx, bunk_idx)] for p_idx, _ in eligible_campers)

            # Count students of this grade in bunk
            grade_count = sum(assignment_vars)

            # Create violation variable for this grade exceeding ratio
            violation_var = ctx.model.NewBoolVar(f"grade_ratio_violation_bunk_{bunk_idx}_grade_{grade}")

            # Violation occurs when:
            # 1. Cabin has multiple grades AND
            # 2. grade_count > max_percentage * total_in_bunk
            # Using integer arithmetic: grade_count * 100 > int(max_percentage * 100) * total_in_bunk
            violation_condition = ctx.model.NewBoolVar(f"grade_ratio_check_bunk_{bunk_idx}_grade_{grade}")

            # Check if ratio is exceeded
            ctx.model.Add(grade_count * 100 > int(max_percentage * 100) * total_in_bunk).OnlyEnforceIf(
                violation_condition
            )

            ctx.model.Add(grade_count * 100 <= int(max_percentage * 100) * total_in_bunk).OnlyEnforceIf(
                violation_condition.Not()
            )

            # Violation only happens when both conditions are true
            ctx.model.AddBoolAnd([has_multiple_grades, violation_condition]).OnlyEnforceIf(violation_var)
            ctx.model.AddBoolOr([has_multiple_grades.Not(), violation_condition.Not()]).OnlyEnforceIf(
                violation_var.Not()
            )

            # Store violation with penalty
            ctx.soft_constraint_violations[f"grade_ratio_{bunk_idx}_grade_{grade}"] = (violation_var, penalty_weight)

    logger.info(
        f"Grade ratio: Checked {total_bunks_checked} bunks, skipped {total_bunks_skipped} "
        f"(small capacity or single-grade), edge-exempted {edge_exempted_bunks}. "
        f"Only considered eligible campers per bunk."
    )
