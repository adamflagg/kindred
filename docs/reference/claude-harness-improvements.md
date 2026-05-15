# Claude Harness Improvements

Tracking how the Claude Code setup for this repo measures against [the upstream guidance for large codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start). This is a living doc — re-audit roughly every 3–6 months, or after a major model release when behavior changes.

The harness — CLAUDE.md layering, hooks, skills, plugins, MCP, LSP, subagents, permissions — often matters more than the model. Tuning it is the work.

---

## Status snapshot

| # | Item | State |
|---|------|-------|
| 1 | Subdir CLAUDE.md layering | **Done** for `pocketbase/`, `bunking/`, `bunking/solver/`, `api/`, `frontend/`, `tests/`. Root file trimmed. |
| 2 | `permissions.deny` rules | **Partial** — Tier 1 (binaries + DB files) applied. Tier 2 (noise reducers) pending. |
| 3 | `.claudeignore` for lockfiles + reference dumps | Not started |
| 4 | Stop hook (CLAUDE.md self-improvement) | Not started |
| 5 | SessionStart hook (dynamic branch/PR/worktree context) | Not started |
| 6 | Custom project subagents (`.claude/agents/`) | Not started |
| 7 | Clean stale `/home/adam/bunking/` paths from allow lists | Not started |
| 8 | Dedupe global vs project allow lists | Not started |
| 9 | Plugin bundling | Deferred (solo dev) |
| 10 | Cleanup `.claude/worktrees/agent-*` (EnterWorktree leftovers) | Not started |
| 11 | Disable `rust-analyzer-lsp` plugin (no Rust in tree) | Not started |
| 12 | Verify committed binaries (`pocketbase/pocketbase`, `pocketbase/diagnose_google`) | **Resolved** — `pocketbase/pocketbase` is the runtime (referenced by `start_dev.sh`, `new.sh`, Dockerfile.pocketbase); `diagnose_google` was an orphan OIDC-debug compile output, deleted. Both were gitignored, never tracked. |

---

## 1. Subdir CLAUDE.md — done, with maintenance notes

Files load opportunistically: when Claude touches a file at path `P`, it walks up loading every `CLAUDE.md` along the way. Root + subdir stack — they don't replace.

**Maintenance rule**: when adding to a subdir CLAUDE.md, *delete* the duplicate in root. Pre-push grep for the same phrase in both files is the cheap enforcement.

**Anti-patterns**:
- Putting tactical detail ("when you change X also update Y") — that's a code comment
- Depth beyond top-level surface dirs (no `frontend/src/hooks/CLAUDE.md`)
- Stuffing reusable expertise here that belongs in a skill

---

## 2. `permissions.deny` — Tier 1 applied, Tier 2 pending

Applied (Tier 1, binaries + DBs):

```json
"Read(pb_data/*.db)"
"Read(pb_data/*.db-*)"
"Read(pb_data/storage/**)"
"Read(pocketbase/pocketbase)"
"Read(local/assets/*.png|jpg|jpeg|ico)"
"Edit(pb_data/**)"
"Write(pb_data/**)"
```

Still pending (Tier 2, noise reducers):

```json
"Read(frontend/node_modules/**)"
"Read(frontend/dist/**)"
"Read(pocketbase/pb_public/**)"
"Read(**/__pycache__/**)"
"Read(**/.pytest_cache/**)"
"Read(**/.coverage)"
```

Reason for staging: Tier 1 prevents context destruction; Tier 2 only reduces grep noise. Worth doing but lower leverage.

**Reminder**: deny does NOT block `Bash`. `sqlite3 pb_data/data.db ".schema"` still works (intentionally — preserves DB inspection workflow). If you want to fully restrict, tighten `Bash(cat:*)` and friends — but that has its own cost.

---

## 3. `.claudeignore`

Complements `.gitignore` (which only affects git, not Claude) and `permissions.deny` (hard block). Use for files Claude could read but shouldn't surface in discovery (Grep, Glob).

Candidates:
- `uv.lock`, `frontend/package-lock.json`, `pocketbase/package-lock.json`, `pocketbase/go.sum` — lockfiles, occasionally useful, noisy in grep
- `docs/api/response-examples.md` — large API output dump, useful when debugging contracts, noisy otherwise

Not started.

---

## 4. Stop hook — CLAUDE.md self-improvement

Idea from the upstream blog: at end of session, hook prompts Claude to reflect and propose CLAUDE.md updates while context is fresh. User reviews proposals next session.

For kindred specifically, would help capture solver/sync/PB invariants that get learned in flight but lost. The auto-memory system catches some of this but is user-initiated.

Not started. Implementation sketch:

- `.claude/hooks/stop-claude-md-suggestions.sh` writes to `docs/plans/claude-md-suggestions.md` (gitignored)
- Hook registered in `.claude/settings.json` under `Stop`

---

## 5. SessionStart hook — dynamic context

On session start, inject current state:
- `git worktree list` — which worktree am I in, which exist
- `gh pr list --state open --limit 5` — what's in flight
- `ls docs/plans/*.md` — what's drafted/being tracked
- Last 3 commits — what just happened

Currently a fresh session has to ask. The cost of a 5-line shell script is small; the gain on first-turn quality is real.

Not started.

---

## 6. Custom project subagents

`.claude/agents/` is empty. Today we lean on plugin-provided `Explore` and `general-purpose` — both generic, neither knows kindred.

Candidates by leverage:

| Name | Tools | Model | Job |
|------|-------|-------|-----|
| `solver-investigator` | read-only | sonnet | Knows `bunking/solver/` cold — constraints/, base.py protocols, SolverContext, satisfaction split. Maps the solver in one pass instead of grepping. |
| `pb-migration-auditor` | read-only | haiku | Knows numbering rule, v0.23 syntax change, OnServe history-sync, the `_updated_users.js` outlier. Pre-PR sanity check. |
| `kindred-frontend-pattern-checker` | read-only | sonnet | Verifies new components wrap with ErrorBoundary, use QueryGuard, use centralized queryKeys, use `fetchWithAuth` not raw `fetch`. |
| `solver-config-walker` | read-only | sonnet | Agent form of the existing `solver-config-it` skill — walks CONFIG_SCHEMA, seed migration, GUI, code reads. |

Win isn't "they can do something the main agent can't" — it's:
- Pre-loaded with kindred lore (no need to repeat conventions)
- Don't pollute main context
- Can run in parallel

Don't create these until a specific repeated pain calls for one. Premature subagents go stale.

---

## 7–8. Stale `/home/adam/bunking/` paths + duplicate allow rules

Global `~/.claude/settings.json` has ~8 entries referencing `/home/adam/bunking/` (the pre-rename path). Project `~/kindred/.claude/settings.local.json` has ~4. They're dead rules — match nothing — but clutter the allow list and obscure what's actually needed.

Some entries are hyper-specific (named test files from one investigation). Those should be replaced with broader globs (e.g. `Bash(uv run pytest:*)`).

Also: the project settings.local.json (~31 KB) heavily duplicates global. Cleaner split:
- **Global**: `gh api:*`, `git push:*`, `gh pr view:*`, common shell utilities
- **Project**: `./scripts/worktree/*`, `./scripts/start_dev.sh`, `./scripts/vault*`, project-specific PB curl invocations

Not started.

---

## 9. Plugin bundling — deferred

Upstream guidance: bundle skills + hooks + MCP configs as a plugin so teammates get the full setup via one install. Low priority while solo. Revisit if onboarding anyone.

---

## 10. `.claude/worktrees/agent-*` cleanup

Several leftovers from `EnterWorktree` calls in past sessions (the tool we now avoid in favor of `./scripts/worktree/new.sh`). Visible in `git worktree list` as nested entries under `~/kindred/.claude/worktrees/`.

Audit + `git worktree remove` the stale ones. Not urgent — they don't break anything — but they pollute the worktree list.

---

## 11. `rust-analyzer-lsp` plugin

Enabled in `~/.claude/settings.json` (`"rust-analyzer-lsp@claude-plugins-official": true`) but no Rust in the kindred tree. Disable to avoid spurious LSP probes.

Verified working: `typescript-lsp`, `pyright-lsp`, `gopls-lsp` — binaries installed (`pyright@1.1.408`, `typescript-language-server@5.1.3`, `~/go/bin/gopls`), LSP tool returns symbols correctly.

---

## 12. Committed binaries — resolved

Both were gitignored (`pocketbase/*` blanket rule) and never tracked.

- `pocketbase/pocketbase` (~53 MB) — the actual compiled PocketBase server runtime. Built by `scripts/start_dev.sh`, `scripts/worktree/new.sh`, `docker/Dockerfile.pocketbase`. **Leave alone.** Still in `permissions.deny` to prevent accidental Read.
- `pocketbase/diagnose_google` (~21 MB) — orphan OIDC-diagnostic compile output. Zero references in code, scripts, docs, or git history. **Deleted.**

---

## Re-audit triggers

Don't let this go fully cold. Audit when:

- **Major model release** — old workarounds may now constrain (a rule that forced single-file refactors blocks coordinated cross-file edits on a more capable model)
- **New native feature** — retire hooks/skills the platform now does itself (the blog cites a Perforce `p4 edit` hook that became obsolete when native Perforce support landed)
- **Every 3–6 months** — drift accumulates silently

---

## Reference

Upstream guidance: <https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start>
