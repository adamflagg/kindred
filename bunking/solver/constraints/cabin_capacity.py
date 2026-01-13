"""
Cabin Capacity Constraints - Enforce maximum occupancy limits.

Supports two modes:
1. HARD mode: Strict max capacity - solver fails if exceeded
2. SOFT mode: Allows overflow up to max but penalizes assignments beyond standard capacity

Includes UNAVOIDABLE OVERFLOW EXCEPTION: If a gender has more campers than total
capacity, the first N overflows are exempt from penalty (where N = campers - capacity).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .base import SolverContext
from .helpers import is_ag_session_bunk

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


def add_cabin_capacity_constraints(ctx: SolverContext) -> None:
    """Add hard capacity constraints for cabins.

    Ensures no cabin exceeds its maximum capacity.

    Args:
        ctx: Solver context with model, assignments, and mappings
    """
    max_capacity = ctx.config.get_int("constraint.cabin_capacity.max", default=14)

    for bunk_idx, bunk in enumerate(ctx.bunks):
        # Calculate total assignments to this bunk
        total = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(len(ctx.person_ids)))

        # Hard limit: cannot exceed max capacity
        capacity = min(bunk.capacity, max_capacity)
        ctx.model.Add(total <= capacity)

    logger.info(f"Added hard cabin capacity constraints (max: {max_capacity})")


def add_cabin_capacity_soft_constraint(ctx: SolverContext, objective_terms: list[Any]) -> None:
    """Add soft constraint penalties for exceeding standard cabin capacity.

    When cabin capacity is configured as soft, we allow overflow up to max capacity
    but penalize assignments beyond the standard capacity.

    UNAVOIDABLE OVERFLOW EXCEPTION: If a gender has more campers than total capacity,
    the first N overflows (where N = campers - capacity) are exempt from penalty.
    We only penalize overflows beyond what's mathematically required.

    Args:
        ctx: Solver context with model, assignments, and mappings
        objective_terms: List to append penalty terms to (negative values)
    """
    # Get penalty weight for violations - default raised to ensure capacity > flow incentives
    penalty_weight = ctx.config.get_int("constraint.cabin_capacity.penalty", default=50000)
    max_capacity = ctx.config.get_int("constraint.cabin_capacity.max", default=14)
    standard_capacity_config = ctx.config.get_int("constraint.cabin_capacity.standard", default=12)

    # Calculate capacity and unavoidable overflow per gender
    bunks_by_gender: dict[str, list[tuple[int, Any]]] = {"M": [], "F": []}  # (bunk_idx, bunk)
    campers_by_gender: dict[str, int] = {"M": 0, "F": 0}

    # First, identify AG session IDs (sessions that have Mixed/AG bunks)
    # Campers enrolled in these sessions go to AG bunks, not M/F bunks
    ag_session_ids: set[int] = set()
    for bunk in ctx.bunks:
        if is_ag_session_bunk(bunk):
            ag_session_ids.add(bunk.session_cm_id)

    for bunk_idx, bunk in enumerate(ctx.bunks):
        if is_ag_session_bunk(bunk):
            continue
        if bunk.gender in bunks_by_gender:
            bunks_by_gender[bunk.gender].append((bunk_idx, bunk))

    ag_excluded_count = 0
    for person in ctx.persons:
        # Only count non-AG campers (those with M or F gender in non-AG sessions)
        # AG-enrolled campers have their own bunks and shouldn't count toward M/F capacity
        if person.session_cm_id in ag_session_ids:
            ag_excluded_count += 1
            continue  # Skip AG-enrolled campers
        if person.gender in campers_by_gender:
            bunks_for_gender = bunks_by_gender.get(person.gender, [])
            if bunks_for_gender:  # Only count if they have bunks
                campers_by_gender[person.gender] += 1

    if ag_excluded_count > 0:
        logger.info(f"Excluded {ag_excluded_count} AG-enrolled campers from M/F capacity calculation")

    # Calculate unavoidable overflow per gender
    unavoidable_by_gender: dict[str, int] = {}
    for gender in ["M", "F"]:
        total_capacity = len(bunks_by_gender[gender]) * standard_capacity_config
        total_campers = campers_by_gender[gender]
        unavoidable = max(0, total_campers - total_capacity)
        unavoidable_by_gender[gender] = unavoidable
        if unavoidable > 0:
            logger.info(
                f"{gender}: {total_campers} campers, {total_capacity} capacity = "
                f"{unavoidable} UNAVOIDABLE overflow (exempt from penalty)"
            )
        else:
            logger.info(f"{gender}: {total_campers} campers, {total_capacity} capacity = NO unavoidable overflow")

    logger.info(
        f"Adding cabin capacity soft constraints (penalty: {penalty_weight}, standard: {standard_capacity_config})"
    )

    # Track per-bunk overflow variables by gender for total calculation
    overflow_vars_by_gender: dict[str, list[Any]] = {"M": [], "F": []}

    # For each bunk, create overflow tracking variable
    for bunk_idx, bunk in enumerate(ctx.bunks):
        if is_ag_session_bunk(bunk):
            continue

        standard_capacity = bunk.capacity
        if standard_capacity >= max_capacity:
            continue

        # Calculate occupancy
        occupancy_expr = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(len(ctx.person_ids)))

        # Create variable for overcrowding
        overcrowd_amount = ctx.model.NewIntVar(0, max_capacity - standard_capacity, f"overcrowd_b{bunk_idx}")
        ctx.model.Add(overcrowd_amount >= occupancy_expr - standard_capacity)

        # Track this overflow for gender-level total
        if bunk.gender in overflow_vars_by_gender:
            overflow_vars_by_gender[bunk.gender].append(overcrowd_amount)

    # Create gender-level total overflow and apply penalty only beyond unavoidable
    for gender in ["M", "F"]:
        overflow_vars = overflow_vars_by_gender[gender]
        if not overflow_vars:
            continue

        unavoidable = unavoidable_by_gender[gender]
        max_possible_overflow = len(overflow_vars) * (max_capacity - standard_capacity_config)

        # Sum all per-bunk overflows
        total_overflow = ctx.model.NewIntVar(0, max_possible_overflow, f"total_overflow_{gender}")
        ctx.model.Add(total_overflow == sum(overflow_vars))

        # Calculate penalized overflow = total - unavoidable (but >= 0)
        penalized_overflow = ctx.model.NewIntVar(0, max_possible_overflow, f"penalized_overflow_{gender}")
        ctx.model.Add(penalized_overflow >= total_overflow - unavoidable)

        # Apply graduated penalties to PENALIZED overflow only
        # First overflow beyond unavoidable gets half penalty
        first_overflow = ctx.model.NewBoolVar(f"first_penalized_overflow_{gender}")
        ctx.model.Add(penalized_overflow >= 1).OnlyEnforceIf(first_overflow)
        ctx.model.Add(penalized_overflow == 0).OnlyEnforceIf(first_overflow.Not())
        objective_terms.append(-int(penalty_weight // 2) * first_overflow)

        # Second+ overflow beyond unavoidable gets full penalty each
        second_overflow = ctx.model.NewBoolVar(f"second_penalized_overflow_{gender}")
        ctx.model.Add(penalized_overflow >= 2).OnlyEnforceIf(second_overflow)
        ctx.model.Add(penalized_overflow <= 1).OnlyEnforceIf(second_overflow.Not())
        objective_terms.append(-penalty_weight * second_overflow)

        # Third+ overflow - escalating penalty
        if max_possible_overflow >= 3:
            third_plus = ctx.model.NewIntVar(0, max_possible_overflow - 2, f"third_plus_overflow_{gender}")
            ctx.model.Add(third_plus >= penalized_overflow - 2)
            objective_terms.append(-int(penalty_weight * 1.5) * third_plus)

        logger.info(f"{gender}: Created capacity penalty with {unavoidable} unavoidable exemption")

    logger.info("Added cabin capacity soft penalties with unavoidable overflow exemption")
