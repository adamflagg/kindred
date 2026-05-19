"""Grade spread constraints — limit the number of unique grades in each bunk.

Hard-only: the solver caps every non-AG bunk at ``MAX_UNIQUE_GRADES_PER_BUNK``
distinct grades. Staff can override on the bunking board (board flags the
result with ``grade_spread_warning``). Adjacency (consecutive grades only) is
enforced separately by ``grade_adjacency``.
"""

from __future__ import annotations

from bunking.logging_config import get_logger
from bunking.solver.constants import MAX_UNIQUE_GRADES_PER_BUNK

from .base import SolverContext
from .helpers import get_eligible_campers_for_bunk, is_ag_session_bunk

logger = get_logger(__name__)


def add_grade_spread_constraints(ctx: SolverContext) -> None:
    """Add hard constraints to limit unique grades per bunk to MAX_UNIQUE_GRADES_PER_BUNK."""
    if ctx.is_constraint_disabled("grade_spread"):
        logger.info("Grade spread constraints DISABLED via debug settings")
        return

    logger.info(f"Adding hard grade limit constraints (max {MAX_UNIQUE_GRADES_PER_BUNK} unique grades per bunk)")

    constraints_added = 0

    for bunk_idx, bunk in enumerate(ctx.bunks):
        if is_ag_session_bunk(bunk):
            continue

        eligible_campers = get_eligible_campers_for_bunk(ctx, bunk)

        if len(eligible_campers) < 2:
            continue

        unique_grades = sorted({person.grade for _, person in eligible_campers})

        if len(unique_grades) == 1:
            continue

        grade_present_vars = {}
        for grade in unique_grades:
            campers_with_grade = [
                ctx.assignments[(person_idx, bunk_idx)]
                for person_idx, person in eligible_campers
                if person.grade == grade
            ]

            if campers_with_grade:
                grade_present = ctx.model.NewBoolVar(f"grade_{grade}_present_b{bunk_idx}")
                grade_present_vars[grade] = grade_present

                ctx.model.AddBoolOr(campers_with_grade).OnlyEnforceIf(grade_present)
                ctx.model.AddBoolAnd([var.Not() for var in campers_with_grade]).OnlyEnforceIf(grade_present.Not())

        if grade_present_vars:
            ctx.model.Add(sum(grade_present_vars.values()) <= MAX_UNIQUE_GRADES_PER_BUNK)
            constraints_added += 1

    ctx.constraint_logger.log_constraint(
        "hard",
        "grade_spread",
        f"Grade limit constraints (max {MAX_UNIQUE_GRADES_PER_BUNK} unique grades per bunk). "
        f"Created {constraints_added} bunk-level constraints.",
    )

    logger.info(f"Grade limits: Added hard constraints for {constraints_added} bunks")


from bunking.models_v2 import DirectBunkRequest  # noqa: E402
from bunking.solver.impossibility import (  # noqa: E402
    HardConstraintImpossibility,
    ImpossibilityContext,
    ImpossibilityReason,
    register,
)


class GradeCompatibilityImpossibility(HardConstraintImpossibility):
    """Bunks span at most MAX_UNIQUE_GRADES_PER_BUNK consecutive grades.

    Pair: if |a.grade - b.grade| > (MAX_UNIQUE_GRADES_PER_BUNK - 1), the pair
    cannot co-occupy ANY bunk satisfying grade_spread + grade_adjacency.
    """

    name = "grade_compatibility"

    @staticmethod
    def _max_gap() -> int:
        # MAX_UNIQUE_GRADES_PER_BUNK is "max unique grades per bunk" combined with
        # adjacency: max(grades) - min(grades) <= MAX_UNIQUE_GRADES_PER_BUNK - 1
        return max(0, MAX_UNIQUE_GRADES_PER_BUNK - 1)

    def check_pair(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if req.request_type != "bunk_with":
            return None
        if not req.requested_person_cm_id:
            return None
        requester = ctx.person_by_cm_id.get(req.requester_person_cm_id)
        requestee = ctx.person_by_cm_id.get(req.requested_person_cm_id)
        if requester is None or requestee is None:
            return None
        max_gap = self._max_gap()
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


register(GradeCompatibilityImpossibility())
