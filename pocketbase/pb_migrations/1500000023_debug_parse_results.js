/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create debug_parse_results collection
 * Dependencies: original_bunk_requests (1500000011), camp_sessions (1500000001)
 *
 * Stores Phase 1 AI parsing results separately from production bunk_requests
 * for debugging and iteration on AI prompts without affecting production data.
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const originalRequestsCol = app.findCollectionByNameOrId("original_bunk_requests")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  const collection = new Collection({
    name: "debug_parse_results",
    type: "base",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
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
      {
        type: "relation",
        name: "session",
        required: false,
        presentable: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "json",
        name: "parsed_intents",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "json",
        name: "ai_raw_response",
        required: false,
        presentable: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        type: "number",
        name: "token_count",
        required: false,
        presentable: false,
        options: {
          min: 0,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "text",
        name: "prompt_version",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: 50,
          pattern: ""
        }
      },
      {
        type: "number",
        name: "processing_time_ms",
        required: false,
        presentable: false,
        options: {
          min: 0,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "bool",
        name: "is_valid",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "error_message",
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
      "CREATE INDEX `idx_debug_parse_original` ON `debug_parse_results` (`original_request`)",
      "CREATE INDEX `idx_debug_parse_session` ON `debug_parse_results` (`session`)",
      "CREATE INDEX `idx_debug_parse_created` ON `debug_parse_results` (`created`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("debug_parse_results");
  app.delete(collection);
});
