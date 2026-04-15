/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Move bunk_requests list/view rules from bunking.manage to bunking.view
 *
 * bunk_requests holds finalized bunk request data (status, notes, disposition).
 * It is NOT raw CSV/AI trace data (that's in original_bunk_requests).
 * Read access should be available to bunking.view users so they can see
 * the Bunking Status table on the camper detail page and pop-in modal.
 * Writes (create, update, delete) remain bunking.manage.
 *
 * Fixes: #899
 */

migrate((app) => {
  const bunkingView = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.view"'
  const bunkingManage = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

  const col = app.findCollectionByNameOrId("bunk_requests")
  col.listRule = bunkingView
  col.viewRule = bunkingView
  col.createRule = bunkingManage
  col.updateRule = bunkingManage
  col.deleteRule = bunkingManage
  app.save(col)

}, (app) => {
  // Rollback: restore list/view to bunking.manage
  const bunkingManage = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

  const col = app.findCollectionByNameOrId("bunk_requests")
  col.listRule = bunkingManage
  col.viewRule = bunkingManage
  col.createRule = bunkingManage
  col.updateRule = bunkingManage
  col.deleteRule = bunkingManage
  app.save(col)
});
