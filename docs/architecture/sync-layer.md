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

`syncJobMeta` is the single declaration every sync queue derives from — the daily cron, the
hourly cron, the weekly custom-values cron, an admin-triggered phase run, and a unified full
run are all *computed* from this table's rows, not separately registered. The helpers that do
the deriving (`cadenceQueue`, `inPhaseWithTrigger`, `jobsWithTrigger`, `hasTrigger`,
`available`, `orderQueue`) live in `sync/registry.go`.

| Location | Action |
|----------|--------|
| `InitializeSyncServices()` | Register service with `RegisterService()` in dependency order |
| `RunSyncWithOptions()` re-registration | Add `NewXxxSync(o.app, yearClient)` call in historical re-registration block (~line 1966) |
| `syncJobMeta` | Add ONE row: `{ID, Phase, Description, Cadences, Triggers, CurrentYearOnly, Gate}` (plus `Base`/`Scope` for a scoped variant — see scope.go). `Cadences` puts the job on the crons it should run on (`CadenceDaily`, `CadenceHourly`, `CadenceWeeklyGlobal`, `CadenceWeeklyCustomValues` — a bitset, so a job can carry more than one). `Triggers` says which operator-facing entry points may start it (`TriggerIndividualRoute`, `TriggerPhaseRun`, `TriggerFullRun`). `CurrentYearOnly: true` excludes it from a historical replay. `Gate` is an optional `func() bool` environment check (see `process_requests`' `IS_DOCKER` gate or `multi_workbook_export`'s `google.IsEnabled` for the pattern). Physical position in the slice matters too — see §9 below. |

**Common mistake**: Registering the service but leaving its `syncJobMeta` row with no `Cadences`
and no `Triggers` set — `TestRegistryIntegrity` (`registry_test.go`) fails immediately ("no
cadence and no trigger -- nothing can ever run it"), which is loud, but it does not tell you
*which* bits to set. Copy the shape of a comparable existing row rather than guessing; a normal
daily-cron, full-run-eligible job carries `Cadences: CadenceDaily, Triggers:
TriggerIndividualRoute | TriggerPhaseRun | TriggerFullRun`.

**Still to come, not yet true of every job:** `multi_workbook_export` carries no `TriggerFullRun`
bit and still exports via a hardcoded epilogue in `RunSyncWithOptions` on a unified run, not via
the derived full-run queue, until Stage 4 removes that epilogue and sets the bit for real
(`TestMultiWorkbookExportWithholdsFullRunTrigger` in `registry_test.go` pins the withheld bit
and names the commit that deletes the assertion).

**The five global definition tables are ordinary rows now.** `person_tag_defs`,
`custom_field_defs`, `staff_lookups`, `financial_lookups` and `divisions` are rows in
`syncJobMeta` like any other job as of Stage 3 — they no longer come from a hand-written list.
Each carries only `Cadences: CadenceWeeklyGlobal, Triggers: TriggerIndividualRoute` and nothing
else: no `TriggerFullRun` (a historical replay must not re-sync current-year-client global data
against a past season), no `TriggerPhaseRun` (`PhaseGlobal` is a classification the crons and
`GetAllPhases()` use to group these rows, not something `Run Phase` can target — see the
`PhaseGlobal` doc comment in `orchestrator.go`), and no `Gate` (neither `IS_DOCKER` nor
`google.IsEnabled` has ever gated a global). `GetWeeklySyncJobs()` is now
`jobsWithCadence(CadenceWeeklyGlobal)` over this same table rather than its own hand-written
list.

**Exception — a SCOPED VARIANT skips several steps below.** A scoped variant (`Base` + `Scope`
set, e.g. `person_custom_values_family_camp`) is a narrower-cohort instance of an existing
service, registered under `scopedID(base, scope)`. It is cron-driven only:

| Step | A scoped variant instead |
|------|--------------------------|
| §2 `syncJobMeta` `Triggers` | **Leave unset (0).** Today's two scoped rows (the family-camp custom-values pair) carry no `Triggers` bits at all — no `TriggerFullRun` (must not appear in a full or historical run — the daily cron already covers it, and re-running the cohort burns rate-limited CampMinder quota for values that are already fresh, #2489), no `TriggerPhaseRun` (must not appear in an admin-triggered phase run either, #2489), no `TriggerIndividualRoute` (no Run button — see the route row below). This is a fact `TestScopedVariantContract` verifies about the current rows, not a structural guarantee the type system enforces — see that test's comment on the `TriggerPhaseRun` clause. |
| §2 `RunSyncWithOptions()` re-registration | **Known gap, not a rule.** The scoped instances are the one place the current implementation diverges from this checklist: they are never re-registered against a year client, so a historical run silently uses the current-year instance. Tracked at #2608 — out of scope for the declaration refactor, which is zero-behavior-change. |
| §3 Register route | **Omit — no individual POST route.** There is no Run button to call, and since the registry refactor's Stage 3 the server enforces that: `ResolveUnifiedSyncServices` whitelists an explicitly named `?service=` against `TriggerIndividualRoute` and returns `nil` for a job that does not declare it, which `handleUnifiedSync` answers **400** to (#2608). `POST /api/custom/sync/run?service=person_custom_values_family_camp` is therefore rejected rather than run. It used to be passed straight through, which is why `TestScopedVariantContract` and the frontend's `manualTrigger: false` guard were the only things holding the convention; both still matter — the test pins that no route is *registered* in the first place, which the whitelist cannot see, and the frontend flag keeps the option out of the Full-mode dropdown so a user never has to discover the 400. |
| §3 Add to status endpoint | **No longer a step.** `statusSyncTypes()` derives from `syncJobMeta` (`allJobIDs()`), so any row — scoped variant or not — is published on the status payload the moment it has one; there is nothing left to add by hand. The reason this mattered is unchanged: a targeted refresh sets no run-type flag, so the per-job status entry is the client's only completion signal (#2591) — it is just structural now instead of a step to remember. |
| §5 `syncTypes.ts` | Card still required, but with `manualTrigger: false` — pinned to the backend route table by `syncTypes.test.ts`. |

`TestScopedVariantContract` (`scope_test.go`) enforces the full-run/phase-run exclusion, route
and status rows, plus the `SyncJobToCollections` requirement below. The `syncTypes.ts` row is
enforced on the frontend side instead, by `syncTypes.test.ts`. The re-registration row is enforced by
nothing — that is what makes it a gap.

It does still need its `SyncJobToCollections` entry, mapped to the **same collections as its
base**, or its writes are dropped from the export skip-optimisation (#2491).

### 2b. Orchestrator Test (`orchestrator_test.go`) — still needs updating, but registers nothing

`TestRunSyncWithOptionsPhaseOrdering` pins the unified historical job list **exhaustively** via
its `expectedOrder` slice (`isCurrentYear=false`). A new job carrying `TriggerFullRun` and no
`CurrentYearOnly` still fails the suite with a job-count mismatch (`expected 22 jobs, got 23`)
until it is added there, in the position `GetDefaultUnifiedSyncJobs` derives for it.

Unlike before this branch, this is **not** a registration site — the `syncJobMeta` row's
`Triggers`/`CurrentYearOnly` bits are what actually make the job run in a unified sync; this
test only asserts the derived result stays what it was. It is the same closed-suite pattern as
`TestDailyQueueDerivation` and `TestUnifiedRunDerivation` (`registry_test.go`) use for the
daily cron and the full run: skipping the update fails the suite, but nothing here wires
anything up.

### 3. API Endpoint (`api.go`)

| Action | Details |
|--------|---------|
| Add handler function | `handle{JobName}Sync()` with query param validation |
| Register route | `POST /api/custom/sync/{job-name}` with `requireAuth` wrapper |
| Add to status endpoint | **Nothing to do.** `statusSyncTypes()` derives from `syncJobMeta` via `allJobIDs()` — the §2 `syncJobMeta` row already publishes the job on the status payload; there is no separate list to edit. |

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

**REQUIRED if API endpoint requires `year` parameter** (like `family_camp_derived`, `lodging_assignments`):

| File | Action |
|------|--------|
| `hooks/use{JobName}Sync.ts` | Custom hook that passes year to endpoint (copy from `useFamilyCampDerivedSync.ts`) |
| `components/admin/SyncTab.tsx` | Add conditional case: `syncType.id === 'job_name' ? ... : ...` with custom hook |

Example pattern from `useFamilyCampDerivedSync.ts`:
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
`sync/lodging_medical_narrative_test.go` asserting that membership in the map never implies an export.

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
| `syncJobMeta` declaration position | Place the new row AFTER all dependency syncs' rows — the daily and full-run queues both walk `syncJobMeta` in declaration order, so physical position IS execution order, subject to `orderQueue` (see below). Nothing sorts by phase at run time: the table is *grouped* by phase as a convention, so a row placed in the wrong group runs in the wrong place (see the comment above the Source-phase block in `orchestrator.go`) |
| `orderQueue`'s one exception | `stranded_assignment_cleanup` is moved to the END of every derived queue regardless of where its row sits, because it sweeps scenario drafts stranded by bunk-plan reorganizations and must run after `bunk_plans` is final (#1416, #1417). It is the only such exception; a second one means the registry ORDER is wrong and the rows should move instead |
| Custom values dependency | If needs `person_custom_values` or `household_custom_values`, these run weekly - sync will use existing data in daily runs |
| Historical with custom values | When `IncludeCustomValues=true`, ensure your row is declared AFTER the custom-values rows so `GetDefaultUnifiedSyncJobs` derives it in the right order |

Example: `family_camp_derived` depends on `person_custom_values` and `household_custom_values`, so its `syncJobMeta` row is declared after theirs, and it is derived into the queue after them whenever `opts.IncludeCustomValues` is true.

### Quick Reference: Sync ID Conventions

- Go: `job_name` (snake_case, declared as the `ID` in `syncJobMeta`, maps to `job-name` endpoint)
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
| Service registered but its `syncJobMeta` row has no `Cadences`/`Triggers` | Fails loud: `TestRegistryIntegrity` rejects it ("no cadence and no trigger") | Set at least one `Cadence` and the `Triggers` the job needs; copy a comparable row |
| Missing from `handleSyncStatus()` syncTypes *(no longer possible)* | — | There is no `syncTypes` array to forget: `statusSyncTypes()` derives from `syncJobMeta` via `allJobIDs()`, so a job with a `syncJobMeta` row (§2) is on the status payload automatically. |
| Year-param endpoint without custom hook | Frontend errors on "Run" button | Check if API handler has `year` query param |
| Missing historical re-registration | Won't run in historical imports | Add `NewXxxSync()` call in `RunSyncWithOptions()` block |
| Derived table before dependencies | Empty results, relation errors | Map dependency chain, place its `syncJobMeta` row after its deps' rows |
| Global table in historical sync | Unnecessary re-sync of static data | Check if table has `year` field - if not, it's global |
| Missing `SyncJobToCollections` entry | Sheet always re-exported even when no changes | Add sync job to mapping in `table_exporter.go` |

## Reading Derived Informational Tables (Active-Enrollment Filtering)

A derived informational table must be filtered by **active enrollment at read time** — an `attendees`
row with `status_id = 2` for that person and that year — never swept by deletion. This is a read-side
rule, not a sync change: rows for a cancelled camper or a staffer who left mid-season stay in the
table by design. None of these tables has a history table behind it, so a delete is unrecoverable — a
re-registration, a correction, or a later re-enrollment cannot get a deleted row back.

⚠️ **The filter is per-(person, year) and must not be applied across years.** A staffer who worked a
prior session, or a camper attending a second session, keeps their historical rows — that is why a
read-side filter is correct where a delete is not: the filter is scoped to the view's own year, a
delete is not.

⛔ **`family_camp_registrations` must never be touched, swept, or filtered destructively.** Its
`cabin_assignment` column is populated on 427 / 423 / 472 / 464 rows for 2022 / 2023 / 2024 / 2025 and
is the only pre-2026 placement history anywhere in the database.

**Which tables the predicate applies to** (measured 2026-08-08 against the production snapshot — cited
as measured on that date, not re-derived live):

| Table | Grain | 2026 rows | no active enrollment (2026) | 2025 |
|---|---|---|---|---|
| `camper_dietary` | person × year | 895 | 64 (7.2%) | 145 / 1084 (13.4%) |
| `camper_transportation` | person × session | 1661 | 10 (0.6%) | 11 / 1969 |
| `quest_registrations` | person × year | 69 | 1 | 0 / 64 |
| `staff_skills` | person, not enrollment | 401 | predicate does not apply — staff are not attendees | — |
| `household_demographics` | **(household, person, year)** — re-grained by kindred#2260 | ~2210 projected | **predicate DOES apply** to the person-attributed rows (~2181 of ~2210 for 2026); the ~29 `person_id = 0` rows carry genuinely household-level answers and are outside it | — |

**The point worth stating plainly: a dashboard that reads `camper_dietary` unfiltered ships a 7.2%
(2026) / 13.4% (2025) error.** That gap is the whole reason this rule exists: the three
enrollment-grain tables above (`camper_dietary`, `camper_transportation`, `quest_registrations`) each
carry stale rows for people no longer actively enrolled, at the percentages measured.

**No reader applies this filter today, because these three tables have no reader today.**
`table_exporter.go`'s `SyncJobToCollections` map is *not* a reader — its own comment says it exists
only so the export-skip optimisation knows which collections a sync job writes; nothing there touches
a row. The one real live reader, `GetReadableYearExports()`, covers `staff_skills` and
`household_demographics`. ⚠️ **Only the first of those is now outside the predicate.** Staff are not
attendees, so `staff_skills` genuinely has no enrollment to check. `household_demographics` used to be
in the same position and **is not any more**: kindred#2260 re-grained it to one row per (household,
person, year), so all but ~29 of its ~2210 2026 rows are attributed to a specific camper.
`loadPersonHouseholdMapping` admits any person with a household that year **regardless of enrollment
status**, so a cancelled camper keeps a row — and that row is exported, unfiltered, beside Jewish
identity, family description and custody answers. Anyone adding or changing a reader of this table
must decide the enrollment question deliberately rather than inheriting the old "household-grain, does
not apply" answer, which was true before that change and is false now.

This rule is written down for whoever builds the first reader of `camper_dietary`,
`camper_transportation`, or `quest_registrations` — a future staff dashboard or PDF export — so that
reader doesn't inherit the error above silently.

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
| **Derived Tables** | family_camp_derived, lodging_assignments, staff_skills, … | Computed from synced source data + custom values |
| **Processing** | bunk_requests → process_requests | CSV import and AI processing |

**Key ordering rules:**
1. **Source → Derived**: All derived tables (`family_camp_derived`, `lodging_assignments`, …) run AFTER source data syncs
2. **Custom values → Derived**: When `IncludeCustomValues=true` (historical sync), custom values run BEFORE derived tables
3. **Sequential custom values**: Custom values syncs run sequentially (not parallel) to prevent context deadline issues from concurrent API rate limiting
