/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Add disposition_reason and resolution_method to bunk_requests
 * Dependencies: 1500000018_bunk_requests.js
 *
 * Promotes disposition_reason and resolution_method from metadata JSON
 * to first-class top-level fields for querying and display.
 */

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests");

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
        type: "text",
        name: "resolution_method",
        required: false,
        min: 0,
        max: 100,
        pattern: "",
      })
    );

    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests");

    collection.fields.removeByName("disposition_reason");
    collection.fields.removeByName("resolution_method");

    app.save(collection);
  }
);
