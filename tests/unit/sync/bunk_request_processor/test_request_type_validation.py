"""TDD Tests for Request Type Validation Based on Source Field

This ensures that certain source fields enforce specific request types:
- do_not_share_with field → MUST produce NOT_BUNK_WITH requests (never BUNK_WITH)
- socialize_preference field → MUST produce AGE_PREFERENCE requests

If AI returns the wrong type for a strict field, the orchestrator should correct it."""

from __future__ import annotations

from bunking.sync.bunk_request_processor.core.models import (
    AgePreference,
    ParsedRequest,
    RequestSource,
    RequestType,
)


class TestRequestTypeValidationForSourceField:
    """Tests that request types are validated and corrected based on source field.

    - do_not_share_with field → always NOT_BUNK_WITH
    - socialize_preference field → always AGE_PREFERENCE
    - Flexible fields (share_bunk_with, bunking_notes, internal_notes) → any type allowed
    """

    def test_do_not_share_with_field_with_wrong_type_is_corrected(self):
        """If AI returns BUNK_WITH from do_not_share_with field, it should be
        corrected to NOT_BUNK_WITH.

        This is a safety net - the AI prompt tells it to return only not_bunk_with,
        but if it makes a mistake, we should catch and correct it.
        """
        # Arrange: Create a parsed request with wrong type for do_not_share_with field
        parsed = ParsedRequest(
            raw_text="Not with Jake Smith",
            request_type=RequestType.BUNK_WITH,  # WRONG - should be NOT_BUNK_WITH
            target_name="Jake Smith",
            age_preference=None,
            source_field="do_not_share_with",  # This field should ONLY produce NOT_BUNK_WITH
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )

        # Act: Validate the request type
        from bunking.sync.bunk_request_processor.validation.request_type_validator import (
            validate_request_type_for_field,
        )

        validated = validate_request_type_for_field(parsed)

        # Assert: Type should be corrected to NOT_BUNK_WITH
        assert validated is not None, "Validated request should not be None"
        assert validated.request_type == RequestType.NOT_BUNK_WITH, (
            f"Request type should be corrected to NOT_BUNK_WITH, got {validated.request_type}"
        )

    def test_do_not_share_with_field_with_correct_type_is_unchanged(self):
        """If AI returns NOT_BUNK_WITH from do_not_share_with field (correct behavior),
        the request should pass through unchanged.
        """
        # Arrange
        parsed = ParsedRequest(
            raw_text="Please not with Jake",
            request_type=RequestType.NOT_BUNK_WITH,  # CORRECT
            target_name="Jake Smith",
            age_preference=None,
            source_field="do_not_share_with",
            source=RequestSource.FAMILY,
            confidence=0.90,
            csv_position=0,
            metadata={},
        )

        # Act
        from bunking.sync.bunk_request_processor.validation.request_type_validator import (
            validate_request_type_for_field,
        )

        validated = validate_request_type_for_field(parsed)

        # Assert
        assert validated is not None
        assert validated.request_type == RequestType.NOT_BUNK_WITH
        assert validated.target_name == "Jake Smith"

    def test_do_not_share_with_without_target_name_returns_none(self):
        """If do_not_share_with produces a request without a target name,
        it should be rejected (return None) since NOT_BUNK_WITH requires a target.
        """
        # Arrange
        parsed = ParsedRequest(
            raw_text="General note about bunking",
            request_type=RequestType.BUNK_WITH,
            target_name=None,  # No target - invalid for not_bunk_with
            age_preference=None,
            source_field="do_not_share_with",
            source=RequestSource.FAMILY,
            confidence=0.50,
            csv_position=0,
            metadata={},
        )

        # Act
        from bunking.sync.bunk_request_processor.validation.request_type_validator import (
            validate_request_type_for_field,
        )

        validated = validate_request_type_for_field(parsed)

        # Assert: Should be rejected
        assert validated is None, "Request without target name from do_not_share_with should be None"

    def test_flexible_field_allows_any_type(self):
        """Flexible fields (share_bunk_with, bunking_notes, internal_notes) can produce
        any valid request type - BUNK_WITH, NOT_BUNK_WITH, AGE_PREFERENCE, etc.
        """
        # Arrange: NOT_BUNK_WITH from share_bunk_with (unusual but valid)
        parsed = ParsedRequest(
            raw_text="Please not with Jake - mentioned in bunk preferences",
            request_type=RequestType.NOT_BUNK_WITH,
            target_name="Jake Smith",
            age_preference=None,
            source_field="share_bunk_with",  # Flexible field
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=0,
            metadata={},
        )

        # Act
        from bunking.sync.bunk_request_processor.validation.request_type_validator import (
            validate_request_type_for_field,
        )

        validated = validate_request_type_for_field(parsed)

        # Assert: Should pass through unchanged
        assert validated is not None
        assert validated.request_type == RequestType.NOT_BUNK_WITH
        assert validated.source_field == "share_bunk_with"

    def test_flexible_field_without_target_for_bunk_type_returns_none(self):
        """Even for flexible fields, BUNK_WITH and NOT_BUNK_WITH require a target name.
        If missing, the request should be rejected.
        """
        # Arrange
        parsed = ParsedRequest(
            raw_text="General bunking preference note",
            request_type=RequestType.BUNK_WITH,
            target_name=None,  # No target - invalid for bunk_with
            age_preference=None,
            source_field="bunking_notes",
            source=RequestSource.NOTES,
            confidence=0.60,
            csv_position=0,
            metadata={},
        )

        # Act
        from bunking.sync.bunk_request_processor.validation.request_type_validator import (
            validate_request_type_for_field,
        )

        validated = validate_request_type_for_field(parsed)

        # Assert
        assert validated is None, "bunk_with without target_name should be None"


class TestSocializePreferenceFieldValidation:
    """Tests for socialize_preference (ret_parent_socialize_with_best) field validation.

    This field should ONLY produce AGE_PREFERENCE requests.
    Note: This is currently handled by direct parsing in _parse_socialize_preference,
    not by AI, so this is more of a safety check.
    """

    def test_socialize_preference_always_age_preference(self):
        """Socialize preference field should always produce AGE_PREFERENCE type.
        If somehow a different type is returned, it should be corrected.
        """
        # Arrange: Wrong type from socialize_preference
        parsed = ParsedRequest(
            raw_text="Kids their own grade and one grade above",
            request_type=RequestType.BUNK_WITH,  # WRONG
            target_name=None,
            age_preference=AgePreference.OLDER,
            source_field="socialize_preference",
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=0,
            metadata={},
        )

        # Act
        from bunking.sync.bunk_request_processor.validation.request_type_validator import (
            validate_request_type_for_field,
        )

        validated = validate_request_type_for_field(parsed)

        # Assert
        assert validated is not None
        assert validated.request_type == RequestType.AGE_PREFERENCE
