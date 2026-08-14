/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the `lodging.phi` permission from the Bunking Staff role.
 * Dependencies: 1500000130 (granted lodging.phi to bunking-staff)
 *
 * kindred#2312, owner ruling 2026-08-13 (campaign decision D12): RBAC in this
 * product is screen-reduction, not a data boundary. Every user of this tool
 * can already see the medical narrative in CampMinder directly. `lodging.phi`
 * gated exactly ONE endpoint (GET /api/lodging/households/{id}/medical), and
 * every sibling endpoint on that router already gates on `bunking.manage`.
 * The application code no longer declares `Permission.LODGING_PHI` at all —
 * `ALL_PERMISSIONS` is derived from the `Permission` class's own attributes,
 * so removing the constant already dropped it there. This migration is the
 * data-side half: the role's stored `permissions` array still names it until
 * something rewrites the row.
 *
 * Consequence, already accepted by the owner: the Executive role (which holds
 * `is_admin` and so bypassed the check anyway) gains nothing new, but any
 * OTHER role a future admin grants `bunking.manage` to gains medical-narrative
 * access as a side effect of that one permission, same as every other
 * bunking.manage-gated lodging write already implied.
 *
 * NOT touched: `bunking.manage` itself, and internal notes (the one thing
 * that stays a real boundary, already gated on bunking.manage and unaffected
 * by this change).
 *
 * Idempotent: revoke is a no-op if the role has already lost the permission.
 */

/**
 * Read a role's `permissions` json field as a plain array of strings.
 *
 * `record.get()` on a json field hands back the underlying types.JSONRaw —
 * a Go byte slice. goja presents that as an Array, so `Array.isArray()`
 * answers TRUE and iterating it yields BYTE VALUES, not permissions: writing
 * that straight back turns ["bunking.manage"] into [34,98,117,...].
 * `getString()` is the honest accessor — it returns the stored JSON text.
 */
function readRolePermissions(role) {
  const text = role.getString("permissions")
  if (!text) {
    return []
  }
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch (_err) {
    return []
  }
}

function findRoleBySlug(app, slug) {
  try {
    return app.findFirstRecordByFilter("roles", "slug = {:slug}", { slug: slug })
  } catch (_err) {
    // A deployment that never seeded the system roles is not a reason to fail
    // the rule change, which is the load-bearing half of this migration.
    return null
  }
}

/**
 * Recompute `users.cached_permissions` for everyone holding the given role.
 *
 * The Go hooks (pocketbase/rbac/hooks.go) do this on user_roles writes and on
 * roles updates, but a migration must not depend on a hook firing during
 * bootstrap. Without this, an existing bunking-staff user keeps a stale
 * cached_permissions array naming `lodging.phi` until someone re-saves the
 * role by hand. That stale entry is harmless on its own -- nothing in either
 * the Go or Python RBAC checks for the literal string "lodging.phi" any more,
 * since the permission it named no longer exists as a constant to compare
 * against -- but leaving it uncleaned is still the wrong default, so this
 * migration does the recompute rather than relying on that being merely safe.
 *
 * The union is taken over ALL of the user's roles, not just this one, because
 * cached_permissions is a flattened set: rebuilding it from a single role
 * would drop every permission their other roles carry.
 */
function recomputeCachedPermissions(app, roleId) {
  const memberships = app.findRecordsByFilter("user_roles", "role = {:roleId}", "", 0, 0, {
    roleId: roleId,
  })

  for (const membership of memberships) {
    const userId = membership.getString("user")
    if (!userId) {
      continue
    }

    const allMemberships = app.findRecordsByFilter("user_roles", "user = {:userId}", "", 0, 0, {
      userId: userId,
    })

    const seen = {}
    for (const m of allMemberships) {
      let held
      try {
        held = app.findRecordById("roles", m.getString("role"))
      } catch (_err) {
        continue
      }
      for (const p of readRolePermissions(held)) {
        seen[p] = true
      }
    }

    let user
    try {
      user = app.findRecordById("_pb_users_auth_", userId)
    } catch (_err) {
      continue
    }
    user.set("cached_permissions", Object.keys(seen).sort())
    app.save(user)
  }
}

/** Remove `permission` from the role with `slug`, then refresh holders' caches. */
function revokePermissionFromRole(app, slug, permission) {
  const role = findRoleBySlug(app, slug)
  if (!role) {
    return
  }

  const perms = readRolePermissions(role)
  const next = perms.filter((p) => p !== permission)
  if (next.length === perms.length) {
    return
  }

  role.set("permissions", next)
  app.save(role)

  recomputeCachedPermissions(app, role.id)
}

/** Add `permission` to the role with `slug`, then refresh holders' caches. */
function grantPermissionToRole(app, slug, permission) {
  const role = findRoleBySlug(app, slug)
  if (!role) {
    return
  }

  const perms = readRolePermissions(role)
  if (perms.indexOf(permission) !== -1) {
    return
  }

  perms.push(permission)
  perms.sort()
  role.set("permissions", perms)
  app.save(role)

  recomputeCachedPermissions(app, role.id)
}

migrate((app) => {
  revokePermissionFromRole(app, "bunking-staff", "lodging.phi")
}, (app) => {
  grantPermissionToRole(app, "bunking-staff", "lodging.phi")
});
