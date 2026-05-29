# bunking/solver/

OR-Tools CP-SAT model built from composable constraint builders. Entry: `direct_solver.py` → `DirectBunkingSolver`.

## Read first

Before adding or modifying constraints:

- `docs/architecture/solver-internals.md` — hard MSO, impossibility framework, sat-var encoding, IIS, mutual boost, observability, V1/V2 split
- `docs/guides/solver-configuration.md` — config keys, weights, thresholds
- `docs/api/solver-api.md` — I/O contract via `models_v2.DirectSolver*` dataclasses

## Architecture

| File | Purpose |
|------|---------|
| `direct_solver.py` | `DirectBunkingSolver` — top-level orchestrator |
| `constraints/base.py` | `ConstraintBuilder` / `ObjectiveBuilder` protocols + `SolverContext` |
| `constraints/<concern>.py` | One module per concern (gender, age_spread, grade_adjacency, bunk_requests, parent_paramount, group_locks, level_progression, …) |
| `feasibility.py`, `impossibility.py` | Diagnose infeasible models |

## ConstraintBuilder pattern

Each constraint module follows the `ConstraintBuilder` or `ObjectiveBuilder` protocol from `constraints/base.py`. `SolverContext` (defined there) threads shared state through builders — never reach around it.

## RequestBucket / Tier organization

Requests are organized by three axes:

- **Tier** — priority class (Tier 1 parent-paramount, Tier 2 high-priority, Tier 3 preferences)
- **Stage** — when in the solve cycle the constraint applies
- **RequestBucket** — request-type grouping (see `bunking/satisfaction/`)

**Satisfaction logic lives in `bunking/satisfaction/`, NOT in the constraint modules.** Constraints add CP-SAT variables; satisfaction reads them to score. Don't blur this boundary.

## Soft constraints

Soft violations and bonuses accumulate in `SolverContext.soft_constraint_violations` and `.soft_constraint_bonuses`. The objective sums these for the final score. `_log_objective_breakdown` in `direct_solver.py` shows how categories aggregate at solve time.

## Infeasibility

`find_infeasibility_cause()` and the `impossibility_report` field surface infeasibility analysis. `_validate_requests` runs early to drop physically impossible requests *before* solver setup — cheaper to filter than to solve and fail.

## Don't conflate

- **Satisfied ≠ possible.** A request can be possible (campers exist + eligible) but unsatisfied (solver didn't place them together). The metric distinction is enforced.
- **Cross-session bunk requests auto-DECLINE.** They're physically impossible, not low-confidence. Don't raise thresholds to "fix" them.
- **SAME_AGE preferences stay PENDING.** May be a dog-whistle for avoiding AG cabins — staff review required.


## Constraint classification (Stream D — four-tier model)

When adding a new constraint module or changing a constraint's hardness, classify
hard constraints (those that issue `model.Add()`) in
`bunking/solver/constraint_classification.py`. The module docstring is the
authoritative reference; the four tiers are:

- **INVIOLABLE_ALWAYS** (`gender`, `session_boundary`) — never relaxed by the
  solver, never probed by the diagnostic. Hard physical/logical impossibilities.
- **STRUCTURAL_HARD** (`grade_spread`, `grade_adjacency`, `age_spread`,
  `group_locks`) — inviolable for solver action but staff-actionable. The failure
  diagnostic probes these (break-glass cannot relax them). Membership
  auto-propagates: `feasibility.py` derives `_DIAGNOSTIC_PROBE_CONSTRAINTS` from
  `diagnostic_probe_constraints()`, which returns `STRUCTURAL_HARD` — no separate
  probe set to edit.
- **REQUEST_RELAXABLE** (`parent_paramount`, `staff_separation`) — request-driven
  hard constraints. Break-glass softens these (yielding `break_glass_used=True`)
  before the diagnostic runs, so they do NOT appear in the diagnostic probe list.
- **CAPACITY_RELAXABLE** (`cabin_capacity`) — relaxed at solve time (12 → 13),
  gated by the capacity probe in `DirectBunkingSolver.solve`.

Notes:
- Soft constraints (`soft_constraint_violations`): do NOT add to any tier. They
  never cause INFEASIBLE — listing them in the diagnostic probe wastes a solve.
- A new CAPACITY_RELAXABLE class needs a corresponding orchestrator probe in
  `DirectBunkingSolver.solve` plus a relaxation-objective module in `constraints/`
  paralleling `overflow_minimization.py`.
- A new REQUEST_RELAXABLE class needs break-glass handling; do NOT also list it in
  STRUCTURAL_HARD or it will wrongly surface in the diagnostic.
- Back-compat aliases (`INVIOLABLE_CONSTRAINTS`, `SOLVER_RELAXABLE_CONSTRAINTS`,
  `INFO_ONLY_CONSTRAINTS`) still resolve for older imports but are slated for
  removal — prefer the four-tier names.

The invariant test in `tests/unit/bunking/solver/test_constraint_classification.py`
fails loudly if these are out of sync.
