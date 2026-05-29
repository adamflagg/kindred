/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunks collection
 * Dependencies: None
 *
 * Stores bunk/cabin definitions from CampMinder.
 */

const COLLECTION_ID_BUNKS = "col_bunks";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_BUNKS,
    type: "base",
    name: "bunks",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        type: "number",
        name: "cm_id",
        required: true,
        presentable: false,
        min: null,
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
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "gender",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_active",
        required: false,
        presentable: false
      },
      {
        type: "number",
        name: "sort_order",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "number",
        name: "area_id",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
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
      "CREATE UNIQUE INDEX `idx_bunks_campminder_year` ON `bunks` (`cm_id`, `year`)",
      "CREATE INDEX `idx_bunks_name` ON `bunks` (`name`)",
      "CREATE INDEX `idx_bunks_cm_id` ON `bunks` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunks");
  app.delete(collection);
});
