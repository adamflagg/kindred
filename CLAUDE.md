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
| `google` | Google Sheets/Drive API |
| `scripts` | Dev/utility scripts |
| `deps` | Dependencies |
| `docs` | Documentation |
| `security` | Security hardening, CVE fixes |
| `metrics` | Analytics, dashboards, statistics |
| `graph` | Social network graph features |
| `data` | Data models, schema changes |

## Quick Development Commands

```bash
./scripts/start_dev.sh                                    # Start all services
curl -X POST "http://localhost:8090/api/custom/sync/run?year=2025&service=all" # Trigger sync
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

### Adding a New Sync Job (Complete Checklist)

When implementing a new sync job, ALL of these steps must be completed. Missing any step will result in partial functionality.

#### 1. Go Sync Service (`pocketbase/sync/`)

| File | Action |
|------|--------|
| `{job_name}.go` | Create service struct embedding `BaseSyncService`, implement `Name()`, `Sync()`, `GetStats()` |
| `{job_name}_test.go` | Unit tests for service name, parameter validation, stats parsing |

#### 2. Orchestrator Registration (`orchestrator.go`)

| Location | Action |
|----------|--------|
| `InitializeSyncServices()` | Register service with `RegisterService()` in dependency order |
| `RunDailySync()` orderedJobs | Add job ID string in correct position (respects dependencies) |
| `RunSyncWithOptions()` servicesToRun | Add to default services list for historical syncs |
| `RunSyncWithOptions()` re-registration | Add `NewXxxSync(o.app, yearClient)` call in historical re-registration block (~line 815) |

**Common mistake**: Registering the service but forgetting to add to `orderedJobs` - job won't run in daily sync!

#### 3. API Endpoint (`api.go`)

| Action | Details |
|--------|---------|
| Add handler function | `handle{JobName}Sync()` with query param validation |
| Register route | `POST /api/custom/sync/{job-name}` with `requireAuth` wrapper |
| Add to status endpoint | Include in `handleSyncStatus()` known types list |

#### 4. PocketBase Schema (if new table)

| File | Action |
|------|--------|
| `pb_migrations/1500000XXX_{table_name}.js` | Collection definition with fields, indexes, access rules |

#### 5. Frontend Type Registration (`frontend/src/`)

| File | Action |
|------|--------|
| `components/admin/syncTypes.ts` | Add to `CURRENT_YEAR_SYNC_TYPES` or `GLOBAL_SYNC_TYPES` with id, name, icon, color |
| `hooks/useRunIndividualSync.ts` | Add to `SYNC_TYPE_NAMES` map for toast display |

#### 6. Frontend Special Handling (if needed)

**REQUIRED if API endpoint requires `year` parameter** (like `camper_history`, `family_camp_derived`):

| File | Action |
|------|--------|
| `hooks/use{JobName}Sync.ts` | Custom hook that passes year to endpoint (copy from `useCamperHistorySync.ts`) |
| `components/admin/SyncTab.tsx` | Add conditional case: `syncType.id === 'job_name' ? ... : ...` with custom hook |

Example pattern from `useCamperHistorySync.ts`:
- Hook accepts year, calls `/api/custom/sync/{job}?year=${year}`
- SyncTab.tsx uses `{jobName}Sync.mutate(currentYear)` instead of `runIndividualSync`

For jobs with other custom parameters (session, etc.), similar pattern applies.

#### 7. Historical Sync Support (if year-specific)

> **Note**: All year-scoped sync types are automatically available for historical syncs unless marked with `currentYearOnly: true` in syncTypes.ts. No separate array registration needed.

| Consideration | When to use `currentYearOnly: true` |
|---------------|-------------------------------------|
| Current-year-only jobs | Jobs like `bunk_requests` and `process_requests` that only make sense for current year |
| Normal year-scoped jobs | Most jobs don't need this flag and work for any year |

#### 8. Google Sheets Export (if needed)

| File | Action |
|------|--------|
| `sync/table_exporter.go` | Add table to export list with sheet name pattern |

#### 9. Computed/Derived Tables (if reading from other synced tables)

If your sync reads from tables populated by OTHER syncs (not CampMinder directly):

| Consideration | Action |
|---------------|--------|
| orderedJobs position | Place AFTER all dependency syncs in the array |
| Custom values dependency | If needs `person_custom_values` or `household_custom_values`, these run weekly - sync will use existing data in daily runs |
| Historical with custom values | When `IncludeCustomValues=true`, ensure your sync is listed AFTER custom values syncs in `RunSyncWithOptions()` |

Example: `family_camp_derived` depends on `person_custom_values` and `household_custom_values`, so it's added to `servicesToRun` after the custom values syncs when `opts.IncludeCustomValues` is true.

#### Quick Reference: Sync ID Conventions

- Go: `job_name` (snake_case in orderedJobs, maps to `job-name` endpoint)
- Frontend: `job_name` in syncTypes.ts (auto-converted to `job-name` for API)
- API: `/api/custom/sync/job-name` (kebab-case)

#### Verification Checklist

After implementation, verify ALL of these work:

- [ ] `go build .` in pocketbase/ succeeds
- [ ] `npm run build` in frontend/ succeeds
- [ ] Job appears in Admin → Sync tab with correct icon/color
- [ ] Individual "Run" button triggers the sync
- [ ] Unified sync (current year) includes the job
- [ ] Unified sync (historical year) includes the job (unless `currentYearOnly: true`)
- [ ] Status shows created/updated/errors after completion

#### Common Mistakes (Lessons Learned)

| Mistake | Consequence | Prevention |
|---------|-------------|------------|
| Service registered but not in `orderedJobs` | Won't run in daily sync | Always add to both places |
| Year-param endpoint without custom hook | Frontend errors on "Run" button | Check if API handler has `year` query param |
| Missing historical re-registration | Won't run in historical imports | Add `NewXxxSync()` call in `RunSyncWithOptions()` block |
| Derived table before dependencies | Empty results, relation errors | Map dependency chain, place after deps in orderedJobs |
| Global table in historical sync | Unnecessary re-sync of static data | Check if table has `year` field - if not, it's global |

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

**Sync Order Principle**: Source data syncs must complete before derived tables run.

| Category | Services | Notes |
|----------|----------|-------|
| **Source Data** | session_groups → sessions → attendees → persons → bunks → bunk_plans → bunk_assignments → staff → financial_transactions | Fetched from CampMinder API |
| **Custom Values** | person_custom_values → household_custom_values | Expensive (1 API call per entity), run weekly or on-demand |
| **Derived Tables** | camper_history, family_camp_derived | Computed from synced source data + custom values |
| **Processing** | bunk_requests → process_requests | CSV import and AI processing |

**Key ordering rules:**
1. **Source → Derived**: All derived tables (`camper_history`, `family_camp_derived`) run AFTER source data syncs
2. **Custom values → Derived**: When `IncludeCustomValues=true` (historical sync), custom values run BEFORE derived tables
3. **Sequential custom values**: Custom values syncs run sequentially (not parallel) to prevent context deadline issues from concurrent API rate limiting

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

## 🚨 PocketBase Migration Patterns (v0.23.0+) — READ THIS FIRST

> **⚠️ MANDATORY**: Before writing ANY PocketBase migration, you MUST review this section. PocketBase v0.23+ changed how field properties are defined. Using the old `options: {}` wrapper pattern will cause fields to use DEFAULT values (e.g., 5000 char limit for text) even if you specify different values. This causes silent data truncation bugs that are hard to diagnose.

### Field Type Reference (v0.23+ Syntax)

**CRITICAL**: Most field types require properties as DIRECT fields, NOT inside `options: {}`.

| Field Type | Properties | Correct Syntax |
|------------|------------|----------------|
| `text` | `min`, `max`, `pattern` | `{ type: "text", name: "x", min: 0, max: 100000, pattern: "" }` |
| `number` | `min`, `max`, `onlyInt` | `{ type: "number", name: "x", min: 0, max: 100, onlyInt: true }` |
| `select` | `values`, `maxSelect` | `{ type: "select", name: "x", values: ["a","b"], maxSelect: 1 }` |
| `relation` | `collectionId`, `cascadeDelete`, `minSelect`, `maxSelect` | `{ type: "relation", name: "x", collectionId: col.id, maxSelect: 1 }` |
| `bool` | (none needed) | `{ type: "bool", name: "x" }` |
| `json` | `maxSize` | `{ type: "json", name: "x", maxSize: 2000000 }` |
| `file` | `maxSelect`, `maxSize`, `mimeTypes`, `thumbs` | `{ type: "file", name: "x", maxSelect: 1, maxSize: 5242880 }` |
| `date` | `min`, `max` | `{ type: "date", name: "x", min: "", max: "" }` |
| `autodate` | `onCreate`, `onUpdate` | `{ type: "autodate", name: "x", onCreate: true, onUpdate: true }` |
| `url` | `exceptDomains`, `onlyDomains` | `{ type: "url", name: "x" }` |
| `email` | `exceptDomains`, `onlyDomains` | `{ type: "email", name: "x" }` |
| `editor` | `maxSize`, `convertUrls` | `{ type: "editor", name: "x", maxSize: 0, convertUrls: false }` |

### ❌ WRONG vs ✅ CORRECT Examples

```javascript
// ❌ WRONG - options wrapper is IGNORED in v0.23+, field gets DEFAULT 5000 char limit!
{
  type: "text",
  name: "value",
  options: { min: null, max: 100000, pattern: "" }  // IGNORED!
}

// ✅ CORRECT - direct properties are applied
{
  type: "text",
  name: "value",
  min: 0,
  max: 100000,
  pattern: ""
}
```

```javascript
// ❌ WRONG - select values in options wrapper
{
  type: "select",
  name: "status",
  options: { values: ["active", "inactive"], maxSelect: 1 }  // IGNORED!
}

// ✅ CORRECT - direct properties
{
  type: "select",
  name: "status",
  values: ["active", "inactive"],
  maxSelect: 1
}
```

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
      // Relation field - all properties DIRECT, not in options
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
      // Text field - min/max/pattern are DIRECT properties
      {
        type: "text",
        name: "name",
        required: true,
        min: 0,
        max: 200,
        pattern: ""
      },
      // Number field - min/max/onlyInt are DIRECT properties
      {
        type: "number",
        name: "year",
        required: true,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // JSON field - maxSize is DIRECT property
      {
        type: "json",
        name: "metadata",
        required: false,
        maxSize: 2000000
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

  // CORRECT: Use new Field() constructor with DIRECT properties
  collection.fields.add(new Field({
    type: "text",
    name: "description",
    required: false,
    presentable: false,
    min: 0,
    max: 50000,
    pattern: ""
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("existing_collection");
  collection.fields.removeByName("description");
  app.save(collection);
});
```

### Common Mistakes to Avoid

| Wrong | Right | Consequence of Wrong |
|-------|-------|---------------------|
| `options: { min: 0, max: 100000 }` for text | `min: 0, max: 100000` (direct) | Silent 5000 char limit, data truncation |
| `options: { values: [...] }` for select | `values: [...]` (direct) | Empty enum, validation fails |
| `collectionId` inside `options: {}` | `collectionId` as direct property | Relation breaks |
| `collection.fields.push({...})` | `collection.fields.add(new Field({...}))` | Field not added |
| Hardcoded collection IDs | `app.findCollectionByNameOrId("name").id` | Breaks on fresh DB |
| `for...of` on fields | Index-based `for` loop | "object is not iterable" error |
| `return app.save()` | `app.save()` (no return needed) | May cause issues |
| `min: null, max: null` | `min: 0, max: 0` (0 = unlimited) | Unpredictable behavior |

### Migration Checklist

Before committing any migration:

- [ ] **No `options: {}` wrappers** for text, number, select, relation, json, file fields
- [ ] **All field properties are direct** (min, max, values, collectionId, etc.)
- [ ] **Dynamic collection lookups** using `app.findCollectionByNameOrId()`
- [ ] **`go build .`** passes in pocketbase/
- [ ] **Fresh DB test** - delete pb_data/ and verify schema creates correctly

**Enum update workaround**: If migration applies but enum values unchanged, use `scripts/fix_request_type_enum.py` to update schema JSON directly.

**Schema iteration**: Use index-based `for` loops, NOT `for...of` (causes "object is not iterable").

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