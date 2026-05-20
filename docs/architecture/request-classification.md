# Request Classification — The (source, type) Registry

How bunk requests are classified for two distinct purposes: **reporting** (what the head bunker sees on the post-check / pre-check surfaces) and **solver semantics** (what constraints and weights the OR-Tools model generates).

Both purposes key off the same input — the tuple `(source_field, request_type)` — so they live in **one canonical registry table**, one row per valid combo, with each purpose expressed as its own column. This document is the canonical reference; future work touching `bunking/satisfaction/`, `bunking/solver/`, or the post-check / pre-check frontend should consult it.

> **Status (2026-05): Phase 2 shipped the registry as a no-op refactor.** The `rule` and `weight_key` columns are **scaffold** — defined and tested, but not yet consumed (`HARD_MNT` is declared, not enforced). Sections below flag *current* vs *target* state explicitly.

---

## One table, two axes as columns

Historically the reporting grouping, the solver rule, and the objective multiplier lived in three separate `(source, type)`-keyed maps that drifted apart whenever a business rule landed. They are now one registry — `bunking/satisfaction/request_registry.py` — keyed on `(source_field, request_type)`, with a `RequestClass` row per combo:

| Column | Axis | Drives | Consumed? |
|--------|------|--------|-----------|
| `report_group` | reporting | scorecard bucket / post-check column | ✅ via `classify_request` |
| `counted` | reporting | whether it rolls into the headline satisfaction % | ✅ via `COUNTED_BUCKETS` |
| `rule` | solver | constraint shape (`HARD_MSO` / `HARD_MNT` / `SOFT`) | ⚠️ scaffold — see below |
| `weight_key` | solver | `objective.source_multipliers.*` config suffix | ⚠️ scaffold — see below |

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
| bunk_request_form | not_bunk_with | MATERIAL_PARENT | ✅ | HARD_MSO | share_bunk_with |
| bunk_request_form | age_preference | MATERIAL_PARENT | ✅ | HARD_MSO | share_bunk_with |
| socialize_with | age_preference | IMMATERIAL_PARENT | ❌ | SOFT | socialize_preference |
| staff_not_bunk_with | not_bunk_with | STAFF | ✅ | HARD_MNT *(target)* | do_not_share_with |
| bunking_notes | bunk_with | STAFF | ✅ | SOFT | bunking_notes |
| bunking_notes | not_bunk_with | STAFF | ✅ | SOFT | bunking_notes |
| bunking_notes | age_preference | STAFF | ✅ | SOFT | bunking_notes |
| internal_notes | bunk_with | STAFF | ✅ | SOFT | internal_notes |
| internal_notes | not_bunk_with | STAFF | ✅ | SOFT | internal_notes |
| internal_notes | age_preference | STAFF | ✅ | SOFT | internal_notes |
| manual | bunk_with | STAFF | ✅ | SOFT | — *(→1.0)* |
| manual | not_bunk_with | STAFF | ✅ | HARD_MNT *(target)* | — *(→1.0)* |
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

> **⚠️ Scaffold as of Phase 2.** The `rule` and `weight_key` columns exist and are exhaustively tested, but **no solver code reads them yet**:
> - MP detection still flows through `is_material_parent_request` (`report_group == MATERIAL_PARENT`), which is equivalent to `rule == HARD_MSO` for parent-form rows.
> - The objective evaluators (`score_evaluator.py`, `objective_evaluator.py`) still build their own source-keyed multiplier dicts. Phase 3 rewires them to read `weight_key`.

Three rule kinds:

| Rule | Semantics | Status |
|------|-----------|--------|
| `HARD_MSO` | "Each camper with ≥1 possible request in this rule must satisfy ≥1." Aggregate must-satisfy-one. | **Enforced** (parent_paramount, Tier 1) |
| `HARD_MNT` | "This specific pair must not be placed together." Per-request must-not-together, with carve-outs. | **Declared, NOT enforced** — deferred to #1543 / #1541 |
| `SOFT` | Contributes to the objective via `source_multipliers`. No hard enforcement. | **Enforced** (default for everything not HARD_MSO) |

**Current solver reality:** `staff_not_bunk_with × not_bunk_with` is **SOFT** today, weighted by `do_not_share_with` (1.5). The registry declares its `rule` as `HARD_MNT` to mark the *target* should staff hardening be revived — but until a `staff_directive_exclusion` builder reads it, it behaves SOFT. The near-term lever for "staff exclusions should matter more" is **raising the soft multiplier** (Phase 4), not a hard constraint.

**Important asymmetry: parent-form positives are MP, admin-UI positives are NOT.** A staff-typed `manual × bunk_with` does not enter the parent-paramount must-satisfy-one set, even when the head bunker enters it on a parent's behalf. MP semantics ("we hard-commit to try") flow from *parent ownership of the request*, not from request content. An admin-entered request loses that ownership chain. If the parent wants it MP, they fill out the form.

---

## HARD_MNT carve-outs (deferred — #1541)

When `HARD_MNT` is eventually enforced, three carve-outs may downgrade a request to `SOFT` before constraint generation, to keep the model from going INFEASIBLE in edge cases. **None of this is implemented yet** — it lands only if staff hardening is revived. Captured here so the design isn't lost:

- **Infeasibility carve-out**: when a pair has no shared bunk possible (e.g., only-one-cabin oldest/youngest grade), downgrade to SOFT. Mirrors the existing MP defensive pattern in `parent_paramount.py`.
- **Asymmetric tiebreaker**: when one side has ≤1 request total and the other has more, an opposing positive request from the high-count side may downgrade the low-count side's `not_bunk_with`. Exact rule TBD (needs staff input).
- **Triangle exception**: when A wants B and C, but B wants C and explicitly not A, B's `not_bunk_with` toward A may downgrade. Exact rule TBD (needs staff input).

---

## Stopping rule for future splits

The temptation to add new buckets or rule kinds will recur. Apply this test:

> **New bucket ⟺ new frontend report column.** If the question is "track this in the solver differently," it's a change to the `rule` / `weight_key` columns, not a new bucket. If the question is "show this as its own column in post-check / pre-check / satisfaction tables," it's a new `report_group` value.

Concrete examples:
- ✅ "Show staff exclusions as their own counted column, separate from staff notes" → new bucket (would split `STAFF`). Only then mint `STAFF_NOT_BUNK_WITH` / `STAFF_OBSERVATION`.
- ✅ "Treat staff-vetted exclusions as hard with carve-outs" → flip the `rule` column + add a builder (the deferred #1543 / #1541 work). Not a new bucket.
- ❌ "Score `bunking_notes` differently from `internal_notes`" → not a new bucket; both stay `STAFF`. They already have distinct `weight_key`s.
- 🤔 "Show parent positives vs. parent negatives separately on post-check" → would split `MATERIAL_PARENT`. Don't unless explicitly requested.

The stopping rule is the only thing that keeps the table from drifting back into "one report column per source × type cell."

---

## Where this lives

**Canonical code (single source of truth):**

- `bunking/satisfaction/request_registry.py` — `RequestBucket`, `SolverRule`, `RequestClass`, `_REGISTRY` (the 14 rows), `classify(source, type)`, `report_group_for(source)`, `rule_for(source, type)`, `weight_key_for(source, type)`, derived `COUNTED_BUCKETS`.
- `bunking/satisfaction/bucket.py` — compatibility shim: re-exports `RequestBucket` / `COUNTED_BUCKETS`, reimplements `classify_request(source)` / `is_material_parent_request(req)` against the registry.

**Consumers — call into the registry, never hardcode source/type checks:**

- `bunking/solver/constraints/parent_paramount.py` — Tier 1 hard MSO (via `is_material_parent_request`, i.e. `report_group == MATERIAL_PARENT`).
- `bunking/solver/score_evaluator.py` / `objective_evaluator.py` — soft objective terms (own multiplier dicts today; migrate to `weight_key` in Phase 3).
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
| Phase 2 (this doc) | **one `(source, type)` registry**, columns for both axes | Collapsed the bucket map + planned rule/multiplier maps into one table to stop cross-map drift. No behavior change; `rule` / `weight_key` are scaffold. |
| Phase 3 (planned) | evaluators read `weight_key`; config reshaped per-`(source,type)` | — |
| Phase 4 (planned) | tune `staff_not_bunk_with` weight (#1543) | — |
| Deferred | enforce `HARD_MNT` + carve-outs (#1543 / #1541) | Only if staff hardening is revived. |

---

## Verification commands

```bash
# The registry table tests pin every cell of every row:
uv run pytest tests/unit/satisfaction/test_request_registry.py -v

# Confirm no module hardcodes a SourceField check outside the registry:
rg -n "source_field == |SourceField\." bunking/ --type py | grep -v "test" | grep -vE "request_registry.py"

# Audit which paths key off RequestBucket today:
rg -n "RequestBucket\." bunking/ --type py
```
