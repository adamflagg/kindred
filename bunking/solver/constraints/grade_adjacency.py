"""
Grade Adjacency Constraints - HARD constraint for adjacent grades in bunks.

This is a HARD constraint that forbids bunks from having non-adjacent grades.
For example: grades 4 and 6 (without grade 5) cannot be in the same bunk.

The constraint allows:
- Single grade bunks: [5, 5, 5, 5] ✓
- Adjacent grades: [5, 5, 6, 6] ✓
- Three consecutive grades: [5, 6, 7] ✓ (if grade_spread allows 3)

The constraint forbids:
- Gap of 2+: [4, 6] without 5 ✗
- Gap of 3+: [4, 7] without 5, 6 ✗

Only AG bunks are exempt (by design).
Edge bunks are NOT exempt - all bunks must have adjacent grades.
"""

from __future__ import annotations

import logging

from .base import SolverContext
from .helpers import get_eligible_campers_for_bunk, is_ag_session_bunk

logger = logging.getLogger(__name__)


# =============================================================================
# Pure Helper Functions (Easily Testable)
# =============================================================================


def are_grades_adjacent(grade1: int, grade2: int) -> bool:
    """Check if two grades are adjacent (gap <= 1).

    Adjacent means they are consecutive or the same grade.

    Examples:
        are_grades_adjacent(4, 5) -> True (gap = 1)
        are_grades_adjacent(5, 5) -> True (gap = 0)
        are_grades_adjacent(4, 6) -> False (gap = 2)
    """
    return abs(grade1 - grade2) <= 1


def calculate_grade_gap(grade1: int, grade2: int) -> int:
    """Calculate the gap between two grades.

    Examples:
        calculate_grade_gap(4, 5) -> 1
        calculate_grade_gap(4, 6) -> 2
        calculate_grade_gap(5, 5) -> 0
    """
    return abs(grade1 - grade2)


def find_non_adjacent_grade_violations(grades: list[int]) -> list[tuple[int, int, int]]:
    """Find all non-adjacent grade pairs in a list.

    Returns list of (grade1, grade2, gap) tuples for violations.

    Since grade_spread constraint limits bunks to max 2 unique grades,
    this typically returns at most 1 violation.

    Examples:
        find_non_adjacent_grade_violations([4, 6]) -> [(4, 6, 2)]
        find_non_adjacent_grade_violations([4, 5]) -> []
        find_non_adjacent_grade_violations([5, 5, 5]) -> []
    """
    if len(grades) < 2:
        return []

    # Get unique grades sorted
    unique_grades = sorted(set(grades))

    if len(unique_grades) < 2:
        return []

    violations = []

    # Check each adjacent pair of unique grades
    # (since sorted, we only need to check consecutive pairs)
    for i in range(len(unique_grades) - 1):
        g1 = unique_grades[i]
        g2 = unique_grades[i + 1]
        gap = calculate_grade_gap(g1, g2)
        if gap > 1:
            violations.append((g1, g2, gap))

    return violations


def get_missing_grades(grades: list[int]) -> list[int]:
    """Get list of missing grades between min and max.

    Examples:
        get_missing_grades([4, 6]) -> [5]
        get_missing_grades([4, 7]) -> [5, 6]
        get_missing_grades([4, 5]) -> []
    """
    if len(grades) < 2:
        return []

    unique_grades = sorted(set(grades))
    if len(unique_grades) < 2:
        return []

    min_grade = unique_grades[0]
    max_grade = unique_grades[-1]

    expected = set(range(min_grade, max_grade + 1))
    actual = set(unique_grades)

    return sorted(expected - actual)


# =============================================================================
# Solver Constraint Builder
# =============================================================================


def add_grade_adjacency_constraints(ctx: SolverContext) -> None:
    """Add HARD constraints for grade adjacency within bunks.

    Forbids bunks from having non-adjacent grades.
    For example: grades [4, 6] cannot coexist without grade 5.

    This is a HARD constraint - solutions violating it are infeasible.
    Other constraints (grade_ratio, age_grade_flow) remain soft and will
    adjust to satisfy this hard requirement.

    Only AG bunks are exempt.
    Edge bunks are NOT exempt - user requirement states that
    2nd and 4th grade together is wrong regardless of bunk position.
    """
    if ctx.is_constraint_disabled("grade_adjacency"):
        logger.info("Grade adjacency constraints DISABLED via debug settings")
        return

    logger.info("Adding grade adjacency HARD constraints")

    total_bunks_checked = 0
    total_bunks_skipped = 0
    constraints_added = 0

    # For each bunk, check grade adjacency
    for bunk_idx, bunk in enumerate(ctx.bunks):
        # Skip AG bunks - they have no constraints
        if is_ag_session_bunk(bunk):
            total_bunks_skipped += 1
            continue

        # Get only eligible campers for this bunk
        eligible_campers = get_eligible_campers_for_bunk(ctx, bunk)

        if len(eligible_campers) < 2:
            total_bunks_skipped += 1
            continue

        # Get unique grades among eligible campers
        unique_grades = sorted(set(person.grade for _, person in eligible_campers if person.grade is not None))

        # Skip if only 1 unique grade (nothing to compare)
        if len(unique_grades) <= 1:
            total_bunks_skipped += 1
            continue

        total_bunks_checked += 1

        # For each pair of non-adjacent grades, add HARD constraint
        for i, grade1 in enumerate(unique_grades):
            for grade2 in unique_grades[i + 1 :]:
                gap = calculate_grade_gap(grade1, grade2)

                if gap <= 1:
                    # Adjacent grades - no constraint needed
                    continue

                # Non-adjacent grades - FORBID both being present in same bunk

                # Get assignment variables for campers with each grade
                grade1_vars = [
                    ctx.assignments[(person_idx, bunk_idx)]
                    for person_idx, person in eligible_campers
                    if person.grade == grade1
                ]
                grade2_vars = [
                    ctx.assignments[(person_idx, bunk_idx)]
                    for person_idx, person in eligible_campers
                    if person.grade == grade2
                ]

                if not grade1_vars or not grade2_vars:
                    continue

                # Create presence tracking variables
                grade1_present = ctx.model.NewBoolVar(f"adj_grade_{grade1}_present_b{bunk_idx}")
                grade2_present = ctx.model.NewBoolVar(f"adj_grade_{grade2}_present_b{bunk_idx}")

                # Grade is present if at least one camper with that grade is in the bunk
                ctx.model.AddBoolOr(grade1_vars).OnlyEnforceIf(grade1_present)
                ctx.model.AddBoolAnd([v.Not() for v in grade1_vars]).OnlyEnforceIf(grade1_present.Not())

                ctx.model.AddBoolOr(grade2_vars).OnlyEnforceIf(grade2_present)
                ctx.model.AddBoolAnd([v.Not() for v in grade2_vars]).OnlyEnforceIf(grade2_present.Not())

                # HARD CONSTRAINT: Cannot have both non-adjacent grades present
                # At least one must NOT be present
                ctx.model.AddBoolOr([grade1_present.Not(), grade2_present.Not()])

                constraints_added += 1
                logger.debug(
                    f"Bunk {bunk.name}: HARD constraint - cannot have both grade {grade1} and {grade2} (gap={gap})"
                )

    ctx.constraint_logger.log_constraint(
        "hard",
        "grade_adjacency",
        f"Grade adjacency HARD constraints. "
        f"Checked {total_bunks_checked} bunks, skipped {total_bunks_skipped}. "
        f"Added {constraints_added} hard constraints.",
    )

    logger.info(
        f"Grade adjacency: Checked {total_bunks_checked} bunks, "
        f"skipped {total_bunks_skipped}, added {constraints_added} HARD constraints"
    )
