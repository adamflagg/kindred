/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create sync_runs collection
 * Dependencies: none
 *
 * One row per completed sync run. Written by the orchestrator's single completion store
 * (pocketbase/sync/sync_runs.go), pruned in the same write path after
 * sync.SyncRunRetentionDays.
 *
 * Why it exists: kindred#2284 split Stats.Errors into infrastructure failures (zero
 * tolerance) and Stats.Rejected (per-record transform failures). Rejected is warn-only for
 * its first season *specifically so a real distribution can be collected and a threshold set
 * from evidence later* — which requires storage. Until now the only record of a run was the
 * orchestrator's in-memory lastCompletedStatus map, wiped on every container restart.
 *
 * ONE table, not one per job type. Every job — CampMinder API syncs, custom-value syncs,
 * internal transforms, the request processor — implements the same three-method Service
 * interface and returns the same Stats struct; the job-type distinction is a *scheduling*
 * one and there is no kind/category concept anywhere in sync/. The four job-type-specific
 * counters are mirrored as plain nullable columns, exactly as Stats carries them as
 * `omitempty` fields.
 *
 * The rule for what gets a column: store what cannot be reconstructed, derive what can.
 * There is deliberately NO `kind` column — household_demographics is always a transform and
 * bunks is always an API sync, so storing it would duplicate a static fact and create a
 * second place to be wrong. `trigger` gets a column for the opposite reason: nothing in a
 * finished row says whether it came from the 3am cron or an operator pressing a button.
 *
 * Counter names carry a `_count` suffix because two of them cannot use the Stats field name:
 * `created` and `updated` are PocketBase's autodate columns. Suffixing all ten rather than
 * only the two that collide keeps a reader from having to remember which is which.
 *
 * Access: adminOnly, matching the tier-2 pattern. NOT the tier-3 `''` "denyAll" pattern used
 * by solver_runs — an empty-string rule is not a deny in PocketBase, it is *public*
 * (apis/record_crud.go:52 gates on `ListRule == nil`, and the filter at :68 is skipped when
 * the rule is empty). Error messages here can quote upstream record data, so this table
 * should not be world-readable.
 */

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true'

  const collection = new Collection({
    id: "col_sync_runs",
    type: "base",
    name: "sync_runs",
    listRule: adminOnly,
    viewRule: adminOnly,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: adminOnly,
    fields: [
      {
        // The sync job name, e.g. "bunk_assignments". The job's phase and kind are
        // derivable from it — see the header.
        type: "text",
        name: "service",
        required: true,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        // Required per the repo-wide year invariant. Note PocketBase's `required` check
        // rejects 0, which is how the orchestrator spells "the current season" — the writer
        // resolves it (sync.resolveRunYear) rather than copying Status.Year across.
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2000,
        max: 2100,
        onlyInt: true
      },
      {
        // Only completed runs are written, so "running"/"pending" cannot occur here.
        type: "select",
        name: "status",
        required: true,
        presentable: false,
        values: ["success", "failed"],
        maxSelect: 1
      },
      {
        // Must match the trigger constants in sync/orchestrator.go exactly — a value
        // outside this list is rejected, losing the row.
        type: "select",
        name: "trigger",
        required: true,
        presentable: false,
        values: ["hourly", "daily", "weekly", "custom_values", "historical", "manual"],
        maxSelect: 1
      },
      {
        // Groups every service execution of one queue, so a whole nightly run is one thing.
        // Minted when the queue starts. NOT the per-execution run token.
        type: "text",
        name: "batch_id",
        required: true,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "number",
        name: "created_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        type: "number",
        name: "updated_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        type: "number",
        name: "deleted_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        type: "number",
        name: "skipped_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        // Infrastructure failures — local SQLite operations that did not complete. Zero
        // tolerance: any non-zero count already failed the run.
        type: "number",
        name: "errors_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        // Per-record transform failures. Warn-only for its first season; this column is the
        // reason the table exists.
        type: "number",
        name: "rejected_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        // Job-type-specific: many-to-many expansions (bunk_plans).
        type: "number",
        name: "expanded_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        // Job-type-specific: records already processed (process_requests).
        type: "number",
        name: "already_processed_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        // Job-type-specific: stranded bunk_assignments rows found but not cleared.
        type: "number",
        name: "prod_audit_warnings_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        // Job-type-specific: enrollment-orphaned lodging_assignments rows found but not
        // cleared.
        type: "number",
        name: "lodging_prod_audit_warnings_count",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        // Wall-clock run length in SECONDS, matching Stats.Duration.
        type: "number",
        name: "duration",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        // Not required: a run that started at time zero is not a thing, but a required date
        // would reject a zero value the same way a required number rejects 0.
        type: "date",
        name: "started",
        required: false,
        presentable: false,
        min: "",
        max: ""
      },
      {
        type: "date",
        name: "ended",
        required: false,
        presentable: false,
        min: "",
        max: ""
      },
      {
        // Kept in step with sync.maxSyncRunErrorLen, which truncates to it. PocketBase
        // REJECTS an over-cap text write rather than truncating, so an unbounded message
        // would lose the whole row.
        type: "text",
        name: "error",
        required: false,
        presentable: false,
        min: 0,
        max: 20000,
        pattern: ""
      },
      {
        // Per-sub-entity counters for combined syncs (persons reports households here).
        type: "json",
        name: "sub_stats",
        required: false,
        presentable: false,
        maxSize: 100000
      },
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      // The prune scans `started < cutoff` on every write.
      "CREATE INDEX `idx_sync_runs_started` ON `sync_runs` (`started`)",
      // The calibration query: one service's counts over time.
      "CREATE INDEX `idx_sync_runs_service_started` ON `sync_runs` (`service`, `started`)",
      // Recover a whole nightly run.
      "CREATE INDEX `idx_sync_runs_batch_id` ON `sync_runs` (`batch_id`)",
      "CREATE INDEX `idx_sync_runs_year` ON `sync_runs` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("sync_runs");
  app.delete(collection);
});
