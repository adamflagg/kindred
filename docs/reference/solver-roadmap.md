# Solver Optimization Roadmap — Q2 2026

Tracked reference doc capturing four parallel streams of solver work that
emerged from the May 2026 stuck-core investigation. Each stream gets a
dedicated GitHub issue; specs and plans live in `docs/superpowers/` (local
only) once individual streams are picked up.

> **Why this doc exists.** The May 12 investigation surfaced four
> distinct improvements at once (camp-policy fix, observability gap,
> variable-count attack surface, objective tuning). The investigation
> chat was lost to API errors before any of them was specced, and the
> follow-up agent rediscovered a false-positive "bug" because the
> rationale wasn't preserved anywhere durable. This doc is the
> persistent memory so future agents (and the human) don't have to
> reconstruct context from incomplete signals.

---

## Investigation context (one paragraph)

After PR #1364 shipped (`refactor(solver)`: dropped 3 dead `must_satisfy_one`
toggles and the orphan `add_age_preference_penalties` function), a sweep was
run with `must_satisfy_one.penalty` bumped from 100,000 → 287,600. The bump
improved MP coverage modestly (S2: `mp_camper_rate` 92.07% → 95.73% at 600s
budget; `unsatisfied_material_parent_unmet` 9 → 6) but a semi-stable
"stuck-core" cohort of 6–7 campers per session continues to get zero parent
requests honored across runs. Investigation traced this to a structural
mismatch: per-camper soft penalty competes with multi-kid cluster benefits
that the solver can win locally even with a large global penalty waiting.
All four streams below address the underlying model in different ways.

**Baseline metrics to remember** (S2 sweep, post-PR-#1364, 287,600 MSO
penalty, 600s budget):

- 193 persons, 17 bunks
- 11,657 model variables (5,561 booleans + 2,456 integers + ~3,640
  auxiliary)
- 23,644 model constraints (21,922 linear, 1,022 bool_and, 684 bool_or,
  16 lin_max)
- 51 `OnlyEnforceIf` usages across 10 constraint files
- 326 MP requests / 504 total requests
- 164 MP-having campers; `unsatisfied_no_possible = 0`
- 4 `impossible_requests` (all data-quality artifacts: synthetic
  cm_ids from unresolvable names + cross-session targets)
- Gap 4.76% at 600s, FEASIBLE (not OPTIMAL)

---

## Stream 1 — Stage 4: Hard Must-Satisfy-One Constraint

**Status:** Tabled pending #1158 (predicate consolidation, merged 2026-05).
Architecturally unblocked.

### Motivation

Camp policy: every camper with at least one Material-Parent (MP) request
must have one honored. Today this is modeled as a soft constraint with
penalty 287,600 (formerly 100,000). The penalty fires once globally per
camper when their entire MP-request set fails, but each local solver
move only sees the immediate trade — moving a popular kid out of a
cluster trips multiple grade-spread (3,000) / grade-ratio (5,000) /
age-grade-flow (300) penalties, totalling 15,000–25,000 of *local* cost.
The 287,600 *global* threat doesn't propagate strongly into local moves.

Result: a stable cohort of single-MP-request kids whose one friend is in
someone else's cluster never gets their request honored, regardless of
penalty magnitude (within reasonable ranges). Bumping further has
diminishing returns and risks distorting other objective signals.

### Why hard works where higher soft doesn't

A hard constraint (`sum(MP_satisfied[loner]) >= 1`) is a structural
property of CP-SAT's feasible region. The solver cannot produce *any*
solution that violates it; the LP relaxation prunes friend-X-elsewhere
branches at every node. There is no "trade-off" to lose locally.

### Surprising side-effect: model simplification

Current soft MSO (`bunking/solver/constraints/must_satisfy.py:126-135`)
per MP-having camper:

```python
violation = ctx.model.NewBoolVar(...)                                # +1 BoolVar
ctx.model.Add(sum(all_sat_vars) == 0).OnlyEnforceIf(violation)       # +1 reified linear
ctx.model.Add(sum(all_sat_vars) >= 1).OnlyEnforceIf(violation.Not()) # +1 reified linear
ctx.soft_constraint_violations[...] = (violation, penalty)            # +1 objective term
```

Hard MSO collapses to:

```python
ctx.model.Add(sum(all_sat_vars) >= 1)                                # +1 plain linear
```

S2 has 164 MP-having campers. Hard MSO directly removes:

- −164 BoolVars (5,561 → ~5,397)
- −164 linear constraints (21,922 → ~21,758)
- −164 objective terms (objective function shorter)
- And *reified → plain* constraint type upgrade — CP-SAT's propagation
  doesn't have to maintain boolean implication for these.

### Safety gate

`unsatisfied_no_possible` from `feasibility.py:196` counts campers whose
ENTIRE MP set is structurally impossible. Currently 0 for S2, meaning
every MP-having camper has at least one survivable MP request — the
hard constraint binds cleanly on all of them.

**Defensive pattern when adding the hard constraint:**

```python
for person_cm_id, possible_reqs in possible_requests.items():
    mp_possible = [r for r in possible_reqs if is_material_parent(r)]
    if mp_possible:  # only enforce when ≥1 possible MP exists
        model.Add(sum(satisfaction_vars[r.id] for r in mp_possible) >= 1)
```

If a future sweep returns `unsatisfied_no_possible > 0`, those campers
are skipped (the constraint isn't added for them) and a warning is
logged. The 4 current `impossible_requests` (synthetic IDs from
unresolvable names) are spread across kids who ALSO have viable MP
alternatives, so the constraint still applies to those kids.

### Code refs

- `bunking/solver/constraints/must_satisfy.py:126-135` — current soft modeling
- `bunking/solver/direct_solver.py:355-438` — `_validate_requests`, impossibility classification
- `bunking/solver/feasibility.py:193-205` — `unsatisfied_no_possible` computation
- `bunking/solver/constraints/base.py:51` — `ConstraintContext.impossible_requests`
- Camp policy source: `wife-feedback-2026-04-scoreboard.md` Stage 4 sketch (local doc)

### Risks (small, in decreasing order)

1. **MP-request-rate could drop slightly** while MP-camper-rate rises.
   Forcing 1 MP per loner may break a cluster that was efficiently
   satisfying multiple MPs for fewer campers. Camp accepts this trade
   per policy.
2. **Solve-time impact unclear** — hard MSO should *speed up* the solve
   in theory (smaller model, fewer reified constraints, simpler
   objective), but CP-SAT's heuristics may interact unpredictably.
   Benchmark required.
3. **`impossible_requests` could spike** if upstream resolution
   regresses. Pre-solve filter logs a warning if any camper would be
   skipped; that warning is the data-quality alert.

### Out of scope

- Promoting OTHER soft constraints to hard (grade_spread, age_spread,
  cabin_minimum_occupancy). Those are tunable trade-offs by design.
- Multi-MP minimum (≥2 MP honored per camper). Camp policy is ≥1.

### GitHub issue

To be filed alongside this doc.

---

## Stream 2 — Solver Debug Metrics Expansion (Tier 1 + Tier 2)

**Status:** Newly proposed. Replaces the prior "PR3 status badges"
proposal, which was lower-leverage.

### Motivation

The solver-runs dashboard currently shows: `num_booleans`,
`num_integer_variables`, `model_num_variables`, `model_num_constraints`,
constraint-type breakdown, `num_branches`, `num_conflicts`,
`solution_strategy`. These are counts, not diagnostics. They tell you
"how big is the model" but not "what's expensive", "is the LP tight",
or "is the solver actually making progress".

Three concrete cases where current metrics fail:

1. The **Stage 4** simplification (Stream 1) drops 164 reified
   constraints to 164 plain constraints. Current metrics don't
   distinguish reified from plain, so the win is invisible.
2. The **variable-count attack surface** (Stream 3) saves BoolVars by
   sparser modeling. Without a per-source breakdown, the impact is
   hard to attribute.
3. The current "FEASIBLE not OPTIMAL" status with `gap = 4.76%` doesn't
   distinguish "the solver is converging but ran out of time" from
   "the solver hit a flat plateau and isn't making progress". A
   best-bound trajectory would.

### Tier 1 — High signal, low effort

| Metric | Source | Why useful |
|---|---|---|
| Reified linear constraint count | `model.Proto().constraints[i].enforcement_literal` non-empty | Direct measure of model complexity; the Stage 4 simplification cuts this by 164 |
| Soft constraint count (by module) | `len(ctx.soft_constraint_violations)` grouped by key prefix | 4 modules populate this dict: `must_satisfy_*`, `grade_ratio_*`, `level_regression_*`, `age_spread_b*`. Visible Stage 4 impact = 164 from `must_satisfy_*` → 0 |
| Max linear coefficient (big-M proxy) | scan `model.Proto().constraints[*].linear.coeffs` | Values >100K signal big-M modeling weakness; the 287,600 MSO penalty is the current outlier |
| Request density histogram | precompute from `requests_by_person` | "How many MP requests per camper" distribution; single-MP-request kids are the stuck-core cohort |
| Impossible-request breakdown | `direct_solver.py:_validate_requests` already computes this; expose per-reason counts | Currently shown as a single number (4); split into: "target not in solver" / "cross-session" / "malformed" |

### Tier 2 — Useful diagnostics

| Metric | Source | Why useful |
|---|---|---|
| LP root gap | `solver.SolutionInfo()` or response proto | Gap *before* B&B started; tells you LP relaxation quality independent of time budget |
| Best-bound trajectory | per-solution callback recording `BestObjectiveBound()` over time | Slope reveals "converging" vs "stuck on plateau" |
| Per-sub-solver wall time | CP-SAT response proto `subsolvers` field | Which LNS strategies found best solutions; helps tune `num_workers` |
| Pre-solve compression ratio | model size pre/post `model.Validate()` + presolve | Currently 9,750 → 5,561 booleans (~43% compression). Worth tracking. |
| Symmetry detection flag | response proto | Did CP-SAT find/apply symmetry? |
| Domain size distribution | scan IntVar domains | Wide domains = harder problem; tightening is a future lever |

### Tier 3 — Advanced (likely defer)

- Restart count, conflict-learning stats, LP iterations
- Free variable count post-presolve
- Constraint-graph density (variables-per-constraint)

### Code refs

- `bunking/solver/direct_solver.py:174-177` — current `num_*` capture
- `bunking/solver/direct_solver.py:801-804` — None-defaults for failed solves
- `api/services/solver_runner.py` — how stats reach `solver_runs.stats`
- `frontend/src/pages/SolverDebug.tsx` (or equivalent) — dashboard
- CP-SAT proto: `ortools.sat.cp_model_pb2.CpSolverResponse`

### Order vs other streams

**Ship FIRST.** Metrics are read-only, low-risk, and they're the
measurement scaffold for Stage 4 and Stream 3. Landing Stream 2 before
Stream 1 means the Stage 4 simplification is *visible* in the
dashboard the moment it merges. Landing it before Stream 3 means
variable-count savings are attributable.

### Risks

1. CP-SAT response-proto fields are not always available in older
   ortools versions. Verify against pinned version (`ortools` in
   `pyproject.toml`).
2. Some metrics (per-sub-solver wall time, best-bound trajectory)
   require capture during solve, not just post-solve. Adds callback
   complexity.

### GitHub issue

To be filed alongside this doc.

---

## Stream 3 — Variable-Count Attack Surface

**Status:** Newly proposed. Compound savings; biggest blast radius of
the four streams.

### Motivation

For S2 (193 persons × 17 bunks), the pre-presolve model would have
~9,750 boolean variables. CP-SAT presolve compresses to 5,561 (~43%
reduction). The compression suggests substantial redundancy in the
model as written — many variables are immediately fixed or implied
and have to be eliminated by presolve effort rather than never being
created in the first place.

Reducing model size at *build time* (rather than relying on presolve
to eliminate junk) yields:

- Smaller working memory
- Faster presolve
- Tighter LP relaxation
- Clearer model when debugging

### Boolean variable bulk (estimated, S2)

| Source | Pre-presolve count | Code ref |
|---|---|---|
| `person_in_bunk[p, b]` — one per (person, bunk) | 193 × 17 = 3,281 | `direct_solver.py:_create_assignment_variables` |
| `both_in_bunk[req, b]` — one per BUNK_WITH request per bunk | 311 × 17 = 5,287 | `constraints/bunk_requests.py:add_bunk_request_satisfaction_vars` |
| `req_satisfied[r]` — one per request | 504 | `constraints/bunk_requests.py`, `age_preference.py` |
| `must_satisfy_violation[p]` — one per MP camper | 164 | `constraints/must_satisfy.py` |
| Constraint-internal indicators (grade_ratio, age_spread, level_progression, grade_adjacency) | ~500 | various |
| **Total before presolve** | **~9,750** | |
| **Post-presolve (reported)** | **5,561** | |

### Levers, ranked by leverage

| # | Lever | Estimated savings | Risk | Effort |
|---|---|---|---|---|
| 3a | **Sparse `person_in_bunk` — gender filter at model-build time** | −~1,640 BoolVars for S2 (50% of 3,281) | Low — `person_idx_map` already gender-aware upstream | Modest PR |
| 3b | **Sparse `both_in_bunk` — eligibility intersect** (skip bunks where requester OR requestee is gender/grade-ineligible) | −~1,500–2,500 BoolVars | Low | Modest PR |
| 3c | **Hard MSO** (Stream 1) | −164 BoolVars | Already covered by Stream 1 | — |
| 3d | **Pre-solve fixed-assignment pass** for 1-bunk-eligible campers (e.g., AG-only, grade-locked) | −17 BoolVars per such camper | Low | Small PR |
| 3e | **Drop `req_satisfied` for already-impossible requests** | −~4 per session (small) | None | Tiny |
| 3f | **Convert `grade_ratio` bool_and chains to `AddAllowedAssignments`** (CP-SAT table constraints are tighter than `bool_and`) | Possibly significant, hard to estimate without prototyping | Medium — modeling rewrite | Medium PR |

### Compound impact

Stages 3a + 3b + Stream 1 (hard MSO) together could reduce booleans
from **5,561 → ~3,000** (−46%) on S2, with corresponding linear
constraint reductions. S4 (303 persons × 26 bunks) compounds higher.

### Why 3a is the single best lever

Camp bunks are single-gender. Currently the model creates a BoolVar
for "girl placed in boys' bunk" for every (F-person, M-bunk) pair —
all forced to 0 by the gender constraint, but they exist until
presolve. Limiting `person_in_bunk` creation to (person, eligible_bunk)
pairs at model-build time eliminates the largest single source of
pre-presolve redundancy.

### Code refs

- `bunking/solver/direct_solver.py:_create_assignment_variables` —
  source of the 3,281 BoolVars
- `bunking/solver/constraints/bunk_requests.py` — `both_in_bunk` /
  `separated` loops
- `bunking/solver/direct_solver.py:_validate_requests` (lines
  355-438) — impossibility classification already provides the
  filter list for 3e

### Risks

1. Refactoring `_create_assignment_variables` touches the foundational
   modeling layer. Many downstream functions assume the `assignments`
   dict is dense `(person_idx, bunk_idx)` → BoolVar. Sparse model
   requires "missing key → forbidden" treatment everywhere it's read.
2. Test coverage for the constraint modules is good but doesn't
   exhaustively cover gender mismatches (because the existing model
   creates the BoolVar and the gender constraint forces it to 0 —
   the test passes trivially). Need new test fixtures.

### Out of scope

- Custom CP-SAT search-strategy injection. Stays with default workers
  for now.
- Wholesale switch from CP-SAT to LP-based solver. Out of scope
  permanently for this codebase.

### GitHub issue

To be filed alongside this doc.

---

## Stream 4 — Mutual-Request Boost (PR-D)

**Status:** Newly promoted to high priority per the May 12
investigation. Originally tagged "Stage 5" in the wife-feedback
scoreboard.

### Motivation

The stuck-core cohort analysis (13-run S2 sweep) showed most failing
single-MP-request campers have a one-directional request: kid A wants
kid B, but kid B's family didn't reciprocate. The solver sees A's
request worth `share_bunk_with × first_request_multiplier = 1.5 × 10
= 15` and B's competing cluster requests at similar weights. With no
mutual reinforcement, B follows the cluster.

When mutual requests DO exist (both families name each other),
they're identified post-hoc by the satisfaction logic but get no
extra weight in the objective. A bonus weight when both directions
are present would naturally favor those pairings during solve.

### Mechanism (sketch)

In `score_evaluator.py` (or wherever per-request weights are
calculated), detect mutual pairs:

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

Then in the objective term:

```python
weight = base_weight * source_multiplier
if is_mutual_bunk_with(request, all_requests_by_person):
    weight *= MUTUAL_BOOST_MULTIPLIER  # e.g., 2.0
```

### Why this complements (doesn't compete with) Stream 1

Stage 4 hard MSO *forces* ≥1 MP per camper but the solver still
chooses *which* MP. Mutual-boost makes mutual pairs more attractive
for that choice, so when Stage 4 binds, it preferentially honors
mutual requests. The two stack: hard MSO enforces coverage breadth;
mutual-boost steers WHICH request gets honored.

### Estimated impact

Hard to predict precisely without running it. Mutual pairs are
probably 30–50% of the request graph; boosting their weight 2× could
shift many borderline cluster placements. Best measured empirically
once the metrics PR is in.

### Code refs

- `bunking/solver/score_evaluator.py` — current weight calculation
  (verify location)
- `bunking/solver/objective_evaluator.py` — objective term assembly
- `bunking/satisfaction/predicate.py` — canonical satisfaction logic
  (post-#1158)
- Memory ref: `feedback_priority_dimensions_independent.md` (don't
  collapse coincident keys)

### Configuration knob

Add `objective.mutual_request_boost = 2.0` to admin GUI. Defaults to
2.0 if not set; tunable per camp.

### Risks

1. Symmetry concern — if A→B mutual and C→D mutual, the boost is
   symmetric so it doesn't break anything, but worth verifying
   model symmetry is unchanged.
2. Edge case — A names "B" by string-match, AI resolves to
   `requestee_id=42`. B names "A" by string-match, AI resolves to
   `requestee_id=99`. If A's `requester_id` is 99 and B's is 42,
   mutuality is detected. But if string matches are asymmetric (one
   side has lower confidence), the resolution layer might mark only
   one direction `status='resolved'` and the other `status='pending'`.
   Test fixture needed.

### Out of scope

- Detecting mutual NOT_BUNK_WITH (symmetric by definition; not the
  same problem).
- Triple-mutual (A→B→C→A) cycle detection. Pair-level is enough.

### GitHub issue

To be filed alongside this doc.

---

## Suggested order

| # | Stream | Why this slot | Effort | Dependency |
|---|---|---|---|---|
| 1 | **Stream 2: Metrics expansion (Tier 1 + Tier 2)** | Foundation for all subsequent measurement. Read-only, low risk. Establishes baselines. | ~120–180 LOC | None |
| 2 | **Stream 1: Stage 4 hard MSO** | Camp policy fix. Model simplification (−164 vars, −164 reified) visible in new dashboard. | ~150 LOC | Stream 2 (measurement) |
| 3a | **Stream 4: Mutual-boost** | Independent, can parallel with 3b. Layers cleanly on Stage 4 baseline. | ~80–120 LOC | Stream 1 (baseline) |
| 3b | **Stream 3: Variable-count attack surface** | Compound model simplification. Bigger blast radius but lower urgency. | ~250–400 LOC | Stream 2 (measurement) |

### Why metrics first

Streams 1, 3, 4 all produce changes worth measuring. Without Stream 2,
their wins are invisible or hard to attribute. The cost of doing
Stream 2 first is one PR's worth of delay on Stream 1; the benefit is
every subsequent PR has built-in before/after observability.

### Why Stage 4 before mutual-boost

Stage 4 enforces coverage; mutual-boost steers which request gets
coverage. The "which" question is more meaningful when coverage is
already guaranteed.

### Why variable-attack last

Largest LOC, touches foundational modeling, biggest review surface.
Best to land after Stage 4 establishes the cleaner baseline so
diffs are clearer.

---

## Cross-references

- `bunking/solver/direct_solver.py` — main solver entry
- `bunking/solver/constraints/` — constraint modules
- `bunking/solver/feasibility.py` — pre-solve validation
- `bunking/satisfaction/{bucket,aggregate,predicate}.py` — canonical
  post-#1158 satisfaction logic
- `api/services/solver_runner.py` — task orchestration
- `docs/reference/solver-config-decisions.md` (gitignored) — local
  Phase 1.5 cleanup planning artifact
- Wife-feedback scoreboard (local doc) — Stage 4 sketch context

---

## Update log

- **2026-05-13** — Doc created (this commit). All four streams
  documented; GitHub issues to be filed in companion commits.
