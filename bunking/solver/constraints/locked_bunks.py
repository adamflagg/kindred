"""Locked-bunk constraints (#1609) — freeze a cabin's exact roster in place.

Partial cabin re-solve: the bunks named in ``ctx.input.locked_bunks`` keep their
current occupants pinned and admit no one else, so the solver only redistributes
the unlocked campers across the unlocked cabins.
"""

from typing import Any

from bunking.logging_config import get_logger
from bunking.models_v2 import DirectBunkAssignment, DirectSolverInput

from .base import SolverContext

logger = get_logger(__name__)


def add_locked_bunk_constraints(ctx: SolverContext) -> None:
    """Pin each locked bunk's current occupants and forbid everyone else."""
    if ctx.is_constraint_disabled("locked_bunks"):
        logger.info("Locked-bunk constraints DISABLED via debug settings")
        return
    if not ctx.input.locked_bunks:
        return

    ctx.constraint_logger.log_constraint(
        "hard", "locked_bunks", f"{len(ctx.input.locked_bunks)} locked cabins frozen in place"
    )

    for bunk_cm_id, occupant_cm_ids in ctx.input.locked_bunks.items():
        bunk_idx = ctx.bunk_idx_map.get(bunk_cm_id)
        if bunk_idx is None:
            logger.warning(f"locked_bunks: bunk {bunk_cm_id} not in solver bunks; skipping")
            continue
        occupant_idxs = {ctx.person_idx_map[c] for c in occupant_cm_ids if c in ctx.person_idx_map}
        for person_idx in range(len(ctx.person_ids)):
            must_be = 1 if person_idx in occupant_idxs else 0
            ctx.model.Add(ctx.assignments[(person_idx, bunk_idx)] == must_be)


def cross_boundary_request_ids(inp: DirectSolverInput) -> list[str]:
    """IDs of positive (``bunk_with``) requests unmeetable this pass because the target
    sits in a locked cabin (frozen; won't move to the requester). Movable requester only.

    Pure pre-pass over the input; feeds the partial-resolve completion summary (#1609).
    """
    locked_person_cms = {c for occupants in inp.locked_bunks.values() for c in occupants}
    if not locked_person_cms:
        return []
    return [
        r.id
        for r in inp.requests
        if (
            r.request_type == "bunk_with"
            and r.requested_person_cm_id in locked_person_cms
            and r.requester_person_cm_id not in locked_person_cms
        )
    ]


def partial_resolve_summary(inp: DirectSolverInput, assignments: list[DirectBunkAssignment]) -> dict[str, Any]:
    """Completion-summary for a partial cabin re-solve (#1609).

    ``unassigned_count`` / ``unassigned_person_cm_ids`` — campers the solver could not
    place (no room in the unlocked cabins) under the relaxed ``<= 1`` cardinality.
    The id list lets the apply step DELETE their stale assignments: a camper the
    solver bumped out of an unlocked cabin is absent from ``assignments``, so without
    an explicit un-bunk their old row would persist (board would disagree with the
    toast, and the vacated seat's cabin could end up over capacity).
    ``cross_boundary_request_count`` — positive requests unmeetable because the target
    sits in a locked cabin. Counts surface in the post-run completion toast.

    Call only on a FEASIBLE solution's assignments (solve() returns None on infeasible,
    so the result is exact).
    """
    assigned = {a.person_cm_id for a in assignments}
    unassigned_cm_ids = [p.campminder_person_id for p in inp.persons if p.campminder_person_id not in assigned]
    return {
        "unassigned_count": len(unassigned_cm_ids),
        "unassigned_person_cm_ids": unassigned_cm_ids,
        "cross_boundary_request_count": len(cross_boundary_request_ids(inp)),
    }
