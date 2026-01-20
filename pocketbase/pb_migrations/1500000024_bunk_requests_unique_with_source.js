/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add source_field to bunk_requests unique constraint and make it required
 *
 * Previous constraint: (requester_id, requestee_id, request_type, year, session_id)
 * New constraint: (requester_id, requestee_id, request_type, year, session_id, source_field)
 *
 * This allows the same logical request to exist from multiple source fields,
 * enabling full provenance tracking back to original_bunk_requests.
 *
 * Deduplication for display happens in the frontend layer.
 * Deduplication for solver uses DISTINCT on the non-source columns.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  // Make source_field required
  for (let i = 0; i < collection.fields.length; i++) {
    if (collection.fields[i].name === "source_field") {
      collection.fields[i].required = true;
      break;
    }
  }

  // Remove the old unique index (without source_field)
  collection.indexes = collection.indexes.filter(
    idx => !idx.includes("idx_i29qcpH8Ye")
  );

  // Add new unique index including source_field
  collection.indexes.push(
    "CREATE UNIQUE INDEX `idx_bunk_requests_unique_with_source` ON `bunk_requests` (`requester_id`, `requestee_id`, `request_type`, `year`, `session_id`, `source_field`)"
  );

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  // Restore source_field to optional
  for (let i = 0; i < collection.fields.length; i++) {
    if (collection.fields[i].name === "source_field") {
      collection.fields[i].required = false;
      break;
    }
  }

  // Remove the new index
  collection.indexes = collection.indexes.filter(
    idx => !idx.includes("idx_bunk_requests_unique_with_source")
  );

  // Restore the old unique index
  collection.indexes.push(
    "CREATE UNIQUE INDEX `idx_i29qcpH8Ye` ON `bunk_requests` (`requester_id`, `requestee_id`, `request_type`, `year`, `session_id`)"
  );

  app.save(collection);
});
