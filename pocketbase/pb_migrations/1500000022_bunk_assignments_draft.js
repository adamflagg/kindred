/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunk_assignments_draft collection
 * Dependencies: saved_scenarios (1500000021), persons (1500000012), camp_sessions (1500000011),
 *               bunks (1500000013), bunk_plans (1500000014)
 *
 * Stores draft cabin assignments for scenario planning. Each assignment links
 * a person to a bunk within a scenario, allowing what-if planning before
 * committing assignments to production.
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios")
  const personsCol = app.findCollectionByNameOrId("persons")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")
  const bunksCol = app.findCollectionByNameOrId("bunks")
  const bunkPlansCol = app.findCollectionByNameOrId("bunk_plans")

  const collection = new Collection({
    id: "col_bunk_drafts",
    type: "base",
    name: "bunk_assignments_draft",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "relation",
        name: "scenario",
        required: false,
        presentable: false,
        collectionId: scenariosCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        options: {
          min: 2010,
          max: 2100,
          noDecimal: true
        }
      },
      {
        type: "relation",
        name: "person",
        required: false,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "session",
        required: false,
        presentable: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "bunk",
        required: false,
        presentable: false,
        collectionId: bunksCol.id,
        cascadeDelete: false,
        minSelect: null,
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
        type: "bool",
        name: "assignment_locked",
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
      "CREATE UNIQUE INDEX `idx_bunk_assignments_draft_scenario_person_session_year` ON `bunk_assignments_draft` (`year`, `session`, `person`, `scenario`)",
      "CREATE INDEX `idx_bunk_assignments_draft_scenario` ON `bunk_assignments_draft` (`scenario`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_assignments_draft");
  app.delete(collection);
});
