/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Drop is_deleted from bunk_assignments
 *
 * The is_deleted field mirrored CampMinder's IsDeleted flag, but our composite
 * upsert key (person, session, year) updates assignments in place when campers
 * move bunks, and orphan-delete handles records that disappear from the API
 * feed. The flag was effectively dead weight (0 deleted rows in production for
 * 2026) and only one consumer (camper_history aggregation) ever filtered on it.
 *
 * Closes #1219.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("bunk_assignments");
  collection.fields.removeByName("is_deleted");
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_assignments");
  collection.fields.add(new Field({
    type: "bool",
    name: "is_deleted",
    required: false,
    presentable: false
  }));
  app.save(collection);
});
