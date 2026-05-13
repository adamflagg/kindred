"""Tests for OpenAI SDK-based AI provider.

TDD tests written BEFORE implementation to define expected behavior.
Uses Pydantic structured outputs via the Responses API.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    RequestType,
)
from bunking.sync.bunk_request_processor.integration.ai_schemas import (
    AIBunkRequestItem,
    AIDisambiguationCandidate,
    AIDisambiguationResponse,
    AIParseResponse,
)
from bunking.sync.bunk_request_processor.integration.ai_service import (
    AIRequestContext,
)


class TestAISchemas:
    """Test Pydantic schema validation for AI responses."""

    def test_parse_response_valid_bunk_with(self):
        """Valid bunk_with request parses correctly."""
        response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="John Smith",
                    source_type="parent",
                    parse_notes="Simple request",
                )
            ]
        )
        assert len(response.requests) == 1
        assert response.requests[0].request_type == "bunk_with"
        assert response.requests[0].target_name == "John Smith"

    def test_parse_response_valid_not_bunk_with(self):
        """Valid not_bunk_with request parses correctly."""
        response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="not_bunk_with",
                    target_name="Jane Doe",
                    source_type="staff",
                )
            ]
        )
        assert response.requests[0].request_type == "not_bunk_with"

    def test_parse_response_valid_age_preference(self):
        """Valid age_preference request parses correctly."""
        response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="age_preference",
                    target_name="older",
                    source_type="parent",
                )
            ]
        )
        assert response.requests[0].request_type == "age_preference"

    def test_parse_response_invalid_request_type_rejected(self):
        """Invalid request_type is rejected by Pydantic."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            AIBunkRequestItem(
                request_type="unknown",  # Invalid!
                target_name="Someone",
            )
        assert "request_type" in str(exc_info.value)

    def test_parse_response_invalid_source_type_rejected(self):
        """Invalid source_type is rejected by Pydantic."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            AIBunkRequestItem(
                request_type="bunk_with",
                target_name="Someone",
                source_type="invalid",  # Invalid!
            )
        assert "source_type" in str(exc_info.value)

    def test_disambiguation_response_confidence_bounds(self):
        """Disambiguation confidence must be between 0 and 1."""
        # Valid
        response = AIDisambiguationResponse(
            confidence=0.85,
            reasoning="High confidence match",
        )
        assert response.confidence == 0.85

        # Invalid - too high
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            AIDisambiguationResponse(confidence=1.5)

        # Invalid - negative
        with pytest.raises(ValidationError):
            AIDisambiguationResponse(confidence=-0.1)

    def test_parse_response_empty_requests_allowed(self):
        """Empty requests list is valid (no requests found in text)."""
        response = AIParseResponse(requests=[])
        assert len(response.requests) == 0

    def test_parse_response_multiple_requests(self):
        """Multiple requests in one response."""
        response = AIParseResponse(
            requests=[
                AIBunkRequestItem(request_type="bunk_with", target_name="Alice"),
                AIBunkRequestItem(request_type="bunk_with", target_name="Bob"),
                AIBunkRequestItem(request_type="not_bunk_with", target_name="Charlie"),
            ]
        )
        assert len(response.requests) == 3


class TestSDKProviderInterface:
    """Test SDK provider maintains the AIProvider interface."""

    @pytest.fixture
    def mock_openai_client(self):
        """Create a mock OpenAI client."""
        client = MagicMock()
        client.responses = MagicMock()
        client.responses.parse = AsyncMock()
        return client

    @pytest.fixture
    def context(self):
        """Create a standard test context."""
        return AIRequestContext(
            requester_name="Test User",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "share_bunk_with",
                "csv_source_field": "share_bunk_with",
            },
        )

    @pytest.mark.asyncio
    async def test_parse_request_returns_parsed_response(self, mock_openai_client, context):
        """parse_request() returns ParsedResponse with correct structure."""
        # This test will fail until we implement the SDK provider
        # Import here to allow test collection even if implementation doesn't exist
        try:
            from bunking.sync.bunk_request_processor.integration.openai_provider import (
                OpenAIProvider,
            )
        except ImportError:
            pytest.skip("OpenAIProvider not yet updated for SDK")

        # Mock SDK response
        mock_parsed = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="John Smith",
                    source_type="parent",
                    parse_notes="Test parse",
                )
            ]
        )

        # Create mock response structure
        mock_text = MagicMock()
        mock_text.parsed = mock_parsed

        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [mock_message]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50, total_tokens=150)

        mock_openai_client.responses.parse.return_value = mock_response

        # Create provider with mocked client
        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(
                api_key="test-key",
                model="gpt-4.1-nano",
            )
            provider.client = mock_openai_client

            result = await provider.parse_request("bunk with John Smith", context)

        # Verify result structure
        assert result is not None
        assert hasattr(result, "requests")
        assert hasattr(result, "confidence")
        assert len(result.requests) == 1
        assert result.requests[0].target_name == "John Smith"

    @pytest.mark.asyncio
    async def test_parse_request_handles_empty_response(self, mock_openai_client, context):
        """parse_request() handles empty AI response gracefully."""
        try:
            from bunking.sync.bunk_request_processor.integration.openai_provider import (
                OpenAIProvider,
            )
        except ImportError:
            pytest.skip("OpenAIProvider not yet updated for SDK")

        # Mock empty response
        mock_parsed = AIParseResponse(requests=[])

        mock_text = MagicMock()
        mock_text.parsed = mock_parsed

        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [mock_message]
        mock_response.usage = MagicMock(input_tokens=50, output_tokens=10)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(
                api_key="test-key",
                model="gpt-4.1-nano",
            )
            provider.client = mock_openai_client

            result = await provider.parse_request("no preference", context)

        assert result is not None
        assert len(result.requests) == 0

    @pytest.mark.asyncio
    async def test_provider_tracks_token_usage(self, mock_openai_client, context):
        """Provider tracks token usage from SDK responses."""
        try:
            from bunking.sync.bunk_request_processor.integration.openai_provider import (
                OpenAIProvider,
            )
        except ImportError:
            pytest.skip("OpenAIProvider not yet updated for SDK")

        mock_parsed = AIParseResponse(requests=[])

        mock_text = MagicMock()
        mock_text.parsed = mock_parsed

        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [mock_message]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(
                api_key="test-key",
                model="gpt-4.1-nano",
            )
            provider.client = mock_openai_client

            await provider.parse_request("test", context)
            usage = provider.get_token_usage()

        assert usage.prompt_tokens >= 0
        assert usage.completion_tokens >= 0


class TestReasoningEffort:
    """Test that reasoning effort is passed to the OpenAI API."""

    @pytest.fixture
    def mock_openai_client(self):
        """Create a mock OpenAI client."""
        client = MagicMock()
        client.responses = MagicMock()
        client.responses.parse = AsyncMock()
        return client

    @pytest.fixture
    def context(self):
        """Create a standard test context."""
        return AIRequestContext(
            requester_name="Test User",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "share_bunk_with",
                "csv_source_field": "share_bunk_with",
            },
        )

    def _mock_response(self, parsed):
        """Build a mock SDK response wrapping a parsed Pydantic object."""
        mock_text = MagicMock()
        mock_text.parsed = parsed
        mock_message = MagicMock()
        mock_message.content = [mock_text]
        mock_response = MagicMock()
        mock_response.output = [mock_message]
        mock_response.usage = MagicMock(input_tokens=50, output_tokens=20)
        return mock_response

    @pytest.mark.asyncio
    async def test_parse_request_passes_low_reasoning(self, mock_openai_client, context):
        """Phase 1 parse_request passes reasoning={'effort': 'low'} to responses.parse."""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        mock_openai_client.responses.parse.return_value = self._mock_response(
            AIParseResponse(requests=[AIBunkRequestItem(request_type="bunk_with", target_name="Alice")])
        )

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client
            await provider.parse_request("bunk with Alice", context)

        call_kwargs = mock_openai_client.responses.parse.call_args.kwargs
        assert "reasoning" in call_kwargs
        assert call_kwargs["reasoning"]["effort"] == "low"

    @pytest.mark.asyncio
    async def test_disambiguate_passes_medium_reasoning(self, mock_openai_client):
        """Phase 3 disambiguate passes reasoning={'effort': 'medium'} to responses.parse."""
        from bunking.sync.bunk_request_processor.core.models import ParsedRequest, RequestType
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        mock_openai_client.responses.parse.return_value = self._mock_response(
            AIDisambiguationResponse(
                ranked_selections=[
                    AIDisambiguationCandidate(person_id=999, confidence=0.9, reasoning="Strong match"),
                ],
            )
        )

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client

            parsed_req = ParsedRequest(
                raw_text="bunk with Emma",
                request_type=RequestType.BUNK_WITH,
                target_name="Emma",
                age_preference=None,
                source_field="bunk_with",
                confidence=0.5,
                csv_position=1,
                metadata={},
            )
            await provider.disambiguate(
                parsed_req,
                AIRequestContext(
                    requester_name="Test User",
                    requester_cm_id=12345,
                    session_cm_id=1000002,
                    year=2025,
                    additional_context={
                        "candidates": [
                            {"name": "Emma Johnson", "person_id": 999, "school": "Riverside Elementary"},
                            {"name": "Emma Garcia", "person_id": 888, "school": "Oak Valley Middle"},
                        ],
                    },
                ),
            )

        call_kwargs = mock_openai_client.responses.parse.call_args.kwargs
        assert "reasoning" in call_kwargs
        assert call_kwargs["reasoning"]["effort"] == "medium"

    def test_gpt5_nano_pricing(self):
        """GPT-5-nano pricing is registered in cost calculation."""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        with patch("openai.AsyncOpenAI"):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        provider._total_prompt_tokens = 1_000_000
        provider._total_completion_tokens = 1_000_000
        cost = provider._calculate_cost()
        # gpt-5-nano: $0.05 input + $0.40 output = $0.45
        assert cost == pytest.approx(0.45, abs=0.01)

    def test_gpt5_mini_pricing(self):
        """GPT-5-mini pricing is registered in cost calculation."""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        with patch("openai.AsyncOpenAI"):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-mini")

        provider._total_prompt_tokens = 1_000_000
        provider._total_completion_tokens = 1_000_000
        cost = provider._calculate_cost()
        # gpt-5-mini: $0.25 input + $2.00 output = $2.25
        assert cost == pytest.approx(2.25, abs=0.01)


class TestReasoningOutputParsing:
    """Test that responses with reasoning output items are handled correctly.

    When reasoning is enabled (GPT-5 models), response.output contains
    reasoning items before the actual message with parsed content.
    """

    @pytest.fixture
    def mock_openai_client(self):
        """Create a mock OpenAI client."""
        client = MagicMock()
        client.responses = MagicMock()
        client.responses.parse = AsyncMock()
        return client

    @pytest.fixture
    def context(self):
        """Create a standard test context."""
        return AIRequestContext(
            requester_name="Test User",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "share_bunk_with",
                "csv_source_field": "share_bunk_with",
            },
        )

    @pytest.mark.asyncio
    async def test_parse_with_reasoning_output_items(self, mock_openai_client, context):
        """When reasoning is enabled, output[0] is a reasoning item, not the message.

        The provider must iterate through output items to find parsed content.
        """
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        # Reasoning item has no 'content' attribute
        reasoning_item = MagicMock(spec=[])

        # Parsed message item has content with parsed result
        mock_parsed = AIParseResponse(requests=[AIBunkRequestItem(request_type="bunk_with", target_name="Alice")])
        mock_text = MagicMock()
        mock_text.parsed = mock_parsed
        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [reasoning_item, mock_message]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client
            result = await provider.parse_request("bunk with Alice", context)

        assert len(result.requests) == 1
        assert result.requests[0].target_name == "Alice"

    @pytest.mark.asyncio
    async def test_parse_with_multiple_reasoning_items(self, mock_openai_client, context):
        """Multiple reasoning items before the message should still work."""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        # Multiple reasoning items (no 'content' attribute)
        reasoning_1 = MagicMock(spec=[])
        reasoning_2 = MagicMock(spec=[])

        mock_parsed = AIParseResponse(requests=[AIBunkRequestItem(request_type="not_bunk_with", target_name="Bob")])
        mock_text = MagicMock()
        mock_text.parsed = mock_parsed
        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [reasoning_1, reasoning_2, mock_message]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client
            result = await provider.parse_request("not bunk with Bob", context)

        assert len(result.requests) == 1
        assert result.requests[0].target_name == "Bob"

    @pytest.mark.asyncio
    async def test_disambiguate_with_reasoning_output_items(self, mock_openai_client):
        """Disambiguation also works when reasoning items precede the message."""
        from bunking.sync.bunk_request_processor.core.models import ParsedRequest, RequestType
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        reasoning_item = MagicMock(spec=[])

        mock_parsed = AIDisambiguationResponse(
            ranked_selections=[
                AIDisambiguationCandidate(person_id=999, confidence=0.9, reasoning="Strong match"),
            ],
        )
        mock_text = MagicMock()
        mock_text.parsed = mock_parsed
        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [reasoning_item, mock_message]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client

            parsed_req = ParsedRequest(
                raw_text="bunk with Emma",
                request_type=RequestType.BUNK_WITH,
                target_name="Emma",
                age_preference=None,
                source_field="bunk_with",
                confidence=0.5,
                csv_position=1,
                metadata={},
            )
            result = await provider.disambiguate(
                parsed_req,
                AIRequestContext(
                    requester_name="Test User",
                    requester_cm_id=12345,
                    session_cm_id=1000002,
                    year=2025,
                    additional_context={
                        "candidates": [
                            {"name": "Emma Johnson", "person_id": 999, "school": "Riverside Elementary"},
                        ],
                    },
                ),
            )

        assert result.requests[0].metadata["target_person_id"] == 999
        assert result.requests[0].confidence == 0.9

    @pytest.mark.asyncio
    async def test_reasoning_summary_captured_in_parse_metadata(self, mock_openai_client, context):
        """Structured reasoning summaries are captured in request metadata."""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        # Reasoning item with summary text (like ResponseReasoningItem)
        reasoning_item = MagicMock(spec=[])
        reasoning_item.type = "reasoning"
        reasoning_summary = MagicMock()
        reasoning_summary.text = "The parent is requesting their child bunk with Alice, a direct name match."
        reasoning_item.summary = [reasoning_summary]

        mock_parsed = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Alice",
                    reasoning="Direct bunk request",
                )
            ]
        )
        mock_text = MagicMock()
        mock_text.parsed = mock_parsed
        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [reasoning_item, mock_message]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client
            result = await provider.parse_request("bunk with Alice", context)

        # Both reasoning sources should be present
        assert result.requests[0].metadata["reasoning"] == "Direct bunk request"
        assert "ai_reasoning_summary" in result.metadata
        assert "direct name match" in result.metadata["ai_reasoning_summary"].lower()

    @pytest.mark.asyncio
    async def test_reasoning_summary_empty_when_no_reasoning_items(self, mock_openai_client, context):
        """When no reasoning items in output, ai_reasoning_summary is absent."""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        mock_parsed = AIParseResponse(requests=[AIBunkRequestItem(request_type="bunk_with", target_name="Bob")])
        mock_text = MagicMock()
        mock_text.parsed = mock_parsed
        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [mock_message]  # No reasoning items
        mock_response.usage = MagicMock(input_tokens=50, output_tokens=20)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client
            result = await provider.parse_request("bunk with Bob", context)

        assert "ai_reasoning_summary" not in result.metadata

    @pytest.mark.asyncio
    async def test_reasoning_summary_captured_in_disambiguate_metadata(self, mock_openai_client):
        """Disambiguation also captures structured reasoning summaries."""
        from bunking.sync.bunk_request_processor.core.models import ParsedRequest, RequestType
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        reasoning_item = MagicMock(spec=[])
        reasoning_item.type = "reasoning"
        reasoning_summary = MagicMock()
        reasoning_summary.text = "Emma Johnson attends same school as requester."
        reasoning_item.summary = [reasoning_summary]

        mock_parsed = AIDisambiguationResponse(
            ranked_selections=[
                AIDisambiguationCandidate(person_id=999, confidence=0.9, reasoning="Same school"),
            ],
        )
        mock_text = MagicMock()
        mock_text.parsed = mock_parsed
        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [reasoning_item, mock_message]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client

            parsed_req = ParsedRequest(
                raw_text="bunk with Emma",
                request_type=RequestType.BUNK_WITH,
                target_name="Emma",
                age_preference=None,
                source_field="bunk_with",
                confidence=0.5,
                csv_position=1,
                metadata={},
            )
            result = await provider.disambiguate(
                parsed_req,
                AIRequestContext(
                    requester_name="Test User",
                    requester_cm_id=12345,
                    session_cm_id=1000002,
                    year=2025,
                    additional_context={
                        "candidates": [
                            {"name": "Emma Johnson", "person_id": 999, "school": "Riverside Elementary"},
                        ],
                    },
                ),
            )

        assert result.metadata.get("ai_reasoning_summary") == "Emma Johnson attends same school as requester."

    @pytest.mark.asyncio
    async def test_multiple_reasoning_summaries_concatenated(self, mock_openai_client, context):
        """Multiple reasoning summary items are concatenated."""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        reasoning_item = MagicMock(spec=[])
        reasoning_item.type = "reasoning"
        summary1 = MagicMock()
        summary1.text = "First reasoning step."
        summary2 = MagicMock()
        summary2.text = "Second reasoning step."
        reasoning_item.summary = [summary1, summary2]

        mock_parsed = AIParseResponse(requests=[AIBunkRequestItem(request_type="bunk_with", target_name="Charlie")])
        mock_text = MagicMock()
        mock_text.parsed = mock_parsed
        mock_message = MagicMock()
        mock_message.content = [mock_text]

        mock_response = MagicMock()
        mock_response.output = [reasoning_item, mock_message]
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        mock_openai_client.responses.parse.return_value = mock_response

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
            provider.client = mock_openai_client
            result = await provider.parse_request("bunk with Charlie", context)

        assert result.metadata["ai_reasoning_summary"] == "First reasoning step. Second reasoning step."


class TestSDKProviderRequestTypeMapping:
    """Test that SDK provider correctly maps request types."""

    def test_request_type_mapping(self):
        """AI request_type strings map to RequestType enum."""
        # This tests the conversion logic that should exist in the provider

        # The mapping should work like this:
        mapping = {
            "bunk_with": RequestType.BUNK_WITH,
            "not_bunk_with": RequestType.NOT_BUNK_WITH,
            "age_preference": RequestType.AGE_PREFERENCE,
        }

        for ai_type, expected_enum in mapping.items():
            assert expected_enum.value == ai_type or expected_enum.name.lower() == ai_type.replace("_", "_")


class TestAIDisambiguationRankedSchema:
    """Test ranked selections in AIDisambiguationResponse schema."""

    def test_ranked_selections_parsed(self):
        """ranked_selections field parses a list of AIDisambiguationCandidate objects."""
        response = AIDisambiguationResponse(
            ranked_selections=[
                AIDisambiguationCandidate(
                    person_id=1001,
                    confidence=0.92,
                    reasoning="Name and school match",
                ),
                AIDisambiguationCandidate(
                    person_id=1002,
                    confidence=0.45,
                    reasoning="Name matches but different school",
                ),
            ],
        )
        assert len(response.ranked_selections) == 2
        assert response.ranked_selections[0].person_id == 1001
        assert response.ranked_selections[0].confidence == 0.92
        assert response.ranked_selections[0].reasoning == "Name and school match"
        assert response.ranked_selections[1].person_id == 1002
        assert response.ranked_selections[1].confidence == 0.45

    def test_no_match_flag(self):
        """no_match=True with empty selections and a reason is valid."""
        response = AIDisambiguationResponse(
            ranked_selections=[],
            no_match=True,
            no_match_reason="No candidate shares name, school, or session with requester",
        )
        assert response.no_match is True
        assert response.no_match_reason == "No candidate shares name, school, or session with requester"
        assert len(response.ranked_selections) == 0

    def test_empty_ranked_selections_valid(self):
        """Default construction produces empty ranked_selections and no_match=False."""
        response = AIDisambiguationResponse()
        assert response.ranked_selections == []
        assert response.no_match is False
        assert response.no_match_reason == ""
        assert response.confidence == 0.0
        assert response.reasoning == ""

    def test_ranked_and_no_match_mutually_exclusive(self):
        """Cannot set ranked_selections AND no_match=True simultaneously."""
        with pytest.raises(ValueError, match="mutually exclusive"):
            AIDisambiguationResponse(
                ranked_selections=[
                    AIDisambiguationCandidate(person_id=1001, confidence=0.90, reasoning="test"),
                ],
                no_match=True,
                no_match_reason="contradictory",
            )


class TestOpenAIProviderDisambiguateMetadata:
    """End-to-end tests for OpenAIProvider.disambiguate() metadata translation layer.

    Verifies that each AIDisambiguationResponse field is correctly wired into
    ParsedRequest.metadata, preventing silent no_match / ranked_selections loss.
    """

    @pytest.fixture
    def mock_openai_client(self):
        """Create a mock OpenAI client."""
        client = MagicMock()
        client.responses = MagicMock()
        client.responses.parse = AsyncMock()
        return client

    def _make_provider_and_request(self, mock_openai_client):
        """Set up provider and a bare ParsedRequest for disambiguation."""
        from bunking.sync.bunk_request_processor.core.models import ParsedRequest, RequestType
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
        provider.client = mock_openai_client

        parsed_req = ParsedRequest(
            raw_text="bunk with Liam",
            request_type=RequestType.BUNK_WITH,
            target_name="Liam",
            age_preference=None,
            source_field="bunk_with",
            confidence=0.5,
            csv_position=1,
            metadata={},
        )
        context = AIRequestContext(
            requester_name="Emma Johnson",
            requester_cm_id=10001,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "candidates": [
                    {"name": "Liam Garcia", "person_id": 2001, "school": "Oak Valley Middle"},
                    {"name": "Liam Chen", "person_id": 2002, "school": "Riverside Elementary"},
                ],
            },
        )
        return provider, parsed_req, context

    def _mock_response(self, mock_client: MagicMock, ai_response: AIDisambiguationResponse) -> None:
        mock_text = MagicMock()
        mock_text.parsed = ai_response
        mock_message = MagicMock(spec=[])
        mock_message.type = "message"
        mock_message.content = [mock_text]
        mock_resp = MagicMock()
        mock_resp.output = [mock_message]
        mock_resp.usage = MagicMock(input_tokens=50, output_tokens=20)
        mock_client.responses.parse = AsyncMock(return_value=mock_resp)

    @pytest.mark.asyncio
    async def test_ranked_selections_written_to_metadata(self, mock_openai_client):
        """ranked_selections from AI are serialized into metadata["ranked_selections"]."""
        provider, parsed_req, context = self._make_provider_and_request(mock_openai_client)
        self._mock_response(
            mock_openai_client,
            AIDisambiguationResponse(
                ranked_selections=[
                    AIDisambiguationCandidate(person_id=2001, confidence=0.88, reasoning="Name match"),
                    AIDisambiguationCandidate(person_id=2002, confidence=0.52, reasoning="Partial match"),
                ],
            ),
        )

        result = await provider.disambiguate(parsed_req, context)

        ranked = result.requests[0].metadata.get("ranked_selections")
        assert ranked is not None, "ranked_selections must be written to metadata"
        assert len(ranked) == 2
        assert ranked[0]["person_id"] == 2001
        assert ranked[0]["confidence"] == pytest.approx(0.88)
        assert result.requests[0].metadata.get("no_match") is not True

    @pytest.mark.asyncio
    async def test_no_match_written_to_metadata(self, mock_openai_client):
        """no_match=True from AI is written to metadata and reason is preserved."""
        provider, parsed_req, context = self._make_provider_and_request(mock_openai_client)
        self._mock_response(
            mock_openai_client,
            AIDisambiguationResponse(
                no_match=True,
                no_match_reason="No candidate shares name with target",
            ),
        )

        result = await provider.disambiguate(parsed_req, context)

        meta = result.requests[0].metadata
        assert meta.get("no_match") is True, "no_match must be written to metadata"
        assert meta.get("no_match_reason") == "No candidate shares name with target"
        assert meta.get("ranked_selections") is None


class TestOpenAIProviderAgeDirectionConversion:
    """#1401: provider reads ai_req.age_direction directly (no target_name overload).

    Drift case — target_name set on an age_preference — is logged as ERROR and
    salvaged as an undirected preference (age_preference=None, target_name=None),
    NOT silently re-mapped back to AgePreference like the old age_pref_map block did.
    """

    @pytest.fixture
    def context(self):
        return AIRequestContext(
            requester_name="Test User",
            requester_cm_id=12345,
            session_cm_id=1000002,
            year=2025,
            additional_context={
                "parse_only": True,
                "field_type": "share_bunk_with",
                "csv_source_field": "share_bunk_with",
            },
        )

    def _build_response(self, **kwargs):
        return AIParseResponse(requests=[AIBunkRequestItem(request_type="age_preference", **kwargs)])

    def test_direction_older_produces_age_preference_older(self, context):
        from bunking.sync.bunk_request_processor.core.models import AgePreference
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        with patch("openai.AsyncOpenAI"):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        ai_response = self._build_response(age_direction="older")
        result = provider._convert_parse_response(ai_response, "wants older cabinmates", context)

        assert len(result.requests) == 1
        parsed = result.requests[0]
        assert parsed.request_type == RequestType.AGE_PREFERENCE
        assert parsed.age_preference == AgePreference.OLDER
        assert parsed.target_name is None

    def test_direction_younger_produces_age_preference_younger(self, context):
        from bunking.sync.bunk_request_processor.core.models import AgePreference
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        with patch("openai.AsyncOpenAI"):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        ai_response = self._build_response(age_direction="younger")
        result = provider._convert_parse_response(ai_response, "wants younger cabinmates", context)

        parsed = result.requests[0]
        assert parsed.age_preference == AgePreference.YOUNGER
        assert parsed.target_name is None

    def test_direction_none_produces_age_preference_none(self, context):
        """Undirected age preference — staff must review downstream via _age_preference_rules."""
        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        with patch("openai.AsyncOpenAI"):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        ai_response = self._build_response(age_direction=None)
        result = provider._convert_parse_response(ai_response, "wants age-appropriate cabin", context)

        parsed = result.requests[0]
        assert parsed.request_type == RequestType.AGE_PREFERENCE
        assert parsed.age_preference is None
        assert parsed.target_name is None

    def test_drift_target_name_on_age_pref_logs_error_and_salvages(self, context, caplog):
        """Old-shape drift: AI emits target_name="older" on age_preference.

        Provider must log ERROR and salvage as undirected (NOT re-map back to AgePreference.OLDER
        as the old age_pref_map block did). This is the regression-prevention guard.
        """
        import logging

        from bunking.sync.bunk_request_processor.integration.openai_provider import OpenAIProvider

        with patch("openai.AsyncOpenAI"):
            provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        ai_response = self._build_response(target_name="older", age_direction=None)

        with caplog.at_level(logging.ERROR):
            result = provider._convert_parse_response(ai_response, "older please", context)

        parsed = result.requests[0]
        assert parsed.age_preference is None, "drift target_name must NOT be silently re-mapped to AgePreference"
        assert parsed.target_name is None, "drift target_name must be cleared during salvage"
        assert any("age_direction" in r.message or "drift" in r.message.lower() for r in caplog.records), (
            "drift must be logged at ERROR level"
        )
