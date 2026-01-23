/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunk_plans collection
 * Dependencies: bunks, camp_sessions
 *
 * Stores bunk plan configurations for each session and year.
 * Links bunks to sessions with capacity and activation settings.
 *
 * Uses fixed collection ID for dependent migrations.
 */

const COLLECTION_ID_BUNK_PLANS = "col_bunk_plans";

migrate((app) => {
  // Dynamic lookups for relations
  const bunksCol = app.findCollectionByNameOrId("bunks")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  const collection = new Collection({
    id: COLLECTION_ID_BUNK_PLANS,
    name: "bunk_plans",
    type: "base",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        name: "cm_id",
        type: "number",
        required: true,
        presentable: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "bunk",
        type: "relation",
        required: true,
        presentable: true,
        collectionId: bunksCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        name: "session",
        type: "relation",
        required: true,
        presentable: true,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        name: "name",
        type: "text",
        required: true,
        presentable: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "code",
        type: "text",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "year",
        type: "number",
        required: true,
        presentable: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "is_active",
        type: "bool",
        required: false,
        presentable: false
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
      "CREATE UNIQUE INDEX `idx_bunk_plans_bunk_session_year` ON `bunk_plans` (`year`, `bunk`, `session`, `cm_id`)",
      "CREATE INDEX `idx_uPmp70BdW2` ON `bunk_plans` (`name`)",
      "CREATE INDEX `idx_K3h8VH7VB1` ON `bunk_plans` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_plans");
  app.delete(collection);
});
