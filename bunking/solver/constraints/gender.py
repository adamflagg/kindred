"""
Gender Constraints - Ensure gender-appropriate cabin assignments.

CRITICAL SAFETY CONSTRAINT:
- B- cabins: Only Male (M) campers
- G- cabins: Only Female (F) campers
- AG- cabins: Any gender allowed (Mixed)
"""

from __future__ import annotations

import logging

from .base import SolverContext

logger = logging.getLogger(__name__)


def add_gender_constraints(ctx: SolverContext) -> None:
    """Add constraints to ensure gender-appropriate cabin assignments.

    This is a critical safety constraint that prevents mixing genders
    in single-gender cabins.
    """
    if ctx.is_constraint_disabled("gender"):
        logger.info("Gender constraints DISABLED via debug settings")
        return

    logger.info("Adding gender constraints - CRITICAL for camper safety")

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

    logger.info(f"Added {constraints_added} gender constraint restrictions")

    # Log cabin statistics
    _log_gender_statistics(ctx)


def _log_gender_statistics(ctx: SolverContext) -> None:
    """Log gender-related statistics for debugging."""
    # Count cabins by gender
    male_cabins = sum(1 for b in ctx.bunks if b.gender == "M")
    female_cabins = sum(1 for b in ctx.bunks if b.gender == "F")
    mixed_cabins = sum(1 for b in ctx.bunks if b.gender == "Mixed")

    logger.info(f"Available cabins - Male: {male_cabins}, Female: {female_cabins}, Mixed: {mixed_cabins}")

    # Count persons by gender
    male_count = sum(1 for p in ctx.input.persons if p.gender == "M")
    female_count = sum(1 for p in ctx.input.persons if p.gender == "F")
    other_count = sum(1 for p in ctx.input.persons if p.gender not in ["M", "F"])

    logger.info(f"Campers by gender - Male: {male_count}, Female: {female_count}, Other/Unknown: {other_count}")

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
