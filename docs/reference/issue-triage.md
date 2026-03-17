# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-16 (14 open issues; Group 15 completed via PR #618).

---

## Group 18: API Data Integrity Bugs

**Priority: High** — Active bugs affecting data correctness

| # | Title | Type |
|---|-------|------|
| 592 | `_normalize_gender_key` silently defaults unknown gender to "M" | bug |
| 593 | List-based `status_filter` in MetricsRepository doesn't filter by `is_active` | bug |
| 589 | Session availability router uses `HTTPException(500)` instead of global handler | bug |

**Interplay:** All three are in the session availability / metrics API layer. #592 and #593 affect data correctness (gender miscounting, inactive attendees leaking through). #589 is a convention violation (leaks error details to client). All confirmed present in current code. Can be fixed in a single PR.

---

## Group 17: Waitlist API

**Priority: Medium** — Bug + refactor + perf, all in waitlist drilldown

| # | Title | Type |
|---|-------|------|
| 595 | Waitlist drilldown "Waitlisted For" column includes non-summer sessions | bug |
| 596 | `waitlist_session_gender` drilldown ignores `session_types` parameter | refactor |
| 597 | Consolidate `_count_enrollment` and `_build_waitlist_data` into single pass | perf |

**Interplay:** #596 confirmed — `_handle_waitlist_session_gender()` accepts `_session_types` but hardcodes `SUMMER_SESSION_TYPES` instead. #597 confirmed — two separate passes over the same attendees list in `session_availability_service.py`. #595 may be stale — code has comments suggesting current behavior is intentional ("shows all sessions a person is waitlisted for, not just the one clicked"); needs re-evaluation before fixing.

---

## Group 4: Metrics — Standalone Features

**Priority: Low** — Standalone features, no blockers

| # | Title | Type |
|---|-------|------|
| 453 | Promote geo overrides to static canonical data | feature |
| 604 | Leverage recharts 3.8 typed generics, `niceTicks`, and coordinate hooks | enhancement |

**Interplay:** Independent items. #604 spawned from deps bump PR #601 (recharts 3.7→3.8). High-value item: `niceTicks` could replace custom `getNiceTicks()` in `cssChartUtils.ts`; typed generics add compile-time safety to chart components.

---

## Group 8: Frontend — Remaining Tech Debt

**Priority: Low** — Mix of blocked and unblocked items

| # | Title | Type |
|---|-------|------|
| 377 | Enable `erasableSyntaxOnly` in tsconfig after migrating enums | tech-debt |
| 576 | Reset stale `thresholdId` when no threshold record exists for current year | tech-debt |
| 594 | Migrate SessionAvailability to QueryGuard pattern | refactor |
| 619 | Remove 4 remaining defensive eslint-disable comments | tech-debt |

**Interplay:** #377 blocked on `pocketbase-typegen` fork update (also noted to fix `ExpandType` for 4 more eslint-disables). #576 confirmed — `GradeEligibilityConfig.tsx` never resets `thresholdId` when `thresholdRecords` is empty, causing stale updates to non-existent records on year switch. #594 confirmed — `SessionAvailability.tsx` still uses inline loading/error handling while all other metrics pages use `MetricsQueryGuard`. #619 spawned from #573 audit — 4 defensive eslint-disables (3 syncStatus, 1 week_number) removable with minor type fixes (~45 min). #576, #594, and #619 are unblocked quick wins.

---

## Group 14: Metrics Hook API Design

**Priority: Low** — Enhancement, no blockers

| # | Title | Type |
|---|-------|------|
| 567 | Enforce mutual exclusivity of `sessionCmId` and `duration` in MetricsFilterOptions | enhancement |
| 562 | Evaluate migrating all metrics hooks to full options objects | enhancement |

**Interplay:** Both spawned from Group 3 (PR #566). #567 is a concrete fix — `MetricsFilterOptions` still allows both `sessionCmId` and `duration` with zero validation. #562: most hooks now use hybrid `(year, options)` pattern; `useComparisonMetrics` is the remaining outlier. Address #567 first, then evaluate #562.

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
14. ~~**Group 16**~~ — ✅ Complete (PR #613) — #612 fixed; #609, #608 already verified; #610 upstream; #607, #606 not yet available
15. ~~**Group 15 (2/2)**~~ — ✅ Complete (PR #618) — #573 resolved (46 removed, 16 kept); spawned #619
16. **Group 18** — API data integrity bugs (#589, #592, #593) — highest priority, active bugs
17. **Group 17** — Waitlist API (#595, #596, #597) — bug + refactor + perf
18. **Groups 4, 8, 14** — Independent items, sprinkle in anytime

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
| Scripts consolidation (#581-#586) | #605 | 2026-03-16 | All 6 issues closed |
| Quest availability fix (#580) | #605 | 2026-03-16 | Gender-split rendering fix |
| Group 16: Vite 8 follow-up (#606-#612) | #613 | 2026-03-16 | #612 fixed; #609, #608 already done; #610 upstream; #607, #606 not available yet |
| Group 15 (2/2): ESLint-disable audit (#573) | #618 | 2026-03-16 | 46 removed, 16 kept (justified); spawned #619 (4 remaining defensive guards) |
