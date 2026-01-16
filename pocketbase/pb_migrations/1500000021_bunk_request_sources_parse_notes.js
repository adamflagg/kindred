/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add parse_notes field to bunk_request_sources
 *
 * Stores the AI parse notes from the original bunk_request when merging,
 * so they can be displayed in the split modal for context.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("bunk_request_sources");

  // Add parse_notes text field
  collection.fields.add(new Field({
    type: "text",
    name: "parse_notes",
    required: false,
    presentable: false,
    options: {
      min: null,
      max: 5000,
      pattern: ""
    }
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_request_sources");
  collection.fields.removeByName("parse_notes");
  app.save(collection);
});
