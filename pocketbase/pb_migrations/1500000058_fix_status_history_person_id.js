/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Fix attendee_status_history person_id field constraint
 *
 * The original migration (1500000057) used min: 0, max: 0 for person_id.
 * PocketBase interprets max: 0 as a literal maximum of 0, not "unlimited",
 * causing all saves with positive CampMinder person IDs to fail with:
 *   "person_id: Must be less than 0.000000."
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("attendee_status_history");

  collection.fields.add(new Field({
    type: "number",
    name: "person_id",
    required: true,
    presentable: false,
    min: null,
    max: null,
    onlyInt: true
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("attendee_status_history");

  collection.fields.add(new Field({
    type: "number",
    name: "person_id",
    required: true,
    presentable: false,
    min: 0,
    max: 0,
    onlyInt: true
  }));

  app.save(collection);
});
