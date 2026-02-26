/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Add gender count fields to enrollment_snapshots
 *
 * Adds 6 integer fields for per-gender enrollment tracking:
 * - enrolled_male_count, enrolled_female_count
 * - waitlisted_male_count, waitlisted_female_count
 * - cancelled_male_count, cancelled_female_count
 *
 * Fields are optional (required: false) for backward compatibility —
 * existing snapshots will have null values and the velocity service
 * falls back to attendee reconstruction when gender data is absent.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("enrollment_snapshots");

  const genderFields = [
    "enrolled_male_count",
    "enrolled_female_count",
    "waitlisted_male_count",
    "waitlisted_female_count",
    "cancelled_male_count",
    "cancelled_female_count",
  ];

  for (const name of genderFields) {
    collection.fields.add(new Field({
      type: "number",
      name: name,
      required: false,
      presentable: false,
      min: null,
      max: null,
      onlyInt: true,
    }));
  }

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("enrollment_snapshots");

  const genderFields = [
    "enrolled_male_count",
    "enrolled_female_count",
    "waitlisted_male_count",
    "waitlisted_female_count",
    "cancelled_male_count",
    "cancelled_female_count",
  ];

  for (const name of genderFields) {
    collection.fields.removeByName(name);
  }

  app.save(collection);
});
