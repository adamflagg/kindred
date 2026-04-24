# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-04-15 (3 open issues, 10 closed since last update).

---

## Remaining Open Issues

### Standalone Issues

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 933 | test(sync): `test_analyze_group_cohesion` segfaults under Python 3.14 (networkx C extension) | bug | Medium | Ready — quick fix: `skipif sys.version_info >= (3, 14)`; longer-term upstream fix |
| 919 | chore: improve Python docstring coverage (~57% → 80%) | chore | Low | Background / incremental |

### Blocked

| # | Title | Blocked on |
|---|-------|------------|
| 697 | Switch pocketbase-typegen to upstream | External upstream merge of `--use-const` flag |

---

## Suggested Attack Order

1. **#933** — Unblocks clean local pre-push runs; one-line `skipif` mitigation is low risk
2. **#919** — Background docstring coverage, incremental
3. **#697** — Blocked externally

## Completed Groups

Historical completed groups (Groups 1–31) are reflected in closed GitHub issues and git history; see `git log docs/reference/issue-triage.md` for prior triage snapshots if needed.
