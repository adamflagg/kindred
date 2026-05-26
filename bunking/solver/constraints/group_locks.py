"""
Group Lock Constraints - Keep groups of campers together.

Groups of campers that are locked together can be moved as a unit
to any cabin, but must stay together.
"""

from bunking.logging_config import get_logger

from .base import SolverContext

logger = get_logger(__name__)


def add_group_lock_constraints(ctx: SolverContext) -> None:
    """Add constraints for group locks.

    Groups of campers that are locked together can be moved as a unit
    to any cabin, but must stay together.
    """
    if ctx.is_constraint_disabled("group_locks"):
        logger.info("Group lock constraints DISABLED via debug settings")
        return

    if ctx.input.group_locks:
        ctx.constraint_logger.log_constraint(
            "hard", "group_locks", f"{len(ctx.input.group_locks)} group locks to keep campers together"
        )

    # Partial cabin re-solve (#1609): members pinned inside a locked cabin can't move,
    # so a friend-lock group that straddles the lock boundary would be infeasible. The
    # cabin lock wins — such groups are relaxed below.
    locked_occupant_idxs = {
        ctx.person_idx_map[c]
        for occupants in ctx.input.locked_bunks.values()
        for c in occupants
        if c in ctx.person_idx_map
    }

    for group_lock_id, person_cm_ids in ctx.input.group_locks.items():
        # Convert to person indices
        group_indices = [ctx.person_idx_map[cm_id] for cm_id in person_cm_ids if cm_id in ctx.person_idx_map]

        if len(group_indices) < 2:
            continue  # No constraint needed for single person

        # Relax only a TRUE straddle: some members pinned in a locked cabin, some free.
        if (
            locked_occupant_idxs
            and any(i in locked_occupant_idxs for i in group_indices)
            and not all(i in locked_occupant_idxs for i in group_indices)
        ):
            logger.info(f"group_lock {group_lock_id} straddles a locked cabin; relaxing (cabin lock wins)")
            continue

        logger.info(f"Adding group lock constraint for {len(group_indices)} campers in group {group_lock_id}")

        # For each bunk, either all group members are in or none are in
        for bunk_idx, bunk in enumerate(ctx.bunks):
            # Check if bunk has capacity for the group
            if bunk.capacity >= len(group_indices):
                # Create variable for "group is in this bunk"
                group_in_bunk = ctx.model.NewBoolVar(f"group_lock_{group_lock_id}_in_bunk_{bunk_idx}")

                # If group_in_bunk, all members must be in this bunk
                for person_idx in group_indices:
                    ctx.model.Add(ctx.assignments[(person_idx, bunk_idx)] == 1).OnlyEnforceIf(group_in_bunk)

                # If any member is in this bunk, all must be
                # This ensures they stay together
                for i, person_idx in enumerate(group_indices):
                    others_in_bunk = []
                    for j, other_idx in enumerate(group_indices):
                        if i != j:
                            others_in_bunk.append(ctx.assignments[(other_idx, bunk_idx)])

                    # If this person is in bunk, all others must be too
                    ctx.model.Add(sum(others_in_bunk) == len(others_in_bunk)).OnlyEnforceIf(
                        ctx.assignments[(person_idx, bunk_idx)]
                    )
            else:
                # Bunk too small for group - none can be assigned
                for person_idx in group_indices:
                    ctx.model.Add(ctx.assignments[(person_idx, bunk_idx)] == 0)
