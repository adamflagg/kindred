"""Tests for BatchProcessor disambiguation path.

Verifies that batch_disambiguate correctly calls ai_provider.disambiguate()
with (parsed_request, context) — not parse_request() with (target_name, context)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestType,
)
from bunking.sync.bunk_request_processor.integration.ai_service import AIRequestContext
from bunking.sync.bunk_request_processor.integration.batch_processor import BatchProcessor


def _make_parsed_request(target_name: str = "Sarah Smith") -> ParsedRequest:
    return ParsedRequest(
        raw_text=f"I want to bunk with {target_name}",
        request_type=RequestType.BUNK_WITH,
        target_name=target_name,
        age_preference=None,
        source_field="bunk_request_form",
        confidence=0.9,
        csv_position=0,
        metadata={},
    )


def _make_context(
    requester_name: str = "Test Requester",
    requester_cm_id: int = 11111,
    session_cm_id: int = 1000002,
    year: int = 2025,
) -> AIRequestContext:
    return AIRequestContext(
        requester_name=requester_name,
        requester_cm_id=requester_cm_id,
        session_cm_id=session_cm_id,
        year=year,
        additional_context={"candidates": [{"cm_id": 12345, "name": "Sarah Smith"}]},
    )


class TestBatchProcessorDisambiguate:
    """Test the disambiguation code path in BatchProcessor."""

    @pytest.mark.asyncio
    async def test_disambiguate_calls_disambiguate_not_parse_request(self):
        """batch_disambiguate must call ai_provider.disambiguate(), not parse_request()."""
        mock_response = MagicMock()
        mock_response.ranked_selections = []
        mock_response.confidence = 0.8
        mock_response.reasoning = "Best match"

        ai_provider = Mock()
        ai_provider.disambiguate = AsyncMock(return_value=mock_response)
        ai_provider.parse_request = AsyncMock()

        processor = BatchProcessor(ai_provider=ai_provider, config={})

        parsed_req = _make_parsed_request(target_name="Sarah Smith")
        context = _make_context()

        await processor.batch_disambiguate(
            disambiguation_requests=[(parsed_req, context)],
        )

        # Must call disambiguate(), not parse_request()
        ai_provider.disambiguate.assert_called_once()
        ai_provider.parse_request.assert_not_called()
        call_args = ai_provider.disambiguate.call_args
        # First arg is ParsedRequest
        assert isinstance(call_args[0][0], ParsedRequest), (
            f"Expected ParsedRequest as first arg, got {type(call_args[0][0])}"
        )
        # Second arg is AIRequestContext
        assert isinstance(call_args[0][1], AIRequestContext), (
            f"Expected AIRequestContext as second arg, got {type(call_args[0][1])}"
        )

    @pytest.mark.asyncio
    async def test_disambiguate_does_not_crash_on_real_context(self):
        """Regression: old code converted AIRequestContext to dict, causing AttributeError."""
        mock_response = MagicMock()
        mock_response.ranked_selections = []
        mock_response.no_match = True
        mock_response.confidence = 0.0
        mock_response.reasoning = "No match"

        ai_provider = Mock()
        ai_provider.disambiguate = AsyncMock(return_value=mock_response)

        processor = BatchProcessor(ai_provider=ai_provider, config={})

        parsed_req = _make_parsed_request()
        context = _make_context()

        # This must not raise AttributeError
        results = await processor.batch_disambiguate(
            disambiguation_requests=[(parsed_req, context)],
        )
        assert len(results) == 1
