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

## Status & phased sequencing

> Supersedes the original "Suggested order" section. The Stream sections
> below are the detailed *what / why / how* reference; this section is the
> dependency-ordered *when*, with issue numbers. Updated 2026-05-14.

### Work item → issue → status

| Work item | Issue | PR | Status |
|---|---|---|---|
| Stream 1 — Stage 4 hard MSO | #1379 | #1391 | ✅ shipped 2026-05-14 |
| Stream 2 Tier 1 — debug metrics | #1380 | #1385 | ✅ shipped 2026-05-13 |
| Stream 2 Tier 1 — per-`RequestBucket` split | #1388 | #1425 | ✅ shipped 2026-05-14 |
| Stream 5 — IIS infeasibility localization | (in #1379) | #1391 | ✅ shipped 2026-05-14 |
| Stream 6 — pre-check impossibility framework | (in #1379) | #1391 | ✅ shipped 2026-05-14 |
| Sat-var unification | #1395 | #1427 | ✅ shipped 2026-05-14 |
| Stream 6 substream — entirely-impossible MP campers in pre-check + "Acceptable" denominator fix | #1428 | #1429 | ✅ shipped 2026-05-14 |
| **Stream 2 Tier 2 — plateau-diagnostic metrics** | none (spec in-doc) | — | 🔵 **Phase 2 — in progress** |
| Stream 4 — mutual-request boost | #1382 | — | ⬜ Phase 3 |
| Stream 3 — variable-count attack surface | #1381 | — | ⬜ Phase 4 (re-scope first) |
| Golden sat-var ↔ predicate alignment test | #1398 | — | ⬜ do now (drift defense for #1427) |
| Retire `solution.calculate_satisfied_requests` | #1397 | — | ⬜ pairs with #1398 |
| Penalty-driven MP-coverage investigation | #1396 | — | ⬜ low urgency |
| Audit `direct_solver` for hand-rolled impossibility logic | #1426 | — | ⬜ unblocked (#1429 merged) |
| Schematize `grade_spread.max_spread` | #1424 | — | ⬜ small cleanup, anytime |
| Stream 6 substreams 6a–6f | unfiled | — | ⬜ incremental |

Work-item PRs use `Closes #N` in the body so the issue auto-closes on merge,
where a tracking issue exists. Phase 2 (Tier 2 metrics) is being implemented
without an issue — its full spec lives in the Stream 2 section below.

### Phases

**Phase 0 — Foundation (DONE).** Stage 4 hard MSO (#1391), Tier 1 metrics +
bucket split (#1385 / #1425), IIS localization & impossibility framework
(#1391), sat-var unification (#1427). The S2 model is roughly half its
pre-#1391 size; MP coverage is 100% of solver-actionable campers.

**Phase 1 — Pre-check honesty (DONE — #1428 / PR #1429, shipped 2026-05-14).**
`target_not_in_solver` promoted to a registered predicate (closes the last
pre-validate ↔ solver drift), `mp_campers_entirely_impossible` derived
rollup as single source of truth, camper-level surfacing in the pre-validate
modal, and the "Acceptable" metric denominator fixed to exclude
structurally-impossible campers.

**Phase 2 — Tier 2 metrics (IN PROGRESS).** Scoped to three
plateau-diagnostic metrics only: **best-bound trajectory, LP root gap,
presolve compression ratio.** *Not* the full Tier 2 list — per-sub-solver
wall time / symmetry flag / domain-size distribution defer until a specific
question demands them (the dropped PR3 badges are the cautionary tale:
num_branches / num_conflicts turned out to be noise). Rationale: the
remaining solver problem is the **plateau** — `objective_value` flattens by
~60 s and only the *bound* moves after; Tier 1 cannot distinguish
"converging slowly" from "stuck", best-bound trajectory can. Phase 2
hard-unblocks Phase 4 and makes Phase 3 measurable. **No tracking issue** —
the three-metric spec is fully captured in the Stream 2 section below, so
the implementation PR carries it directly rather than re-deriving from a
filed issue. (Tier 2 was orphaned when #1380 ("Tier 1 + Tier 2") closed on
Tier 1 alone; the remaining Tier 2/Tier 3 metrics stay tracked in the
Stream 2 tables and are picked up only when a specific question demands them.)

**Phase 3 — Mutual-request boost (the build — Stream 4 / #1382).** Highest-
leverage plateau intervention: reshapes the objective toward reciprocated
pairs so that when Stage 4's hard constraint binds, it preferentially honors
mutual requests. Well-scoped (~80–120 LOC). Soft-gated on Phase 2 — without
best-bound trajectory you can't tell whether it broke the plateau or just
shuffled local optima.

**Phase 4 — Compound & consolidate.** Stream 3 variable-count attack
(#1381), **re-scoped first**: #1391 + #1427 already removed `both_in_bunk`
(the old lever 3b) and the duplicate MP sat vars, so the blast radius is far
smaller than the original estimate — lever 3a (sparse `person_in_bunk`
gender filter) is the main remaining win, and Phase 2's compression-ratio
metric tells you exactly what is left to cut. Plus the Group 55 tail
(#1396, #1397) and Stream 6 substreams (#1426 audit, then 6a–6f).

**Parallel / immediate (not gated):** #1398 golden alignment test — do it
now while #1427 is fresh; it is the drift defense for the sat-var encoding
that just changed, and #1397 pairs with it. #1424 (`grade_spread.max_spread`
schematize) is a small standalone cleanup that can land anytime.

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

**Status:** Shipped in #1391 (2026-05-13). The motivation, "why hard works,"
safety gate, and risks below remain accurate. The "Surprising side-effect:
model simplification" section was wrong in its model-size math — see the
inline note in that section for the corrected version. Follow-ups #1395,
\#1396, \#1397, \#1398 capture the remaining work surfaced during
implementation.

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

### Model simplification — original hypothesis vs. shipped reality

**Original hypothesis (incorrect as written).** The soft MSO at
`bunking/solver/constraints/must_satisfy.py:126-135` (pre-rename) looked
like this per MP-having camper:

```python
violation = ctx.model.NewBoolVar(...)                                # +1 BoolVar
ctx.model.Add(sum(all_sat_vars) == 0).OnlyEnforceIf(violation)       # +1 reified linear
ctx.model.Add(sum(all_sat_vars) >= 1).OnlyEnforceIf(violation.Not()) # +1 reified linear
ctx.soft_constraint_violations[...] = (violation, penalty)            # +1 objective term
```

The roadmap predicted collapsing to:

```python
ctx.model.Add(sum(all_sat_vars) >= 1)                                # +1 plain linear
```

…and removing 164 BoolVars / 328 reified linears / 164 objective terms
from S2.

> **Reality (#1391):** the `all_sat_vars` produced by the pre-#1391
> `add_bunk_request_satisfaction_vars` used **one-way `OnlyEnforceIf`
> implications**. The solver could set `sat_var = 1` freely without
> forcing actual co-placement. A hard `sum(all_sat_vars) >= 1` over them
> would be vacuously satisfiable. The now-deleted soft `must_satisfy.py`
> summed over these falsifiable vars — meaning the 287,600 penalty was
> almost certainly operationally inert (the 95.73% MP coverage came from
> cluster constraints emergently placing friends, not the penalty).
> **Correction (#1395):** the objective itself was *never* falsifiable —
> `add_objective` has always built its own bidirectional `req_satisfied_*`
> vars and never consumed `add_bunk_request_satisfaction_vars`. That helper
> was orphaned when #1391 deleted `must_satisfy.py` and is removed in #1395,
> which unifies the objective's and parent_paramount's sat vars into one
> shared `request_satisfied_vars` map. See #1396 for the investigation issue.
>
> **What shipped** in #1391: hard constraint uses a bidirectional
> per-request sat var via `ctx.person_bunk_assignment` (matches the
> encoding `add_objective` uses at `direct_solver.py:663-714`) for
> bunk_with / not_bunk_with, plus the existing per-(request, bunk)
> `person_in_clean_bunk` forcing indicators exposed from
> `add_age_preference_satisfaction_vars` for age_preference. One
> bidirectional sat var + two reified linears per MP bunk request;
> zero new vars for age_preference. Net S2 model effect: roughly
> neutral vs. the soft baseline (−164 violation BoolVars, +~250
> MP-specific sat vars, +~500 reified linears, +164 plain linears,
> −164 objective terms). #1395 will eliminate the ~250 duplicate sat
> vars by unifying with the objective's set.

### Safety gate

`unsatisfied_no_possible` from `feasibility.py:196` counts campers whose
ENTIRE MP set is structurally impossible. The gate is enforced upstream
by `_validate_requests` in `direct_solver.py`, which classifies a
request as impossible when any of the following holds:

- `target_not_in_solver` — requestee absent from `person_idx_map`
- `cross_session` — `bunk_with` across sessions (boundary forbids)
- `malformed` — `bunk_with`/`not_bunk_with` with no `requested_person_cm_id`
- `pair_no_shared_bunk` — `bunk_with` where the requester and target
  have no gender-compatible same-session bunk (added 2026-05-13 after
  PR #1391's Taste 1 INFEASIBLE; cross-gender `bunk_with` slipped past
  the prior gate and the hard MP constraint then forced impossible
  co-placement). `not_bunk_with` with no shared bunk is trivially
  satisfied and remains `possible`.
- `age_pref_no_eligible_grade` — `age_preference` at the same-gender
  grade bound in the wrong direction. Per camp staff policy: if a
  camper is the oldest grade of their gender in the session and
  prefers older (or youngest and prefers younger), the preference is
  moot — there are no peers to be older/younger than them. Marking
  impossible upstream is what allows the hard MP constraint to bind
  cleanly for everyone else. Bounds are derived from the actual
  same-gender camper pool in the session (scan-the-pool fallback;
  the follow-up issue to tie this to admin-GUI-configured min/max
  grades will swap the source without changing the call site).

**Defensive pattern when adding the hard constraint:**

```python
for person_cm_id, possible_reqs in possible_requests.items():
    mp_possible = [r for r in possible_reqs if is_material_parent(r)]
    if mp_possible:  # only enforce when ≥1 possible MP exists
        model.Add(sum(satisfaction_vars[r.id] for r in mp_possible) >= 1)
```

If a future sweep returns `unsatisfied_no_possible > 0`, those campers
are skipped (the constraint isn't added for them) and surfaced via
`mp_set_entirely_impossible` for staff review. The 4 current S2
`impossible_requests` (synthetic IDs from unresolvable names) are spread
across kids who ALSO have viable MP alternatives, so the constraint
still applies to those kids.

**Pair-feasibility scope today:** gender + session. Group locks,
AG-eligibility quirks, and other pre-fixed-assignment conflicts are
NOT yet checked. If a future failure mode emerges from one of those,
extend `_pair_has_shared_bunk` rather than adding a new reason.

### Code refs (post-#1391)

- `bunking/solver/constraints/parent_paramount.py` — hard MP constraint (renamed from `must_satisfy.py`)
- `bunking/solver/constraints/bunk_requests.py` — `get_or_create_request_sat_var`, the canonical bidirectional sat-var builder (post-#1395; replaced the orphaned one-way `add_bunk_request_satisfaction_vars`)
- `bunking/solver/direct_solver.py:643-714` — bidirectional objective-side sat var encoding (template for #1391's hard path)
- `bunking/solver/direct_solver.py:355-438` — `_validate_requests`, impossibility classification
- `bunking/solver/direct_solver.py:1215-` — `_check_must_satisfy_one_violations` (post-solve diagnostic, ERROR severity under hard MSO)
- `bunking/solver/feasibility.py:193-205` — `unsatisfied_no_possible` computation
- `bunking/solver/constraints/base.py` — `SolverContext` including `mp_set_entirely_impossible`
- `bunking/satisfaction/bucket.py` — `is_material_parent_request` (source-field bucket classifier)
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

Tracking: #1379 (closed by #1391 on 2026-05-13).

### Follow-ups surfaced during #1391 implementation

- **#1395** — `refactor(solver): unify bunk-request sat vars + remove the orphaned one-way helper`. Behaviour-neutral cleanup: deleted the orphaned one-way `add_bunk_request_satisfaction_vars` (dead since #1391 removed `must_satisfy.py`), added the canonical bidirectional `get_or_create_request_sat_var`, and unified `add_objective` + `parent_paramount` onto one shared `request_satisfied_vars` map (~250 fewer duplicate BoolVars on S2). The "free money" framing was stale — the objective was never falsifiable; see the Stream 1 "Reality (#1391)" correction above.
- **#1396** — `investigation: was historical MP coverage actually penalty-driven?` Three counterfactual experiments to determine whether the 95.73% pre-Stage-4 MP rate came from the soft penalty or from cluster constraints emergently placing friends.
- **#1397** — `refactor(solver): retire solution.calculate_satisfied_requests + audit calculate_field_level_stats`. Cleanup of `solution.py` to delegate to `bunking.satisfaction.predicate`.
- **#1398** — `test(solver): golden alignment test between solve-time sat vars and post-solve predicate`. Deferred from #1391 Task 9 (no integration fixture infrastructure).
- **#1424** — `refactor(solver): schematize constraint.grade_spread.max_spread`. The key is read in 4 sites but absent from `CONFIG_SCHEMA`; each read leans on a `default=` to swallow the `UnknownKeyError`. Either schematize it or replace with a named constant.

---

## Stream 2 — Solver Debug Metrics Expansion (Tier 1 + Tier 2)

**Status:** Tier 1 **shipped** — #1380 / PR #1385 (core metrics) and #1388 /
PR #1425 (per-`RequestBucket` split). Tier 2 — **Phase 2, in progress** (see
"Status & phased sequencing" above). Scoped to three plateau-diagnostic
metrics: best-bound trajectory, LP root gap, presolve compression ratio.
Implemented **without a tracking issue** — Tier 2 was orphaned when #1380
("Tier 1 + Tier 2") closed on Tier 1 alone, and the three-metric spec is
fully captured here, so the PR carries it directly. The rest of the Tier 2
table and the Tier 3 list below stay tracked here and defer until a specific
question demands them.

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

Tier 1: #1380 (closed by #1385) + #1388 (closed by #1425). Tier 2: no tracking
issue — implemented as Phase 2 directly from the spec above (see Phase 2 in
"Status & phased sequencing"). The deferred Tier 2/Tier 3 metrics remain
tracked in the tables above; file issues if/when a specific question
prioritizes them.

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
| ~~`both_in_bunk[req, b]` — one per BUNK_WITH request per bunk~~ | ~~311 × 17 = 5,287~~ | ~~`constraints/bunk_requests.py:add_bunk_request_satisfaction_vars`~~ — pre-#1391 only; the helper was orphaned when #1391 deleted `must_satisfy.py` and removed entirely in #1395. No `both_in_bunk` vars exist in the live model. |
| `req_satisfied[r]` — one per request | 504 | `constraints/bunk_requests.py`, `age_preference.py` |
| ~~`must_satisfy_violation[p]` — one per MP camper~~ | ~~164~~ | ~~`constraints/must_satisfy.py`~~ (removed in #1391; the ~250 bidirectional MP sat vars it was replaced by were unified with the objective's set into one shared `request_satisfied_vars` map in #1395) |
| Constraint-internal indicators (grade_ratio, age_spread, level_progression, grade_adjacency) | ~500 | various |
| **Total before presolve** | **~9,750** | |
| **Post-presolve (reported)** | **5,561** | |

### Levers, ranked by leverage

| # | Lever | Estimated savings | Risk | Effort |
|---|---|---|---|---|
| 3a | **Sparse `person_in_bunk` — gender filter at model-build time** | −~1,640 BoolVars for S2 (50% of 3,281) | Low — `person_idx_map` already gender-aware upstream | Modest PR |
| ~~3b~~ | ~~**Sparse `both_in_bunk` — eligibility intersect**~~ — **moot:** `both_in_bunk` was orphaned by #1391 and removed by #1395. The live sat-var encoding is `person_bunk_assignment`-based (one BoolVar per request, no per-bunk fan-out). | — | — | — |
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

#1381. **Re-scope before starting** — #1391 + #1427 already eliminated
`both_in_bunk` (the old lever 3b) and the duplicate MP sat vars; lever 3a
(sparse `person_in_bunk`) is the main remaining win. Gated on Phase 2's
presolve-compression-ratio metric. See Phase 4 in "Status & phased
sequencing" above.

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

#1382. This is Phase 3 — the next *build* after Tier 2 (Phase 2) lands.

---

## Stream 5 — Infeasibility Localization for Hard Constraints

**Status:** Shipped in #1391 as a debug-mode diagnostic on the failure
path.

### Motivation

Stream 1 (Stage 4 hard MSO) introduced a class of failure the prior
Stream 2 metrics can't diagnose: **INFEASIBLE returns where the cause is
a subset of the hard MP constraints that can't be jointly satisfied.**
Tier 1/2 metrics target *feasible-but-suboptimal* solves (best-bound
trajectory, LP gap, pre-solve compression). On INFEASIBLE the solver
exits in presolve and those metrics yield no signal.

The existing `find_infeasibility_cause` in `feasibility.py` does
constraint-type-level isolation — it identifies which constraint
*module* causes infeasibility (e.g. "parent_paramount" vs "gender").
That's not granular enough when parent_paramount has 95 individual
constraints and we need to know *which campers* are unsatisfiable.

### Mechanism

After `find_infeasibility_cause` identifies `parent_paramount` as the
cause, `localize_hard_mso_infeasibility` runs a two-pass IIS search:

1. **Singleton isolation** — for each MP-hard-constrained camper, solve
   with that camper's hard constraint skipped. Any camper whose alone-
   removal restores feasibility is reported as singleton-critical.
2. **Deletion filter** — if no singleton works, start with all hard MP
   constraints skipped (feasible by construction) and re-enforce them
   one at a time. Each camper whose re-addition flips feasibility →
   infeasibility is part of the minimal correction set.

The result is recorded in the in-memory `solver_runs[run_id]` under
`parent_paramount_iis` and logged at ERROR level. The `stats` JSON
column on the `solver_runs` PB record carries it forward to the
debug dashboard.

Cost: ~`time_limit_seconds × N` solves where N is the
MP-hard-constrained camper count. Each solve typically returns
INFEASIBLE in presolve (<0.1s), so 95 candidates ≈ 10s. Bounded by
`max_candidates=200` to keep pathological sessions from runaway cost.

### Why this is its own stream

Tier 1/2 (Stream 2) are *model-shape* and *feasible-solve-progress*
metrics. Stream 5 is *post-failure root-cause-localization*. Same
"observability" umbrella, but different solve states and different
implementation surface. Keeping them as separate streams avoids
stuffing the Stream 2 doc with diagnostics that only ever fire on
INFEASIBLE.

### Code refs

- `bunking/solver/feasibility.py:localize_hard_mso_infeasibility`
- `bunking/solver/constraints/parent_paramount.py` — honors
  `ctx.mp_skip_cms` for the IIS probe
- `bunking/solver/constraints/base.py:SolverContext.mp_skip_cms`
- `api/services/solver_runner.py` — invokes localization after
  `find_infeasibility_cause` flags parent_paramount

### Risks

1. ~10s extra wall time on INFEASIBLE runs. Acceptable since INFEASIBLE
   already returns a fast 0.1s solve + 1–2s analyzer. Localization only
   fires when the analyzer specifically blames `parent_paramount`.
2. Deletion filter finds *a* minimal MCS, not *the* minimum MCS — if
   the IIS structure has multiple minimal sets, order of iteration
   determines which one we report. Acceptable for staff-facing
   diagnostics; not for formal model verification.

### Out of scope

- CP-SAT assumptions API (`model.AddAssumption` +
  `solver.SufficientAssumptionsForInfeasibility`). Native IIS support
  but requires rewriting parent_paramount's constraint emission to be
  per-camper-toggleable via assumptions. Deferred unless localization
  performance becomes a bottleneck.
- Auto-soft-fallback. The localizer tells us *which* campers can't be
  honored; the architectural decision of whether to gracefully
  degrade those to soft MSO is a separate question.

---

## Stream 6 — Pre-Check Impossibility Detection Framework

**Status:** Framework + initial predicates shipping alongside Stage 4 hard
MSO in #1391. Substreams below extend the registry as additional hard
constraints land or surface gaps are identified.

### Motivation

Stream 1 made unmet MP requests infeasible rather than soft-degradable.
Stream 5 (IIS Localization) tells us which campers cause it after the
fact. But the conflict surfaced in Taste 1 — reciprocal `bunk_with`
across a 2-grade gap — was knowable *before* the solver ran. The
`_validate_requests` impossibility classifier in `direct_solver.py`
didn't check grade compatibility; neither did the user-facing
`/solver/pre-validate` endpoint at `api/routers/solver.py`.

Worse, the two paths had drifted: `pre_validate_solver` does its own
hand-rolled impossibility logic that misses `cross_session`,
`pair_no_shared_bunk` (gender), and `age_pref_no_eligible_grade` —
all checks that *do* exist in `direct_solver._validate_requests`.
Staff could click "Pre-Check" on the bunking board, see "all clear",
then run the solver and hit INFEASIBLE.

### Mechanism

A single `bunking/solver/impossibility.py` module owns classification.
Each hard constraint module registers a `HardConstraintImpossibility`
predicate exposing up to three optional layers:

- `check_request(req, ctx)` — request-local (malformed, missing target)
- `check_pair(req, ctx)` — pair-local (gender, grade gap, session boundary)
- `check_cluster(component_cms, ctx)` — cluster-local (over-spread chain,
  oversized connected component)

`validate_impossibility(input_data, config) → ImpossibilityReport` runs
all registered predicates and returns a structured report. Both
`pre_validate_solver` and `DirectBunkingSolver._validate_requests` call
this shared function; legacy hand-rolled paths in both are deleted.

A registry discipline test (`tests/unit/solver/impossibility/test_registry.py`)
asserts every constraint module marked `hard=True` has a matching
predicate registered. Adding a new hard constraint without one fails CI.

### Predicates in #1391

| Predicate | Layer | Status |
|---|---|---|
| `SessionBoundaryImpossibility` | pair | Relocated from `pre_validate_solver` |
| `GenderImpossibility` | pair | Relocated from `_validate_requests` |
| `MalformedRequestImpossibility` | request | Relocated from `_validate_requests` |
| `AgePreferenceImpossibility` | request | Relocated from `_validate_requests` |
| `GradeCompatibilityImpossibility` | pair + cluster | **NEW** — fixes Taste 1 reciprocal `bunk_with` across grades |
| `BunkCapacityImpossibility` | cluster | **NEW** — reciprocal `bunk_with` chains > max bunk capacity |
| `TargetNotInSolverImpossibility` | request | **Added #1429** — promoted from a hand-rolled `_validate_requests` fallback; closes the last pre-validate ↔ solver drift |

`POST /api/solver/pre-validate` response gains a structured
`impossibility_report` field replacing the legacy
`statistics.unsatisfiable_requests`. `PreValidationResultsModal` reads
the new shape: friendly prose for staff (default), reason-coded
detail tables for admins (`BUNKING_DEBUG` permission). A chip on
`SolverDebugPage.SweepPanel` opens the same modal for debug use.

### Why this is its own stream

Stream 5 is *post-failure* root-cause attribution within a single
constraint module. Stream 6 is *pre-solve* structural rejection of
requests that can never satisfy ANY hard constraint. Different solve
states, different surfaces, complementary. Stream 5 fires when the
solver returns INFEASIBLE despite passing pre-check; Stream 6 catches
the bulk of cases before the solver runs at all.

### Code refs

- `bunking/solver/impossibility.py` — new shared module
- `bunking/solver/constraints/grade_spread.py` + `grade_adjacency.py` —
  contribute to `GradeCompatibilityImpossibility`
- `bunking/solver/direct_solver.py:_validate_requests` — gutted to delegate
- `api/routers/solver.py:pre_validate_solver` — gutted to delegate
- `frontend/src/components/PreValidationResultsModal.tsx` — extended renderer
- `frontend/src/components/PreValidateRequestsButton.tsx` — existing entry
- `frontend/src/pages/summer/SolverDebugPage/SweepPanel.tsx` — new debug entry

### Risks

1. **API shape change** — `statistics.unsatisfiable_requests` removed in
   the same PR. Modal updated together. No external consumers documented.
2. **Drift between predicates and constraint modules** — mitigated by
   `test_registry.py`; a `hard=True` constraint without a predicate fails CI.
3. **Predicate over-eager flagging** silently drops a request from both
   objective and MSO. Each predicate ships with negative tests (passes on
   valid cases).

### Deferred substreams

**Stream 6a — `level_progression` impossibility predicate.** If a
`bunk_with` requestee is locked by level progression to a bunk the
requester cannot enter (also by progression), the request is impossible.
Requires mapping level rules to per-camper allowed-bunk sets. Code ref:
`bunking/solver/constraints/level_progression.py`. Effort: medium.

**Stream 6b — `group_locks` impossibility predicate.** A `bunk_with` into
a full locked group (no room) is impossible. A `not_bunk_with` between
two campers already locked together is also impossible. Code ref:
`bunking/solver/constraints/group_locks.py`. Effort: small.

**Stream 6c — Per-bunk grade range predicates.** Today's
`GradeCompatibilityImpossibility` uses the global `max_grade_range`. If
per-bunk grade ranges become hard constraints (some bunks naturally hold
narrower bands), the predicate needs to additionally verify *some* bunk's
per-bunk range accepts both pair members. Blocked on per-bunk grade range
becoming a hard constraint. Effort: medium.

**Stream 6d — Cohort census (demand > supply).** Pre-solve O(N) pass that
detects (gender, age-band) cohorts where MP demand exceeds bunk supply
(e.g., 30 g8-F campers all with MP `clean(grade=8)` but only 2 g8-F
bunks of capacity 12). Produces a new impossibility category
`cohort_overcommit` (cluster-shape finding). Effort: medium.

**Stream 6e — "Open request" navigational link (staff UX).** Each
impossibility row in the staff modal links to the request in
`RequestReviewPanel` filtered to that request. Strictly navigational;
staff decides any action. Effort: tiny. Risk: navigation breaks if the
request review filter API changes.

**Stream 6f — Solver-probe-based fallback for unclassified requests.**
For the residual subset of requests not classified by any static
predicate, run a CP-SAT probe ("force this request, drop all others,
check feasibility") as insurance against drift. ~0.1s per probe; only
runs on the residual 5-10%. Effort: medium. Mitigated today by
`test_registry.py`; consider only if drift becomes a real issue.

**Stream 6g — entirely-impossible MP camper pre-check visibility (shipped).**
Promoted `target_not_in_solver` from a hand-rolled `_validate_requests` fallback
to a registered `TargetNotInSolverImpossibility` predicate (closing the
pre-validate ↔ `_validate_requests` drift). Added a derived
`ImpossibilityReport.mp_campers_entirely_impossible` field computed in
`validate_impossibility` — single source of truth; `parent_paramount` and
`_validate_requests` consume it instead of re-deriving. Surfaced in the
`/solver/pre-validate` response and both impossibility modals as a camper-level
"will get zero parent requests honored" section. Also fixed the `mp_camper_rate`
("Acceptable") denominator to count only campers with ≥1 *possible* MP request,
and fixed a latent bug where `feasibility.py` read `mp_set_entirely_impossible`
before it was populated. Audit follow-up: #1426.

### GitHub issues

Framework + initial predicates shipped in #1391. Stream 6g (above) shipped
in #1429 (closes #1428); #1426 tracks the audit follow-up. Substreams 6a–6f
remain unfiled; file as separate issues if/when prioritized.

---

## Suggested order

Superseded by **"Status & phased sequencing"** near the top of this doc
(Phases 0–4 with issue numbers). The original rationale, preserved:

- **Metrics first** — Streams 1/3/4 all produce changes worth measuring;
  without observability their wins are invisible or unattributable. (Held:
  Tier 1 shipped before Stage 4; Tier 2 now gates Phase 4.)
- **Stage 4 before mutual-boost** — Stage 4 enforces coverage, mutual-boost
  steers *which* request gets it; the "which" question is only meaningful
  once coverage is guaranteed. (Held: Phase 3 follows Phase 0.)
- **Variable-attack last** — largest LOC, touches foundational modeling.
  (Held + sharpened: #1391 + #1427 already ate most of its blast radius —
  re-scope in Phase 4.)

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

- **2026-05-13** — Doc created. All four streams documented; GitHub
  issues filed in companion commits.
- **2026-05-13** — Stream 2 (metrics) shipped in #1385.
- **2026-05-13** — Stream 1 (Stage 4 hard MSO) shipped in #1391.
  Implementation surfaced that the soft sat vars used one-way
  `OnlyEnforceIf` implications, so the roadmap's "−164 BoolVars / −164
  reified" simplification math was wrong as written. The corrected
  math (model approximately neutral vs soft baseline) is in the Stream
  1 "Model simplification" section above. Four follow-up issues
  filed: #1395 (sat var unification), #1396 (penalty-driven
  investigation), #1397 (`solution.py` cleanup), #1398 (golden
  alignment test).
- **2026-05-13** — Stage 4 follow-up bundled into #1391: Taste 1
  produced INFEASIBLE on first real-data run because cross-gender
  `bunk_with` MP requests slipped past the safety gate. Widened
  `_validate_requests` with a new `pair_no_shared_bunk` impossibility
  reason (gender + session check via `_pair_has_shared_bunk`). Added
  `parent_paramount` toggle to `feasibility.py`'s analyzer
  `constraint_types` list — without it the analyzer mis-diagnoses
  "gender" as the cause when hard MP is the real culprit.
- **2026-05-13** — Second Stage 4 follow-up in #1391: Taste 1 still
  INFEASIBLE because MP `age_preference` requests at the same-gender
  grade bound (e.g. grade-6 boy prefers older in a max-grade-6-boys
  session) were treated as "possible" by `_validate_requests` and
  forced the hard MP constraint to fire when no satisfying bunk
  composition exists. Camp policy: at-bound preferences in the wrong
  direction are moot ("too bad, impossible"). Added
  `age_pref_no_eligible_grade` reason and `_session_grade_bounds_for_gender`
  helper. Bounds derived from the same-gender camper pool today; a
  follow-up issue tracks tying this to admin-GUI grade configuration.
- **2026-05-13** — Stream 5 (Infeasibility Localization) shipped in
  #1391. Taste 1 INFEASIBLE persisted past both gate-widening fixes
  (only knocked 3 of 98 candidates into `mp_set_entirely_impossible`).
  Tier 1/2 metrics aren't the right tool for INFEASIBLE diagnostics —
  they target FEASIBLE-but-suboptimal solves. Added an IIS-style
  localization pass that fires on `parent_paramount`-caused
  infeasibility: singleton isolation then deletion filter, reporting
  the minimal correction set of campers whose hard MP constraints
  can't be jointly satisfied. Output goes to logs and the
  `parent_paramount_iis` field on `solver_runs.stats`.
- **2026-05-13** — Stream 6 (Pre-Check Impossibility Detection
  Framework) scoped and bundling into #1391. IIS on Taste 1 returned
  a 2-camper MCS: a reciprocal `bunk_with` across a 2-grade gap (g3 ↔
  g5). Each alone is satisfiable, the pair isn't. Singleton isolation
  missed because removing either still leaves the other's MP forcing
  co-placement. The pair-feasibility gate (`_pair_has_shared_bunk`)
  only checks session + gender, not grade compatibility — exactly the
  drift Stream 6 fixes. New `bunking/solver/impossibility.py` module
  with per-constraint predicate registry; both `pre_validate_solver`
  and `DirectBunkingSolver._validate_requests` delegate to it.
  `GradeCompatibilityImpossibility` (pair + cluster) catches
  that case pre-solve. API response `impossibility_report` replaces
  legacy `statistics.unsatisfiable_requests`. `PreValidationResultsModal`
  extended with staff-friendly prose vs admin-detail views. Substreams
  6a–6f (level_progression, group_locks, per-bunk grade range, cohort
  census, "open request" link, solver-probe fallback) deferred.
- **2026-05-14** — #1395 shipped: bunk-request sat-var unification. Deleted
  the orphaned one-way `add_bunk_request_satisfaction_vars` (dead since
  #1391 removed `must_satisfy.py`), added the canonical bidirectional
  `get_or_create_request_sat_var`, and unified `add_objective` +
  `parent_paramount` onto one shared `request_satisfied_vars` map.
  Behaviour-neutral (both prior encodings were already honest bidirectional
  comparisons); the win is ~250 fewer duplicate BoolVars on S2. Corrected
  the Stream 1 "Reality" note (the objective was never falsifiable) and the
  Stream 3 table / lever 3b (`both_in_bunk` no longer exists in the live model).
- **2026-05-14** — #1388 shipped (PR #1425): Tier 1 solver stats split by
  `RequestBucket` (MP / IMP / staff) — per-bucket `request_density_histogram`
  and `impossible_by_reason`.
- **2026-05-14** — Stream 6g shipped: `target_not_in_solver` promoted to a
  registered predicate; `mp_campers_entirely_impossible` rollup added to
  `ImpossibilityReport`; `mp_camper_rate` denominator corrected. Filed #1426 to
  audit `direct_solver` for other hand-rolled impossibility logic.
- **2026-05-14** — Added "Status & phased sequencing" section (Phases 0–4 +
  issue map) and retired the stale "Suggested order" table. Reconciled the
  Stream 2/3/4 "GitHub issue" lines with filed issue numbers. Flagged Tier 2
  as unfiled (orphaned when #1380 closed on Tier 1 alone).
- **2026-05-14** — #1429 merged (closes #1428): Phase 1 (pre-check honesty)
  complete — Stream 6g shipped, #1426 (`direct_solver` impossibility audit)
  now unblocked. Phase 2 (Tier 2 plateau metrics) started **without a
  tracking issue** — the three-metric spec (best-bound trajectory, LP root
  gap, presolve compression ratio) is fully captured in the Stream 2 section,
  so the PR carries it directly. The remaining Tier 2/Tier 3 metrics stay
  tracked in the Stream 2 tables. Worktree: `tier2-plateau-metrics`.
