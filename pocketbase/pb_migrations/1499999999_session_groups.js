/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create session_groups collection
 * Dependencies: None
 *
 * Stores session groupings from CampMinder (e.g., "Main Sessions", "Family Camps")
 */

// Fixed collection ID for session_groups
const COLLECTION_ID_SESSION_GROUPS = "col_session_groups";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_SESSION_GROUPS,
    type: "base",
    name: "session_groups",
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
        system: false,
        options: {
          min: 0,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "text",
        name: "name",
        required: true,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "description",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        type: "bool",
        name: "is_active",
        required: false,
        presentable: false,
        system: false
      },
      {
        type: "number",
        name: "sort_order",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 2010,
          max: 2100,
          noDecimal: true
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
      "CREATE UNIQUE INDEX `idx_session_groups_cm_id_year` ON `session_groups` (`cm_id`, `year`)",
      "CREATE INDEX `idx_session_groups_year` ON `session_groups` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("session_groups");
  app.delete(collection);
});
