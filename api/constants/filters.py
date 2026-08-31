"""PocketBase filter constants.

Centralizes commonly repeated filter expressions used across the API.
Import and use these instead of building filter strings inline.
"""

# The CampMinder StatusID that means enrolled (see the mapping in
# pocketbase/sync/attendees.go). Named separately from the filter below
# because one read applies enrollment IN PYTHON rather than in the query:
# `fetch_household_family_attendees` must return cancelled rows so the
# household journey can tell a cancelled child (a stale cabin string) from no
# child at all (a paper registration) — see kindred#2516. Comparing against a
# bare `2` there would be the same constant spelled twice.
ACTIVE_ENROLLED_STATUS_ID = 2

# Standard filter for active enrolled attendees.
# Attendees with status_id = 2 are enrolled (see CampMinder StatusID mapping
# in pocketbase/sync/attendees.go). This replaces the legacy "is_active = 1 && status_id = 2"
# pattern — status_id = 2 is the single source of truth for enrollment status.
# Derived from the id above so the two cannot drift apart.
ACTIVE_ENROLLED_FILTER = f"status_id = {ACTIVE_ENROLLED_STATUS_ID}"
