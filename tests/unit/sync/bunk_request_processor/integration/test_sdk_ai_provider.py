"""Tests for OpenAI SDK-based AI provider.

TDD tests written BEFORE implementation to define expected behavior.
Uses Pydantic structured outputs via the Responses API.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.integration.ai_schemas import (
    AIBunkRequestItem,
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
                request_type="unknown",  # type: ignore[arg-type]  # Invalid!
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
                source_type="invalid",  # type: ignore[arg-type]  # Invalid!
            )
        assert "source_type" in str(exc_info.value)

    def test_disambiguation_response_confidence_bounds(self):
        """Disambiguation confidence must be between 0 and 1."""
        # Valid
        response = AIDisambiguationResponse(
            selected_person_id=12345,
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

    def test_source_type_mapping(self):
        """AI source_type strings map to RequestSource enum."""

        # Verify the enum values match what AI can output
        assert RequestSource.FAMILY.value in ["family", "FAMILY"]
        assert RequestSource.STAFF.value in ["staff", "STAFF"]
        assert RequestSource.NOTES.value in ["notes", "NOTES"]
