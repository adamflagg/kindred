# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-19 (4 open issues; 14 issues closed since last triage).

---

## Group 4: Metrics — Standalone Feature

**Priority: Low** — Standalone feature, no blockers

| # | Title | Type |
|---|-------|------|
| 453 | Promote geo overrides to static canonical data | feature |

**Interplay:** None. Standalone geo normalization enhancement.

---

## Group 15: Frontend Tech Debt (Remaining)

**Priority: Low** — No behavior change, cleanup tasks

| # | Title | Type |
|---|-------|------|
| 604 | Leverage recharts 3.8 typed generics, niceTicks, and coordinate hooks | enhancement |
| 687 | Use centralized queryKeys in useSyncStatusAPI | tech-debt |

**Interplay:** #604: recharts 3.8 now installed — ready for implementation. #687: hardcoded `['sync-status-api']` queryKey in `useSyncStatusAPI.ts:105` should use centralized `queryKeys.syncStatus()`. Note cache key changes from `sync-status-api` to `sync-status` — verify no consumers depend on the old key.

---

## Group 18: API Tech Debt (Remaining)

**Priority: Low** — Code quality, no behavior change

| # | Title | Type |
|---|-------|------|
| 625 | Replace hand-rolled session/person expand extraction with `get_session_from_expand` utility | tech-debt |

**Interplay:** Utility adopted in drilldown_service (9 usages) but 10+ hand-rolled `expand.get("session")` patterns remain alongside it.

---

## Suggested Attack Order

1–20. ~~**Groups 1–19**~~ — All complete (see git history)
21. **Groups 4, 15, 18** — All low priority, independent items, sprinkle in anytime

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
