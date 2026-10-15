# Request Classification — The (source, type) Registry

How bunk requests are classified for two distinct purposes: **reporting** (what the head bunker sees on the post-check / pre-check surfaces) and **solver semantics** (what constraints and weights the OR-Tools model generates).

Both purposes key off the same input — the tuple `(source_field, request_type)` — so they live in **one canonical registry table**, one row per valid combo, with each purpose expressed as its own column. This document is the canonical reference; future work touching `bunking/satisfaction/`, `bunking/solver/`, or the post-check / pre-check frontend should consult it.

> **Status (2026-10): both solver columns are now live.** `weight_key` is read by the objective evaluators through `weight_for` (Phase 3), and `HARD_MNT` is enforced as a hard separation by `bunking/solver/constraints/staff_separation.py` (#1541), with a parent-paramount carve-out. This page was written when both were scaffold; sections below say what is current.

---

## One table, two axes as columns

Historically the reporting grouping, the solver rule, and the objective multiplier lived in three separate `(source, type)`-keyed maps that drifted apart whenever a business rule landed. They are now one registry — `bunking/satisfaction/request_registry.py` — keyed on `(source_field, request_type)`, with a `RequestClass` row per combo:

| Column | Axis | Drives | Consumed? |
|--------|------|--------|-----------|
| `report_group` | reporting | scorecard bucket / post-check column | ✅ via `classify_request` |
| `counted` | reporting | whether it rolls into the headline satisfaction % | ✅ via `COUNTED_BUCKETS` |
| `rule` | solver | constraint shape (`HARD_MSO` / `HARD_MNT` / `SOFT`) | ✅ `parent_paramount` (via the material set), `staff_separation` via `rule_for` |
| `weight_key` | solver | `objective.source_multipliers.*` config key | ✅ via `weight_for` in the evaluators |

**Putting both axes in one table does not conflate them.** `report_group` and `rule` are independent columns — they can diverge per row; they're just not stored in separate files. The single table is what keeps them from drifting.

Each axis answers a different question:

- *report_group* — "What category does the staff lead want to see this request grouped under?"
- *rule* — "What constraint should the model generate for this request?"

When they coincide it's because the staff lead happens to want "X-as-a-category" grouped the way the solver enforces it. When they diverge (hard solver treatment reported under a softer-sounding bucket), that's fine, as long as both columns are intentional.

---

## The registry (all valid combos)

`RequestType` has three values (`bunk_with`, `not_bunk_with`, `age_preference`); `SourceField` has six. Strict sources (`staff_not_bunk_with` → `not_bunk_with`; `socialize_with` → `age_preference`) admit one type; the flexible sources (`bunk_request_form`, `bunking_notes`, `internal_notes`, `manual`) admit all three. That yields **14 rows** — 11 pipeline/synced combos + 3 admin-UI `manual` combos.

| source_field | request_type | report_group | counted | rule | weight_key |
|---|---|---|---|---|---|
| bunk_request_form | bunk_with | MATERIAL_PARENT | ✅ | HARD_MSO | share_bunk_with |
| bunk_request_form | not_bunk_with | MATERIAL_PARENT | ✅ | HARD_MSO | do_not_share_with |
| bunk_request_form | age_preference | MATERIAL_PARENT | ✅ | HARD_MSO | share_bunk_with |
| socialize_with | age_preference | IMMATERIAL_PARENT | ❌ | SOFT | socialize_preference |
| staff_not_bunk_with | not_bunk_with | STAFF | ✅ | HARD_MNT | do_not_share_with |
| bunking_notes | bunk_with | STAFF | ✅ | SOFT | bunking_notes |
| bunking_notes | not_bunk_with | STAFF | ✅ | SOFT | bunking_notes |
| bunking_notes | age_preference | STAFF | ✅ | SOFT | bunking_notes |
| internal_notes | bunk_with | STAFF | ✅ | SOFT | internal_notes |
| internal_notes | not_bunk_with | STAFF | ✅ | SOFT | internal_notes |
| internal_notes | age_preference | STAFF | ✅ | SOFT | internal_notes |
| manual | bunk_with | STAFF | ✅ | SOFT | — *(→1.0)* |
| manual | not_bunk_with | STAFF | ✅ | HARD_MNT | — *(→1.0)* |
| manual | age_preference | STAFF | ✅ | SOFT | — *(→1.0)* |

Note `bunk_request_form × not_bunk_with` (a parent writing "do not bunk with X" on their form) still lands in MATERIAL_PARENT. The parent is the source of truth for parent-form input regardless of polarity.

---

## Reporting axis: `report_group` + `counted`

Three reporting buckets today:

| Bucket | Frontend question | `counted`? |
|--------|-------------------|------------|
| `MATERIAL_PARENT` | "Did we honor parent must-haves?" | ✅ counted toward satisfaction totals |
| `IMMATERIAL_PARENT` | "How did parent age preferences land?" | ❌ informational (visible, excluded from totals) |
| `STAFF` | "Did we honor staff-vetted exclusions and notes?" | ✅ counted |

**`COUNTED_BUCKETS = {MATERIAL_PARENT, STAFF}`** — only `IMMATERIAL_PARENT` is excluded from the headline satisfaction/coverage number. All staff sources (the hidden `staff_not_bunk_with` field, AI-parsed notes, admin-UI `manual`) count today.

**`report_group` is currently source-determined** — every row of a given source shares one bucket. `report_group_for(source_field)` enforces that invariant (raises if a source's rows disagree). This is *why* there is no `STAFF_NOT_BUNK_WITH` / `STAFF_OBSERVATION` split: nothing today reports staff exclusions in a different column or count from staff notes, so per the stopping rule below, no separate bucket is minted. If that need ever arises, the invariant breaking is the signal.

---

## Solver axis: `rule` + `weight_key`

> **Both columns are consumed.** `weight_for(source, type, config)` resolves the multiplier for every evaluator (`direct_solver.py`, `objective_evaluator.py`, `score_evaluator.py`) and raises `ValueError` on a combo not in the registry; there is no source-keyed fallback. MP detection goes through `is_material_parent_request` / the contextual material set (`compute_material_request_ids`), and `staff_separation` asks `rule_for` which requests are `HARD_MNT`.

Three rule kinds:

| Rule | Semantics | Status |
|------|-----------|--------|
| `HARD_MSO` | "Each camper with ≥1 possible request in this rule must satisfy ≥1." Aggregate must-satisfy-one. | **Enforced** (parent_paramount, Tier 1) |
| `HARD_MNT` | "This specific pair must not be placed together." Per-request hard separation. | **Enforced** by `staff_separation.py`; yields only to a parent-paramount sole-MP `bunk_with`, and goes soft under break-glass |
| `SOFT` | Contributes to the objective via `source_multipliers`. No hard enforcement. | **Enforced** (default for everything not HARD_MSO) |

**Current solver reality:** `staff_not_bunk_with × not_bunk_with` and `manual × not_bunk_with` are `HARD_MNT`: `staff_separation.py` forces `bunk[requester] != bunk[target]`. The carve-out is a parent-paramount camper whose only possible MP request is a `bunk_with` that the separation would starve; the separation yields there and the yield is recorded. In break-glass mode the separation is relaxed and reported as a compromise. There is no impossibility predicate for it: cabins are not grade-hard-locked, so separation is essentially always feasible.

**Important asymmetry: parent-form positives are MP, admin-UI positives are NOT.** A staff-typed `manual × bunk_with` does not enter the parent-paramount must-satisfy-one set, even when the head bunker enters it on a parent's behalf. MP semantics ("we hard-commit to try") flow from *parent ownership of the request*, not from request content. An admin-entered request loses that ownership chain. If the parent wants it MP, they fill out the form.

---

## HARD_MNT carve-outs (what shipped, and what did not)

Only the parent-paramount carve-out shipped (see above). The three carve-outs sketched in #1541 before it was built were narrowed to that one; the others are **not implemented** and stay design notes in case staff hit the edge:

- **Infeasibility carve-out**: when a pair has no shared bunk possible, downgrade to SOFT. Not needed so far, see above.
- **Asymmetric tiebreaker**: when one side has at most one request and the other has more. Exact rule TBD (needs staff input).
- **Triangle exception**: when A wants B and C, but B wants C and explicitly not A. Exact rule TBD (needs staff input).

---

## Stopping rule for future splits

The temptation to add new buckets or rule kinds will recur. Apply this test:

> **New bucket ⟺ new frontend report column.** If the question is "track this in the solver differently," it's a change to the `rule` / `weight_key` columns, not a new bucket. If the question is "show this as its own column in post-check / pre-check / satisfaction tables," it's a new `report_group` value.

Concrete examples:
- ✅ "Show staff exclusions as their own counted column, separate from staff notes" → new bucket (would split `STAFF`). Only then mint `STAFF_NOT_BUNK_WITH` / `STAFF_OBSERVATION`.
- ✅ "Treat staff-vetted exclusions as hard with carve-outs" → flip the `rule` column + add a builder (what #1541 did with `staff_separation.py`). Not a new bucket.
- ❌ "Score `bunking_notes` differently from `internal_notes`" → not a new bucket; both stay `STAFF`. They already have distinct `weight_key`s.
- 🤔 "Show parent positives vs. parent negatives separately on post-check" → would split `MATERIAL_PARENT`. Don't unless explicitly requested.

The stopping rule is the only thing that keeps the table from drifting back into "one report column per source × type cell."

---

## Where this lives

**Canonical code (single source of truth):**

- `bunking/satisfaction/request_registry.py` — `RequestBucket`, `SolverRule`, `RequestClass`, `_REGISTRY` (the 14 rows), `classify(source, type)`, `report_group_for(source)`, `rule_for(source, type)`, `weight_key_for(source, type)`, `weight_for(source, type, config)`, `is_hard_separation`, derived `COUNTED_BUCKETS`.
- `bunking/satisfaction/bucket.py` — compatibility shim: re-exports `RequestBucket` / `COUNTED_BUCKETS`, reimplements `classify_request(source)` / `is_material_parent_request(req)` against the registry.

**Consumers — call into the registry, never hardcode source/type checks:**

- `bunking/solver/constraints/parent_paramount.py` — Tier 1 hard MSO (via the contextual material set, `compute_material_request_ids`).
- `bunking/solver/constraints/staff_separation.py` — hard `HARD_MNT` separation (via `rule_for`).
- `bunking/solver/score_evaluator.py` / `objective_evaluator.py` / `direct_solver.py` — objective terms (multipliers via `weight_for`).
- `bunking/solver/observability.py`, `bunking/solver/impossibility.py` — per-bucket request-density / impossibility histograms (via `classify_request`).
- `bunking/satisfaction/aggregate.py` — bucket roll-ups for satisfaction totals (via `classify_request` + `COUNTED_BUCKETS`).
- `bunking/satisfaction/api_shape.py` — `BucketCount` rows per bucket.
- Frontend post-check / pre-check tables — per-bucket columns.

**Anti-pattern to avoid:**

```python
# DON'T — bypasses the registry
if request.source_field == "staff_not_bunk_with":
    ...

# DO — consult the registry
from bunking.satisfaction import classify_request, rule_for

bucket = classify_request(request.source_field)
rule = rule_for(request.source_field, request.request_type)
```

---

## History

| Phase | Model | Why it changed |
|------|-------|----------------|
| pre-#1142 | 2 buckets (`source` column: `parent` / `staff`) | Couldn't distinguish parent must-haves from parent preferences. |
| #1142 series | 3 buckets (`MATERIAL_PARENT` / `IMMATERIAL_PARENT` / `STAFF`), source-keyed `_BUCKET_MAP` | Separated parent must-haves from preferences and from staff input. |
| #1548 (Phase 1) | renamed `SourceField` wire-values to stop colliding with `RequestType` | Made `(source, type)` a clean composite key. |
| Phase 2 | **one `(source, type)` registry**, columns for both axes | Collapsed the bucket map + planned rule/multiplier maps into one table to stop cross-map drift. No behavior change at the time. |
| Phase 3 | evaluators read `weight_key` through `weight_for` | Shipped. |
| #1541 / #1643 | `HARD_MNT` enforced by `staff_separation.py`, with the parent-paramount carve-out | Staff and manual exclusions are hard. |
| #1701 | break-glass relaxes `HARD_MNT` to soft and reports it | Always-place guarantee. |

---

## Verification commands

```bash
# The registry table tests pin every cell of every row:
uv run pytest tests/unit/bunking/satisfaction/test_request_registry.py -v

# Confirm no module hardcodes a SourceField check outside the registry:
rg -n "source_field == |SourceField\." bunking/ --type py | grep -v "test" | grep -vE "request_registry.py"

# Audit which paths key off RequestBucket today:
rg -n "RequestBucket\." bunking/ --type py
```
