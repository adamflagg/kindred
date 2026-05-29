/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create session_groups collection
 * Dependencies: None
 *
 * Stores session groupings from CampMinder (e.g., "Main Sessions", "Family Camps").
 */

const COLLECTION_ID_SESSION_GROUPS = "col_session_groups";

const adminOnly = '@request.auth.is_admin = true';

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_SESSION_GROUPS,
    type: "base",
    name: "session_groups",
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
        min: 0,
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
        type: "text",
        name: "description",
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
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
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
      "CREATE UNIQUE INDEX `idx_session_groups_cm_id_year` ON `session_groups` (`cm_id`, `year`)",
      "CREATE INDEX `idx_session_groups_year` ON `session_groups` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("session_groups");
  app.delete(collection);
});
