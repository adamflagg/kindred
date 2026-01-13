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
# Placeholder Constants
# =============================================================================

# Placeholder for requests to bunk with prior year bunkmates.
# When a parent says "keep with last year's bunk", the AI returns this.
# This placeholder is expanded to individual bunk_with requests by the orchestrator.
LAST_YEAR_BUNKMATES_PLACEHOLDER = "LAST_YEAR_BUNKMATES"

# Placeholder for sibling/twin/family member references.
# When text says "twins", "my sister", "siblings", etc., the AI returns this.
# This placeholder is expanded to actual sibling(s) via household_id lookup.
SIBLING_PLACEHOLDER = "SIBLING"


# =============================================================================
# Field Name Mappings
# =============================================================================


# Canonical source field names as stored in the bunk_requests table
# These match the original CampMinder/CSV column names
class SourceField:
    """Canonical source field values for bunk_requests.source_field"""

    BUNK_WITH = "Share Bunk With"
    NOT_BUNK_WITH = "Do Not Share Bunk With"
    BUNKING_NOTES = "BunkingNotes Notes"
    INTERNAL_NOTES = "Internal Bunk Notes"
    SOCIALIZE_WITH = "RetParent-Socializewithbest"


# Map from original_bunk_requests.field values to bunk_requests.source_field
# Used when loading from the original_bunk_requests table
FIELD_TO_SOURCE_FIELD: dict[str, str] = {
    "bunk_with": SourceField.BUNK_WITH,
    "not_bunk_with": SourceField.NOT_BUNK_WITH,
    "bunking_notes": SourceField.BUNKING_NOTES,
    "internal_notes": SourceField.INTERNAL_NOTES,
    "socialize_with": SourceField.SOCIALIZE_WITH,
}

# Map from raw CSV column keys to bunk_requests.source_field
# Used when processing raw CSV data directly
CSV_KEY_TO_SOURCE_FIELD: dict[str, str] = {
    "share_bunk_with": SourceField.BUNK_WITH,
    "do_not_share_bunk_with": SourceField.NOT_BUNK_WITH,
    "bunking_notes_notes": SourceField.BUNKING_NOTES,
    "internal_bunk_notes": SourceField.INTERNAL_NOTES,
    "ret_parent_socialize_with_best": SourceField.SOCIALIZE_WITH,
}

# Combined mapping for both original_bunk_requests.field and CSV column keys
# This is the complete mapping used by the orchestrator
ALL_FIELD_TO_SOURCE_FIELD: dict[str, str] = {
    **FIELD_TO_SOURCE_FIELD,
    **CSV_KEY_TO_SOURCE_FIELD,
}

# Ordered list of (csv_key, source_field) tuples for iteration
# Used in _prepare_parse_requests to check fields in consistent order
FIELDS_TO_CHECK: list[tuple[str, str]] = [
    ("share_bunk_with", SourceField.BUNK_WITH),
    ("do_not_share_bunk_with", SourceField.NOT_BUNK_WITH),
    ("bunking_notes_notes", SourceField.BUNKING_NOTES),
    ("internal_bunk_notes", SourceField.INTERNAL_NOTES),
    ("ret_parent_socialize_with_best", SourceField.SOCIALIZE_WITH),
]


# =============================================================================
# Field Groupings
# =============================================================================

# All fields that need processing
ALL_PROCESSING_FIELDS: list[str] = [
    "bunk_with",
    "not_bunk_with",
    "bunking_notes",
    "internal_notes",
    "socialize_with",
]

# Fields that need AI processing (complex text parsing)
AI_PROCESSING_FIELDS: list[str] = [
    "bunk_with",
    "not_bunk_with",
    "bunking_notes",
    "internal_notes",
]

# Fields that can be parsed directly without AI (simple dropdown values)
DIRECT_PARSE_FIELDS: list[str] = ["socialize_with"]


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
        >>> validate_source_fields(["bunk_with", "not_bunk_with"])
        ["bunk_with", "not_bunk_with"]
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
