"""
Cabin Minimum Occupancy Constraints - Ensure bunks have enough campers.

Staff never put fewer than ~8 campers in a cabin. This module adds:
1. Hard constraint: If bunk has ANY campers, must have at least MIN_BUNK_OCCUPANCY
2. Force all cabins used: All non-AG bunks must be used (per gender), when
   enrollment supports it (graceful step-aside otherwise — logged WARNING)
3. Soft penalty: Charges PREFERRED_BUNK_OCCUPANCY - occupancy per spot for used
   non-AG bunks (penalty weight read from config — the lone tunable knob)
"""

from typing import Any

from ortools.sat.python import cp_model

from bunking.logging_config import get_logger
from bunking.solver.constants import MIN_BUNK_OCCUPANCY, PREFERRED_BUNK_OCCUPANCY
from bunking.solver.penalties import min_occupancy_penalty, min_occupancy_threshold

from .base import SolverContext
from .helpers import is_ag_session_bunk

logger = get_logger(__name__)


def add_cabin_minimum_occupancy_constraints(
    ctx: SolverContext,
) -> dict[int, cp_model.IntVar]:
    """Add minimum occupancy constraints for non-AG bunks.

    Staff never put fewer than ~8 campers in a cabin. This adds:
    1. Hard constraint: If bunk has ANY campers, must have at least
       ``MIN_BUNK_OCCUPANCY``.
    2. Force all cabins used: All non-AG bunks must be used (per gender) when
       enrollment supports it. Graceful step-aside (log WARNING, no force-bind)
       if a gender has too few campers for its bunks at minimum occupancy.

    Args:
        ctx: Solver context with model, assignments, and mappings

    Returns:
        Dict mapping bunk_idx to is_used boolean variable (for soft penalty)
    """
    bunk_is_used: dict[int, cp_model.IntVar] = {}

    min_occupancy = min_occupancy_threshold()

    # Partial cabin re-solve (#1609): locked bunks have frozen rosters — exempting them
    # from hard composition constraints avoids infeasibility when a pinned occupancy is
    # below the minimum or when the roster spans forbidden grade combinations.
    locked_bunk_cms: set[int] = set(ctx.input.locked_bunks)
    locked_occupant_cms: set[int] = {c for occ in ctx.input.locked_bunks.values() for c in occ}

    # Count bunks and campers per gender for force-all-used logic
    bunks_by_gender: dict[str, list[int]] = {"M": [], "F": []}
    campers_by_gender: dict[str, int] = {"M": 0, "F": 0}

    # Identify AG session IDs (sessions with Mixed/AG bunks)
    ag_session_ids: set[int] = set()
    for bunk in ctx.bunks:
        if is_ag_session_bunk(bunk):
            ag_session_ids.add(bunk.session_cm_id)

    for bunk_idx, bunk in enumerate(ctx.bunks):
        if is_ag_session_bunk(bunk):
            continue
        # Skip locked bunks: their occupancy is frozen, not free to fill unlocked space
        if bunk.campminder_id in locked_bunk_cms:
            continue
        gender = bunk.gender
        if gender in bunks_by_gender:
            bunks_by_gender[gender].append(bunk_idx)

    for person in ctx.persons:
        # Skip AG-enrolled campers - they have their own bunks
        if person.session_cm_id in ag_session_ids:
            continue
        # Skip locked occupants: they are already frozen in their locked bunk
        if person.campminder_person_id in locked_occupant_cms:
            continue
        gender = person.gender
        if gender in campers_by_gender:
            campers_by_gender[gender] += 1

    # Determine which genders qualify for force-all-used. Genders that fail
    # the headcount check step aside with a WARNING; their bunks still get
    # the per-bunk hard floor but are not forced to be occupied.
    force_genders: set[str] = set()
    for gender in ["M", "F"]:
        num_bunks = len(bunks_by_gender[gender])
        num_campers = campers_by_gender[gender]
        if num_bunks > 0 and num_campers >= min_occupancy * num_bunks:
            force_genders.add(gender)
            logger.debug(
                f"Force all {gender} bunks used: {num_campers} campers, "
                f"{num_bunks} bunks, min {min_occupancy}/bunk = {min_occupancy * num_bunks} needed"
            )
        elif num_bunks > 0:
            logger.warning(
                f"Cannot force all {gender} bunks: only {num_campers} campers for "
                f"{num_bunks} bunks (need {min_occupancy * num_bunks} for min {min_occupancy})"
            )

    # Count how many bunks get this constraint (skip AG)
    applicable_bunks = sum(len(bunks_by_gender[g]) for g in bunks_by_gender)

    if applicable_bunks == 0:
        logger.info("No non-AG bunks found - skipping minimum occupancy constraints")
        return bunk_is_used

    constraint_desc = f"Minimum {min_occupancy} campers for {applicable_bunks} non-AG bunks"
    if force_genders:
        constraint_desc += f" (force all used for: {', '.join(sorted(force_genders))})"
    ctx.constraint_logger.log_constraint("hard", "cabin_minimum_occupancy", constraint_desc)

    for bunk_idx, bunk in enumerate(ctx.bunks):
        # Skip AG bunks - they take whoever is enrolled
        if is_ag_session_bunk(bunk):
            continue

        # Skip locked bunks: their exact occupancy is already pinned by
        # add_locked_bunk_constraints — enforcing a hard floor on top would
        # create infeasibility when the pinned count is below MIN_BUNK_OCCUPANCY.
        if bunk.campminder_id in locked_bunk_cms:
            continue

        # Calculate occupancy expression for this bunk
        occupancy_expr = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(len(ctx.person_ids)))

        # Create "is_used" boolean: is_used = 1 iff occupancy >= 1
        is_used = ctx.model.NewBoolVar(f"bunk_used_{bunk_idx}")
        bunk_is_used[bunk_idx] = is_used

        # Link is_used to occupancy
        # If is_used, occupancy >= 1
        ctx.model.Add(occupancy_expr >= 1).OnlyEnforceIf(is_used)
        # If not is_used, occupancy == 0
        ctx.model.Add(occupancy_expr == 0).OnlyEnforceIf(is_used.Not())

        # Hard constraint: If bunk is used, must have at least min_occupancy
        ctx.model.Add(occupancy_expr >= min_occupancy).OnlyEnforceIf(is_used)

        # Force all cabins used: if this gender qualifies, force is_used = 1
        if bunk.gender in force_genders:
            ctx.model.Add(is_used == 1)

    forced_count = sum(1 for g in force_genders for _ in bunks_by_gender[g])
    logger.info(
        f"Added minimum occupancy constraints (min={min_occupancy}) for {applicable_bunks} bunks, "
        f"{forced_count} forced to be used"
    )

    return bunk_is_used


def add_cabin_minimum_occupancy_soft_penalty(
    ctx: SolverContext,
    objective_terms: list[Any],
    bunk_is_used: dict[int, cp_model.IntVar],
) -> None:
    """Add soft penalty for bunks between min and preferred occupancy.

    Encourages the solver to fill bunks closer to ``PREFERRED_BUNK_OCCUPANCY``
    rather than just meeting the hard minimum. The penalty weight is the
    lone tunable in this domain.

    Args:
        ctx: Solver context with model, assignments, and mappings
        objective_terms: List to append penalty terms to (negative values)
        bunk_is_used: Dict mapping bunk_idx to is_used variable (from hard constraint)
    """
    if not bunk_is_used:
        return

    penalty_weight = min_occupancy_penalty()
    if penalty_weight <= 0:
        return

    max_underfill = PREFERRED_BUNK_OCCUPANCY - MIN_BUNK_OCCUPANCY

    logger.debug(
        f"Adding cabin minimum occupancy soft penalties "
        f"(min={MIN_BUNK_OCCUPANCY}, preferred={PREFERRED_BUNK_OCCUPANCY}, penalty={penalty_weight})"
    )

    penalties_added = 0
    for bunk_idx, bunk in enumerate(ctx.bunks):
        if is_ag_session_bunk(bunk):
            continue

        is_used = bunk_is_used.get(bunk_idx)
        if is_used is None:
            continue

        # Calculate occupancy for this bunk
        occupancy_expr = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(len(ctx.person_ids)))

        # Underfill: how many spots below preferred. Bounded above by
        # (preferred - min) since the hard constraint forces occupancy >= min
        # whenever the bunk is used.
        underfill = ctx.model.NewIntVar(0, max_underfill, f"underfill_b{bunk_idx}")

        # underfill = max(0, preferred - occupancy) when bunk is used; 0 otherwise.
        ctx.model.Add(underfill >= PREFERRED_BUNK_OCCUPANCY - occupancy_expr).OnlyEnforceIf(is_used)
        ctx.model.Add(underfill == 0).OnlyEnforceIf(is_used.Not())

        # Penalty for each spot below preferred
        objective_terms.append(-penalty_weight * underfill)
        penalties_added += 1

    logger.debug(f"Added minimum occupancy soft penalties for {penalties_added} bunks")
