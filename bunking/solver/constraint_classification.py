"""
Constraint classification — Stream C.

Three tiers determine how each constraint participates in the solver's
infeasibility flow:

* INVIOLABLE — nonsensical to relax. The solver never relaxes these and the
  diagnostic never probes them. Suggesting staff "fix" them via the diagnostic
  would misdirect (e.g., "the gender constraint is causing infeasibility" is
  an unactionable answer to a capacity-driven infeasibility).

* SOLVER_RELAXABLE — the solver can relax these at solve time, gated by an
  explicit probe. Currently only ``cabin_capacity`` (12 -> 13). When the
  capacity probe confirms relaxation would fix infeasibility, the solver
  auto-runs pass 2 with a lex penalty to minimize overflowed bunks.

* INFO_ONLY — inviolable for solver action, but the diagnostic reports them
  to staff with an actionable message ("Locked group G spans 36 months —
  split or accept manual override"). Staff fix manually via the bunking
  board, drag-drop, or CampMinder. The solver does not auto-tune these
  knobs even though some are config-driven (MAX_AGE_SPREAD_MONTHS, etc.).

============================================================================
MAINTENANCE — UPDATE THIS FILE WHEN:
============================================================================
INFO_ONLY membership propagates automatically: ``feasibility.py`` derives its
probe list from ``diagnostic_probe_constraints()``, so there is no separate set
to edit there — just classify the constraint here.

1. **Adding a new constraint module** (anything in bunking/solver/constraints/
   that issues hard ``model.Add()`` calls): classify it here. If it belongs to
   INFO_ONLY, the diagnostic probes it automatically — no manual edit needed.

2. **Promoting a soft constraint to hard** (replacing ``soft_constraint_violations``
   with ``model.Add()``): add to INFO_ONLY here (or INVIOLABLE/SOLVER_RELAXABLE
   if appropriate). The probe list follows INFO_ONLY automatically.

3. **Demoting a hard constraint to soft**: remove from INFO_ONLY here (a
   soft-only constraint is a no-op probe — wastes a solve in the failure path).
   The probe list drops it automatically.

4. **Adding a new SOLVER_RELAXABLE class**: add to ``SOLVER_RELAXABLE_CONSTRAINTS``
   here, then add an orchestrator probe in ``DirectBunkingSolver.solve`` and a
   relaxation-objective module in ``constraints/`` paralleling
   ``overflow_minimization.py``.

The invariant test in ``tests/unit/bunking/solver/test_constraint_classification.py``
enforces:
  * The three sets are disjoint.
  * ``_DIAGNOSTIC_PROBE_CONSTRAINTS`` equals ``INFO_ONLY_CONSTRAINTS``.
  * ``SOLVER_RELAXABLE_CONSTRAINTS`` is exactly ``{"cabin_capacity"}``.

If you add a constraint and don't update this file, that test fails — by design.
"""

INVIOLABLE_CONSTRAINTS: frozenset[str] = frozenset(
    {
        "gender",
        "session_boundary",
    }
)

SOLVER_RELAXABLE_CONSTRAINTS: frozenset[str] = frozenset(
    {
        "cabin_capacity",
    }
)

INFO_ONLY_CONSTRAINTS: frozenset[str] = frozenset(
    {
        # Workhorses — no yield mechanism, commonly fire as the cause of INFEASIBLE.
        # Have actionable explainer helpers in feasibility.py.
        "grade_spread",
        "age_spread",
        "group_locks",
        # Hard structural constraint: forbids non-consecutive grades in a bunk
        # (e.g., grades 2 and 4 without 3). Actionable explainer in feasibility.py.
        # Added Stream D — was missing from classification in Stream C.
        "grade_adjacency",
        # Rarely fire as the diagnostic cause — both have yield mechanisms that
        # resolve the most common conflict pattern (NBW <-> MSO). Kept here for
        # the residual cases where MSO conflicts with non-NBW hard rules, or NBW
        # conflicts with non-MSO hard rules.
        "parent_paramount",
        "staff_separation",
        # NOTE: level_progression and grade_ratio are intentionally NOT in this
        # set. Both are SOFT constraints (penalty-based, conditional model.Add()
        # only), so disabling them cannot make an INFEASIBLE problem feasible.
        # Including them would be no-op probes that waste a solve in the failure
        # path.
    }
)

# The authoritative set of EVERY hard constraint the solver can issue.
# The golden-rule test asserts this equals the union of all tiers, and that
# each name maps to a real constraint module with a debug-disable hook.
ALL_HARD_CONSTRAINTS: frozenset[str] = INVIOLABLE_CONSTRAINTS | SOLVER_RELAXABLE_CONSTRAINTS | INFO_ONLY_CONSTRAINTS


def diagnostic_probe_constraints() -> frozenset[str]:
    """Returns the constraints the failure diagnostic probes.

    Currently equals INFO_ONLY_CONSTRAINTS; will narrow to the structural subset
    once break-glass tiering relaxes the request constraints.
    """
    return INFO_ONLY_CONSTRAINTS
