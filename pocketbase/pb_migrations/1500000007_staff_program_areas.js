/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create staff_program_areas collection
 * Dependencies: None
 *
 * Stores staff program area definitions from CampMinder /staff/programareas endpoint.
 * Global lookup table (not year-specific).
 */

const COLLECTION_ID_STAFF_PROGRAM_AREAS = "col_staff_prog_areas";

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true';

  const collection = new Collection({
    id: COLLECTION_ID_STAFF_PROGRAM_AREAS,
    type: "base",
    name: "staff_program_areas",
    listRule: adminOnly,
    viewRule: adminOnly,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: adminOnly,
    fields: [
      {
        type: "number",
        name: "cm_id",
        required: true,
        presentable: false,
        min: 1,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "name",
        required: true,
        presentable: true
      },
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_staff_program_areas_cm_id` ON `staff_program_areas` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("staff_program_areas");
  app.delete(collection);
});
