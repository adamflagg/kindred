# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-13 (28 open issues).

---

## Group 2: Metrics / Velocity — Backend (Python API) *(in progress)*

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

## Group 8: Frontend — General Refactors & Quality

**Priority: Low** — Independent quick wins

| # | Title | Type |
|---|-------|------|
| 531 | Add auth loading guard to remaining year-gated hooks | bug |
| 537 | Add `ag` key to `ValidationResult.capacity_breakdown` type | bug |
| 479 | Expose `respect_locks` toggle in solver run UI | feature |
| 468 | Extract `useClickOutside` hook from duplicated pattern | refactor |
| 461 | Remove redundant double `cy.resize()` in expanded mode | refactor |
| 440 | Extract repeated gender-by-grade data mapping in RegistrationOverview | refactor |
| 436 | Add accessible group labels to MetricsSessionSelector | a11y |
| 377 | Enable `erasableSyntaxOnly` in tsconfig after migrating enums | tech-debt |

**Interplay:** #479 now requires re-adding `respect_locks` parameter (removed in PR #534) with proper UI wiring. #531 is a follow-on from Group 1's #512 fix. #537 is a type gap between backend and frontend.

---

## Group 11: Solver Scoring Bug

**Priority: Medium** — Silent correctness issue in solver weighting

| # | Title | Type |
|---|-------|------|
| 546 | Solver stat/multiplier lookups use snake_case keys against canonical source_field values | bug |

**Context:** Pre-existing bug surfaced during #504 review. `solution.py`, `score_evaluator.py`, `direct_solver.py` use snake_case keys that never match canonical `SourceField` values — field stats are always zero and multipliers always default to 1.0.

---

## Group 10: Tests & Docs

**Priority: Low** — No behavior change, can be sprinkled in anytime

| # | Title | Type |
|---|-------|------|
| 536 | Replace John Doe/Jane Smith with fictional name list in solver conftest | test |
| 528 | Align hadolint CI with local `.hadolint.yaml` config | ci |
| 495 | Migrate `logging.getLogger` to `get_logger` | chore |
| 485 | Scope module-level env var overrides to fixtures | test |
| 442 | Extract shared mock factory functions to conftest | test |
| 435 | Add missing docstrings for duration parameter | docs |
| 421 | Improve docstring coverage in forecast and metrics modules | docs |

---

## Suggested Attack Order

1. ~~**Group 1**~~ — ✅ Complete (PR #530)
2. ~~**Group 7**~~ — ✅ Complete (PR #539)
3. ~~**Group 5**~~ — ✅ Complete (PRs #540, #544)
4. ~~**Group 6**~~ — ✅ Complete (PR #534)
5. **Group 2** — Velocity backend *(in progress)* — #456 correctness bug first
6. ~~**Group 9**~~ — ✅ Complete (PR #549)
7. **Group 11** — Solver scoring bug (#546) — silent correctness issue
8. **Group 3** — Velocity frontend refactors (after Groups 1 & 2 stabilize)
9. **Groups 4, 8, 10** — Independent items, sprinkle in anytime

## Completed Groups

| Group | PR | Date | Notes |
|-------|-----|------|-------|
| Geo normalization bugs (#425-429, #462-466, #469) | #513 | 2026-03-13 | Opened #517-521 during cleanup |
| Git hooks consolidation | #524 | 2026-03-13 | — |
| Group 1: Velocity frontend bugs (#510, #511, #512) | #530 | 2026-03-13 | Spawned #531 (auth guard for remaining hooks) |
| Stale sync issues (#471, #497, #517) | — | 2026-03-13 | Closed as already fixed |
| Group 6: Solver (#500, #493, #494, #483) | #534 | 2026-03-13 | Spawned #535, #536, #537 during review |
| Group 7: Geo frontend (#518, #519, #520, #521) | #539 | 2026-03-13 | Bug + a11y + test + QueryGuard migration |
| Group 5: Sync / Go backend (#484, #504) | #540, #544 | 2026-03-13 | Spawned #546 (solver snake_case lookup bug) |
| Group 9: API backend refactors (#535, #486, #441, #473, #423, #487) | #549 | 2026-03-13 | #546 moved to Group 11 |
