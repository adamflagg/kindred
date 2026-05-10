/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add manage panel permissions to roles
 * Dependencies: RBAC consolidate (1500000079)
 *
 * - Adds registration.manage to Registrar role
 * - Adds sheets.export to Finance and Bunking Staff roles
 * - Recomputes cached_permissions for affected users
 * - Restores users.manage support in user_roles collection rules
 * - (config write rule for registration.manage trimmed — baked into merged CREATE #011)
 */

migrate((app) => {
  const rolesCol = app.findCollectionByNameOrId("roles")

  // PocketBase JSVM returns JSON fields as raw byte arrays, not parsed JS arrays.
  // Array.from() on bytes yields [91, 34, 98, ...] (char codes) instead of strings.
  // This helper converts bytes → string → parsed array.
  function parsePerms(raw) {
    if (!raw) return []
    if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === "string")) return raw
    const bytes = Array.from(raw)
    const str = bytes.map((b) => String.fromCharCode(b)).join("")
    try { return JSON.parse(str) } catch (_e) { return [] }
  }

  // Helper: add a permission to a role if not present
  function addPermToRole(slug, perm) {
    const records = app.findRecordsByFilter(rolesCol.id, `slug = "${slug}"`, "", 1, 0)
    if (records.length === 0) return null
    const role = records[0]
    const perms = parsePerms(role.get("permissions"))
    if (!perms.includes(perm)) {
      role.set("permissions", [...perms, perm])
      app.save(role)
    }
    return role.id
  }

  // 1. Add permissions to roles
  const updatedRoleIds = [
    addPermToRole("registrar", "registration.manage"),
    addPermToRole("finance", "sheets.export"),
    addPermToRole("bunking-staff", "sheets.export"),
  ].filter(Boolean)

  // 2. Recompute cached_permissions for users with updated roles
  const usersCol = app.findCollectionByNameOrId("_pb_users_auth_")
  const userRolesCol = app.findCollectionByNameOrId("user_roles")
  const seenUsers = new Set()

  for (const roleId of updatedRoleIds) {
    const urs = app.findRecordsByFilter(userRolesCol.id, `role = "${roleId}"`, "", 1000, 0)
    for (const ur of urs) {
      const userId = ur.get("user")
      if (seenUsers.has(userId)) continue
      seenUsers.add(userId)

      // Aggregate permissions from all of this user's roles
      const allUserRoles = app.findRecordsByFilter(userRolesCol.id, `user = "${userId}"`, "", 100, 0)
      const permSet = new Set()
      for (const aur of allUserRoles) {
        const role = app.findRecordById(rolesCol.id, aur.get("role"))
        for (const p of parsePerms(role.get("permissions"))) {
          permSet.add(p)
        }
      }

      const user = app.findRecordById(usersCol.id, userId)
      user.set("cached_permissions", [...permSet].sort())
      app.save(user)
    }
  }

  // 3. Restore users.manage in user_roles collection rules
  const urCol = app.findCollectionByNameOrId("user_roles")
  const usersManageRule = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"'
  urCol.createRule = usersManageRule
  urCol.updateRule = usersManageRule
  urCol.deleteRule = usersManageRule
  app.save(urCol)

  // 4. Update config collection — trimmed; final rules baked into merged CREATE.

}, (app) => {
  // Revert: remove new permissions from roles, restore strict admin rules
  const rolesCol = app.findCollectionByNameOrId("roles")

  function parsePerms(raw) {
    if (!raw) return []
    if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === "string")) return raw
    const bytes = Array.from(raw)
    const str = bytes.map((b) => String.fromCharCode(b)).join("")
    try { return JSON.parse(str) } catch (_e) { return [] }
  }

  // Helper: remove a permission from a role
  function removePermFromRole(slug, perm) {
    const records = app.findRecordsByFilter(rolesCol.id, `slug = "${slug}"`, "", 1, 0)
    if (records.length === 0) return
    const role = records[0]
    const perms = parsePerms(role.get("permissions")).filter((p) => p !== perm)
    role.set("permissions", perms)
    app.save(role)
  }

  removePermFromRole("registrar", "registration.manage")
  removePermFromRole("finance", "sheets.export")
  removePermFromRole("bunking-staff", "sheets.export")

  // Revert user_roles rules to admin-only
  const urCol = app.findCollectionByNameOrId("user_roles")
  urCol.createRule = '@request.auth.is_admin = true'
  urCol.updateRule = '@request.auth.is_admin = true'
  urCol.deleteRule = '@request.auth.is_admin = true'
  app.save(urCol)

  // Revert config collection — trimmed; merged CREATE owns the rule state.
})
