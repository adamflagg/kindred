# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-05-08 (9 open issues, 10 closed in 2026-05-07/05-08 sweep).

---

## Remaining Open Issues

### Group 34 — Satisfaction predicate consolidation (residual)

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1160 | refactor: extend PerRequestStatus with status+detail to delete requestSatisfaction.ts | tech-debt | Medium | Ready (partial — `PerRequestStatus.detail` extension landed in PR #1198; full TS predicate deletion deferred to #1199) |
| 1199 | refactor(frontend): eliminate computeRequestSatisfaction once #1155 codegen lands | refactor | Medium | Ready (unblocked — #1155 closed via PR #1211) |

### Group 37 — Frontend small refactors

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1219 | Frontend bunk_assignments queries don't filter soft-deleted records | defensive | Low | Ready (no current user impact — 0 soft-deleted rows in prod, but missing guard) |
| 1045 | refactor(frontend): centralize session_type business logic | refactor | Low | Ready |
| 955 | refactor(frontend): replace nested ternaries with switch/lookup patterns | refactor | Low | Ready |

### Group 38 — Infrastructure & ops

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1217 | test: add Python↔TS source_field map drift guard | test | Medium | Ready; small (~30 LOC test) |
| 1218 | Phase 1.5: solver config re-baseline (post-#1212–#1215) | infra | Medium | Ready (all blockers merged 2026-05-08); fresh-agent task by design |
| 1142 | refactor(sync): collapse dedup-tiebreak axes — derive RequestSource from source_field | refactor | Low | 5-stage initiative; needs proper scoping (Python, not Go as originally tagged) |
| 919 | chore: improve Python docstring coverage (~57% → 80%) | chore | Low | Background / incremental |

---

## Suggested Attack Order

The 2026-05-07/05-08 cleanup wave drained ~10 issues; the residual surface skews
toward larger initiatives or low-priority polish.

1. **Group 34 pair (#1160 + #1199)** — finish the satisfaction predicate
   consolidation. #1199 is now unblocked by #1155 closing. Sequential pair,
   medium-sized; together they delete `frontend/src/utils/requestSatisfaction.ts`
   and remove the dual TS/Python predicate drift surface.
2. **#1217 (source_field drift guard)** — small, ~30 LOC test, prevents the
   exact silent failure mode that motivated #1199. Cheap insurance.
3. **#1218 (Phase 1.5 solver config re-baseline)** — fresh-agent re-inventory
   across solver/PocketBase/admin GUI. Drives Phase 2 hardcoding sweep. Larger.
4. **Group 37 frontend cleanup** — #1219 first (defensive guard with named call
   sites), then #1045 / #955 in spare cycles.
5. **#1142** — multi-day Python sync refactor; tackle once smaller items clear.

## Completed Groups

- **Group 32** — `/api/satisfaction` regression cluster. Shipped via PR #1169
  (commit c985edf8) and PR #1177 (commit 3e0eb524). Three issues closed.
- **Group 33** — Social graph cleanup. #1156 + #1164 shipped in PR #1182. The
  remaining tech-debt pair #1162 + #1157 closed in 2026-05-07/05-08 sweep.
- **Group 35** — Bunk request lifecycle. #1059 shipped in PR #1183 (commit
  8e328f23). #1068 / #954 closed 2026-05-06. #1069 closed 2026-05-08.
- **Group 36** — Scenarios & friend groups. #1046 closed 2026-05-07; #1047
  closed 2026-05-08.
- **2026-05-07/05-08 cleanup wave** — 10 additional issues retired across
  Groups 33–38:
  - PR #1186 closes #1179 (HEALTHCHECK --max-time)
  - PR #1187 closes #1125 (userEvent test consolidation)
  - PR #1188 closes #1185 (wireHooks extract)
  - PR #1189 closes #1178 (solver 409 single-flight)
  - PR #1190 closes #956 (useRef-syncing drop)
  - PR #1191 closes #1163 (cm_id=0 skip + exc_info=True)
  - PR #1192 closes #1167 (satisfaction test helper simplify)
  - PR #1193 closes #1166 (getSessionShortName converge)
  - PR #1211 closes #1155 (OpenAPI → TS codegen)
  - Plus closures of #1024, #1012, #1162, #1157, #1165, #953, #1069, #1046, #1047
  - #1149 / #1150 retired without new work (already shipped in PR #1168).

Historical completed groups (Groups 1–31) are reflected in closed GitHub issues
and git history; see `git log docs/reference/issue-triage.md` for prior triage
snapshots if needed.
