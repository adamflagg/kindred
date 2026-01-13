/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create config collection
 *
 * IMPORTANT: Uses fixed collection ID for consistency.
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
    id: COLLECTION_IDS.config,
    name: "config",
    type: "base",
    system: false,
    fields: [
      {
        name: "category",
        type: "text",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        name: "subcategory",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        name: "config_key",
        type: "text",
        required: true,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: 255,
          pattern: ""
        }
      },
      {
        name: "value",
        type: "json",
        required: true,
        presentable: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        name: "metadata",
        type: "json",
        required: false,
        presentable: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        name: "description",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 1000,
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
      "CREATE UNIQUE INDEX idx_config_unique_key ON config (category, COALESCE(subcategory, ''), config_key)",
      "CREATE INDEX idx_config_category ON config (category)"
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
  const collection = app.findCollectionByNameOrId("config")
  return app.delete(collection)
})