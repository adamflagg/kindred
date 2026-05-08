# Sync Order and Dependency Chain

## Why Order Matters

Sync jobs have data dependencies. A job that reads from a table populated by another job must run after that job. The orchestrator enforces this through **phases** and **job ordering within phases**.

## Phase Execution Order

Phases execute strictly in order: Source -> Expensive -> Transform -> Process -> Export.

### Phase 1: Source (CampMinder API)

These jobs fetch data directly from the CampMinder API and write to PocketBase tables.

```
session_groups  (no dependencies -- session group definitions)
    |
sessions        (reads session_groups for group_id -> PB ID mapping)
    |
attendees       (reads camp_sessions for session validation)
    |
persons         (reads attendees for person ID list -- only syncs persons who are attendees)
    |
bunks           (no strict dependency, but runs after persons by convention)
    |
bunk_plans      (reads bunks + camp_sessions for validation)
    |
bunk_assignments (reads bunk_plans + bunks + camp_sessions + persons for validation)
    |
staff           (no strict dependency on above, but runs late to minimize API calls)
    |
financial_transactions (independent, runs last in source phase)
```

**Key insight:** `persons` depends on `attendees` because it reads the attendees table to build the list of person IDs to fetch from CampMinder. This avoids fetching every person in the CampMinder system -- only those enrolled as attendees.

### Phase 2: Expensive (Custom Values)

These jobs make one API call per entity (person or household). They are expensive and rate-limited, so they only run weekly or on explicit request.

```
person_custom_values      (reads persons for person ID list)
    |
household_custom_values   (reads persons for household ID list)
```

**Sequential execution required:** These run sequentially (not parallel) to avoid CampMinder API rate limit errors from concurrent requests.

### Phase 3: Transform (PocketBase -> PocketBase)

These jobs read from tables populated by Source and Expensive phases, then write derived/aggregated data to new tables. No external API calls.

```
camper_history             (reads attendees + persons + camp_sessions)
family_camp_derived        (reads person_custom_values + household_custom_values)
staff_skills               (reads person_custom_values)
financial_aid_applications (reads person_custom_values)
household_demographics     (reads household_custom_values)
camper_dietary             (reads person_custom_values)
camper_transportation      (reads person_custom_values)
quest_registrations        (reads person_custom_values)
staff_applications         (reads person_custom_values)
staff_vehicle_info         (reads person_custom_values)
normalize_geographic       (reads persons -- normalizes city/state/school data)
enrollment_snapshots       (reads attendees -- captures point-in-time enrollment counts)
```

**Important:** Transform jobs use *existing* custom values data during daily syncs. Custom values are only refreshed during weekly or on-demand syncs. This means transform results may be up to 7 days stale for custom-value-derived data.

### Phase 4: Process (CSV + AI)

```
bunk_requests      (imports CSV files into original_bunk_requests)
    |
process_requests   (runs AI pipeline on original_bunk_requests -> bunk_requests)
```

### Phase 5: Export

```
multi_workbook_export  (reads all PocketBase tables -> Google Sheets)
```

## Adding a New Job to the Order

1. **Determine the phase:** Does it call CampMinder API (Source/Expensive), compute from existing PB data (Transform), or process external input (Process)?

2. **Map dependencies:** Which tables does it read from? It must come after the jobs that populate those tables.

3. **Add to `syncJobMeta`** in `orchestrator.go`:
   ```go
   var syncJobMeta = []JobMeta{
       // ... existing jobs ...
       {"your_job", PhaseTransform, "Description of what it computes"},
   }
   ```

4. **Add to `GetDefaultUnifiedSyncJobs()`** in the appropriate position within its phase group.

5. **Register the service** in `InitializeSyncServices()`.

## Sync Schedules

| Schedule | What runs | When |
|----------|-----------|------|
| **Hourly** | bunk_assignments only | Every hour (`:00`) |
| **Daily** | All Source + Transform + Process + Export | 3:00 AM |
| **Weekly** | All Source + Expensive + Transform + Process + Export | Sunday 2:00 AM |

## Historical Syncs

Historical syncs re-run Source + Transform (optionally Expensive) for a past year. They use a year-override client that changes `GetSeasonID()` to return the historical year.

- All year-scoped jobs are included by default
- `currentYearOnly: true` in frontend `syncTypes.ts` excludes jobs from historical sync UI
- The orchestrator creates fresh service instances with the year-override client during historical syncs
