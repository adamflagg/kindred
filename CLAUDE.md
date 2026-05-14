# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Kindred

Kindred finds campers who belong together and places them in the right cabins. A constraint satisfaction solver for optimizing summer camp cabin assignments using Google OR-Tools with a full CampMinder data integration system.

---

# 1. Architecture

## System Architecture

### Multi-Container Architecture
```
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

### Key Data Principle
**All cross-table relationships use CampMinder IDs, never PocketBase IDs.** This ensures data integrity during syncs.

## Codebase Map

### Python Backend (`bunking/`)
Core solver + data-processing package. `api/` is a thin HTTP layer over it.

| Module/Package | Purpose |
|----------------|---------|
| `solver/` | OR-Tools CP-SAT solver (see below) |
| `sync/bunk_request_processor/` | CSV → AI parse → name resolution → disposition pipeline |
| `satisfaction/` | Single source of truth for "is request X satisfied?" — RequestBucket policy, per-request predicate, per-camper/session aggregation |
| `metrics/` | Analytics aggregation |
| `graph/` | Social graph construction + caching — `SocialGraphBuilder` is the public API |
| `rbac/` | FastAPI permission dependencies (small; the Go side has its own `pocketbase/rbac/`) |
| `geo_normalizer/` | City/state normalization against `uscities.csv` |
| `config/` | `ConfigLoader` — reads the PocketBase `config` table |
| `models_v2.py` | `DirectSolver*` dataclasses — the solver's I/O contract |
| `bunking_validator.py` | Analyzes assignments and reports validation issues — consumed by `api/routers/validation.py` |
| `auth_middleware.py` / `jwt_auth.py` | PocketBase JWT verification for FastAPI |

### Solver (`bunking/solver/`)
CP-SAT model built from composable **constraint builders**. Entry: `direct_solver.py`.
- `constraints/` — one module per concern (gender, age_spread, grade_adjacency, bunk_requests, parent_paramount, group_locks, level_progression, …). Each follows the `ConstraintBuilder`/`ObjectiveBuilder` protocols in `constraints/base.py`.
- `SolverContext` (`constraints/base.py`) — shared state threaded through builders.
- `feasibility.py` / `impossibility.py` — diagnose infeasible models.
- Organized by Tier / Stage / RequestBucket. Read before touching the solver: `docs/reference/solver-roadmap.md`, `docs/guides/solver-configuration.md`, `docs/api/solver-api.md`.

### FastAPI (`api/`)
Routers in `api/routers/` (solver, scenarios, social_graph, satisfaction, requests, metrics, validation, geo, debug, internal). Schemas in `api/schemas/`, helpers in `api/utils/`. Business logic lives in `bunking/`, not here.

### PocketBase Go (`pocketbase/`)
Entry: `main.go`. Packages: `sync/` + `campminder/`, `rbac/`, `feedback/`, `google/`, `bunk_requests/`, `ratelimit/`, `logging/`, `pb_hooks/` (JS hooks), `pb_migrations/` (schema source of truth).

### Frontend (`frontend/src/`)

| Directory | Purpose |
|-----------|---------|
| `components/` | Reusable React components |
| `components/graph/` | Social network graph modules (styles, interactions, layout, UI) |
| `pages/` | Route-level page components |
| `hooks/` | Custom React hooks (data fetching, state) |
| `services/` | API clients, business logic |
| `types/` | TypeScript type definitions |
| `lib/` | Third-party library integrations |
| `contexts/` | React context providers |

**Key Component Patterns:**
- **Modular extraction**: Large components like `SocialNetworkGraph.tsx` are decomposed into utility modules
- **Custom hooks**: Data fetching logic extracted to hooks (`useSocialGraphData`, `useBunkNames`, `useSessionHierarchy`)
- **Barrel exports**: Component directories use `index.ts` for clean imports

**Technologies**: React 19, TypeScript 5.8+, Vite, Tailwind CSS, React Query, @dnd-kit, Cytoscape.js

### Tests (`tests/`)
`tests/{unit,integration,e2e,performance}/`. Markers (`pyproject.toml`, strict mode — an unregistered marker is a failure): `ai_required` and `pocketbase_required` are **skipped in CI** (they need live AI tokens / a running PocketBase). Run them locally with a dev server up.

## 📚 Full Documentation

See `/docs`:
- `architecture/` — sync-layer, bunk-request-pipeline, session-types, metrics-module, data-model
- `guides/` — solver-configuration, csv-preparation, request-management, troubleshooting, docker-deployment
- `api/` — solver-api, response-examples
- `reference/` — cli-commands, issue-triage, pocketbase-migrations, tables, solver-roadmap, commit-conventions, git-workflow, oauth2-setup

---

# 2. Daily Workflow

## Quick Development Commands

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

## Commit Conventions

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

## Configuration Locations

| File | Purpose |
|------|---------|
| `.env` | Environment variables (API keys, credentials) |
| `bunking/.../core/constants.py` | AI thresholds, confidence scoring, name resolution |
| `.golangci.yml` | Go linting rules |
| `ruff.toml` / `pyproject.toml` | Python linting and tooling |
| `frontend/vite.config.ts` | Frontend build configuration |
| `pocketbase/pb_migrations/*.js` | Database schema (source of truth) |

## Logging Standards

Format: `2026-01-06T14:05:52Z [source] LEVEL message key=value...`

- Python: `from bunking.logging_config import configure_logging, get_logger`
- Go: `import "github.com/camp/kindred/pocketbase/logging"` then `logging.Init("pocketbase")`
- `LOG_LEVEL=INFO` (default) suppresses health checks; use `DEBUG` for verbose

## Git Hooks (Lefthook)

Hooks are managed by [lefthook](https://github.com/evilmartians/lefthook) via `.lefthook.yml`.

**Setup:** `./scripts/setup-git-hooks.sh` (run once after cloning)

| Stage | Trigger | What runs | Speed |
|-------|---------|-----------|-------|
| **pre-commit** | Every commit | Formatters on staged files (prettier, ruff format, gofmt) | <1s |
| **commit-msg** | Every commit | commitlint validation | Instant |
| **pre-push** | Every push | Type checks (mypy, tsc), go build, fast linters (ruff, shellcheck, pb-js-lint) | ~15s |
| **post-merge** | After pull | Worktree cleanup notifications | ~5s |

Escape hatches and manual runs: `docs/reference/git-workflow.md`

## Error Handling Conventions

**Frontend:**
- **Page-level `<ErrorBoundary>`**: Every lazy-loaded route in `App.tsx` is wrapped with `<ErrorBoundary>` around `<Suspense>`. This isolates crashes to the affected page — nav and other routes remain functional. New routes MUST follow this pattern.
- **`<QueryGuard>`** (`components/QueryGuard.tsx`): Render-prop component that handles loading/error/empty/success states for React Query data. Use it in new data-fetching pages to avoid hand-rolling the same if/isLoading/if/error pattern. Existing pages use inline patterns — don't refactor them unless already touching that code.
- **All 4 states must be handled**: loading, error, empty, success. Never render a data-dependent component without checking the query state first.

**Backend:**
- **Global exception handler** in `api/main.py` catches unhandled exceptions and returns `{"detail": "Internal server error"}` (generic). Full error details are logged server-side with `exc_info=True`. Never use `raise HTTPException(status_code=500, detail=str(e))` — let the global handler catch it instead.

## Tour & Hint Maintenance

When modifying page layout, features, or `data-tour` attributes on a toured page, review and update the corresponding tour definition in `frontend/src/tours/definitions/`.
Checklist:
- [ ] data-tour attributes still reference correct elements
- [ ] isReady() still checks the right element
- [ ] Step/hint descriptions match current behavior
- [ ] Bump `version` if steps changed (triggers re-play for returning users)

---

# 3. Domain Knowledge

## Domain References

> **Sync layer:** `docs/architecture/sync-layer.md` — Read before adding/modifying sync jobs.
>
> **Bunk-request pipeline:** `docs/architecture/bunk-request-pipeline.md` — Read before working on CSV upload, original_bunk_requests, bunk request processing, name resolution, or the AI parse/disambiguation pipeline.
>
> **Metrics module:** `docs/architecture/metrics-module.md` — Read before adding/modifying metrics.
>
> **Session types:** `docs/architecture/session-types.md` — Read before working with sessions, bunking, or AG logic.

## Development Notes

### Invariants
Internalize these — violating them produces incorrect code or data corruption.

1. **CampMinder IDs** — All cross-table relationships use CM IDs, never PocketBase IDs
2. **Sync order matters** — sessions → attendees → persons → bunks → plans → assignments → requests
3. **Family-camp data syncs** alongside summer data — summer-camp views must filter `session_type` against `VALID_SUMMER_SESSION_TYPES` (frontend) / `valid_summer_session_types` equivalents to avoid leaking family-camp sessions, attendees, or bunks
4. **Config is database-driven** — PocketBase `config` table, not JSON files. AI settings via env vars (`AI_API_KEY`, `AI_MODEL`, `AI_PROVIDER`)
5. **Year-aware syncs** — Uses `season_id` from config; ready for new year with config update
6. **Sequential session syncs** — Sessions 1-4 run sequentially with independent history
7. **WAL checkpoint** — Required after database modifications
8. **PocketBase filter syntax** — ALWAYS spaces around operators (`field = value` not `field=value`)
9. **React auth guards** — Check `isLoading` from `useAuth()` before authenticated API calls
10. **React Query keys** — Use centralized keys from `frontend/src/utils/queryKeys.ts`
11. **Attendee filtering** — Solver uses `status_id = 2` for active enrolled attendees
12. **mypy strict mode** — `pyproject.toml` runs mypy with `strict = true`; all new Python must be fully type-annotated or pre-push fails
13. **Spelling: "cancelled"** — PocketBase fields use British spelling (`cancelled_count`). Go linter allows it via `.golangci.yml` extra-words. Use `cancelled` consistently, not `canceled`

### Tooling Notes
1. **Language Versions** — Python 3.14+, Go 1.26+, Node 22+, TypeScript 5.8+/ES2022
2. **Use uv** — `uv sync` to install, `uv run <cmd>` to execute
3. **AI model** — GPT-5-nano via `AI_MODEL` env var ($0.05/$0.40 per M tokens, reasoning enabled)
4. **Token caching** — CampMinder JWT cached in `~/.campminder_token_cache.json`
5. **IPv4 in production** — Caddy/Vite configs use `127.0.0.1`; scripts may use localhost
6. **Python line length** — 120 chars (configured in `ruff.toml`), enforced by ruff format
7. **Frontend tests** — Vitest (not Jest); `npm run test` for watch mode, `npx vitest run` for one-shot

---

# 4. 🚨 Critical Rules

**These are non-negotiable. They protect parallel-agent work, production data, and release integrity.**

## Worktrees & Branches

**NEVER commit or push to `main`.** All changes go through a feature branch and PR. Main is protected; direct pushes fail anyway.

**ALWAYS use a worktree for feature work.** Before starting ANY feature work:
```bash
./scripts/worktree/new.sh <descriptive-feature-name>
cd ../kindred-worktrees/<feature-name>
```

**When can I work in the main repo folder?** Only if BOTH conditions are met:

| Condition | How to Verify |
|-----------|---------------|
| **A) Frontend-only change the user wants to preview** | Ask: "This is a frontend change - do you want to preview it in the main repo before I create a worktree?" |
| **B) User confirms solo work** | Ask: "Are we working solo without other agents, so it's safe to work in the main repo?" |

If the user doesn't explicitly confirm BOTH, **create a worktree**.

```
Starting new work?
├─ Is it a frontend preview AND user confirmed solo work?
│  └─ YES to BOTH → OK to work in main folder on a branch
│  └─ NO to either → CREATE A WORKTREE
└─ When in doubt → CREATE A WORKTREE
```

**Why this matters:** multiple agents may be working in parallel on different features; working in the main folder can collide with their uncommitted changes; worktrees provide complete isolation (code, database, ports); the seeded worktree database protects production data.

Worktree mechanics (ports, isolation, cleanup): `docs/reference/git-workflow.md`

## Year Data Integrity

**The problem:** CampMinder reuses session IDs across years. The `year` field prevents data contamination.

**Prevention rules:**
1. **Year field required** — All CampMinder data tables (`attendees`, `bunk_assignments`, `bunk_plans`, etc.) have a required `year` field
2. **Go sync enforces year** — All sync operations filter by `CAMPMINDER_SEASON_ID` from `.env`
3. **Frontend year dropdown is display-only** — Does not affect sync jobs

**Schema pattern:**
- **Relation fields** (`person`, `session`, `bunk`) for PocketBase joins
- **CampMinder IDs** (`cm_id`, `person_id`) for sync lookups
- **Unique indexes** include year (e.g., `person_id, year, session`)

## PocketBase Migrations

> **MANDATORY:** Read `docs/reference/pocketbase-migrations.md` before writing ANY migration. PocketBase v0.23+ changed field property syntax — using the old `options: {}` wrapper pattern causes silent data truncation.

**Numbering rule:** New migrations MUST use a number greater than the highest filename in `pocketbase/pb_migrations/` on `origin/main`. Do not fill numbering gaps left by past consolidations.

```bash
HIGHEST=$(git ls-tree -r origin/main pocketbase/pb_migrations/ \
  | awk '{print $4}' | grep -oE '15000[0-9]{5}' | sort -u | tail -1)
NEXT=$((HIGHEST + 1))
```

Within an unmerged PR you may iterate, rename, or renumber your own new migrations freely — reset the dev DB to re-apply if you change a filename or content. Once merged to `main`, the file is frozen; if a competing PR landed on `main` first and took your number, bump above the new HEAD.

History: gaps may exist from migration consolidation runs (skill: `consolidate-migrations`, gitignored tracking doc: `docs/plans/migration-consolidation.md`). Those numbers are NOT free for reuse — they're "burned" to preserve a monotonically increasing record. The OnServe history-sync hook in `pocketbase/main.go` keeps prod's `_migrations` table in sync with the on-disk file list automatically on every server boot.

## Secrets, Privacy & Test Data

### Environment & Private Files
**Environment secrets:** Loaded from `.env` by `start_dev.sh`.

**Private files** (branding, staff lists, assets): Stored in private `kindred-local` repo.
- **Local dev**: Run `scripts/setup/setup-local-config.sh` to symlink files
- **CI/CD**: Cloned via deploy key during Docker build

Files: `config/branding.local.json`, `config/staff_list.json`, `local/assets/`, `CLAUDE.local.md`, `frontend/vite.config.local.ts`, `scripts/vault.config`, `docs/camp/`

### NEVER Use Real Personal Information
All code, tests, comments, and documentation MUST use fictional data:

1. **Camper/Family Names**: Use the standard fake name list (Emma Johnson, Liam Garcia, Olivia Chen, etc.)
2. **Staff Names**: Use names from `config/staff_list.json` (all fictional)
3. **Schools**: Use fictional school names (Riverside Elementary, Oak Valley Middle, Hillcrest High)
4. **Phone/Email**: Use obviously fake data (555-0100, test@example.com)
5. **Camp Branding**: Use `{camp_name}` placeholder in prompts, never hardcode camp names
6. **Session IDs**: Use generic IDs (1000001, 1000002) in examples, not real CampMinder IDs

### Branding Configuration
Generic "Kindred" branding by default. Camp-specific branding from `kindred-local` repo:
- `config/branding.local.json` - Camp name, descriptions, SSO display name
- `local/assets/` - Camp logos (`camp-logo.png`, `camp-logo-nav.png`)

Without these files (or symlinks), the system uses generic defaults.

OAuth2 / OIDC setup: `docs/reference/oauth2-setup.md`

## Test-Driven Development (TDD)

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

## CI/CD & Branch Protection

**CI** runs on every push (~2-3 min): linting (ruff, eslint, golangci-lint), type checking (mypy, TypeScript), unit tests (Python, Go, TypeScript).

**CD** runs on every merge to main (~10-15 min): Docker image builds, Trivy security scanning, integration tests, pushes images tagged `latest` and `sha-<commit>`.

**Branch protection** — `main` is protected by a GitHub Ruleset:
- **Required status check "CI Summary"** — all CI checks must pass before merge
- **Required linear history** — squash merge only, no merge commits
- **No bypass actors** — even admins cannot push directly to main

**Implications:** all changes require a PR; CI must pass before merge; squash-merge only; no emergency bypass.

Release process (version tags, running the Release workflow): `docs/reference/git-workflow.md`
