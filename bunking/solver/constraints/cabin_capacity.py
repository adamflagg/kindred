"""
Cabin Capacity Constraint — enforce per-bunk hard capacity.

Hard-only: the solver caps each bunk at ``DEFAULT_BUNK_CAPACITY`` (12) by
default. One exception to the "solver never exceeds the standard" rule:

1. **Overflow opt-in** (``allow_overflow=True``): each bunk's cap is raised by
   one seat — to 13 for a standard 12-seat cabin, or ``capacity + 1`` for a
   smaller specialty cabin. This lets the solver absorb a camper that otherwise
   cannot fit, while still respecting any per-bunk capacity below the standard.
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

    When ``allow_overflow=True``, the cap is raised by one seat above the
    per-bunk cap (13 for a standard 12-seat cabin, ``capacity + 1`` for a
    smaller specialty cabin) to absorb a camper that otherwise cannot fit.

    Args:
        ctx: Solver context with model, assignments, and mappings
    """
    overflow = ctx.input.allow_overflow
    for bunk_idx, bunk in enumerate(ctx.bunks):
        total = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(len(ctx.person_ids)))
        cap = min(bunk.capacity, DEFAULT_BUNK_CAPACITY) + (1 if overflow else 0)
        ctx.model.Add(total <= cap)

    logger.info(f"Added hard cabin capacity constraints (overflow={overflow})")
