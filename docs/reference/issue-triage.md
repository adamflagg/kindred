# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-13 (40 open issues).

---

## Group 2: Metrics / Velocity — Backend (Python API)

**Priority: High** — Correctness bug + perf wins in same service

| # | Title | Type |
|---|-------|------|
| 456 | Snapshot "latest of the day" dedup relies on list order | bug |
| 447 | Velocity hybrid gate should be per-session, not global | refactor |
| 467 | Reduce parameter sprawl in VelocityService snapshot methods | refactor |
| 460 | Extract shared week-label formatting utility | refactor |
| 459 | Add daily data series to cancellation velocity path | feature |
| 475 | Reuse attendees from cancellation curves for session swap detection | perf |
| 474 | Eliminate duplicate snapshot fetches when gender split is enabled | perf |

**Interplay:** #467 and #447 touch same VelocityService code. #474/#475 are in the forecast/cancellation pipeline. #459 benefits from #460 (shared week formatting). Sequence: #456 (bug) first, then #467/#447 refactors, then #474/#475 perf, then #459/#460 feature.

---

## Group 3: Metrics / Velocity — Frontend Refactors

**Priority: Medium** — Do after Groups 1 & 2 stabilize

| # | Title | Type |
|---|-------|------|
| 472 | Extract shared hooks/components from VelocityPage and CancellationVelocityPage | refactor |
| 478 | Centralize hardcoded `['metrics']` query key prefix | refactor |
| 437 | Migrate metrics hooks from positional params to options objects | refactor |

**Interplay:** #437 and #478 simplify hooks that #472 consolidates. Do #437 → #478 → #472.

---

## Group 4: Metrics — Capacity & Feature

**Priority: Low** — Standalone features, no blockers

| # | Title | Type |
|---|-------|------|
| 445 | Account for concurrent teen program cabin usage in session capacity | feature |
| 453 | Promote geo overrides to static canonical data | feature |

**Interplay:** Independent. #445 relates to session types architecture.

---

## Group 5: Sync / Go Backend *(in progress)*

**Priority: High** — Data integrity bugs

| # | Title | Type |
|---|-------|------|
| 484 | Validate CAMPMINDER_SEASON_ID instead of defaulting to 2025 | bug |
| 504 | Standardize source_field comparisons to use SourceField constants | tech-debt |

**Interplay:** Independent. #484 is a data integrity risk, #504 prevents future normalization bugs.

---

## Group 6: Solver (Python) *(in progress)*

**Priority: Medium** — Isolated cluster, forward-compat risk

| # | Title | Type |
|---|-------|------|
| 500 | `ConstraintProto.HasField()` fails on OR-Tools 9.15 | bug |
| 493 | Guard f-string debug logs in constraint hot loops | perf |
| 494 | Initialize `_pair_reduction_logged` in `__init__` instead of hasattr | refactor |
| 483 | Clean up dead pin lock / `respect_locks` code | tech-debt |

**Interplay:** #483 pairs with #479 (Group 8) — clean up dead lock code, then expose the UI toggle. #493/#494 are quick independent wins.

---

## Group 7: Geo / Frontend

**Priority: Medium** — Leftovers from geo normalization cleanup (PR #513)

| # | Title | Type |
|---|-------|------|
| 521 | Tighten toContain assertion in GeoDetailList tests | test |
| 520 | `session_cm_id` silently dropped on duration path in geo service | bug |
| 519 | Migrate GeoAnalysis.tsx to QueryGuard | refactor |
| 518 | Add keyboard accessibility to GeoDetailList drilldown rows | a11y |

**Interplay:** #520 is the real bug. Rest are quality improvements found during review.

---

## Group 8: Frontend — General Refactors & Quality

**Priority: Low** — Independent quick wins

| # | Title | Type |
|---|-------|------|
| 531 | Add auth loading guard to remaining year-gated hooks | bug |
| 479 | Expose `respect_locks` toggle in solver run UI | feature |
| 468 | Extract `useClickOutside` hook from duplicated pattern | refactor |
| 461 | Remove redundant double `cy.resize()` in expanded mode | refactor |
| 440 | Extract repeated gender-by-grade data mapping in RegistrationOverview | refactor |
| 436 | Add accessible group labels to MetricsSessionSelector | a11y |
| 377 | Enable `erasableSyntaxOnly` in tsconfig after migrating enums | tech-debt |

**Interplay:** #479 pairs with solver #483 (Group 6). #531 is a follow-on from Group 1's #512 fix — same auth guard pattern applied to remaining hooks.

---

## Group 9: API / Backend Refactors (Python)

**Priority: Low** — DRY improvements, no behavior change

| # | Title | Type |
|---|-------|------|
| 487 | Extract shared session resolution function | refactor |
| 486 | Extract PocketBase collection names into constants | tech-debt |
| 473 | Replace inline date parsing with `_parse_date_only` utility | refactor |
| 441 | Use existing `build_ag_parent_map` utility in registration service | refactor |
| 423 | Hoist inline ForecastService imports in metrics.py | refactor |

**Interplay:** #486 is foundational — makes other refactors safer. Good for parallel agents.

---

## Group 10: Tests & Docs

**Priority: Low** — No behavior change, can be sprinkled in anytime

| # | Title | Type |
|---|-------|------|
| 528 | Align hadolint CI with local `.hadolint.yaml` config | ci |
| 495 | Migrate `logging.getLogger` to `get_logger` | chore |
| 485 | Scope module-level env var overrides to fixtures | test |
| 442 | Extract shared mock factory functions to conftest | test |
| 435 | Add missing docstrings for duration parameter | docs |
| 421 | Improve docstring coverage in forecast and metrics modules | docs |

---

## Suggested Attack Order

1. ~~**Group 1**~~ — ✅ Complete (PR #530)
2. **Group 7** — Geo frontend leftovers (#520 is a real bug, rest are small)
3. **Group 5** — Sync bugs *(in progress)* — #484 is data integrity
4. **Group 6** — Solver *(in progress)* — #500 is forward-compat risk
5. **Group 2** — Velocity backend (bigger scope, #456 correctness bug first)
6. **Group 9** — API refactors (low-risk DRY, good for parallel agents)
7. **Group 3** — Velocity frontend refactors (after Groups 1 & 2 stabilize)
8. **Groups 4, 8, 10** — Independent items, sprinkle in anytime

## Completed Groups

| Group | PR | Date | Notes |
|-------|-----|------|-------|
| Geo normalization bugs (#425-429, #462-466, #469) | #513 | 2026-03-13 | Opened #517-521 during cleanup |
| Git hooks consolidation | #524 | 2026-03-13 | — |
| Group 1: Velocity frontend bugs (#510, #511, #512) | #530 | 2026-03-13 | Spawned #531 (auth guard for remaining hooks) |
| Stale sync issues (#471, #497, #517) | — | 2026-03-13 | Closed as already fixed |
