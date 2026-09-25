/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: financial aid (campership) permissions -- campership spec §14.2.
 * Dependencies: roles (1500000070), user_roles (1500000071)
 *
 * Grants, keyed by slug, never by id or name:
 *   finance      + financial_aid.view, .casework, .rules, .summary
 *   registrar    + financial_aid.view, .casework
 *   development    NEW system role: financial_aid.summary only. Never
 *                  sheets.export or bunking.manage (both can trigger the
 *                  Drive export) and never users.manage (which can assign
 *                  any role) -- analysis §9.3.
 *
 * The executive role is deliberately NOT touched (spec §2 item 12): it was
 * created in the UI, execs assign roles in the GUI, and the owner edits that
 * role in prod after launch.
 *
 * Production roles have drifted from the seed (analysis §5.5), so every
 * lookup tolerates a missing role: a deleted finance or registrar role is
 * skipped, not recreated. A role already named "Development" under another
 * slug keeps its name; the new role takes FALLBACK_DEVELOPMENT_NAME instead of
 * failing the boot on the unique name index.
 *
 * cached_permissions is recomputed here for every holder, over ALL of their
 * roles (it is a flattened set). The Go roles hook usually fires on these
 * saves too, but a migration must not depend on a hook -- same reasoning as
 * 1500000130 / 1500000154.
 *
 * Idempotent: a grant already present is skipped, the development role is
 * created only when its slug is absent, and descriptions are rewritten only
 * while they still read as seeded.
 *
 * Down only undoes what up did: if a role already occupied the "development"
 * slug before this migration ran, down must not delete it (user_roles.role
 * cascades, so that would also delete its memberships) -- it only revokes
 * DEVELOPMENT_PERMISSIONS, exactly as revokePermissions does for GRANTS. See
 * wasCreatedByThisMigration.
 */

const VIEW = "financial_aid.view"
const CASEWORK = "financial_aid.casework"
const RULES = "financial_aid.rules"
const SUMMARY = "financial_aid.summary"

const GRANTS = [
  { slug: "finance", permissions: [VIEW, CASEWORK, RULES, SUMMARY] },
  { slug: "registrar", permissions: [VIEW, CASEWORK] },
]

const DEVELOPMENT_SLUG = "development"
const DEVELOPMENT_NAME = "Development"
const FALLBACK_DEVELOPMENT_NAME = "Development (financial aid summary)"
const DEVELOPMENT_DESCRIPTION =
  "Financial aid totals for funder and grant reporting. Aggregates only; no family-level data."
const DEVELOPMENT_PERMISSIONS = [SUMMARY]

const DESCRIPTIONS = [
  {
    slug: "finance",
    seeded: "General metrics plus financial projections and transaction data",
    next: "General metrics, financial projections and transaction data, plus financial aid: casework, rules, budget and totals",
  },
  {
    slug: "registrar",
    seeded: "Registration metrics and geographic data management",
    next: "Registration metrics and geographic data management, plus financial aid casework",
  },
]

/**
 * A role's `permissions` as a plain string array. `record.get()` on a json
 * field is a Go byte slice that goja presents as an Array of BYTES; getString()
 * returns the stored JSON text. Non-strings are dropped so a corrupted entry
 * cannot mint a garbage permission on every holder.
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
    // Only JSON.parse can throw here: unreadable text reads as no permissions,
    // exactly as 1500000154 does. Named _parseErr, not _err, so the pinning
    // test's ban on a blanket catch of _err stays meaningful.
    return []
  }
}

/** PocketBase's not-found error, told apart from every real failure. */
function isNotFoundError(err) {
  return String(err).indexOf("no rows in result set") !== -1
}

function findRoleBy(app, field, value) {
  try {
    return app.findFirstRecordByFilter("roles", field + " = {:value}", { value: value })
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
  const role = findRoleBy(app, "slug", slug)
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
  const role = findRoleBy(app, "slug", slug)
  if (!role) {
    return
  }
  applyPermissions(app, role, readRolePermissions(role).filter((p) => permissions.indexOf(p) === -1))
}

function ensureDevelopmentRole(app) {
  if (findRoleBy(app, "slug", DEVELOPMENT_SLUG)) {
    grantPermissions(app, DEVELOPMENT_SLUG, DEVELOPMENT_PERMISSIONS)
    return
  }
  const name = findRoleBy(app, "name", DEVELOPMENT_NAME) ? FALLBACK_DEVELOPMENT_NAME : DEVELOPMENT_NAME
  const record = new Record(app.findCollectionByNameOrId("roles"))
  record.set("name", name)
  record.set("slug", DEVELOPMENT_SLUG)
  record.set("description", DEVELOPMENT_DESCRIPTION)
  record.set("permissions", DEVELOPMENT_PERMISSIONS.slice())
  record.set("is_system", true)
  app.save(record)
}

/**
 * True only for the record ensureDevelopmentRole created: it always sets
 * description to DEVELOPMENT_DESCRIPTION and is_system to true, and no other
 * code path in this file (DESCRIPTIONS/retitle covers only finance and
 * registrar) ever rewrites the development role's description. A role that
 * already occupied the slug keeps its own description and, per the roles
 * seed (1500000070), is not a system role -- so it fails this check and down
 * only revokes the grant instead of deleting it.
 */
function wasCreatedByThisMigration(role) {
  return role.getString("description") === DEVELOPMENT_DESCRIPTION && role.getBool("is_system")
}

function removeDevelopmentRole(app) {
  const role = findRoleBy(app, "slug", DEVELOPMENT_SLUG)
  if (!role) {
    return
  }
  if (!wasCreatedByThisMigration(role)) {
    // A role at this slug predates this migration -- undo only the grant,
    // the same way revokePermissions does for GRANTS.
    revokePermissions(app, DEVELOPMENT_SLUG, DEVELOPMENT_PERMISSIONS)
    return
  }
  const holders = holdersOf(app, role.id)
  app.delete(role) // user_roles.role cascades, so memberships go with it
  for (const userId of holders) {
    recomputeUser(app, userId)
  }
}

function retitle(app, slug, from, to) {
  const role = findRoleBy(app, "slug", slug)
  if (!role || role.getString("description") !== from) {
    return
  }
  role.set("description", to)
  app.save(role)
}

migrate((app) => {
  for (const grant of GRANTS) {
    grantPermissions(app, grant.slug, grant.permissions)
  }
  ensureDevelopmentRole(app)
  for (const d of DESCRIPTIONS) {
    retitle(app, d.slug, d.seeded, d.next)
  }
}, (app) => {
  for (const grant of GRANTS) {
    revokePermissions(app, grant.slug, grant.permissions)
  }
  removeDevelopmentRole(app)
  for (const d of DESCRIPTIONS) {
    retitle(app, d.slug, d.next, d.seeded)
  }
});
