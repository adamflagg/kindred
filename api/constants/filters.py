"""PocketBase filter constants.

Centralizes commonly repeated filter expressions used across the API.
Import and use these instead of building filter strings inline.
"""

# Standard filter for active enrolled attendees.
# Attendees with status_id = 2 are enrolled (see CampMinder StatusID mapping
# in pocketbase/sync/attendees.go). This replaces the legacy "is_active = 1 && status_id = 2"
# pattern — status_id = 2 is the single source of truth for enrollment status.
ACTIVE_ENROLLED_FILTER = "status_id = 2"
