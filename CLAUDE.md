# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Kindred

Kindred finds campers who belong together and places them in the right cabins. A constraint satisfaction solver for summer camp cabin assignments (Google OR-Tools) with a full CampMinder data integration system.

**Key data principle:** all cross-table relationships use CampMinder IDs, never PocketBase IDs. This is what keeps data intact across syncs.

---

## 1. Architecture

| Container | Port | Technology | Purpose |
|-----------|------|------------|---------|
| **kindred-caddy** | 8080 | Caddy + static frontend | Reverse proxy, routing, frontend |
| **kindred-pocketbase** | 8090 | Go + SQLite | Database, auth, CampMinder sync |
| **kindred-api** | 8000 | Python + FastAPI | Solver, social graphs, scenarios |
| **kindred-init** | — | Go + shell | One-shot admin/OIDC setup |
| **React Frontend** | 3000 | TypeScript + Vite | Dev server with HMR (development only) |

Caddy uses an **inverse routing pattern** — new FastAPI endpoints work without touching the Caddyfile. Details: `api/CLAUDE.md`.

### Codebase Map

Subdir `CLAUDE.md` files load automatically when you work in that area — they hold the conventions, gotchas, and commands for each surface. This root file covers only what spans surfaces.

| Surface | Where | Subdir context |
|---------|-------|----------------|
| Python core (sync pipeline, satisfaction policy, social graph, RBAC, geo, config) | `bunking/` | `bunking/CLAUDE.md` |
| Solver (OR-Tools CP-SAT, constraints, feasibility) | `bunking/solver/` | `bunking/solver/CLAUDE.md` |
| FastAPI HTTP layer | `api/` | `api/CLAUDE.md` |
| PocketBase (Go, SQLite, CampMinder sync, migrations) | `pocketbase/` | `pocketbase/CLAUDE.md` |
| React UI | `frontend/src/` | `frontend/CLAUDE.md` |
| Tests (pytest + Vitest) | `tests/`, `frontend/src/**/*.test.ts` | `tests/CLAUDE.md` |

**Two footguns worth reading up front, because you hit them before you'd open the subdir file:**

- **Writing a PocketBase migration?** `pocketbase/CLAUDE.md` + `docs/reference/pocketbase-migrations.md` are mandatory. Both the file-numbering rule and the v0.23 field syntax fail *silently* if you guess.
- **Touching CampMinder data tables?** Every one carries a required `year` field — CampMinder reuses session IDs across years. See `pocketbase/CLAUDE.md`.

### Full Documentation

See `/docs`:
- `architecture/` — sync-layer, bunk-request-pipeline, session-types, metrics-module, data-model, solver-internals
- `guides/` — solver-configuration, csv-preparation, request-management, troubleshooting, docker-deployment
- `api/` — solver-api, response-examples
- `reference/` — cli-commands, issue-triage, pocketbase-migrations, tables, commit-conventions, git-workflow, oauth2-setup

Harness improvements roadmap: `docs/reference/claude-harness-improvements.md`.

---

## 2. Daily Workflow

```bash
./scripts/start_dev.sh                                    # Start all services
curl -X POST "http://localhost:8090/api/custom/sync/run?year=2025&service=all" # Trigger sync
uv run pytest tests/                                      # Python tests
cd pocketbase && go test ./...                            # Go tests
cd frontend && npx vitest run                             # Frontend tests (one-shot)
```

Full reference: `/docs/reference/cli-commands.md`. Per-surface test invocations live in each subdir `CLAUDE.md`.

### Commit Conventions

Format: `type(scope): description` — breaking changes: `feat(api)!: description`

| Scope | Area |
|-------|------|
| `frontend` | React, hooks, pages, styles |
| `api` | FastAPI, Python backend |
| `sync` | Go sync, CampMinder |
| `pb` | PocketBase schema, migrations |
| `solver` | OR-Tools solver |
| `docker` | Dockerfiles, compose |
| `ci` | GitHub Actions |
| `auth` | Authentication, OAuth, permissions |
| `google` | Google Sheets/Drive API |
| `logging` | Logging configuration |
| `release` | Release scripts, versioning |
| `config` | Configuration files, incl. agent config (CLAUDE.md, skills) |
| `tests` | Test infrastructure (distinct from the `test:` type) |
| `scripts` | Dev/utility scripts |
| `deps` | Dependencies |
| `deps-dev` | Dev dependency updates |
| `docs` | Documentation files in `docs/` |
| `security` | Security hardening, CVE fixes |
| `metrics` | Analytics, dashboards, statistics |
| `graph` | Social network graph features |
| `rbac` | Roles, permissions, access control |
| `data` | Data models, schema changes |

Scope is **required** and enforced by commitlint — `commitlint.config.js` is the source of truth for both scopes and types. Which `type` to use: `docs/reference/commit-conventions.md`

Commit at logical checkpoints, not micro-commits. Never sweep others' changes into your commits — check `git status` first.

### Configuration Locations

| File | Purpose |
|------|---------|
| `.env` | Environment variables (API keys, credentials) |
| `bunking/.../core/constants.py` | AI thresholds, confidence scoring, name resolution |
| `.golangci.yml` | Go linting rules |
| `ruff.toml` / `pyproject.toml` | Python linting and tooling |
| `frontend/vite.config.ts` | Frontend build configuration |
| `pocketbase/pb_migrations/*.js` | Database schema (source of truth) |

Runtime config is **database-driven** — the PocketBase `config` table, not JSON files. AI settings are the exception: env vars (`AI_API_KEY`, `AI_MODEL`, `AI_PROVIDER`).

### Logging

Format: `2026-01-06T14:05:52Z [source] LEVEL message key=value...`. `LOG_LEVEL=INFO` (default) suppresses health checks; `DEBUG` for verbose. Language-specific setup: `bunking/CLAUDE.md` (Python), `pocketbase/CLAUDE.md` (Go).

### Git Hooks (Lefthook)

Managed via `.lefthook.yml`. Setup once after cloning: `./scripts/setup-git-hooks.sh`

| Stage | What runs | Speed |
|-------|-----------|-------|
| **pre-commit** | Formatters on staged files (prettier, ruff format, gofmt) | <1s |
| **commit-msg** | commitlint validation | Instant |
| **pre-push** | Type checks (mypy, tsc), go build, fast linters (ruff, shellcheck, pb-js-lint), full mockable pytest | ~40s |
| **post-merge** | Worktree cleanup notifications | ~5s |

Escape hatches and manual runs: `docs/reference/git-workflow.md`

### Error Handling

Surface-specific — `frontend/CLAUDE.md` (ErrorBoundary + QueryGuard) and `api/CLAUDE.md` (global FastAPI exception handler).

---

## 3. Domain Knowledge

Read the relevant doc before working in these areas:

- **`docs/architecture/sync-layer.md`** — before adding/modifying sync jobs
- **`docs/architecture/bunk-request-pipeline.md`** — CSV upload, `original_bunk_requests`, request processing, name resolution, AI parse/disambiguation
- **`docs/architecture/metrics-module.md`** — before adding/modifying metrics
- **`docs/architecture/session-types.md`** — sessions, bunking, AG logic

**Attendee filtering:** the solver treats `status_id = 2` as active enrolled. Easy to miss and silently wrong if you filter differently.

### Tooling

- **Versions** — Python 3.14+, Go 1.26+, Node 22+, TypeScript 6.0+/ES2022
- **Use uv** — `uv sync` to install, `uv run <cmd>` to execute
- **AI model** — GPT-5-nano via `AI_MODEL` env var (reasoning enabled)
- **Token caching** — CampMinder JWT cached in `~/.campminder_token_cache.json`
- **IPv4 in production** — Caddy/Vite configs use `127.0.0.1`; scripts may use localhost

---

## 4. Critical Rules

### Worktrees & Branches

**Never commit or push to `main`.** All changes go through a feature branch and PR.

**Create worktrees with `./scripts/worktree/new.sh <feature-name>`** — never bare `git worktree add`, never `EnterWorktree`. The script handles port allocation (so parallel worktrees don't collide), branch naming, DB seed from main, and local-config symlinks. A `PreToolUse` hook blocks the bare command; if it denies a call, switch to `new.sh`.

Working directly in the main repo folder needs the user's explicit say-so — assume a worktree otherwise, since other agents may hold uncommitted changes there.

Worktree mechanics (ports, isolation, cleanup): `docs/reference/git-workflow.md`

### Secrets, Privacy & Test Data

**Environment secrets** load from `.env` via `start_dev.sh`.

**Private files** (branding, staff lists, assets) live in the private `kindred-local` repo: `config/branding.local.json`, `config/staff_list.json`, `local/assets/`, `CLAUDE.local.md`, `frontend/vite.config.local.ts`, `scripts/vault.config`, `docs/camp/`. Local dev symlinks them via `scripts/setup/setup-local-config.sh`; CI/CD clones via deploy key. Without them the system falls back to generic "Kindred" branding.

**Never use real personal information** in code, tests, comments, docs, commits, issues, or PRs — real camper/family/staff names, schools, or CampMinder IDs. Use the fictional set (list and examples in `tests/CLAUDE.md`), `{camp_name}` placeholders instead of hardcoded camp names, and generic session IDs. This applies to public artifacts most of all: a name that reaches a GitHub issue or PR body is a real privacy leak.

OAuth2 / OIDC setup: `docs/reference/oauth2-setup.md`

### Test-Driven Development

Write failing tests first, verify they fail, then implement. **Tests are the specification — never edit a test to match what the implementation happens to do.** Tests and implementation may land in the same commit (PRs are squash-merged); what matters is the order you write them in. Marker semantics and which tests are skipped in CI: `tests/CLAUDE.md`.

### CI/CD & Branch Protection

**CI** runs on every push (~2-3 min): linting, type checking, unit tests.
**CD** runs on merge to main (~10-15 min): Docker builds, Trivy scanning, integration tests, images tagged `latest` and `sha-<commit>`.

`main` is protected by a GitHub Ruleset: required "CI Summary" status check, required linear history (squash only), and **no bypass actors** — admins included. Every change needs a PR with green CI; there is no emergency override.

Release process: `docs/reference/git-workflow.md`
