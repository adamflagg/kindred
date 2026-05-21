"""Tests for OpenAI provider transient error handling.

Verifies that transient errors (timeout, 500, 429, connection) propagate
to callers instead of being swallowed into empty responses.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openai import APIConnectionError, APITimeoutError, InternalServerError, RateLimitError

from bunking.sync.bunk_request_processor.integration.ai_service import AIRequestContext
from bunking.sync.bunk_request_processor.integration.openai_provider import (
    TRANSIENT_ERRORS,
    OpenAIProvider,
)


def _make_context() -> AIRequestContext:
    return AIRequestContext(
        requester_name="Emma Johnson",
        requester_cm_id=12345,
        session_cm_id=100,
        year=2026,
        additional_context={"field_type": "bunk_with", "parse_only": True},
    )


class TestTransientErrorDefinition:
    """TRANSIENT_ERRORS tuple is correctly defined."""

    def test_includes_timeout(self):
        assert APITimeoutError in TRANSIENT_ERRORS

    def test_includes_internal_server_error(self):
        assert InternalServerError in TRANSIENT_ERRORS

    def test_includes_rate_limit_error(self):
        assert RateLimitError in TRANSIENT_ERRORS

    def test_includes_connection_error(self):
        assert APIConnectionError in TRANSIENT_ERRORS


class TestParseRequestTransientErrors:
    """parse_request() re-raises transient errors."""

    @pytest.mark.asyncio
    async def test_timeout_propagates(self):
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        with patch.object(provider, "_call_with_structured_output", new_callable=AsyncMock) as mock_call:
            mock_call.side_effect = APITimeoutError(request=MagicMock())
            with pytest.raises(APITimeoutError):
                await provider.parse_request("Emma Smith", _make_context())

    @pytest.mark.asyncio
    async def test_internal_server_error_propagates(self):
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        with patch.object(provider, "_call_with_structured_output", new_callable=AsyncMock) as mock_call:
            mock_call.side_effect = InternalServerError(
                message="server error", response=AsyncMock(status_code=500), body=None
            )
            with pytest.raises(InternalServerError):
                await provider.parse_request("Emma Smith", _make_context())

    @pytest.mark.asyncio
    async def test_non_transient_error_returns_empty_response(self):
        """Non-transient errors (e.g., ValueError) still return empty ParsedResponse."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")

        with patch.object(provider, "_call_with_structured_output", new_callable=AsyncMock) as mock_call:
            mock_call.side_effect = ValueError("bad input")
            result = await provider.parse_request("Emma Smith", _make_context())
            assert result.requests == []
            assert result.metadata.get("error_type") == "ValueError"


class TestBatchParseTransientErrors:
    """batch_parse_requests() tags per-item transient failures and continues."""

    @pytest.mark.asyncio
    async def test_transient_failure_tagged_in_metadata(self):
        """Items that fail with transient errors get tagged, batch continues."""
        provider = OpenAIProvider(api_key="test-key", model="gpt-5-nano")
        ctx = _make_context()

        call_count = 0

        async def mock_parse(text, context):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise APITimeoutError(request=MagicMock())
            from bunking.sync.bunk_request_processor.integration.ai_types import ParsedResponse

            return ParsedResponse(requests=[], confidence=0.85, metadata={"mock": True})

        with patch.object(provider, "parse_request", side_effect=mock_parse):
            results = await provider.batch_parse_requests(
                [
                    ("Emma Smith", ctx),
                    ("Liam Garcia", ctx),
                    ("Olivia Chen", ctx),
                ]
            )

        assert len(results) == 3
        assert results[0].metadata.get("transient_error") is not True
        assert results[1].metadata.get("transient_error") is True
        assert results[1].metadata.get("error_type") == "APITimeoutError"
        assert results[1].requests == []
        assert results[2].metadata.get("transient_error") is not True
