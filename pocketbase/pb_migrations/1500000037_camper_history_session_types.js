/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add session_types field to camper_history
 *
 * This field stores comma-separated session types (e.g., "main,ag") to enable
 * filtering summer camp sessions from family camp in registration metrics.
 * Fixes: Grade 0 campers appearing (family camp adults), zero demographic data.
 *
 * Computed by Go: pocketbase/sync/camper_history.go
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camper_history");

  // Add session_types field - DIRECT properties (PocketBase v0.23+ syntax)
  collection.fields.add(new Field({
    type: "text",
    name: "session_types",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  app.save(collection);

  // Add index for efficient filtering
  const db = app.db();
  db.newQuery("CREATE INDEX IF NOT EXISTS `idx_camper_history_session_types` ON `camper_history` (`session_types`)").execute();

}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_history");
  collection.fields.removeByName("session_types");
  app.save(collection);

  // Remove index
  const db = app.db();
  db.newQuery("DROP INDEX IF EXISTS `idx_camper_history_session_types`").execute();
});
