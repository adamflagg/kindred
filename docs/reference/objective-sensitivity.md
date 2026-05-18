# Solver Objective Sensitivity Analysis

> **Snapshot:** 2026-05-18, post-v5.5.0 / post-#1523 mutual-request boost.
> Source-of-truth for the tables is `scripts/analyze_objective_sensitivity.py` —
> regenerate with `uv run python scripts/analyze_objective_sensitivity.py`.
> Test suite at `tests/unit/scripts/test_analyze_objective_sensitivity.py`
> locks in every magnitude shown here.

## What this doc is for

Every solver tuning decision implicitly compares the **objective benefit** of
honoring a request against the **penalty cost** of breaking a soft constraint.
Until now those magnitudes lived in scattered places (`CONFIG_SCHEMA`, seed
migrations, hardcoded constants in `direct_solver.py`) and the comparisons
were done by gut. This doc compiles the magnitudes into one place and shows
the arithmetic explicitly, so:

- **Solver tuning decisions** (which penalty to bump, which knob to delete,
  which threshold actually matters) have a concrete reference for ratio
  analysis.
- **`solver-config-it` cleanup decisions** (KEEP / HARDCODE / DELETE / FIX)
  can be informed by "does this module actually contribute meaningful
  objective magnitude relative to peers?"
- **Residual-analysis** of unmet requests (the 21 S2 / 17 S4 partial tails)
  has a single-paragraph arithmetic explanation instead of speculation.

## When to consult this doc

- Before proposing a new soft penalty / weight / source multiplier change.
- Before filing a "the solver should honor this request" issue — confirm the
  arithmetic actually supports the request winning against the local penalty.
- When deciding whether to promote a soft constraint to hard (compare the
  penalty magnitude against the dominant competing reward).
- During `solver-config-it` rounds, as the second-pass criterion after code-usage check.

## Per-request weights (current seed values)

How a single satisfied request becomes an objective term. Formula (from
`direct_solver.py:562-583`):

```text
weight = int(BASE_REQUEST_WEIGHT × source_multiplier × mutual_boost × slot_multiplier)
       = int(40                  × source_multiplier × {2.0 or 1.0}  × {10, 5, 1})
```

`BASE_REQUEST_WEIGHT = 40` and `slot_multipliers = (10, 5, 1)` are hardcoded
constants in `direct_solver.py:67-72` — they were config rows until migration
`1500000100_priority_deletion.js` (PR #1455) deleted them. They can no longer
be tuned without a code PR.

Slot ordering: per-camper requests are sorted before the slot stack is
applied. If `objective.enable_first_boost = 1` (seed: 1), each family's
`is_first_requested=true` request lands at slot 0 first; everything else
fills in order.

The mutual boost applies **only** to `bunk_with`. Other source types ignore
the `mutual` flag — see `score_evaluator.py` and the regression test
`test_request_weight_mutual_boost_only_applies_to_bunk_with`.

| Source | Bucket | Slot 0 (first) | Slot 1 (second) | Slot 2+ (third+) | Mutual boost applies? |
|---|---|---|---|---|---|
| `bunk_with` | MP | 600 (1200 mutual) | 300 (600 mutual) | 60 (120 mutual) | Yes (×2.0) |
| `not_bunk_with` | STAFF | 600 | 300 | 60 | No |
| `bunking_notes` | STAFF | 400 | 200 | 40 | No |
| `internal_notes` | STAFF | 320 | 160 | 32 | No |
| `socialize_with` | IMP | 240 | 120 | 24 | No |

`age_preference` MP requests are **not in the objective at all** — they are
enforced only by the parent_paramount hard constraint (`add_age_preference_*`
forcing indicators). Non-MP `age_preference` has no solver representation.

## Per-constraint penalty inventory

Soft constraint magnitudes from `CONFIG_SCHEMA` defaults + seed migration
`1500000011_config.js`. Each row is what gets added (or subtracted, for
bonuses) to the objective when the constraint fires.

| Module | Penalty / Bonus | Magnitude | Per-what | Trigger |
|---|---|---|---|---|
| `grade_ratio` | Penalty | 5000 | per grade × bunk | Single grade exceeds 67% of multi-grade bunk; edge bunks exempt |
| `grade_spread_soft` | Penalty | 3000 | per excess unique grade × bunk | Unique-grade count above `max_spread` (2) |
| `cabin_minimum_occupancy` | Penalty | 2000 | per spot × bunk | Used bunk below `PREFERRED_BUNK_OCCUPANCY` (10); capped at 2 spots / 4000 per bunk |
| `age_spread` | Penalty | 1500 | per bunk | Age spread > 24 months |
| `level_progression` | Penalty | 800 | per camper × eligible lower-level bunk | Returning camper placed in lower-level bunk than prior year |
| `age_grade_flow` | Bonus (up to) | +300 | per camper × bunk | Continuous: `fit_score × weight`; camper's grade matches bunk's target grade |
| `age_spread_preferred_bonus` | Bonus | +500 | per bunk | Age spread ≤ 12 months |

Hard constraints (no penalty — solver cannot violate): `assignment`,
`session_boundary`, `cabin_capacity` (12), `cabin_minimum_occupancy` floor
(8), `gender`, `group_locks`, `grade_adjacency` (no-gap), `parent_paramount`,
and `grade_spread` when `constraint.grade_spread.mode = "hard"` (seed mode is
`"soft"`, so the soft path is the production reality).

## Per-archetype totals + threshold ratios

Five representative camper profiles. `Total earnable` is the sum of objective
weight for every request in the archetype assuming all are satisfied.
Threshold ratios are **`penalty / total`** — how many archetype-totals' worth
of earnable would be needed to overcome a single instance of that penalty.

| Archetype | Description | Total earnable | vs grade_ratio (5000) | vs grade_spread (3000) | vs level_progression (800) |
|---|---|---|---|---|---|
| **A. Loner mutual** | Singleton MP camper, 1 reciprocated bunk_with request. | 1200 | 4.17× | 2.50× | 0.67× |
| **B. Loner one-way** | Singleton MP camper, 1 unreciprocated bunk_with request. | 600 | 8.33× | 5.00× | 1.33× |
| **C. Cluster star** | Multi-MP camper, 3 reciprocated bunk_with requests forming a tight cluster. | 1920 | 2.60× | 1.56× | 0.42× |
| **D. Mixed multi (THE RESIDUAL ARCHETYPE)** | Multi-MP camper, 1 reciprocated bunk_with at first-pick + 2 unreciprocated at slots 1-2. Matches the partial-tail pattern of the 21 S2 / 17 S4 unmet residuals. | 1560 | 3.21× | 1.92× | 0.51× |
| **E. Popular target (own requests)** | A camper named by multiple other campers but with her own 2 unreciprocated MP requests elsewhere. Modeled here from her side; demand from other campers does not appear in her own objective contribution — see threshold analysis. | 900 | 5.56× | 3.33× | 0.89× |

### Reading the ratios

- **Ratio > 1**: penalty exceeds the archetype's entire earnable benefit. The
  solver will NOT trigger this penalty for this archetype unless other
  rewards compound to bridge the gap.
- **Ratio < 1**: archetype's earnable exceeds the penalty cost. The solver
  CAN absorb this penalty in exchange for satisfying the archetype.
- **Ratio near 1**: marginal — the LP relaxation sees a near-tie and
  shimmers between solutions; LNS strategies dominate the outcome.

Three useful patterns visible in the table:

1. **Loner one-way (B) is structurally hard to honor** — at 600 earnable,
   it loses to grade_ratio by 8×. The solver only honors archetype B when
   the placement is "free" (no soft constraint triggered). The mutual boost
   (archetype A) cuts that ratio in half (4.17×) but doesn't break parity.
2. **Cluster star (C) dominates level_progression** at 0.42× — a 3-MP all-
   mutual camper's full benefit (1920) is more than 2× a single level
   regression (800). The solver will accept the regression to keep the
   cluster intact.
3. **Mixed multi (D) — the residual archetype — has a "tail tax".** The
   first-pick mutual is worth 1200 by itself (4.17× ratio vs grade_ratio,
   same as archetype A — meaning the mutual alone is what gets honored).
   The slots 1-2 add only 360 marginal earnable, vastly insufficient to
   override any 5000 grade_ratio violation triggered by honoring them.
   **This is the arithmetic explanation of the 21 S2 / 17 S4 residuals.**

## Worked example: the 21 S2 partial-tail residuals

Cross-reference data from solver run `qgc731ty5puoy3c` (S2, 180 s, current main):

- **Soft constraints fired:** `grade_ratio=96`, `age_spread=16`, `level_regression=281`
- **Total grade_ratio cost in the satisfied solution:** 96 × 5000 = **480,000**
- **Total level_regression cost:** 281 × 800 = **224,800**
- **Objective value:** 267,034 (this is rewards − penalties; gross rewards ≈ 1,000,000+)

The solver is *paying* 480 K in grade_ratio penalties because the cluster
rewards exceed them. So the 21 residuals are **not** "the solver refuses to
break grade_ratio" — they are cases where honoring the slot-1/slot-2 tail
would trigger an *additional* penalty whose 5000 cost exceeds the 60-300
marginal benefit. The slot-0 first-pick (or mutual) already paid for the
cluster's grade_ratio violation; adding the tail member doesn't earn enough
to justify the next ratio break.

Three illustrative cases from the residual analysis (camper IDs and bunk
labels anonymized; the arithmetic is what matters, not who the campers are):

| Requester (sat'd MPs) | Unmet target | Pattern |
|---|---|---|
| `1000001` (got 2/3, both mutual) | `1000002 → bunk X`, one-way, slot 1 | 2-grade gap + presumably ratio-locked target bunk; 300 marginal benefit vs 5000 ratio cost — solver correctly drops |
| `1000003` (got 3/4) | `1000004 → bunk Y`, one-way, slot 2 | Adjacent grade, presumably full bunk; 60 marginal benefit — even cheaper to drop |
| `1000005` (got 5/6, all mutual stacked) | `1000006 → bunk Z`, one-way, slot ? | Same-grade neighbor bunk — only triggers ratio if target's bunk would tip; 60-300 vs 5000 — drops |

All 21 follow this shape. A "popular target boost" would shift archetype E's
own benefit but not change the receiving side's arithmetic — see Phase 4
brainstorming notes for why this lever was deprioritized.

## Dead-config tracking

This inventory pass surfaces config knobs whose magnitudes are vestigial or
whose read sites are dead. Active tracking + per-domain resolutions live in
`docs/reference/solver-config-decisions.md` (local-only, gitignored — the
`solver-config-it` working artifact). Findings flagged during sensitivity
analysis should be cross-checked against the cleanup doc's "Phantom keys" /
"Cross-cutting findings" sections before being re-filed.

## How to regenerate

```bash
uv run python scripts/analyze_objective_sensitivity.py > /tmp/tables.md
```

Then update the three table sections of this doc from `/tmp/tables.md`. The
test suite at `tests/unit/scripts/test_analyze_objective_sensitivity.py`
locks in every magnitude — if a config change ripples into changed weights,
update `ObjectiveConfig` defaults in the script, update this doc's tables,
update the test assertions, and ship all three together.

## See also

- `docs/reference/solver-roadmap.md` — the Phase 0-4 stream sequencing; Phase
  3 changelog references this analysis for residual interpretation.
- `docs/reference/solver-config-decisions.md` (local-only / gitignored) —
  the per-domain cleanup tracker that this analysis feeds.
- `bunking/solver/direct_solver.py:562-612` — objective assembly.
- `bunking/satisfaction/bucket.py` — source_field → MP/IMP/STAFF mapping.
