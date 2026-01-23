/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunk_request_sources junction table
 * Dependencies: bunk_requests, original_bunk_requests
 *
 * This table links bunk_requests to their contributing original_bunk_requests.
 * Enables:
 * - Cross-run deduplication (Field B matches existing Field A)
 * - Partial invalidation (when source changes, find affected requests)
 * - Merge/split tracking (multi-source requests)
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const bunkRequestsCol = app.findCollectionByNameOrId("bunk_requests")
  const originalRequestsCol = app.findCollectionByNameOrId("original_bunk_requests")

  const collection = new Collection({
    name: "bunk_request_sources",
    type: "base",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // FK to bunk_requests
      {
        type: "relation",
        name: "bunk_request",
        required: true,
        presentable: false,
        collectionId: bunkRequestsCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1
      },
      // FK to original_bunk_requests
      {
        type: "relation",
        name: "original_request",
        required: true,
        presentable: false,
        collectionId: originalRequestsCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1
      },
      // Which source "owns" the request (true for primary source)
      {
        type: "bool",
        name: "is_primary",
        required: false,
        presentable: false
      },
      // Source field name (for quick access without joining original_bunk_requests)
      {
        type: "text",
        name: "source_field",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      // AI parse notes from the original bunk_request when merging
      {
        type: "text",
        name: "parse_notes",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: 5000,
          pattern: ""
        }
      },
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      }
    ],
    indexes: [
      // Unique constraint: one link per (bunk_request, original_request) pair
      "CREATE UNIQUE INDEX `idx_source_link_unique` ON `bunk_request_sources` (`bunk_request`, `original_request`)",
      // Find all sources for a bunk_request
      "CREATE INDEX `idx_source_link_bunk_request` ON `bunk_request_sources` (`bunk_request`)",
      // Find all bunk_requests for an original_request (for partial invalidation)
      "CREATE INDEX `idx_source_link_original` ON `bunk_request_sources` (`original_request`)",
      // Find primary source quickly
      "CREATE INDEX `idx_source_link_primary` ON `bunk_request_sources` (`bunk_request`, `is_primary`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_request_sources");
  app.delete(collection);
});
