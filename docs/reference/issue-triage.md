# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-03-19 (5 open issues; bulk sprint closed #699, #705, #715, #716, #717, #718, #720, #721).

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

### Metrics — Standalone Features (Remnant of Group 4)

**Priority: Low** — Standalone feature enhancement

| # | Title | Type |
|---|-------|------|
| 453 | Promote geo overrides to static canonical data | feature |

---

### API Tech Debt (New)

**Priority: Low** — Follow-up refactoring

| # | Title | Type |
|---|-------|------|
| 728 | Make reconstruct_daily a thin wrapper around reconstruct_daily_multi | tech-debt |

**Context:** Spawned from shrink-it review of PR #726. Currently blocked on confidence that `reconstruct_daily_multi` is correct (test oracle pattern uses independent `reconstruct_daily` implementation for validation).

---

## Blocked

| # | Title | Blocked on |
|---|-------|------------|
| 697 | Switch pocketbase-typegen to upstream | External upstream merge of --use-const flag |
| 719 | Remove is_active from validate_migrations.py | PB schema migration to drop attendees.is_active column |

---

## Suggested Attack Order

1–24. ~~**Groups 1–24**~~ — All complete (see completed groups below)
25. **#453, #604** — Low priority standalone items, sprinkle in anytime
26. **#728** — Low priority, wait for `reconstruct_daily_multi` to prove itself

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
