# CampMinder Sync Gotchas

These are real failure modes encountered in production. Read before writing sync code.

## 1. Year Contamination (Critical)

**Problem:** CampMinder reuses session IDs, person IDs, and other identifiers across years. Without year isolation, syncing 2026 data overwrites 2025 records with the same CM IDs.

**Rules:**
- Every CampMinder data table MUST have a required `year` field
- All unique indexes MUST include `year` (e.g., `person_id + year + session`)
- `PreloadRecords()` automatically builds composite keys as `{cm_id}|{year}`
- `ProcessSimpleRecord()` requires `year` in `recordData` -- it will error without it
- `LookupRelation()` auto-adds year filtering for known year-scoped collections
- `PaginateRecords()` auto-adds year filtering for known year-scoped collections

**Year-scoped collections** (auto-filtered): `persons`, `camp_sessions`, `bunks`, `bunk_plans`, `bunk_assignments`, `attendees`

**Global collections** (no year field): `session_groups`, `person_tag_definitions`, `custom_field_definitions` -- use `PreloadRecordsGlobal()` and `ProcessSimpleRecordGlobal()` for these.

**How year flows:**
```go
year := s.Client.GetSeasonID()  // From CAMPMINDER_SEASON_ID env var
recordData["year"] = year       // MUST be set on every record
```

## 2. Sync Order Violations

**Problem:** Running a derived table before its source data syncs produces empty or stale results.

**Key dependencies:**
- `persons` depends on `attendees` (reads attendee person_ids to know which persons to fetch)
- `bunk_plans` depends on `bunks` and `sessions` (validates bunk/session CM IDs)
- `bunk_assignments` depends on `bunk_plans`, `bunks`, `sessions`, `persons`
- `camper_history` depends on `attendees`, `persons`, `sessions`
- `family_camp_derived` depends on `person_custom_values`, `household_custom_values`
- All transform-phase jobs use existing custom values data (may be stale from last weekly sync)

**Prevention:** New jobs must be added to `syncJobMeta` in `orchestrator.go` in the correct position. The phase determines execution order.

## 3. PocketBase Filter Syntax

**Problem:** PocketBase requires spaces around operators in filter expressions. `field=value` silently fails or returns unexpected results.

```go
// CORRECT
filter := fmt.Sprintf("year = %d", year)
filter := fmt.Sprintf("cm_id = %d && year = %d", cmID, year)

// WRONG - will silently fail
filter := fmt.Sprintf("year=%d", year)
filter := fmt.Sprintf("cm_id=%d&&year=%d", cmID, year)
```

**Also note:** String values in filters must be single-quoted:
```go
filter := fmt.Sprintf("id = '%s'", pbID)       // Correct
filter := fmt.Sprintf("status = '%s'", status)  // Correct
```

## 4. Family Camp Exclusion

**Problem:** Family camp sessions have different structures than main summer camp sessions. Including them in the solver or general bunking logic causes incorrect results.

**How it works:**
- Sessions are classified by `session_type` field (main, family, adult, embedded, tli, scit, other)
- Classification is based on `session_group` CM IDs defined in `sessions.go` constants
- The solver and bunking logic filter to `session_type = "main"` or specific types
- `family_camp_derived` handles family camp data separately via its own transform sync

## 5. Attendee Filtering for the Solver

**Problem:** Not all attendees should be included in cabin assignment optimization.

**The filter:** `is_active = 1 AND status_id = 2`
- `status_id = 2` means "enrolled" (not waitlisted, cancelled, withdrawn, etc.)
- `is_active = 1` filters out deactivated records
- Status map in `attendees.go`: 1=none, 2=enrolled, 4=applied, 8=waitlisted, 16=left_early, 32=cancelled, 64=dismissed, 128=inquiry, 256=withdrawn, 512=incomplete

## 6. Orphan Deletion Safety

**Problem:** If a sync fails mid-way, orphan detection would incorrectly delete records that weren't fetched yet.

**Safety mechanism:** `SyncSuccessful` flag. Orphan deletion only runs when `SyncSuccessful = true`. Set this flag only after the first successful data fetch:
```go
if page == 1 && len(results) > 0 {
    s.SyncSuccessful = true
}
```

## 7. Sequential Session Syncs

**Problem:** Bunk request processing (CSV import + AI parsing) for sessions 1-4 runs sequentially with independent history tracking. Running them in parallel causes race conditions on the `csv_history/` files.

**How it works:** The `process_requests` sync accepts a `session` parameter (0=all, 1-4=specific). When session=0, it processes each session sequentially.

## 8. Token Caching

**Problem:** CampMinder API authentication is rate-limited. Authenticating on every request wastes quota.

**How it works:** JWT tokens are cached in `~/.campminder_token_cache.json` with expiry tracking. The `campminder.Client` handles this transparently. If you see auth errors in tests, the token cache file may be stale or the mock may not handle auth correctly.

## 9. Missing Orchestrator Registration

**Problem:** Creating a sync service file but forgetting to register it in all required places means the job silently never runs.

**Complete registration checklist:**
1. Add to `syncJobMeta` in `orchestrator.go` (controls execution order and phase)
2. Add to `GetDefaultUnifiedSyncJobs()` (controls inclusion in unified syncs)
3. Register with `RegisterService()` in `InitializeSyncServices()`
4. Add to `handleSyncStatus()` known types in `api.go` (required for GUI status display)
5. Add to `SyncJobToCollections` in `table_exporter.go` (required for export skip optimization)

## 10. WAL Checkpoint After Writes

**Problem:** SQLite WAL mode means writes aren't immediately visible to other connections. Downstream sync jobs may not see data written by upstream jobs.

**Solution:** Call `s.ForceWALCheckpoint()` at the end of every sync that creates or updates records. The base implementation automatically skips the checkpoint if no writes occurred.

## 11. "cancelled" Spelling

**Problem:** The Go misspell linter defaults to US English ("canceled"). This project uses British spelling ("cancelled") consistently because PocketBase fields use it (`cancelled_count`).

**Configuration:** `.golangci.yml` has `extra-words` that maps "cancelled" to "cancelled" (identity mapping to suppress the linter). When you need to use "cancelled" in Go code and the linter complains, add `//nolint:misspell` with a comment:
```go
32: "cancelled", //nolint:misspell // CampMinder status value
```

## 12. Composite Key Patterns

**Problem:** Some tables have multi-field uniqueness (e.g., attendees are unique by person_id + session, not by a single CM ID). Using simple keys causes duplicate records.

**Solution:** Use `PreloadCompositeRecords()` and `ProcessCompositeRecord()`:
```go
key := fmt.Sprintf("%d:%d", personCMID, sessionCMID)
s.TrackProcessedCompositeKey(key, year)
// ...
s.ProcessCompositeRecord("attendees", key, recordData, existingRecords, []string{"year"})
```

The base utilities automatically append `|{year}` to composite keys for year isolation.
