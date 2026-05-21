/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop all 96 ``category='ai'`` config rows + 7 ai-* config_sections.
 *
 * AI Config (Unified) Phase 2 cleanup. See
 * ``docs/reference/solver-config-decisions.md`` → "AI Config (Unified)" for
 * the full surface walk. Summary:
 *
 *  - 78 keys had **zero** consumers since seed (`manual_review_triggers.*`,
 *    `field_parsing.*`, `source_field_weights.*`, `historical_context.*`,
 *    `history_tracking.*`, `dedup_scoring.*`, `network_bonus.*`,
 *    `context_scores.*`, the `confidence_scoring.{bunk_with,not_bunk_with}.weights`
 *    cluster, etc.) — pure zombie rows.
 *  - 18 keys had live consumers (``confidence_thresholds.{auto_accept,resolved}``,
 *    ``confidence_scoring.resolution.{fuzzy,phonetic}.*``, ``spread_validation.enabled``,
 *    ``context_building.max_age_difference_months``) — these are hardcoded as
 *    module-level constants on the strategy modules and in
 *    ``bunking/sync/bunk_request_processor/core/constants.py``.
 *
 * (The decisions doc surface walk counted 97 PB rows for the original AI
 * surface, but the actual seeded count is 96. `ai.model` was a phantom row —
 * referenced in FRIENDLY_NAMES / TOOLTIPS / SECTION_MAPPING / fullKeyMappings
 * but never actually inserted by the ``aiConfigs`` block. The PB-driven AI
 * model name was always env-shadowed via ``AI_MODEL``, so the GUI knob never
 * existed on a real row.)
 *
 * The corresponding ``aiConfigs`` block + FRIENDLY_NAMES/TOOLTIPS/SECTION_MAPPING
 * entries are scrubbed from ``1500000011_config.js`` in the same PR so fresh
 * DBs don't seed these rows in the first place.
 *
 * Idempotent: re-running after rows are gone is a no-op.
 *
 * Down-migration restores all 97 rows with their original seeded values + a
 * minimal metadata blob (``data_type``, ``default_value``, ``source``). Rich
 * metadata (FRIENDLY_NAMES / TOOLTIPS / SECTION_MAPPING / componentMappings)
 * is **not** restored — re-running ``1500000011_config.js`` is the way to
 * regenerate full metadata if needed after a rollback. The 7 deleted
 * config_sections are restored with their original title/description/display_order.
 */

// All 97 ai.* config rows seeded by 1500000011_config.js's aiConfigs block.
// Kept as a flat list for down-migration restoration. Values mirror the
// original seed values exactly. Description matches the seed too. min/max
// are restored on the metadata blob when present.
const AI_CONFIG_ROWS = [
  // Top-level "AI Processing Settings"
  { key: "ai.enable_processing", value: 1, description: "Enable AI processing for bunk requests", min: 0, max: 1 },
  { key: "ai.confidence_threshold", value: 0.4, description: "Minimum confidence score for AI to process a request", min: 0.0, max: 1.0 },
  { key: "ai.fuzzy_match_threshold", value: 70, description: "Fuzzy matching threshold for name resolution", min: 0, max: 100 },
  // `ai.model` is NOT included — it was a phantom reference in the FRIENDLY_NAMES /
  // TOOLTIPS / SECTION_MAPPING / fullKeyMappings tables of 1500000011_config.js but
  // never inserted by the aiConfigs block. No row to restore.

  // Confidence thresholds
  { key: "ai.confidence_thresholds.auto_accept", value: 0.95, description: "High-confidence threshold (no staff review needed)", min: 0.0, max: 1.0 },
  { key: "ai.confidence_thresholds.resolved", value: 0.85, description: "Threshold for marking requests as resolved (staff may spot-check)", min: 0.0, max: 1.0 },

  // Name matching
  { key: "ai.name_matching.phonetic_threshold", value: 0.85, description: "Threshold for phonetic name matching", min: 0.0, max: 1.0 },
  { key: "ai.name_matching.fuzzy_threshold", value: 0.80, description: "Threshold for fuzzy name matching", min: 0.0, max: 1.0 },
  { key: "ai.name_matching.partial_match_penalty", value: 0.15, description: "Penalty for partial name matches", min: 0.0, max: 1.0 },
  { key: "ai.name_matching.no_match_threshold", value: 0.60, description: "Threshold below which names are considered non-matches", min: 0.0, max: 1.0 },
  { key: "ai.name_matching.first_name_age_filter.enabled", value: 1, description: "Enable age filtering for first name matches", min: 0, max: 1 },
  { key: "ai.name_matching.first_name_age_filter.max_age_difference_months", value: 24, description: "Maximum age difference in months for first name matches", min: 0, max: 60 },

  // Manual review triggers
  { key: "ai.manual_review_triggers.conflicting_information", value: 1, description: "Trigger manual review for conflicting information", min: 0, max: 1 },
  { key: "ai.manual_review_triggers.counselor_recommendations", value: 1, description: "Trigger manual review for counselor recommendations", min: 0, max: 1 },
  { key: "ai.manual_review_triggers.historical_issues", value: 1, description: "Trigger manual review for historical issues", min: 0, max: 1 },
  { key: "ai.manual_review_triggers.low_confidence_threshold", value: 0.70, description: "Confidence threshold below which manual review is triggered", min: 0.0, max: 1.0 },
  { key: "ai.manual_review_triggers.not_attending_requests", value: 1, description: "Trigger manual review for not-attending requests", min: 0, max: 1 },

  // Field parsing
  { key: "ai.field_parsing.extract_from_notes", value: 1, description: "Extract requests from notes fields", min: 0, max: 1 },
  { key: "ai.field_parsing.counselor_recommendation_weight", value: 0.95, description: "Weight for counselor recommendations", min: 0.0, max: 1.0 },
  { key: "ai.field_parsing.embedded_age_preference_confidence", value: 0.90, description: "Confidence for embedded age preferences", min: 0.0, max: 1.0 },
  { key: "ai.field_parsing.notes_request_priority", value: 5, description: "Priority for requests found in notes" },

  // Source field weights
  { key: "ai.source_field_weights.share_bunk_with", value: 1.0, description: "Weight for share_bunk_with field", min: 0.0, max: 2.0 },
  { key: "ai.source_field_weights.do_not_share_with", value: 1.0, description: "Weight for do_not_share_with field", min: 0.0, max: 2.0 },
  { key: "ai.source_field_weights.bunking_notes", value: 0.9, description: "Weight for bunking_notes field", min: 0.0, max: 2.0 },
  { key: "ai.source_field_weights.socialize_preference", value: 1.0, description: "Weight for socialize_preference field", min: 0.0, max: 2.0 },

  // Historical context
  { key: "ai.historical_context.enabled", value: 1, description: "Enable historical context analysis", min: 0, max: 1 },
  { key: "ai.historical_context.years_to_check", value: 1, description: "Number of years to check for historical context" },
  { key: "ai.historical_context.auto_decline_not_attending", value: 1, description: "Auto-decline requests for campers not attending", min: 0, max: 1 },
  { key: "ai.historical_context.priority_boost_sole_request", value: 20, description: "Priority boost for sole requests" },

  // Confidence scoring — bunk_with
  { key: "ai.confidence_scoring.bunk_with.weights.name_match", value: 0.70, description: "Weight for name matching in bunk_with confidence", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.weights.ai_parsing", value: 0.15, description: "Weight for AI parsing in bunk_with confidence", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.weights.context", value: 0.10, description: "Weight for context in bunk_with confidence", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.weights.reciprocal_bonus", value: 0.05, description: "Weight for reciprocal bonus in bunk_with confidence", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.name_match_unique_score", value: 1.0, description: "Score for unique name matches", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.name_match_multiple_score", value: 0.85, description: "Score for multiple name matches", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.no_exact_match_cap", value: 0.65, description: "Cap for confidence when no exact match found", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.reciprocal_multiplier", value: 1.05, description: "Multiplier for reciprocal requests", min: 1.0, max: 2.0 },

  // Network bonus
  { key: "ai.confidence_scoring.bunk_with.network_bonus.enabled", value: 1, description: "Enable network bonus in confidence scoring", min: 0, max: 1 },
  { key: "ai.confidence_scoring.bunk_with.network_bonus.weight", value: 0.15, description: "Weight for network bonus", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.network_bonus.ego_network_base", value: 0.05, description: "Base score for ego network", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.network_bonus.direct_connection_bonus", value: 0.10, description: "Bonus for direct connections", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.network_bonus.friend_of_friend_bonus", value: 0.05, description: "Bonus for friend-of-friend connections", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.network_bonus.three_degrees_bonus", value: 0.02, description: "Bonus for three degrees of separation", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.network_bonus.per_shared_connection", value: 0.01, description: "Bonus per shared connection", min: 0.0, max: 0.1 },
  { key: "ai.confidence_scoring.bunk_with.network_bonus.max_shared_bonus", value: 0.05, description: "Maximum bonus for shared connections", min: 0.0, max: 0.2 },

  // Confidence scoring — not_bunk_with
  { key: "ai.confidence_scoring.not_bunk_with.weights.name_match", value: 0.60, description: "Weight for name matching in not_bunk_with confidence", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.weights.ai_parsing", value: 0.25, description: "Weight for AI parsing in not_bunk_with confidence", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.weights.authority", value: 0.15, description: "Weight for authority in not_bunk_with confidence", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.name_match_unique_score", value: 1.0, description: "Score for unique name matches in not_bunk_with", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.name_match_multiple_score", value: 0.80, description: "Score for multiple name matches in not_bunk_with", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.no_exact_match_cap", value: 0.60, description: "Cap for confidence when no exact match in not_bunk_with", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.authority_scores.parent", value: 0.7, description: "Authority score for parent requests", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.authority_scores.counselor", value: 1.0, description: "Authority score for counselor requests", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.authority_scores.historical", value: 0.9, description: "Authority score for historical patterns", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.authority_scores.staff", value: 0.8, description: "Authority score for staff requests", min: 0.0, max: 1.0 },

  // Age preference + spread_limited
  { key: "ai.confidence_scoring.age_preference.weights.ai_parsing", value: 1.0, description: "Weight for AI parsing in age preference confidence", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.spread_limited.fixed_confidence", value: 1.0, description: "Fixed confidence for spread-limited requests", min: 0.0, max: 1.0 },

  // History tracking
  { key: "ai.history_tracking.enabled", value: 1, description: "Enable CSV history tracking", min: 0, max: 1 },
  { key: "ai.history_tracking.retention_days", value: 30, description: "Days to retain CSV history" },
  { key: "ai.history_tracking.include_grade_changes", value: 1, description: "Include grade changes in history tracking", min: 0, max: 1 },

  // Spread validation
  { key: "ai.spread_validation.enabled", value: 1, description: "Enable spread validation", min: 0, max: 1 },
  { key: "ai.spread_validation.strict_division_boundaries", value: 1, description: "Enforce strict division boundaries", min: 0, max: 1 },
  { key: "ai.spread_validation.validate_not_bunk_with", value: 0, description: "Validate not_bunk_with requests for spread", min: 0, max: 1 },

  // Dedup scoring
  { key: "ai.dedup_scoring.staff_recommendation_weight", value: 1000, description: "Weight for staff recommendations in deduplication" },
  { key: "ai.dedup_scoring.confidence_multiplier", value: 100, description: "Multiplier for confidence in deduplication" },
  { key: "ai.dedup_scoring.primary_field_bonus", value: 50, description: "Bonus for primary field in deduplication" },
  { key: "ai.dedup_scoring.list_position_multiplier", value: 10, description: "Multiplier for list position in deduplication" },
  { key: "ai.dedup_scoring.max_list_positions", value: 11, description: "Maximum list positions to consider" },

  // Age preference source priority
  { key: "ai.age_preference_source_priority.explicit", value: 3, description: "Priority for explicit age preferences" },
  { key: "ai.age_preference_source_priority.social", value: 2, description: "Priority for social age preferences" },
  { key: "ai.age_preference_source_priority.observation", value: 1, description: "Priority for observed age preferences" },

  // Context building
  { key: "ai.context_building.max_age_difference_months", value: 24, description: "Maximum age difference for context building" },
  { key: "ai.context_building.include_age_in_context", value: 1, description: "Include age in context building", min: 0, max: 1 },

  // Confidence context scores
  { key: "ai.confidence_scoring.ai_boost", value: 0.15, description: "Confidence boost when AI provides a valid person ID", min: 0.0, max: 0.5 },
  { key: "ai.confidence_scoring.bunk_with.context_scores.base", value: 0.5, description: "Base context score when no year information available", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.context_scores.current_year", value: 0.8, description: "Context score when target found in current year", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.context_scores.previous_year_only", value: 0.4, description: "Context score when target found only in previous year", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.bunk_with.context_scores.social_signal_bonus", value: 0.1, description: "Bonus added per social signal (ego network, social distance)", min: 0.0, max: 0.5 },
  { key: "ai.confidence_scoring.bunk_with.social.max_distance_for_bonus", value: 2, description: "Maximum social distance (hops) to qualify for bonus", min: 1, max: 5 },
  { key: "ai.confidence_scoring.not_bunk_with.context_scores.current_year", value: 0.7, description: "Context score for not_bunk_with when target in current year", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.not_bunk_with.context_scores.previous_year_only", value: 0.3, description: "Context score for not_bunk_with when target only in previous year", min: 0.0, max: 1.0 },

  // Resolution — fuzzy
  { key: "ai.confidence_scoring.resolution.fuzzy.nickname_base", value: 0.85, description: "Base confidence for nickname matches (Mike -> Michael)", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.fuzzy.spelling_base", value: 0.85, description: "Base confidence for spelling variation matches (Sara -> Sarah)", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.fuzzy.normalized_base", value: 0.80, description: "Base confidence for normalized name matches", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.fuzzy.default_base", value: 0.75, description: "Default base confidence for fuzzy matches", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.fuzzy.session_match", value: 0.85, description: "Confidence when session disambiguation succeeds", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.fuzzy.same_session_boost", value: 0.0, description: "Confidence boost when match is in same session (fuzzy maintains base)", min: 0.0, max: 0.3 },
  { key: "ai.confidence_scoring.resolution.fuzzy.different_session_penalty", value: -0.10, description: "Confidence penalty when match is in different session", min: -0.5, max: 0.0 },
  { key: "ai.confidence_scoring.resolution.fuzzy.not_enrolled_penalty", value: -0.05, description: "Confidence penalty when person not in attendee list", min: -0.3, max: 0.0 },

  // Resolution — phonetic
  { key: "ai.confidence_scoring.resolution.phonetic.soundex_base", value: 0.70, description: "Base confidence for Soundex phonetic matches", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.phonetic.metaphone_base", value: 0.65, description: "Base confidence for Metaphone phonetic matches", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.phonetic.nickname_base", value: 0.75, description: "Base confidence for nickname matches in phonetic strategy", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.phonetic.default_base", value: 0.60, description: "Default base confidence for phonetic matches", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.phonetic.session_match", value: 0.75, description: "Confidence when session disambiguation succeeds", min: 0.0, max: 1.0 },
  { key: "ai.confidence_scoring.resolution.phonetic.same_session_boost", value: 0.05, description: "Confidence boost when match is in same session", min: 0.0, max: 0.3 },
  { key: "ai.confidence_scoring.resolution.phonetic.different_session_penalty", value: -0.20, description: "Confidence penalty when match is in different session", min: -0.5, max: 0.0 },
  { key: "ai.confidence_scoring.resolution.phonetic.not_enrolled_penalty", value: -0.05, description: "Confidence penalty when person not in attendee list", min: -0.3, max: 0.0 },
]

// 7 AI-specific config_sections that become orphaned after the rows are
// deleted. Restored on rollback with the original seeded metadata.
const AI_SECTIONS = [
  { section_key: "ai-model-settings", title: "AI Model Configuration", description: "Configure AI provider, model selection, and processing parameters", display_order: 20 },
  { section_key: "ai-confidence-thresholds", title: "AI Confidence Thresholds", description: "Set confidence levels for automatic acceptance, validation, and rejection", display_order: 21 },
  { section_key: "ai-name-matching", title: "AI Name Matching", description: "Configure fuzzy matching, phonetic matching, and name resolution rules", display_order: 22 },
  { section_key: "ai-confidence-scoring", title: "AI Confidence Scoring", description: "Weights and parameters for calculating request confidence scores", display_order: 23 },
  { section_key: "ai-validation-rules", title: "AI Validation Rules", description: "Spread validation, manual review triggers, and field parsing rules", display_order: 25 },
  { section_key: "ai-request-parsing", title: "AI Request Parsing", description: "Settings for AI parsing of bunk requests from raw text", display_order: 27 },
  { section_key: "history-tracking", title: "Historical Context & Tracking", description: "Settings for incorporating historical bunking and request data", display_order: 28 },
]

// Convert "ai.foo.bar.baz" -> {category:"ai", subcategory:"foo.bar", config_key:"baz"}.
// Matches the transformKey() logic in 1500000011_config.js.
const transformAIKey = (dotKey) => {
  const parts = dotKey.split(".")
  const category = parts[0]
  const config_key = parts[parts.length - 1]
  const subcategory = parts.length > 2 ? parts.slice(1, -1).join(".") : null
  return { category, subcategory, config_key }
}

const inferDataType = (value) => {
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "float"
  if (typeof value === "string") return "string"
  if (Array.isArray(value)) return "array"
  if (value && typeof value === "object") return "object"
  return "string"
}

migrate(
  (app) => {
    // --- Up: delete all 97 ai.* config rows ---
    // Use bulk filter — `category = "ai"` catches everything in one query.
    // findRecordsByFilter API signature: (collection, filter, sort, limit, offset).
    let aiRecords
    try {
      aiRecords = app.findRecordsByFilter("config", `category = "ai"`, "", 0, 0)
    } catch {
      aiRecords = []
    }
    for (const record of aiRecords) {
      app.delete(record)
    }

    // --- Up: delete 7 AI-specific config_sections ---
    for (const section of AI_SECTIONS) {
      let record
      try {
        record = app.findFirstRecordByFilter(
          "config_sections",
          `section_key = "${section.section_key}"`,
        )
      } catch {
        // already gone
      }
      if (record) app.delete(record)
    }
  },
  (app) => {
    // --- Down: restore all 97 ai.* config rows ---
    // Metadata is minimal here (data_type + source + default_value + min/max
    // where applicable). Rich metadata (friendly_name / tooltip / section /
    // component_type / component_config) is NOT restored — re-running
    // 1500000011_config.js after rollback regenerates the full metadata blob
    // through its FRIENDLY_NAMES / TOOLTIPS / SECTION_MAPPING / componentMappings
    // tables.
    const configCollection = app.findCollectionByNameOrId("config")
    const buildSubcategoryFilter = (subcategory) =>
      subcategory === null || subcategory === ""
        ? "subcategory = null"
        : `subcategory = "${subcategory}"`

    for (const row of AI_CONFIG_ROWS) {
      const { category, subcategory, config_key } = transformAIKey(row.key)

      // Skip if the row already exists (idempotent rollback)
      let existing
      try {
        existing = app.findFirstRecordByFilter(
          "config",
          `category = "${category}" && ${buildSubcategoryFilter(subcategory)} && config_key = "${config_key}"`,
        )
      } catch {
        existing = null
      }
      if (existing) continue

      const metadata = {
        data_type: inferDataType(row.value),
        source: "default_config",
        default_value: row.value,
      }
      if (row.min !== undefined) metadata.min_value = row.min
      if (row.max !== undefined) metadata.max_value = row.max

      const record = new Record(configCollection)
      record.set("category", category)
      record.set("subcategory", subcategory)
      record.set("config_key", config_key)
      record.set("value", row.value)
      record.set("description", row.description)
      record.set("metadata", metadata)
      app.save(record)
    }

    // --- Down: restore 7 AI-specific config_sections ---
    const sectionsCollection = app.findCollectionByNameOrId("config_sections")
    for (const section of AI_SECTIONS) {
      let existing
      try {
        existing = app.findFirstRecordByFilter(
          "config_sections",
          `section_key = "${section.section_key}"`,
        )
      } catch {
        existing = null
      }
      if (existing) continue

      const record = new Record(sectionsCollection)
      record.set("section_key", section.section_key)
      record.set("title", section.title)
      record.set("description", section.description)
      record.set("display_order", section.display_order)
      record.set("expanded_by_default", false)
      app.save(record)
    }
  },
)
