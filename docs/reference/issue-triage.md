# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-04-03 (20 open issues, excluding 6 PR #823 follow-ups).

---

## Remaining Open Issues

### Group 25: Sync Fixes (#806, #807, #791)

**Priority: Medium** — One bug fix, two cleanup refactors

| # | Title | Type | Status |
|---|-------|------|--------|
| 806 | fix(sync): normalize session "0" → "all" in Go process-requests handler | bug | Ready — one-liner fix |
| 807 | refactor(sync): update session_resolver.go to use cm_ids instead of friendly names | enhancement | Ready |
| 791 | refactor(sync): extract shared generateRunToken helper | refactor | Ready |

**Interplay:** Independent. #806 is a trivial consistency fix (other endpoints already handle "0"). #807 and #791 are standalone refactors.

### Group 26: Solver Bugs & Performance (#788, #792, #809)

**Priority: Medium** — Trace correctness + query optimization

| # | Title | Type | Status |
|---|-------|------|--------|
| 788 | fix(solver): dedup trace key collision — (requester_cm_id, target_name) can match both kept and removed requests | bug | Ready — trace-only impact |
| 792 | perf(solver): cache PersonRepository.bulk_find_by_cm_ids to avoid redundant DB fetches | performance | Ready |
| 809 | perf(solver): skip get_related_session_ids query for embedded sessions | performance | Ready |

**Interplay:** Independent. #788 is trace-correctness only (no impact on actual bunk requests). #792 and #809 are independent perf optimizations.

### Group 27: Solver Logging Cleanup (#787, #815)

**Priority: Low** — Log level adjustments

| # | Title | Type | Status |
|---|-------|------|--------|
| 787 | fix(solver): move camper name/ID logging from INFO to DEBUG | cleanup | Ready |
| 815 | fix(solver): move AI prompt/response text from DEBUG to TRACE | cleanup | Ready |

**Interplay:** Independent. Both are log-level changes, no functional impact.

### Group 28: Metrics Tech Debt (#770, #771, #772, #773)

**Priority: Low** — Date-stripping deduplication and helper extraction

| # | Title | Type | Status |
|---|-------|------|--------|
| 770 | refactor(metrics): make _get_enrollment_date public across modules | tech-debt | Ready |
| 771 | refactor(metrics): replace 13 inline date-stripping patterns with parse_date_only in velocity_service.py | tech-debt | Ready |
| 772 | refactor(metrics): replace inline date-stripping in session_metrics.py with parse_date_only | tech-debt | Ready |
| 773 | refactor(metrics): extract shared bucket-write helper in reconstruct_daily_multi | tech-debt | Ready |

**Interplay:** #770 should land first (makes helper public), then #771/#772 consume it. #773 is independent.

### Group 29: Frontend Cleanup (#796, #797, #798, #808, #810)

**Priority: Low** — Dead code removal, deduplication, config updates

| # | Title | Type | Status |
|---|-------|------|--------|
| 796 | chore(frontend): remove localStorage program migration shim | cleanup | Ready |
| 797 | chore(frontend): clean up dead export getAnalyticsUrl and inconsistent trailing-slash handling | cleanup | Ready |
| 798 | refactor(frontend): data-drive program switcher buttons in AppLayout | refactor | Ready |
| 808 | refactor(frontend): deduplicate SOURCE_FIELD_OPTIONS and fieldLabels | cleanup | Ready |
| 810 | cleanup(frontend): update SESSION_NAME_TO_URL for Taste of Camp 1/2 | cleanup | Ready |

**Interplay:** Independent. All are safe standalone changes.

### Standalone Issues

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 754 | feat(solver): support manual pairing of AG cabins across years | enhancement | Medium | Needs design decisions |
| 801 | fix(ci): add explicit --platform linux/amd64 to CD docker buildx build | bug | Low | Ready — no functional impact today |

### Frontend Tech Debt (Remnants of Group 23)

**Priority: Low** — No behavior change, cleanup/upstream tasks

| # | Title | Type | Status |
|---|-------|------|--------|
| 604 | Leverage recharts 3.8 typed generics, niceTicks, and coordinate hooks | enhancement | Needs design decisions |
| 697 | Switch pocketbase-typegen back to upstream once --use-const is merged | chore | Blocked on upstream |

**Interplay:** Independent. #697 blocked externally. #604 needs design decisions on which recharts 3.8 APIs to adopt.

---

## Excluded from Triage

| # | Reason |
|---|--------|
| 824–829 | Follow-ups from PR #823 (scoring reform phase 2) — triaged separately |

---

## Blocked

| # | Title | Blocked on |
|---|-------|------------|
| 697 | Switch pocketbase-typegen to upstream | External upstream merge of --use-const flag |

---

## Suggested Attack Order

1–24. ~~**Groups 1–24**~~ — All complete (see completed groups below)
25. **Group 25** (#806, #807, #791) — Sync fixes, includes a bug
26. **Group 26** (#788, #792, #809) — Solver trace bug + perf wins
27. **#754** — AG cabin pairing feature (needs design)
28. **Group 27** (#787, #815) — Solver log cleanup, quick
29. **Group 28** (#770–773) — Metrics date-stripping dedup (do #770 first)
30. **Group 29** (#796–798, #808, #810) — Frontend cleanup batch
31. **#801** — CI platform flag, low priority
32. **#604** — recharts 3.8 adoption, needs design decisions
33. **#697** — Blocked on upstream `--use-const` merge

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
