/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Backfill bunk_requests.source_field for the #1142 rename.
 *
 * Task 5 renamed the two SourceField enum wire-values:
 *   "bunk_with"     → "bunk_request_form"
 *   "not_bunk_with" → "staff_not_bunk_with"
 *
 * Any rows written before this migration was applied will still carry the old
 * strings.  This migration updates them in-place.  New writes use the new
 * strings already (the Python write-path was updated in Task 6/7).
 *
 * Idempotent: rows with the new string are not touched; re-running after all
 * rows are updated is a no-op.
 *
 * Down-migration restores the old strings so a rollback puts the DB back in
 * the pre-rename state (useful when rolling back the application code too).
 */
migrate(
  (app) => {
    // bunk_with → bunk_request_form
    app.db().newQuery(
      `UPDATE bunk_requests SET source_field = 'bunk_request_form' WHERE source_field = 'bunk_with'`
    ).execute()

    // not_bunk_with → staff_not_bunk_with
    app.db().newQuery(
      `UPDATE bunk_requests SET source_field = 'staff_not_bunk_with' WHERE source_field = 'not_bunk_with'`
    ).execute()
  },
  (app) => {
    // Rollback: restore the old strings
    app.db().newQuery(
      `UPDATE bunk_requests SET source_field = 'bunk_with' WHERE source_field = 'bunk_request_form'`
    ).execute()

    app.db().newQuery(
      `UPDATE bunk_requests SET source_field = 'not_bunk_with' WHERE source_field = 'staff_not_bunk_with'`
    ).execute()
  }
)
