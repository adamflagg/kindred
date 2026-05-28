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
1. **Adding a new constraint module** (anything in bunking/solver/constraints/
   that issues hard ``model.Add()`` calls): classify it here AND add it to the
   ``_DIAGNOSTIC_PROBE_CONSTRAINTS`` set in
   ``feasibility.py::find_infeasibility_cause`` if it belongs to INFO_ONLY.

2. **Promoting a soft constraint to hard** (replacing ``soft_constraint_violations``
   with ``model.Add()``): add to INFO_ONLY here (or INVIOLABLE/SOLVER_RELAXABLE
   if appropriate). Also add to ``_DIAGNOSTIC_PROBE_CONSTRAINTS``.

3. **Demoting a hard constraint to soft**: remove from INFO_ONLY here AND from
   ``_DIAGNOSTIC_PROBE_CONSTRAINTS`` (a soft-only constraint is a no-op probe —
   wastes a solve in the failure path).

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
        # Rarely fire as the diagnostic cause — both have yield mechanisms that
        # resolve the most common conflict pattern (NBW <-> MSO). Kept here for
        # the residual cases where MSO conflicts with non-NBW hard rules, or NBW
        # conflicts with non-MSO hard rules.
        "parent_paramount",
        "staff_separation",
        # NOTE: level_progression is intentionally NOT in this set. It's a SOFT
        # constraint (contributes soft_constraint_violations, never model.Add()),
        # so disabling it cannot make an INFEASIBLE problem feasible. Including
        # it would be a no-op probe that wastes a solve in the failure path.
    }
)
