/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create config_sections collection
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
  // Create config_sections collection
  const collection = new Collection({
    id: COLLECTION_IDS.config_sections,
    name: "config_sections",
    type: "base",
    system: false,
    fields: [
      {
        name: "section_key",
        type: "text",
        required: true,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        name: "title",
        type: "text",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 255,
          pattern: ""
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
        name: "display_order",
        type: "number",
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
        name: "expanded_by_default",
        type: "bool",
        required: false,
        presentable: false,
        system: false
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
      "CREATE UNIQUE INDEX idx_config_sections_key ON config_sections (section_key)",
      "CREATE INDEX idx_config_sections_order ON config_sections (display_order)"
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    options: {}
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("config_sections");
  return app.delete(collection);
});