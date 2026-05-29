/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create original_bunk_requests collection
 * Dependencies: persons
 *
 * Stores raw bunk request data from CampMinder CSV exports.
 * The Python processor reads from this table and writes to bunk_requests.
 *
 * Uses fixed collection ID for dependent migrations.
 */

const COLLECTION_ID_ORIG_REQUESTS = "col_orig_requests";

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true'
  const bunkingManage = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

  // Dynamic lookups for relations
  const personsCol = app.findCollectionByNameOrId("persons")

  const collection = new Collection({
    id: COLLECTION_ID_ORIG_REQUESTS,
    name: "original_bunk_requests",
    type: "base",
    listRule: bunkingManage,
    viewRule: bunkingManage,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: adminOnly,
    fields: [
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      {
        type: "relation",
        name: "requester",
        required: true,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "select",
        name: "field",
        required: true,
        presentable: false,
        values: [
          "bunk_with",
          "not_bunk_with",
          "bunking_notes",
          "internal_notes",
          "socialize_with"
        ],
        maxSelect: 1
      },
      {
        type: "text",
        name: "content",
        required: true,
        presentable: false
      },
      {
        type: "text",
        name: "content_hash",
        required: false,
        presentable: false
      },
      {
        type: "date",
        name: "processed",
        required: false,
        presentable: false
      },
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_original_bunk_requests_person_year` ON `original_bunk_requests` (`year`, `field`, `requester`)",
      "CREATE INDEX `idx_6mXste3Wlc` ON `original_bunk_requests` (`requester`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("original_bunk_requests");
  app.delete(collection);
});
