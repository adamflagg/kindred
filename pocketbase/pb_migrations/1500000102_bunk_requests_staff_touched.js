/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add staff_touched bool to bunk_requests
 *
 * One-way flag set by GUI-originated mutations to mark that a staff user
 * has manually edited this row (target, type, status, age-pref, etc.).
 * Pipeline / sync / AI-parse writes leave the field alone, so the default
 * false persists for machine-authored rows. Survives subsequent overrides
 * (re-setting is idempotent) so the audit signal isn't lost on multi-edit.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  collection.fields.add(new Field({
    type: "bool",
    name: "staff_touched",
    required: false,
    presentable: false
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  collection.fields.removeByName("staff_touched");

  app.save(collection);
});
