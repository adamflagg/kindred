/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunk_assignments collection
 * Dependencies: persons, camp_sessions, bunks, bunk_plans
 *
 * Stores camper-to-bunk assignments for each session and year.
 * Links persons to bunks via bunk plans.
 *
 * Uses fixed collection ID for dependent migrations.
 */

const COLLECTION_ID_BUNK_ASSIGNMENTS = "col_bunk_assignments";

migrate((app) => {
  // Dynamic lookups for relations
  const personsCol = app.findCollectionByNameOrId("persons")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")
  const bunksCol = app.findCollectionByNameOrId("bunks")
  const bunkPlansCol = app.findCollectionByNameOrId("bunk_plans")

  const collection = new Collection({
    id: COLLECTION_ID_BUNK_ASSIGNMENTS,
    name: "bunk_assignments",
    type: "base",
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
        min: 0,
        max: null,
        onlyInt: true
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
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      {
        type: "bool",
        name: "is_deleted",
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
      "CREATE UNIQUE INDEX `idx_bunk_assignments_person_session_year` ON `bunk_assignments` (`year`, `person`, `session`)",
      "CREATE INDEX `idx_bunk_assignments_person_id` ON `bunk_assignments` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_assignments");
  app.delete(collection);
});
