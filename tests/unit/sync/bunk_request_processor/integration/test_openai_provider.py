"""Test V2 AI Provider - source_type metadata preservation

TDD test to verify that source_type from AI response is preserved in metadata
for staff review and debugging.

Updated for SDK migration: Uses Pydantic models instead of raw dicts.
"""

import sys
from pathlib import Path

import pytest

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

    def test_source_fragment_flows_into_parsed_request_metadata(self) -> None:
        """AI-emitted source_fragment should be preserved on ParsedRequest.metadata."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-4o-mini")

        ai_response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Emma",
                    source_fragment="wants to be with Emma from last year",
                )
            ]
        )

        context = AIRequestContext(
            requester_name="Liam Garcia",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={"csv_source_field": "share_bunk_with"},
        )

        result = provider._convert_parse_response(ai_response, "wants to be with Emma from last year", context)

        assert len(result.requests) == 1
        parsed_req = result.requests[0]
        assert parsed_req.metadata.get("source_fragment") == "wants to be with Emma from last year"


class TestSupportsReasoning:
    """Test _supports_reasoning model prefix detection."""

    @pytest.mark.parametrize(
        ("model", "expected"),
        [
            ("gpt-5-nano", True),
            ("gpt-5", True),
            ("gpt-5-mini", True),
            ("o1", True),
            ("o1-mini", True),
            ("o3", True),
            ("o3-mini", True),
            ("o4-mini", True),
            ("o4", True),
            ("gpt-4.1-nano", False),
            ("gpt-4.1-mini", False),
            ("gpt-4o", False),
            ("gpt-4o-mini", False),
            ("gpt-4-turbo", False),
        ],
    )
    def test_supports_reasoning(self, model: str, expected: bool) -> None:
        provider = OpenAIProvider(api_key="test-key", model=model)
        assert provider._supports_reasoning() == expected, f"Expected {expected} for model '{model}'"


class TestBuildPromptRequesterLastName:
    """Test that _build_prompt includes requester last name in requester_info."""

    def test_build_prompt_includes_requester_last_name(self):
        """The rendered prompt must include the requester's last name."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        context = AIRequestContext(
            requester_name="Emma Johnson",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "bunk_with",
                "requester_grade": "5",
                "session_name": "Session 2",
            },
        )

        prompt = provider._build_prompt("Olivia Chen", context)

        assert "Requester last name: Johnson" in prompt

    def test_build_prompt_includes_last_name_for_multi_word_name(self):
        """The requester last name should be the last word of the full name."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        context = AIRequestContext(
            requester_name="Olivia Rose Thompson",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "bunk_with",
                "requester_grade": "4",
                "session_name": "Session 1",
            },
        )

        prompt = provider._build_prompt("Liam Garcia", context)

        assert "Requester last name: Thompson" in prompt

    def test_build_prompt_handles_empty_requester_name(self):
        """When requester_name is empty, last name should be empty or absent."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        context = AIRequestContext(
            requester_name="",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "bunk_with",
            },
        )

        prompt = provider._build_prompt("Noah Chen", context)

        # Should not crash; requester_last should be empty string
        assert "Requester last name:" in prompt

    def test_build_prompt_handles_single_word_name(self):
        """When requester_name is a single word, last name should be empty (it's a first name)."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        context = AIRequestContext(
            requester_name="Cher",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "bunk_with",
            },
        )

        prompt = provider._build_prompt("Noah Chen", context)

        # Single-word name has no last name — parse_name treats it as first name only
        assert "Requester last name: \n" in prompt or "Requester last name:\n" in prompt


class TestFormatCandidatesCityState:
    """Regression guard for kindred#2793.

    person_city_only (added to fix the school-disambiguation city/state
    equality check) strips the state suffix out of Person.city. Before that
    change, a normalized city like "Oakland, CA" could flow straight into
    the "City: {city}" template and render the state along with it. The
    disambiguation prompt must keep rendering state info now that city and
    state are separate fields, not silently drop it.
    """

    def test_format_candidates_renders_city_and_state(self):
        """A candidate with both city and state renders 'City: Oakland, CA'."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        candidates = [
            {
                "name": "Emma Johnson",
                "person_id": 12345,
                "city": "Oakland",
                "state": "CA",
            }
        ]

        formatted = provider._format_candidates(candidates)

        assert "City: Oakland, CA" in formatted

    def test_format_candidates_renders_city_only_when_state_blank(self):
        """A candidate with a city but no state renders 'City: Oakland' — never a trailing comma."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        candidates = [
            {
                "name": "Liam Garcia",
                "person_id": 12346,
                "city": "Oakland",
                "state": None,
            }
        ]

        formatted = provider._format_candidates(candidates)

        assert "City: Oakland\n" in formatted or formatted.rstrip().endswith("City: Oakland")
        assert "City: Oakland," not in formatted
        assert "City: Oakland, CA" not in formatted
