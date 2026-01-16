/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add source_fields JSON field to bunk_requests
 *
 * This field stores an array of all contributing source field names.
 * Example: ["Share Bunk With", "BunkingNotes Notes"]
 *
 * Used for:
 * - Displaying which sources contributed to a merged request
 * - Quick filtering/display without querying junction table
 * - Backward compatibility with existing source_field (single) usage
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  // Add source_fields JSON array field
  collection.fields.add(new Field({
    type: "json",
    name: "source_fields",
    required: false,
    presentable: false,
    options: {
      maxSize: 2000000
    }
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  // Remove source_fields field
  collection.fields.removeByName("source_fields");

  app.save(collection);
});
