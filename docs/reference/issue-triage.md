# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-05-08 (9 open issues; parallel-worktree sweep retired 7 issues across Groups 33–38; Phase 1 solver config drift cluster fully shipped; #1047 closed as won't-do-as-spec'd, #953 closed as resolved-by-decision).

---

## Remaining Open Issues

### Group 34 — Satisfaction frontend consolidation (residual)

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1199 | refactor(frontend): eliminate computeRequestSatisfaction once #1155 codegen lands | refactor | Low | **Unblocked** — #1155 shipped via PR #1211. Single drag-preview Path 1 consumer remains in `CamperDetailsPanel`. |
| 1160 | refactor: extend PerRequestStatus with status+detail to delete requestSatisfaction.ts | tech-debt | Medium | Partial: `PerRequestStatus.detail` shipped in PR #1198. Final predicate deletion paired with #1199. |

### Group 37 — Frontend small refactors

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1045 | refactor(frontend): centralize session_type business logic | refactor | Low | **In flight** — PR #1222 (`sessionTypePredicates.ts` module + 26 file sweep) awaiting review. |
| 955 | refactor(frontend): replace nested ternaries with switch/lookup patterns | refactor | Low | **In flight (partial)** — PR #1216 ships metrics/ slice. graph/, components/, hooks/, pipeline-debug/ slices remain. |

### Group 38 — Infrastructure & ops (residual)

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1142 | refactor(sync): collapse dedup-tiebreak axes — derive RequestSource from source_field | refactor | Low | **Stages 1+2 shipped** via PR #1210. Stages 3-5 deferred (3 needs not_bunk_with classification confirmed STAFF; 4 is destructive PB migration; 5 is callsite sweep). |
| 919 | chore: improve Python docstring coverage (~57% → 80%) | chore | Low | Background / incremental |

### Group 39 — Solver config drift (Phase 1 done; Phase 1.5 next)

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1218 | Phase 1.5: solver config re-baseline (post-#1212–#1215) | refactor | Medium | **Unblocked** — prerequisites #1212/#1213/#1214/#1215 all merged. Calls for fresh-agent re-inventory. |

### Group 40 — Defensive guards & test coverage

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1217 | test: add Python↔TS source_field map drift guard | test | Low | Ready — small CI test against the parallel `_SOURCE_FIELD_MAP` (Python) ↔ `SOURCE_FIELD_MAP` (TS). |
| 1219 | Frontend bunk_assignments queries don't filter soft-deleted records | fix | Low | Ready — defensive guard; 0 user-visible impact today (0 soft-deleted rows in 2026 prod data). |

---

## Suggested Attack Order

The 2026-05-07/08 wave drained Groups 33, 34 (mostly), 35, 36, 37 (mostly), and 38 (mostly). Most remaining work skews toward small followups, fresh-agent initiatives, or product decisions.

1. **Inline followup pair (#1199 + #1160)** — both target the same drag-preview / `CamperDetailsPanel` Path 1 surface; ship together once #1216 + #1222 merge to avoid frontend rebase noise. Now unblocked by #1211.
2. **Group 39 (#1218)** — fresh-agent solver config re-inventory. Recommended scope per the issue: spawn an agent without conversation context, output categorized table, drives Phase 2 hardcoding sweep.
3. **Group 40 small wins (#1217 + #1219)** — both are ~hour-each defensive additions. Pure ship; no scope decisions.
4. **Group 38 #1142 stages 3-5** — needs another working session. Stage 3 changes dedup behavior (single-axis ordering replaces two-axis sort); stage 4 is a destructive PB migration; stage 5 is callsite sweep.
5. **Group 37 residual (#955 graph/+other slices)** — finish ternary sweep slice-by-directory.
6. **Group 38 (#919)** — Python docstring sweep, incremental background.

## Completed Groups

- **Group 32** — `/api/satisfaction` regression cluster. Shipped via PR #1169 + PR #1177. All three issues closed: #1171, #1172, #1170.
- **Group 33 — social graph cleanup** — fully closed. Confirmed bugs #1156 + #1164 in PR #1182. Edge-type rename #1157 in PR #1196. MultiGraph core + friend-group detection purge in PR #1197. Final classmate/historical edge cleanup + python-louvain drop in PR #1207 (closes #1162, #1203). Edge-type narrowing drift fix follow-up in PR #1221.
- **Group 34 satisfaction core** — #1165 closed via PR #1198 (`PerRequestStatus.detail` extension). #1199 + #1160 follow-ups remain (Group 34 residual).
- **Group 35 — bunk request lifecycle** — fully closed. #1059 in PR #1183. #1068 + #954 closed without new work. #1069 in PR #1206 (`reconcile bunk_requests against attendee state` — original "decline on requestee leaves" rewritten to broader reconciliation).
- **Group 36 — scenarios & friend groups** — fully closed. #1046 closed via PR #1208 (scenario copy carries locked groups). #1047 closed as won't-do-as-spec'd: PR #1208 also shipped a UI confirmation dialog (`useGroupConflictConfirm` + `GroupConflictDialog`) that warns staff before adding a camper to a 2nd group in the same scenario; original DB-enforcement framing was rejected because the migration would have silently deleted older memberships.
- **Group 37 — frontend small refactors (partial)** — #1024 (modal z-index audit) in PR #1195. #1045 in PR #1222 (in flight). #955 metrics slice in PR #1216 (in flight). #953 closed as resolved-by-decision: (B) raw `['bunk-requests']` invalidation already shipped via `invalidateRequestQueries` helper; (A) auth `isLoading` strict-vs-pragmatic policy declined — strict CLAUDE.md rule stays as written.
- **Group 38 — infrastructure & ops (partial)** — #1155 (OpenAPI codegen) closed in PR #1211. #1142 stages 1+2 in PR #1210. #1012 (drop mobile/touch) closed as won't-do.
- **Group 39 — solver config drift Phase 1** — Group A (#1213 across A1–A7, A10–A12) merged. B1–B4 evaluator drift fix in PR #1215. SectionCard config-value guard in PR #1212. `default=` kwarg removal in PR #1214. Phase 1.5 re-baseline filed as #1218.
- **2026-05-07 cleanup wave** — 8 PRs merged retiring 9 issues across Groups 33, 34, 35, 36, 37, 38:
  - PR #1186 closes #1179 (HEALTHCHECK --max-time)
  - PR #1187 closes #1125 (userEvent test consolidation)
  - PR #1188 closes #1185 (wireHooks extract)
  - PR #1189 closes #1178 (solver 409 single-flight + scenarios.py guard gap)
  - PR #1190 closes #956 (useRef-syncing drop + caller useCallback stabilization)
  - PR #1191 closes #1163 (cm_id=0 skip in get_related_session_ids + exc_info=True)
  - PR #1192 closes #1167 (satisfaction test helper simplify)
  - PR #1193 closes #1166 (getSessionShortName converge to shared util)
  - #1149 and #1150 retired without new work — both already shipped in PR #1168.
- **2026-05-07/08 sweep wave** — parallel multi-worktree session retired 6 issues (#1069, #1162, #1203, #1046, #1142 partial, #1155) + 1 partial (#1047 pivot) via PRs #1206, #1207, #1208, #1210, #1211. Plus drive-by drift fix in PR #1221 (`CrossScopeEdge` narrowing fallout from #1207 + #1211 stale generated types).

Historical completed groups (Groups 1–31) are reflected in closed GitHub issues
and git history; see `git log docs/reference/issue-triage.md` for prior triage
snapshots if needed.
