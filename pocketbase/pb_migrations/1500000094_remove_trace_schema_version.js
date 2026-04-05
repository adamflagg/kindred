/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Remove schema_version from debug_pipeline_traces
 *
 * The schema_version field was written but never read for migration or
 * conditional logic. Removing dead weight from the debug trace schema.
 * Closes #839.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("debug_pipeline_traces");
  collection.fields.removeByName("schema_version");
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("debug_pipeline_traces");
  collection.fields.add(new Field({
    type: "number",
    name: "schema_version",
    required: false,
    presentable: false
  }));
  app.save(collection);
});
