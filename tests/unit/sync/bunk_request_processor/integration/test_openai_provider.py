"""Test V2 AI Provider - source_type metadata preservation

TDD test to verify that source_type from AI response is preserved in metadata
for staff review and debugging.

Updated for SDK migration: Uses Pydantic models instead of raw dicts.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.integration.ai_schemas import (
    AIBunkRequestItem,
    AIParseResponse,
)
from bunking.sync.bunk_request_processor.integration.ai_service import (
    AIRequestContext,
)
from bunking.sync.bunk_request_processor.integration.openai_provider import (
    OpenAIProvider,
)


class TestSourceTypeMetadata:
    """Test that source_type is preserved in metadata for staff review."""

    def test_source_type_preserved_in_metadata_for_staff_notes(self):
        """Verify source_type from AI response is preserved in ParsedRequest.metadata.

        This enables staff to see who originated a request when reviewing conflicts.
        For example: family says "bunk with X" vs staff says "don't bunk with X"
        """
        # Create provider (new signature without provider_type)
        provider = OpenAIProvider(api_key="test-key", model="gpt-4o-mini")

        # Simulate AI response with source_type = "staff" using Pydantic model
        ai_response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="not_bunk_with",
                    target_name="John Smith",
                    source_type="staff",  # Staff wrote this in notes
                    source_field="internal_notes",
                    keywords_found=["separate"],
                    parse_notes="Staff recommendation to keep apart",
                    reasoning="Based on previous year issues",
                )
            ]
        )

        # Create context
        context = AIRequestContext(
            requester_name="Alice Jones",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={"csv_source_field": "internal_notes"},
        )

        # Parse the response using new method
        result = provider._convert_parse_response(ai_response, "keep separate from John", context)

        # Verify source_type is in metadata
        assert len(result.requests) == 1
        parsed_req = result.requests[0]

        # This is the key assertion - source_type must be in metadata
        assert "source_type" in parsed_req.metadata, "source_type must be preserved in metadata for staff review"
        assert parsed_req.metadata["source_type"] == "staff", "source_type value must match AI response"

    def test_source_type_defaults_to_parent(self):
        """Verify source_type defaults to 'parent' when not provided by AI."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-4o-mini")

        # AI response without explicit source_type (defaults to "parent" in schema)
        ai_response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Mike Johnson",
                    # source_type defaults to "parent" in Pydantic model
                    keywords_found=[],
                    parse_notes="",
                )
            ]
        )

        context = AIRequestContext(
            requester_name="Bob Smith",
            requester_cm_id=67890,
            session_cm_id=1000002,
            year=2025,
            additional_context={"csv_source_field": "share_bunk_with"},
        )

        result = provider._convert_parse_response(ai_response, "bunk with Mike", context)

        assert len(result.requests) == 1
        parsed_req = result.requests[0]

        # Should default to parent
        assert "source_type" in parsed_req.metadata
        assert parsed_req.metadata["source_type"] == "parent"

    def test_source_type_preserved_for_counselor(self):
        """Verify counselor source_type is preserved (distinct from staff)."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-4o-mini")

        ai_response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Sarah Williams",
                    source_type="counselor",
                    keywords_found=["good match"],
                    parse_notes="Counselor recommendation",
                )
            ]
        )

        context = AIRequestContext(
            requester_name="Tom Davis",
            requester_cm_id=11111,
            session_cm_id=1000002,
            year=2025,
            additional_context={"csv_source_field": "bunking_notes"},
        )

        result = provider._convert_parse_response(ai_response, "good match with Sarah", context)

        assert len(result.requests) == 1
        parsed_req = result.requests[0]

        assert parsed_req.metadata["source_type"] == "counselor"
