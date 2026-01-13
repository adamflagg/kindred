/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunk_assignments collection
 * Dependencies: persons (1500000005), camp_sessions (1500000001), bunks (1500000006), bunk_plans (1500000008)
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const personsCol = app.findCollectionByNameOrId("persons")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")
  const bunksCol = app.findCollectionByNameOrId("bunks")
  const bunkPlansCol = app.findCollectionByNameOrId("bunk_plans")

  let collection = new Collection({
    type: "base",
    name: "bunk_assignments",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "number",
        name: "cm_id",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: 0,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "relation",
        name: "person",
        required: true,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: 1,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "session",
        required: true,
        presentable: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: 1,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "bunk",
        required: true,
        presentable: false,
        collectionId: bunksCol.id,
        cascadeDelete: false,
        minSelect: 1,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "bunk_plan",
        required: false,
        presentable: false,
        collectionId: bunkPlansCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
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
      "CREATE UNIQUE INDEX `idx_bunk_assignments_person_session_year` ON `bunk_assignments` (`year`, `person`, `session`)",
      "CREATE INDEX `idx_bunk_assignments_person_id` ON `bunk_assignments` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  let collection = app.findCollectionByNameOrId("bunk_assignments");
  app.delete(collection);
});
