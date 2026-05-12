/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Simplify RBAC rules — open view-level collections to all authenticated users
 * Dependencies: RBAC tier1 rules (1500000074)
 *
 * bunking.view and metrics.view permissions removed. All authenticated users
 * can now read reference data, bunking boards, and metrics.
 */

migrate((app) => {
  const authed = '@request.auth.id != ""'
  const adminOnly = '@request.auth.is_admin = true'

  function setRules(name, list, view, create, update, del_) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = list
    col.viewRule = view
    col.createRule = create
    col.updateRule = update
    col.deleteRule = del_
    app.save(col)
  }

  // Previously anyRole (required at least one permission) — now any authenticated user
  // Note: "persons", "attendees", "attendee_status_history", "config",
  // "camp_sessions" trimmed — final-state rules baked into merged CREATE.
  const openReadOnly = ["divisions"]
  for (const name of openReadOnly) {
    setRules(name, authed, authed, adminOnly, adminOnly, adminOnly)
  }

  // Previously bunking.view — now any authenticated user
  // Note: "bunk_assignments", "bunk_plans", "bunks" trimmed — final-state rules baked into merged CREATE.
  const bunkingReadOnly = []
  for (const name of bunkingReadOnly) {
    setRules(name, authed, authed, adminOnly, adminOnly, adminOnly)
  }

  // Users: previously anyRole — now any authenticated user
  const usersCol = app.findCollectionByNameOrId("_pb_users_auth_")
  usersCol.listRule = authed
  usersCol.viewRule = authed
  app.save(usersCol)

}, (app) => {
  // Revert to previous anyRole/bunkingView rules
  const anyRole = '@request.auth.is_admin = true || (@request.auth.cached_permissions != null && @request.auth.cached_permissions != "[]")'
  const bunkingView = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.view"'
  const adminOnly = '@request.auth.is_admin = true'

  function setRules(name, list, view, create, update, del_) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = list
    col.viewRule = view
    col.createRule = create
    col.updateRule = update
    col.deleteRule = del_
    app.save(col)
  }

  const anyRoleReadOnly = ["divisions"]
  for (const name of anyRoleReadOnly) {
    setRules(name, anyRole, anyRole, adminOnly, adminOnly, adminOnly)
  }

  const bunkingViewReadOnly = []
  for (const name of bunkingViewReadOnly) {
    setRules(name, bunkingView, bunkingView, adminOnly, adminOnly, adminOnly)
  }

  const usersCol = app.findCollectionByNameOrId("_pb_users_auth_")
  usersCol.listRule = anyRole
  usersCol.viewRule = anyRole
  app.save(usersCol)
});
