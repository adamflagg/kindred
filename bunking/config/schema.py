"""Configuration schema registry.

Defines all valid configuration keys with their types and validation rules.
This is the single source of truth for configuration structure.
"""

from __future__ import annotations

from .types import ConfigKey, ConfigType

# =============================================================================
# CONFIGURATION SCHEMA REGISTRY
#
# All configuration keys must be defined here. Unknown keys will be rejected.
# Required keys must exist in the database - there are no hardcoded defaults.
# =============================================================================

CONFIG_SCHEMA: dict[str, ConfigKey] = {
    # =========================================================================
    # SPREAD VALIDATION
    # Used by both solver constraints and request processor
    # =========================================================================
    "spread.max_grade": ConfigKey(
        key="spread.max_grade",
        config_type=ConfigType.INT,
        required=True,
        description="Maximum grade difference allowed in bunk requests",
        min_value=0,
        max_value=10,
    ),
    "spread.max_age_months": ConfigKey(
        key="spread.max_age_months",
        config_type=ConfigType.INT,
        required=True,
        description="Maximum age difference in months for bunk requests",
        min_value=0,
        max_value=60,
    ),
    # =========================================================================
    # SOLVER CONSTRAINTS - Grade Ratio
    # =========================================================================
    "constraint.grade_ratio.max_percentage": ConfigKey(
        key="constraint.grade_ratio.max_percentage",
        config_type=ConfigType.INT,
        required=True,
        description="Maximum percentage of cabin that can be same grade",
        min_value=0,
        max_value=100,
    ),
    "constraint.grade_ratio.penalty": ConfigKey(
        key="constraint.grade_ratio.penalty",
        config_type=ConfigType.INT,
        required=True,
        description="Penalty for exceeding grade ratio limit",
        min_value=0,
    ),
    # =========================================================================
    # SOLVER CONSTRAINTS - Grade Adjacency (HARD CONSTRAINT - no config needed)
    # =========================================================================
    # Note: Grade adjacency is enforced as a HARD constraint.
    # Non-adjacent grades (e.g., 4 and 6) are forbidden in the same bunk.
    # No penalty config needed - violations make the solution infeasible.
    # =========================================================================
    # SOLVER CONSTRAINTS - Age Spread
    # =========================================================================
    "constraint.age_spread.penalty": ConfigKey(
        key="constraint.age_spread.penalty",
        config_type=ConfigType.INT,
        required=True,
        description="Penalty for age spread violations",
        min_value=0,
    ),
    "constraint.age_spread.preferred_months": ConfigKey(
        key="constraint.age_spread.preferred_months",
        config_type=ConfigType.INT,
        required=True,
        description="Preferred age spread in months — cabins at or below this spread earn a bonus (0 = disabled)",
        min_value=0,
        max_value=60,
    ),
    "constraint.age_spread.preferred_bonus": ConfigKey(
        key="constraint.age_spread.preferred_bonus",
        config_type=ConfigType.INT,
        required=True,
        description="Bonus weight for cabins whose age spread is within the preferred threshold",
        min_value=0,
        max_value=10000,
    ),
    # =========================================================================
    # SOLVER CONSTRAINTS - Must Satisfy One
    # =========================================================================
    "constraint.must_satisfy_one.enabled": ConfigKey(
        key="constraint.must_satisfy_one.enabled",
        config_type=ConfigType.INT,
        required=True,
        description="Enable must-satisfy-one request constraint (1=enabled)",
        min_value=0,
        max_value=1,
    ),
    "constraint.must_satisfy_one.fallback_to_age": ConfigKey(
        key="constraint.must_satisfy_one.fallback_to_age",
        config_type=ConfigType.INT,
        required=True,
        description="Fall back to age-based matching if no requests (1=enabled)",
        min_value=0,
        max_value=1,
    ),
    "constraint.must_satisfy_one.ignore_impossible_requests": ConfigKey(
        key="constraint.must_satisfy_one.ignore_impossible_requests",
        config_type=ConfigType.INT,
        required=True,
        description="Ignore requests that cannot be satisfied (1=enabled)",
        min_value=0,
        max_value=1,
    ),
    "constraint.must_satisfy_one.penalty": ConfigKey(
        key="constraint.must_satisfy_one.penalty",
        config_type=ConfigType.INT,
        required=True,
        description="Penalty for leaving a camper with no requests satisfied",
        min_value=0,
        max_value=500000,
    ),
    # =========================================================================
    # SOLVER CONSTRAINTS - Level Progression
    # =========================================================================
    "constraint.level_progression.no_regression": ConfigKey(
        key="constraint.level_progression.no_regression",
        config_type=ConfigType.INT,
        required=True,
        description="Prevent campers from regressing to lower cabins (1=enabled)",
        min_value=0,
        max_value=1,
    ),
    "constraint.level_progression.no_regression_penalty": ConfigKey(
        key="constraint.level_progression.no_regression_penalty",
        config_type=ConfigType.INT,
        required=True,
        description="Flat penalty for cabin regression (any amount)",
        min_value=0,
    ),
    # NOTE: prefer_progression and progression_weight removed - the scaled bonus
    # caused campers to skip past correct grade placements. Regression is now
    # handled by flat penalty only (no_regression + no_regression_penalty).
    # =========================================================================
    # SOLVER CONSTRAINTS - Cabin Capacity
    # =========================================================================
    # Phase 2 cleanup: cabin_capacity.{max, standard, mode, penalty} were all
    # removed in favor of two hardcoded constants in
    # bunking/solver/constants.py — DEFAULT_BUNK_CAPACITY (solver hard cap and
    # grade-ratio reference, =12) and MAX_BUNK_CAPACITY (staff-edit ceiling
    # in the assignments UI, =14). The soft-constraint code path that read
    # mode/penalty was deleted; per-bunk variance was never wired (Bunk
    # model's max_size was a Pydantic-only fiction). If you ever need
    # per-bunk variance, add a real PB column on bunks and wire it up.
    # =========================================================================
    # SOLVER CONSTRAINTS - Cabin Minimum Occupancy
    # =========================================================================
    # Phase 2 cleanup: cabin_minimum_occupancy.{enabled, min, preferred,
    # force_all_used} were removed in favor of two hardcoded constants in
    # bunking/solver/constants.py — MIN_BUNK_OCCUPANCY (hard floor, =8) and
    # PREFERRED_BUNK_OCCUPANCY (soft target, =10). The `enabled` and
    # `force_all_used` toggles were dead (constraint is a staff invariant);
    # `min` and `preferred` were never tuned at runtime. The `penalty` key
    # below is KEPT as the lone tunable knob in this domain.
    "constraint.cabin_minimum_occupancy.penalty": ConfigKey(
        key="constraint.cabin_minimum_occupancy.penalty",
        config_type=ConfigType.INT,
        required=True,
        description="Penalty weight for being below preferred occupancy",
        min_value=0,
    ),
    # =========================================================================
    # SOLVER CONSTRAINTS - Age/Grade Flow
    # =========================================================================
    "constraint.age_grade_flow.weight": ConfigKey(
        key="constraint.age_grade_flow.weight",
        config_type=ConfigType.INT,
        required=True,
        description="Weight for age/grade flow objective",
        min_value=0,
    ),
    "constraint.grade_cohesion.weight": ConfigKey(
        key="constraint.grade_cohesion.weight",
        config_type=ConfigType.INT,
        required=True,
        description="Weight for keeping same-grade campers together",
        min_value=0,
    ),
    "constraint.grade_spread.mode": ConfigKey(
        key="constraint.grade_spread.mode",
        config_type=ConfigType.STRING,
        required=True,
        description="Grade spread enforcement mode",
        allowed_values=["hard", "soft"],
    ),
    "constraint.grade_spread.penalty": ConfigKey(
        key="constraint.grade_spread.penalty",
        config_type=ConfigType.INT,
        required=True,
        description="Penalty for grade spread violations",
        min_value=0,
    ),
    # =========================================================================
    # OBJECTIVE FUNCTION - Source Multipliers
    # =========================================================================
    "objective.source_multipliers.share_bunk_with": ConfigKey(
        key="objective.source_multipliers.share_bunk_with",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Multiplier for share_bunk_with requests",
        min_value=0.0,
        max_value=10.0,
    ),
    "objective.source_multipliers.do_not_share_with": ConfigKey(
        key="objective.source_multipliers.do_not_share_with",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Multiplier for do_not_share_with requests",
        min_value=0.0,
        max_value=10.0,
    ),
    "objective.source_multipliers.bunking_notes": ConfigKey(
        key="objective.source_multipliers.bunking_notes",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Multiplier for bunking_notes requests",
        min_value=0.0,
        max_value=10.0,
    ),
    "objective.source_multipliers.internal_notes": ConfigKey(
        key="objective.source_multipliers.internal_notes",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Multiplier for internal_notes requests",
        min_value=0.0,
        max_value=10.0,
    ),
    "objective.source_multipliers.socialize_preference": ConfigKey(
        key="objective.source_multipliers.socialize_preference",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Multiplier for socialize_preference requests",
        min_value=0.0,
        max_value=10.0,
    ),
    # =========================================================================
    # OBJECTIVE FUNCTION - Diminishing Returns
    # =========================================================================
    "objective.enable_diminishing_returns": ConfigKey(
        key="objective.enable_diminishing_returns",
        config_type=ConfigType.INT,
        required=True,
        description="Enable diminishing returns for multiple requests (1=enabled)",
        min_value=0,
        max_value=1,
    ),
    "objective.first_request_multiplier": ConfigKey(
        key="objective.first_request_multiplier",
        config_type=ConfigType.INT,
        required=True,
        description="Multiplier for first satisfied request",
        min_value=0,
    ),
    "objective.second_request_multiplier": ConfigKey(
        key="objective.second_request_multiplier",
        config_type=ConfigType.INT,
        required=True,
        description="Multiplier for second satisfied request",
        min_value=0,
    ),
    "objective.third_plus_request_multiplier": ConfigKey(
        key="objective.third_plus_request_multiplier",
        config_type=ConfigType.INT,
        required=True,
        description="Multiplier for third+ satisfied requests",
        min_value=0,
    ),
    # =========================================================================
    # SOLVER SETTINGS
    # =========================================================================
    "solver.auto_apply_enabled": ConfigKey(
        key="solver.auto_apply_enabled",
        config_type=ConfigType.INT,
        required=True,
        description="Auto-apply solver results (1=enabled)",
        min_value=0,
        max_value=1,
    ),
    "solver.auto_apply_timeout": ConfigKey(
        key="solver.auto_apply_timeout",
        config_type=ConfigType.INT,
        required=True,
        description="Timeout before auto-applying in seconds (0=immediate)",
        min_value=0,
    ),
    # =========================================================================
    # SMART LOCAL RESOLUTION (NetworkX-based name resolution)
    # =========================================================================
    "smart_local_resolution.enabled": ConfigKey(
        key="smart_local_resolution.enabled",
        config_type=ConfigType.INT,
        required=True,
        description="Enable smart local resolution (1=enabled)",
        min_value=0,
        max_value=1,
    ),
    "smart_local_resolution.significant_connection_threshold": ConfigKey(
        key="smart_local_resolution.significant_connection_threshold",
        config_type=ConfigType.INT,
        required=True,
        description="Minimum connections for significant relationship",
        min_value=0,
    ),
    "smart_local_resolution.min_connections_for_auto_resolve": ConfigKey(
        key="smart_local_resolution.min_connections_for_auto_resolve",
        config_type=ConfigType.INT,
        required=True,
        description="Minimum connections for automatic resolution",
        min_value=0,
    ),
    "smart_local_resolution.connection_score_weight": ConfigKey(
        key="smart_local_resolution.connection_score_weight",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Weight for connection score in resolution",
        min_value=0.0,
        max_value=1.0,
    ),
    "smart_local_resolution.min_confidence_for_auto_resolve": ConfigKey(
        key="smart_local_resolution.min_confidence_for_auto_resolve",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Minimum confidence for automatic resolution",
        min_value=0.0,
        max_value=1.0,
    ),
    "smart_local_resolution.mutual_request_bonus": ConfigKey(
        key="smart_local_resolution.mutual_request_bonus",
        config_type=ConfigType.INT,
        required=True,
        description="Bonus score for mutual requests",
        min_value=0,
    ),
    "smart_local_resolution.common_friends_weight": ConfigKey(
        key="smart_local_resolution.common_friends_weight",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Weight for common friends in resolution",
        min_value=0.0,
        max_value=10.0,
    ),
    "smart_local_resolution.historical_bunking_weight": ConfigKey(
        key="smart_local_resolution.historical_bunking_weight",
        config_type=ConfigType.FLOAT,
        required=True,
        description="Weight for historical bunking in resolution",
        min_value=0.0,
        max_value=10.0,
    ),
}


def get_all_required_keys() -> list[str]:
    """
    Get all required configuration keys.

    Returns:
        List of key names that must exist in database
    """
    return [key for key, schema in CONFIG_SCHEMA.items() if schema.required]
