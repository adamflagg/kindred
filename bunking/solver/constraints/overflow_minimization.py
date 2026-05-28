"""
Overflow Minimization Objective — Stream C.

Pass 2 of the smart orchestrator calls this builder to add a per-bunk
``is_overflowed`` Boolean and a lex-dominant penalty term to the objective.

The penalty weight W is hardcoded at 10**9 — strictly greater than any
realistic upper bound on the rest of the objective (rough bound:
num_persons × num_bunks × max_term_weight ~ 200 × 30 × 1000 = 6M, and
10**9 >> 6M). This makes::

  Maximize(satisfaction - W * total_overflowed)

equivalent to lex-minimizing ``total_overflowed`` first, then maximizing
``satisfaction`` among ties. No tunable knob; correctness by construction.
"""

from typing import Any

from bunking.logging_config import get_logger
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY

from .base import SolverContext

logger = get_logger(__name__)

# 10**9 dominates any realistic satisfaction-objective sum.
# Roster size * bunks * max weight ~ 200 * 30 * 1000 = 6e6. 1e9 >> 6e6.
LEX_DOMINANT_OVERFLOW_WEIGHT: int = 10**9


def add_overflow_minimization_objective(ctx: SolverContext, objective_terms: list[Any]) -> None:
    """Append a lex-dominant per-bunk overflow penalty to ``objective_terms``.

    For each bunk, creates ``is_overflowed[b]`` that is true iff the bunk's
    occupancy exceeds ``DEFAULT_BUNK_CAPACITY``. Appends
    ``-LEX_DOMINANT_OVERFLOW_WEIGHT * sum(is_overflowed)`` to objective_terms.

    Args:
        ctx: Solver context with model, assignments, and bunks.
        objective_terms: Mutable list of CP-SAT linear-expression terms.
    """
    num_persons = len(ctx.person_ids)
    overflowed_vars = []
    for bunk_idx, _bunk in enumerate(ctx.bunks):
        total = sum(ctx.assignments[(person_idx, bunk_idx)] for person_idx in range(num_persons))
        is_overflowed = ctx.model.NewBoolVar(f"is_overflowed_b{bunk_idx}")
        # is_overflowed == 1 iff total >= DEFAULT_BUNK_CAPACITY + 1 (i.e., 13).
        ctx.model.Add(total >= DEFAULT_BUNK_CAPACITY + 1).OnlyEnforceIf(is_overflowed)
        ctx.model.Add(total <= DEFAULT_BUNK_CAPACITY).OnlyEnforceIf(is_overflowed.Not())
        overflowed_vars.append(is_overflowed)

    objective_terms.append(-LEX_DOMINANT_OVERFLOW_WEIGHT * sum(overflowed_vars))
    logger.info(f"Added overflow minimization: W={LEX_DOMINANT_OVERFLOW_WEIGHT}, num_bunks={len(ctx.bunks)}")
