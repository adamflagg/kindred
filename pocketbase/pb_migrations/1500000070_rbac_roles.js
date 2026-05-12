/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create roles collection for RBAC
 * Dependencies: None
 *
 * Stores role definitions with JSON permission arrays.
 * System roles (is_system=true) cannot be deleted by non-admins.
 *
 * Seeds the final-state system roles inline (bunking-staff, registrar, finance).
 */

migrate((app) => {
  const collection = new Collection({
    id: "col_rbac_roles",
    type: "base",
    name: "roles",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        type: "text",
        name: "name",
        required: true,
        presentable: true,
        min: 1,
        max: 100
      },
      {
        type: "text",
        name: "slug",
        required: true,
        presentable: false,
        min: 1,
        max: 100
      },
      {
        type: "text",
        name: "description",
        required: false,
        presentable: false,
        min: 0,
        max: 500
      },
      {
        type: "json",
        name: "permissions",
        required: true,
        presentable: false,
        maxSize: 5000
      },
      {
        type: "bool",
        name: "is_system",
        required: false,
        presentable: false
      },
      {
        type: "autodate",
        name: "created",
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_roles_name` ON `roles` (`name`)",
      "CREATE UNIQUE INDEX `idx_roles_slug` ON `roles` (`slug`)"
    ]
  });

  app.save(collection);

  const systemRoles = [
    {
      name: "Bunking Staff",
      slug: "bunking-staff",
      description: "Full bunking access: board, requests, scenarios, solver, CSV upload, CampMinder sync",
      permissions: ["bunking.manage", "sheets.export"],
      is_system: true
    },
    {
      name: "Registrar",
      slug: "registrar",
      description: "Registration metrics and geographic data management",
      permissions: ["metrics.geo", "registration.manage"],
      is_system: true
    },
    {
      name: "Finance",
      slug: "finance",
      description: "General metrics plus financial projections and transaction data",
      permissions: ["metrics.financial", "sheets.export"],
      is_system: true
    }
  ];

  for (const role of systemRoles) {
    const record = new Record(collection);
    record.set("name", role.name);
    record.set("slug", role.slug);
    record.set("description", role.description);
    record.set("permissions", role.permissions);
    record.set("is_system", role.is_system);
    app.save(record);
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("roles");
  app.delete(collection);
});
