/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Repair corrupted role permissions from 1500000082
 *
 * The original migration used Array.from() on PocketBase JSON fields, which
 * returns byte values instead of parsed arrays in the JSVM. This corrupted
 * the permissions field on 3 system roles (bunking-staff, finance, registrar)
 * and the cached_permissions field on any users assigned those roles.
 *
 * This migration:
 * 1. Sets each affected role's permissions to the known-correct values
 * 2. Recomputes cached_permissions for all users with role assignments
 *
 * Idempotent: safe to run on databases where 1500000082 was already fixed.
 */

migrate((app) => {
  const rolesCol = app.findCollectionByNameOrId("roles")

  // PocketBase JSVM returns JSON fields as raw byte arrays, not parsed JS arrays.
  // This helper safely parses them regardless of format.
  function parsePerms(raw) {
    if (!raw) return []
    if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === "string")) return raw
    const bytes = Array.from(raw)
    const str = bytes.map((b) => String.fromCharCode(b)).join("")
    try { return JSON.parse(str) } catch (_e) { return [] }
  }

  // 1. Fix role permissions — set to known-correct values
  const correctPerms = {
    "bunking-staff": ["bunking.manage", "sheets.export"],
    "finance": ["metrics.financial", "sheets.export"],
    "registrar": ["metrics.geo", "registration.manage"],
  }

  for (const [slug, perms] of Object.entries(correctPerms)) {
    try {
      const records = app.findRecordsByFilter(rolesCol.id, `slug = "${slug}"`, "", 1, 0)
      if (records.length === 0) continue
      const role = records[0]
      const current = parsePerms(role.get("permissions"))

      // Skip if already correct (idempotent)
      if (
        current.length === perms.length &&
        perms.every((p) => current.includes(p))
      ) {
        continue
      }

      role.set("permissions", perms)
      app.save(role)
    } catch (_e) {
      // Role may not exist in this environment
    }
  }

  // 2. Recompute cached_permissions for all users with role assignments
  const usersCol = app.findCollectionByNameOrId("_pb_users_auth_")
  const userRolesCol = app.findCollectionByNameOrId("user_roles")

  // Find all users who have at least one role
  const allUserRoles = app.findRecordsByFilter(userRolesCol.id, "1 = 1", "", 10000, 0)
  const userIds = [...new Set(allUserRoles.map((ur) => ur.get("user")))]

  for (const userId of userIds) {
    try {
      const urs = app.findRecordsByFilter(userRolesCol.id, `user = "${userId}"`, "", 100, 0)
      const permSet = new Set()
      for (const ur of urs) {
        const role = app.findRecordById(rolesCol.id, ur.get("role"))
        for (const p of parsePerms(role.get("permissions"))) {
          permSet.add(p)
        }
      }

      const user = app.findRecordById(usersCol.id, userId)
      const newPerms = [...permSet].sort()
      const currentCached = user.get("cached_permissions") || []

      // Skip if already correct
      if (
        Array.isArray(currentCached) &&
        currentCached.length === newPerms.length &&
        newPerms.every((p) => currentCached.includes(p))
      ) {
        continue
      }

      user.set("cached_permissions", newPerms)
      app.save(user)
    } catch (_e) {
      // User may have been deleted
    }
  }
}, (_app) => {
  // No-op: the repair migration only fixes corrupted data to correct state.
  // Rolling back would re-corrupt it, which is never desired.
})
