# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Kindred

Kindred finds campers who belong together and places them in the right cabins. A constraint satisfaction solver for optimizing summer camp cabin assignments using Google OR-Tools with a full CampMinder data integration system.

---

## 1. Architecture

### System Architecture

#### Multi-Container Architecture
```text
CampMinder API → Go Sync ─┐
                          │
React Frontend ──────────┼──→ 4 Docker containers
                          │
OR-Tools Solver ─────────┘
```

| Container | Port | Technology | Purpose |
|-----------|------|------------|---------|
| **kindred-caddy** | 8080 | Caddy + static frontend | Reverse proxy, routing, frontend |
| **kindred-pocketbase** | 8090 | Go + SQLite | Database, auth, CampMinder sync |
| **kindred-api** | 8000 | Python + FastAPI | Solver, social graphs, scenarios |
| **kindred-init** | — | Go + shell | One-shot admin/OIDC setup |
| **React Frontend** | 3000 | TypeScript + Vite | Dev server with HMR (development only) |

**Routing (Inverse Pattern)**: Caddy routes specific PocketBase patterns (`/api/collections/*`, `/api/files/*`, `/api/realtime`, `/api/custom/*`, `/api/oauth2-redirect`) to PocketBase. All other `/api/*` requests go to FastAPI. This eliminates route enumeration - new FastAPI endpoints automatically work. See `docker/Caddyfile` (prod) and `frontend/Caddyfile` (dev) for routing rules.

#### Key Data Principle
**All cross-table relationships use CampMinder IDs, never PocketBase IDs.** This ensures data integrity during syncs.

### Codebase Map

Subdir `CLAUDE.md` files load automatically when you edit files in that area — they contain conventions, gotchas, and commands specific to each surface. Root file (this one) covers cross-cutting rules; surface specifics live below.

| Surface | Where | Subdir context |
|---------|-------|----------------|
| Python core (sync pipeline, satisfaction policy, social graph, RBAC, geo, config) | `bunking/` | `bunking/CLAUDE.md` |
| Solver (OR-Tools CP-SAT, constraints, feasibility) | `bunking/solver/` | `bunking/solver/CLAUDE.md` |
| FastAPI HTTP layer | `api/` | `api/CLAUDE.md` |
| PocketBase (Go, SQLite, CampMinder sync, migrations) | `pocketbase/` | `pocketbase/CLAUDE.md` |
| React UI | `frontend/src/` | `frontend/CLAUDE.md` |
| Tests (pytest + Vitest) | `tests/`, `frontend/src/**/*.test.ts` | `tests/CLAUDE.md` |

Harness improvements roadmap: `docs/reference/claude-harness-improvements.md`.

### 📚 Full Documentation

See `/docs`:
- `architecture/` — sync-layer, bunk-request-pipeline, session-types, metrics-module, data-model, solver-internals
- `guides/` — solver-configuration, csv-preparation, request-management, troubleshooting, docker-deployment
- `api/` — solver-api, response-examples
- `reference/` — cli-commands, issue-triage, pocketbase-migrations, tables, commit-conventions, git-workflow, oauth2-setup

---

## 2. Daily Workflow

### Quick Development Commands

```bash
./scripts/start_dev.sh                                    # Start all services
curl -X POST "http://localhost:8090/api/custom/sync/run?year=2025&service=all" # Trigger sync
uv run pytest tests/                                      # Python tests
uv run pytest tests/path/test_file.py::test_name          # Single Python test
uv run pytest tests/ -k "keyword"                         # Python tests by keyword
cd pocketbase && go test ./...                            # Go tests
cd frontend && npx vitest run                             # Frontend tests (one-shot)
cd frontend && npx vitest run src/path/file.test.ts       # Single frontend test
```

Full reference: `/docs/reference/cli-commands.md`

### Commit Conventions

Format: `type(scope): description` — Breaking changes: `feat(api)!: description`

| Scope | Area |
|-------|------|
| `frontend` | React, hooks, pages, styles |
| `api` | FastAPI, Python backend |
| `sync` | Go sync, CampMinder |
| `pb` | PocketBase schema, migrations |
| `solver` | OR-Tools solver |
| `docker` | Dockerfiles, compose |
| `ci` | GitHub Actions |
| `google` | Google Sheets/Drive API |
| `scripts` | Dev/utility scripts |
| `deps` | Dependencies |
| `deps-dev` | Dev dependency updates |
| `docs` | Documentation |
| `security` | Security hardening, CVE fixes |
| `metrics` | Analytics, dashboards, statistics |
| `graph` | Social network graph features |
| `rbac` | Roles, permissions, access control |
| `data` | Data models, schema changes |

**Which `type` to use** — the full decision procedure: `docs/reference/commit-conventions.md`

**Commit behavior:**
- Commit at logical checkpoints, not micro-commits
- Squash related commits before pushing
- Never add others' changes to your commits (check `git status` first)

### Configuration Locations

| File | Purpose |
|------|---------|
| `.env` | Environment variables (API keys, credentials) |
| `bunking/.../core/constants.py` | AI thresholds, confidence scoring, name resolution |
| `.golangci.yml` | Go linting rules |
| `ruff.toml` / `pyproject.toml` | Python linting and tooling |
| `frontend/vite.config.ts` | Frontend build configuration |
| `pocketbase/pb_migrations/*.js` | Database schema (source of truth) |

### Logging Standards

Format: `2026-01-06T14:05:52Z [source] LEVEL message key=value...`. `LOG_LEVEL=INFO` (default) suppresses health checks; `DEBUG` for verbose. Language-specific setup: `bunking/CLAUDE.md` (Python), `pocketbase/CLAUDE.md` (Go).

### Git Hooks (Lefthook)

Hooks are managed by [lefthook](https://github.com/evilmartians/lefthook) via `.lefthook.yml`.

**Setup:** `./scripts/setup-git-hooks.sh` (run once after cloning)

| Stage | Trigger | What runs | Speed |
|-------|---------|-----------|-------|
| **pre-commit** | Every commit | Formatters on staged files (prettier, ruff format, gofmt) | <1s |
| **commit-msg** | Every commit | commitlint validation | Instant |
| **pre-push** | Every push | Type checks (mypy, tsc), go build, fast linters (ruff, shellcheck, pb-js-lint), full mockable pytest (`SKIP_POCKETBASE_TESTS=true`, xdist) | ~40s |
| **post-merge** | After pull | Worktree cleanup notifications | ~5s |

Escape hatches and manual runs: `docs/reference/git-workflow.md`

### Error Handling Conventions

Surface-specific — see `frontend/CLAUDE.md` (ErrorBoundary + QueryGuard patterns) and `api/CLAUDE.md` (global FastAPI exception handler).

---

## 3. Domain Knowledge

### Domain References

> **Sync layer:** `docs/architecture/sync-layer.md` — Read before adding/modifying sync jobs.
>
> **Bunk-request pipeline:** `docs/architecture/bunk-request-pipeline.md` — Read before working on CSV upload, original_bunk_requests, bunk request processing, name resolution, or the AI parse/disambiguation pipeline.
>
> **Metrics module:** `docs/architecture/metrics-module.md` — Read before adding/modifying metrics.
>
> **Session types:** `docs/architecture/session-types.md` — Read before working with sessions, bunking, or AG logic.

### Development Notes

#### Invariants (cross-cutting)
Internalize these — violating them produces incorrect code or data corruption. Surface-specific invariants live in the corresponding subdir CLAUDE.md.

1. **CampMinder IDs** — all cross-table relationships use CM IDs, never PocketBase IDs
2. **Sync order matters** — sessions → attendees → persons → bunks → plans → assignments → requests
3. **Family-camp data syncs alongside summer data** — summer-camp views must filter `session_type` against `VALID_SUMMER_SESSION_TYPES` (frontend) / `valid_summer_session_types` equivalents
4. **Config is database-driven** — PocketBase `config` table, not JSON files. AI settings via env vars (`AI_API_KEY`, `AI_MODEL`, `AI_PROVIDER`)
5. **Year-aware syncs** — uses `season_id` from config; ready for new year with config update
6. **Sequential session syncs** — sessions 1-4 run sequentially with independent history
7. **WAL checkpoint required** after database modifications
8. **Attendee filtering** — solver uses `status_id = 2` for active enrolled attendees

#### Tooling Notes
1. **Language Versions** — Python 3.14+, Go 1.26+, Node 22+, TypeScript 6.0+/ES2022
2. **Use uv** — `uv sync` to install, `uv run <cmd>` to execute
3. **AI model** — GPT-5-nano via `AI_MODEL` env var ($0.05/$0.40 per M tokens, reasoning enabled)
4. **Token caching** — CampMinder JWT cached in `~/.campminder_token_cache.json`
5. **IPv4 in production** — Caddy/Vite configs use `127.0.0.1`; scripts may use localhost

---

## 4. Critical Rules

**These are non-negotiable. They protect parallel-agent work, production data, and release integrity.**

### Worktrees & Branches

**NEVER commit or push to `main`.** All changes go through a feature branch and PR. Main is protected; direct pushes fail anyway.

**ALWAYS create worktrees via `./scripts/worktree/new.sh` — never bare `git worktree add`, never `EnterWorktree`.** Before starting ANY feature work:
```bash
./scripts/worktree/new.sh <descriptive-feature-name>
cd ../kindred-worktrees/<feature-name>
```

The script does setup `git worktree add` skips: port allocation (Vite/FastAPI/Caddy/PocketBase offsets so parallel worktrees don't collide), branch naming (`feature/<name>`), DB seed from main, local-config symlinks. Bypassing it has caused parallel-agent port collisions on recent PRs.

A `PreToolUse` hook (`.claude/hooks/worktree-guard.sh`) blocks direct `git worktree add` invocations. If it denies a call, that's working as intended — switch to `new.sh`.

**When can I work in the main repo folder?** Only if BOTH conditions are met:

| Condition | How to Verify |
|-----------|---------------|
| **A) Frontend-only change the user wants to preview** | Ask: "This is a frontend change - do you want to preview it in the main repo before I create a worktree?" |
| **B) User confirms solo work** | Ask: "Are we working solo without other agents, so it's safe to work in the main repo?" |

If the user doesn't explicitly confirm BOTH, **create a worktree**.

```text
Starting new work?
├─ Is it a frontend preview AND user confirmed solo work?
│  └─ YES to BOTH → OK to work in main folder on a branch
│  └─ NO to either → CREATE A WORKTREE
└─ When in doubt → CREATE A WORKTREE
```

**Why this matters:** multiple agents may be working in parallel on different features; working in the main folder can collide with their uncommitted changes; worktrees provide complete isolation (code, database, ports); the seeded worktree database protects production data.

Worktree mechanics (ports, isolation, cleanup): `docs/reference/git-workflow.md`

### Year Data Integrity

**The problem:** CampMinder reuses session IDs across years. The `year` field prevents data contamination.

**Prevention rules:**
1. **Year field required** — All CampMinder data tables (`attendees`, `bunk_assignments`, `bunk_plans`, etc.) have a required `year` field
2. **Go sync enforces year** — All sync operations filter by `CAMPMINDER_SEASON_ID` from `.env`
3. **Frontend year dropdown is display-only** — Does not affect sync jobs

**Schema pattern:**
- **Relation fields** (`person`, `session`, `bunk`) for PocketBase joins
- **CampMinder IDs** (`cm_id`, `person_id`) for sync lookups
- **Unique indexes** include year (e.g., `person_id, year, session`)

### PocketBase Migrations

> **MANDATORY:** Read `docs/reference/pocketbase-migrations.md` before writing ANY migration. PocketBase v0.23+ changed field property syntax — using the old `options: {}` wrapper pattern causes silent data truncation.

**Numbering rule:** New migrations MUST use a number greater than the highest filename in `pocketbase/pb_migrations/` on `origin/main`. Do not fill numbering gaps left by past consolidations.

```bash
HIGHEST=$(git ls-tree -r origin/main pocketbase/pb_migrations/ \
  | awk '{print $4}' | grep -oE '15000[0-9]{5}' | sort -u | tail -1)
NEXT=$((HIGHEST + 1))
```

Within an unmerged PR you may iterate, rename, or renumber your own new migrations freely — reset the dev DB to re-apply if you change a filename or content. Once merged to `main`, the file is frozen; if a competing PR landed on `main` first and took your number, bump above the new HEAD.

History: gaps may exist from migration consolidation runs (skill: `consolidate-migrations`, gitignored tracking doc: `docs/plans/migration-consolidation.md`). Those numbers are NOT free for reuse — they're "burned" to preserve a monotonically increasing record. The OnServe history-sync hook in `pocketbase/main.go` keeps prod's `_migrations` table in sync with the on-disk file list automatically on every server boot.

### Secrets, Privacy & Test Data

#### Environment & Private Files
**Environment secrets:** Loaded from `.env` by `start_dev.sh`.

**Private files** (branding, staff lists, assets): Stored in private `kindred-local` repo.
- **Local dev**: Run `scripts/setup/setup-local-config.sh` to symlink files
- **CI/CD**: Cloned via deploy key during Docker build

Files: `config/branding.local.json`, `config/staff_list.json`, `local/assets/`, `CLAUDE.local.md`, `frontend/vite.config.local.ts`, `scripts/vault.config`, `docs/camp/`

#### NEVER Use Real Personal Information
All code, tests, comments, and documentation MUST use fictional data:

1. **Camper/Family Names**: Use the standard fake name list (Emma Johnson, Liam Garcia, Olivia Chen, etc.)
2. **Staff Names**: Use names from `config/staff_list.json` (all fictional)
3. **Schools**: Use fictional school names (Riverside Elementary, Oak Valley Middle, Hillcrest High)
4. **Phone/Email**: Use obviously fake data (555-0100, <test@example.com>)
5. **Camp Branding**: Use `{camp_name}` placeholder in prompts, never hardcode camp names
6. **Session IDs**: Use generic IDs (1000001, 1000002) in examples, not real CampMinder IDs

#### Branding Configuration
Generic "Kindred" branding by default. Camp-specific branding from `kindred-local` repo:
- `config/branding.local.json` - Camp name, descriptions, SSO display name
- `local/assets/` - Camp logos (`camp-logo.png`, `camp-logo-nav.png`)

Without these files (or symlinks), the system uses generic defaults.

OAuth2 / OIDC setup: `docs/reference/oauth2-setup.md`

### Test-Driven Development (TDD)

**You MUST follow TDD methodology for all new feature development:**

1. **Write Tests FIRST**: Create failing tests that define the expected behavior
2. **Verify Tests Fail**: Run tests to confirm they fail before writing implementation (red phase)
3. **Implement to Pass Tests**: Write minimal code to make tests pass
4. **Never Modify Tests to Match Implementation**: Tests define the spec, not the other way around

Tests and implementation may be in the same commit — PRs are squash-merged so commit granularity doesn't matter. What matters is the **workflow discipline**: tests are written first and verified failing before implementation begins.

**Anti-patterns to avoid:**
- ❌ Writing tests after implementation
- ❌ Modifying tests to match implementation behavior
- ❌ Skipping the "red" phase (tests must fail first)

**Remember**: Tests are the SPECIFICATION. Implementation must conform to tests, not the other way around!

### CI/CD & Branch Protection

**CI** runs on every push (~2-3 min): linting (ruff, eslint, golangci-lint), type checking (mypy, TypeScript), unit tests (Python, Go, TypeScript).

**CD** runs on every merge to main (~10-15 min): Docker image builds, Trivy security scanning, integration tests, pushes images tagged `latest` and `sha-<commit>`.

**Branch protection** — `main` is protected by a GitHub Ruleset:
- **Required status check "CI Summary"** — all CI checks must pass before merge
- **Required linear history** — squash merge only, no merge commits
- **No bypass actors** — even admins cannot push directly to main

**Implications:** all changes require a PR; CI must pass before merge; squash-merge only; no emergency bypass.

Release process (version tags, running the Release workflow): `docs/reference/git-workflow.md`
