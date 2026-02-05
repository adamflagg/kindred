/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add normalized geographic columns to camper_history
 *
 * Adds three new columns for normalized/canonical versions of geographic data:
 * - city_normalized: Normalized city name (state suffix removed, title case)
 * - school_normalized: Normalized school name (fuzzy clustered)
 * - congregation_normalized: Normalized synagogue name (fuzzy clustered)
 *
 * Populated by Go: pocketbase/sync/normalize_geographic.go
 * These columns enable consistent metrics aggregation without duplicate entries
 * caused by typos, case differences, or formatting variations.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camper_history");

  // Add city_normalized column
  collection.fields.add(new Field({
    type: "text",
    name: "city_normalized",
    required: false,
    presentable: false,
    min: 0,
    max: 100,
    pattern: ""
  }));

  // Add school_normalized column
  collection.fields.add(new Field({
    type: "text",
    name: "school_normalized",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  // Add congregation_normalized column
  collection.fields.add(new Field({
    type: "text",
    name: "congregation_normalized",
    required: false,
    presentable: false,
    min: 0,
    max: 300,
    pattern: ""
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_history");
  collection.fields.removeByName("city_normalized");
  collection.fields.removeByName("school_normalized");
  collection.fields.removeByName("congregation_normalized");
  app.save(collection);
});
