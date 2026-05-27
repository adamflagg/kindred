"""
Cabin Capacity Constraint — enforce per-bunk hard capacity.

Hard-only: the solver caps each unlocked bunk at ``DEFAULT_BUNK_CAPACITY`` (12)
by default. Two exceptions to the "solver never exceeds the standard" rule:

1. **Partial re-solve overflow** (PR #1609): when ``locked_bunks`` is non-empty
   AND ``allow_overflow=True``, unlocked bunks may be filled to
   ``DEFAULT_BUNK_CAPACITY + 1`` (13). This lets the re-solver absorb a camper
   displaced from a locked under-filled cabin without leaving them unassigned.
2. **Staff drag-and-drop**: staff can manually move a camper to any bunk up to
   ``MAX_BUNK_CAPACITY`` (14) in the assignments editor after a solve completes.

Locked cabins (#1609) are skipped entirely: their exact occupancy is already
pinned by ``add_locked_bunk_constraints`` and must not be re-capped.

If per-bunk variance is ever needed, ``DirectBunk.capacity`` is still the
right per-bunk attribute — wire it up to a real PB column at that point.
"""

from bunking.logging_config import get_logger
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY

from .base import SolverContext

logger = get_logger(__name__)


def add_cabin_capacity_constraints(ctx: SolverContext) -> None:
    """Add hard capacity constraints for cabins.

    Unlocked cabins are capped at ``min(bunk.capacity, DEFAULT_BUNK_CAPACITY)`` (12),
    or at ``DEFAULT_BUNK_CAPACITY + 1`` (13) during a partial re-solve when
    ``allow_overflow`` is set. Locked cabins (#1609) are skipped: their exact occupancy
    is already pinned by ``add_locked_bunk_constraints`` and must not be re-capped.

    Args:
        ctx: Solver context with model, assignments, and mappings
    """
    locked = set(ctx.input.locked_bunks)  # bunk cm_ids frozen by add_locked_bunk_constraints
    # Overflow only applies during a partial re-solve (allow_unassigned=True);
    # allow_overflow alone is intentionally a no-op on a full solve.
    overflow = ctx.input.allow_unassigned and ctx.input.allow_overflow
    for bunk_idx, bunk in enumerate(ctx.bunks):
        if bunk.campminder_id in locked:
            continue  # exact occupancy already pinned; never re-cap a frozen cabin
        total = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(len(ctx.person_ids)))
        cap = DEFAULT_BUNK_CAPACITY + 1 if overflow else min(bunk.capacity, DEFAULT_BUNK_CAPACITY)
        ctx.model.Add(total <= cap)

    logger.info(f"Added hard cabin capacity constraints (overflow={overflow})")
