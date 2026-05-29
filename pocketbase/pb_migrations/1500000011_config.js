/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create config collection
 * Dependencies: None
 *
 * Creates the config collection for storing application configuration values
 * and populates it with default configuration entries.
 */

migrate((app) => {
  // Create config collection
  const collection = new Collection({
    id: "col_config",
    name: "config",
    type: "base",
    fields: [
      {
        name: "category",
        type: "text",
        required: true,
        presentable: false
      },
      {
        name: "subcategory",
        type: "text",
        required: false,
        presentable: false
      },
      {
        name: "config_key",
        type: "text",
        required: true,
        presentable: true
      },
      {
        name: "value",
        type: "json",
        required: true,
        presentable: false
      },
      {
        name: "metadata",
        type: "json",
        required: false,
        presentable: false
      },
      {
        name: "description",
        type: "text",
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
      "CREATE UNIQUE INDEX idx_config_unique_key ON config (category, COALESCE(subcategory, ''), config_key)",
      "CREATE INDEX idx_config_category ON config (category)"
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "registration.manage"',
    updateRule: '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "registration.manage"',
    deleteRule: '@request.auth.is_admin = true'
  });

  app.save(collection);

  // ============================================================
  // Populate config table with default values
  // ============================================================

  // Helper to determine data type from value
  const inferDataType = (value) => {
    if (value === null || value === undefined) return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'float';
    }
    if (typeof value === 'object') return 'json';
    return 'string';
  };

  // Transform dot-notation key to category/subcategory/key structure
  const transformKey = (dotKey) => {
    const parts = dotKey.split('.');
    if (parts.length === 1) {
      return { category: 'general', subcategory: null, key: parts[0] };
    } else if (parts.length === 2) {
      return { category: parts[0], subcategory: null, key: parts[1] };
    } else if (parts.length === 3) {
      return { category: parts[0], subcategory: parts[1], key: parts[2] };
    } else {
      // For longer paths, first is category, last is key, middle parts become subcategory
      return {
        category: parts[0],
        subcategory: parts.slice(1, -1).join('_'),
        key: parts[parts.length - 1]
      };
    }
  };

  // Determine business_category for UI grouping
  const getBusinessCategory = (category, subcategory) => {
    // Solver configs
    if (['constraint', 'objective', 'soft', 'solver'].includes(category)) {
      return 'solver';
    }
    // History configs (specific ai subcategories)
    if (category === 'ai' && subcategory &&
        (subcategory.startsWith('historical_context') || subcategory.startsWith('history_tracking'))) {
      return 'history';
    }
    // Processing configs (ai, smart_local_resolution, spread)
    if (['ai', 'smart_local_resolution', 'spread'].includes(category)) {
      return 'processing';
    }
    // General/UI configs
    if (['tour'].includes(category)) {
      return 'general';
    }
    // Default
    return 'processing';
  };

  // Friendly names for all config values
  const FRIENDLY_NAMES = {
    // Constraint Settings - Core (must_satisfy_one uses soft constraint with configurable penalty)
    'constraint.must_satisfy_one.enabled': 'Require One Request Satisfied',
    'constraint.must_satisfy_one.fallback_to_age': 'Use Age Preference as Fallback',
    'constraint.must_satisfy_one.ignore_impossible_requests': 'Ignore Out-of-Session Requests',
    'constraint.must_satisfy_one.penalty': 'Request Satisfaction Penalty',

    // Constraint Settings - Cabin Capacity removed in Phase 2 cleanup
    // (collapsed to bunking/solver/constants.py).

    // Constraint Settings - Age & Grade (unified spread limits)
    // spread.max_grade + constraint.grade_spread.{mode, penalty} removed in
    // Phase 2 cleanup (collapsed to MAX_UNIQUE_GRADES_PER_BUNK).
    // spread.max_age_months + constraint.age_spread.{penalty, preferred_months}
    // removed in Age Spread Phase 2 (collapsed to MAX_AGE_SPREAD_MONTHS and
    // PREFERRED_AGE_SPREAD_MONTHS). Only the bonus knob remains.
    'constraint.age_spread.preferred_bonus': 'Preferred Age Spread Bonus',
    // grade_ratio.{max_percentage, penalty} removed in Phase 2 — hardcoded as
    // MAX_SINGLE_GRADE_PERCENTAGE / GRADE_RATIO_PENALTY in bunking/solver/constants.py.

    // Constraint Settings - Cabin Minimum Occupancy (Phase 2: min/preferred/
    // enabled/force_all_used collapsed to constants in bunking/solver/constants.py)
    'constraint.cabin_minimum_occupancy.penalty': 'Under-Occupancy Penalty',

    // Constraint Settings - Level Progression
    'constraint.level_progression.no_regression': 'Prevent Level Regression',
    'constraint.level_progression.no_regression_penalty': 'Regression Penalty',

    // Flow & Cohesion removed in Phase 2 — age_grade_flow.weight hardcoded as
    // AGE_GRADE_FLOW_WEIGHT; grade_cohesion.weight deleted (orphan, no consumer).

    // Objective Settings - Source Multipliers
    'objective.source_multipliers.share_bunk_with': 'Parent Request Importance',
    'objective.source_multipliers.do_not_share_with': 'Safety Concern Importance',
    'objective.source_multipliers.bunking_notes': 'Bunking Notes Importance',
    'objective.source_multipliers.internal_notes': 'Internal Notes Importance',
    'objective.source_multipliers.socialize_preference': 'Socialize Preference Importance',

    // Objective Settings - Diminishing Returns
    'objective.enable_diminishing_returns': 'Enable Diminishing Returns',
    'objective.first_request_multiplier': 'First Request Multiplier',
    'objective.second_request_multiplier': 'Second Request Multiplier',
    'objective.third_plus_request_multiplier': 'Third+ Request Multiplier',

    // Solver Settings - Core (execution_mode removed, num_workers moved to .env)
    'solver.auto_apply_enabled': 'Auto-Apply Results',
    'solver.auto_apply_timeout': 'Auto-Apply Delay (seconds)',

    // Smart Local Resolution (NetworkX)
    'smart_local_resolution.enabled': 'Enable Smart Name Resolution',
    'smart_local_resolution.significant_connection_threshold': 'Significant Connection Threshold',
    'smart_local_resolution.min_connections_for_auto_resolve': 'Min Connections for Auto-Resolution',
    'smart_local_resolution.connection_score_weight': 'Connection Score Weight',
    'smart_local_resolution.min_confidence_for_auto_resolve': 'Min Confidence for Auto-Resolution',
    'smart_local_resolution.mutual_request_bonus': 'Mutual Request Bonus',
    'smart_local_resolution.common_friends_weight': 'Common Friends Weight',
    'smart_local_resolution.historical_bunking_weight': 'Historical Bunking Weight',

    // AI Processing Settings — friendly names removed in the AI Config (Unified)
    // Phase 2 cleanup. All `ai.*` PB rows were deleted; the four labelled
    // top-level rows (enable_processing, confidence_threshold,
    // fuzzy_match_threshold, model) had no consumers (model was env-shadowed).
  };

  // Tooltips for all config values
  const TOOLTIPS = {
    // Constraint Settings - Core (must_satisfy_one uses soft constraint with penalty)
    'constraint.must_satisfy_one.enabled': 'Whether every camper must have at least one bunk request satisfied',
    'constraint.must_satisfy_one.fallback_to_age': 'If no specific requests, count age preference as satisfying the requirement',
    'constraint.must_satisfy_one.ignore_impossible_requests': 'Ignore requests for campers not attending the same session',
    'constraint.must_satisfy_one.penalty': 'How heavily the optimizer penalizes leaving a camper without any requests fulfilled. Higher = tries harder to satisfy everyone.',

    // Constraint Settings - Cabin Capacity removed in Phase 2 cleanup.

    // Constraint Settings - Age & Grade (unified spread limits)
    // spread.max_grade + constraint.grade_spread.{mode, penalty} removed in
    // Phase 2 cleanup (collapsed to MAX_UNIQUE_GRADES_PER_BUNK).
    // spread.max_age_months + constraint.age_spread.{penalty, preferred_months}
    // removed in Age Spread Phase 2 (collapsed to MAX_AGE_SPREAD_MONTHS and
    // PREFERRED_AGE_SPREAD_MONTHS).
    'constraint.age_spread.preferred_bonus': 'Objective bonus for each cabin within the preferred age spread. Higher = solver tries harder to form tight age groups.',
    // grade_ratio.{max_percentage, penalty} removed in Phase 2 (hardcoded constants).

    // Constraint Settings - Cabin Minimum Occupancy (Phase 2: only the
    // penalty weight is tunable; thresholds are constants in code)
    'constraint.cabin_minimum_occupancy.penalty': 'Penalty weight for each spot below preferred occupancy (10)',

    // Constraint Settings - Level Progression
    'constraint.level_progression.no_regression': 'Prevent returning campers from being placed in lower level bunks than previous year',
    'constraint.level_progression.no_regression_penalty': 'Penalty weight for placing camper in lower level than previous year',

    // Flow & Cohesion removed in Phase 2 (age_grade_flow hardcoded; grade_cohesion deleted).

    // Objective Settings - Source Multipliers
    'objective.source_multipliers.share_bunk_with': 'Weight multiplier for parent bunk requests (higher = more important)',
    'objective.source_multipliers.do_not_share_with': 'Weight multiplier for safety/separation requests (higher = more important)',
    'objective.source_multipliers.bunking_notes': 'Weight multiplier for bunking notes from registration (higher = more important)',
    'objective.source_multipliers.internal_notes': 'Weight multiplier for internal staff notes (higher = more important)',
    'objective.source_multipliers.socialize_preference': 'Weight multiplier for socialization preferences (higher = more important)',

    // Objective Settings - Diminishing Returns
    'objective.enable_diminishing_returns': 'Reduce weight for multiple satisfied requests from same camper (prevents gaming)',
    'objective.first_request_multiplier': 'Weight multiplier for first satisfied request',
    'objective.second_request_multiplier': 'Weight multiplier for second satisfied request',
    'objective.third_plus_request_multiplier': 'Weight multiplier for third and subsequent satisfied requests',

    // Solver Settings - Core (execution_mode removed, num_workers moved to SOLVER_NUM_WORKERS env var)
    'solver.auto_apply_enabled': 'Automatically apply solver results without confirmation prompt',
    'solver.auto_apply_timeout': 'Seconds to wait before auto-applying results (0 = immediate)',

    // Smart Local Resolution (NetworkX)
    'smart_local_resolution.enabled': 'Use social graph analysis for ambiguous name resolution',
    'smart_local_resolution.significant_connection_threshold': 'Minimum connections to consider a relationship significant',
    'smart_local_resolution.min_connections_for_auto_resolve': 'Minimum social connections required for automatic name resolution',
    'smart_local_resolution.connection_score_weight': 'Weight given to social connection scores (0.0-1.0)',
    'smart_local_resolution.min_confidence_for_auto_resolve': 'Minimum confidence score to automatically resolve ambiguous names',
    'smart_local_resolution.mutual_request_bonus': 'Bonus points when both campers request each other',
    'smart_local_resolution.common_friends_weight': 'Weight multiplier for common friends in social scoring',
    'smart_local_resolution.historical_bunking_weight': 'Weight for historical bunking patterns in scoring',

    // AI Processing Settings — tooltips removed in the AI Config (Unified)
    // Phase 2 cleanup (rows deleted; drop migration: 1500000109_drop_ai_configs.js).
  };

  // Section mapping for each config
  const SECTION_MAPPING = {
    // Core Constraints (must_satisfy_one uses soft constraint with penalty)
    'constraint.must_satisfy_one.enabled': 'core-constraints',
    'constraint.must_satisfy_one.fallback_to_age': 'core-constraints',
    'constraint.must_satisfy_one.ignore_impossible_requests': 'core-constraints',
    'constraint.must_satisfy_one.penalty': 'core-constraints',

    // Cabin Capacity section removed in Phase 2 cleanup (constants in
    // bunking/solver/constants.py instead).

    // Age & Grade (unified spread limits)
    // spread.max_grade + constraint.grade_spread.{mode, penalty} removed in
    // Phase 2 cleanup (collapsed to MAX_UNIQUE_GRADES_PER_BUNK).
    // spread.max_age_months + constraint.age_spread.{penalty, preferred_months}
    // removed in Age Spread Phase 2.
    'constraint.age_spread.preferred_bonus': 'age-grade',
    // grade_ratio.{max_percentage, penalty} removed in Phase 2 (hardcoded constants).
    // Cabin Minimum Occupancy
    'constraint.cabin_minimum_occupancy.penalty': 'cabin-occupancy',

    // Level Progression
    'constraint.level_progression.no_regression': 'level-progression',
    'constraint.level_progression.no_regression_penalty': 'level-progression',

    // Flow & Cohesion section removed in Phase 2 — age_grade_flow hardcoded,
    // grade_cohesion deleted (orphan). The flow-cohesion section is dropped.

    // Request Weighting
    'objective.source_multipliers.share_bunk_with': 'request-weighting',
    'objective.source_multipliers.do_not_share_with': 'request-weighting',
    'objective.source_multipliers.bunking_notes': 'request-weighting',
    'objective.source_multipliers.internal_notes': 'request-weighting',
    'objective.source_multipliers.socialize_preference': 'request-weighting',
    'objective.enable_diminishing_returns': 'request-weighting',
    'objective.first_request_multiplier': 'request-weighting',
    'objective.second_request_multiplier': 'request-weighting',
    'objective.third_plus_request_multiplier': 'request-weighting',

    // Solver Execution (execution_mode removed, num_workers moved to .env)
    'solver.auto_apply_enabled': 'solver-execution',
    'solver.auto_apply_timeout': 'solver-execution',

    // Smart Resolution
    'smart_local_resolution.enabled': 'smart-resolution',
    'smart_local_resolution.significant_connection_threshold': 'smart-resolution',
    'smart_local_resolution.min_connections_for_auto_resolve': 'smart-resolution',
    'smart_local_resolution.connection_score_weight': 'smart-resolution',
    'smart_local_resolution.min_confidence_for_auto_resolve': 'smart-resolution',
    'smart_local_resolution.mutual_request_bonus': 'smart-resolution',
    'smart_local_resolution.common_friends_weight': 'smart-resolution',
    'smart_local_resolution.historical_bunking_weight': 'smart-resolution',

    // All `ai.*` SECTION_MAPPING entries (~72 keys) removed in the AI Config
    // (Unified) Phase 2 cleanup along with the underlying PB rows. The 7
    // AI sections (`ai-model-settings`, `ai-confidence-thresholds`,
    // `ai-name-matching`, `ai-confidence-scoring`, `ai-validation-rules`,
    // `ai-request-parsing`, `history-tracking`) are dropped from the
    // `config_sections` collection by the same drop migration
    // (1500000109_drop_ai_configs.js).

  };

  // Map of config patterns to component types
  const componentMappings = {
    // Weights/multipliers (0-10 sliders with decimals)
    weight: {
      component_type: "slider",
      component_config: {
        min: 0,
        max: 10,
        step: 0.1,
        showValue: true,
        precision: 1
      }
    },
    multiplier: {
      component_type: "slider",
      component_config: {
        min: 0.1,
        max: 5.0,
        step: 0.1,
        showValue: true,
        precision: 1,
        suffix: "x"
      }
    },
    // Penalties (0-100 or 0-10000 sliders)
    penalty: {
      component_type: "slider",
      component_config: {
        min: 0,
        max: 10000,
        step: 100,
        showValue: true
      }
    },
    // Enable/disable toggles
    enable: {
      component_type: "toggle",
      component_config: {
        onLabel: "Enabled",
        offLabel: "Disabled"
      }
    },
    enabled: {
      component_type: "toggle",
      component_config: {
        onLabel: "Enabled",
        offLabel: "Disabled"
      }
    },
    // Capacity (integer input)
    capacity: {
      component_type: "number",
      component_config: {
        min: 1,
        max: 20,
        step: 1
      }
    },
    // Age/grade differences (integer inputs)
    max_age_difference: {
      component_type: "number",
      component_config: {
        min: 0,
        max: 60,
        step: 1,
        suffix: " months"
      }
    },
    max_grade_difference: {
      component_type: "number",
      component_config: {
        min: 0,
        max: 5,
        step: 1,
        suffix: " grades"
      }
    },
    // Percentages and thresholds
    percentage: {
      component_type: "slider",
      component_config: {
        min: 0,
        max: 100,
        step: 1,
        showValue: true,
        suffix: "%"
      }
    },
    threshold: {
      component_type: "slider",
      component_config: {
        min: 0,
        max: 100,
        step: 1,
        showValue: true,
        suffix: "%"
      }
    },
    // Timeouts (in seconds)
    timeout: {
      component_type: "number",
      component_config: {
        min: 1,
        max: 300,
        step: 1,
        suffix: " seconds"
      }
    },
    // Log level dropdown
    log_level: {
      component_type: "select",
      component_config: {
        options: [
          { value: "DEBUG", label: "DEBUG" },
          { value: "INFO", label: "INFO" },
          { value: "WARNING", label: "WARNING" },
          { value: "ERROR", label: "ERROR" }
        ]
      }
    },
    // Mode dropdowns
    mode: {
      component_type: "select",
      component_config: {
        options: [
          { value: "hard", label: "Hard Constraint" },
          { value: "soft", label: "Soft Constraint" }
        ]
      }
    },
    // AI model (text input with placeholder)
    model: {
      component_type: "text",
      component_config: {
        placeholder: "e.g., gpt-4o-mini"
      }
    }
  };

  // Special case mappings by full key
  const fullKeyMappings = {
    // `ai.model` mapping removed in the AI Config (Unified) Phase 2 cleanup.
    "constraint.cabin_minimum_occupancy.penalty": {
      component_type: "number",
      component_config: { min: 0, max: 10000, step: 100 }
    },
    "constraint.age_spread.preferred_bonus": {
      component_type: "slider",
      component_config: { min: 0, max: 10000, step: 100, showValue: true }
    }
  };

  // Helper function to determine component data for a config
  const getComponentData = (dotKey, key, value, metadata) => {
    // Check full key mappings first
    if (fullKeyMappings[dotKey]) {
      return fullKeyMappings[dotKey];
    }

    // Check if key contains patterns
    for (const [pattern, data] of Object.entries(componentMappings)) {
      if (key.includes(pattern)) {
        // Adjust for specific cases
        if (pattern === "penalty" && metadata.max_value && metadata.max_value <= 100) {
          return {
            ...data,
            component_config: {
              ...data.component_config,
              max: metadata.max_value,
              step: 1
            }
          };
        } else if (pattern === "multiplier" && metadata.max_value) {
          return {
            ...data,
            component_config: {
              ...data.component_config,
              max: metadata.max_value
            }
          };
        }
        return data;
      }
    }

    // Default to appropriate type based on value type
    if (typeof value === "boolean" || value === 0 || value === 1) {
      return {
        component_type: "toggle",
        component_config: {}
      };
    } else if (typeof value === "number") {
      // Check if it has min/max from existing metadata
      if (metadata.min_value !== undefined || metadata.max_value !== undefined) {
        return {
          component_type: "slider",
          component_config: {
            min: metadata.min_value || 0,
            max: metadata.max_value || 100,
            step: Number.isInteger(value) ? 1 : 0.1,
            showValue: true
          }
        };
      } else {
        return {
          component_type: "number",
          component_config: {
            step: Number.isInteger(value) ? 1 : 0.1
          }
        };
      }
    } else {
      return {
        component_type: "text",
        component_config: {}
      };
    }
  };

  // Configuration definitions with metadata
  const configDefinitions = {
    // Constraint configurations
    // constraint.grade_ratio.{max_percentage, penalty} removed in Phase 2 —
    // hardcoded as MAX_SINGLE_GRADE_PERCENTAGE (67) / GRADE_RATIO_PENALTY (5000)
    // in bunking/solver/constants.py. Neither was ever tuned at runtime.

    // Cabin minimum occupancy (Phase 2: only the penalty weight is tunable;
    // hard floor and preferred target are constants in bunking/solver/constants.py)
    "constraint.cabin_minimum_occupancy.penalty": {
      value: 2000,
      description: "Penalty weight for each spot below preferred occupancy",
      min: 0,
      max: 10000
    },

    // Unified spread limits (used by both solver and request processor).
    // spread.max_grade removed in Phase 2 cleanup (collapsed to
    // MAX_UNIQUE_GRADES_PER_BUNK constant in bunking/solver/constants.py).
    // spread.max_age_months + constraint.age_spread.{penalty, preferred_months}
    // removed in Age Spread Phase 2 (collapsed to MAX_AGE_SPREAD_MONTHS and
    // PREFERRED_AGE_SPREAD_MONTHS constants). Only the bonus weight remains
    // tunable.
    "constraint.age_spread.preferred_bonus": {
      value: 500,
      description: "Bonus weight for cabins whose age spread is within the preferred threshold",
      min: 0,
      max: 10000
    },
    "constraint.must_satisfy_one.enabled": {
      value: 1,
      description: "Whether every camper must have at least one request satisfied",
      min: 0,
      max: 1
    },
    "constraint.must_satisfy_one.fallback_to_age": {
      value: 1,
      description: "Fall back to age preference if no other requests",
      min: 0,
      max: 1
    },
    "constraint.must_satisfy_one.ignore_impossible_requests": {
      value: 1,
      description: "Ignore requests for people not in the session (prevents solver failure)",
      min: 0,
      max: 1
    },
    "constraint.must_satisfy_one.penalty": {
      value: 100000,
      description: "Penalty for leaving a camper with no requests satisfied (higher = optimizer tries harder)",
      min: 0,
      max: 500000
    },
    "constraint.level_progression.no_regression": {
      value: 1,
      description: "Prevent campers from moving to lower level bunks"
    },
    "constraint.level_progression.no_regression_penalty": {
      value: 800,
      description: "Penalty for campers regressing to lower levels",
      min: 0,
      max: 10000
    },
    // constraint.age_grade_flow.weight removed in Phase 2 — hardcoded as
    // AGE_GRADE_FLOW_WEIGHT (300). constraint.grade_cohesion.weight was a
    // confirmed orphan (no consumer ever existed) and was deleted outright.
    // constraint.grade_spread.{mode, penalty} removed in Phase 2 cleanup.
    // Solver enforces MAX_UNIQUE_GRADES_PER_BUNK as a hard constraint; no
    // soft-mode toggle and no penalty knob.

    // Objective configurations
    "objective.source_multipliers.share_bunk_with": {
      value: 1.75,
      description: "How much weight to give parent bunk requests",
      min: 0.5,
      max: 3
    },
    "objective.source_multipliers.do_not_share_with": {
      value: 1.5,
      description: "How much weight to give safety/separation requests",
      min: 0.5,
      max: 3
    },
    "objective.source_multipliers.bunking_notes": {
      value: 1.0,
      description: "How much weight to give bunking notes",
      min: 0.5,
      max: 3
    },
    "objective.source_multipliers.internal_notes": {
      value: 1.0,
      description: "How much weight to give internal staff notes",
      min: 0.5,
      max: 3
    },
    "objective.source_multipliers.socialize_preference": {
      value: 0.6,
      description: "How much weight to give socialization preferences",
      min: 0.5,
      max: 3
    },
    "objective.enable_diminishing_returns": {
      value: 1,
      description: "Enable diminishing returns for multiple satisfied requests",
      min: 0,
      max: 1
    },
    "objective.first_request_multiplier": {
      value: 10,
      description: "Multiplier for first satisfied request",
      min: 1,
      max: 10
    },
    "objective.second_request_multiplier": {
      value: 5,
      description: "Multiplier for second satisfied request",
      min: 1,
      max: 10
    },
    "objective.third_plus_request_multiplier": {
      value: 1,
      description: "Multiplier for third and subsequent satisfied requests",
      min: 1,
      max: 10
    },

    // Solver configurations (execution_mode removed, num_workers moved to SOLVER_NUM_WORKERS env var)
    "solver.auto_apply_enabled": {
      value: 1,
      description: "Automatically apply solver results without confirmation prompt",
      min: 0,
      max: 1
    },
    "solver.auto_apply_timeout": {
      value: 0,
      description: "Delay in seconds before auto-applying results (0 = immediate)",
      min: 0,
      max: 30
    },
    // Smart Local Resolution (NetworkX) configurations
    "smart_local_resolution.enabled": {
      value: 1,
      description: "Enable smart name resolution using social graph analysis",
      min: 0,
      max: 1
    },
    "smart_local_resolution.significant_connection_threshold": {
      value: 5,
      description: "Minimum connections to consider a relationship significant",
      min: 1,
      max: 20
    },
    "smart_local_resolution.min_connections_for_auto_resolve": {
      value: 3,
      description: "Minimum social connections required for automatic name resolution",
      min: 1,
      max: 10
    },
    "smart_local_resolution.connection_score_weight": {
      value: 0.7,
      description: "Weight given to social connection scores (0.0-1.0)",
      min: 0.0,
      max: 1.0
    },
    "smart_local_resolution.min_confidence_for_auto_resolve": {
      value: 0.85,
      description: "Minimum confidence score to automatically resolve ambiguous names",
      min: 0.5,
      max: 1.0
    },
    "smart_local_resolution.mutual_request_bonus": {
      value: 10,
      description: "Bonus points when both campers request each other",
      min: 0,
      max: 50
    },
    "smart_local_resolution.common_friends_weight": {
      value: 1.0,
      description: "Weight multiplier for common friends in social scoring",
      min: 0.0,
      max: 2.0
    },
    "smart_local_resolution.historical_bunking_weight": {
      value: 0.8,
      description: "Weight for historical bunking patterns in scoring",
      min: 0.0,
      max: 2.0
    },

  };


  // Insert each configuration
  Object.entries(configDefinitions).forEach(([dotKey, config]) => {
    const { category, subcategory, key } = transformKey(dotKey);

    // Check if this config already exists
    let existing = null;
    try {
      existing = app.findFirstRecordByFilter(
        "config",
        `category = "${category}" && config_key = "${key}"` +
        (subcategory ? ` && subcategory = "${subcategory}"` : ` && subcategory = null`)
      );
    } catch (_e) {
      // Record doesn't exist, which is expected for new configs
      // findFirstRecordByFilter throws "sql: no rows in result set" when no record found
    }

    // Build metadata for this config
    const metadata = {
      data_type: inferDataType(config.value),
      source: 'default_config',
      default_value: config.value
    };

    // Add min/max if they exist
    if (config.min !== undefined) {
      metadata.min_value = config.min;
    }
    if (config.max !== undefined) {
      metadata.max_value = config.max;
    }

    // Add friendly name, tooltip, and section from lookup tables
    if (FRIENDLY_NAMES[dotKey]) {
      metadata.friendly_name = FRIENDLY_NAMES[dotKey];
    }
    if (TOOLTIPS[dotKey]) {
      metadata.tooltip = TOOLTIPS[dotKey];
    }
    if (SECTION_MAPPING[dotKey]) {
      metadata.section = SECTION_MAPPING[dotKey];
      // Calculate display_order based on position in section
      const sectionConfigs = Object.entries(SECTION_MAPPING)
        .filter(([_key, section]) => section === metadata.section)
        .map(([cfgKey]) => cfgKey);
      metadata.display_order = sectionConfigs.indexOf(dotKey) + 1;
    }

    // Add business_category for UI grouping
    metadata.business_category = getBusinessCategory(category, subcategory);

    // Add component metadata
    const componentData = getComponentData(dotKey, key, config.value, metadata);
    if (componentData) {
      metadata.component_type = componentData.component_type;
      metadata.component_config = componentData.component_config;
    }

    if (!existing) {
      // Create new record
      try {
        let record = new Record(collection);
        record.set("category", category);
        record.set("subcategory", subcategory);
        record.set("config_key", key);
        record.set("value", config.value);
        record.set("metadata", metadata);
        record.set("description", config.description);

        app.save(record);
        // Success - config created
      } catch (_e) {
        console.log(`Failed to create config ${dotKey}:`, _e);
      }
    } else {
      // Update existing record with metadata
      try {
        existing.set("value", config.value);
        existing.set("metadata", metadata);
        existing.set("description", config.description);

        app.save(existing);
        // Success - config updated
      } catch (_e) {
        console.log(`Failed to update config ${dotKey}:`, _e);
      }
    }
  });

  // AI configurations (`category = "ai"`, ~97 rows) removed in the AI Config
  // (Unified) Phase 2 cleanup — 78 keys had no consumers, 1 was env-shadowed
  // (`ai.model`), 18 are hardcoded as module-level constants on the resolution
  // strategies and `bunking/sync/bunk_request_processor/core/constants.py`.
  // Drop migration: `1500000109_drop_ai_configs.js`.

}, (app) => {
  // Rollback: Delete all default configs first, then delete collection
  try {
    const defaultConfigs = app.findRecordsByFilter(
      "config",
      `metadata.source = "default_config"`,
      "",
      0,
      0
    );

    defaultConfigs.forEach((config) => {
      app.delete(config);
    });
  } catch (_e) {
    console.log("Error deleting default configs during rollback:", _e);
  }

  // Delete the collection
  const collection = app.findCollectionByNameOrId("config");
  app.delete(collection);
});
