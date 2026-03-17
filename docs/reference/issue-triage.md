# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-17 (13 open issues; Groups 15–16 completed via PRs #614, #618, #622).

---

## Group 4: Metrics — Standalone Feature

**Priority: Low** — Standalone feature, no blockers

| # | Title | Type |
|---|-------|------|
| 453 | Promote geo overrides to static canonical data | feature |

**Interplay:** None remaining. (#445 closed.)

---

## Group 8: Frontend — Blocked Tech Debt

**Priority: Low** — Blocked on external fork update

| # | Title | Type |
|---|-------|------|
| 377 | Enable `erasableSyntaxOnly` in tsconfig after migrating enums | tech-debt |

**Interplay:** Requires updating `pocketbase-typegen` fork to emit `as const` objects instead of enums (19 enums, 0 consumer code changes). Also noted to fix `ExpandType` for 4 more eslint-disables.

---

## Group 14: Metrics Hook API Design

**Priority: Low** — Enhancement, no blockers

| # | Title | Type |
|---|-------|------|
| 567 | Enforce mutual exclusivity of `sessionCmId` and `duration` in MetricsFilterOptions | enhancement |
| 562 | Evaluate migrating all metrics hooks to full options objects | enhancement |

**Interplay:** Both spawned from Group 3 (PR #566). #567 is a concrete fix — `MetricsFilterOptions` still allows both `sessionCmId` and `duration` with zero validation. #562: most hooks now use hybrid `(year, options)` pattern; `useComparisonMetrics` is the remaining outlier. Address #567 first, then evaluate #562.

---

## Group 15: ESLint & Frontend Tech Debt

**Priority: Low** — No behavior change, cleanup tasks

| # | Title | Type |
|---|-------|------|
| 594 | Migrate `SessionAvailability` to QueryGuard pattern | tech-debt |
| 604 | Leverage recharts 3.8 typed generics, niceTicks, and coordinate hooks | enhancement |
| 616 | Eliminate derived `thresholdId` state in GradeEligibilityConfig | tech-debt |
| 617 | Memoize `hasChanges` in GradeEligibilityConfig | tech-debt |
| 619 | Remove 4 remaining defensive eslint-disable comments | tech-debt |

**Interplay:** #573 resolved by PR #618 (46 removed, 16 kept); #619 spawned from that audit — 4 defensive eslint-disables (3 syncStatus, 1 week_number) removable with minor type fixes. #594 is a standalone QueryGuard migration. #616 and #617 spawned from PR #614 review — #616 eliminates the derived-state anti-pattern that caused #576; #617 optimizes per-render `buildRows` calls. #604 depends on recharts 3.8 release.

---

## Group 17: Solver Pipeline Optimization

**Priority: Low** — Performance enhancement, no correctness impact

| # | Title | Type |
|---|-------|------|
| 615 | Skip unnecessary phases for direct-mapped socialize dropdown requests | enhancement |

**Interplay:** Standalone solver optimization. Direct-mapped socialize requests currently flow through Phase 2 (Resolution), Expansion, and Historical Verification despite needing none of them. Only Phase 3 is already skipped. Affects pipeline debug visualization (phases show green/"ran" instead of grey/"skipped").

---

## Group 18: API Tech Debt

**Priority: Low** — Code quality, no behavior change

| # | Title | Type |
|---|-------|------|
| 620 | Remove redundant `is_active` field, standardize on `status_id` for attendee filtering | tech-debt |
| 624 | Extract duplicated `enrolled_attendee_groups` construction in drilldown_service | tech-debt |
| 625 | Replace hand-rolled session/person expand extraction with `get_session_from_expand` utility | tech-debt |

**Interplay:** #620 spawned from Group 16 investigation (#593 closed as not-a-bug). #624 and #625 spawned from PR #622 simplify review. All are independent refactors. #625 is the largest (20+ locations) but mechanical.

---

## Suggested Attack Order

1–13. ~~**Groups 1–13**~~ — All complete (PRs #530–#572, 2026-03-13 to 2026-03-14)
14. ~~**Group 15 (1/3)**~~ — ✅ Complete (PR #575) — #571 resolved; spawned #576
15. ~~**Group 15 (2/3)**~~ — ✅ Complete (PR #614) — #576 fixed; spawned #616, #617
16. ~~**Vite 8 follow-up**~~ — ✅ Complete (PR #613) — #612 fixed; #609, #608 already done
17. ~~**Group 15 (3/3)**~~ — ✅ Complete (PR #618) — #573 resolved (46 removed, 16 kept); spawned #619
18. ~~**Group 16**~~ — ✅ Complete (PR #622) — #589, #592, #595, #596, #597; #593 closed (not-a-bug → #620); spawned #624, #625
19. **Groups 4, 8, 14, 15, 17, 18** — All low priority, independent items, sprinkle in anytime

## Completed Groups (recent)

Older completed groups (1–13, geo normalization, stale issues, etc.) omitted for brevity — see git history.

| Group | PR | Date | Notes |
|-------|-----|------|-------|
| Group 15 (1/3): ESLint design decisions (#571) | #575 | 2026-03-14 | 58 warnings resolved; spawned #576 |
| Group 15 (2/3): GradeEligibility threshold bug (#576) | #614 | 2026-03-16 | Stale thresholdId reset; spawned #616, #617 |
| Scripts consolidation (#581-#586) | #605 | 2026-03-16 | All 6 issues closed |
| Quest availability fix (#580) | #605 | 2026-03-16 | Gender-split rendering fix |
| Vite 8 follow-up (#606-#612) | #613 | 2026-03-16 | #612 fixed; #609, #608 already done; #610 upstream |
| Group 15 (3/3): ESLint-disable audit (#573) | #618 | 2026-03-16 | 46 removed, 16 kept; spawned #619 |
| Group 16: Waitlist & session availability (#589, #592, #595, #596, #597) | #622 | 2026-03-17 | #593 closed (not-a-bug → #620); spawned #624, #625 |
