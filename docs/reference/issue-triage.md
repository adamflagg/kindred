# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-20 (2 open issues; #728 closed by PR #731, #453 closed by PR #729).

---

## Remaining Open Issues

### Frontend Tech Debt (Remnants of Group 23)

**Priority: Low** — No behavior change, cleanup/upstream tasks

| # | Title | Type | Status |
|---|-------|------|--------|
| 604 | Leverage recharts 3.8 typed generics, niceTicks, and coordinate hooks | enhancement | Needs design decisions |
| 697 | Switch pocketbase-typegen back to upstream once --use-const is merged | chore | Blocked on upstream |

**Interplay:** Independent. #697 blocked externally. #604 needs design decisions on which recharts 3.8 APIs to adopt.

---

## Blocked

| # | Title | Blocked on |
|---|-------|------------|
| 697 | Switch pocketbase-typegen to upstream | External upstream merge of --use-const flag |

---

## Suggested Attack Order

1–24. ~~**Groups 1–24**~~ — All complete (see completed groups below)
25. **#604** — Low priority, needs design decisions on recharts 3.8 API adoption
26. **#697** — Blocked on upstream `--use-const` merge

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
| Group 22: Frontend Test Fixes (#720, #721) | #725 | 2026-03-19 | Static imports in chart tests + sibling cleanup |
| Group 23: Frontend Tech Debt (#715, #717) | #727 | 2026-03-19 | Query key centralization + sync mutation factory |
| Group 24: API Tech Debt (#716, #718) | #726 | 2026-03-19 | Single-pass daily reconstruction + SQL dedup |
| Standalone: #699 cancel velocity positive | #724 | 2026-03-19 | Weekly cancelled as positive values in delta chart |
| Standalone: #705 OIDC hook save failures | — | 2026-03-19 | Closed as won't-fix (single admin, low risk) |
| Standalone: #453 geo overrides promotion | #729 | 2026-03-20 | Carry forward geo overrides across years |
| Standalone: #728 remove reconstruct_daily | #731 | 2026-03-20 | Deleted dead code, kept only reconstruct_daily_multi |
