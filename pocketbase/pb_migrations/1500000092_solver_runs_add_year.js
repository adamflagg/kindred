/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add `year` column to solver_runs
 * Issue: #1247
 *
 * Year-stamps each solver_run so the frontend can filter/group by year
 * without relying on the validSessionIds workaround from PR #1242.
 * The writer (api/services/solver_runner.py + api/routers/solver.py)
 * populates year from the request on every new row.
 *
 * No backfill: old rows keep NULL year and are excluded from
 * year-filtered queries. `required: true` enforces year on all new
 * writes, which means legacy NULL-year rows are effectively write-
 * frozen — any future PATCH would have to supply year. That's
 * acceptable since pre-#1247 rows are historical / read-only.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("solver_runs")

  collection.fields.add(new Field({
    type: "number",
    name: "year",
    required: true,
    presentable: false,
    min: 2000,
    max: 2100,
    onlyInt: true,
  }))

  app.save(collection)

  // Add index for inevitable year-scoped filters
  app.db().newQuery(
    "CREATE INDEX IF NOT EXISTS idx_solver_runs_year ON solver_runs (year)"
  ).execute()
}, (app) => {
  const collection = app.findCollectionByNameOrId("solver_runs")
  collection.fields.removeByName("year")
  app.save(collection)

  app.db().newQuery("DROP INDEX IF EXISTS idx_solver_runs_year").execute()
})
