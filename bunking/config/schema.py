"""Configuration schema registry.

Defines all valid configuration keys with their types and validation rules.
This is the single source of truth for configuration structure.
"""

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
    # =========================================================================
    # Phase 2 cleanup: spread.max_age_months was collapsed into
    # bunking/solver/constants.py — MAX_AGE_SPREAD_MONTHS (=24). It was only
    # consumed by the sync-time spread filter while a separate phantom
    # constraint.age_spread.months (default=24) drove solver behavior.
    # spread.max_grade was collapsed earlier into MAX_UNIQUE_GRADES_PER_BUNK
    # (Grade Spread Phase 2).
    # =========================================================================
    # SOLVER CONSTRAINTS - Grade Ratio
    # =========================================================================
    # Phase 2 cleanup: constraint.grade_ratio.{max_percentage, penalty} were
    # collapsed into bunking/solver/constants.py — MAX_SINGLE_GRADE_PERCENTAGE
    # (=67) and GRADE_RATIO_PENALTY (=5000). Neither was ever tuned at runtime;
    # the validator's parallel literal 67 now imports the same constant.
    # =========================================================================
    # SOLVER CONSTRAINTS - Grade Adjacency (HARD CONSTRAINT - no config needed)
    # =========================================================================
    # Note: Grade adjacency is enforced as a HARD constraint.
    # Non-adjacent grades (e.g., 4 and 6) are forbidden in the same bunk.
    # No penalty config needed - violations make the solution infeasible.
    # =========================================================================
    # SOLVER CONSTRAINTS - Age Spread
    # =========================================================================
    # Phase 2 cleanup: constraint.age_spread.{penalty, preferred_months} were
    # collapsed into bunking/solver/constants.py — MAX_AGE_SPREAD_MONTHS (hard
    # cap, =24) and PREFERRED_AGE_SPREAD_MONTHS (soft target, =18). The soft
    # penalty path is gone; the constant takes the hardcoded threshold.
    # constraint.age_spread.preferred_bonus is KEPT as the lone tunable knob.
    "constraint.age_spread.preferred_bonus": ConfigKey(
        key="constraint.age_spread.preferred_bonus",
        config_type=ConfigType.INT,
        required=True,
        description="Bonus weight for cabins whose age spread is within the preferred threshold",
        min_value=0,
        max_value=10000,
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
    # Phase 2 cleanup: constraint.age_grade_flow.weight was collapsed into
    # AGE_GRADE_FLOW_WEIGHT (=300) in bunking/solver/constants.py (never tuned).
    # constraint.grade_cohesion.weight was a confirmed orphan — no constraint
    # module, evaluator, validator, or frontend ever read it — and was deleted
    # outright (no constant).
    # Phase 2 cleanup (Grade Spread): constraint.grade_spread.{mode, penalty}
    # were removed in favor of MAX_UNIQUE_GRADES_PER_BUNK (=2) in
    # bunking/solver/constants.py. The soft constraint path was deleted; solver
    # is hard-only. Staff can override on the bunking board (board flags
    # grade_spread_warning post-solve). spread.max_grade was the sync-side
    # filter knob; collapsed into the same constant.
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
    # OBJECTIVE FUNCTION - First-pick boost (debug toggle)
    # =========================================================================
    "objective.enable_first_boost": ConfigKey(
        key="objective.enable_first_boost",
        config_type=ConfigType.INT,
        required=True,
        description=(
            "When true, the family's first-pick request (is_first_requested=true) "
            "lands in slot 0 of the diminishing-returns stack and gets the 10x boost. "
            "When false, slot 0 falls to insertion order — A/B-test handle for the "
            "solver-debug UI."
        ),
        min_value=0,
        max_value=1,
    ),
    # =========================================================================
    # OBJECTIVE FUNCTION - Mutual-request boost (Stream 4 / #1382)
    # =========================================================================
    "objective.mutual_request_boost": ConfigKey(
        key="objective.mutual_request_boost",
        config_type=ConfigType.FLOAT,
        required=True,
        description=(
            "Multiplier applied to bunk_with requests when both directions exist "
            "(A→B AND B→A both filed as bunk_with). Always on; set to 1.0 to disable "
            "the boost without removing the code path. Stacks multiplicatively with "
            "source_multipliers and diminishing-returns weights."
        ),
        # Hard floor at 1.0 — values below 1.0 would inversely *downweight*
        # reciprocated requests vs. one-way ones, the opposite of the
        # feature's intent. Disable is "set to 1.0", not "set to 0.0".
        min_value=1.0,
        max_value=10.0,
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
