# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-05-06 (29 open issues, 7 closed since last update).

---

## Remaining Open Issues

### Group 33 — Social graph cleanup

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1156 | fix(api): _add_classmate_edges reads removed JSON 'address' field | bug | Medium | Ready — confirmed still in code (`social_graph_builder.py:785-786`) |
| 1164 | fix(frontend): BunkSocialGraphModal getBunkType uses incidental substring match for AG bunks | tech-debt | Medium | Ready |
| 1163 | fix(api): session_utils.get_related_session_ids may emit cm_id=0 for AG sessions missing cm_id | tech-debt | Medium | Ready |
| 1162 | refactor(api): switch SocialGraphBuilder to nx.MultiGraph for per-source request edges | tech-debt | Low | Ready |
| 1157 | refactor(api): rename SocialGraphEdge.type and CrossScopeEdge.type to edge_type | refactor | Low | Ready |

### Group 34 — Satisfaction frontend consolidation

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1167 | frontend: simplify buildCamperSatisfactionFromRequests test helper in BunkingStatusPanel.test.tsx | chore | Low | Ready |
| 1165 | frontend: eliminate dual /api/satisfaction fetch (CamperDetail useSatisfactionData + BunkRequestProvider) | refactor | Medium | Ready |
| 1160 | refactor: extend PerRequestStatus with status+detail to delete requestSatisfaction.ts | tech-debt | Medium | Ready |

### Group 35 — Bunk request lifecycle

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1059 | bug(api): stale is_reciprocal flag on surviving bunk_request when partner row is removed | bug | Medium | Ready |
| 1069 | feat(sync): decline bunk_requests when requestee no longer attending or moves session | feat | Medium | Ready |
| 1068 | investigate: resolved bunk_requests rows with invalid requested_person_cm_id | investigation | Medium | Ready |
| 954 | Clarify: should declining a bunk request clear `request_locked`? | question | Low | Needs product decision |

### Group 36 — Scenarios & friend groups

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1149 | refactor(api): scenarios.py except HTTPException guard inconsistency between list_scenarios and update_scenario_assignment | refactor | Low | Ready |
| 1150 | refactor(api): drop fragile locals() check in scenarios.py update_scenario_assignment | refactor | Low | Ready |
| 1047 | feat(pb): enforce one friend group per camper per scenario | feat | Medium | Ready |
| 1046 | feat(frontend): scenario copy should include locked friend groups | feat | Medium | Ready |

### Group 37 — Frontend small refactors

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1166 | frontend: converge two getSessionShortName variants (CamperDetailsPanel + CamperDetail) | refactor | Low | Ready |
| 1045 | refactor(frontend): centralize session_type business logic | refactor | Low | Ready |
| 1024 | frontend: audit modal z-index pattern when nested inside z-[60] CamperDetailsPanel | chore | Low | Ready |
| 956 | refactor(frontend): revisit useRef-syncing pattern in ConfirmActionPopover | refactor | Low | Ready |
| 955 | refactor(frontend): replace nested ternaries with switch/lookup patterns | refactor | Low | Ready |
| 953 | Frontend: audit auth isLoading gating and bunk-requests query-key invalidation patterns | refactor | Low | Ready |

### Group 38 — Infrastructure & ops

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 1179 | Add --max-time to container HEALTHCHECK to bound stuck probes | infra | Medium | Ready — small, defensive |
| 1178 | Add single-flight serialization to /api/solver/run | infra | Medium | Ready |
| 1155 | infra: wire up OpenAPI → TypeScript codegen to eliminate hand-mirrored API types | infra | Medium | Larger; cross-cuts api+frontend |
| 1142 | refactor(sync): collapse dedup-tiebreak axes — derive RequestSource from source_field | refactor | Low | Ready |
| 1125 | test(frontend): consolidate lazy `userEvent` import pattern in GraphControls.test.tsx | tech-debt | Low | Ready |
| 1012 | chore(frontend): consider dropping mobile/touch support to simplify UI codebase | chore | Low | Needs product decision |
| 919 | chore: improve Python docstring coverage (~57% → 80%) | chore | Low | Background / incremental |

---

## Suggested Attack Order

1. **Group 33 (#1156 first)** — confirmed bug with concrete fix path; the rest of the group is tech-debt and can ride along in same PR or follow-up.
2. **Group 35 (#1059, #1069, #1068)** — bunk-request lifecycle correctness; #1059 is a bug, others are feat/investigation but cohesive.
3. Remaining groups by priority/readiness.

## Completed Groups

- **Group 32** — `/api/satisfaction` regression cluster (PR #1158/1169 fallout). Shipped via PR #1169 (commit c985edf8) and PR #1177 (commit 3e0eb524). All three issues closed: #1171 (aggregate.py 500), #1172 (P-badge / 0-of-N source_field fallback), #1170 (bunking_validator → satisfaction.predicate migration).

Historical completed groups (Groups 1–31) are reflected in closed GitHub issues
and git history; see `git log docs/reference/issue-triage.md` for prior triage
snapshots if needed.
