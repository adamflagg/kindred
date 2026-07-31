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
NORMALIZED_MAPPINGS = "normalized_mappings"
GEO_OVERRIDES = "geo_overrides"

# Households
HOUSEHOLD_CUSTOM_VALUES = "household_custom_values"
FIELD_DEFINITIONS = "field_definitions"

# Households & family-camp derived profile data
HOUSEHOLDS = "households"
FAMILY_CAMP_ADULTS = "family_camp_adults"
FAMILY_CAMP_REGISTRATIONS = "family_camp_registrations"
FAMILY_CAMP_MEDICAL = "family_camp_medical"

# CampMinder custom-field values
PERSON_CUSTOM_VALUES = "person_custom_values"
CUSTOM_FIELD_DEFS = "custom_field_defs"

# Weekend lodging registry
LODGING_AREAS = "lodging_areas"
LODGING_UNITS = "lodging_units"
LODGING_UNIT_ALIASES = "lodging_unit_aliases"
LODGING_MERGES = "lodging_merges"
LODGING_AVAILABILITY = "lodging_availability"
LODGING_ASSIGNMENTS = "lodging_assignments"
LODGING_ASSIGNMENT_HISTORY = "lodging_assignment_history"

# The single work queue for cabin strings ingest could not resolve. Owned and
# solely written by the ingest layer; the admin UI reads it filtered to
# kind = "unresolved_alias". Deliberately NOT a second surfaces-only collection.
LODGING_INGEST_ISSUES = "lodging_ingest_issues"

# Pipeline debug
DEBUG_PIPELINE_RUNS = "debug_pipeline_runs"
DEBUG_PIPELINE_SUMMARY = "debug_pipeline_summary"
DEBUG_PIPELINE_TRACES = "debug_pipeline_traces"

# Auth
SUPERUSERS = "_superusers"
