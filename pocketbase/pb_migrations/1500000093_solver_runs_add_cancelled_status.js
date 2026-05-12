/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add "cancelled" to solver_runs.status select enum
 *
 * The sweep-cancel path (api/services/sweep_runner.py::_mark_remaining)
 * writes status="cancelled" for orphan run rows when a sweep is aborted
 * mid-loop. The frontend (SolverDebugPage) already treats "cancelled"
 * as a terminal/settled status, but the PB select enum never included
 * it — so the PATCH was rejected with validation_invalid_value and the
 * rows stayed "pending" forever.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("solver_runs")
  const field = collection.fields.getByName("status")
  field.values = ["pending", "running", "success", "failed", "error", "cancelled"]
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("solver_runs")
  const field = collection.fields.getByName("status")
  field.values = ["pending", "running", "success", "failed", "error"]
  app.save(collection)
})
