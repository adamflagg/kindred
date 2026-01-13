"""Self-reference validation rule.

Detects and flags requests where a camper is requesting themselves."""

from __future__ import annotations

from ...core.models import BunkRequest
from ..interfaces import ValidationResult, ValidationRule


class SelfReferenceRule(ValidationRule):
    """Validates that requests are not self-referential"""

    @property
    def name(self) -> str:
        """Name of the validation rule"""
        return "self_reference"

    @property
    def priority(self) -> int:
        """High priority - check this early"""
        return 100

    def validate(self, request: BunkRequest) -> ValidationResult:
        """Check if request is self-referential.

        Self-referential means:
        1. Requester CM ID = Requested CM ID
        2. For placeholders or unresolved requests, check if raw names match exactly

        Args:
            request: The request to validate

        Returns:
            ValidationResult indicating if request is self-referential
        """
        result = ValidationResult(is_valid=True)

        # Check if both CM IDs exist and match
        if request.requester_cm_id and request.requested_cm_id:
            if request.requester_cm_id == request.requested_cm_id:
                result.add_error(
                    f"Self-referential request: requester CM ID {request.requester_cm_id} matches requested CM ID"
                )
                result.metadata["self_ref_type"] = "cm_id_match"
                return result

        # For placeholders or when requested_cm_id is not resolved,
        # check if the raw target name matches requester's name
        if request.is_placeholder and "raw_target_name" in request.metadata:
            raw_name = request.metadata.get("raw_target_name", "").strip().lower()
            requester_name = request.metadata.get("requester_full_name", "").strip().lower()

            # Only flag if full names match exactly (not just first names)
            if raw_name and requester_name and raw_name == requester_name:
                result.add_error(f"Self-referential request: target name '{raw_name}' matches requester's full name")
                result.metadata["self_ref_type"] = "full_name_match"
                return result

            # If target is first-name-only and matches requester's first name,
            # check if other session peers share that first name.
            # If no others have the name, it's likely self-referential.
            requester_first_name = request.metadata.get("requester_first_name", "").strip().lower()

            # Check if this is a first-name-only target (no space)
            if raw_name and " " not in raw_name and requester_first_name:
                if raw_name == requester_first_name:
                    # First name matches - check for ambiguity via session peers
                    peers_with_same_first_name = request.metadata.get("session_peers_with_same_first_name")

                    # Only flag if we KNOW there are no other people with this
                    # first name in the session (peers == 0).
                    # If metadata is missing, be conservative and allow it.
                    # Note: This could be self-referential OR the target could be
                    # in a different session - either way, we can't resolve it.
                    if peers_with_same_first_name is not None and peers_with_same_first_name == 0:
                        result.add_error(
                            f"Unresolvable first-name-only request: target '{raw_name}' "
                            f"matches requester's first name and no other session "
                            f"attendees share this name"
                        )
                        result.metadata["self_ref_type"] = "unresolvable_first_name"
                        return result

        # Check if this is flagged as auto-correctable
        if request.metadata.get("possible_self_reference"):
            result.add_warning("Possible self-reference detected but not confirmed. Manual review recommended.")
            result.metadata["needs_review"] = True

        return result

    def can_short_circuit(self, result: ValidationResult) -> bool:
        """Self-referential requests should stop validation immediately.

        Args:
            result: The validation result

        Returns:
            True if validation should stop
        """
        # Always short-circuit on self-reference errors
        return not result.is_valid
