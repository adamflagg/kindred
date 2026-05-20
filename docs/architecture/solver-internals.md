# Solver Internals

Architectural reference for `bunking/solver/`. Operational guidance when
editing solver files lives in `bunking/solver/CLAUDE.md`; the configuration
surface is documented in `docs/guides/solver-configuration.md`; the I/O
contract is in `docs/api/solver-api.md`.

The solver is a Google OR-Tools CP-SAT model. Inputs (persons, bunks,
requests, historical assignments, config) come in as `DirectSolver*`
dataclasses from `bunking/models_v2.py`; outputs are `DirectSolverOutput`
records consumed by `api/services/solver_runner.py` and the satisfaction
analysis in `bunking/satisfaction/`. The orchestrator is
`DirectBunkingSolver` in `bunking/solver/direct_solver.py`.

## Contents

1. [Hard parent-paramount (MSO) constraint](#hard-parent-paramount-mso-constraint)
2. [Impossibility classification framework](#impossibility-classification-framework)
3. [Request satisfaction encoding](#request-satisfaction-encoding)
4. [Infeasibility localization (IIS)](#infeasibility-localization-iis)
5. [Mutual-request boost](#mutual-request-boost)
6. [Observability and diagnostic metrics](#observability-and-diagnostic-metrics)
7. [Variable-count surface](#variable-count-surface)
8. [V1 / V2 model split](#v1--v2-model-split)
9. [Code reference map](#code-reference-map)

---

## Hard parent-paramount (MSO) constraint

Camp policy: every camper with at least one possible Material-Parent (MP)
request must have one honored. This is enforced as a **hard** constraint in
CP-SAT, not a soft penalty.

### Why hard, not high-weighted soft

A soft penalty fires once globally per camper when their entire MP-request
set fails. Each local solver move only sees the immediate trade — moving a
popular kid out of a cluster trips multiple grade-spread / grade-ratio /
age-grade-flow penalties (~15K–25K of *local* cost). A 287K *global* threat
doesn't propagate strongly into local moves, so a stable cohort of
single-MP-request kids never gets their request honored regardless of
penalty magnitude.

A hard constraint is a structural property of CP-SAT's feasible region. The
LP relaxation prunes friend-X-elsewhere branches at every node. There is no
local trade-off to lose.

### Safety gate: impossibility runs first

A hard constraint over impossible requests produces INFEASIBLE. The
impossibility classifier (`bunking/solver/impossibility.py`) runs before the
hard constraint is added; the constraint is only enforced for campers with
**≥1 possible MP request**:

```python
for person_cm_id, possible_reqs in possible_requests.items():
    mp_possible = [r for r in possible_reqs if is_material_parent(r)]
    if mp_possible:
        model.Add(sum(satisfaction_vars[r.id] for r in mp_possible) >= 1)
```

Campers whose entire MP set is structurally impossible are surfaced via
`mp_campers_entirely_impossible` for staff review and skipped — the
constraint is not added for them.

### Pair-feasibility scope

`_pair_has_shared_bunk` in `direct_solver.py` checks **gender + session**.
That's the minimal viable feasibility check; group locks, AG-eligibility
quirks, and pre-fixed assignment conflicts are NOT yet checked. If a future
failure mode emerges from one of those, extend `_pair_has_shared_bunk`
rather than adding a parallel reason.

### Out of scope

- Promoting other soft constraints (`grade_spread`, `cabin_min_occupancy`)
  to hard. Those are tunable trade-offs by design. `age_spread` is the
  exception — its 24-month cap is a hard ceiling with an edge-bunk escape
  hatch via `must_satisfy_one`.
- Multi-MP minimum (≥2 MP honored per camper). Camp policy is ≥1.

### Code references

| Concern | File |
|---|---|
| Hard constraint emission | `bunking/solver/constraints/parent_paramount.py` |
| Safety gate (impossibility filter) | `bunking/solver/direct_solver.py:_validate_requests` |
| Pair feasibility | `bunking/solver/direct_solver.py:_pair_has_shared_bunk` |
| Post-solve diagnostic (ERROR severity under hard MSO) | `bunking/solver/direct_solver.py:_check_must_satisfy_one_violations` |
| Source-field bucket classifier | `bunking/satisfaction/bucket.py:is_material_parent_request` |

---

## Impossibility classification framework

A single `bunking/solver/impossibility.py` module owns classification. Each
hard constraint module registers a `HardConstraintImpossibility` predicate
exposing up to three optional layers:

| Layer | Signature | Catches |
|---|---|---|
| **request** | `check_request(req, ctx)` | Malformed payload, missing target |
| **pair** | `check_pair(req, ctx)` | Gender mismatch, session boundary, grade gap |
| **cluster** | `check_cluster(component_cms, ctx)` | Over-spread chain, oversized connected component |

`validate_impossibility(input_data, config) → ImpossibilityReport` runs all
registered predicates and returns a structured report. Both
`pre_validate_solver` (the user-facing pre-check endpoint) and
`DirectBunkingSolver._validate_requests` (the solver's internal gate) call
this shared function — there is exactly one classification path, eliminating
the historical drift where the two surfaces disagreed.

### Drift defense

`tests/unit/solver/impossibility/test_registry.py` asserts every constraint
module marked `hard=True` has a matching predicate registered. Adding a new
hard constraint without one fails CI.

### Predicate inventory

| Predicate | Layer | Catches |
|---|---|---|
| `MalformedRequestImpossibility` | request | `bunk_with`/`not_bunk_with` with no `requested_person_cm_id` |
| `TargetNotInSolverImpossibility` | request | Requestee absent from `person_idx_map` |
| `AgePreferenceImpossibility` | request | `age_preference` at the same-gender grade bound in the wrong direction (oldest-prefers-older, youngest-prefers-younger). Per camp policy: at-bound preferences in the wrong direction are moot. Bounds derived from the actual same-gender camper pool in the session. |
| `SessionBoundaryImpossibility` | pair | `bunk_with` across sessions |
| `GenderImpossibility` | pair | `bunk_with` where the requester and target have no gender-compatible same-session bunk. `not_bunk_with` with no shared bunk is trivially satisfied and stays `possible`. |
| `GradeCompatibilityImpossibility` | pair + cluster | Reciprocal `bunk_with` across a grade gap larger than any single bunk can absorb |
| `BunkCapacityImpossibility` | cluster | Reciprocal `bunk_with` chains exceeding max bunk capacity |

### Derived rollups

`ImpossibilityReport.mp_campers_entirely_impossible` is computed in
`validate_impossibility` as the single source of truth for "camper will get
zero parent requests honored". `parent_paramount` and `_validate_requests`
consume it instead of re-deriving. The `mp_camper_rate` ("Acceptable")
metric uses it to gate the denominator — campers with no possible MP
request are excluded.

### Why not solver-output-based

Impossibility is a property of **inputs**, not outputs. A request the
solver didn't satisfy might still be possible (the solver chose another).
Don't recompute impossibility downstream from solver output; plumb the
existing `impossibility_report` through shared state (React Query, prop)
instead.

### Code references

| Concern | File |
|---|---|
| Shared module | `bunking/solver/impossibility.py` |
| Solver-internal gate | `bunking/solver/direct_solver.py:_validate_requests` |
| Pre-check endpoint | `api/routers/solver.py:pre_validate_solver` |
| Registry discipline test | `tests/unit/solver/impossibility/test_registry.py` |
| Frontend rendering | `frontend/src/components/PreValidationResultsModal.tsx`, `frontend/src/pages/summer/SolverDebugPage/SolverDebugImpossibilityModal.tsx` |

---

## Request satisfaction encoding

A single canonical bidirectional sat-var per `bunk_with` / `not_bunk_with`
request is built by `get_or_create_request_sat_var` in
`bunking/solver/constraints/bunk_requests.py`. The objective
(`add_objective`) and `parent_paramount` (hard constraint) consume the same
shared `request_satisfied_vars` map — no duplicate vars, no one-way
implications.

For `age_preference`, the per-(request, bunk) `person_in_clean_bunk` forcing
indicators exposed from `add_age_preference_satisfaction_vars` are reused;
no separate sat var is created.

### Golden alignment test

`tests/unit/solver/test_sat_var_predicate_alignment.py` asserts agreement
between the solve-time sat var and the post-solve `satisfaction/predicate.py`
classifier for every entry in `request_satisfied_vars`. Scoped to
`bunk_with`/`not_bunk_with` — `age_preference` is excluded because its
solve-time encoding doesn't map to a single boolean.

### Why this matters

The historical encoding used one-way `OnlyEnforceIf` implications: the
solver could set `sat_var = 1` freely without forcing actual co-placement.
A hard `sum(sat_vars) >= 1` over them would have been vacuously satisfiable.
The bidirectional encoding makes the constraint structurally honest.

---

## Infeasibility localization (IIS)

When the solver returns INFEASIBLE and `find_infeasibility_cause` blames
`parent_paramount`, `localize_hard_mso_infeasibility` runs a two-pass IIS
search to identify which campers' hard MP constraints can't be jointly
satisfied:

1. **Singleton isolation** — for each MP-hard-constrained camper, solve
   with that camper's hard constraint skipped. Any camper whose alone-
   removal restores feasibility is reported as singleton-critical.
2. **Deletion filter** — if no singleton works, start with all hard MP
   constraints skipped (feasible by construction) and re-enforce them one
   at a time. Each camper whose re-addition flips feasibility → infeasibility
   is part of the minimal correction set.

The result is recorded in `solver_runs.stats.parent_paramount_iis` and
logged at ERROR level.

**Cost.** Each probe typically returns INFEASIBLE in presolve (<0.1s); 95
candidates ≈ 10s. Bounded by `max_candidates=200` to keep pathological
sessions from runaway cost. Only fires when `find_infeasibility_cause`
specifically blames `parent_paramount`.

**Caveat.** The deletion filter finds *a* minimal MCS, not *the* minimum
MCS. If the IIS structure has multiple minimal sets, iteration order
determines which one is reported. Acceptable for staff-facing diagnostics;
not for formal model verification.

### Why pre-check, not post-failure, catches most cases

Stream 6's pre-check framework (above) catches the bulk of cases before the
solver runs at all. IIS localization is the fallback for the residual
subset where pre-check predicates miss something — usually a grade
compatibility issue in a reciprocal pair, or a cluster-shape problem the
per-pair predicates can't see.

### Code references

| Concern | File |
|---|---|
| Localization implementation | `bunking/solver/feasibility.py:localize_hard_mso_infeasibility` |
| Per-camper toggle | `bunking/solver/constraints/parent_paramount.py` (honors `ctx.mp_skip_cms`) |
| Context field | `bunking/solver/constraints/base.py:SolverContext.mp_skip_cms` |
| Invocation | `api/services/solver_runner.py` (after `find_infeasibility_cause` flags `parent_paramount`) |
| Tests | `tests/unit/solver/test_hard_mso_localization.py` |

---

## Mutual-request boost

When both families name each other in a `bunk_with` request, the pair is
**mutual**. Mutual pairs receive a multiplier on their objective weight,
configured via `objective.mutual_request_boost` (default 2.0 in the admin
config schema).

### Detection

```python
def is_mutual_bunk_with(request, all_requests_by_person):
    if request.request_type != "bunk_with":
        return False
    other_id = request.requested_person_cm_id
    other_requests = all_requests_by_person.get(other_id, [])
    return any(
        r.request_type == "bunk_with"
        and r.requested_person_cm_id == request.requester_id
        for r in other_requests
    )
```

Applied in `score_evaluator.py` when assembling the per-request weight; the
multiplier is symmetric so model symmetry is preserved.

### How it complements hard MSO

Hard MSO *forces* ≥1 MP per camper; the solver still chooses *which* MP.
The boost makes mutual pairs more attractive for that choice, so when MSO
binds, it preferentially honors mutual requests. The two stack: MSO
enforces coverage breadth; boost steers which request gets honored.

### Boost is a convergence accelerator, not a ceiling-raiser

Production-relevant budgets (30–60 s) see the largest gains; long budgets
converge to the same MP-request rate. Mechanism: the boost-shaped objective
tightens the LP root gap, so the solver enters its first solution near the
basin.

### Out of scope

- Detecting mutual `not_bunk_with` (symmetric by definition; not the same
  problem).
- Triple-mutual cycle detection (A→B→C→A). Pair-level is enough.

### Code references

| Concern | File |
|---|---|
| Weight assembly | `bunking/solver/score_evaluator.py` |
| Objective term | `bunking/solver/objective_evaluator.py` |
| Canonical satisfaction logic | `bunking/satisfaction/predicate.py` |
| Config key | `objective.mutual_request_boost` |

---

## Observability and diagnostic metrics

The solver records two layers of metrics on `solver_runs.stats` for the
SolverDebugPage drill-down. Tier 1 is per-bucket request-shape and model-
size accounting; Tier 2 is plateau-diagnostic signal for distinguishing
"converging slowly" from "stuck".

### Tier 1 — request and model shape

| Metric | Source | Why useful |
|---|---|---|
| `model_num_booleans` / `model_num_integer_variables` / `model_num_variables` | CP-SAT response proto | Raw model size |
| Reified linear constraint count | `model.Proto().constraints[i].enforcement_literal` non-empty | Direct measure of model complexity |
| Soft constraint count (by module) | `len(ctx.soft_constraint_violations)` grouped by key prefix | Per-bucket attribution of soft-constraint pressure (`must_satisfy_*`, `grade_ratio_*`, `level_regression_*`, `age_spread_b*`) |
| `soft_constraint_penalty_by_module` | `solver.Value(var) * weight` summed per bucket | Weighted penalty actually paid, not just count of fires-honored |
| Max linear coefficient (big-M proxy) | Scan `model.Proto().constraints[*].linear.coeffs` | Values >100K signal big-M modeling weakness |
| Request density histogram (per `RequestBucket`) | Precompute from `requests_by_person` | "How many MP requests per camper" distribution; single-MP-request kids are the cohort hardest to satisfy |
| Impossible-request breakdown (per reason) | `validate_impossibility` rollup | Per-reason counts: `target_not_in_solver`, `cross_session`, `malformed`, `gender`, `grade_compatibility`, `age_pref_no_eligible_grade`, `bunk_capacity` |

### Tier 2 — plateau diagnostics

| Metric | Source | Why useful |
|---|---|---|
| Best-bound trajectory | Per-solution callback recording `BestObjectiveBound()` over time | Slope reveals "converging" vs "stuck on plateau". Surfaced in the SolverDebugPage as `BoundTrajectoryChart`. |
| LP root gap | `solver.SolutionInfo()` / response proto | Gap *before* B&B started; LP relaxation quality independent of time budget |
| Presolve compression ratio | Post / pre boolean count via `observability.py` | How much of the model is redundant. High ratio (≈1.0) = model is already tight; low ratio (≪0.5) = presolve doing heavy lifting |

### Other available metrics (not yet captured)

If a specific question prioritizes them, these are easy adds against the
existing observability harness:

- Per-sub-solver wall time (response proto `subsolvers` field) — which LNS
  strategies found best solutions; helps tune `num_workers`
- Symmetry detection flag (response proto)
- Domain size distribution (scan IntVar domains)
- Restart count, conflict-learning stats, LP iterations
- Free variable count post-presolve
- Constraint-graph density (variables-per-constraint)

### Code references

| Concern | File |
|---|---|
| Capture site | `bunking/solver/direct_solver.py` (stats assembly) |
| Bound-trajectory callback | `bunking/solver/callbacks.py` |
| Observability helpers | `bunking/solver/observability.py` |
| API plumbing | `api/services/solver_runner.py` |
| Frontend dashboard | `frontend/src/pages/summer/SolverDebugPage/` |

---

## Variable-count surface

For a typical S2-sized session (≈200 persons × 17 bunks), the live model is
roughly 5,000 boolean variables and 12,000 constraints post-`#1427` sat-var
unification. Presolve eliminates ~6% of booleans — the model is already
tight; the historical 40%+ compression headroom is gone.

### Where the variables come from

| Source | Code |
|---|---|
| `person_in_bunk[p, b]` — one per (person, bunk) | `direct_solver.py:_create_assignment_variables` |
| `req_satisfied[r]` — one per possible request | `constraints/bunk_requests.py:get_or_create_request_sat_var`, `constraints/age_preference.py` |
| Constraint-internal indicators (`grade_ratio`, `age_spread`, `level_progression`, `grade_adjacency`) | Various modules |

### Remaining attack-surface levers

If a future need pushes for more compression:

- **Sparse `person_in_bunk` — gender filter at model-build time.** Skip
  cross-gender (person, bunk) pairs at variable creation rather than
  letting the gender constraint force them to zero. Estimated −1,640
  BoolVars on S2 (≈50% of the assignment matrix). Foundational; touches 11
  constraint modules that consume `ctx.assignments[(p, b)]` directly and
  would all need either a `.get(...)` guard or a range-filter update. New
  test fixtures needed for gender-mismatch paths (today's tests pass
  trivially against the dense-then-forced-zero encoding).
- **Pre-solve fixed-assignment pass** for 1-bunk-eligible campers (AG-only,
  grade-locked). Small per-camper savings; small PR.
- **`grade_ratio` `bool_and` chains → `AddAllowedAssignments` table
  constraints.** CP-SAT table constraints are tighter than `bool_and`.
  Modeling rewrite with no concrete evidence the chains are the bottleneck;
  the plateau is bound-movement, not branching cost.

None of these is filed today; revisit when a real performance complaint
identifies one specifically.

---

## V1 / V2 model split

Two model dataclass sets are alive against different surfaces.

| Surface | Live models source |
|---|---|
| `DirectBunkingSolver` (production solver) | **V2** (`bunking/models_v2.py`) — `DirectBunkRequest`, `DirectPerson`, `DirectBunk`, `DirectBunkAssignment`, `DirectSolverInput`, `DirectSolverOutput`, `HistoricalBunkingRecord` |
| `POST /api/validate-bunking` | **V1** (`bunking/models.py`) via `bunking_validator.BunkingValidator` |
| `POST /api/scenarios` + 6 sibling routes | **V1** (same model set) |
| `RequestType` enum (shared symbol) | V1 — re-used by sync tests, solver constraint tests, frontend test mocks |
| `HistoricalBunkingRecord` | Defined three ways — V1 dataclass at `bunking_validator.py:53`, V2 pydantic at `models_v2.py:98`, plus V1 module surface |

### Why parked, not migrated

The migration path is plausible (validator-only types stay near the
validator; scenario routes likely re-export V2 shapes through their own API
schemas), but it's a multi-PR refactor touching three live surfaces —
solver, validator endpoint, scenarios endpoints — and **there is no
integration-level "solver pass"** (full validator + scenarios + solve
round-trip against a snapshotted input) that would catch silent regressions
from a model swap. Pydantic field-constraint drift is exactly the failure
mode that slips through unit tests.

### Pick-up criteria

Revisit when any of these become true:

- An integration test exists that round-trips `/validate-bunking` and
  `/scenarios/*` against the live solver and would catch a behavior-
  equivalent model swap.
- A non-cosmetic drift between V1 and V2 (a new constraint, a new field
  with diverging validators) causes a real bug. The drift becomes the
  forcing function.

### Narrow tactical pattern when drift surfaces

When a specific drift between V1 and V2 surfaces (the post-check
denominator parity gap is the historical case), the cheap fix is a kwarg
threading through V1 from a V2 computation, **not** a model migration.
Concretely:

- Validator gains an `impossible_request_ids: set[str] | None` kwarg.
- The route (`api/routers/validation.py`) computes the set via the same
  `fetch_session_data_v2` → `prepare_direct_solver_input` →
  `validate_impossibility` path the pre-check endpoint uses, and threads
  IDs to the validator.
- Validator stays V1-pure; the structural divergence remains parked.

This is acceptable when the drift is narrow and bounded. If a second drift
hits the same surface, that's the forcing function to revisit the parked
consolidation.

**Known overhead.** Threading impossibility IDs through `validation.py`
adds a parallel V2 fetch alongside the existing V1 fetches — same PB
collections pulled twice with different shapes, roughly 5 extra
`get_full_list` round-trips per `/api/validate-bunking` call. The frontend
can pass precomputed IDs from the cached `/solver/pre-validate` response if
the latency bites.

---

## Code reference map

| Concern | File |
|---|---|
| Top-level orchestrator | `bunking/solver/direct_solver.py:DirectBunkingSolver` |
| Constraint protocol + context | `bunking/solver/constraints/base.py` |
| Hard MP constraint | `bunking/solver/constraints/parent_paramount.py` |
| Canonical sat var | `bunking/solver/constraints/bunk_requests.py:get_or_create_request_sat_var` |
| Objective assembly | `bunking/solver/direct_solver.py:add_objective`, `bunking/solver/objective_evaluator.py` |
| Score / weight assembly | `bunking/solver/score_evaluator.py` |
| Impossibility classification | `bunking/solver/impossibility.py` |
| Infeasibility analyzer | `bunking/solver/feasibility.py:find_infeasibility_cause` |
| IIS localization | `bunking/solver/feasibility.py:localize_hard_mso_infeasibility` |
| Observability capture | `bunking/solver/observability.py`, `bunking/solver/callbacks.py` |
| Satisfaction policy (post-solve) | `bunking/satisfaction/{bucket,aggregate,predicate}.py` |
| Task orchestration | `api/services/solver_runner.py` |
| I/O dataclasses | `bunking/models_v2.py` |
| V1 validator | `bunking/bunking_validator.py` |
| Pre-check endpoint | `api/routers/solver.py:pre_validate_solver` |
| Validate endpoint | `api/routers/validation.py` |
| Objective sensitivity reference | `docs/reference/objective-sensitivity.md` |
