/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add merged_into self-referential relation to bunk_requests
 *
 * This field enables soft-delete for merge operations:
 * - When requests are merged, absorbed requests get merged_into set to the kept request ID
 * - Soft-deleted requests are hidden from normal queries (merged_into != "")
 * - Split operations restore by clearing merged_into
 *
 * Benefits:
 * - Zero data loss - all 40+ fields preserved exactly
 * - Fast operations - UPDATE vs DELETE/CREATE
 * - Instant restoration with full original context
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  // Add self-referential relation field for soft delete tracking
  collection.fields.add(new Field({
    type: "relation",
    name: "merged_into",
    required: false,
    presentable: false,
    collectionId: collection.id,  // Self-reference to bunk_requests
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  // Add index for efficient filtering of non-merged requests
  collection.indexes = collection.indexes || [];
  collection.indexes.push("CREATE INDEX idx_bunk_requests_merged_into ON bunk_requests (merged_into)");

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  // Remove the index first
  if (collection.indexes) {
    collection.indexes = collection.indexes.filter(
      idx => !idx.includes("idx_bunk_requests_merged_into")
    );
  }

  // Remove the field
  collection.fields.removeByName("merged_into");

  app.save(collection);
});
