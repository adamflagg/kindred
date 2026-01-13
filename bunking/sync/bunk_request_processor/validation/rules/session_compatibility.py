"""Session compatibility validation rule.

Ensures requests are only made within the same exact session."""

from __future__ import annotations

from ...core.models import BunkRequest
from ...data.repositories import AttendeeRepository
from ...data.repositories.session_repository import SessionRepository
from ..interfaces import ValidationResult, ValidationRule


class SessionCompatibilityRule(ValidationRule):
    """Validates that requests are within the same exact session"""

    def __init__(
        self,
        attendee_repository: AttendeeRepository,
        session_repository: SessionRepository | None = None,
    ):
        """Initialize with repositories.

        Args:
            attendee_repository: Repository for attendee data access
            session_repository: Optional repository for session name lookup
        """
        self.attendee_repo = attendee_repository
        self._session_repo = session_repository
        self._session_cache: dict[tuple[int, int], int | None] = {}

    def _get_session_name(self, session_cm_id: int) -> str:
        """Get friendly name for a session CM ID."""
        if self._session_repo:
            return self._session_repo.get_friendly_name(session_cm_id)
        # Fallback when no repository available
        return f"Session {session_cm_id}"

    @property
    def name(self) -> str:
        """Name of the validation rule"""
        return "session_compatibility"

    @property
    def priority(self) -> int:
        """High priority - check this early"""
        return 90

    def validate(self, request: BunkRequest) -> ValidationResult:
        """Validate that both requester and requested are in the same exact session.

        Args:
            request: The request to validate

        Returns:
            ValidationResult indicating if sessions are compatible
        """
        result = ValidationResult(is_valid=True)

        # Skip validation for placeholders or when requested_cm_id is missing
        if request.is_placeholder or not request.requested_cm_id:
            return result

        # Skip validation for age preference requests (no target)
        if not request.requested_cm_id:
            return result

        # Get sessions for both people
        requester_session = self._get_person_session(request.requester_cm_id, request.year)
        requested_session = self._get_person_session(request.requested_cm_id, request.year)

        # If we can't find session info for either, add warning but don't fail
        if requester_session is None:
            result.add_warning(f"Could not find session info for requester {request.requester_cm_id}")
            result.metadata["requester_session_missing"] = True
            return result

        if requested_session is None:
            result.add_warning(f"Could not find session info for requested person {request.requested_cm_id}")
            result.metadata["requested_session_missing"] = True
            return result

        # Check if sessions match exactly
        if requester_session != requested_session:
            requester_session_name = self._get_session_name(requester_session)
            requested_session_name = self._get_session_name(requested_session)

            result.add_error(
                f"Cross-session request not allowed: requester in {requester_session_name} "
                f"({requester_session}), requested in {requested_session_name} ({requested_session})"
            )
            result.metadata["requester_session"] = requester_session
            result.metadata["requested_session"] = requested_session
            result.metadata["session_names"] = {
                "requester": requester_session_name,
                "requested": requested_session_name,
            }

            # Mark for conversion to declined status
            result.requires_conversion = True
            result.conversion_reason = "cross_session_request"
        else:
            # Sessions match - add metadata for reference
            result.metadata["session_cm_id"] = requester_session
            result.metadata["session_name"] = self._get_session_name(requester_session)

        return result

    def _get_person_session(self, person_cm_id: int, year: int) -> int | None:
        """Get session for a person, with caching.

        Args:
            person_cm_id: The person's CM ID
            year: The year to check

        Returns:
            Session CM ID or None if not found
        """
        cache_key = (person_cm_id, year)

        if cache_key in self._session_cache:
            return self._session_cache[cache_key]

        # Look up in repository
        attendee_info = self.attendee_repo.get_by_person_and_year(person_cm_id, year)

        if attendee_info:
            session_cm_id = attendee_info.get("session_cm_id")
            self._session_cache[cache_key] = session_cm_id
            return session_cm_id

        self._session_cache[cache_key] = None
        return None

    def can_short_circuit(self, result: ValidationResult) -> bool:
        """Cross-session requests should be converted to declined status.

        Args:
            result: The validation result

        Returns:
            True if validation should stop
        """
        # Don't short-circuit on warnings (missing session info)
        # Only short-circuit on actual cross-session errors
        return not result.is_valid and result.requires_conversion
