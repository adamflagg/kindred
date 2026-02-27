/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Add effective_date and last_updated_utc to attendees
 *
 * CampMinder provides three date fields per enrollment:
 * - EffectiveDate: original registration/application date (stable, never overwritten)
 * - PostDate: date of current status (already stored as enrollment_date)
 * - LastUpdatedUTC: last modification timestamp
 *
 * For cancelled/withdrawn records, PostDate = cancellation date, not registration.
 * EffectiveDate gives us the true registration date for velocity reconstruction.
 *
 * Fields are optional for backward compatibility — existing records will have
 * null values until the next sync populates them.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("attendees");

  collection.fields.add(new Field({
    type: "date",
    name: "effective_date",
    required: false,
    presentable: false,
  }));

  collection.fields.add(new Field({
    type: "date",
    name: "last_updated_utc",
    required: false,
    presentable: false,
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("attendees");

  collection.fields.removeByName("effective_date");
  collection.fields.removeByName("last_updated_utc");

  app.save(collection);
});
