/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Simplify RBAC roles — remove view-only roles, trim permission sets
 * Dependencies: RBAC seed roles (1500000073)
 *
 * Removes Bunking Viewer and Metrics Viewer (their only permission was removed).
 * Trims bunking.view from Bunking Manager, metrics.view from Registrar/Finance,
 * solver.configure from Data Admin.
 */

migrate((app) => {
  const rolesCol = app.findCollectionByNameOrId("roles")
  const userRolesCol = app.findCollectionByNameOrId("user_roles")

  // Delete view-only roles and their user_roles in a single pass
  const viewerSlugs = ["bunking-viewer", "metrics-viewer"]
  for (const slug of viewerSlugs) {
    try {
      const records = app.findRecordsByFilter(rolesCol.id, `slug = "${slug}"`, "", 1, 0)
      if (records.length > 0) {
        // Clean up user_roles before deleting the role
        const orphaned = app.findRecordsByFilter(userRolesCol.id, `role = "${records[0].id}"`, "", 1000, 0)
        for (const ur of orphaned) {
          app.delete(ur)
        }
        app.delete(records[0])
      }
    } catch (e) {
      // Role may not exist if seed migration was already modified
    }
  }

  // Trim permissions on remaining roles
  const updates = {
    "bunking-manager": ["bunking.manage"],
    "registrar": ["metrics.geo"],
    "finance": ["metrics.financial"],
    "data-admin": ["sync.run"],
  }

  for (const [slug, permissions] of Object.entries(updates)) {
    try {
      const records = app.findRecordsByFilter(rolesCol.id, `slug = "${slug}"`, "", 1, 0)
      if (records.length > 0) {
        records[0].set("permissions", permissions)
        app.save(records[0])
      }
    } catch (e) {
      // Role may not exist
    }
  }

}, (app) => {
  // Revert: re-create deleted roles and restore permission sets
  const rolesCol = app.findCollectionByNameOrId("roles")

  // Re-create Bunking Viewer
  const bv = new Record(rolesCol)
  bv.set("name", "Bunking Viewer")
  bv.set("slug", "bunking-viewer")
  bv.set("description", "View-only bunking: board layout, session camper lists, social graphs")
  bv.set("permissions", ["bunking.view"])
  bv.set("is_system", true)
  app.save(bv)

  // Re-create Metrics Viewer
  const mv = new Record(rolesCol)
  mv.set("name", "Metrics Viewer")
  mv.set("slug", "metrics-viewer")
  mv.set("description", "View general metrics dashboards (non-financial)")
  mv.set("permissions", ["metrics.view"])
  mv.set("is_system", true)
  app.save(mv)

  // Restore original permission sets
  const restores = {
    "bunking-manager": ["bunking.view", "bunking.manage"],
    "registrar": ["metrics.view", "metrics.geo"],
    "finance": ["metrics.view", "metrics.financial"],
    "data-admin": ["sync.run", "solver.configure"],
  }

  for (const [slug, permissions] of Object.entries(restores)) {
    try {
      const records = app.findRecordsByFilter(rolesCol.id, `slug = "${slug}"`, "", 1, 0)
      if (records.length > 0) {
        records[0].set("permissions", permissions)
        app.save(records[0])
      }
    } catch (e) {
      // noop
    }
  }
});
