"""Tests for services/request_builder.py

Tests the RequestBuilder class in services/ which handles:
- Building BunkRequest metadata from ParsedRequest
- AI reasoning storage (ai_p1_reasoning field)
- Status determination
"""

from __future__ import annotations

from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.services.request_builder import RequestBuilder


class TestRequestBuilderMetadata:
    """Tests for build_request_metadata method"""

    @pytest.fixture
    def mock_priority_calculator(self):
        """Create a mock priority calculator"""
        mock = Mock()
        mock.calculate_priority.return_value = 3
        return mock

    @pytest.fixture
    def builder(self, mock_priority_calculator):
        """Create a RequestBuilder with mocked dependencies"""
        return RequestBuilder(
            priority_calculator=mock_priority_calculator,
            temporal_name_cache=None,
            year=2025,
            auto_resolve_threshold=0.8,
        )

    @pytest.fixture
    def parsed_request_with_reasoning(self):
        """Create a ParsedRequest with reasoning in metadata (as AI provides it)"""
        return ParsedRequest(
            raw_text="Kyla Udell",
            target_name="Kyla Udell",
            request_type=RequestType.NOT_BUNK_WITH,
            age_preference=None,
            confidence=0.95,
            source=RequestSource.STAFF,
            source_field="do_not_share_bunk_with",
            csv_position=0,
            metadata={
                "requester_cm_id": 12345,
                "parse_notes": "Direct separation request",
                "reasoning": "Direct mention of name Kyla Udell indicating a request to not be bunked together.",
                "keywords_found": [],
            },
            notes=None,
        )

    def test_build_request_metadata_stores_reasoning_from_correct_key(
        self, builder, parsed_request_with_reasoning
    ):
        """Verify ai_p1_reasoning is populated from metadata['reasoning'], not 'ai_reasoning'.

        This test exposes the bug where line 199 uses the wrong key 'ai_reasoning'
        instead of 'reasoning', causing ai_p1_reasoning to always be empty.
        """
        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Camper",
            "person_cm_id": 67890,
            "person_name": "Kyla Udell",
        }
        ai_parsed = False  # Phase 1 parsing, not Phase 3 disambiguation

        metadata = builder.build_request_metadata(
            parsed_request_with_reasoning, resolution_info, ai_parsed
        )

        # The bug: metadata uses "ai_reasoning" key but AI provider stores "reasoning"
        # Expected: ai_p1_reasoning should contain the reasoning string
        expected_reasoning = "Direct mention of name Kyla Udell indicating a request to not be bunked together."
        assert metadata["ai_p1_reasoning"] == expected_reasoning, (
            f"ai_p1_reasoning should be '{expected_reasoning}', "
            f"got '{metadata['ai_p1_reasoning']}'. "
            "Bug: request_builder.py line 199 uses wrong key 'ai_reasoning' instead of 'reasoning'."
        )

    def test_build_request_metadata_stores_parse_notes(
        self, builder, parsed_request_with_reasoning
    ):
        """Verify parse_notes is properly extracted from metadata"""
        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Camper",
        }

        metadata = builder.build_request_metadata(
            parsed_request_with_reasoning, resolution_info, ai_parsed=False
        )

        assert metadata["parse_notes"] == "Direct separation request"

    def test_build_request_metadata_ai_p1_reasoning_empty_when_phase3(
        self, builder, parsed_request_with_reasoning
    ):
        """When ai_parsed=True (Phase 3), ai_p1_reasoning should be empty."""
        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Camper",
            "person_cm_id": 67890,
            "resolution_metadata": {
                "ai_p3_reasoning": {"disambiguation": "Selected based on session context"},
            },
        }

        metadata = builder.build_request_metadata(
            parsed_request_with_reasoning, resolution_info, ai_parsed=True
        )

        # Phase 3 should have empty ai_p1_reasoning
        assert metadata["ai_p1_reasoning"] == ""

    def test_build_request_metadata_reasoning_type_is_string(
        self, builder, parsed_request_with_reasoning
    ):
        """ai_p1_reasoning should be a string, not a dict.

        The bug also uses {} as default, but reasoning should be a string.
        """
        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Camper",
        }

        metadata = builder.build_request_metadata(
            parsed_request_with_reasoning, resolution_info, ai_parsed=False
        )

        assert isinstance(metadata["ai_p1_reasoning"], str), (
            f"ai_p1_reasoning should be a string, got {type(metadata['ai_p1_reasoning'])}. "
            "Bug: request_builder.py uses {} as default instead of '' for reasoning."
        )


class TestRequestBuilderIntegration:
    """Integration tests for full request building"""

    @pytest.fixture
    def mock_priority_calculator(self):
        mock = Mock()
        mock.calculate_priority.return_value = 3
        return mock

    @pytest.fixture
    def builder(self, mock_priority_calculator):
        return RequestBuilder(
            priority_calculator=mock_priority_calculator,
            temporal_name_cache=None,
            year=2025,
            auto_resolve_threshold=0.8,
        )

    def test_build_single_request_includes_reasoning_in_metadata(self, builder):
        """Full integration test: reasoning flows through to BunkRequest metadata"""
        parsed_req = ParsedRequest(
            raw_text="Jane Smith",
            target_name="Jane Smith",
            request_type=RequestType.NOT_BUNK_WITH,
            age_preference=None,
            confidence=0.95,
            source=RequestSource.STAFF,
            source_field="do_not_share_bunk_with",
            csv_position=0,
            metadata={
                "reasoning": "Separation request based on staff input.",
                "parse_notes": "",
                "keywords_found": [],
            },
        )

        resolution_info = {
            "requester_cm_id": 12345,
            "requester_name": "Test Requester",
            "person_cm_id": 67890,
            "person_name": "Jane Smith",
            "session_cm_id": 1000002,
            "confidence": 0.92,
        }

        bunk_request = builder.build_single_request(
            parsed_req, resolution_info, [parsed_req], 12345
        )

        assert bunk_request is not None
        assert bunk_request.metadata["ai_p1_reasoning"] == "Separation request based on staff input."


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
