# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Kindred

Kindred finds campers who belong together and places them in the right cabins. A constraint satisfaction solver for optimizing summer camp cabin assignments using Google OR-Tools with a full CampMinder data integration system.

## System Architecture

### Single-Container Architecture
```
CampMinder API → Go Sync ─┐
                          │
React Frontend ──────────┼──→ kindred (Caddy + PocketBase + FastAPI)
                          │
OR-Tools Solver ─────────┘
```

| Service | Port | Technology | Purpose |
|---------|------|------------|---------|
| **kindred** | 8080 | Caddy + Go + Python + SQLite | Combined container (see below) |
| **React Frontend** | 3000 | TypeScript + Vite | Dev server with HMR (development only) |

**kindred** runs all three services via supervisor:
- **Caddy (8080)**: Reverse proxy, routing (main entry point)
- **PocketBase (8090)**: Database, auth, CampMinder sync, embedded frontend
- **FastAPI (8000)**: Solver, social graphs, scenarios, validation

**Routing (Inverse Pattern)**: Caddy routes specific PocketBase patterns (`/api/collections/*`, `/api/files/*`, `/api/realtime`, `/api/custom/*`, `/api/oauth2-redirect`) to port 8090. All other `/api/*` requests go to FastAPI (8000). This eliminates route enumeration - new FastAPI endpoints automatically work. See `docker/Caddyfile` (prod) and `frontend/Caddyfile` (dev) for routing rules.

### Key Data Principle
**All cross-table relationships use CampMinder IDs, never PocketBase IDs.** This ensures data integrity during syncs.

## 📚 Full Documentation

See `/docs`: architecture/, guides/, api/, reference/cli-commands.md

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
| `scripts` | Dev/utility scripts |
| `deps` | Dependencies |
| `docs` | Documentation |
| `security` | Security hardening, CVE fixes |

## Quick Development Commands

```bash
./scripts/start_dev.sh                                    # Start all services
curl -X POST "http://localhost:8090/api/custom/sync/daily" # Trigger sync
uv run pytest tests/                                      # Python tests
cd pocketbase && go test ./...                            # Go tests
cd frontend && npm run test                               # Frontend tests
```

Full reference: `/docs/reference/cli-commands.md`

## Sync Layer Architecture

### Overview
Data flows from CampMinder through a layered sync system:

```
CampMinder API
    ↓
Go: Sync Services (pocketbase/sync/)
    ↓
PocketBase Tables (original_bunk_requests)
    ↓
Go: process_requests.go (thin wrapper)
    ↓
Python: bunk_request_processor/ (all 5 field types)
    • AI fields: bunk_with, not_bunk_with, bunking_notes, internal_notes
      → Three-phase: AI Parse → Local Match → AI Disambiguate
    • Direct parse: socialize_with (dropdown values, no AI needed)
    ↓
bunk_requests table
```

### Go Sync Services (`pocketbase/sync/`)
| File | Purpose |
|------|---------|
| `orchestrator.go` | Coordinates sync sequence, dependency ordering |
| `scheduler.go` | Automated sync scheduling |
| `api.go` | HTTP API endpoints for sync status/triggers |
| `bunk_requests.go` | CSV → `original_bunk_requests` table |
| `process_requests.go` | Thin wrapper calling Python processor |
| `sessions.go`, `attendees.go`, `persons.go`, etc. | Entity syncs |

### Python Request Processor (`bunking/sync/bunk_request_processor/`)
Unified processor for all 5 bunk request field types:

| Directory | Purpose |
|-----------|---------|
| `orchestrator/` | Main coordination logic, routes AI vs direct parse |
| `services/` | Phase 1 (AI Parse), Phase 2 (Local Match), Phase 3 (AI Disambiguate) |
| `integration/` | AI providers, original_requests_loader, adapters |
| `resolution/strategies/` | Exact, fuzzy, phonetic, school-based matching |
| `data/repositories/` | PocketBase data access layer |
| `validation/` | Request validation rules |

**Field types and processing:**
- **AI fields** (`bunk_with`, `not_bunk_with`, `bunking_notes`, `internal_notes`): Three-phase AI pipeline
- **Direct parse** (`socialize_with`): Simple dropdown value mapping, no AI cost

**Entry point**: `process_requests.py`

```bash
# Run via Go API (recommended - handles auth)
curl -X POST "http://localhost:8090/api/custom/sync/process-requests?session=1"

# Run directly via Python (for debugging)
uv run python -m bunking.sync.bunk_request_processor.process_requests \
    --year 2025 --session 2 --dry-run
```

**Session parameter**: 0=all sessions, 1=Taste of Camp, 2-4=Sessions 2-4

### Sync Dependencies (Order Matters)
1. sessions → 2. attendees → 3. persons → 4. bunks → 5. bunk_plans → 6. bunk_assignments → 7. bunk_requests → 8. process_requests

## 🔐 Secrets, Privacy & Test Data

### Environment & Encrypted Files

**Environment secrets**: Loaded from `.env` by `start_dev.sh`, or pre-injected from secrets manager.

**Private files** (branding, staff lists, assets): Encrypted via git-crypt. See `.gitattributes` for list. On new machine: `git-crypt unlock <keyfile>`. Setup: `./scripts/setup/setup_git_crypt.sh`

**Adding/removing git-crypt files**: Update `.gitattributes` only. CI reads patterns from there for gitleaks exclusions.

### NEVER Use Real Personal Information

All code, tests, comments, and documentation MUST use fictional data:

1. **Camper/Family Names**: Use the standard fake name list (Emma Johnson, Liam Garcia, Olivia Chen, etc.)
2. **Staff Names**: Use names from `config/staff_list.json` (all fictional)
3. **Schools**: Use fictional school names (Riverside Elementary, Oak Valley Middle, Hillcrest High)
4. **Phone/Email**: Use obviously fake data (555-0100, test@example.com)
5. **Camp Branding**: Use `{camp_name}` placeholder in prompts, never hardcode camp names
6. **Session IDs**: Use generic IDs (1000001, 1000002) in examples, not real CampMinder IDs

### Branding Configuration

Generic "Kindred" branding by default. Camp-specific branding from git-crypt encrypted files:
- `config/branding.local.json` - Camp name, descriptions, SSO display name
- `local/assets/` - Camp logos

Without git-crypt key, these appear as binary blobs and system uses generic defaults.

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

1. **Language Versions** - Python 3.12+, Go 1.24+, TypeScript 5.8+/ES2022
2. **Use uv** - `uv sync` to install, `uv run <cmd>` to execute
3. **CampMinder IDs** - All relationships use CM IDs, never PocketBase IDs
4. **Sync order matters** - sessions → attendees → persons → bunks → plans → assignments → requests
5. **Family camps excluded** in syncs for performance
6. **Config is database-driven** - PocketBase `config` table, not JSON files. AI settings via env vars (`AI_API_KEY`, `AI_MODEL`, `AI_PROVIDER`)
7. **AI model** - GPT-4.1-nano via `AI_MODEL` env var ($0.10/$0.40 per M tokens)
8. **CSV history tracking** - `csv_history/` tracks changes, 30-day auto-cleanup, saves 70-90% AI costs
9. **Token caching** - CampMinder JWT cached in `~/.campminder_token_cache.json`
10. **Year-aware syncs** - Uses `season_id` from config; ready for new year with config update
11. **Sequential session syncs** - Sessions 1-4 run sequentially with independent history
12. **WAL checkpoint** - Required after database modifications
13. **PocketBase filter syntax** - ALWAYS spaces around operators (`field = value` not `field=value`)
14. **IPv4 in production** - Caddy/Vite configs use `127.0.0.1`; scripts may use localhost
15. **React auth guards** - Check `isLoading` from `useAuth()` before authenticated API calls
16. **React Query keys** - Use centralized keys from `frontend/src/utils/queryKeys.ts`
17. **Attendee filtering** - Solver uses `is_active = 1 AND status_id = 2` for active enrollees
18. **Git hooks** - Run `./scripts/setup-git-hooks.sh` once; validates commits, blocks if behind origin

## Session Types and Bunking Structure

### Three Session Types (Summer Camp)
Summer camp tracks three types of sessions in the `camp_sessions` table:

| Type | Description | Duration | Parent Relationship |
|------|-------------|----------|---------------------|
| **main** | Standard sessions (Session 1, 2, 3, 4) | Full session | None (is a parent) |
| **ag** | All-Gender sessions | Full session (same as parent main) | Links to main session |
| **embedded** | Standalone partial sessions (2a, 2b, 3a, etc.) | Partial dates | None (fully independent) |

### Query Pattern for Summer Sessions
```typescript
// Landing page: Show main + embedded separately (AG stats fold into main)
filter: `(session_type = "main" || session_type = "embedded") && year = ${currentYear}`

// Session dropdown: Same as landing page, sorted logically (1, 2, 2a, 2b, 3, ...)
```

### Embedded Sessions Explained
Embedded sessions are **fully independent** sessions that happen during partial date ranges. They use the **same physical cabins** as main sessions but during **different time periods**.

**Capacity calculation**:
- Capacity = `bunk_plans count × defaultCapacity` (from config, typically 12)
- Each `bunk_plan` represents "work to do" - a camper assignment slot
- No overage logic - always use the standard capacity from config

### AG (All-Gender) Sessions
- Run the full duration of their parent main session
- Campers are ONLY bunked in cabins marked as `gender = "Mixed"` (the actual DB value)
- AG bunks are named with `AG-` prefix (e.g., AG-8, AG-10)
- **AG stats combine with their parent main session** on landing page
- **No AG area dropdown when viewing embedded sessions** (AG is main-only)

### Bunk Plan Structure
- **Main sessions**: Have `bunk_plans` for non-AG bunks only (B-*, G-*)
- **AG sessions**: Have their own `bunk_plans` for AG bunks (AG-*)
- **Embedded sessions**: Have `bunk_plans` for their specific bunks (independent)

### Database Relationships
- `camp_sessions.parent_id`: Links **AG sessions only** to their parent main session (via CampMinder ID)
- `camp_sessions.session_type`: Distinguishes main, ag, embedded
- `bunks.gender`: `'M'`, `'F'`, or `'Mixed'` determines which area dropdowns show which cabins

**Note**: Embedded sessions do NOT have parent_id - they are fully independent.

### Frontend AG Detection Best Practices
- Use `session.session_type === 'ag'` to detect AG sessions (not name string matching)
- Use `session.session_type === 'main'` to determine if AG area should be shown
- Use `bunk.gender?.toLowerCase() === 'mixed'` to detect AG bunks
- Bunk names starting with `AG-` are AG bunks (reliable naming convention)

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

**Key changes**: Use `app` parameter directly (Dao removed). Use `app.findCollectionByNameOrId()`, `app.save()`, `app.delete()`.

**Schema iteration**: Use index-based `for` loops, NOT `for...of` (causes "object is not iterable").

**Select fields**: Put `values` and `maxSelect` as direct properties, not inside `options`.

**Enum update workaround**: If migration applies but enum values unchanged, use `scripts/fix_request_type_enum.py` to update schema JSON directly.

### Creating New Collections

Use dynamic collection lookups for relation fields - never hardcode collection IDs:

```javascript
migrate((app) => {
  // Dynamic lookups for relations
  const personsCol = app.findCollectionByNameOrId("persons")

  const collection = new Collection({
    name: "my_collection",
    type: "base",
    listRule: '@request.auth.id != ""',
    // ... other rules
    fields: [
      // Relation field - collectionId is DIRECT property, not nested in options
      {
        type: "relation",
        name: "person",
        required: true,
        presentable: false,
        collectionId: personsCol.id,  // Dynamic lookup
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      // Select field - values/maxSelect are DIRECT properties
      {
        type: "select",
        name: "status",
        required: true,
        values: ["active", "inactive"],
        maxSelect: 1
      },
      // Other field types use options normally
      {
        type: "text",
        name: "name",
        required: true,
        options: { min: null, max: 200, pattern: "" }
      }
    ],
    indexes: [...]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("my_collection");
  app.delete(collection);
});
```

### Adding Fields to Existing Collections

Use `new Field()` constructor and `fields.add()` - plain objects don't work:

```javascript
migrate((app) => {
  const collection = app.findCollectionByNameOrId("existing_collection");

  // CORRECT: Use new Field() constructor
  collection.fields.add(new Field({
    type: "json",
    name: "my_field",
    required: false,
    presentable: false,
    options: { maxSize: 2000000 }
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("existing_collection");
  collection.fields.removeByName("my_field");
  app.save(collection);
});
```

### Common Mistakes to Avoid

| Wrong | Right |
|-------|-------|
| `collectionId` inside `options: {}` | `collectionId` as direct property |
| `collection.fields.push({...})` | `collection.fields.add(new Field({...}))` |
| Hardcoded collection IDs | `app.findCollectionByNameOrId("name").id` |
| `for...of` on fields | Index-based `for` loop |
| `return app.save()` | `app.save()` (no return needed) |

## 🚨 CRITICAL: Development Quality Standards

### CI/CD Workflow

**CI runs on every push** (fast, ~2-3 min):
- Linting (ruff, eslint, golangci-lint)
- Type checking (mypy, TypeScript)
- Unit tests (Python, Go, TypeScript)

**CD runs only on tags/releases** (full build, ~10-15 min):
- Docker image builds
- Security scanning (Trivy)
- Integration tests

### Version Tags
- Semantic versioning: `v0.1.0`, `v0.2.0`, `v1.0.0`
- Only `v*` tags trigger CD workflow
- Deploy: `git tag -a v0.1.1 -m "message" && git push --tags`

### Release Workflow
Use `./scripts/release.sh` to create releases (run `--help` for options). Uses git-cliff for changelog generation.

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
5. Create release tag: `./scripts/release.sh --version X.Y.Z`

## 🚨 CRITICAL: Test-Driven Development (TDD) Requirements

**You MUST follow TDD methodology for all new feature development:**

1. **Write Tests FIRST**: Create failing tests that define the expected behavior
2. **Commit Tests Separately**: Tests must be committed BEFORE implementation
3. **Implement to Pass Tests**: Write minimal code to make tests pass
4. **Never Modify Tests to Match Implementation**: Tests define the spec, not the other way around

### Anti-Patterns to AVOID
- ❌ Creating tests and implementation in the same commit
- ❌ Writing tests after implementation
- ❌ Modifying tests to match implementation behavior
- ❌ Skipping the "red" phase (tests must fail first)

**Remember**: Tests are the SPECIFICATION. Implementation must conform to tests, not the other way around!