/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: the grantor directory's own permission, and retiring a grantor (owner ruling
 * 2026-10-01, "Grantor directory").
 * Dependencies: roles (1500000070), user_roles (1500000071), financial aid permissions and the
 * development role (1500000185), aid_grantors (1500000210).
 *
 * 1. financial_aid.grantors -- grantor create, save, retire/unretire, and mapping a CampMinder
 *    description to a grantor. Separate from financial_aid.rules (and from a future
 *    funding-sources permission). Granted, keyed by slug, to:
 *      development  (it trues up grantors and grants after the seed; still no family-level read)
 *      finance      (keeps grantor editing through this permission, no longer through rules)
 *    Admins pass every FastAPI gate already (bunking/rbac/dependencies.py), so no admin grant.
 *    The registrar and exec roles are not touched.
 *
 *    Production roles have drifted from the seed (1500000185's header), so a missing role is
 *    skipped, never recreated. cached_permissions is recomputed for every holder over ALL of their
 *    roles, as 1500000185 does: a migration must not depend on the Go roles hook.
 *
 * 2. aid_grantors.retired_at -- empty while the grantor is in use; the moment it was retired
 *    otherwise. A retired grantor is hidden from pickers and the default directory list, and kept
 *    for history: every read that resolves a grantor for a grant still finds it. FastAPI writes it
 *    (POST /api/financial-aid/grantors/{key}/retire and /unretire); the collection's rules stay null.
 *
 * Additive and idempotent: a grant already present is skipped. Down revokes the grant from the
 * same two roles and removes the field.
 */

const GRANTORS = "financial_aid.grantors"
const GRANTED_TO = ["development", "finance"]

/**
 * A role's `permissions` as a plain string array. `record.get()` on a json field is a Go byte
 * slice that goja presents as an Array of BYTES; getString() returns the stored JSON text.
 * Non-strings are dropped so a corrupted entry cannot mint a garbage permission on every holder.
 */
function readRolePermissions(role) {
  const text = role.getString("permissions")
  if (!text) {
    return []
  }
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : []
  } catch (_parseErr) {
    // Only JSON.parse can throw here: unreadable text reads as no permissions, as 1500000185 does.
    return []
  }
}

/** PocketBase's not-found error, told apart from every real failure. */
function isNotFoundError(err) {
  return String(err).indexOf("no rows in result set") !== -1
}

function findRoleBySlug(app, slug) {
  try {
    return app.findFirstRecordByFilter("roles", "slug = {:slug}", { slug: slug })
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err
    }
    return null
  }
}

/** Rebuild one user's cached_permissions as the union over ALL their roles. */
function recomputeUser(app, userId) {
  const memberships = app.findRecordsByFilter("user_roles", "user = {:userId}", "", 0, 0, {
    userId: userId,
  })
  const seen = {}
  for (const m of memberships) {
    let held
    try {
      held = app.findRecordById("roles", m.getString("role"))
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err
      }
      continue
    }
    for (const p of readRolePermissions(held)) {
      seen[p] = true
    }
  }
  let user
  try {
    user = app.findRecordById("_pb_users_auth_", userId)
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err
    }
    // An orphaned user_roles row outliving its user (seen on prod, 1500000154).
    return
  }
  user.set("cached_permissions", Object.keys(seen).sort())
  app.save(user)
}

function holdersOf(app, roleId) {
  const memberships = app.findRecordsByFilter("user_roles", "role = {:roleId}", "", 0, 0, {
    roleId: roleId,
  })
  const ids = {}
  for (const m of memberships) {
    const userId = m.getString("user")
    if (userId) {
      ids[userId] = true
    }
  }
  return Object.keys(ids)
}

/** Set a role's permissions; recompute its holders only when something changed. */
function applyPermissions(app, role, next) {
  const current = readRolePermissions(role)
  const sorted = next.slice().sort()
  if (JSON.stringify(current.slice().sort()) === JSON.stringify(sorted)) {
    return
  }
  role.set("permissions", sorted)
  app.save(role)
  for (const userId of holdersOf(app, role.id)) {
    recomputeUser(app, userId)
  }
}

function grantPermissions(app, slug, permissions) {
  const role = findRoleBySlug(app, slug)
  if (!role) {
    return
  }
  const perms = readRolePermissions(role)
  for (const p of permissions) {
    if (perms.indexOf(p) === -1) {
      perms.push(p)
    }
  }
  applyPermissions(app, role, perms)
}

function revokePermissions(app, slug, permissions) {
  const role = findRoleBySlug(app, slug)
  if (!role) {
    return
  }
  applyPermissions(app, role, readRolePermissions(role).filter((p) => permissions.indexOf(p) === -1))
}

migrate((app) => {
  for (const slug of GRANTED_TO) {
    grantPermissions(app, slug, [GRANTORS])
  }
  const grantors = app.findCollectionByNameOrId("aid_grantors")
  grantors.fields.add(new Field({ type: "date", name: "retired_at", required: false, presentable: false, min: "", max: "" }))
  app.save(grantors)
}, (app) => {
  const grantors = app.findCollectionByNameOrId("aid_grantors")
  grantors.fields.removeByName("retired_at")
  app.save(grantors)
  for (const slug of GRANTED_TO) {
    revokePermissions(app, slug, [GRANTORS])
  }
});
