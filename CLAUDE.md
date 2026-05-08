# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Kindred

Kindred finds campers who belong together and places them in the right cabins. A constraint satisfaction solver for optimizing summer camp cabin assignments using Google OR-Tools with a full CampMinder data integration system.

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

## 📚 Full Documentation

See `/docs`: architecture/, guides/, api/, reference/cli-commands.md, reference/issue-triage.md

## Commit Scopes

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

## Commit Types

Pick the most specific type before defaulting to `feat`/`fix`. The release
changelog groups by type, so mis-typing hides work (e.g. `chore` and `ci` are
skipped from the changelog entirely).

**Decision order — use the first that matches:**

1. Diff touches only `.github/workflows/` → `ci`
2. Diff touches only `docs/` or top-level markdown → `docs`
3. Diff touches only `tests/` or `*_test.*` / `*.test.*` files → `test`
4. Diff touches only Dockerfiles, `docker-compose.*`, `pyproject.toml`
   build config, or `package.json` dep pins → `build`
5. Diff touches only formatting (prettier, ruff format, whitespace) → `style`
6. Measurable performance improvement with no behavior change → `perf`
7. Code restructure with no behavior change (extract helper, rename, move) → `refactor`
8. Fixes a bug that was previously broken → `fix`
9. Adds new user-visible functionality or endpoint → `feat`
10. Reverts a prior commit → `revert`
11. Config files (env schema, settings) that aren't build tooling → `config`
12. Pure maintenance (dep bumps, internal tooling) with no user impact → `chore`

**Common mis-types to avoid:**
- Refactor that moves code but doesn't add features → `refactor`, not `feat`
- Test-only additions or fixes → `test`, not `feat`/`fix`
- Perf improvement (caching, memoization, algorithm change) → `perf`, not `refactor`
- Dockerfile change → `build`, not `ci`
- GitHub Actions change → `ci`, not `build`

**When unsure between two types**, pick the one whose *primary effect* dominates
the diff — e.g. a refactor that happens to fix one minor bug is still
`refactor` if restructuring is the point.

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

## Sync Layer Architecture

> **Full reference:** `docs/architecture/sync-layer.md` — Read before adding/modifying sync jobs.

> **Full reference:** `docs/architecture/bunk-request-pipeline.md` — Read before working on CSV upload, original_bunk_requests, bunk request processing, name resolution, or the AI parse/disambiguation pipeline.

## 🔐 Secrets, Privacy & Test Data

### Environment & Private Files

**Environment secrets**: Loaded from `.env` by `start_dev.sh`.

**Private files** (branding, staff lists, assets): Stored in private `kindred-local` repo.
- **Local dev**: Run `scripts/setup/setup-local-config.sh` to symlink files
- **CI/CD**: Cloned via deploy key during Docker build

Files: `config/branding.local.json`, `config/staff_list.json`, `local/assets/`,
`CLAUDE.local.md`, `frontend/vite.config.local.ts`, `scripts/vault.config`, `docs/camp/`

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

## 🔐 OAuth2 Configuration

PocketBase OAuth2 uses **OIDC auto-discovery** - set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in `.env` (see `.env.example`). Endpoints auto-discovered from `{OIDC_ISSUER}/.well-known/openid-configuration`. Works with any OIDC provider (Pocket ID, Authentik, Auth0, Keycloak, etc.).

For CLI API testing with auth tokens, see `/docs/reference/cli-commands.md`.

## Frontend Architecture (`frontend/src/`)

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

### Key Component Patterns
- **Modular extraction**: Large components like `SocialNetworkGraph.tsx` are decomposed into utility modules
- **Custom hooks**: Data fetching logic extracted to hooks (`useSocialGraphData`, `useBunkNames`, `useSessionHierarchy`)
- **Barrel exports**: Component directories use `index.ts` for clean imports

**Technologies**: React 19, TypeScript 5.8+, Vite, Tailwind CSS, React Query, @dnd-kit, Cytoscape.js

### Error Handling Conventions

**Frontend:**
- **Page-level `<ErrorBoundary>`**: Every lazy-loaded route in `App.tsx` is wrapped with `<ErrorBoundary>` around `<Suspense>`. This isolates crashes to the affected page — nav and other routes remain functional. New routes MUST follow this pattern.
- **`<QueryGuard>`** (`components/QueryGuard.tsx`): Render-prop component that handles loading/error/empty/success states for React Query data. Use it in new data-fetching pages to avoid hand-rolling the same if/isLoading/if/error pattern. Existing pages use inline patterns — don't refactor them unless already touching that code.
- **All 4 states must be handled**: loading, error, empty, success. Never render a data-dependent component without checking the query state first.

**Backend:**
- **Global exception handler** in `api/main.py` catches unhandled exceptions and returns `{"detail": "Internal server error"}` (generic). Full error details are logged server-side with `exc_info=True`. Never use `raise HTTPException(status_code=500, detail=str(e))` — let the global handler catch it instead.

### Tour & Hint Maintenance
When modifying page layout, features, or `data-tour` attributes on a toured page,
review and update the corresponding tour definition in `frontend/src/tours/definitions/`.
Checklist:
- [ ] data-tour attributes still reference correct elements
- [ ] isReady() still checks the right element
- [ ] Step/hint descriptions match current behavior
- [ ] Bump `version` if steps changed (triggers re-play for returning users)

## Metrics Module

> **Full reference:** `docs/architecture/metrics-module.md` — Read before adding/modifying metrics.

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

## Important Development Notes

1. **Language Versions** - Python 3.14+, Go 1.26+, Node 22+, TypeScript 5.8+/ES2022
2. **Use uv** - `uv sync` to install, `uv run <cmd>` to execute
3. **CampMinder IDs** - All relationships use CM IDs, never PocketBase IDs
4. **Sync order matters** - sessions → attendees → persons → bunks → plans → assignments → requests
5. **Family-camp data syncs** alongside summer data — summer-camp views must filter `session_type` against `VALID_SUMMER_SESSION_TYPES` (frontend) / `valid_summer_session_types` equivalents to avoid leaking family-camp sessions, attendees, or bunks
6. **Config is database-driven** - PocketBase `config` table, not JSON files. AI settings via env vars (`AI_API_KEY`, `AI_MODEL`, `AI_PROVIDER`)
7. **AI model** - GPT-5-nano via `AI_MODEL` env var ($0.05/$0.40 per M tokens, reasoning enabled)
8. **Token caching** - CampMinder JWT cached in `~/.campminder_token_cache.json`
9. **Year-aware syncs** - Uses `season_id` from config; ready for new year with config update
10. **Sequential session syncs** - Sessions 1-4 run sequentially with independent history
11. **WAL checkpoint** - Required after database modifications
12. **PocketBase filter syntax** - ALWAYS spaces around operators (`field = value` not `field=value`)
13. **IPv4 in production** - Caddy/Vite configs use `127.0.0.1`; scripts may use localhost
14. **React auth guards** - Check `isLoading` from `useAuth()` before authenticated API calls
15. **React Query keys** - Use centralized keys from `frontend/src/utils/queryKeys.ts`
16. **Attendee filtering** - Solver uses `status_id = 2` for active enrolled attendees
17. **Git hooks** - Run `./scripts/setup-git-hooks.sh` once to install lefthook; config in `.lefthook.yml`
18. **Python line length** - 120 chars (configured in `ruff.toml`), enforced by ruff format
19. **Frontend tests** - Vitest (not Jest); `npm run test` for watch mode, `npx vitest run` for one-shot
20. **Spelling: "cancelled"** - PocketBase fields use British spelling (`cancelled_count`). Go linter allows it via `.golangci.yml` extra-words. Use `cancelled` consistently, not `canceled`

## Session Types and Bunking Structure

> **Full reference:** `docs/architecture/session-types.md` — Read before working with sessions, bunking, or AG logic.

## Critical: Year Data Integrity

### The Problem
CampMinder reuses session IDs across years. Year field prevents data contamination.

### Prevention Rules
1. **Year field required**: All CampMinder data tables (`attendees`, `bunk_assignments`, `bunk_plans`, etc.) have required `year` field
2. **Go sync enforces year**: All sync operations filter by `CAMPMINDER_SEASON_ID` from .env
3. **Frontend year dropdown is display-only**: Does not affect sync jobs

### Schema Pattern
- **Relation fields** (`person`, `session`, `bunk`) for PocketBase joins
- **CampMinder IDs** (`cm_id`, `person_id`) for sync lookups
- **Unique indexes** include year (e.g., `person_id, year, session`)

## PocketBase Migration Patterns (v0.23.0+)

> **MANDATORY:** Read `docs/reference/pocketbase-migrations.md` before writing ANY migration. PocketBase v0.23+ changed field property syntax — using old `options: {}` wrapper pattern causes silent data truncation.

## PocketBase Migration Numbering Rule

New migrations MUST use a number greater than the highest filename in `pocketbase/pb_migrations/` on `origin/main`. Do not fill numbering gaps left by past consolidations.

```bash
HIGHEST=$(git ls-tree -r origin/main pocketbase/pb_migrations/ \
  | awk '{print $4}' | grep -oE '15000[0-9]{5}' | sort -u | tail -1)
NEXT=$((HIGHEST + 1))
```

Within an unmerged PR you may iterate, rename, or renumber your own new migrations freely — reset the dev DB to re-apply if you change a filename or content. Once merged to `main`, the file is frozen; if a competing PR landed on `main` first and took your number, bump above the new HEAD.

History: gaps may exist from migration consolidation runs (skill: `consolidate-migrations`, gitignored tracking doc: `docs/plans/migration-consolidation.md`). Those numbers are NOT free for reuse — they're "burned" to preserve a monotonically increasing record. The OnServe history-sync hook in `pocketbase/main.go` keeps prod's `_migrations` table in sync with the on-disk file list automatically on every server boot.

## 🚨 CRITICAL: Worktree and Branch Rules

**These rules are NON-NEGOTIABLE. Violating them can corrupt work from parallel agents.**

### NEVER Push to Main
- **NEVER push directly to main** - All changes go through PRs
- **NEVER commit to main** - Always work on a feature branch
- Main branch is protected; direct pushes will fail anyway

### ALWAYS Use a Worktree for Feature Work
**Before starting ANY feature work, you MUST create a worktree:**
```bash
./scripts/worktree/new.sh <descriptive-feature-name>
cd ../kindred-worktrees/<feature-name>
```

### When Can I Work in the Main Repo Folder?
You may ONLY work on a branch in the main repo folder if BOTH conditions are met:

| Condition | How to Verify |
|-----------|---------------|
| **A) Frontend-only change the user wants to preview** | Ask: "This is a frontend change - do you want to preview it in the main repo before I create a worktree?" |
| **B) User confirms solo work** | Ask: "Are we working solo without other agents, so it's safe to work in the main repo?" |

If the user doesn't explicitly confirm BOTH conditions, **create a worktree**.

### Why This Matters
- Multiple agents may be working in parallel on different features
- Working in main folder can conflict with uncommitted changes from other agents
- Worktrees provide complete isolation (code, database, ports)
- The seeded database in worktrees protects production data

### Quick Decision Tree
```
Starting new work?
├─ Is it a frontend preview AND user confirmed solo work?
│  └─ YES to BOTH → OK to work in main folder on a branch
│  └─ NO to either → CREATE A WORKTREE
└─ When in doubt → CREATE A WORKTREE
```

## Git Worktrees for Parallel Development

**🚨 REQUIRED: Always use a worktree for feature work.** See "CRITICAL: Worktree and Branch Rules" above.

### Quick Start
```bash
# 1. Sync main first
git pull --rebase origin main

# 2. Create a worktree
./scripts/worktree/new.sh <descriptive-feature-name>

# 3. Move to the worktree
cd ../kindred-worktrees/<feature-name>

# 4. Start development
./scripts/start_dev.sh

# 5. Work, commit, push, create PR as normal

# 6. After PR merged, cleanup
./scripts/worktree/cleanup.sh <feature-name>
```

### How It Works
| Main Repo | Worktree |
|-----------|----------|
| `<repo>/` | `<repo>-worktrees/<feature>/` |
| Ports: 3000, 8000, 8080, 8090 | Ports: auto-assigned (offset 10-90) |
| Branch: main | Branch: feature/<feature> |
| Database: production data | Database: seeded from main |

### Port Assignment
Ports are deterministically assigned from the feature name hash:
- Worktree "fix-auth" might get: Vite 3040, API 8040, Caddy 8180, PB 8190
- Same name always gets same ports (no conflicts between runs)

### What Gets Isolated
- `.venv/` - Python virtual environment
- `node_modules/` - Frontend dependencies
- `pocketbase/pb_data/` - Database (seeded from main)
- `.env` - Environment with port overrides
- Build artifacts and caches

### Cleanup
After `git pull`, the `post-merge` hook detects merged worktree branches and suggests cleanup commands.

```bash
# Clean up a specific worktree
./scripts/worktree/cleanup.sh <feature-name>

# Clean up ALL merged worktrees at once
./scripts/worktree/cleanup.sh --all-merged
```

## Commit Behavior
- **NEVER push to main** - All changes go through feature branches and PRs
- **NEVER commit to main** - Work on feature branches only
- Commit at logical checkpoints, not micro-commits
- Squash related commits before pushing
- Never push without user consent
- Never add others' changes to your commits (check `git status` first)

## Dependabot PRs — Use `@dependabot recreate`, Not `rebase`

A GitHub Actions workflow in this repo edits dependabot PRs after open to extend
lockfiles (`uv.lock`, `frontend/package-lock.json`) so all three lockfile families
stay in sync. When GHA has modified a dependabot PR, `@dependabot rebase` can
force-push over those edits or leave the branch in an inconsistent state.

**Rule:** When interacting with a dependabot PR (asking it to update against main,
resolve lockfile conflicts, etc.), always comment `@dependabot recreate` — never
`@dependabot rebase`. Recreate closes the PR and opens a fresh one from current
main, which is safe regardless of prior GHA edits.

Exception: if you are manually pushing a lockfile fix to the dependabot branch
yourself (maintainer edit), skip the dependabot command entirely and push the
fix directly.

## Git Hooks (Lefthook)

Hooks are managed by [lefthook](https://github.com/evilmartians/lefthook) via `.lefthook.yml`.

**Setup:** `./scripts/setup-git-hooks.sh` (run once after cloning)

| Stage | Trigger | What runs | Speed |
|-------|---------|-----------|-------|
| **pre-commit** | Every commit | Formatters on staged files (prettier, ruff format, gofmt) | <1s |
| **commit-msg** | Every commit | commitlint validation | Instant |
| **pre-push** | Every push | Type checks (mypy, tsc), go build, fast linters (ruff, shellcheck, pb-js-lint) | ~15s |
| **post-merge** | After pull | Worktree cleanup notifications | ~5s |

**Escape hatches:** `LEFTHOOK=0 git commit` or `git commit --no-verify`

**Run manually:**
```bash
lefthook run pre-commit    # Test formatters
lefthook run pre-push      # Test type checks + fast linters
```

## 🚨 CRITICAL: Development Quality Standards

### CI/CD Workflow

**CI runs on every push** (fast, ~2-3 min):
- Linting (ruff, eslint, golangci-lint)
- Type checking (mypy, TypeScript)
- Unit tests (Python, Go, TypeScript)

**CD runs on every merge to main** (full build, ~10-15 min):
- Docker image builds
- Security scanning (Trivy)
- Integration tests
- Pushes images tagged `latest` and `sha-<commit>`

### Version Tags
- Semantic versioning: `v0.1.0`, `v0.2.0`, `v1.0.0`
- Tags created by the Release workflow, not manually

### Release Workflow
Release via GitHub Actions: **Actions → Release → Run workflow**. Leave version empty for auto-bump (git-cliff), or enter a version to override. The workflow waits for CI and CD to pass, promotes the existing `sha-<commit>` Docker images to version tags (e.g., `3.2.0`, `3.2`), then creates the git tag and GitHub release.

Requires `RELEASE_TOKEN` repo secret (fine-grained PAT with `contents: write`).

### GitHub Repository Rules (Branch Protection)

The `main` branch is protected by a GitHub **Ruleset** (not legacy branch protection) with:

| Rule | Effect |
|------|--------|
| **Required status check: "CI Summary"** | All CI checks must pass before merge |
| **Required linear history** | No merge commits; squash merge only |
| **No bypass actors** | Even admins cannot push directly to main |

**Workflow implications:**
1. **All changes require a PR** - No direct pushes to main, even for small fixes
2. **CI must pass** - PR cannot be merged until "CI Summary" status check succeeds
3. **Squash merge only** - Multiple commits become one clean commit with PR title/body
4. **No emergency bypass** - Protects against accidental force pushes

**Creating a release:**
1. Create feature branch: `git checkout -b fix/something`
2. Push and create PR: `gh pr create`
3. Wait for CI to pass
4. Merge via GitHub UI (squash merge)
5. GitHub → Actions → Release → Run workflow (auto-bump or enter version)

## 🚨 CRITICAL: Test-Driven Development (TDD) Requirements

**You MUST follow TDD methodology for all new feature development:**

1. **Write Tests FIRST**: Create failing tests that define the expected behavior
2. **Verify Tests Fail**: Run tests to confirm they fail before writing implementation (red phase)
3. **Implement to Pass Tests**: Write minimal code to make tests pass
4. **Never Modify Tests to Match Implementation**: Tests define the spec, not the other way around

Tests and implementation may be in the same commit — PRs are squash-merged so commit granularity doesn't matter. What matters is the **workflow discipline**: tests are written first and verified failing before implementation begins.

### Anti-Patterns to AVOID
- ❌ Writing tests after implementation
- ❌ Modifying tests to match implementation behavior
- ❌ Skipping the "red" phase (tests must fail first)

**Remember**: Tests are the SPECIFICATION. Implementation must conform to tests, not the other way around!