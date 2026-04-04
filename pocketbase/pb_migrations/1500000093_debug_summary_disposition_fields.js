/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Add disposition_reason and is_reciprocal to debug_pipeline_summary
 * Dependencies: 1500000086_debug_pipeline_collections.js
 *
 * Adds disposition_reason (text) and is_reciprocal (bool) columns to
 * debug_pipeline_summary for pipeline debug page display.
 */

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("debug_pipeline_summary");

    collection.fields.add(
      new Field({
        type: "text",
        name: "disposition_reason",
        required: false,
        min: 0,
        max: 100,
        pattern: "",
      })
    );

    collection.fields.add(
      new Field({
        type: "bool",
        name: "is_reciprocal",
      })
    );

    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("debug_pipeline_summary");

    collection.fields.removeByName("disposition_reason");
    collection.fields.removeByName("is_reciprocal");

    app.save(collection);
  }
);
