/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunks collection
 * Dependencies: None
 *
 * IMPORTANT: Uses fixed collection ID so dependent migrations can reference
 * it directly without findCollectionByNameOrId (which fails in fresh DB).
 */

// Fixed collection IDs - must match across all migrations
const COLLECTION_IDS = {
  camp_sessions: "col_camp_sessions",
  persons: "col_persons",
  bunks: "col_bunks",
  attendees: "col_attendees",
  bunk_plans: "col_bunk_plans",
  bunk_requests: "col_bunk_requests",
  bunk_assignments: "col_bunk_assignments",
  bunk_assignments_draft: "col_bunk_drafts",
  saved_scenarios: "col_scenarios",
  solver_runs: "col_solver_runs",
  original_bunk_requests: "col_orig_requests",
  locked_groups: "col_locked_groups",
  locked_group_members: "col_locked_members",
  config: "col_config",
  config_sections: "col_config_sections"
}

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_IDS.bunks,
    name: "bunks",
    type: "base",
    system: false,
    fields: [
      {
        name: "cm_id",
        type: "number",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "name",
        type: "text",
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
        name: "year",
        type: "number",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "gender",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 10,
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
      "CREATE UNIQUE INDEX `idx_bunks_campminder_year` ON `bunks` (`cm_id`, `year`)",
      "CREATE INDEX `idx_zL6XKZjgMQ` ON `bunks` (`name`)",
      "CREATE INDEX `idx_03EsqBQcEG` ON `bunks` (`cm_id`)"
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    options: {}
  })

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunks")
  return app.delete(collection)
})
