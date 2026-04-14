/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Add source_fragment column to bunk_requests
 * Dependencies: 1500000018_bunk_requests.js
 *
 * Stores the verbatim substring of source text that justified each parsed
 * bunk request. Empty string for inferred/expanded requests.
 *
 * Authoritative storage for Phase 1 AI parsing source attribution.
 */

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests");

    collection.fields.add(
      new Field({
        type: "text",
        name: "source_fragment",
        required: false,
        min: 0,
        max: 2000,
        pattern: "",
      })
    );

    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests");

    collection.fields.removeByName("source_fragment");

    app.save(collection);
  }
);
