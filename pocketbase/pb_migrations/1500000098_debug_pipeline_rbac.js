/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: loosen RBAC on debug_pipeline_* collections from admin-only
 * to bunking.manage, matching the CSV upload endpoint's auth gate.
 *
 * Fixes #1370: non-admin staff with bunking.manage permission could upload
 * CSVs (POST /api/custom/sync/bunk_requests_upload — gated by
 * requirePermission("bunking.manage", ...) in sync/api.go) but then got
 * 403 on the follow-up GET /api/collections/debug_pipeline_runs/records
 * call from useCsvPipelineStatus. Promise.allSettled swallowed the 403 as
 * null, derivePhase saw debug=null with sync.status=completed, and after
 * the 10-minute MATCHING_MAX_AGE_MS timeout returned phase=error — which
 * rendered as a red "Import failed" banner in the toolbar even though the
 * upload had succeeded.
 *
 * Collections only store summary counts (resolved/pending/declined),
 * run_id, status_breakdown — no per-camper data — safe to expose to users
 * with bunking.manage.
 */

migrate((app) => {
  const bunkingManage = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

  for (const name of ["debug_pipeline_runs", "debug_pipeline_traces", "debug_pipeline_summary"]) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = bunkingManage
    col.viewRule = bunkingManage
    app.save(col)
  }
}, (app) => {
  const adminOnly = '@request.auth.is_admin = true'

  for (const name of ["debug_pipeline_runs", "debug_pipeline_traces", "debug_pipeline_summary"]) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = adminOnly
    col.viewRule = adminOnly
    app.save(col)
  }
});
