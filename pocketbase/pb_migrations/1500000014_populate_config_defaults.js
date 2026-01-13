/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Populate config table with default values
 * Dependencies: 1500000025_config.js
 */

migrate((app) => {
  let collection = app.findCollectionByNameOrId("config");
  
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

  // Determine business_category for UI grouping (from 1767200000)
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
    
    // Constraint Settings - Cabin Capacity
    'constraint.cabin_capacity.enabled': 'Enforce Cabin Capacity',
    'constraint.cabin_capacity.mode': 'Cabin Capacity Mode',
    'constraint.cabin_capacity.max': 'Maximum Cabin Size',
    'constraint.cabin_capacity.standard': 'Standard Cabin Size',
    'constraint.cabin_capacity.penalty': 'Over-Capacity Penalty',
    
    // Constraint Settings - Age & Grade (unified spread limits)
    'spread.max_grade': 'Max Grade Spread',
    'spread.max_age_months': 'Max Age Difference (months)',
    'constraint.age_spread.enabled': 'Enforce Age Spread Limits',
    'constraint.age_spread.penalty': 'Age Spread Violation Penalty',
    'constraint.grade_spread.enabled': 'Enforce Grade Spread Limits',
    'constraint.grade_spread.mode': 'Grade Spread Mode',
    'constraint.grade_spread.penalty': 'Grade Spread Violation Penalty',
    'constraint.grade_ratio.max_percentage': 'Max Single Grade Percentage',
    'constraint.grade_ratio.penalty': 'Grade Ratio Violation Penalty',

    // Constraint Settings - Cabin Minimum Occupancy
    'constraint.cabin_minimum_occupancy.enabled': 'Enable Minimum Occupancy',
    'constraint.cabin_minimum_occupancy.min': 'Hard Minimum Campers',
    'constraint.cabin_minimum_occupancy.preferred': 'Preferred Minimum Campers',
    'constraint.cabin_minimum_occupancy.penalty': 'Under-Occupancy Penalty',
    'constraint.cabin_minimum_occupancy.force_all_used': 'Force All Cabins Used',

    // Constraint Settings - Level Progression
    'constraint.level_progression.no_regression': 'Prevent Level Regression',
    'constraint.level_progression.no_regression_penalty': 'Regression Penalty',

    // Constraint Settings - Flow & Cohesion
    'constraint.age_grade_flow.weight': 'Age/Grade Flow Weight',
    'constraint.grade_cohesion.weight': 'Grade Cohesion Weight',

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
    'solver.time_limit.seconds': 'Solver Time Limit',

    // Soft Constraint Weights (penalty_multiplier removed - never applied)
    'soft.grade_spread.penalty': 'Soft Grade Spread Penalty',
    'soft.age_spread.penalty': 'Soft Age Spread Penalty',
    
    // Smart Local Resolution (NetworkX)
    'smart_local_resolution.enabled': 'Enable Smart Name Resolution',
    'smart_local_resolution.significant_connection_threshold': 'Significant Connection Threshold',
    'smart_local_resolution.min_connections_for_auto_resolve': 'Min Connections for Auto-Resolution',
    'smart_local_resolution.connection_score_weight': 'Connection Score Weight',
    'smart_local_resolution.min_confidence_for_auto_resolve': 'Min Confidence for Auto-Resolution',
    'smart_local_resolution.mutual_request_bonus': 'Mutual Request Bonus',
    'smart_local_resolution.common_friends_weight': 'Common Friends Weight',
    'smart_local_resolution.historical_bunking_weight': 'Historical Bunking Weight',
    
    // AI Processing Settings
    'ai.confidence_threshold': 'AI Confidence Threshold',
    'ai.model': 'AI Model',
    'ai.enable_processing': 'Enable AI Processing',
    'ai.fuzzy_match_threshold': 'Fuzzy Match Threshold'
  };

  // Tooltips for all config values
  const TOOLTIPS = {
    // Constraint Settings - Core (must_satisfy_one uses soft constraint with penalty)
    'constraint.must_satisfy_one.enabled': 'Whether every camper must have at least one bunk request satisfied',
    'constraint.must_satisfy_one.fallback_to_age': 'If no specific requests, count age preference as satisfying the requirement',
    'constraint.must_satisfy_one.ignore_impossible_requests': 'Ignore requests for campers not attending the same session',
    'constraint.must_satisfy_one.penalty': 'How heavily the optimizer penalizes leaving a camper without any requests fulfilled. Higher = tries harder to satisfy everyone.',
    
    // Constraint Settings - Cabin Capacity
    'constraint.cabin_capacity.enabled': 'Whether to enforce cabin capacity limits',
    'constraint.cabin_capacity.mode': 'Hard constraint prevents exceeding, soft adds penalty',
    'constraint.cabin_capacity.max': 'Maximum allowed campers per cabin (with override)',
    'constraint.cabin_capacity.standard': 'Standard cabin size for planning',
    'constraint.cabin_capacity.penalty': 'Penalty weight for exceeding capacity (soft mode only)',
    
    // Constraint Settings - Age & Grade (unified spread limits)
    'spread.max_grade': 'Maximum grade difference allowed in bunks and bunk requests (e.g., 2 means 6th and 7th grade only)',
    'spread.max_age_months': 'Maximum age difference in months allowed in bunks and bunk requests',
    'constraint.age_spread.enabled': 'Whether to enforce maximum age difference in cabins',
    'constraint.age_spread.penalty': 'Penalty weight for exceeding age spread limit',
    'constraint.grade_spread.enabled': 'Whether to enforce maximum grade spread in cabins',
    'constraint.grade_spread.mode': 'Hard constraint prevents exceeding, soft adds penalty',
    'constraint.grade_spread.penalty': 'Penalty weight for exceeding grade spread limit',
    'constraint.grade_ratio.max_percentage': 'Maximum percentage of cabin that can be from a single grade',
    'constraint.grade_ratio.penalty': 'Penalty weight for exceeding grade ratio limit',

    // Constraint Settings - Cabin Minimum Occupancy
    'constraint.cabin_minimum_occupancy.enabled': 'Enable minimum occupancy constraint for non-AG bunks',
    'constraint.cabin_minimum_occupancy.min': 'Hard minimum: if bunk has any campers, must have at least this many',
    'constraint.cabin_minimum_occupancy.preferred': 'Soft preferred: penalize bunks with fewer than this many campers',
    'constraint.cabin_minimum_occupancy.penalty': 'Penalty weight for each spot below preferred occupancy',
    'constraint.cabin_minimum_occupancy.force_all_used': 'Force all cabins to be used when enough campers exist',

    // Constraint Settings - Level Progression
    'constraint.level_progression.no_regression': 'Prevent returning campers from being placed in lower level bunks than previous year',
    'constraint.level_progression.no_regression_penalty': 'Penalty weight for placing camper in lower level than previous year',

    // Constraint Settings - Flow & Cohesion
    'constraint.age_grade_flow.weight': 'Bonus weight for placing campers in bunks matching their target grade. Uses distribution-based targeting (not pairwise).',
    'constraint.grade_cohesion.weight': 'Keep same grades together in adjacent cabins',

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
    'solver.time_limit.seconds': 'Maximum time in seconds for solver to find a solution',

    // Soft Constraint Weights (penalty_multiplier removed - never applied)
    'soft.grade_spread.penalty': 'Penalty for soft grade spread violations',
    'soft.age_spread.penalty': 'Penalty for soft age spread violations',
    
    // Smart Local Resolution (NetworkX)
    'smart_local_resolution.enabled': 'Use social graph analysis for ambiguous name resolution',
    'smart_local_resolution.significant_connection_threshold': 'Minimum connections to consider a relationship significant',
    'smart_local_resolution.min_connections_for_auto_resolve': 'Minimum social connections required for automatic name resolution',
    'smart_local_resolution.connection_score_weight': 'Weight given to social connection scores (0.0-1.0)',
    'smart_local_resolution.min_confidence_for_auto_resolve': 'Minimum confidence score to automatically resolve ambiguous names',
    'smart_local_resolution.mutual_request_bonus': 'Bonus points when both campers request each other',
    'smart_local_resolution.common_friends_weight': 'Weight multiplier for common friends in social scoring',
    'smart_local_resolution.historical_bunking_weight': 'Weight for historical bunking patterns in scoring',
    
    // AI Processing Settings
    'ai.confidence_threshold': 'Minimum confidence score (0.0-1.0) for AI to process a request',
    'ai.model': 'AI model to use for processing requests (e.g., gpt-4o-mini)',
    'ai.enable_processing': 'Whether to use AI for processing bunk requests',
    'ai.fuzzy_match_threshold': 'Minimum score (0-100) for fuzzy name matching',
    
  };

  // Section mapping for each config
  const SECTION_MAPPING = {
    // Core Constraints (must_satisfy_one uses soft constraint with penalty)
    'constraint.must_satisfy_one.enabled': 'core-constraints',
    'constraint.must_satisfy_one.fallback_to_age': 'core-constraints',
    'constraint.must_satisfy_one.ignore_impossible_requests': 'core-constraints',
    'constraint.must_satisfy_one.penalty': 'core-constraints',

    // Cabin Capacity
    'constraint.cabin_capacity.enabled': 'cabin-capacity',
    'constraint.cabin_capacity.mode': 'cabin-capacity',
    'constraint.cabin_capacity.max': 'cabin-capacity',
    'constraint.cabin_capacity.standard': 'cabin-capacity',
    'constraint.cabin_capacity.penalty': 'cabin-capacity',
    
    // Age & Grade (unified spread limits)
    'spread.max_grade': 'age-grade',
    'spread.max_age_months': 'age-grade',
    'constraint.age_spread.enabled': 'age-grade',
    'constraint.age_spread.penalty': 'age-grade',
    'constraint.grade_spread.enabled': 'age-grade',
    'constraint.grade_spread.mode': 'age-grade',
    'constraint.grade_spread.penalty': 'age-grade',
    'constraint.grade_ratio.max_percentage': 'age-grade',
    'constraint.grade_ratio.penalty': 'age-grade',
    'soft.grade_spread.penalty': 'age-grade',
    'soft.age_spread.penalty': 'age-grade',

    // Cabin Minimum Occupancy
    'constraint.cabin_minimum_occupancy.enabled': 'cabin-occupancy',
    'constraint.cabin_minimum_occupancy.min': 'cabin-occupancy',
    'constraint.cabin_minimum_occupancy.preferred': 'cabin-occupancy',
    'constraint.cabin_minimum_occupancy.penalty': 'cabin-occupancy',
    'constraint.cabin_minimum_occupancy.force_all_used': 'cabin-occupancy',

    // Level Progression
    'constraint.level_progression.no_regression': 'level-progression',
    'constraint.level_progression.no_regression_penalty': 'level-progression',

    // Flow & Cohesion
    'constraint.age_grade_flow.weight': 'flow-cohesion',
    'constraint.grade_cohesion.weight': 'flow-cohesion',

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
    'solver.time_limit.seconds': 'solver-execution',

    // Smart Resolution
    'smart_local_resolution.enabled': 'smart-resolution',
    'smart_local_resolution.significant_connection_threshold': 'smart-resolution',
    'smart_local_resolution.min_connections_for_auto_resolve': 'smart-resolution',
    'smart_local_resolution.connection_score_weight': 'smart-resolution',
    'smart_local_resolution.min_confidence_for_auto_resolve': 'smart-resolution',
    'smart_local_resolution.mutual_request_bonus': 'smart-resolution',
    'smart_local_resolution.common_friends_weight': 'smart-resolution',
    'smart_local_resolution.historical_bunking_weight': 'smart-resolution',
    
    // AI Model Settings (ai.provider, ai.model.* now in .env)
    'ai.enable_processing': 'ai-model-settings',
    'ai.model': 'ai-model-settings',
    'ai.confidence_threshold': 'ai-model-settings',
    'ai.fuzzy_match_threshold': 'ai-model-settings',

    // AI Confidence Thresholds (simplified two-tier system)
    'ai.confidence_thresholds.auto_accept': 'ai-confidence-thresholds',
    'ai.confidence_thresholds.resolved': 'ai-confidence-thresholds',

    // AI Name Matching
    'ai.name_matching.phonetic_threshold': 'ai-name-matching',
    'ai.name_matching.fuzzy_threshold': 'ai-name-matching',
    'ai.name_matching.partial_match_penalty': 'ai-name-matching',
    'ai.name_matching.no_match_threshold': 'ai-name-matching',
    'ai.name_matching.first_name_age_filter.enabled': 'ai-name-matching',
    'ai.name_matching.first_name_age_filter.max_age_difference_months': 'ai-name-matching',

    // AI Confidence Scoring
    'ai.confidence_scoring.bunk_with.name_match_unique_score': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.name_match_multiple_score': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.no_exact_match_cap': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.reciprocal_multiplier': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.weights.name_match': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.weights.ai_parsing': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.weights.context': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.weights.reciprocal_bonus': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.network_bonus.enabled': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.network_bonus.weight': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.network_bonus.ego_network_base': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.network_bonus.direct_connection_bonus': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.network_bonus.friend_of_friend_bonus': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.network_bonus.three_degrees_bonus': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.network_bonus.per_shared_connection': 'ai-confidence-scoring',
    'ai.confidence_scoring.bunk_with.network_bonus.max_shared_bonus': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.name_match_unique_score': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.name_match_multiple_score': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.no_exact_match_cap': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.weights.name_match': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.weights.ai_parsing': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.weights.authority': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.authority_scores.parent': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.authority_scores.counselor': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.authority_scores.historical': 'ai-confidence-scoring',
    'ai.confidence_scoring.not_bunk_with.authority_scores.staff': 'ai-confidence-scoring',
    'ai.confidence_scoring.age_preference.weights.ai_parsing': 'ai-confidence-scoring',
    'ai.confidence_scoring.spread_limited.fixed_confidence': 'ai-confidence-scoring',

    // AI Field Parsing
    'ai.age_preference_source_priority.explicit': 'ai-validation-rules',
    'ai.age_preference_source_priority.social': 'ai-validation-rules',
    'ai.age_preference_source_priority.observation': 'ai-validation-rules',
    'ai.field_parsing.extract_from_notes': 'ai-validation-rules',
    'ai.field_parsing.counselor_recommendation_weight': 'ai-request-parsing',
    'ai.field_parsing.embedded_age_preference_confidence': 'ai-request-parsing',
    'ai.field_parsing.notes_request_priority': 'ai-request-parsing',
    'ai.source_field_weights.share_bunk_with': 'ai-request-parsing',
    'ai.source_field_weights.do_not_share_with': 'ai-request-parsing',
    'ai.source_field_weights.bunking_notes': 'ai-request-parsing',
    'ai.source_field_weights.socialize_preference': 'ai-request-parsing',

    // AI Validation Rules (spread limits now unified in spread.*)
    'ai.spread_validation.enabled': 'ai-validation-rules',
    'ai.spread_validation.strict_division_boundaries': 'ai-validation-rules',
    'ai.spread_validation.validate_not_bunk_with': 'ai-validation-rules',
    'ai.manual_review_triggers.conflicting_information': 'ai-validation-rules',
    'ai.manual_review_triggers.counselor_recommendations': 'ai-validation-rules',
    'ai.manual_review_triggers.historical_issues': 'ai-validation-rules',
    'ai.manual_review_triggers.low_confidence_threshold': 'ai-validation-rules',
    'ai.manual_review_triggers.not_attending_requests': 'ai-validation-rules',
    'ai.context_building.max_age_difference_months': 'ai-validation-rules',
    'ai.context_building.include_age_in_context': 'ai-validation-rules',
    'ai.historical_context.enabled': 'ai-validation-rules',
    'ai.historical_context.years_to_check': 'ai-validation-rules',
    'ai.historical_context.auto_decline_not_attending': 'ai-validation-rules',
    'ai.historical_context.priority_boost_sole_request': 'ai-validation-rules',
    'ai.history_tracking.enabled': 'ai-validation-rules',
    'ai.history_tracking.retention_days': 'ai-validation-rules',
    'ai.history_tracking.include_grade_changes': 'ai-validation-rules',
    'ai.dedup_scoring.staff_recommendation_weight': 'ai-validation-rules',
    'ai.dedup_scoring.confidence_multiplier': 'ai-validation-rules',
    'ai.dedup_scoring.primary_field_bonus': 'ai-validation-rules',
    'ai.dedup_scoring.list_position_multiplier': 'ai-validation-rules',
    'ai.dedup_scoring.max_list_positions': 'ai-validation-rules',

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
    "ai.model": componentMappings.model,
    "constraint.cabin_minimum_occupancy.min": {
      component_type: "number",
      component_config: { min: 4, max: 12, step: 1 }
    },
    "constraint.cabin_minimum_occupancy.preferred": {
      component_type: "number",
      component_config: { min: 8, max: 14, step: 1 }
    },
    "constraint.cabin_minimum_occupancy.penalty": {
      component_type: "number",
      component_config: { min: 0, max: 10000, step: 100 }
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
    "constraint.grade_ratio.max_percentage": {
      value: 67,
      description: "Maximum percentage of any single grade in a multi-grade cabin",
      min: 50,
      max: 100
    },
    "constraint.grade_ratio.penalty": {
      value: 5000,
      description: "Penalty for grade ratio violations",
      min: 0,
      max: 50000
    },

    // Cabin minimum occupancy
    "constraint.cabin_minimum_occupancy.enabled": {
      value: 1,
      description: "Enable minimum occupancy constraint for non-AG bunks",
      min: 0,
      max: 1
    },
    "constraint.cabin_minimum_occupancy.min": {
      value: 8,
      description: "Hard minimum: if bunk has any campers, must have at least this many",
      min: 1,
      max: 12
    },
    "constraint.cabin_minimum_occupancy.preferred": {
      value: 10,
      description: "Soft preferred: penalize bunks with fewer than this many campers",
      min: 1,
      max: 12
    },
    "constraint.cabin_minimum_occupancy.penalty": {
      value: 2000,
      description: "Penalty weight for each spot below preferred occupancy",
      min: 0,
      max: 10000
    },
    "constraint.cabin_minimum_occupancy.force_all_used": {
      value: 1,
      description: "Force all cabins to be used when enough campers exist (1=enabled)",
      min: 0,
      max: 1
    },

    // Unified spread limits (used by both solver and request processor)
    "spread.max_grade": {
      value: 2,
      description: "Maximum grade spread allowed in bunks and bunk requests",
      min: 1,
      max: 5
    },
    "spread.max_age_months": {
      value: 24,
      description: "Maximum age difference in months allowed in bunks and bunk requests",
      min: 12,
      max: 48
    },

    "constraint.age_spread.penalty": {
      value: 1500,
      description: "Penalty for age spread violations",
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
    "constraint.cabin_capacity.max": {
      value: 14,
      description: "Maximum cabin capacity (with override)",
      min: 8,
      max: 16
    },
    "constraint.cabin_capacity.standard": {
      value: 12,
      description: "Standard cabin capacity",
      min: 8,
      max: 16
    },
    "constraint.age_grade_flow.weight": {
      value: 300,
      description: "Weight for age-grade flow constraint",
      min: 0,
      max: 10000
    },
    "constraint.grade_cohesion.weight": {
      value: 5,
      description: "Weight for grade cohesion in cabins",
      min: 0,
      max: 100
    },
    "constraint.cabin_capacity.mode": {
      value: "hard",
      description: "Cabin capacity constraint mode (hard/soft)"
    },
    "constraint.cabin_capacity.penalty": {
      value: 50000,
      description: "Penalty for cabin capacity violations",
      min: 0,
      max: 100000
    },
    "constraint.grade_spread.mode": {
      value: "soft",
      description: "Grade spread constraint mode (hard/soft)"
    },
    "constraint.grade_spread.penalty": {
      value: 3000,
      description: "Penalty for grade spread violations",
      min: 0,
      max: 10000
    },

    // Objective configurations
    "objective.source_multipliers.share_bunk_with": {
      value: 1.5,
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
      value: 0.8,
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
    "solver.time_limit.seconds": {
      value: 60,
      description: "Maximum time in seconds for solver to find a solution",
      min: 1,
      max: 600
    },

    // Soft constraint configurations (penalty_multiplier removed - never applied)
    "soft.grade_spread.penalty": {
      value: 3000,
      description: "Penalty for soft grade spread constraint",
      min: 0,
      max: 10000
    },
    "soft.age_spread.penalty": {
      value: 2500,
      description: "Penalty for soft age spread constraint",
      min: 0,
      max: 10000
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

  // AI configurations from ai_config.json (flattened structure)
  // NOTE: ai.provider, ai.model.name, ai.model.temperature, ai.model.max_tokens
  // are now managed via .env file (AI_PROVIDER, AI_MODEL) or hardcoded (temp=0, max_tokens=auto)
  const aiConfigs = {
    "ai.enable_processing": {
      value: 1,
      description: "Enable AI processing for bunk requests",
      min: 0,
      max: 1
    },
    "ai.confidence_threshold": {
      value: 0.4,
      description: "Minimum confidence score for AI to process a request",
      min: 0.0,
      max: 1.0
    },
    "ai.fuzzy_match_threshold": {
      value: 70,
      description: "Fuzzy matching threshold for name resolution",
      min: 0,
      max: 100
    },
    
    // Confidence thresholds (simplified two-tier system)
    // >= auto_accept (0.95): High confidence, shown with checkmark, no staff review needed
    // >= resolved (0.85): Standard confidence, staff may spot-check
    // < resolved (0.85): Pending status, requires manual review
    "ai.confidence_thresholds.auto_accept": {
      value: 0.95,
      description: "High-confidence threshold (no staff review needed)",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_thresholds.resolved": {
      value: 0.85,
      description: "Threshold for marking requests as resolved (staff may spot-check)",
      min: 0.0,
      max: 1.0
    },
    
    // Name matching
    "ai.name_matching.phonetic_threshold": {
      value: 0.85,
      description: "Threshold for phonetic name matching",
      min: 0.0,
      max: 1.0
    },
    "ai.name_matching.fuzzy_threshold": {
      value: 0.80,
      description: "Threshold for fuzzy name matching",
      min: 0.0,
      max: 1.0
    },
    "ai.name_matching.partial_match_penalty": {
      value: 0.15,
      description: "Penalty for partial name matches",
      min: 0.0,
      max: 1.0
    },
    "ai.name_matching.no_match_threshold": {
      value: 0.60,
      description: "Threshold below which names are considered non-matches",
      min: 0.0,
      max: 1.0
    },
    "ai.name_matching.first_name_age_filter.enabled": {
      value: 1,
      description: "Enable age filtering for first name matches",
      min: 0,
      max: 1
    },
    "ai.name_matching.first_name_age_filter.max_age_difference_months": {
      value: 24,
      description: "Maximum age difference in months for first name matches",
      min: 0,
      max: 60
    },
    
    // Manual review triggers
    "ai.manual_review_triggers.conflicting_information": {
      value: 1,
      description: "Trigger manual review for conflicting information",
      min: 0,
      max: 1
    },
    "ai.manual_review_triggers.counselor_recommendations": {
      value: 1,
      description: "Trigger manual review for counselor recommendations",
      min: 0,
      max: 1
    },
    "ai.manual_review_triggers.historical_issues": {
      value: 1,
      description: "Trigger manual review for historical issues",
      min: 0,
      max: 1
    },
    "ai.manual_review_triggers.low_confidence_threshold": {
      value: 0.70,
      description: "Confidence threshold below which manual review is triggered",
      min: 0.0,
      max: 1.0
    },
    "ai.manual_review_triggers.not_attending_requests": {
      value: 1,
      description: "Trigger manual review for not-attending requests",
      min: 0,
      max: 1
    },
    
    // Field parsing
    "ai.field_parsing.extract_from_notes": {
      value: 1,
      description: "Extract requests from notes fields",
      min: 0,
      max: 1
    },
    "ai.field_parsing.counselor_recommendation_weight": {
      value: 0.95,
      description: "Weight for counselor recommendations",
      min: 0.0,
      max: 1.0
    },
    "ai.field_parsing.embedded_age_preference_confidence": {
      value: 0.90,
      description: "Confidence for embedded age preferences",
      min: 0.0,
      max: 1.0
    },
    "ai.field_parsing.notes_request_priority": {
      value: 5,
      description: "Priority for requests found in notes"
    },
    
    // Source field weights
    "ai.source_field_weights.share_bunk_with": {
      value: 1.0,
      description: "Weight for share_bunk_with field",
      min: 0.0,
      max: 2.0
    },
    "ai.source_field_weights.do_not_share_with": {
      value: 1.0,
      description: "Weight for do_not_share_with field",
      min: 0.0,
      max: 2.0
    },
    "ai.source_field_weights.bunking_notes": {
      value: 0.9,
      description: "Weight for bunking_notes field",
      min: 0.0,
      max: 2.0
    },
    "ai.source_field_weights.socialize_preference": {
      value: 1.0,
      description: "Weight for socialize_preference field",
      min: 0.0,
      max: 2.0
    },
    
    // Historical context
    "ai.historical_context.enabled": {
      value: 1,
      description: "Enable historical context analysis",
      min: 0,
      max: 1
    },
    "ai.historical_context.years_to_check": {
      value: 1,
      description: "Number of years to check for historical context"
    },
    "ai.historical_context.auto_decline_not_attending": {
      value: 1,
      description: "Auto-decline requests for campers not attending",
      min: 0,
      max: 1
    },
    "ai.historical_context.priority_boost_sole_request": {
      value: 20,
      description: "Priority boost for sole requests"
    },
    
    // Confidence scoring for bunk_with
    "ai.confidence_scoring.bunk_with.weights.name_match": {
      value: 0.70,
      description: "Weight for name matching in bunk_with confidence",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.weights.ai_parsing": {
      value: 0.15,
      description: "Weight for AI parsing in bunk_with confidence",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.weights.context": {
      value: 0.10,
      description: "Weight for context in bunk_with confidence",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.weights.reciprocal_bonus": {
      value: 0.05,
      description: "Weight for reciprocal bonus in bunk_with confidence",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.name_match_unique_score": {
      value: 1.0,
      description: "Score for unique name matches",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.name_match_multiple_score": {
      value: 0.85,
      description: "Score for multiple name matches",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.no_exact_match_cap": {
      value: 0.65,
      description: "Cap for confidence when no exact match found",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.reciprocal_multiplier": {
      value: 1.05,
      description: "Multiplier for reciprocal requests",
      min: 1.0,
      max: 2.0
    },
    
    // Network bonus for bunk_with
    "ai.confidence_scoring.bunk_with.network_bonus.enabled": {
      value: 1,
      description: "Enable network bonus in confidence scoring",
      min: 0,
      max: 1
    },
    "ai.confidence_scoring.bunk_with.network_bonus.weight": {
      value: 0.15,
      description: "Weight for network bonus",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.network_bonus.ego_network_base": {
      value: 0.05,
      description: "Base score for ego network",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.network_bonus.direct_connection_bonus": {
      value: 0.10,
      description: "Bonus for direct connections",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.network_bonus.friend_of_friend_bonus": {
      value: 0.05,
      description: "Bonus for friend-of-friend connections",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.network_bonus.three_degrees_bonus": {
      value: 0.02,
      description: "Bonus for three degrees of separation",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.network_bonus.per_shared_connection": {
      value: 0.01,
      description: "Bonus per shared connection",
      min: 0.0,
      max: 0.1
    },
    "ai.confidence_scoring.bunk_with.network_bonus.max_shared_bonus": {
      value: 0.05,
      description: "Maximum bonus for shared connections",
      min: 0.0,
      max: 0.2
    },
    
    // Confidence scoring for not_bunk_with
    "ai.confidence_scoring.not_bunk_with.weights.name_match": {
      value: 0.60,
      description: "Weight for name matching in not_bunk_with confidence",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.weights.ai_parsing": {
      value: 0.25,
      description: "Weight for AI parsing in not_bunk_with confidence",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.weights.authority": {
      value: 0.15,
      description: "Weight for authority in not_bunk_with confidence",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.name_match_unique_score": {
      value: 1.0,
      description: "Score for unique name matches in not_bunk_with",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.name_match_multiple_score": {
      value: 0.80,
      description: "Score for multiple name matches in not_bunk_with",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.no_exact_match_cap": {
      value: 0.60,
      description: "Cap for confidence when no exact match in not_bunk_with",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.authority_scores.parent": {
      value: 0.7,
      description: "Authority score for parent requests",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.authority_scores.counselor": {
      value: 1.0,
      description: "Authority score for counselor requests",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.authority_scores.historical": {
      value: 0.9,
      description: "Authority score for historical patterns",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.authority_scores.staff": {
      value: 0.8,
      description: "Authority score for staff requests",
      min: 0.0,
      max: 1.0
    },
    
    // Age preference and spread_limited
    "ai.confidence_scoring.age_preference.weights.ai_parsing": {
      value: 1.0,
      description: "Weight for AI parsing in age preference confidence",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.spread_limited.fixed_confidence": {
      value: 1.0,
      description: "Fixed confidence for spread-limited requests",
      min: 0.0,
      max: 1.0
    },
    
    // History tracking
    "ai.history_tracking.enabled": {
      value: 1,
      description: "Enable CSV history tracking",
      min: 0,
      max: 1
    },
    "ai.history_tracking.retention_days": {
      value: 30,
      description: "Days to retain CSV history"
    },
    "ai.history_tracking.include_grade_changes": {
      value: 1,
      description: "Include grade changes in history tracking",
      min: 0,
      max: 1
    },
    
    // Spread validation
    "ai.spread_validation.enabled": {
      value: 1,
      description: "Enable spread validation",
      min: 0,
      max: 1
    },
    // NOTE: max_grade_spread and max_age_spread_months now in unified spread.* category
    "ai.spread_validation.strict_division_boundaries": {
      value: 1,
      description: "Enforce strict division boundaries",
      min: 0,
      max: 1
    },
    "ai.spread_validation.validate_not_bunk_with": {
      value: 0,
      description: "Validate not_bunk_with requests for spread",
      min: 0,
      max: 1
    },
    
    // Dedup scoring
    "ai.dedup_scoring.staff_recommendation_weight": {
      value: 1000,
      description: "Weight for staff recommendations in deduplication"
    },
    "ai.dedup_scoring.confidence_multiplier": {
      value: 100,
      description: "Multiplier for confidence in deduplication"
    },
    "ai.dedup_scoring.primary_field_bonus": {
      value: 50,
      description: "Bonus for primary field in deduplication"
    },
    "ai.dedup_scoring.list_position_multiplier": {
      value: 10,
      description: "Multiplier for list position in deduplication"
    },
    "ai.dedup_scoring.max_list_positions": {
      value: 11,
      description: "Maximum list positions to consider"
    },
    
    // Age preference source priority
    "ai.age_preference_source_priority.explicit": {
      value: 3,
      description: "Priority for explicit age preferences"
    },
    "ai.age_preference_source_priority.social": {
      value: 2,
      description: "Priority for social age preferences"
    },
    "ai.age_preference_source_priority.observation": {
      value: 1,
      description: "Priority for observed age preferences"
    },
    
    // Context building
    "ai.context_building.max_age_difference_months": {
      value: 24,
      description: "Maximum age difference for context building"
    },
    "ai.context_building.include_age_in_context": {
      value: 1,
      description: "Include age in context building",
      min: 0,
      max: 1
    },

    // Confidence context scores (from 1500000029)
    "ai.confidence_scoring.ai_boost": {
      value: 0.15,
      description: "Confidence boost when AI provides a valid person ID",
      min: 0.0,
      max: 0.5
    },
    "ai.confidence_scoring.bunk_with.context_scores.base": {
      value: 0.5,
      description: "Base context score when no year information available",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.context_scores.current_year": {
      value: 0.8,
      description: "Context score when target found in current year",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.context_scores.previous_year_only": {
      value: 0.4,
      description: "Context score when target found only in previous year",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.bunk_with.context_scores.social_signal_bonus": {
      value: 0.1,
      description: "Bonus added per social signal (ego network, social distance)",
      min: 0.0,
      max: 0.5
    },
    "ai.confidence_scoring.bunk_with.social.max_distance_for_bonus": {
      value: 2,
      description: "Maximum social distance (hops) to qualify for bonus",
      min: 1,
      max: 5
    },
    "ai.confidence_scoring.not_bunk_with.context_scores.current_year": {
      value: 0.7,
      description: "Context score for not_bunk_with when target in current year",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.not_bunk_with.context_scores.previous_year_only": {
      value: 0.3,
      description: "Context score for not_bunk_with when target only in previous year",
      min: 0.0,
      max: 1.0
    },

    // Resolution strategy confidence - Fuzzy Match (from 1766300000)
    "ai.confidence_scoring.resolution.fuzzy.nickname_base": {
      value: 0.85,
      description: "Base confidence for nickname matches (Mike -> Michael)",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.fuzzy.spelling_base": {
      value: 0.85,
      description: "Base confidence for spelling variation matches (Sara -> Sarah)",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.fuzzy.normalized_base": {
      value: 0.80,
      description: "Base confidence for normalized name matches",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.fuzzy.default_base": {
      value: 0.75,
      description: "Default base confidence for fuzzy matches",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.fuzzy.session_match": {
      value: 0.85,
      description: "Confidence when session disambiguation succeeds",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.fuzzy.same_session_boost": {
      value: 0.0,
      description: "Confidence boost when match is in same session (fuzzy maintains base)",
      min: 0.0,
      max: 0.3
    },
    "ai.confidence_scoring.resolution.fuzzy.different_session_penalty": {
      value: -0.10,
      description: "Confidence penalty when match is in different session",
      min: -0.5,
      max: 0.0
    },
    "ai.confidence_scoring.resolution.fuzzy.not_enrolled_penalty": {
      value: -0.05,
      description: "Confidence penalty when person not in attendee list",
      min: -0.3,
      max: 0.0
    },

    // Resolution strategy confidence - Phonetic Match (from 1766300000)
    "ai.confidence_scoring.resolution.phonetic.soundex_base": {
      value: 0.70,
      description: "Base confidence for Soundex phonetic matches",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.phonetic.metaphone_base": {
      value: 0.65,
      description: "Base confidence for Metaphone phonetic matches",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.phonetic.nickname_base": {
      value: 0.75,
      description: "Base confidence for nickname matches in phonetic strategy",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.phonetic.default_base": {
      value: 0.60,
      description: "Default base confidence for phonetic matches",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.phonetic.session_match": {
      value: 0.75,
      description: "Confidence when session disambiguation succeeds",
      min: 0.0,
      max: 1.0
    },
    "ai.confidence_scoring.resolution.phonetic.same_session_boost": {
      value: 0.05,
      description: "Confidence boost when match is in same session",
      min: 0.0,
      max: 0.3
    },
    "ai.confidence_scoring.resolution.phonetic.different_session_penalty": {
      value: -0.20,
      description: "Confidence penalty when match is in different session",
      min: -0.5,
      max: 0.0
    },
    "ai.confidence_scoring.resolution.phonetic.not_enrolled_penalty": {
      value: -0.05,
      description: "Confidence penalty when person not in attendee list",
      min: -0.3,
      max: 0.0
    }
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

  // Also insert AI configurations
  Object.entries(aiConfigs).forEach(([dotKey, config]) => {
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
        // Success - AI config created
      } catch (_e) {
        console.log(`Failed to create AI config ${dotKey}:`, _e);
      }
    } else {
      // Update existing record with metadata
      try {
        existing.set("value", config.value);
        existing.set("metadata", metadata);
        existing.set("description", config.description);

        app.save(existing);
        // Success - AI config updated
      } catch (_e) {
        console.log(`Failed to update AI config ${dotKey}:`, _e);
      }
    }
  });

  return null;
}, (app) => {
  // Rollback: Delete all default configs
  let collection = app.findCollectionByNameOrId("config");
  if (collection) {
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
      console.log("Error during rollback:", _e);
    }
  }
  
  return null;
})