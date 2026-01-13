/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create solver_runs collection
 * Dependencies: camp_sessions
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
  // Dynamic lookup for relation field
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios")

  let collection = new Collection({
    id: COLLECTION_IDS.solver_runs,
    type: "base",
    name: "solver_runs",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "text",
        name: "session",
        required: true,
        system: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "run_id",
        required: true,
        system: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        type: "select",
        name: "status",
        required: false,
        system: false,
        values: ["pending", "running", "success", "failed", "error"],
        maxSelect: 1
      },
      {
        type: "number",
        name: "progress",
        required: false,
        system: false,
        options: {
          min: 0,
          max: 100,
          noDecimal: false
        }
      },
      {
        type: "date",
        name: "started_at",
        required: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "date",
        name: "completed_at",
        required: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "json",
        name: "logs",
        required: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "error",
        required: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "result",
        required: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "details",
        required: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "request_data",
        required: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "assignment_counts",
        required: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "stats",
        required: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "relation",
        name: "scenario",
        required: false,
        system: false,
        collectionId: scenariosCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "text",
        name: "run_type",
        required: false,
        system: false,
        options: {
          min: null,
          max: 50,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "triggered_by",
        required: false,
        system: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        type: "number",
        name: "session_id",
        required: false,
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
      "CREATE UNIQUE INDEX idx_solver_runs_run_id ON solver_runs (run_id)",
      "CREATE INDEX idx_solver_runs_session ON solver_runs (session)",
      "CREATE INDEX idx_solver_runs_status ON solver_runs (status)",
      "CREATE INDEX idx_solver_runs_scenario ON solver_runs (scenario)"
    ]
  });

  app.save(collection);
}, (app) => {
  let collection = app.findCollectionByNameOrId("solver_runs");
  app.delete(collection);
});