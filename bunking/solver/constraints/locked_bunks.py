"""Locked-bunk constraints (#1609) — freeze a cabin's exact roster in place.

Partial cabin re-solve: the bunks named in ``ctx.input.locked_bunks`` keep their
current occupants pinned and admit no one else, so the solver only redistributes
the unlocked campers across the unlocked cabins.
"""

from bunking.logging_config import get_logger

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
