/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create solver_runs collection
 * Dependencies: saved_scenarios (1500000021)
 *
 * Tracks solver execution history including status, progress, results,
 * and error information. Each run is associated with a scenario and
 * contains detailed logs and statistics.
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 */

migrate((app) => {
  // Dynamic lookup for relation field
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios")

  const collection = new Collection({
    id: "col_solver_runs",
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
        presentable: false,
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
        presentable: false,
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
        presentable: false,
        values: ["pending", "running", "success", "failed", "error"],
        maxSelect: 1
      },
      {
        type: "number",
        name: "progress",
        required: false,
        presentable: false,
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
        presentable: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "date",
        name: "completed_at",
        required: false,
        presentable: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "json",
        name: "logs",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "error",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "result",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "details",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "request_data",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "assignment_counts",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "stats",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
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
        type: "text",
        name: "run_type",
        required: false,
        presentable: false,
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
        presentable: false,
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
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
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
  const collection = app.findCollectionByNameOrId("solver_runs");
  app.delete(collection);
});
