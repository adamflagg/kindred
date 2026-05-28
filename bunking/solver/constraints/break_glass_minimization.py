"""Break-glass lexicographic penalty (Stream D).

The break-glass pass relaxes the request layer (parent-paramount must-satisfy-one
and staff not-bunk-with) from hard to penalized-soft so that *every* camper is
still placed even when the honest request set is infeasible. This module appends
the penalty terms that make the relaxed solve choose the *least-bad* arrangement.

Lexicographic objective, highest priority first:

* **L1** — minimize the number of campers who lose their must-satisfy-one (MSO).
  ``sum(ctx.break_glass_mso_unmet_vars.values())``.
* **L2** — minimize the number of *distinct impacted campers* (any unmet request
  OR a lost MSO).
* **L3** — minimize the *total* number of unmet requests
  (``sum(1 - sat_var)`` over every sat-var-bearing request).
* **L4** — minimize overflow. Added SEPARATELY by ``overflow_minimization`` as the
  ``LEX_DOMINANT_OVERFLOW_WEIGHT`` (``10**9``) term — NOT by this module.
* **L5** — the pre-existing satisfaction objective, already in ``objective_terms``
  before this builder runs.

**Single-solve lexicographic collapse.** The solver MAXIMIZES ``sum(objective_terms)``;
penalties are appended as NEGATIVE terms. To make one weighted-sum solve behave
like a strict lexicographic minimization, each level's weight must strictly exceed
the maximum possible magnitude of all lower levels *combined*:

    W_L4 = 10**9                            # == LEX_DOMINANT_OVERFLOW_WEIGHT
    W_L3 = W_L4 * (n_bunks + 1)             # > max overflow  (W_L4 * n_bunks)
    W_L2 = W_L3 * (R_sat + 1)              # > max total-unmet (W_L3 * R_sat)
    W_L1 = W_L2 * (n_persons + 1)          # > max impacted   (W_L2 * n_persons)

**Why ``R_sat`` and not ``n_persons`` for W_L2.** The maximum L3 contribution is
``W_L3 * (number of unmet requests)``, and a single camper may carry several
requests, so the unmet-request count is bounded by the number of sat-var-bearing
*requests* (``R_sat = len(ctx.request_satisfied_vars)``), which can exceed the
camper count. Using ``(n_persons + 1)`` (as an early draft did) would let a large
L3 sum out-weigh one L2 unit and silently break the lex order whenever
``R_sat > n_persons``. We therefore size W_L2 from ``R_sat``.

**int64 safety.** The total objective magnitude is dominated by the L1 term,
``W_L1 * (max MSO losses) ~= W_L1 * n_persons``. ``compute_break_glass_weights``
asserts this dominant term stays within CP-SAT's signed-int64 objective range.
For a realistic ~150 campers / ~12 bunks / ~600 sat-vars: W_L1 ~= 2.5e15 and the
dominant term ~= 5e17, comfortably under 2**62 ~= 4.6e18.

Age-preference requests have no entry in ``request_satisfied_vars`` (they use a
different forcing mechanism) and so cannot be "unmet" in the L2/L3 sense — they
are correctly skipped here. A camper whose MSO *is* an age-preference still counts
as impacted via their ``break_glass_mso_unmet_vars`` entry, which is OR-ed into the
L2 impacted indicator.
"""

from typing import Any

from bunking.logging_config import get_logger
from bunking.solver.constraints.base import SolverContext
from bunking.solver.constraints.overflow_minimization import LEX_DOMINANT_OVERFLOW_WEIGHT

logger = get_logger(__name__)

# 10**9; the L4 (overflow) penalty term is added by overflow_minimization, not here.
W_L4_OVERFLOW: int = LEX_DOMINANT_OVERFLOW_WEIGHT


def compute_break_glass_weights(n_persons: int, n_bunks: int, sat_var_count: int) -> tuple[int, int, int]:
    """Return ``(W_L1, W_L2, W_L3)`` for the break-glass lexicographic collapse.

    Each weight strictly dominates the maximum magnitude of every lower lex
    level: W_L3 > max overflow (L4), W_L2 > max total-unmet (L3), W_L1 > max
    impacted (L2).

    ``W_L2`` uses ``(sat_var_count + 1)`` — the maximum total-unmet count (L3) is
    bounded by the number of sat-var-bearing *requests*, NOT by the camper count,
    and a camper may carry several requests. Sizing W_L2 from the person count
    would under-weight it whenever ``sat_var_count > n_persons``.

    Asserts the dominant objective term (``W_L1 * max(n_persons, 1)``) fits inside
    CP-SAT's safe signed-int64 objective range.
    """
    w_l3 = W_L4_OVERFLOW * (n_bunks + 1)
    w_l2 = w_l3 * (sat_var_count + 1)
    w_l1 = w_l2 * (n_persons + 1)
    assert w_l1 * max(n_persons, 1) < 2**62, "break-glass objective exceeds safe int64 range"
    return w_l1, w_l2, w_l3


def add_break_glass_penalties(ctx: SolverContext, objective_terms: list[Any]) -> None:
    """Append the L1-L3 break-glass penalties (negated, for ``Maximize``).

    L4 (overflow) and L5 (satisfaction) are added by other code — overflow by
    ``overflow_minimization`` and satisfaction by the base objective builder
    before this runs.

    Args:
        ctx: Solver context with the model, person/bunk lists, per-person
            requests, and the break-glass slack vars
            (``break_glass_mso_unmet_vars``, ``request_satisfied_vars``).
        objective_terms: Mutable list of CP-SAT linear-expression terms.
    """
    n_persons = len(ctx.person_ids)
    n_bunks = len(ctx.bunks)
    w_l1, w_l2, w_l3 = compute_break_glass_weights(n_persons, n_bunks, len(ctx.request_satisfied_vars))

    # L1: campers losing their must-satisfy-one.
    mso_unmet_vars = list(ctx.break_glass_mso_unmet_vars.values())
    if mso_unmet_vars:
        objective_terms.append(-w_l1 * sum(mso_unmet_vars))

    # L2 (distinct impacted campers) + L3 (total unmet requests), derived from
    # the per-request satisfaction vars. An unmet request == (1 - sat_var). A
    # camper is "impacted" if ANY of their requests is unmet OR they lost their
    # MSO (the latter captures age-pref-only MSO losers, who have no sat var).
    unmet_terms = []
    impacted_vars = []
    for cm_id in ctx.person_ids:
        camper_unmet = []
        for idx, req in enumerate(ctx.requests_by_person.get(cm_id, [])):
            sat_var = ctx.request_satisfied_vars.get(req.id)
            if sat_var is None:
                continue  # e.g. age-preference requests have no sat var.
            unmet = ctx.model.NewBoolVar(f"bg_unmet_{cm_id}_{idx}")
            ctx.model.Add(unmet == 1 - sat_var)  # unmet true iff request unsatisfied
            camper_unmet.append(unmet)
            unmet_terms.append(unmet)

        mso_var = ctx.break_glass_mso_unmet_vars.get(cm_id)
        impacted_inputs = camper_unmet + ([mso_var] if mso_var is not None else [])
        if not impacted_inputs:
            continue
        impacted = ctx.model.NewBoolVar(f"bg_impacted_{cm_id}")
        ctx.model.AddMaxEquality(impacted, impacted_inputs)  # OR over the camper's losses
        impacted_vars.append(impacted)

    if impacted_vars:
        objective_terms.append(-w_l2 * sum(impacted_vars))
    if unmet_terms:
        objective_terms.append(-w_l3 * sum(unmet_terms))

    logger.info(
        f"break-glass penalties: W_L1={w_l1} W_L2={w_l2} W_L3={w_l3} "
        f"mso_slacks={len(mso_unmet_vars)} impacted={len(impacted_vars)} unmet_terms={len(unmet_terms)}"
    )
