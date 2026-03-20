# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-19 (13 open issues; #687, #625, #708, #703, #707 closed this session).

---

## Group 22: Frontend Test Fixes

**Priority: Medium** — CI-adjacent, from PR #714 code review

| # | Title | Type |
|---|-------|------|
| 720 | Replace dynamic imports with static imports in chart test files | test |
| 721 | Move dynamic import out of it.each body in retention chart tests | test |

**Interplay:** #721 is a subset of #720 — fixing #720 may resolve #721 too. Both relate to vitest + dynamic `import()` patterns in metrics chart tests.

---

## Group 23: Frontend Tech Debt (Query Keys & Hooks)

**Priority: Low** — No behavior change, cleanup tasks

| # | Title | Type |
|---|-------|------|
| 604 | Leverage recharts 3.8 typed generics, niceTicks, and coordinate hooks | enhancement |
| 697 | Switch pocketbase-typegen back to upstream once --use-const is merged | chore |
| 715 | Migrate hardcoded query keys in invalidateSyncData to centralized queryKeys | tech-debt |
| 717 | Create createSyncMutation factory to unify sync hook boilerplate | tech-debt |

**Interplay:** #697 blocked on upstream merge. #715 is a natural extension of merged PR #711. #717 is independent refactoring. #604 needs design decisions.

---

## Group 24: API Tech Debt (Metrics)

**Priority: Low** — Code quality, no behavior change

| # | Title | Type |
|---|-------|------|
| 716 | Reduce duplication and inefficiency in velocity_service daily data building | tech-debt |
| 718 | Deduplicate fetch_attendees_with_dates expand_person branches | tech-debt |

**Interplay:** Independent items. #716 covers N+1 reconstruct_daily, snapshot daily duplication, and strptime redundancy. #718 is a standalone SQL method cleanup.

---

## Group 4: Metrics — Standalone Features

**Priority: Low** — Standalone feature enhancements, no blockers

| # | Title | Type |
|---|-------|------|
| 453 | Promote geo overrides to static canonical data | feature |
| 699 | Flip cancellation graph to positive Y-axis | enhancement |

**Interplay:** Independent items. #699 needs UX clarification on what "positive" means.

---

## Needs User Input

| # | Title | Question |
|---|-------|----------|
| 705 | OIDC login hook silently drops save failures | Errors ARE logged; hook continues via `e.Next()`. By design or bug? |
| 699 | Flip cancellation Y-axis | What does "positive" mean here? |

---

## Blocked

| # | Title | Blocked on |
|---|-------|------------|
| 697 | Switch pocketbase-typegen to upstream | External upstream merge of --use-const flag |
| 719 | Remove is_active from validate_migrations.py | PB schema migration to drop attendees.is_active column |

---

## Suggested Attack Order

1–21. ~~**Groups 1–21**~~ — All complete (see git history)
22. **Group 22** (Test fixes) — Medium priority, quick wins
23. **Groups 23, 24, 4** — Low priority, independent items, sprinkle in anytime

## Completed Groups (recent)

See git history for full completion log (Groups 1–16, scripts, Vite 8, etc.).

| Group | PR | Date | Notes |
|-------|-----|------|-------|
| Group 16: Waitlist & session availability | #622 | 2026-03-17 | #593 closed (not-a-bug → #620); spawned #624, #625 |
| Group 17: Solver pipeline optimization (#615) | #635 | 2026-03-18 | Phase skipping for direct-mapped socialize requests |
| Group 19: Sync bugs (#639, #642) | #644 | 2026-03-18 | Mutex race + force+limit over-clear; spawned #645 |
| Standalone: #648 duplicate React key | #651 | 2026-03-18 | TOC value '1'→'toc' + dedup in ProcessRequestOptions |
| Standalone: #619, #654, #658 tech-debt | #660 | 2026-03-18 | eslint-disables, derived configId, expand null-safety |
| Group 8: Frontend blocked tech debt (#377) | #692 | 2026-03-19 | erasableSyntaxOnly via as-const typegen |
| Group 14: Metrics hook API (#567, #562) | #671+ | 2026-03-19 | Mutual exclusivity + hook migration evaluation |
| Bulk close: #594, #620–#630, #640, #641, #653, #623 | Multiple | 2026-03-19 | 14 issues resolved across Groups 15, 18, and standalone |
| Group 18: API Tech Debt (#625) | #704 | 2026-03-19 | Expand extraction standardized via shared utility |
| Group 20: Metrics bugs (#708) | #713 | 2026-03-19 | Per-session daily merge + schema fix |
| Group 21: Auth/frontend fixes (#703, #687) | #710, #711 | 2026-03-19 | FeedbackModal auth gate + queryKeys centralization |
| is_active cleanup (#620 remnants) | #712 | 2026-03-19 | Test filters, SQL cleanup, docs updated |
| Test pruning phase 3 | #714 | 2026-03-19 | Parametrize and consolidate medium/low findings |
