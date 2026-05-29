/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create solver_runs collection
 * Dependencies: saved_scenarios (1500000021)
 *
 * Tracks solver execution history including status, progress, results,
 * and error information. Each run is associated with a scenario and
 * contains detailed logs and statistics.
 *
 * Access: tier3 denyAll — frontend hits FastAPI admin endpoints; direct
 * PB CRUD is denied via empty-string rules.
 */

migrate((app) => {
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios")

  const collection = new Collection({
    id: "col_solver_runs",
    type: "base",
    name: "solver_runs",
    listRule: '',
    viewRule: '',
    createRule: '',
    updateRule: '',
    deleteRule: '',
    fields: [
      {
        type: "text",
        name: "session",
        required: true,
        presentable: false
      },
      {
        type: "text",
        name: "run_id",
        required: true,
        presentable: false
      },
      {
        type: "select",
        name: "status",
        required: false,
        presentable: false,
        values: ["pending", "running", "success", "failed", "error", "cancelled"],
        maxSelect: 1
      },
      {
        type: "number",
        name: "progress",
        required: false,
        presentable: false
      },
      {
        type: "date",
        name: "started_at",
        required: false,
        presentable: false
      },
      {
        type: "date",
        name: "completed_at",
        required: false,
        presentable: false
      },
      {
        type: "json",
        name: "logs",
        required: false,
        presentable: false
      },
      {
        type: "json",
        name: "error",
        required: false,
        presentable: false
      },
      {
        type: "json",
        name: "result",
        required: false,
        presentable: false
      },
      {
        type: "json",
        name: "details",
        required: false,
        presentable: false
      },
      {
        type: "json",
        name: "request_data",
        required: false,
        presentable: false
      },
      {
        type: "json",
        name: "assignment_counts",
        required: false,
        presentable: false
      },
      {
        type: "json",
        name: "stats",
        required: false,
        presentable: false
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
        presentable: false
      },
      {
        type: "text",
        name: "triggered_by",
        required: false,
        presentable: false
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

  collection.fields.add(new Field({
    type: "number",
    name: "year",
    required: true,
    presentable: false,
    min: 2000,
    max: 2100,
    onlyInt: true,
  }))

  app.save(collection);

  // idx_solver_runs_year is created via raw SQL (not collection.indexes) to
  // match the historical chain: the original #092 used the same raw-SQL form,
  // which means the index exists in sqlite but `collection.indexes` keeps
  // only the 4 entries declared at create time.
  app.db().newQuery(
    "CREATE INDEX IF NOT EXISTS idx_solver_runs_year ON solver_runs (year)"
  ).execute()
}, (app) => {
  const collection = app.findCollectionByNameOrId("solver_runs");
  app.delete(collection);
});
