---
name: campminder-sync
description: Use when modifying Go sync services, adding new CampMinder data tables, changing sync jobs, or debugging data integrity issues between CampMinder and PocketBase. Triggers on pocketbase/ Go sync code changes.
---

# CampMinder Sync Layer

## The #1 Rule

**ALL cross-table relationships use CampMinder IDs, NEVER PocketBase IDs.**

PocketBase IDs are auto-generated and unstable across syncs. CampMinder IDs (`cm_id`, `person_id`, `session_id`, etc.) are the source of truth for all foreign key relationships. The only place PocketBase IDs appear in relation fields is after `PopulateRelations()` resolves CM IDs to PB IDs at write time.

```go
// CORRECT: Store the CampMinder ID, resolve PB ID only for the relation field
recordData["person_id"] = personCMID  // CM ID stored as data
relations := []RelationConfig{
    {FieldName: "person", Collection: "persons", CMID: personCMID, Required: false},
}
s.PopulateRelations(recordData, relations)

// WRONG: Never store or look up by PocketBase ID for cross-table references
recordData["person_id"] = record.Id  // NO - this is a PB ID
```

See `reference/id-conventions.md` for the full ID convention guide.

## Critical Gotchas

Before writing any sync code, read `gotchas.md`. The most common failures:

1. **Year contamination** -- CampMinder reuses session IDs across years. Every CampMinder data table MUST have a `year` field. Unique indexes MUST include year. Forgetting year isolation causes cross-year data pollution.

2. **Sync order violations** -- Derived tables that run before their dependencies produce empty results. The orchestrator enforces order via `syncJobMeta` in `orchestrator.go`.

3. **PocketBase filter syntax** -- ALWAYS use spaces around operators: `field = value`, never `field=value`. Missing spaces cause silent filter failures.

4. **Missing orchestrator registration** -- Registering a service but forgetting to add it to `syncJobMeta` means the job never runs in unified syncs.

5. **Spelling: "cancelled"** -- Use British spelling consistently. The `.golangci.yml` misspell linter is configured to accept `cancelled` as correct.

## Sync Order (Dependency Chain)

Jobs execute in phase order. Within each phase, jobs run sequentially in the order listed in `syncJobMeta`:

| Phase | Jobs | Notes |
|-------|------|-------|
| **Source** | session_groups, sessions, attendees, persons, bunks, bunk_plans, bunk_assignments, staff, financial_transactions | CampMinder API calls |
| **Expensive** | person_custom_values, household_custom_values | 1 API call per entity, run weekly/on-demand |
| **Transform** | camper_history, family_camp_derived, staff_skills, financial_aid_applications, household_demographics, camper_dietary, camper_transportation, quest_registrations, staff_applications, staff_vehicle_info, normalize_geographic, enrollment_snapshots | PocketBase-to-PocketBase computation |
| **Process** | bunk_requests, process_requests | CSV import + AI processing |
| **Export** | multi_workbook_export | Google Sheets export |

See `reference/sync-order.md` for why order matters and how to add new jobs.

## Go Coding Patterns

All sync services follow the same structural pattern. See `reference/go-patterns.md` for the complete guide including:

- Service struct embedding `BaseSyncService`
- Required interface methods: `Name()`, `Sync(ctx)`, `GetStats()`
- Preloading existing records for idempotent upserts
- Composite key construction for multi-field uniqueness
- Orphan detection and deletion
- WAL checkpoint after writes
- Context cancellation checks in loops

## Adding a New Sync Job

Follow the complete checklist in `docs/architecture/sync-layer.md` under "Adding a New Sync Job". The checklist covers:

1. Go sync service (`pocketbase/sync/{job_name}.go`)
2. Orchestrator registration (`orchestrator.go` -- add to `syncJobMeta` AND `GetDefaultUnifiedSyncJobs`)
3. API endpoint (`api.go`)
4. PocketBase migration (if new table)
5. Frontend type registration (`syncTypes.ts`, `useRunIndividualSync.ts`)
6. Historical sync support (if year-specific)
7. Google Sheets export mapping (`table_exporter.go`)

## Key Files

| File | Purpose |
|------|---------|
| `pocketbase/sync/orchestrator.go` | Sync sequencing, phases, job metadata |
| `pocketbase/sync/base_sync.go` | Shared utilities: preload, process, orphan delete, field comparison |
| `pocketbase/sync/api.go` | HTTP endpoints for triggering syncs |
| `pocketbase/sync/scheduler.go` | Cron scheduling (hourly, daily, weekly) |
| `pocketbase/campminder/client.go` | CampMinder API client, auth, token caching |
| `pocketbase/logging/logger.go` | Structured logging setup |
| `.golangci.yml` | Go linting rules (misspell, wrapcheck, etc.) |
| `docs/architecture/sync-layer.md` | Full architecture documentation |
