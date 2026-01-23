/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create staff_positions collection
 * Dependencies: staff_program_areas
 *
 * Stores staff position definitions from CampMinder /staff/positions endpoint.
 * Global lookup table (not year-specific). Each position can be linked to a program area.
 */

const COLLECTION_ID_STAFF_POSITIONS = "col_staff_positions";

migrate((app) => {
  const programAreasCol = app.findCollectionByNameOrId("staff_program_areas");

  const collection = new Collection({
    id: COLLECTION_ID_STAFF_POSITIONS,
    type: "base",
    name: "staff_positions",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
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
        presentable: true,
        options: {
          min: 1,
          max: 500,
          pattern: ""
        }
      },
      {
        type: "relation",
        name: "program_area",
        required: false,
        presentable: false,
        collectionId: programAreasCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
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
      "CREATE UNIQUE INDEX `idx_staff_positions_cm_id` ON `staff_positions` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("staff_positions");
  app.delete(collection);
});
