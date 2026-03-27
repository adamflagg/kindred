"""Tests for BatchProcessor disambiguation path.

Verifies that batch_disambiguate correctly passes (target_name, context)
to the AI provider — the code path that has been broken since initial commit
due to dict conversion + missing attribute access."""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.integration.ai_types import AIRequestContext
from bunking.sync.bunk_request_processor.integration.batch_processor import BatchProcessor


def _make_parsed_request(target_name: str = "Sarah Smith") -> ParsedRequest:
    return ParsedRequest(
        raw_text=f"I want to bunk with {target_name}",
        request_type=RequestType.BUNK_WITH,
        target_name=target_name,
        age_preference=None,
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,
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
    async def test_disambiguate_calls_ai_with_target_name_and_context(self):
        """batch_disambiguate must pass (target_name, AIRequestContext) to ai_provider."""
        mock_response = Mock()
        mock_response.person_cm_id = 12345
        mock_response.confidence = 0.8
        mock_response.reason = "Best match"

        ai_provider = Mock()
        ai_provider.parse_request = AsyncMock(return_value=mock_response)

        processor = BatchProcessor(ai_provider=ai_provider, config={})

        parsed_req = _make_parsed_request(target_name="Sarah Smith")
        context = _make_context()

        await processor.batch_disambiguate(
            disambiguation_requests=[(parsed_req, context)],
        )

        # AI provider must be called with target_name as request_text
        ai_provider.parse_request.assert_called_once()
        call_args = ai_provider.parse_request.call_args
        assert call_args[0][0] == "Sarah Smith", (
            f"Expected target_name 'Sarah Smith' as first arg, got {call_args[0][0]!r}"
        )
        assert isinstance(call_args[0][1], AIRequestContext), (
            f"Expected AIRequestContext as second arg, got {type(call_args[0][1])}"
        )

    @pytest.mark.asyncio
    async def test_disambiguate_does_not_crash_on_real_context(self):
        """Regression: the old code converted AIRequestContext to dict,
        then tried attribute access (.request_text) on the dict — AttributeError."""
        mock_response = Mock()
        mock_response.person_cm_id = None
        mock_response.confidence = 0.0
        mock_response.reason = "No match"

        ai_provider = Mock()
        ai_provider.parse_request = AsyncMock(return_value=mock_response)

        processor = BatchProcessor(ai_provider=ai_provider, config={})

        parsed_req = _make_parsed_request()
        context = _make_context()

        # This must not raise AttributeError
        results = await processor.batch_disambiguate(
            disambiguation_requests=[(parsed_req, context)],
        )
        assert len(results) == 1
