/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create locked_groups collection
 * Dependencies: saved_scenarios (1500000021), camp_sessions (1500000011)
 *
 * Lock groups allow staff to "lock" a set of campers together so the solver
 * keeps them in the same bunk. Groups are per-scenario (draft) and include
 * metadata like color for visual identification.
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  const collection = new Collection({
    id: "col_locked_groups",
    type: "base",
    name: "locked_groups",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "relation",
        name: "scenario",
        required: true,
        presentable: false,
        collectionId: scenariosCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "text",
        name: "name",
        required: false,
        presentable: true,
        options: {
          autogeneratePattern: "",
          min: 0,
          max: 0,
          pattern: "",
          primaryKey: false
        }
      },
      {
        type: "relation",
        name: "session",
        required: true,
        presentable: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2013,
        max: 2100,
        onlyInt: true
      },
      {
        type: "text",
        name: "color",
        required: true,
        presentable: false,
        options: {
          min: 1,
          max: 20,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "created_by",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: 255,
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
      "CREATE INDEX `idx_locked_groups_scenario` ON `locked_groups` (`scenario`)",
      "CREATE INDEX `idx_locked_groups_session` ON `locked_groups` (`session`)",
      "CREATE INDEX `idx_locked_groups_scenario_session_year` ON `locked_groups` (`scenario`, `session`, `year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("locked_groups");
  app.delete(collection);
});
