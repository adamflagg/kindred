/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: permission_descriptions — admin overrides of a permission's
 * description (spec 2026-10-01-users-page-uplift-design §3.2).
 *
 * The code registry (bunking/rbac/permissions.py) holds the default; a row here
 * replaces it on the Users page. `base_description` is the default the admin
 * replaced, so the page can flag "Default changed". Written straight from the
 * browser by admins so the audit hooks log it (TypeRoles). Not CampMinder data:
 * no year, no CampMinder ID.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "permission_descriptions",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: "@request.auth.is_admin = true",
    updateRule: "@request.auth.is_admin = true",
    deleteRule: "@request.auth.is_admin = true",
    fields: [
      { type: "text", name: "codename", required: true, presentable: true, max: 100 },
      { type: "text", name: "description", required: true, max: 2000 },
      { type: "text", name: "base_description", required: true, max: 2000 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_permission_descriptions_codename` ON `permission_descriptions` (`codename`)",
    ],
  })
  app.save(collection)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("permission_descriptions"))
})
