"""Request Type Validator Based on Source Field

Ensures that certain source fields enforce specific request types:
- Do Not Share Bunk With → MUST produce NOT_BUNK_WITH
- Flexible fields (Share Bunk With, BunkingNotes, Internal Bunk Notes) can produce any valid type

If AI returns the wrong type for a strict field, this validator corrects it."""

from bunking.logging_config import get_logger

from ..core.models import ParsedRequest, RequestType
from ..shared.constants import SourceField

logger = get_logger(__name__)


# Fields with strict type requirements
STRICT_FIELD_TYPES = {
    SourceField.STAFF_NOT_BUNK_WITH: RequestType.NOT_BUNK_WITH,
}

# Fields that can produce any request type
FLEXIBLE_FIELDS = {SourceField.BUNK_REQUEST_FORM, SourceField.BUNKING_NOTES, SourceField.INTERNAL_NOTES}

# Request types that require a target_name
TYPES_REQUIRING_TARGET = {RequestType.BUNK_WITH, RequestType.NOT_BUNK_WITH}


def validate_request_type_for_field(parsed: ParsedRequest) -> ParsedRequest | None:
    """Validate that request type matches the source field intent.

    This is a safety net for AI parsing - if AI returns the wrong type for a
    field with strict requirements, we correct it here.

    Args:
        parsed: The parsed request to validate

    Returns:
        The validated request (possibly with corrected type) or None if invalid
    """
    source_field = parsed.source_field

    # Check if field has strict type requirements
    if source_field in STRICT_FIELD_TYPES:
        expected_type = STRICT_FIELD_TYPES[source_field]

        # Validate structural requirements
        # NOT_BUNK_WITH and BUNK_WITH require a target name
        if expected_type in TYPES_REQUIRING_TARGET and not parsed.target_name:
            logger.warning(
                f"Cannot convert {parsed.request_type} to {expected_type} "
                f"from field {source_field} - no target name provided"
            )
            return None

        # Correct the type if needed
        if parsed.request_type != expected_type:
            logger.warning(
                f"Request type mismatch: {parsed.request_type} from field {source_field} "
                f"(target: {parsed.target_name or 'none'}). Correcting to {expected_type}"
            )

            # Create corrected request with new type and note about correction
            original_type = parsed.request_type
            parsed.request_type = expected_type

            # Add note about the correction
            correction_note = f"Corrected request type from {original_type} to {expected_type} based on source field."
            if parsed.notes:
                parsed.notes = f"{correction_note} {parsed.notes}"
            else:
                parsed.notes = correction_note

    elif source_field in FLEXIBLE_FIELDS:
        # For flexible fields, only validate structural requirements
        if parsed.request_type in TYPES_REQUIRING_TARGET and not parsed.target_name:
            logger.warning(f"Invalid {parsed.request_type} request without target name from {source_field} - skipping")
            return None

        # Log unusual but valid combinations for observability
        if source_field == SourceField.BUNK_REQUEST_FORM and parsed.request_type != RequestType.BUNK_WITH:
            logger.info(f"AI parsed {parsed.request_type} from {source_field} field - respecting AI decision")

    return parsed
