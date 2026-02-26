/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Fix enrollment_snapshots number field constraints
 *
 * The original migration (1500000060) used min: 0, max: 0 for all number fields.
 * PocketBase interprets max: 0 as a literal maximum of 0, not "unlimited",
 * causing all saves with positive values to fail with:
 *   "session_cm_id: Must be less than 0.000000."
 *
 * Count fields also used required: true, but PocketBase treats 0 as blank
 * for required number fields, so 0-count records fail with "cannot be blank".
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("enrollment_snapshots");

  // session_cm_id: always a positive CampMinder ID
  collection.fields.add(new Field({
    type: "number",
    name: "session_cm_id",
    required: true,
    presentable: false,
    min: 1,
    max: null,
    onlyInt: true
  }));

  // Count fields: 0 is valid, so required: false (PocketBase treats 0 as blank)
  collection.fields.add(new Field({
    type: "number",
    name: "enrolled_count",
    required: false,
    presentable: false,
    min: null,
    max: null,
    onlyInt: true
  }));

  collection.fields.add(new Field({
    type: "number",
    name: "waitlisted_count",
    required: false,
    presentable: false,
    min: null,
    max: null,
    onlyInt: true
  }));

  collection.fields.add(new Field({
    type: "number",
    name: "cancelled_count",
    required: false,
    presentable: false,
    min: null,
    max: null,
    onlyInt: true
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("enrollment_snapshots");

  collection.fields.add(new Field({
    type: "number",
    name: "session_cm_id",
    required: true,
    presentable: false,
    min: 0,
    max: 0,
    onlyInt: true
  }));

  collection.fields.add(new Field({
    type: "number",
    name: "enrolled_count",
    required: true,
    presentable: false,
    min: 0,
    max: 0,
    onlyInt: true
  }));

  collection.fields.add(new Field({
    type: "number",
    name: "waitlisted_count",
    required: true,
    presentable: false,
    min: 0,
    max: 0,
    onlyInt: true
  }));

  collection.fields.add(new Field({
    type: "number",
    name: "cancelled_count",
    required: true,
    presentable: false,
    min: 0,
    max: 0,
    onlyInt: true
  }));

  app.save(collection);
});
