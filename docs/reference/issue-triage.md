# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-18 (18 open issues; #616/#617 fixed by PR #652, spawned #654).

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
| 619 | Remove 4 remaining defensive eslint-disable comments | tech-debt |
| 623 | Gate authenticated query hooks on auth loading state | enhancement |
| 640 | Extract shared ProfileRow component in User.tsx | refactor |
| 641 | Users list date columns need headers and consistent layout | ux |
| 654 | Eliminate derived `configId` state in GradeEligibilityConfig rows | tech-debt |

**Interplay:** #573 resolved by PR #618 (46 removed, 16 kept); #619 spawned from that audit — 4 defensive eslint-disables (3 syncStatus, 1 week_number) removable with minor type fixes. #594 is a standalone QueryGuard migration. #616 and #617 fixed by PR #652 — spawned #654 (same derived-state pattern for `configId` in rows). #604: recharts 3.8 now installed — no longer blocked, ready for implementation. #623: 11 hooks still ungated (camper detail/session views) — partially complete but not closeable. #640 and #641 are both Users page improvements — #640 extracts a reusable ProfileRow, #641 fixes date column headers/layout.

---

## Group 18: API Tech Debt

**Priority: Low** — Code quality, no behavior change

| # | Title | Type |
|---|-------|------|
| 620 | Remove redundant `is_active` field, standardize on `status_id` for attendee filtering | tech-debt |
| 624 | Extract duplicated `enrolled_attendee_groups` construction in drilldown_service | tech-debt |
| 625 | Replace hand-rolled session/person expand extraction with `get_session_from_expand` utility | tech-debt |
| 626 | Extract shared `_build_parsed_intent()` helper in debug.py | tech-debt |
| 628 | Add year parameter bounds validation across all API endpoints | enhancement |
| 629 | Use collection name constants instead of string literals in API routers | enhancement |
| 630 | Extract shared constant for active-enrolled attendee filter fragment | enhancement |

**Interplay:** #620 spawned from Group 16 investigation (#593 closed as not-a-bug). #624 and #625 spawned from PR #622 simplify review. #626 spawned from PR #635 — debug.py has duplicated parsed-intent construction (5+ identical loops). #628, #629, #630 are all API hardening/consistency issues. #645 closed — fixed in commit a0239fbc. #625 partially adopted (used in session_swap, waitlist_service, session_metrics) but drilldown_service still has hand-rolled extraction. #630 and #620 overlap — both touch attendee filtering patterns.

---

## Suggested Attack Order

1–20. ~~**Groups 1–19**~~ — All complete (see git history)
21. **Groups 4, 8, 14, 15, 18** — All low priority, independent items, sprinkle in anytime

## Completed Groups (recent)

See git history for full completion log (Groups 1–16, scripts, Vite 8, etc.).

| Group | PR | Date | Notes |
|-------|-----|------|-------|
| Group 16: Waitlist & session availability | #622 | 2026-03-17 | #593 closed (not-a-bug → #620); spawned #624, #625 |
| Group 17: Solver pipeline optimization (#615) | #635 | 2026-03-18 | Phase skipping for direct-mapped socialize requests |
| Group 19: Sync bugs (#639, #642) | #644 | 2026-03-18 | Mutex race + force+limit over-clear; spawned #645 |
| Standalone: #648 duplicate React key | #651 | 2026-03-18 | TOC value '1'→'toc' + dedup in ProcessRequestOptions |
