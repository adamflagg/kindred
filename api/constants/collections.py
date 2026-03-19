"""PocketBase collection name constants.

Centralizes hardcoded collection name strings used across the API.
Import and use these instead of raw string literals.
"""

# Core data
PERSONS = "persons"
ATTENDEES = "attendees"
CAMP_SESSIONS = "camp_sessions"
BUNKS = "bunks"
BUNK_PLANS = "bunk_plans"
BUNK_ASSIGNMENTS = "bunk_assignments"
BUNK_ASSIGNMENTS_DRAFT = "bunk_assignments_draft"
BUNK_REQUESTS = "bunk_requests"
ORIGINAL_BUNK_REQUESTS = "original_bunk_requests"

# Solver
SOLVER_RUNS = "solver_runs"
SAVED_SCENARIOS = "saved_scenarios"

# Metrics & snapshots
ENROLLMENT_SNAPSHOTS = "enrollment_snapshots"
ATTENDEE_STATUS_HISTORY = "attendee_status_history"
CONFIG = "config"

# Geo
SESSIONS = "sessions"
NORMALIZED_MAPPINGS = "normalized_mappings"
GEO_OVERRIDES = "geo_overrides"

# Households
HOUSEHOLD_CUSTOM_VALUES = "household_custom_values"
FIELD_DEFINITIONS = "field_definitions"

# Pipeline debug
DEBUG_PIPELINE_RUNS = "debug_pipeline_runs"
DEBUG_PIPELINE_SUMMARY = "debug_pipeline_summary"
DEBUG_PIPELINE_TRACES = "debug_pipeline_traces"

# Auth
SUPERUSERS = "_superusers"
