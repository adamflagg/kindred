/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Seed default RBAC roles
 * Dependencies: roles (1500000070)
 *
 * Creates system roles with default permission sets.
 * These cannot be deleted by non-admin users (is_system=true).
 */

migrate((app) => {
  const rolesCol = app.findCollectionByNameOrId("roles")

  const defaultRoles = [
    {
      name: "Bunking Manager",
      slug: "bunking-manager",
      description: "Full bunking access: board, requests, scenarios, solver, CSV upload",
      permissions: ["bunking.view", "bunking.manage"],
      is_system: true
    },
    {
      name: "Bunking Viewer",
      slug: "bunking-viewer",
      description: "View-only bunking: board layout, session camper lists, social graphs",
      permissions: ["bunking.view"],
      is_system: true
    },
    {
      name: "Registrar",
      slug: "registrar",
      description: "Registration metrics and geographic data management",
      permissions: ["metrics.view", "metrics.geo"],
      is_system: true
    },
    {
      name: "Metrics Viewer",
      slug: "metrics-viewer",
      description: "View general metrics dashboards (non-financial)",
      permissions: ["metrics.view"],
      is_system: true
    },
    {
      name: "Finance",
      slug: "finance",
      description: "General metrics plus financial projections and transaction data",
      permissions: ["metrics.view", "metrics.financial"],
      is_system: true
    },
    {
      name: "Data Admin",
      slug: "data-admin",
      description: "Run CampMinder syncs and configure solver parameters",
      permissions: ["sync.run", "solver.configure"],
      is_system: true
    }
  ]

  for (const role of defaultRoles) {
    const record = new Record(rolesCol)
    record.set("name", role.name)
    record.set("slug", role.slug)
    record.set("description", role.description)
    record.set("permissions", role.permissions)
    record.set("is_system", role.is_system)
    app.save(record)
  }
}, (app) => {
  const rolesCol = app.findCollectionByNameOrId("roles")
  const roles = app.findRecordsByFilter(rolesCol.id, "is_system = true", "", 100, 0)
  for (const role of roles) {
    app.delete(role)
  }
});
