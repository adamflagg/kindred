/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: financial_aid.funding_sources (campership D100; Reports back end, Part C).
 * Dependencies: roles (1500000070), user_roles (1500000071), 1500000185 (the development role), 1500000227
 * (the grantors permission, whose helpers this follows).
 *
 * Development (and finance) edit each outside funding source's reporting group and incentive flag in the Funding
 * sources list reached from Reports > Development; the registrar may not. Grants, keyed by slug, never by id:
 *   finance      + financial_aid.funding_sources
 *   development  + financial_aid.funding_sources
 *
 * A missing role is skipped, never recreated (production roles have drifted from the seed). cached_permissions is
 * recomputed here for every holder, over ALL of their roles; a migration must not depend on the roles hook.
 * Idempotent: a grant already present is skipped. Down revokes exactly what up granted.
 */

const FUNDING_SOURCES = "financial_aid.funding_sources"

const GRANTS = [
  { slug: "finance", permissions: [FUNDING_SOURCES] },
  { slug: "development", permissions: [FUNDING_SOURCES] },
]

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
  for (const grant of GRANTS) {
    grantPermissions(app, grant.slug, grant.permissions)
  }
}, (app) => {
  for (const grant of GRANTS) {
    revokePermissions(app, grant.slug, grant.permissions)
  }
});
