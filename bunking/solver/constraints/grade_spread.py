"""
Grade Spread Constraints - Limit the number of unique grades in each bunk.

Supports two modes via constraint.grade_spread.mode config:
1. HARD mode (default): Solver fails if any bunk exceeds max unique grades
2. SOFT mode: Allows violation but penalizes in objective function

This helps maintain age-appropriate groupings within each bunk.
"""

from __future__ import annotations

from typing import Any

from bunking.logging_config import get_logger
from bunking.solver.penalties import grade_spread_penalty

from .base import SolverContext
from .helpers import get_eligible_campers_for_bunk, is_ag_session_bunk

logger = get_logger(__name__)


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
        unique_grades = sorted({person.grade for _, person in eligible_campers})

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

    # Penalty for excess unique grades. Read via the centralized accessor so
    # this OR-Tools cost contribution stays in lockstep with the post-solve
    # evaluators (see bunking/solver/penalties.py).
    penalty_weight = grade_spread_penalty()

    logger.debug(f"Adding grade spread soft constraints (max {max_unique_grades} grades, penalty: {penalty_weight})")

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
        unique_grades = sorted({person.grade for _, person in eligible_campers})

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

    logger.debug(f"Added grade spread soft penalties for {penalties_added} bunks")


from bunking.models_v2 import DirectBunkRequest  # noqa: E402
from bunking.solver.impossibility import (  # noqa: E402
    HardConstraintImpossibility,
    ImpossibilityContext,
    ImpossibilityReason,
    register,
)


class GradeCompatibilityImpossibility(HardConstraintImpossibility):
    """Bunks span max 2 consecutive grades (max_grade_range=2 by default).

    Pair: if |a.grade - b.grade| > (max_range - 1), the pair cannot
    co-occupy ANY bunk satisfying grade_spread + grade_adjacency.

    Cluster: added in Task 9.
    """

    name = "grade_compatibility"

    def _max_gap(self, ctx: ImpossibilityContext) -> int:
        max_range = ctx.config.get_constraint("grade_spread", "max_spread", default=2)
        # max_range is "max unique grades per bunk" combined with adjacency:
        # max(grades) - min(grades) <= max_range - 1
        return max(0, int(max_range) - 1)

    def check_pair(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if req.request_type != "bunk_with":
            return None
        if not req.requested_person_cm_id:
            return None
        requester = ctx.person_by_cm_id.get(req.requester_person_cm_id)
        requestee = ctx.person_by_cm_id.get(req.requested_person_cm_id)
        if requester is None or requestee is None:
            return None
        max_gap = self._max_gap(ctx)
        gap = abs(requester.grade - requestee.grade)
        if gap <= max_gap:
            return None
        return ImpossibilityReason(
            code="grade_compatibility",
            message=(
                f"{requester.first_name} (grade {requester.grade}) and "
                f"{requestee.first_name} (grade {requestee.grade}) span "
                f"{gap} grade levels; cabins can only span "
                f"{max_gap + 1} consecutive grade(s)."
            ),
            detail={
                "gap": gap,
                "max_gap_allowed": max_gap,
                "requester_grade": requester.grade,
                "requestee_grade": requestee.grade,
            },
        )

    def check_cluster(self, component_cms: set[int], ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if len(component_cms) < 2:
            return None
        grades = [ctx.person_by_cm_id[cm].grade for cm in component_cms if cm in ctx.person_by_cm_id]
        if not grades:
            return None
        gmin, gmax = min(grades), max(grades)
        max_gap = self._max_gap(ctx)
        rng = gmax - gmin
        if rng <= max_gap:
            return None
        return ImpossibilityReason(
            code="cluster_grade_compatibility",
            message=(
                f"A group of {len(component_cms)} campers linked by bunk_with "
                f"spans grades {gmin}-{gmax} (range {rng}); cabins can only "
                f"span {max_gap + 1} consecutive grade(s)."
            ),
            detail={
                "grade_min": gmin,
                "grade_max": gmax,
                "range": rng,
                "max_range_allowed": max_gap,
                "size": len(component_cms),
            },
        )


register(GradeCompatibilityImpossibility())
