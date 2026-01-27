/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add first_year_attended field to camper_history
 *
 * This field stores the first year a camper ever attended summer camp
 * (main, ag, or embedded sessions only - not family camp).
 * Used for onramp analysis in registration metrics.
 *
 * Computed by Go: pocketbase/sync/camper_history.go
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camper_history");

  // Add first_year_attended field - DIRECT properties (PocketBase v0.23+ syntax)
  collection.fields.add(new Field({
    type: "number",
    name: "first_year_attended",
    required: false,
    presentable: false,
    min: 2010,
    max: 2100,
    onlyInt: true
  }));

  app.save(collection);

  // Add index for efficient querying
  const db = app.db();
  db.newQuery("CREATE INDEX IF NOT EXISTS `idx_camper_history_first_year` ON `camper_history` (`first_year_attended`)").execute();

}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_history");
  collection.fields.removeByName("first_year_attended");
  app.save(collection);

  // Remove index
  const db = app.db();
  db.newQuery("DROP INDEX IF EXISTS `idx_camper_history_first_year`").execute();
});
