# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-04-14 (8 open issues, 3 closed since last update).

---

## Remaining Open Issues

### Group 31: AI Disambiguation & Trace Pipeline (#925, #877, #880, #881, #923)

**Priority: High** — Runtime bug drops bunk requests + refactor cluster in same code area

| # | Title | Type | Status |
|---|-------|------|--------|
| 925 | fix(api): Phase 3 disambiguation errors when AI returns both ranked_selections and legacy fields | bug | Ready — validator confirmed at ai_schemas.py:174-184; fix: normalize rather than reject |
| 880 | refactor(api): extract setdefault helper for disambiguation metadata | refactor | Ready — foundational helper; setdefault pattern live at 19 sites |
| 881 | refactor(api): decompose `_process_individual_disambiguation_results` | refactor | Ready — function confirmed at phase3_disambiguation_service.py:223; depends on #880 |
| 877 | refactor(api): split PostPipelineTrace into granular sub-stage traces | refactor | Ready |
| 923 | perf(api): gate trace-collector work and cache `_get_trace_key` in orchestrator | performance | Ready — pairs naturally with #877 |

**Interplay:** Fix #925 first (runtime bug, `ai_schemas.py`), then #880 → #881 → #877 → #923 as a refactor chain. All touch the post-pipeline trace / disambiguation code. Single worktree.

### Standalone Issues

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 899 | RBAC: bunk_requests collection too restrictive for read access | bug | Medium | Ready — PocketBase collection rule tweak |
| 918 | refactor(frontend): extract approve/reject handlers in RequestReviewPanel | refactor | Low | Ready |
| 796 | chore(frontend): remove localStorage program migration shim | cleanup | Low | Ready |
| 919 | chore: improve Python docstring coverage (~57% → 80%) | chore | Low | Background / incremental |

### Blocked

| # | Title | Blocked on |
|---|-------|------------|
| 697 | Switch pocketbase-typegen to upstream | External upstream merge of `--use-const` flag |

---

## Suggested Attack Order

1. **Group 31** (#925 → #880 → #881 → #877 → #923) — Lead with runtime bug fix, then disambiguation + trace refactor cluster
2. **#899** — RBAC rule fix
3. **#918 + #796** — Frontend cleanup batch
4. **#919** — Background docstring coverage
5. **#697** — Blocked externally

## Completed Groups (recent)

| Group | PR / Date | Notes |
|-------|-----------|-------|
| Groups 1–24 | Various | See git history |
| Group 25: Sync fixes (#806, #807, #791) | Closed 2026-04-04 | |
| Group 26: Solver bugs & perf (#788, #792, #809) | Closed 2026-04-05 | |
| Group 27: Solver log cleanup (#787, #815) | Closed 2026-04-04 | |
| Group 28: Metrics date-stripping (#770, #771, #772, #773) | Closed 2026-04-05 | |
| Group 29: Frontend cleanup (#797, #798, #808, #810) | Closed 2026-04-05 | #796 remains open |
| Group 30: Phase runner bugs (#921, #922) | Closed 2026-04-14 | |
| Standalone: #754 AG cabin pairing | Closed 2026-04-05 | |
| Standalone: #801 CI platform flag | Closed 2026-04-04 | |
| Standalone: #604 recharts 3.8 | Closed | |
| Standalone: #896 Phase 1 AI prompt split | Closed 2026-04-14 | |
