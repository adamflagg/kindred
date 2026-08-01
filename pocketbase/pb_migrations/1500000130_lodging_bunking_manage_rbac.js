/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: weekend lodging follows the summer bunking board's access model.
 * Dependencies: lodging collections (1500000116-1500000122), RBAC roles (1500000070)
 *
 * WHY. The lodging collections were created admin-only on every write
 * (`@request.auth.is_admin = true`), which meant the people who actually do
 * this job could not do it: bunking staff hold `bunking.manage`, not admin.
 * The summer board settled this shape long ago — reads open to any
 * authenticated user, writes gated on admin OR bunking.manage — and the
 * weekend surfaces are the same job in a different program. This brings them
 * into line.
 *
 * READS STAY OPEN. list/view remain `@request.auth.id != ""`. They are
 * restated here rather than left alone so the intent is legible in one place:
 * the roster is deliberately readable by everyone who can log in, and a later
 * edit that loosens writes must not silently take reads with it.
 *
 * WHAT IS NOT WIDENED. Three collections keep admin-only writes:
 * `lodging_field_mappings`, because it maps CampMinder custom fields onto
 * derived columns — ingest plumbing written by the Go sync as superuser, with
 * no staff-facing surface, and repointing it would change what every lodging
 * read means; and `lodging_assignments` / `lodging_assignment_history`, for the
 * draft-versus-final reason spelled out at LODGING_STAFF_WRITABLE below.
 *
 * PHI. `lodging.phi` gates the medical narrative behind the roster's
 * accessibility flags. It was granted to NO role (#1887), so the reveal was
 * reachable only by admin bypass. It joins the Bunking Staff role here: the
 * staff placing families are the staff who need to know a family needs a
 * ground-floor room with power for a CPAP. It stays a SEPARATE permission
 * rather than folding into bunking.manage, so it can be revoked from bunking
 * staff — or granted to someone who places nobody — without touching write
 * access, and so the endpoint's access log keeps meaning what it says.
 *
 * #1887 offered a second route: leave the grant out and let an admin add it
 * through the roles editor, which already enumerates ALL_PERMISSIONS and so has
 * been able to do this since #1884. Granting here anyway, deliberately — a
 * default nobody has to discover beats a self-serve knob nobody knows to turn,
 * and this repo prefers a code change over a config one. The knob still works
 * for anyone who wants PHI without write access.
 *
 * Idempotent: rules are set to a fixed target, and the permission grant checks
 * for the value first.
 */

const LODGING_AUTHED_READ = '@request.auth.id != ""'
const LODGING_BUNKING_MANAGE =
  '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'
const LODGING_ADMIN_ONLY = "@request.auth.is_admin = true"

// The PLAN side of the split, and only that: the registry the editor writes
// (areas, units, aliases, the ingest work queue) plus the two planning tables
// the board will write (merges, availability).
//
// `lodging_assignments` and `lodging_assignment_history` are deliberately NOT
// here. Summer draws the same line and has never crossed it: `bunk_assignments`
// (the synced record of truth) and `attendee_status_history` (append-only audit)
// are admin-only through every RBAC revision in this repo, while the table staff
// actually write is the DRAFT — `bunk_assignments_draft`. Lodging has no draft
// table yet, and nothing writes assignments today; granting delete on an
// append-only audit trail ahead of any UI that needs it buys nothing and risks
// the one record that cannot be reconstructed. Widen them in the PR that adds
// the writer.
const LODGING_STAFF_WRITABLE = [
  "lodging_areas",
  "lodging_units",
  "lodging_unit_aliases",
  "lodging_merges",
  "lodging_availability",
  "lodging_ingest_issues",
]

/** Point every staff-writable lodging collection at one write rule. */
function setLodgingWriteRules(app, writeRule) {
  for (const name of LODGING_STAFF_WRITABLE) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = LODGING_AUTHED_READ
    col.viewRule = LODGING_AUTHED_READ
    col.createRule = writeRule
    col.updateRule = writeRule
    col.deleteRule = writeRule
    app.save(col)
  }
}

/**
 * Read a role's `permissions` json field as a plain array of strings.
 *
 * `record.get()` on a json field hands back the underlying types.JSONRaw —
 * a Go byte slice. goja presents that as an Array, so `Array.isArray()`
 * answers TRUE and iterating it yields BYTE VALUES, not permissions: writing
 * that straight back turns ["bunking.manage"] into [34,98,117,...]. Verified
 * against the running VM, not assumed. `getString()` is the honest accessor —
 * it returns the stored JSON text.
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
 * bootstrap. Without this, an existing bunking-staff user keeps a stale cache
 * and the grant stays invisible until someone re-saves the role by hand — the
 * permission is read from the cached array, never from the role.
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

// The role description is what the Roles admin screen shows when someone
// decides who to give this to, so it has to name the weekend work now. Only
// rewritten if it still matches the seeded string — a description an admin has
// since edited is theirs, not ours.
const BUNKING_STAFF_DESCRIPTION_SEEDED =
  "Full bunking access: board, requests, scenarios, solver, CSV upload, CampMinder sync"
const BUNKING_STAFF_DESCRIPTION_WITH_LODGING =
  "Full bunking access: board, requests, scenarios, solver, CSV upload, CampMinder sync, " +
  "plus the family camp lodging registry and its medical detail"

function retitleRole(app, slug, from, to) {
  const role = findRoleBySlug(app, slug)
  if (!role || role.getString("description") !== from) {
    return
  }
  role.set("description", to)
  app.save(role)
}

migrate((app) => {
  setLodgingWriteRules(app, LODGING_BUNKING_MANAGE)
  grantPermissionToRole(app, "bunking-staff", "lodging.phi")
  retitleRole(
    app,
    "bunking-staff",
    BUNKING_STAFF_DESCRIPTION_SEEDED,
    BUNKING_STAFF_DESCRIPTION_WITH_LODGING
  )
}, (app) => {
  setLodgingWriteRules(app, LODGING_ADMIN_ONLY)
  revokePermissionFromRole(app, "bunking-staff", "lodging.phi")
  retitleRole(
    app,
    "bunking-staff",
    BUNKING_STAFF_DESCRIPTION_WITH_LODGING,
    BUNKING_STAFF_DESCRIPTION_SEEDED
  )
});
