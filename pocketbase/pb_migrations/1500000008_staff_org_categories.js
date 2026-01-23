/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create staff_org_categories collection
 * Dependencies: None
 *
 * Stores staff organizational category definitions from CampMinder
 * /staff/organizationalcategories endpoint.
 * Global lookup table (not year-specific).
 */

const COLLECTION_ID_STAFF_ORG_CATEGORIES = "col_staff_org_cats";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_STAFF_ORG_CATEGORIES,
    type: "base",
    name: "staff_org_categories",
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
      "CREATE UNIQUE INDEX `idx_staff_org_categories_cm_id` ON `staff_org_categories` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("staff_org_categories");
  app.delete(collection);
});
