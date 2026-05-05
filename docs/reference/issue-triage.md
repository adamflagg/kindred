# Issue Triage

Open issues grouped by theme with dependencies and suggested attack order.
Last updated: 2026-05-04 (27 open issues; 2 follow-ups filed this session).

Wife-feedback scoreboard is closed except for solver Stage 4 (#18c). All non-solver work tracked here is downstream debt from earlier scoreboard PRs plus general dev backlog.

---

## This session — landed

15 PRs merged this session (including the 2 from start-of-session). Issues resolved:

| PR | Closed |
|----|--------|
| #1126 | #1064, #1083 |
| #1127 | #1067, #1086, #1102 |
| #1128 | #1040 |
| #1129 | #1080 |
| #1130 | #1079 |
| #1131 | #978 |
| #1132 | #980 |
| #1133 | #1026 |
| #1134 | #1078 |
| #1135 | #1121 |
| #1140 | #1136 |
| #1141 | #1137 |
| #1143 | #1090 |
| #1144 | #1088 |

Closed without merge: #1063 (already fixed pre-session), #1060 (production-side dot suppression intentional), #1061 (already fixed — graph entry points pass real bunk roster), #1022 (already fixed in main).

Newly filed follow-ups (Group 10 below):
- **#1142** — collapse dedup-tiebreak axes; derive `RequestSource` from `source_field` (architectural follow-up to #1088 — `source` is a deterministic projection of `source_field`, the two-axis dedup tiebreak collapses to one ordered preference list)
- **#1145** — clean up remaining `HTTPException(500, str(e))` leaks in `scenarios.py` (6 sites) + `debug.py` duck-typing pattern + investigate PB 401 → API 403 vs frontend auth-retry semantics (3-item bundle from scan-it of #1141)

Multiple PRs received scan-it review during the session; #1128, #1131, #1134, #1140, and #1141 had findings addressed via fix-up commits before merge.

---

## Groups

### Group 1 — Stage 3 graph satisfaction (1 issue remaining)

| # | Title | Type | Notes |
|---|-------|------|-------|
| 1041 | consolidate request-satisfaction logic across 3 code paths | refactor | **prerequisite** to upcoming "what counts as 1 request" field-source initiative — without centralization, the predicate has to be triple-implemented (TS board, Py graph builder, Py solver) and kept in sync forever |

### Group 2 — Friend-group / scenario UX (4 issues)

Loose cluster around scenario polish and friend-group invariants. Feature work; needs design discussion.

| # | Title | Type |
|---|-------|------|
| 1044 | cohort rows for multi-session campers | feat |
| 1046 | scenario copy should include locked friend groups | feat |
| 1047 | enforce one friend group per camper per scenario | feat (pb) |
| 1105 | drill from Check Bunking modal aggregates into specific unsatisfied campers | feat |

### Group 3 — Bunk-request data hygiene (4 issues)

| # | Title | Type |
|---|-------|------|
| 954 | should declining a bunk request clear `request_locked`? | clarify |
| 1059 | stale is_reciprocal flag when partner row removed | bug |
| 1068 | resolved rows with invalid requested_person_cm_id | investigate |
| 1069 | sync decline when requestee no longer attending or moves session | feat |

### Group 4 — API / social_graph cleanup & typing (5 issues)

Pure backend tech debt. Unblocked since #1129 (ego-network deletion).

| # | Title | Type |
|---|-------|------|
| 1049 | promote `_last_name_jw_raw_score` from private to public API | refactor |
| 1062 | investigate removing deprecated SocialGraphBuilder.build_social_network | chore |
| 1081 | pre-existing pyright errors in social_graph_builder.py | refactor |
| 1094 | remove sibling edges from social graph | refactor |
| 1097 | promote cross_scope_edges to typed CrossScopeEdge Pydantic model | refactor |

### Group 5 — Frontend refactors (6 issues)

| # | Title | Type |
|---|-------|------|
| 953 | audit auth isLoading + bunk-requests query-key invalidation | audit |
| 955 | replace nested ternaries with switch/lookup | refactor |
| 956 | revisit useRef-syncing in ConfirmActionPopover | refactor |
| 1024 | modal z-index audit (nested in z-[60] CamperDetailsPanel) | audit |
| 1045 | centralize session_type business logic | refactor |
| 1125 | consolidate lazy userEvent import in GraphControls.test.tsx | test |

### Group 6 — Scoped bug fixes (resolved this session)

All 6 issues resolved: #978 via #1131, #980 via #1132, #1022 closed already-fixed, #1026 via #1133, #1078 via #1134, #1121 via #1135.

### Group 7 — Sync infra (resolved this session)

#1079 resolved via #1130 (annotation-only; values intentionally unchanged after audit).

### Group 8 — Auth / security / ops (3 issues)

Judgment-required; not subagent-fodder.

| # | Title | Type |
|---|-------|------|
| 999 | tune Caddy rate-limit post-deploy based on real VPS traffic | ops |
| 1100 | serve OAuth2 popup-close redirect from a kindred path so /_/ can be IP-gated | feat |
| 1101 | enable PKCE on OIDC client (and decide on public-vs-confidential posture) | security |

### Group 9 — Background / low priority (2 issues)

| # | Title | Type |
|---|-------|------|
| 919 | improve Python docstring coverage (~57% → 80%) | chore |
| 1012 | consider dropping mobile/touch support to simplify UI codebase | chore |

### Group 10 — Follow-ups filed this session (2 issues)

Both architectural follow-ups; not subagent-fodder.

| # | Title | Origin |
|---|-------|--------|
| 1142 | collapse dedup-tiebreak axes — derive `RequestSource` from `source_field` | discussion of #1088 — `source` (FAMILY/STAFF) is a deterministic projection of `source_field` (5 values); the two-axis dedup tiebreak collapses to one ordered preference list. **Connects to #1041** (Group 1) — both touch the broader "what counts as 1 request" field-source initiative. |
| 1145 | clean up remaining `HTTPException(500, str(e))` leaks + low-priority error-handling debt | scan-it skips of #1141; bundles three items (6 `{e!s}` sites in `scenarios.py`, `debug.py` duck-typing, frontend 401-vs-403 audit) as one ticket to avoid issue sprawl |

---

## Suggested Attack Order

1. **Group 4 (backend cleanup)** — 5 tech-debt items, parallelizable.
2. **Group 1 #1041 + Group 10 #1142 together** — both are pieces of the "what counts as 1 request" field-source initiative. #1142 (collapse `source`/`source_field` axes) sets the underlying model; #1041 (consolidate request-satisfaction logic across 3 code paths) builds the unified predicate on top. Sequence: resolve open question on `not_bunk_with` field classification → land #1142 → land #1041 against the simplified model.
3. **Group 10 #1145** — bundled error-handling debt; scoped and parallelizable as 3 small PRs.
4. **Group 3 remainder**: #1059 standalone; #1068 + #1069 are investigations; #954 is a clarification question.
5. **Group 5 (frontend refactors)** — 6 items, low priority.
6. **Group 2 (friend-group UX)** — feature work, needs brainstorming pass.
7. **Group 8** — security/ops decisions, not subagent-fodder.
8. **Group 9** — defer.

---

## Completed Groups

Historical completed groups (Groups 1–31 from earlier triages) are reflected in closed GitHub issues and git history; see `git log docs/reference/issue-triage.md` for prior triage snapshots.
