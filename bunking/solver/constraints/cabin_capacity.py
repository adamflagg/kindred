"""
Cabin Capacity Constraint — enforce per-bunk hard capacity.

Hard-only: the solver caps each bunk at ``DEFAULT_BUNK_CAPACITY``. The previous
soft-mode path (graduated overflow penalties with an unavoidable-overflow
exception) was deleted in Phase 2 — the user's policy is "solver never exceeds
the standard; staff can manually drag up to ``MAX_BUNK_CAPACITY`` after the
solver runs". The soft penalty path was never used in practice and was the
"too flexible" failure mode that prompted the cleanup.

If per-bunk variance is ever needed, ``DirectBunk.capacity`` is still the
right per-bunk attribute — wire it up to a real PB column at that point.
"""

from __future__ import annotations

from bunking.logging_config import get_logger
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY

from .base import SolverContext

logger = get_logger(__name__)


def add_cabin_capacity_constraints(ctx: SolverContext) -> None:
    """Add hard capacity constraints for cabins.

    Caps each bunk at ``min(bunk.capacity, DEFAULT_BUNK_CAPACITY)`` so a future
    smaller per-bunk capacity (e.g., specialty cabin) is still respected, while
    larger ``bunk.capacity`` values are clamped at the standard.

    Args:
        ctx: Solver context with model, assignments, and mappings
    """
    for bunk_idx, bunk in enumerate(ctx.bunks):
        total = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(len(ctx.person_ids)))
        capacity = min(bunk.capacity, DEFAULT_BUNK_CAPACITY)
        ctx.model.Add(total <= capacity)

    logger.info(f"Added hard cabin capacity constraints (cap: {DEFAULT_BUNK_CAPACITY})")
