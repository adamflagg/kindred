# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-04-16 (6 open issues — #933 closed; 4 new issues #941–#944 from 2026-04-15 production-run forensics, all grouped under Phase 3 / OBR pipeline).

---

## Remaining Open Issues

### Group 32: Phase 3 / OBR Pipeline Observability & Cleanup

All surfaced from the 2026-04-15 production run. Cohesive because they share the same pipeline code and the same motivating dataset (1610 OBRs → 2303 BRs).

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 944 | refactor(api): remove dead legacy field `selected_person_id` from `AIDisambiguationResponse` | refactor | Medium | Ready — follow-up cleanup after PR #928 tactical fix; scope is schema + provider + service + ~6 tests |
| 943 | feat(api): add top-level OBR→BR reconciliation summary to pipeline logs | feat | Medium | Ready — additive log line, pulls from existing trace data |
| 942 | fix(api): Phase 3 stats undercount — reranker path wins not counted in `_update_stats` | fix | Medium | Ready — log-only cosmetic bug, but masks reranker health; prefer single-source-of-truth rewrite from trace |
| 941 | fix(frontend): `manual_review_reason` is saved but never rendered in UI | fix | Medium | Ready — self-referential "kept for review" markers invisible to staff; smallest option is to fold into existing `disposition_reason` / Status column |

### Standalone Issues

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 919 | chore: improve Python docstring coverage (~57% → 80%) | chore | Low | Background / incremental |

### Blocked

| # | Title | Blocked on |
|---|-------|------------|
| 697 | Switch pocketbase-typegen to upstream | External upstream merge of `--use-const` flag |

---

## Suggested Attack Order

1. **Group 32** — Four tightly-related issues from the same production run, all ready
   - **#942 first** — fixes the measurement before making further observability decisions (its fix validates the trace-as-source-of-truth approach that #943 also leans on)
   - **#943 next** — reuses the trace-driven counts #942 establishes
   - **#944 parallel** — independent of #942/#943; can be done in a parallel worktree
   - **#941 parallel** — frontend-only; independent of the backend three
2. **#919** — Background docstring coverage, incremental
3. **#697** — Blocked externally

## Completed Groups

Historical completed groups (Groups 1–31) are reflected in closed GitHub issues and git history; see `git log docs/reference/issue-triage.md` for prior triage snapshots if needed.
