"""
Gender Constraints - Ensure gender-appropriate cabin assignments.

CRITICAL SAFETY CONSTRAINT:
- B- cabins: Only Male (M) campers
- G- cabins: Only Female (F) campers
- AG- cabins: Any gender allowed (Mixed)
"""

from __future__ import annotations

from bunking.logging_config import get_logger

from .base import SolverContext

logger = get_logger(__name__)


def add_gender_constraints(ctx: SolverContext) -> None:
    """Add constraints to ensure gender-appropriate cabin assignments.

    This is a critical safety constraint that prevents mixing genders
    in single-gender cabins.
    """
    if ctx.is_constraint_disabled("gender"):
        logger.info("Gender constraints DISABLED via debug settings")
        return

    logger.info("Gender constraints active")

    constraints_added = 0

    for bunk_idx, bunk in enumerate(ctx.bunks):
        # Skip if bunk doesn't have gender specified
        if not bunk.gender:
            logger.warning(f"Bunk {bunk.name} has no gender specified - skipping gender constraint")
            continue

        if bunk.gender in ["Mixed", "AG"]:
            # Mixed/AG cabins - no gender constraint needed
            continue

        # For single-gender cabins (M or F), enforce constraint
        for person_idx, person_cm_id in enumerate(ctx.person_ids):
            person = ctx.person_by_cm_id[person_cm_id]

            # Check if person's gender matches cabin gender
            if person.gender and person.gender != bunk.gender:
                # Person cannot be in this cabin due to gender mismatch
                ctx.model.Add(ctx.assignments[(person_idx, bunk_idx)] == 0)
                constraints_added += 1

                # Log constraint for debugging
                ctx.constraint_logger.log_constraint(
                    "hard", "gender", f"Person {person.name} ({person.gender}) cannot be in {bunk.name} ({bunk.gender})"
                )
            elif not person.gender:
                # If person has no gender data, log warning but don't constrain
                logger.warning(f"Person {person_cm_id} ({person.name}) has no gender data")

    logger.debug(f"Added {constraints_added} gender constraint restrictions")

    # Log cabin statistics
    _log_gender_statistics(ctx)


def _log_gender_statistics(ctx: SolverContext) -> None:
    """Log gender-related statistics for debugging."""
    # Count cabins by gender
    male_cabins = sum(1 for b in ctx.bunks if b.gender == "M")
    female_cabins = sum(1 for b in ctx.bunks if b.gender == "F")
    mixed_cabins = sum(1 for b in ctx.bunks if b.gender == "Mixed")

    logger.debug(f"Available cabins - Male: {male_cabins}, Female: {female_cabins}, Mixed: {mixed_cabins}")

    # Count persons by gender
    male_count = sum(1 for p in ctx.input.persons if p.gender == "M")
    female_count = sum(1 for p in ctx.input.persons if p.gender == "F")
    other_count = sum(1 for p in ctx.input.persons if p.gender not in ["M", "F"])

    logger.debug(f"Campers by gender - Male: {male_count}, Female: {female_count}, Other/Unknown: {other_count}")

    # Check capacity
    male_capacity = sum(b.capacity for b in ctx.bunks if b.gender == "M")
    female_capacity = sum(b.capacity for b in ctx.bunks if b.gender == "F")
    mixed_capacity = sum(b.capacity for b in ctx.bunks if b.gender == "Mixed")

    if male_count > male_capacity + mixed_capacity:
        logger.error(f"INSUFFICIENT CAPACITY: {male_count} males but only {male_capacity + mixed_capacity} spots")
        ctx.constraint_logger.log_feasibility_warning(
            f"Insufficient male capacity: {male_count} males, {male_capacity + mixed_capacity} spots"
        )
    if female_count > female_capacity + mixed_capacity:
        logger.error(f"INSUFFICIENT CAPACITY: {female_count} females but only {female_capacity + mixed_capacity} spots")
        ctx.constraint_logger.log_feasibility_warning(
            f"Insufficient female capacity: {female_count} females, {female_capacity + mixed_capacity} spots"
        )


# ---------------------------------------------------------------------------
# Impossibility predicate: pair_no_shared_bunk (gender axis)
# ---------------------------------------------------------------------------

from bunking.models_v2 import DirectBunkRequest  # noqa: E402
from bunking.solver.impossibility import (  # noqa: E402
    HardConstraintImpossibility,
    ImpossibilityContext,
    ImpossibilityReason,
    register,
)


class GenderImpossibility(HardConstraintImpossibility):
    name = "gender"

    def check_pair(self, req: DirectBunkRequest, ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if req.request_type != "bunk_with":
            return None
        if not req.requested_person_cm_id:
            return None
        requester = ctx.person_by_cm_id.get(req.requester_person_cm_id)
        requestee = ctx.person_by_cm_id.get(req.requested_person_cm_id)
        if requester is None or requestee is None:
            return None
        session = ctx.person_session.get(req.requester_person_cm_id)
        if session is None or session != ctx.person_session.get(req.requested_person_cm_id):
            return None  # cross-session is handled by SessionBoundaryImpossibility
        bunks = ctx.bunks_by_session.get(session, [])
        for bunk in bunks:
            if bunk.gender in ("Mixed", "AG"):
                return None
            if bunk.gender == requester.gender == requestee.gender:
                return None
        return ImpossibilityReason(
            code="pair_no_shared_bunk",
            message=(
                f"{requester.first_name} ({requester.gender}) and "
                f"{requestee.first_name} ({requestee.gender}) cannot share any cabin "
                f"in session {session}."
            ),
            detail={
                "requester_gender": requester.gender,
                "requestee_gender": requestee.gender,
                "session": session,
            },
        )


register(GenderImpossibility())
