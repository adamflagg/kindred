/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Drop `request_data`; promote `session` to a relation.
 *
 * PR2 of the 3-PR solver-debug-dashboard sequence (see PR1: #1343).
 *
 * (1) DROP `request_data` (JSON, added in 1500000023). No code path
 *     writes to it; NULL on every row. Removing prevents future drift
 *     between schema and writer.
 *
 * (2) DROP + RECREATE `session` as relation -> sessions. The old text
 *     column held str(cm_id) for joinability via `session_id`. The new
 *     relation enables `expand=session` for future debug surfaces.
 *     PB v0.23 can't alter text -> relation in place; drop+add is the
 *     working pattern.
 *
 *     NO BACKFILL of historical rows -- they get session = NULL.
 *     Debug page reads `session_id` numeric + `details.source_label`,
 *     neither of which depend on the relation. New writers (api/services/
 *     solver_runner.py + api/routers/solver.py) resolve the relation
 *     on every new run.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("solver_runs")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  // (1) Drop request_data
  collection.fields.removeByName("request_data")

  // (2) Drop + recreate session as relation
  collection.fields.removeByName("session")
  collection.fields.add(new Field({
    type: "relation",
    name: "session",
    required: false,
    presentable: false,
    collectionId: sessionsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1,
  }))

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("solver_runs")

  // Down: restore session as required text + request_data as json
  collection.fields.removeByName("session")
  collection.fields.add(new Field({
    type: "text",
    name: "session",
    required: true,
    presentable: false,
    min: null,
    max: null,
    pattern: "",
  }))
  collection.fields.add(new Field({
    type: "json",
    name: "request_data",
    required: false,
    presentable: false,
    maxSize: 2000000,
  }))

  app.save(collection)
})
