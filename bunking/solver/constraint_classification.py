"""
Constraint classification — Stream D (four-tier model).

Four tiers determine how each constraint participates in the solver's
break-glass relaxation flow and the failure diagnostic:

* INVIOLABLE_ALWAYS — nonsensical to relax under any circumstance. The
  solver never relaxes these and the diagnostic never probes them. These
  represent hard physical or logical impossibilities (e.g., a male camper
  in a female-only bunk or a camper in a bunk from a different session).

* STRUCTURAL_HARD — inviolable for solver action, but actionable by staff.
  The diagnostic probes these post-break-glass, because break-glass cannot
  relax them. When one of these is the root cause of infeasibility, staff
  must fix it manually via the bunking board (e.g., "Locked group G spans
  36 months — split or accept manual override"). The solver does not
  auto-tune these knobs even though some are config-driven
  (MAX_AGE_SPREAD_MONTHS, etc.).

* REQUEST_RELAXABLE — request-driven hard constraints. Break-glass may
  soften these (yielding ``break_glass_used=True``) when the alternative is
  a completely unplaced camper. Because break-glass relaxes them BEFORE the
  diagnostic runs, these constraints leave the diagnostic probe list — a
  request conflict in the break-glass scenario becomes a placement decision,
  not a diagnostic finding.

* CAPACITY_RELAXABLE — the solver can relax the cabin-capacity cap at solve
  time (12 → 13), gated by an explicit probe. When the capacity probe
  confirms relaxation would fix infeasibility, the solver auto-runs pass 2
  with a lex penalty to minimize overflowed bunks.

============================================================================
MAINTENANCE — UPDATE THIS FILE WHEN:
============================================================================
STRUCTURAL_HARD membership propagates automatically: ``feasibility.py``
derives its probe list from ``diagnostic_probe_constraints()``, which now
returns ``STRUCTURAL_HARD`` (not the full INFO_ONLY_CONSTRAINTS of the old
3-tier model). There is no separate set to edit — just classify here.

1. **Adding a new constraint module** (anything in bunking/solver/constraints/
   that issues hard ``model.Add()`` calls): classify it in one of the four
   tiers. If it belongs to STRUCTURAL_HARD, the diagnostic probes it
   automatically — no manual edit needed. If it belongs to REQUEST_RELAXABLE,
   break-glass handles it; the diagnostic does NOT probe it.

2. **Promoting a soft constraint to hard** (replacing ``soft_constraint_violations``
   with ``model.Add()``): add to STRUCTURAL_HARD here (or the appropriate tier
   if it is capacity- or request-driven). The probe list follows
   ``diagnostic_probe_constraints()`` automatically.

3. **Demoting a hard constraint to soft**: remove from its tier here (a
   soft-only constraint is a no-op probe — wastes a solve in the failure
   path). The probe list drops it automatically.

4. **Adding a new CAPACITY_RELAXABLE class**: add to ``CAPACITY_RELAXABLE``
   here, then add an orchestrator probe in ``DirectBunkingSolver.solve`` and a
   relaxation-objective module in ``constraints/`` paralleling
   ``overflow_minimization.py``.

5. **Adding a new REQUEST_RELAXABLE class**: add to ``REQUEST_RELAXABLE`` here
   and ensure break-glass handles it. Do NOT add it to STRUCTURAL_HARD — it
   must NOT appear in the diagnostic probe list.

The invariant test in ``tests/unit/bunking/solver/test_constraint_classification.py``
enforces:
  * The four sets are pairwise disjoint.
  * ``diagnostic_probe_constraints()`` == ``STRUCTURAL_HARD``.
  * ``_DIAGNOSTIC_PROBE_CONSTRAINTS`` in feasibility.py == ``STRUCTURAL_HARD``.
  * ``break_glass_relaxable_constraints()`` == REQUEST_RELAXABLE | CAPACITY_RELAXABLE.
  * ``CAPACITY_RELAXABLE`` is exactly ``{"cabin_capacity"}``.
  * Back-compat aliases still resolve to the expected values.

If you add a constraint and don't update this file, that test fails — by design.
"""

INVIOLABLE_ALWAYS: frozenset[str] = frozenset({"gender", "session_boundary"})

STRUCTURAL_HARD: frozenset[str] = frozenset({"grade_spread", "grade_adjacency", "age_spread", "group_locks"})

REQUEST_RELAXABLE: frozenset[str] = frozenset({"parent_paramount", "staff_separation"})

CAPACITY_RELAXABLE: frozenset[str] = frozenset({"cabin_capacity"})

# The authoritative set of EVERY hard constraint the solver can issue.
# The golden-rule test asserts this equals the union of all tiers, and that
# each name maps to a real constraint module with a debug-disable hook.
ALL_HARD_CONSTRAINTS: frozenset[str] = INVIOLABLE_ALWAYS | STRUCTURAL_HARD | REQUEST_RELAXABLE | CAPACITY_RELAXABLE


def break_glass_relaxable_constraints() -> frozenset[str]:
    """Constraints break-glass may soften: requests + capacity. Everything else
    is the inviolable wall (INVIOLABLE_ALWAYS ∪ STRUCTURAL_HARD)."""
    return REQUEST_RELAXABLE | CAPACITY_RELAXABLE


def diagnostic_probe_constraints() -> frozenset[str]:
    """Post-break-glass, the only remaining hard non-inviolable constraints are
    structural — so that's all the failure diagnostic needs to probe.
    (parent_paramount/staff_separation leave the probe list: break-glass relaxes
    them before the diagnostic ever runs.)"""
    return STRUCTURAL_HARD


# Back-compat aliases (consumers still importing the 3-tier names). Remove once
# all consumers migrate to the four-tier names.
INVIOLABLE_CONSTRAINTS = INVIOLABLE_ALWAYS
SOLVER_RELAXABLE_CONSTRAINTS = CAPACITY_RELAXABLE
INFO_ONLY_CONSTRAINTS = STRUCTURAL_HARD | REQUEST_RELAXABLE
