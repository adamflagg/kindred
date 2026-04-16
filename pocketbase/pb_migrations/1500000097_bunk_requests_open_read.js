/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Open bunk_requests list/view rules to any authenticated user.
 *
 * Before this migration, #1500000096 required `cached_permissions ~ "bunking.view"`.
 * `bunking.view` is no longer granted by any role (removed during RBAC consolidation),
 * so the rule failed for every non-admin user — including bunking staff who hold
 * `bunking.manage`. Users saw empty lists instead of 403s.
 *
 * Product intent: any signed-in user can read bunk_requests for context;
 * writes (create/update/delete) remain gated on `bunking.manage`.
 *
 * Rollback restores the broken #096 state — if the prior migration is also
 * rolled back, the collection returns to its pre-#096 baseline.
 */

migrate((app) => {
  const anyAuthed = '@request.auth.id != ""'
  const bunkingManage = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

  const col = app.findCollectionByNameOrId("bunk_requests")
  col.listRule = anyAuthed
  col.viewRule = anyAuthed
  col.createRule = bunkingManage
  col.updateRule = bunkingManage
  col.deleteRule = bunkingManage
  app.save(col)
}, (app) => {
  // Rollback: restore the #096 state (list/view on bunking.view, writes on bunking.manage).
  const bunkingView = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.view"'
  const bunkingManage = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

  const col = app.findCollectionByNameOrId("bunk_requests")
  col.listRule = bunkingView
  col.viewRule = bunkingView
  col.createRule = bunkingManage
  col.updateRule = bunkingManage
  col.deleteRule = bunkingManage
  app.save(col)
});
