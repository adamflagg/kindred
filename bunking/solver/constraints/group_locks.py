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
    #
    # Two cases to relax:
    #   (a) TRUE straddle: some members locked, some free → cabin lock wins.
    #   (b) ALL members locked but in DIFFERENT locked cabins → "stay together"
    #       constraint fights the per-cabin pins → infeasible.
    # Build a map from person_idx → which locked bunk they're pinned in.
    locked_bunk_by_person_idx: dict[int, int] = {
        ctx.person_idx_map[c]: bunk_cm_id
        for bunk_cm_id, occupants in ctx.input.locked_bunks.items()
        for c in occupants
        if c in ctx.person_idx_map
    }

    for group_lock_id, person_cm_ids in ctx.input.group_locks.items():
        # Convert to person indices
        group_indices = [ctx.person_idx_map[cm_id] for cm_id in person_cm_ids if cm_id in ctx.person_idx_map]

        if len(group_indices) < 2:
            continue  # No constraint needed for single person

        locked_member_idxs = [i for i in group_indices if i in locked_bunk_by_person_idx]

        if locked_member_idxs:
            # Case (a): some locked, some free → straddle, relax.
            # Case (b): all locked but spread across ≥2 different locked bunks → relax.
            is_partial_straddle = len(locked_member_idxs) != len(group_indices)
            is_split_across_bunks = len({locked_bunk_by_person_idx[i] for i in locked_member_idxs}) > 1
            if is_partial_straddle or is_split_across_bunks:
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
