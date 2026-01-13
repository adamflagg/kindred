/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create camp_sessions collection
 * Dependencies: None
 *
 * IMPORTANT: Uses fixed collection ID so dependent migrations can reference
 * it directly without findCollectionByNameOrId (which fails in fresh DB).
 */

// Fixed collection IDs - used across migrations for relation fields
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
  let collection = new Collection({
    id: COLLECTION_IDS.camp_sessions,
    type: "base",
    name: "camp_sessions",
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
        type: "date",
        name: "start_date",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "date",
        name: "end_date",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "select",
        name: "session_type",
        required: true,
        presentable: false,
        system: false,
        values: ["main", "embedded", "ag", "family", "quest", "training", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other"],
        maxSelect: 1
      },
      {
        type: "number",
        name: "parent_id",
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
      "CREATE UNIQUE INDEX `idx_camp_sessions_id_year` ON `camp_sessions` (`cm_id`, `year`)",
      "CREATE INDEX idx_camp_sessions_parent ON camp_sessions (parent_id)",
      "CREATE INDEX idx_camp_sessions_type ON camp_sessions (session_type)"
    ]
  });

  return app.save(collection);
}, (app) => {
  let collection = app.findCollectionByNameOrId("camp_sessions");
  return app.delete(collection);
});
