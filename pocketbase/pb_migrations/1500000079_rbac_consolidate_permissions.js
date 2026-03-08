/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Consolidate RBAC permissions — remove sync.run and users.manage
 * Dependencies: RBAC simplify roles (1500000078)
 *
 * - Deletes the Data Admin role (sync.run absorbed into bunking.manage)
 * - Renames "Bunking Manager" → "Bunking Staff" (slug: bunking-staff)
 * - Removes users.manage from user_roles collection rules (admin-only)
 * - Cleans sync.run from any user's cached_permissions
 */

migrate((app) => {
  const rolesCol = app.findCollectionByNameOrId("roles")
  const userRolesCol = app.findCollectionByNameOrId("user_roles")

  // 1. Delete the Data Admin role and its user_roles
  try {
    const dataAdminRecords = app.findRecordsByFilter(rolesCol.id, `slug = "data-admin"`, "", 1, 0)
    if (dataAdminRecords.length > 0) {
      // Clean up user_roles referencing this role before deleting
      try {
        const orphaned = app.findRecordsByFilter(userRolesCol.id, `role = "${dataAdminRecords[0].id}"`, "", 1000, 0)
        for (const ur of orphaned) {
          app.delete(ur)
        }
      } catch (_e) {
        // No user_roles found for this role
      }
      app.delete(dataAdminRecords[0])
    }
  } catch (_e) {
    // Data Admin role may not exist
  }

  // 2. Rename Bunking Manager → Bunking Staff
  try {
    const bmRecords = app.findRecordsByFilter(rolesCol.id, `slug = "bunking-manager"`, "", 1, 0)
    if (bmRecords.length > 0) {
      bmRecords[0].set("name", "Bunking Staff")
      bmRecords[0].set("slug", "bunking-staff")
      bmRecords[0].set("description", "Full bunking access: board, requests, scenarios, solver, CSV upload, CampMinder sync")
      bmRecords[0].set("permissions", ["bunking.manage"])
      app.save(bmRecords[0])
    }
  } catch (_e) {
    // Bunking Manager role may not exist
  }

  // 3. Update user_roles collection rules — remove users.manage permission check
  const urCol = app.findCollectionByNameOrId("user_roles")
  urCol.createRule = '@request.auth.is_admin = true'
  urCol.updateRule = '@request.auth.is_admin = true'
  urCol.deleteRule = '@request.auth.is_admin = true'
  app.save(urCol)

  // 4. Clean sync.run from any user's cached_permissions
  const usersCol = app.findCollectionByNameOrId("_pb_users_auth_")
  try {
    const usersWithSyncRun = app.findRecordsByFilter(usersCol.id, `cached_permissions ~ "sync.run"`, "", 1000, 0)
    for (const user of usersWithSyncRun) {
      const perms = user.get("cached_permissions") || []
      const filtered = perms.filter((p) => p !== "sync.run")
      user.set("cached_permissions", filtered)
      app.save(user)
    }
  } catch (_e) {
    // No users with sync.run permission found
  }

}, (app) => {
  // Revert: re-create Data Admin, rename Bunking Staff back, restore rules

  const rolesCol = app.findCollectionByNameOrId("roles")

  // 1. Re-create Data Admin role
  try {
    const da = new Record(rolesCol)
    da.set("name", "Data Admin")
    da.set("slug", "data-admin")
    da.set("description", "CampMinder sync operations")
    da.set("permissions", ["sync.run"])
    da.set("is_system", true)
    app.save(da)
  } catch (_e) {
    // Role may already exist
  }

  // 2. Rename Bunking Staff back to Bunking Manager
  try {
    const bsRecords = app.findRecordsByFilter(rolesCol.id, `slug = "bunking-staff"`, "", 1, 0)
    if (bsRecords.length > 0) {
      bsRecords[0].set("name", "Bunking Manager")
      bsRecords[0].set("slug", "bunking-manager")
      bsRecords[0].set("description", "Full bunking access: board, requests, scenarios, solver, CSV upload")
      bsRecords[0].set("permissions", ["bunking.manage"])
      app.save(bsRecords[0])
    }
  } catch (_e) {
    // Bunking Staff role may not exist
  }

  // 3. Restore user_roles rules with users.manage check
  const urCol = app.findCollectionByNameOrId("user_roles")
  urCol.createRule = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"'
  urCol.updateRule = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"'
  urCol.deleteRule = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"'
  app.save(urCol)
});
