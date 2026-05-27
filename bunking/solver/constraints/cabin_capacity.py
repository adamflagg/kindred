"""
Cabin Capacity Constraint — enforce per-bunk hard capacity.

Hard-only: the solver caps each bunk at ``DEFAULT_BUNK_CAPACITY`` (12) by
default. One exception to the "solver never exceeds the standard" rule:

1. **Partial re-solve overflow** (PR #1609): when ``allow_unassigned=True``
   AND ``allow_overflow=True``, bunks may be filled to
   ``DEFAULT_BUNK_CAPACITY + 1`` (13). This lets the re-solver absorb a camper
   displaced from a previously locked (now-removed) cabin without leaving them
   unassigned.
2. **Staff drag-and-drop**: staff can manually move a camper to any bunk up to
   ``MAX_BUNK_CAPACITY`` (14) in the assignments editor after a solve completes.

If per-bunk variance is ever needed, ``DirectBunk.capacity`` is still the
right per-bunk attribute — wire it up to a real PB column at that point.
"""

from bunking.logging_config import get_logger
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY

from .base import SolverContext

logger = get_logger(__name__)


def add_cabin_capacity_constraints(ctx: SolverContext) -> None:
    """Add hard capacity constraints for cabins.

    Caps each bunk at ``min(bunk.capacity, DEFAULT_BUNK_CAPACITY)`` (12) so a
    future smaller per-bunk capacity (e.g., specialty cabin) is still respected,
    while larger ``bunk.capacity`` values are clamped at the standard.

    During a partial re-solve (``allow_unassigned=True``) with ``allow_overflow=True``,
    the cap is raised to ``DEFAULT_BUNK_CAPACITY + 1`` (13) to absorb a displaced camper.

    Args:
        ctx: Solver context with model, assignments, and mappings
    """
    # Overflow only applies during a partial re-solve (allow_unassigned=True);
    # allow_overflow alone is intentionally a no-op on a full solve.
    overflow = ctx.input.allow_unassigned and ctx.input.allow_overflow
    for bunk_idx, bunk in enumerate(ctx.bunks):
        total = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(len(ctx.person_ids)))
        cap = DEFAULT_BUNK_CAPACITY + 1 if overflow else min(bunk.capacity, DEFAULT_BUNK_CAPACITY)
        ctx.model.Add(total <= cap)

    logger.info(f"Added hard cabin capacity constraints (overflow={overflow})")
