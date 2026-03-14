# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-14 (12 open issues).

---

## Group 3: Metrics / Velocity — Frontend Refactors

**Priority: Medium** — Groups 1 & 2 are complete; this is now unblocked

| # | Title | Type |
|---|-------|------|
| 437 | Migrate metrics hooks from positional params to options objects | refactor |
| 472 | Extract shared hooks/components from VelocityPage and CancellationVelocityPage | refactor |

**Interplay:** #437 simplifies hook signatures that #472 then consolidates. Do #437 → #472. (#478 completed in Group 2 PR2.)

---

## Group 4: Metrics — Standalone Feature

**Priority: Low** — Standalone feature, no blockers

| # | Title | Type |
|---|-------|------|
| 453 | Promote geo overrides to static canonical data | feature |

**Interplay:** None remaining. (#445 closed.)

---

## Group 8: Frontend — Remaining Tech Debt

**Priority: Low** — Blocked on external fork update

| # | Title | Type |
|---|-------|------|
| 377 | Enable `erasableSyntaxOnly` in tsconfig after migrating enums | tech-debt |

**Interplay:** Requires updating `pocketbase-typegen` fork to emit `as const` objects instead of enums (19 enums, 0 consumer code changes). Plan exists at `docs/plans/2026-03-13-enum-migration.md`.

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
| 552 | `_validate_requests` docstring omits missing-target impossible case | docs |
| 435 | Add missing docstrings for duration parameter | docs |
| 421 | Improve docstring coverage in forecast and metrics modules | docs |

---

## Suggested Attack Order

1. ~~**Group 1**~~ — ✅ Complete (PR #530)
2. ~~**Group 7**~~ — ✅ Complete (PR #539)
3. ~~**Group 5**~~ — ✅ Complete (PRs #540, #544)
4. ~~**Group 6**~~ — ✅ Complete (PR #534)
5. ~~**Group 2**~~ — ✅ Complete (PRs #548, #554) — PR1: #456, #467, #460; PR2: #474, #475, #459, #550; #447 dropped
6. ~~**Group 9**~~ — ✅ Complete (PR #549)
7. ~~**Group 11**~~ — ✅ Complete (PR #551)
8. ~~**Group 8 (7/8)**~~ — ✅ Complete (PRs #555, #556, #557) — #377 remains (blocked on fork)
8. ~~**Group 12**~~ — ✅ Complete (PR #561)
9. ~~**Group 13**~~ — ✅ Complete (PR #563) — #559 fixed; #560 closed as stale
10. **Group 3** — Velocity frontend refactors (now unblocked)
11. **Groups 4, 8, 10** — Independent items, sprinkle in anytime

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
| Group 2 PR1: Velocity backend (#456, #467, #460) | #548 | 2026-03-13 | #447 dropped (not needed); spawned #550 |
| Group 11: Solver scoring bug (#546) | #551 | 2026-03-13 | Added SOURCE_FIELD_TO_CONFIG_KEY reverse mapping |
| Group 2 PR2: Velocity perf + feature (#474, #475, #459, #550) | #554 | 2026-03-13 | Completes Group 2 |
| Stale issues (#478, #445) | — | 2026-03-13 | Closed — already fixed in prior work |
| Group 8 (7/8): Frontend quick wins (#531, #537, #479, #468, #461, #440, #436) | #555, #556, #557 | 2026-03-13 | #377 remains (blocked on pocketbase-typegen fork); spawned #559, #560 |
| Group 12: Solver normalize_source_field bug (#553) | #561 | 2026-03-14 | Derived mappings from canonical SourceField constants |
| Group 13: Frontend auth & state gaps (#559, #560) | #563 | 2026-03-14 | #559 fixed; #560 closed as stale |
