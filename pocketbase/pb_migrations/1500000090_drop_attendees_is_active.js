/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Drop is_active from attendees
 *
 * The is_active boolean was a derived field (status_id == 2) that is no longer
 * set by the sync (removed in #620). All consumers use status_id = 2 directly.
 * Closes #719.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("attendees");
  collection.fields.removeByName("is_active");
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("attendees");
  collection.fields.add(new Field({
    type: "bool",
    name: "is_active",
    required: false,
    presentable: false
  }));
  app.save(collection);
});
