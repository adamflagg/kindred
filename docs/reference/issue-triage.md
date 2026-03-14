# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-14 (6 open issues, all verified against current code; #576 opened during review).

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

## Group 14: Metrics Hook API Design

**Priority: Low** — Enhancement, no blockers

| # | Title | Type |
|---|-------|------|
| 567 | Enforce mutual exclusivity of `sessionCmId` and `duration` in MetricsFilterOptions | enhancement |
| 562 | Evaluate migrating all metrics hooks to full options objects | enhancement |

**Interplay:** Both spawned from Group 3 (PR #566). #567 is a concrete fix — `MetricsFilterOptions` still allows both `sessionCmId` and `duration` with zero validation. #562: most hooks now use hybrid `(year, options)` pattern; `useComparisonMetrics` is the remaining outlier. Address #567 first, then evaluate #562.

---

## Group 15: ESLint Follow-Up Tech Debt

**Priority: Low** — No behavior change, cleanup from ESLint overhaul (PR #572)

| # | Title | Type |
|---|-------|------|
| 573 | Audit 57 `eslint-disable` comments added in ESLint cleanup for proper type fixes | tech-debt |

**Interplay:** Spawned from PR #572 (~320 ESLint warnings fixed). #571 resolved by PR #575 (all 58 design-decision warnings fixed). #573 remains: actual eslint-disable count is 111 (not 57 as originally estimated), with ~54 being `@typescript-eslint` rules — 76 audited and confirmed appropriate in PR #575, deeper type refactor needed to remove `as` cast patterns.

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
9. ~~**Group 12**~~ — ✅ Complete (PR #561)
10. ~~**Group 13**~~ — ✅ Complete (PR #563) — #559 fixed; #560 closed as stale
11. ~~**Group 3**~~ — ✅ Complete (PR #566) — #437, #472; spawned #562, #567
12. ~~**Group 10**~~ — ✅ Complete (PRs #564, #565, #568, #569, #570, #572) — All 8 issues closed; spawned #571, #573
13. ~~**Group 15 (1/2)**~~ — ✅ Complete (PR #575) — #571 resolved (58 warnings); #573 remains (eslint-disable audit)
14. **Groups 4, 8, 14, 15** — Independent items, sprinkle in anytime

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
| Group 3: Velocity frontend refactors (#437, #472) | #566 | 2026-03-14 | Spawned #562 (full-options eval), #567 (mutual exclusivity) |
| Group 10: Tests & docs (#536, #528, #485, #442, #552, #435, #495, #421) | #564, #565, #568, #569, #570, #572 | 2026-03-14 | All 8 issues closed; ESLint cleanup (885 warnings fixed); spawned #571, #573 |
| Group 15 (1/2): ESLint design decisions (#571) | #575 | 2026-03-14 | 58 warnings resolved with per-case design decisions; #573 remains; spawned #576 (GradeEligibility threshold bug) |
