/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add "none" status to attendees collection
 *
 * CampMinder status_id = 1 means "None". This adds it to the allowed values.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("attendees");

  // Find the status field and update its values
  const statusField = collection.fields.getByName("status");
  statusField.values = [
    "none",
    "enrolled",
    "applied",
    "waitlisted",
    "left_early",
    "cancelled",
    "dismissed",
    "inquiry",
    "withdrawn",
    "incomplete",
    "unknown"
  ];

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("attendees");

  // Rollback: remove "none" from values
  const statusField = collection.fields.getByName("status");
  statusField.values = [
    "enrolled",
    "applied",
    "waitlisted",
    "left_early",
    "cancelled",
    "dismissed",
    "inquiry",
    "withdrawn",
    "incomplete",
    "unknown"
  ];

  app.save(collection);
});
