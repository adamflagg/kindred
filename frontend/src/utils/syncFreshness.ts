import type { SyncStatus } from '../hooks/useSyncStatusAPI'

/**
 * The run a freshness line ("<noun> synced N ago") dates a job by: the job's own entry, unless
 * that entry is a dry run.
 *
 * The status payload keeps a dry run in the job's slot so Manage > Sync can show it, with its
 * "Dry run" chip and would-be counts. A dry run wrote nothing, though, so it must not move any
 * freshness line, and the 2017-2025 replay dry-runs every job first. For a dry run (running or
 * finished) the backend attaches the job's last REAL successful run as `last_real_run`
 * (`withLastRealRun`, pocketbase/sync/api.go); undefined when there is none, which a line
 * renders as no line at all. The time and the hover's counts then name the same real run.
 *
 * Kept out of useSyncStatusAPI.ts so a test that mocks that module whole still gets this.
 */
export function freshnessRun(job: SyncStatus | undefined): SyncStatus | undefined {
  return job?.dry_run ? job.last_real_run : job
}
