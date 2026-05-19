"""Constants for the bunk request processing system.

This module centralizes all magic strings, field mappings, and patterns
to ensure consistency across the codebase and make maintenance easier.

Single source of truth for:
- Field name mappings (CSV keys → database source_field values)
- Placeholder strings
- Pattern matching for no-preference detection
- Field groupings for processing
"""

from __future__ import annotations

import re
from re import Pattern

# =============================================================================
# Status Constants
# =============================================================================

# CampMinder attendee status IDs — used in session enrollment filtering
ENROLLED_STATUS_ID = 2  # Active enrolled attendee

# All CampMinder attendee StatusID values (from docs/api/external/campminder/specs/sessions.yaml)
# Used by EnrollmentInfo for disposition decisions
STATUS_NONE = 1
STATUS_ENROLLED = 2
STATUS_APPLIED = 4
STATUS_WAITLISTED = 8
STATUS_LEFT_EARLY = 16
STATUS_CANCELLED = 32
STATUS_DISMISSED = 64
STATUS_INQUIRY = 128
STATUS_WITHDRAWN = 256
STATUS_INCOMPLETE = 512

# Groupings for disposition logic
ACTIVE_ENROLLMENT_STATUSES: frozenset[int] = frozenset({STATUS_ENROLLED})
PENDING_ENROLLMENT_STATUSES: frozenset[int] = frozenset({STATUS_WAITLISTED, STATUS_APPLIED, STATUS_INQUIRY})
INACTIVE_ENROLLMENT_STATUSES: frozenset[int] = frozenset(
    {STATUS_CANCELLED, STATUS_DISMISSED, STATUS_WITHDRAWN, STATUS_INCOMPLETE, STATUS_NONE, STATUS_LEFT_EARLY}
)

# =============================================================================
# Placeholder Constants
# =============================================================================

# Cabin unit names — targets matching these are cabin units, not people.
# Matches current camp's Tier 1 division entries. Update if units change.
UNIT_NAMES: set[str] = {"nitzanim", "galil", "eilat", "haifa", "chalutzim", "carmel"}

# Age preference values accepted as valid target_name values.
VALID_AGE_TARGETS: set[str] = {
    "older",
    "younger",
    "unclear",
}


# =============================================================================
# Field Name Mappings
# =============================================================================


# Canonical source field names as stored in the bunk_requests table
# V2 internal names — used everywhere post-CSV-import
class SourceField:
    """Canonical source field values — V2 internal names used everywhere post-CSV-import.

    Six values describe input channels (parent CSV form, staff CSV form, AI-parsed
    notes, admin UI). MANUAL is the admin-UI input channel for staff-created
    requests via CreateRequestModal. All non-parent channels project to "staff" via
    source_from_field().

    Python attribute names AND string values both disambiguate from RequestType
    (#1246 + Phase 1 of source/type co-evolution): each name and value uniquely
    identifies the form field of origin, with no overlap with RequestType values
    ("bunk_with", "not_bunk_with").
    """

    BUNK_REQUEST_FORM = "bunk_request_form"
    STAFF_NOT_BUNK_WITH = "staff_not_bunk_with"
    BUNKING_NOTES = "bunking_notes"
    INTERNAL_NOTES = "internal_notes"
    SOCIALIZE_WITH = "socialize_with"
    MANUAL = "manual"


# Mapping from SourceField values to solver config schema keys
# Used by solver files to look up objective.source_multipliers.* config values
SOURCE_FIELD_TO_CONFIG_KEY: dict[str, str] = {
    SourceField.BUNK_REQUEST_FORM: "share_bunk_with",
    SourceField.STAFF_NOT_BUNK_WITH: "do_not_share_with",
    SourceField.BUNKING_NOTES: "bunking_notes",
    SourceField.INTERNAL_NOTES: "internal_notes",
    SourceField.SOCIALIZE_WITH: "socialize_preference",
}

# =============================================================================
# Field Groupings
# =============================================================================

# All fields that need processing
ALL_PROCESSING_FIELDS: list[str] = [
    SourceField.BUNK_REQUEST_FORM,
    SourceField.STAFF_NOT_BUNK_WITH,
    SourceField.BUNKING_NOTES,
    SourceField.INTERNAL_NOTES,
    SourceField.SOCIALIZE_WITH,
]

# Fields that need AI processing (complex text parsing)
AI_PROCESSING_FIELDS: list[str] = [
    SourceField.BUNK_REQUEST_FORM,
    SourceField.STAFF_NOT_BUNK_WITH,
    SourceField.BUNKING_NOTES,
    SourceField.INTERNAL_NOTES,
]

# Fields that can be parsed directly without AI (simple dropdown values)
DIRECT_PARSE_FIELDS: list[str] = ["socialize_with"]

# Notes fields — additive across uploads, not superseding.
# Used to scope temporal conflict filtering (ADR 4) and staff name detection (ADR 6).
NOTES_FIELDS: frozenset[str] = frozenset({SourceField.BUNKING_NOTES, SourceField.INTERNAL_NOTES})


# =============================================================================
# No-Preference Detection Patterns
# =============================================================================

# Patterns that indicate "no preference" - entire field value must match
# These are used to skip processing for fields that don't contain actual requests
NO_PREFERENCE_PATTERNS: list[Pattern[str]] = [
    re.compile(r"^no bunk requests?$", re.IGNORECASE),
    re.compile(r"^no preference$", re.IGNORECASE),
    re.compile(r"^none$", re.IGNORECASE),
    re.compile(r"^n/a$", re.IGNORECASE),
    re.compile(r"^na$", re.IGNORECASE),
]


def is_no_preference(text: str) -> bool:
    """Check if text indicates 'no preference' and should be skipped.

    Args:
        text: The text to check (usually from a CSV field)

    Returns:
        True if the text is a 'no preference' indicator that should be skipped
    """
    if not text:
        return False

    text = text.strip()
    return any(pattern.match(text) for pattern in NO_PREFERENCE_PATTERNS)


# Pattern to match N/A prefix with separator and trailing content
# Captures the text after the N/A prefix for continued processing
# Examples: "N/A; their own grade/younger" -> "their own grade/younger"
#           "N/A- same age or older" -> "same age or older"
NA_PREFIX_PATTERN: Pattern[str] = re.compile(r"^n/?a\s*[;:\-\u2013\u2014,]\s*(.+)$", re.IGNORECASE)


def strip_na_prefix(text: str) -> str | None:
    """Strip N/A prefix from text, returning the trailing content.

    When a field starts with "N/A" followed by a separator (;, -, \u2014, etc.)
    and additional text, returns just the trailing text for AI parsing.
    This prevents the AI from hallucinating names from "N/A" inputs.

    Args:
        text: The field value to check

    Returns:
        The trailing text after N/A prefix, or None if no match
    """
    if not text:
        return None

    text = text.strip()
    match = NA_PREFIX_PATTERN.match(text)
    if match:
        return match.group(1).strip() or None
    return None


# =============================================================================
# Source Field Validation
# =============================================================================


def validate_source_fields(fields: list[str]) -> list[str]:
    """Validate and normalize source field names.

    Used by CLI and API to validate --source-field arguments before processing.
    Empty list is valid (means "all fields" - caller handles default).

    Args:
        fields: List of field names to validate

    Returns:
        List of validated field names (unchanged if valid)

    Raises:
        ValueError: If any field name is invalid

    Examples:
        >>> validate_source_fields(["bunk_request_form", "staff_not_bunk_with"])
        ["bunk_request_form", "staff_not_bunk_with"]
        >>> validate_source_fields([])
        []
        >>> validate_source_fields(["invalid"])  # raises ValueError
    """
    if not fields:
        return fields

    invalid = set(fields) - set(ALL_PROCESSING_FIELDS)
    if invalid:
        raise ValueError(f"Invalid source field(s): {invalid}. Valid options: {ALL_PROCESSING_FIELDS}")

    return fields


# =============================================================================
# Unresolved Person ID Range
# =============================================================================

# Range for generated unresolved person IDs
# These are negative to distinguish from real person IDs
UNRESOLVED_ID_MIN = -1_000_000_000
UNRESOLVED_ID_MAX = -1_000_000
UNRESOLVED_ID_DEFAULT = -1_000_000  # Default for empty names
