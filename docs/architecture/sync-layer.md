# Sync Layer Architecture

## Overview
Data flows from CampMinder through a layered sync system:

```text
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

> **Deep dive:** See [`bunk-request-pipeline.md`](bunk-request-pipeline.md) for the complete end-to-end flow including delta detection, AI parsing, name resolution strategies, placeholder expansion, and all conditional branches.

## Go Sync Services (`pocketbase/sync/`)
| File | Purpose |
|------|---------|
| `orchestrator.go` | Coordinates sync sequence, dependency ordering |
| `scheduler.go` | Automated sync scheduling |
| `api.go` | HTTP API endpoints for sync status/triggers |
| `bunk_requests.go` | CSV → `original_bunk_requests` table |
| `process_requests.go` | Thin wrapper calling Python processor |
| `sessions.go`, `attendees.go`, `persons.go`, etc. | Entity syncs |

## Adding a New Sync Job (Complete Checklist)

When implementing a new sync job, ALL of these steps must be completed. Missing any step will result in partial functionality.

### 1. Go Sync Service (`pocketbase/sync/`)

| File | Action |
|------|--------|
| `{job_name}.go` | Create service struct embedding `BaseSyncService`, implement `Name()`, `Sync()`, `GetStats()` |
| `{job_name}_test.go` | Unit tests for service name, parameter validation, stats parsing |

### 2. Orchestrator Registration (`orchestrator.go`)

| Location | Action |
|----------|--------|
| `InitializeSyncServices()` | Register service with `RegisterService()` in dependency order |
| `RunDailySync()` orderedJobs | Add job ID string in correct position (respects dependencies) |
| `RunSyncWithOptions()` servicesToRun | Add to default services list for historical syncs |
| `RunSyncWithOptions()` re-registration | Add `NewXxxSync(o.app, yearClient)` call in historical re-registration block (~line 815) |
| `syncJobMeta` | Add a `{id, Phase, description}` entry — this is what drives phase grouping and the status UI |

**Common mistake**: Registering the service but forgetting to add to `orderedJobs` - job won't run in daily sync!

### 2b. Orchestrator Test (`orchestrator_test.go`) — REQUIRED, and easy to miss

`TestRunSyncWithOptionsPhaseOrdering` pins the unified job list **exhaustively** via its
`expectedOrder` slice. A new job that is registered correctly everywhere else still fails the suite
with a job-count mismatch (`expected 22 jobs, got 23`) until it is added there, in the same position
as in `orderedJobs`.

This is a genuine registration site, not a test that "happens to break" — it is the only thing
asserting the daily and historical lists stay in step.

### 3. API Endpoint (`api.go`)

| Action | Details |
|--------|---------|
| Add handler function | `handle{JobName}Sync()` with query param validation |
| Register route | `POST /api/custom/sync/{job-name}` with `requireAuth` wrapper |
| Add to status endpoint | Include in `handleSyncStatus()` known types list |

### 4. PocketBase Schema (if new table)

| File | Action |
|------|--------|
| `pb_migrations/1500000XXX_{table_name}.js` | Collection definition with fields, indexes, access rules |

### 5. Frontend Type Registration (`frontend/src/`)

| File | Action |
|------|--------|
| `components/admin/syncTypes.ts` | Add to `CURRENT_YEAR_SYNC_TYPES` or `GLOBAL_SYNC_TYPES` with id, name, icon, color |
| `hooks/useRunIndividualSync.ts` | Add to `SYNC_TYPE_NAMES` map for toast display |

### 6. Frontend Special Handling (if needed)

**REQUIRED if API endpoint requires `year` parameter** (like `camper_history`, `family_camp_derived`):

| File | Action |
|------|--------|
| `hooks/use{JobName}Sync.ts` | Custom hook that passes year to endpoint (copy from `useCamperHistorySync.ts`) |
| `components/admin/SyncTab.tsx` | Add conditional case: `syncType.id === 'job_name' ? ... : ...` with custom hook |

Example pattern from `useCamperHistorySync.ts`:
- Hook accepts year, calls `/api/custom/sync/{job}?year=${year}`
- SyncTab.tsx uses `{jobName}Sync.mutate(currentYear)` instead of `runIndividualSync`

For jobs with other custom parameters (session, etc.), similar pattern applies.

### 7. Historical Sync Support (if year-specific)

> **Note**: All year-scoped sync types are automatically available for historical syncs unless marked with `currentYearOnly: true` in syncTypes.ts. No separate array registration needed.

| Consideration | When to use `currentYearOnly: true` |
|---------------|-------------------------------------|
| Current-year-only jobs | Jobs like `bunk_requests` and `process_requests` that only make sense for current year |
| Normal year-scoped jobs | Most jobs don't need this flag and work for any year |

### 8. Google Sheets Export (if needed)

| File | Action |
|------|--------|
| `sync/table_exporter.go` | Add table to `GetReadableYearExports()` or `GetReadableGlobalExports()` with column configs |
| `sync/table_exporter.go` | Add entry to `SyncJobToCollections` map (required for export skip optimization) |

**Export skip optimization**: When a sync job has no changes (Created=0, Updated=0, Deleted=0, Errors=0), its corresponding sheet export is skipped. The `SyncJobToCollections` map links sync job names to their PocketBase collections so the export system knows which sheets can be skipped.

**The two rows above are independent.** A job may need a `SyncJobToCollections` entry and **no**
export config at all — that is the correct shape for anything writing data that must never reach a
spreadsheet. `lodging_assignments` is the worked example: it is in the map so the skip optimisation
knows what it writes, and deliberately absent from `GetReadableYearExports()`, with
`sync/lodging_phi_test.go` asserting that membership in the map never implies an export.

Example for a new `widgets` sync that populates the `widgets` table:
```go
var SyncJobToCollections = map[string][]string{
    // ... existing entries ...
    "widgets": {"widgets"},  // Add your sync job → collection mapping
}
```

**Note**: Some syncs populate multiple collections (e.g., `persons` → `persons` + `households`). List all collections in the slice.

### 9. Computed/Derived Tables (if reading from other synced tables)

If your sync reads from tables populated by OTHER syncs (not CampMinder directly):

| Consideration | Action |
|---------------|--------|
| orderedJobs position | Place AFTER all dependency syncs in the array |
| Custom values dependency | If needs `person_custom_values` or `household_custom_values`, these run weekly - sync will use existing data in daily runs |
| Historical with custom values | When `IncludeCustomValues=true`, ensure your sync is listed AFTER custom values syncs in `RunSyncWithOptions()` |

Example: `family_camp_derived` depends on `person_custom_values` and `household_custom_values`, so it's added to `servicesToRun` after the custom values syncs when `opts.IncludeCustomValues` is true.

### Quick Reference: Sync ID Conventions

- Go: `job_name` (snake_case in orderedJobs, maps to `job-name` endpoint)
- Frontend: `job_name` in syncTypes.ts (auto-converted to `job-name` for API)
- API: `/api/custom/sync/job-name` (kebab-case)

### Verification Checklist

After implementation, verify ALL of these work:

- [ ] `go build .` in pocketbase/ succeeds
- [ ] `npm run build` in frontend/ succeeds
- [ ] Job appears in Admin → Sync tab with correct icon/color
- [ ] Individual "Run" button triggers the sync
- [ ] Unified sync (current year) includes the job
- [ ] Unified sync (historical year) includes the job (unless `currentYearOnly: true`)
- [ ] Status shows created/updated/errors after completion

### Common Mistakes (Lessons Learned)

| Mistake | Consequence | Prevention |
|---------|-------------|------------|
| Service registered but not in `orderedJobs` | Won't run in daily sync | Always add to both places |
| Missing from `handleSyncStatus()` syncTypes | GUI never shows stats (always "idle") | Add to syncTypes array in api.go:711 |
| Year-param endpoint without custom hook | Frontend errors on "Run" button | Check if API handler has `year` query param |
| Missing historical re-registration | Won't run in historical imports | Add `NewXxxSync()` call in `RunSyncWithOptions()` block |
| Derived table before dependencies | Empty results, relation errors | Map dependency chain, place after deps in orderedJobs |
| Global table in historical sync | Unnecessary re-sync of static data | Check if table has `year` field - if not, it's global |
| Missing `SyncJobToCollections` entry | Sheet always re-exported even when no changes | Add sync job to mapping in `table_exporter.go` |

## Reading Derived Informational Tables (Active-Enrolment Filtering)

A derived informational table must be filtered by **active enrolment at read time** — an `attendees`
row with `status_id = 2` for that person and that year — never swept by deletion. This is a read-side
rule, not a sync change: rows for a cancelled camper or a staffer who left mid-season stay in the
table by design. None of these tables has a history table behind it, so a delete is unrecoverable — a
re-registration, a correction, or a later re-enrolment cannot get a deleted row back.

⚠️ **The filter is per-(person, year) and must not be applied across years.** A staffer who worked a
prior session, or a camper attending a second session, keeps their historical rows — that is why a
read-side filter is correct where a delete is not: the filter is scoped to the view's own year, a
delete is not.

⛔ **`family_camp_registrations` must never be touched, swept, or filtered destructively.** Its
`cabin_assignment` column is populated on 427 / 423 / 472 / 464 rows for 2022 / 2023 / 2024 / 2025 and
is the only pre-2026 placement history anywhere in the database.

**Which tables the predicate applies to** (measured 2026-08-08 against the production snapshot — cited
as measured on that date, not re-derived live):

| Table | Grain | 2026 rows | no active enrolment (2026) | 2025 |
|---|---|---|---|---|
| `camper_dietary` | person × year | 895 | 64 (7.2%) | 145 / 1084 (13.4%) |
| `camper_transportation` | person × session | 1661 | 10 (0.6%) | 11 / 1969 |
| `quest_registrations` | person × year | 69 | 1 | 0 / 64 |
| `staff_skills` | person, not enrolment | 401 | predicate does not apply — staff are not attendees | — |
| `household_demographics` | household, not enrolment | 1603 | predicate does not apply — household-grain | — |

**The point worth stating plainly: a dashboard that reads `camper_dietary` unfiltered ships a 7.2%
(2026) / 13.4% (2025) error.** That gap is the whole reason this rule exists: the three
enrolment-grain tables above (`camper_dietary`, `camper_transportation`, `quest_registrations`) each
carry stale rows for people no longer actively enrolled, at the percentages measured.

**No reader applies this filter today, because these three tables have no reader today.**
`table_exporter.go`'s `SyncJobToCollections` map is *not* a reader — its own comment says it exists
only so the export-skip optimisation knows which collections a sync job writes; nothing there touches
a row. The one real live reader, `GetReadableYearExports()`, covers `staff_skills` and
`household_demographics` — the two tables above where the predicate does **not** apply, since staff
are not attendees and the household grain has no per-person enrolment to check. This rule is written
down for whoever builds the first reader of `camper_dietary`, `camper_transportation`, or
`quest_registrations` — a future staff dashboard or PDF export — so that reader doesn't inherit the
error above silently.

## Python Request Processor (`bunking/sync/bunk_request_processor/`)
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

## Sync Dependencies (Order Matters)

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
