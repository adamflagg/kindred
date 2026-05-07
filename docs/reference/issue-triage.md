# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-05-07 (15 open issues, 11 closed in 2026-05-07 cleanup wave + 9 prior).

---

## Remaining Open Issues

### Group 33 — Social graph cleanup (residual tech-debt)

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1162 | refactor(api): switch SocialGraphBuilder to nx.MultiGraph for per-source request edges | tech-debt | Low | Ready |
| 1157 | refactor(api): rename SocialGraphEdge.type and CrossScopeEdge.type to edge_type | refactor | Low | Ready |

### Group 34 — Satisfaction frontend consolidation

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1165 | frontend: eliminate dual /api/satisfaction fetch (CamperDetail useSatisfactionData + BunkRequestProvider) | refactor | Medium | Ready |
| 1160 | refactor: extend PerRequestStatus with status+detail to delete requestSatisfaction.ts | tech-debt | Medium | Ready |

### Group 35 — Bunk request lifecycle

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1069 | feat(sync): decline bunk_requests when requestee no longer attending or moves session | feat | Medium | Ready |

### Group 36 — Scenarios & friend groups

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1047 | feat(pb): enforce one friend group per camper per scenario | feat | Medium | Ready |
| 1046 | feat(frontend): scenario copy should include locked friend groups | feat | Medium | Ready |

### Group 37 — Frontend small refactors

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1045 | refactor(frontend): centralize session_type business logic | refactor | Low | Ready |
| 1024 | frontend: audit modal z-index pattern when nested inside z-[60] CamperDetailsPanel | chore | Low | Ready |
| 955 | refactor(frontend): replace nested ternaries with switch/lookup patterns | refactor | Low | Ready |
| 953 | Frontend: audit auth isLoading gating and bunk-requests query-key invalidation patterns | refactor | Low | Ready |

### Group 38 — Infrastructure & ops

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1155 | infra: wire up OpenAPI → TypeScript codegen to eliminate hand-mirrored API types | infra | Medium | Larger; cross-cuts api+frontend |
| 1142 | refactor(sync): collapse dedup-tiebreak axes — derive RequestSource from source_field | refactor | Low | 5-stage initiative; needs proper scoping (Python, not Go as originally tagged) |
| 1012 | chore(frontend): consider dropping mobile/touch support to simplify UI codebase | chore | Low | Needs product decision |
| 919 | chore: improve Python docstring coverage (~57% → 80%) | chore | Low | Background / incremental |

---

## Suggested Attack Order

The 2026-05-07 cleanup wave drained the small-defensive surface. Remaining groups skew larger or need product decisions.

1. **Group 33 pair (#1162 + #1157)** — both touch `SocialGraphEdge` types; sequential pair, small.
2. **Group 34 pair (#1165 + #1160)** — satisfaction frontend cleanup; sequential pair, medium-sized.
3. **Group 35 (#1069)** — sync feat, declines bunk_requests on session move; standalone work.
4. **Group 36 feats (#1047 + #1046)** — pb migration + frontend friend-group scenario copy; meaningful product surface.
5. **Group 37 frontend cleanup** — low-priority refactors; low yield, do in spare cycles.
6. **Group 38 large items (#1155, #1142)** — multi-day initiatives; #1155 is an OpenAPI codegen wire-up across api+frontend, #1142 is a 5-stage RequestSource derivation in Python sync.

## Completed Groups

- **Group 32** — `/api/satisfaction` regression cluster (PR #1158/1169 fallout). Shipped via PR #1169 (commit c985edf8) and PR #1177 (commit 3e0eb524). All three issues closed: #1171 (aggregate.py 500), #1172 (P-badge / 0-of-N source_field fallback), #1170 (bunking_validator → satisfaction.predicate migration).
- **Group 33 confirmed bugs** — #1156 (_add_classmate_edges discrete address columns) and #1164 (anchored AG match) shipped in PR #1182. The remaining two issues in Group 33 are tech-debt/refactor only.
- **2026-05-07 cleanup wave** — 8 PRs merged in a single sweep, retiring 9 issues across Groups 33, 34, 35, 36, 37, 38:
  - PR #1186 closes #1179 (HEALTHCHECK --max-time)
  - PR #1187 closes #1125 (userEvent test consolidation)
  - PR #1188 closes #1185 (wireHooks extract; #1185 was a same-day follow-up to PR #1183)
  - PR #1189 closes #1178 (solver 409 single-flight + scenarios.py guard gap fix)
  - PR #1190 closes #956 (useRef-syncing drop + caller useCallback stabilization)
  - PR #1191 closes #1163 (cm_id=0 skip in get_related_session_ids + exc_info=True)
  - PR #1192 closes #1167 (satisfaction test helper simplify)
  - PR #1193 closes #1166 (getSessionShortName converge to shared util)
  - #1149 and #1150 retired without new work — both already shipped in PR #1168 (2026-05-06).
- **Group 35 partial** — #1059 (stale is_reciprocal flag) shipped in PR #1183 (commit 8e328f23). #1068 and #954 closed 2026-05-06 as resolved/no-action. Only #1069 remains.

Historical completed groups (Groups 1–31) are reflected in closed GitHub issues
and git history; see `git log docs/reference/issue-triage.md` for prior triage
snapshots if needed.
