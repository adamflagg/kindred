/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create saved_scenarios collection
 * Dependencies: camp_sessions (1500000001)
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  let collection = new Collection({
    type: "base",
    name: "saved_scenarios",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "text",
        name: "name",
        required: true,
        presentable: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "description",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
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
        type: "bool",
        name: "is_active",
        required: false,
        presentable: false
      },
      {
        type: "number",
        name: "year",
        required: true,
        min: 2020,
        max: 2030,
        onlyInt: true
      },
      {
        type: "json",
        name: "metadata",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
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
      "CREATE INDEX `idx_saved_scenarios_session` ON `saved_scenarios` (`session`)",
      "CREATE INDEX `idx_saved_scenarios_year` ON `saved_scenarios` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  let collection = app.findCollectionByNameOrId("saved_scenarios");
  app.delete(collection);
});
