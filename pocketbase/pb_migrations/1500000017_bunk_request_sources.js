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

// Fixed collection IDs - must match across all migrations
const COLLECTION_IDS = {
  camp_sessions: "col_camp_sessions",
  persons: "col_persons",
  bunks: "col_bunks",
  attendees: "col_attendees",
  bunk_plans: "col_bunk_plans",
  bunk_requests: "col_bunk_requests",
  bunk_assignments: "col_bunk_assignments",
  bunk_assignments_draft: "col_bunk_drafts",
  saved_scenarios: "col_scenarios",
  solver_runs: "col_solver_runs",
  original_bunk_requests: "col_orig_requests",
  locked_groups: "col_locked_groups",
  locked_group_members: "col_locked_members",
  config: "col_config",
  config_sections: "col_config_sections",
  bunk_request_sources: "col_request_sources"
}

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_IDS.bunk_request_sources,
    name: "bunk_request_sources",
    type: "base",
    system: false,
    fields: [
      // FK to bunk_requests
      {
        name: "bunk_request",
        type: "relation",
        system: false,
        required: true,
        unique: false,
        options: {
          collectionId: COLLECTION_IDS.bunk_requests,
          cascadeDelete: true,
          minSelect: null,
          maxSelect: 1,
          displayFields: null
        }
      },
      // FK to original_bunk_requests
      {
        name: "original_request",
        type: "relation",
        system: false,
        required: true,
        unique: false,
        options: {
          collectionId: COLLECTION_IDS.original_bunk_requests,
          cascadeDelete: true,
          minSelect: null,
          maxSelect: 1,
          displayFields: null
        }
      },
      // Which source "owns" the request (true for primary source)
      {
        name: "is_primary",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Source field name (for quick access without joining original_bunk_requests)
      {
        name: "source_field",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 100,
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
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    options: {}
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_request_sources");
  return app.delete(collection);
});
