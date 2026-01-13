"""
Level Progression Constraints - Prevent camper regression to lower cabin levels.

Soft constraint: Penalty for moving campers down levels (e.g., from B-5 to B-3)
Soft incentive: Prefer moving campers up levels (handled in objective function)
"""

from __future__ import annotations

import logging

from .base import SolverContext
from .helpers import extract_bunk_level, get_level_order

logger = logging.getLogger(__name__)


def add_level_progression_constraints(ctx: SolverContext) -> None:
    """Add soft constraints for level progression.

    Soft constraint: Penalty for moving campers down levels
    Soft incentive: Prefer moving campers up levels (handled in objective)
    """
    if ctx.is_constraint_disabled("level_progression"):
        logger.info("Level progression constraints DISABLED via debug settings")
        return

    # Check if level progression is enabled
    no_regression = ctx.config.get_constraint("level_progression", "no_regression", default=True)
    prefer_progression = ctx.config.get_constraint("level_progression", "prefer_progression", default=True)

    if not (no_regression or prefer_progression):
        return

    # Get penalty weight for regression
    regression_penalty = ctx.config.get_constraint("level_progression", "no_regression_penalty", default=800)

    # Get historical bunking data from input
    # Note: Historical data should be provided through DirectSolverInput
    # For now, skip level progression constraints if no data available
    historical_data = getattr(ctx.input, "historical_bunking", [])

    # Build mapping of person -> previous bunk
    previous_bunks = {}
    for record in historical_data:
        if hasattr(record, "person_cm_id") and hasattr(record, "bunk_name"):
            previous_bunks[record.person_cm_id] = record.bunk_name

    # Get level ordering
    level_order = get_level_order()

    # Process each camper
    regression_violations = 0
    progressions_incentivized = 0

    for person_idx, person_cm_id in enumerate(ctx.person_ids):
        if person_cm_id not in previous_bunks:
            continue  # No previous bunk data

        prev_bunk_name = previous_bunks[person_cm_id]
        prev_level = extract_bunk_level(prev_bunk_name)

        if not prev_level:
            continue  # Could not extract level

        prev_level_idx = level_order.get(prev_level, -1)
        if prev_level_idx == -1:
            continue  # Unknown level

        # Get camper details
        person = ctx.person_by_cm_id[person_cm_id]

        # Apply constraints only for bunks the camper is eligible for
        for bunk_idx, bunk in enumerate(ctx.bunks):
            # Check eligibility (session and gender match)
            if person.session_cm_id != bunk.session_cm_id:
                continue
            if bunk.gender not in ["Mixed", "AG"] and person.gender != bunk.gender:
                continue

            curr_level = extract_bunk_level(bunk.name)
            if not curr_level:
                continue

            curr_level_idx = level_order.get(curr_level, -1)
            if curr_level_idx == -1:
                continue

            # Soft constraint: penalty for regression
            if no_regression and curr_level_idx < prev_level_idx:
                # Create violation variable for regression
                violation_var = ctx.model.NewBoolVar(f"level_regression_{person_idx}_from_{prev_level}_to_{curr_level}")

                # Violation occurs when person is assigned to lower level
                ctx.model.Add(ctx.assignments[(person_idx, bunk_idx)] == 1).OnlyEnforceIf(violation_var)

                ctx.model.Add(ctx.assignments[(person_idx, bunk_idx)] == 0).OnlyEnforceIf(violation_var.Not())

                # Store violation with penalty
                ctx.soft_constraint_violations[f"level_regression_{person_idx}_{bunk_idx}"] = (
                    violation_var,
                    regression_penalty,
                )

                regression_violations += 1

            # Soft constraint: prefer progression (handled in objective)
            if prefer_progression and curr_level_idx > prev_level_idx:
                progressions_incentivized += 1

    logger.info(
        f"Level progression: {regression_violations} regression penalties added (weight: {regression_penalty}), "
        f"{progressions_incentivized} progression incentives. "
        f"Only checked eligible bunks per camper (session/gender filtered)."
    )
