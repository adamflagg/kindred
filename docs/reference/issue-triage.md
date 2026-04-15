# Issue Triage

Open issues grouped by code area with dependencies and suggested attack order.
Last updated: 2026-04-14 (10 open issues, 19 closed since last update).

---

## Remaining Open Issues

### Group 30: Phase Runner Historical Verification Bugs (#921, #922)

**Priority: High** — Debug pipeline disagrees with production pipeline

| # | Title | Type | Status |
|---|-------|------|--------|
| 921 | fix(api): phase_runner `stop_at_phase=historical` short-circuits before historical verification | bug | Ready — staleness confirmed in code at phase_runner.py:183-184 |
| 922 | fix(api): phase_runner skips historical verification when starting from phase2 | bug | Ready — same root cause as #921 |

**Interplay:** Both bugs live in the same `phase2` branch of `PhaseRunner.run_from_phase` and have the same fix — wire `historical_verification_service.verify(...)` into the phase2 cascade before the `stop_at_phase == "historical"` early return. Single PR.

### Group 31: AI Disambiguation & Trace Pipeline (#877, #880, #881, #923)

**Priority: Medium** — Refactor cluster + perf win in the same code area

| # | Title | Type | Status |
|---|-------|------|--------|
| 880 | refactor(api): extract setdefault helper for disambiguation metadata | refactor | Ready — foundational helper |
| 881 | refactor(api): decompose `_process_individual_disambiguation_results` | refactor | Ready — depends on #880 |
| 877 | refactor(api): split PostPipelineTrace into granular sub-stage traces | refactor | Ready |
| 923 | perf(api): gate trace-collector work and cache `_get_trace_key` in orchestrator | performance | Ready — pairs naturally with #877 |

**Interplay:** #880 → #881 → #877 → #923 as a chain in one worktree. All touch the post-pipeline trace / disambiguation code.

### Standalone Issues

| # | Title | Type | Priority | Status |
|---|-------|------|----------|--------|
| 896 | Phase 1 AI prompt splits "FirstName LastName" into two separate first names | bug | High | Ready — external contributor posted root cause + one-line prompt fix |
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

1. **Group 30** (#921, #922) — Phase runner bug pair, single PR, staleness confirmed
2. **#896** — AI prompt fix, externally root-caused, one-line prompt change
3. **Group 31** (#880 → #881 → #877 → #923) — Disambiguation + trace cluster
4. **#899** — RBAC rule fix
5. **#918 + #796** — Frontend cleanup batch
6. **#919** — Background docstring coverage
7. **#697** — Blocked externally

## Completed Groups (recent)

| Group | PR / Date | Notes |
|-------|-----------|-------|
| Groups 1–24 | Various | See git history |
| Group 25: Sync fixes (#806, #807, #791) | Closed 2026-04-04 | |
| Group 26: Solver bugs & perf (#788, #792, #809) | Closed 2026-04-05 | |
| Group 27: Solver log cleanup (#787, #815) | Closed 2026-04-04 | |
| Group 28: Metrics date-stripping (#770, #771, #772, #773) | Closed 2026-04-05 | |
| Group 29: Frontend cleanup (#797, #798, #808, #810) | Closed 2026-04-05 | #796 remains open |
| Standalone: #754 AG cabin pairing | Closed 2026-04-05 | |
| Standalone: #801 CI platform flag | Closed 2026-04-04 | |
| Standalone: #604 recharts 3.8 | Closed | |
