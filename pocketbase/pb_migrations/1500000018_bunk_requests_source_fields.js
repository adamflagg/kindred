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
  if (!collection) {
    throw new Error("bunk_requests collection not found");
  }

  // Add source_fields JSON array field
  collection.fields.push({
    name: "source_fields",
    type: "json",
    system: false,
    required: false,
    unique: false,
    options: {
      maxSize: 2000000
    }
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");
  if (!collection) {
    return; // Nothing to rollback if collection doesn't exist
  }

  // Remove source_fields field by filtering it out
  const fieldsArray = collection.fields;
  for (let i = 0; i < fieldsArray.length; i++) {
    if (fieldsArray[i].name === "source_fields") {
      fieldsArray.splice(i, 1);
      break;
    }
  }

  return app.save(collection);
});
