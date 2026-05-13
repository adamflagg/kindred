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


# ---------------------------------------------------------------------------
# Impossibility predicate
# ---------------------------------------------------------------------------

from bunking.solver.impossibility import (  # noqa: E402
    HardConstraintImpossibility,
    ImpossibilityContext,
    ImpossibilityReason,
    register,
)


class BunkCapacityImpossibility(HardConstraintImpossibility):
    """A bunk_with connected component cannot exceed any single bunk's capacity.

    Looks at bunks in the component's session (all members are same-session
    by definition — session_boundary already filtered).
    """

    name = "bunk_capacity"

    def check_cluster(self, component_cms: set[int], ctx: ImpossibilityContext) -> ImpossibilityReason | None:
        if len(component_cms) < 2:
            return None
        sessions: set[int] = {s for cm in component_cms if (s := ctx.person_session.get(cm)) is not None}
        if len(sessions) != 1:
            return None  # mixed sessions; session_boundary catches the bad pairs
        session = next(iter(sessions))
        bunks = ctx.bunks_by_session.get(session, [])
        max_capacity = max((b.capacity for b in bunks), default=0)
        if len(component_cms) <= max_capacity:
            return None
        return ImpossibilityReason(
            code="cluster_capacity",
            message=(
                f"A group of {len(component_cms)} campers linked by bunk_with "
                f"exceeds any cabin's capacity in session {session} "
                f"(max: {max_capacity})."
            ),
            detail={
                "component_size": len(component_cms),
                "max_bunk_capacity": max_capacity,
                "session": session,
            },
        )


register(BunkCapacityImpossibility())
