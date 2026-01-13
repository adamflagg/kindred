"""Test-Driven Development for RequestBuilder

Tests the request construction logic."""

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    ParsedRequest,
    Person,
    RequestSource,
    RequestStatus,
    RequestType,
    ResolvedName,
)
from bunking.sync.bunk_request_processor.processing.request_builder import (
    RequestBuilder,
    RequestBuilderOptions,
)


class TestRequestBuilder:
    """Test the RequestBuilder factory"""

    @pytest.fixture
    def validation_pipeline(self):
        """Create a mock validation pipeline"""
        mock = Mock()
        mock.validate.return_value = Mock(is_valid=True, errors=[], warnings=[])
        return mock

    @pytest.fixture
    def builder(self, validation_pipeline):
        """Create a RequestBuilder with mocked dependencies"""
        return RequestBuilder(validation_pipeline)

    @pytest.fixture
    def default_options(self):
        """Create default builder options"""
        return RequestBuilderOptions(session_cm_id=1000002, year=2025, csv_position=1)

    @pytest.fixture
    def parsed_request(self):
        """Create a sample parsed request"""
        return ParsedRequest(
            raw_text="Jane Smith",
            target_name="Jane Smith",
            request_type=RequestType.BUNK_WITH,
            age_preference=None,
            confidence=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=1,
            metadata={"requester_cm_id": 12345, "full_name": "John Doe", "age": 10, "grade": 5},
            notes=None,
        )

    @pytest.fixture
    def resolved_name(self):
        """Create a sample resolved name"""
        # Create a mock Person object
        person = Person(cm_id=67890, first_name="Jane", last_name="Smith", session_cm_id=1000002)

        return ResolvedName(
            original_name="Jane Smith",
            matched_cm_id=67890,
            matched_person=person,
            confidence=0.92,
            resolution_method="exact_match",
            alternate_matches=[],
        )

    def test_build_resolved_request(self, builder, parsed_request, resolved_name, default_options):
        """Test building a fully resolved request"""
        # Add priority to metadata
        parsed_request.metadata["priority"] = 3

        request = builder.build(parsed_request=parsed_request, resolved_name=resolved_name, options=default_options)

        assert isinstance(request, BunkRequest)
        assert request.requester_cm_id == 12345
        assert request.requested_cm_id == 67890
        assert request.request_type == RequestType.BUNK_WITH
        assert request.session_cm_id == 1000002
        assert request.priority == 3
        assert request.confidence_score == 0.92  # Uses resolved confidence
        assert request.source == RequestSource.FAMILY
        assert request.source_field == "share_bunk_with"
        assert request.csv_position == 1
        assert request.year == 2025
        assert request.status == RequestStatus.RESOLVED
        assert request.is_placeholder is False

        # Check metadata merge
        assert request.metadata["requester_full_name"] == "John Doe"
        assert request.metadata["resolved_full_name"] == "Jane Smith"
        assert request.metadata["resolution_method"] == "exact_match"

    def test_build_placeholder_request(self, builder, parsed_request, default_options):
        """Test building a placeholder request when resolution fails"""
        request = builder.build(parsed_request=parsed_request, resolved_name=None, options=default_options)

        assert isinstance(request, BunkRequest)
        assert request.requester_cm_id == 12345
        assert request.requested_cm_id is None
        assert request.request_type == RequestType.BUNK_WITH
        assert request.status == RequestStatus.PENDING
        assert request.is_placeholder is True
        assert request.confidence_score == 0.95  # Uses parsed confidence

        # Check metadata
        assert request.metadata["raw_target_name"] == "Jane Smith"
        assert request.metadata["is_placeholder"] is True

    def test_age_preference_request(self, builder, default_options):
        """Test building age preference request"""
        from bunking.sync.bunk_request_processor.core.models import AgePreference

        parsed = ParsedRequest(
            raw_text="younger",
            target_name=None,
            request_type=RequestType.AGE_PREFERENCE,
            age_preference=AgePreference.YOUNGER,
            confidence=1.0,
            source=RequestSource.FAMILY,
            source_field="bunk_preference",
            csv_position=1,
            metadata={"requester_cm_id": 12345, "priority": 2},
            notes=None,
        )

        request = builder.build(
            parsed_request=parsed,
            resolved_name=None,  # Age preferences don't need resolution
            options=default_options,
        )

        assert request.request_type == RequestType.AGE_PREFERENCE
        assert request.requested_cm_id is None
        assert request.status == RequestStatus.RESOLVED
        assert request.is_placeholder is False
        assert request.metadata["preference_value"] == "younger"

    def test_validation_integration(self, builder, parsed_request, resolved_name, default_options, validation_pipeline):
        """Test that validation is called during building"""
        builder.build(parsed_request=parsed_request, resolved_name=resolved_name, options=default_options)

        # Verify validation was called
        validation_pipeline.validate.assert_called_once()
        call_args = validation_pipeline.validate.call_args[0]
        assert isinstance(call_args[0], BunkRequest)

    def test_validation_failure_returns_request(
        self, builder, parsed_request, resolved_name, default_options, validation_pipeline
    ):
        """Test that validation failures still return request but mark it"""
        validation_result = Mock(
            is_valid=False, errors=["Test error"], warnings=[], metadata={"validation_failed": True}
        )
        validation_pipeline.validate.return_value = validation_result

        request = builder.build(parsed_request=parsed_request, resolved_name=resolved_name, options=default_options)

        assert isinstance(request, BunkRequest)
        assert request.status == RequestStatus.DECLINED  # Invalid requests become DECLINED
        assert request.metadata["validation_errors"] == ["Test error"]
        assert request.metadata["validation_failed"] is True

    def test_batch_building(self, builder, default_options):
        """Test building multiple requests efficiently"""
        parsed_requests = [
            ParsedRequest(
                raw_text=f"Person {i}",
                target_name=f"Person {i}",
                request_type=RequestType.BUNK_WITH,
                age_preference=None,
                confidence=0.9,
                source=RequestSource.FAMILY,
                source_field="share_bunk_with",
                csv_position=i,
                metadata={"requester_cm_id": 1000 + i, "priority": 3},
                notes=None,
            )
            for i in range(3)
        ]

        resolved_names = [
            ResolvedName(
                original_name=f"Person {i}",
                matched_cm_id=2000 + i,
                matched_person=Person(cm_id=2000 + i, first_name="Person", last_name=str(i), session_cm_id=1000002),
                confidence=0.85,
                resolution_method="fuzzy_match",
                alternate_matches=[],
            )
            for i in range(3)
        ]

        requests = builder.build_batch(
            parsed_requests=parsed_requests, resolved_names=resolved_names, options=default_options
        )

        assert len(requests) == 3
        for i, request in enumerate(requests):
            assert request.requester_cm_id == 1000 + i
            assert request.requested_cm_id == 2000 + i
            assert request.csv_position == i

    def test_metadata_preservation(self, builder, parsed_request, resolved_name, default_options):
        """Test that all metadata is properly preserved and merged"""
        parsed_request.metadata.update({"custom_field": "value1", "shared_field": "parsed_value", "priority": 3})

        request = builder.build(parsed_request=parsed_request, resolved_name=resolved_name, options=default_options)

        # Check all metadata is preserved
        assert request.metadata["custom_field"] == "value1"
        assert request.metadata["shared_field"] == "parsed_value"
        assert request.metadata["requester_full_name"] == "John Doe"
        assert request.metadata["resolved_full_name"] == "Jane Smith"

    def test_builder_options_override(self, builder, parsed_request, resolved_name):
        """Test that builder options can override defaults"""
        options = RequestBuilderOptions(
            session_cm_id=1000021,  # Different session
            year=2026,  # Different year
            csv_position=99,
            default_priority=5,
            validate=False,  # Skip validation
        )

        request = builder.build(parsed_request=parsed_request, resolved_name=resolved_name, options=options)

        assert request.session_cm_id == 1000021
        assert request.year == 2026
        assert request.csv_position == 99
        # Priority from parsed request metadata should be used, but it's not set
        assert request.priority == 5  # Uses default since no priority in metadata

    def test_no_validation_option(self, builder, parsed_request, resolved_name, validation_pipeline):
        """Test building without validation"""
        options = RequestBuilderOptions(session_cm_id=1000002, year=2025, csv_position=1, validate=False)

        builder.build(parsed_request=parsed_request, resolved_name=resolved_name, options=options)

        # Validation should not be called
        validation_pipeline.validate.assert_not_called()

    def test_not_bunk_with_request(self, builder, default_options):
        """Test building NOT_BUNK_WITH requests"""
        parsed = ParsedRequest(
            raw_text="Billy Troublemaker",
            target_name="Billy Troublemaker",
            request_type=RequestType.NOT_BUNK_WITH,
            age_preference=None,
            confidence=0.88,
            source=RequestSource.STAFF,  # Use STAFF instead of CAMPER
            source_field="dont_bunk_with",
            csv_position=1,
            metadata={"requester_cm_id": 12345, "priority": 4},
            notes=None,
        )

        resolved = ResolvedName(
            original_name="Billy Troublemaker",
            matched_cm_id=99999,
            matched_person=Person(cm_id=99999, first_name="Billy", last_name="Troublemaker", session_cm_id=1000002),
            confidence=0.90,
            resolution_method="fuzzy_match",
            alternate_matches=[],
        )

        request = builder.build(parsed_request=parsed, resolved_name=resolved, options=default_options)

        assert request.request_type == RequestType.NOT_BUNK_WITH
        assert request.requested_cm_id == 99999
        assert request.priority == 4
        assert request.source == RequestSource.STAFF


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
