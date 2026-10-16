/// <reference path="../pb_data/types.d.ts" />
/**
 * sync_runs.dry_run: marks a run that computed without writing.
 *
 * A dry-run sync (`dry_run=1`) used to be recorded exactly like a real run, so Manage > Sync
 * showed "historical / success" with would-be counts and every freshness reader (Go and
 * FastAPI) counted it as a sync that refreshed data. The writer now sets this column, the
 * readers filter it out, and Manage > Sync labels the row.
 *
 * No backfill: every existing row predates the label and the column defaults to false, which
 * is what those rows were treated as. An index is not worth it on a table of ~9,000 rows.
 *
 * Field properties are direct (v0.23+ ignores an options wrapper silently); addField() is a
 * no-op when the column exists.
 */

function addField(collection, field) {
  if (!collection.fields.getByName(field.name)) {
    collection.fields.add(field)
  }
}

migrate((app) => {
  const collection = app.findCollectionByNameOrId("sync_runs")
  addField(collection, new Field({
    type: "bool",
    name: "dry_run",
    required: false,
    presentable: false
  }))
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("sync_runs")
  collection.fields.removeByName("dry_run")
  app.save(collection)
})
