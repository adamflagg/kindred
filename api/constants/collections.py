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
LOCKED_GROUPS = "locked_groups"
LOCKED_GROUP_MEMBERS = "locked_group_members"

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
LODGING_AVAILABILITY = "lodging_availability"
LODGING_ASSIGNMENTS = "lodging_assignments"
LODGING_ASSIGNMENT_HISTORY = "lodging_assignment_history"

# The draft grain (1500000132). Staff write THIS; the ingest keeps sole
# ownership of the row above, which stays admin-only. Same split summer draws
# between bunk_assignments and bunk_assignments_draft, and the reason scenario
# is a column here and not on the table it mirrors: scenario is a property of
# planning, not of record.
#
# `lodging_merges` and `lodging_merges_draft` no longer exist: 1500000134
# collapsed the `unit` / `merge` / `merge_draft` placement targets into one
# multi-valued `units` relation on this table and deleted both collections.
LODGING_ASSIGNMENTS_DRAFT = "lodging_assignments_draft"

# A container's override of its draw level (1500000139), at a scenario or at
# the weekend. Absent row at either tier means inherit -- see resolve_combined
# in lodging_roster_service.py. `scenario` is OPTIONAL (1500000140): `""` is
# the WEEKEND-LEVEL row, seen on the CampMinder mirror and inherited by every
# scenario, because a merge is a fact about the weekend and not only about a
# plan.
LODGING_SLOT_MERGES = "lodging_slot_merges"

# Write-in OCCUPANCY -- who is in a room that the roster does not otherwise
# know about (1500000161, kindred#2382). Split out of `lodging_availability`,
# which conflated two unrelated questions in one boolean: `family_available`
# true on a staff cabin is a staff<->family ROLE override for the weekend, and
# false is an occupancy. The owner ruled (2026-08-15) that the ROLE is NOT
# scenario-scoped -- it is an operational fact, "we're moving staff to X for
# weekend Y" -- while an occupancy IS, because not every write-in is
# non-rostered staff: some are paper registrations for families arriving with
# no children, and that is a modelling choice belonging to the scenario that
# made it.
#
# So availability keeps only the role half, and occupancy gets a live+draft
# pair beside LODGING_ASSIGNMENTS / LODGING_ASSIGNMENTS_DRAFT -- the same split
# between record and plan, and for the same reason. A nullable `scenario`
# sentinel was explicitly rejected: it is the shape lodging_assignments dropped
# because it "was dead weight that invited a `scenario != \"\"` write rule
# instead of a draft table."
LODGING_WRITE_INS = "lodging_write_ins"
LODGING_WRITE_INS_DRAFT = "lodging_write_ins_draft"

# The single work queue for cabin strings ingest could not resolve. Owned and
# solely written by the ingest layer; the admin UI reads it filtered to
# kind = "unresolved_alias". Deliberately NOT a second surfaces-only collection.
LODGING_INGEST_ISSUES = "lodging_ingest_issues"

# The staff-owned weekend status (1500000142, kindred#2092). CampMinder's
# Sessions API exposes no status or registration-availability concept, so
# NOTHING SYNCS THIS -- it is the one lodging table with no upstream at all.
# Keyed on (session_cm_id, year) rather than a camp_sessions relation, so a
# weekend that drops out of a CampMinder response does not take its own
# cancellation with it. ABSENCE OF A ROW MEANS ACTIVE; the migration seeds
# nothing.
LODGING_SESSION_STATUS = "lodging_session_status"

# Staff-authored friend groups at HOUSEHOLD grain (1500000146, kindred#1913).
# No scenario dimension, unlike summer's locked_groups: a group records what
# households asked for, which is true of the weekend in every plan for it.
LODGING_FRIEND_GROUPS = "lodging_friend_groups"
LODGING_FRIEND_GROUP_MEMBERS = "lodging_friend_group_members"

# Pipeline debug
DEBUG_PIPELINE_RUNS = "debug_pipeline_runs"
DEBUG_PIPELINE_SUMMARY = "debug_pipeline_summary"
DEBUG_PIPELINE_TRACES = "debug_pipeline_traces"

# Auth
SUPERUSERS = "_superusers"
