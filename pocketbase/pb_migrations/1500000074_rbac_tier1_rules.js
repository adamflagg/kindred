/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Apply RBAC rules to Tier 1 collections (frontend-accessed)
 * Dependencies: RBAC user fields (1500000072)
 *
 * Tier 1: Collections directly accessed by the frontend.
 * Rules use cached_permissions JSON field on users for efficient evaluation.
 */

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true'
  const anyRole = '@request.auth.is_admin = true || (@request.auth.cached_permissions != null && @request.auth.cached_permissions != "[]")'
  const bunkingView = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.view"'
  const bunkingManage = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

  // Helper to update a collection's rules
  function setRules(name, list, view, create, update, del_) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = list
    col.viewRule = view
    col.createRule = create
    col.updateRule = update
    col.deleteRule = del_
    app.save(col)
  }

  // Read-only: any role (shared reference data written by sync)
  // Note: "persons", "attendees", "attendee_status_history", "config",
  // "camp_sessions" trimmed — final-state rules baked into merged CREATE.
  // (config-specific: list/view = authed; create/update = admin ||
  // registration.manage; delete = admin only. camp_sessions final-state
  // rules from #077 simplification: list/view = authed, c/u/d = adminOnly.)
  const anyRoleReadOnly = ["divisions"]
  for (const name of anyRoleReadOnly) {
    setRules(name, anyRole, anyRole, adminOnly, adminOnly, adminOnly)
  }

  // Read-only: bunking.view (bunking data written by sync/solver)
  // Note: "bunk_assignments", "bunk_plans" trimmed — final-state rules baked into merged CREATE.
  // (bunk_plans final-state rules from #077 simplification: list/view = authed, c/u/d = adminOnly.)
  const bunkingViewReadOnly = ["bunks"]
  for (const name of bunkingViewReadOnly) {
    setRules(name, bunkingView, bunkingView, adminOnly, adminOnly, adminOnly)
  }

  // Read-only: bunking.manage (request source data written by sync)
  // Note: "bunk_request_sources", "original_bunk_requests" trimmed — final-state rules baked into merged CREATE.
  const bunkingManageReadOnly = []
  for (const name of bunkingManageReadOnly) {
    setRules(name, bunkingManage, bunkingManage, adminOnly, adminOnly, adminOnly)
  }

  // Read+Write: bunking.manage (frontend writes directly)
  // Note: "bunk_assignments_draft", "locked_group_members" trimmed — all 5 rules use bunkingManage, baked into merged CREATE.
  const bunkingManageReadWrite = ["locked_groups", "saved_scenarios"]
  for (const name of bunkingManageReadWrite) {
    setRules(name, bunkingManage, bunkingManage, bunkingManage, bunkingManage, bunkingManage)
  }

  // Users: any role can list/view (for admin panel display)
  const usersCol = app.findCollectionByNameOrId("_pb_users_auth_")
  usersCol.listRule = anyRole
  usersCol.viewRule = anyRole
  // Don't change create/update/delete for auth collection - PocketBase manages these
  app.save(usersCol)

}, (app) => {
  // Revert all to original permissive rules
  const authed = '@request.auth.id != ""'

  function revertRules(name) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = authed
    col.viewRule = authed
    col.createRule = authed
    col.updateRule = authed
    col.deleteRule = authed
    app.save(col)
  }

  const collections = [
    "divisions",
    "bunks",
    "locked_groups", "saved_scenarios"
  ]
  for (const name of collections) {
    revertRules(name)
  }

  const usersCol = app.findCollectionByNameOrId("_pb_users_auth_")
  usersCol.listRule = authed
  usersCol.viewRule = authed
  app.save(usersCol)
});
