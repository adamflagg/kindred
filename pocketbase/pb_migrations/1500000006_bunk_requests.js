/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunk_requests collection
 * Dependencies: persons, camp_sessions
 *
 * This table stores all bunking requests parsed from CSV files and other sources.
 * It supports multiple request types including bunk_with, not_bunk_with, and age_preference.
 *
 * IMPORTANT: Uses fixed collection ID for consistency.
 */

const COLLECTION_ID_BUNK_REQUESTS = "col_bunk_requests";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_BUNK_REQUESTS,
    name: "bunk_requests",
    type: "base",
    system: false,
    fields: [
      // Primary requester - always required
      {
        name: "requester_id",
        type: "number",
        system: false,
        required: true,
        unique: false,
        options: {
          min: null,
          max: null,
          noDecimal: false
        }
      },
      // Target person (optional for age preferences)
      {
        name: "requestee_id",
        type: "number",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: null,
          noDecimal: false
        }
      },
      // Target person name before resolution
      {
        name: "requested_person_name",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 200,
          pattern: ""
        }
      },
      // Type of request
      {
        name: "request_type",
        type: "select",
        system: false,
        required: true,
        unique: false,
        values: [
          "bunk_with",
          "not_bunk_with",
          "age_preference"
        ],
        maxSelect: 1
      },
      // Request status
      {
        name: "status",
        type: "select",
        system: false,
        required: true,
        unique: false,
        values: [
          "resolved",
          "pending",
          "declined"
        ],
        maxSelect: 1
      },
      // Camp year
      {
        name: "year",
        type: "number",
        system: false,
        required: true,
        unique: false,
        options: {
          min: 2000,
          max: 2100,
          noDecimal: true
        }
      },
      // Session ID
      {
        name: "session_id",
        type: "number",
        system: false,
        required: true,
        unique: false,
        options: {
          min: 0,
          max: null,
          noDecimal: true
        }
      },
      // Priority (1-10, higher is more important)
      {
        name: "priority",
        type: "number",
        system: false,
        required: false,
        unique: false,
        options: {
          min: 1,
          max: 10,
          noDecimal: true
        }
      },
      // Original request text
      {
        name: "original_text",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },
      // AI confidence score
      {
        name: "confidence_score",
        type: "number",
        system: false,
        required: false,
        unique: false,
        options: {
          min: 0,
          max: 1,
          noDecimal: false
        }
      },
      // Confidence level description
      {
        name: "confidence_level",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 50,
          pattern: ""
        }
      },
      // Detailed confidence explanation
      {
        name: "confidence_explanation",
        type: "json",
        system: false,
        required: false,
        unique: false,
        options: {
          maxSize: 2000000
        }
      },
      // Parsing notes
      {
        name: "parse_notes",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },
      // Manual resolution notes
      {
        name: "resolution_notes",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },
      // Is this a reciprocal request?
      {
        name: "is_reciprocal",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Source of the request
      {
        name: "source",
        type: "select",
        system: false,
        required: false,
        unique: false,
        values: [
          "family",
          "staff",
          "notes"
        ],
        maxSelect: 1
      },
      // Keywords found by AI
      {
        name: "keywords_found",
        type: "json",
        system: false,
        required: false,
        unique: false,
        options: {
          maxSize: 2000000
        }
      },
      // Phase 1 AI reasoning details
      {
        name: "ai_p1_reasoning",
        type: "json",
        system: false,
        required: false,
        unique: false,
        options: {
          maxSize: 2000000
        }
      },
      // Phase 3 AI reasoning details
      {
        name: "ai_p3_reasoning",
        type: "json",
        system: false,
        required: false,
        unique: false,
        options: {
          maxSize: 2000000
        }
      },
      // Was this parsed by AI?
      {
        name: "ai_parsed",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // CSV field this came from (required for unique constraint)
      {
        name: "source_field",
        type: "text",
        system: false,
        required: true,
        unique: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      // Position in the CSV field (1-based)
      {
        name: "csv_position",
        type: "number",
        system: false,
        required: false,
        unique: false,
        options: {
          min: 0,
          max: null,
          noDecimal: true
        }
      },
      // Additional source details
      {
        name: "source_detail",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 200,
          pattern: ""
        }
      },
      // Requires manual review flag
      {
        name: "requires_manual_review",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Reason for manual review
      {
        name: "manual_review_reason",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 200,
          pattern: ""
        }
      },
      // Additional metadata
      {
        name: "metadata",
        type: "json",
        system: false,
        required: false,
        unique: false,
        options: {
          maxSize: 2000000
        }
      },
      // For age preference requests - the target preference
      {
        name: "age_preference_target",
        type: "text",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: 50,
          pattern: ""
        }
      },
      // Conflict group ID for related requests
      {
        name: "conflict_group_id",
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
      // Requires family decision
      {
        name: "requires_family_decision",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Can be dropped for spread
      {
        name: "can_be_dropped",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Was dropped for spread
      {
        name: "was_dropped_for_spread",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Is this request active?
      {
        name: "is_active",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Is this a placeholder for unresolved names
      {
        name: "is_placeholder",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Request locked to prevent sync overwrites
      {
        name: "request_locked",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      // Array of all contributing source field names
      {
        name: "source_fields",
        type: "json",
        system: false,
        required: false,
        unique: false,
        options: {
          maxSize: 2000000
        }
      },
      // Self-reference for soft-delete merge tracking
      {
        name: "merged_into",
        type: "relation",
        system: false,
        required: false,
        collectionId: COLLECTION_ID_BUNK_REQUESTS,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
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
      "CREATE INDEX `idx_bunk_requests_requester` ON `bunk_requests` (`requester_id`)",
      "CREATE INDEX `idx_bunk_requests_requested` ON `bunk_requests` (`requestee_id`)",
      "CREATE INDEX idx_bunk_requests_year ON bunk_requests (year)",
      "CREATE INDEX idx_bunk_requests_session ON bunk_requests (session_id)",
      "CREATE INDEX idx_bunk_requests_status ON bunk_requests (status)",
      "CREATE INDEX idx_bunk_requests_type ON bunk_requests (request_type)",
      "CREATE INDEX idx_bunk_requests_source ON bunk_requests (source)",
      "CREATE INDEX idx_bunk_requests_priority ON bunk_requests (priority)",
      "CREATE INDEX idx_bunk_requests_year_session ON bunk_requests (year, session_id)",
      "CREATE INDEX `idx_bunk_requests_requester_year` ON `bunk_requests` (`requester_id`, `year`)",
      "CREATE UNIQUE INDEX `idx_bunk_requests_unique_with_source` ON `bunk_requests` (`requester_id`, `requestee_id`, `request_type`, `year`, `session_id`, `source_field`)",
      "CREATE INDEX idx_bunk_requests_merged_into ON bunk_requests (merged_into)"
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
  const collection = app.findCollectionByNameOrId("bunk_requests");
  return app.delete(collection);
});
