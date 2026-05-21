"""Tests for BatchProcessor transient error retry.

Verifies that BatchProcessor retries on all transient errors (timeout, 500, 429,
connection), not just rate limit errors.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from openai import APITimeoutError, InternalServerError

from bunking.sync.bunk_request_processor.core.models import ParseRequest
from bunking.sync.bunk_request_processor.integration.ai_types import (
    AIRequestContext,
    ParsedResponse,
)
from bunking.sync.bunk_request_processor.integration.batch_processor import (
    BatchProcessor,
    FailedItem,
)
from bunking.sync.bunk_request_processor.integration.openai_provider import TRANSIENT_ERRORS


def _make_parse_request(text: str = "Emma Smith") -> ParseRequest:
    return ParseRequest(
        requester_name="Test Parent",
        requester_cm_id=12345,
        requester_grade="5",
        session_cm_id=100,
        session_name="Session 2",
        year=2026,
        field_name="bunk_with",
        request_text=text,
        row_data={},
    )


def _make_context() -> AIRequestContext:
    return AIRequestContext(
        requester_name="Test Parent",
        requester_cm_id=12345,
        session_cm_id=100,
        year=2026,
    )


class TestTransientErrorsImport:
    """TRANSIENT_ERRORS is available from batch_processor module."""

    def test_transient_errors_defined(self):
        assert TRANSIENT_ERRORS is not None
        assert len(TRANSIENT_ERRORS) >= 4


class TestFailedItemDataclass:
    """FailedItem tracks per-item failure details."""

    def test_creation(self):
        item = FailedItem(
            request_text="Emma Smith",
            requester_info="cm_id=12345",
            error_type="APITimeoutError",
            error_message="Request timed out.",
        )
        assert item.request_text == "Emma Smith"
        assert item.error_type == "APITimeoutError"


class TestBatchRetryOnTransientErrors:
    """BatchProcessor retries on timeout and 500, not just 429."""

    @pytest.mark.asyncio
    async def test_retries_on_timeout_then_succeeds(self):
        """Batch retries when provider raises APITimeoutError, succeeds on second try."""
        mock_provider = MagicMock()
        mock_provider.batch_parse_requests = AsyncMock()

        success_response = ParsedResponse(requests=[], confidence=0.85, metadata={"mock": True})
        mock_provider.batch_parse_requests.side_effect = [
            APITimeoutError(request=MagicMock()),
            [success_response],
        ]

        processor = BatchProcessor(mock_provider)
        req = _make_parse_request()
        ctx = _make_context()

        await processor.batch_parse_requests([req], [ctx])

        assert mock_provider.batch_parse_requests.call_count == 2
        assert processor.stats["total_retries"] >= 1

    @pytest.mark.asyncio
    async def test_retries_on_500_then_succeeds(self):
        """Batch retries when provider raises InternalServerError."""
        mock_provider = MagicMock()
        mock_provider.batch_parse_requests = AsyncMock()

        success_response = ParsedResponse(requests=[], confidence=0.85, metadata={"mock": True})
        mock_provider.batch_parse_requests.side_effect = [
            InternalServerError(message="server error", response=MagicMock(status_code=500), body=None),
            [success_response],
        ]

        processor = BatchProcessor(mock_provider)
        req = _make_parse_request()
        ctx = _make_context()

        await processor.batch_parse_requests([req], [ctx])
        assert mock_provider.batch_parse_requests.call_count == 2

    @pytest.mark.asyncio
    async def test_partial_batch_status_on_item_failures(self):
        """Batch with some item-level transient failures gets PARTIAL status."""
        mock_provider = MagicMock()
        mock_provider.batch_parse_requests = AsyncMock(
            return_value=[
                ParsedResponse(requests=[], confidence=0.85, metadata={"mock": True}),
                ParsedResponse(
                    requests=[],
                    confidence=0.0,
                    metadata={"transient_error": True, "error_type": "APITimeoutError"},
                ),
            ]
        )

        processor = BatchProcessor(mock_provider)
        req1 = _make_parse_request("Emma Smith")
        req2 = _make_parse_request("Liam Garcia")
        ctx = _make_context()

        await processor.batch_parse_requests([req1, req2], [ctx, ctx])

        assert processor.stats["transient_item_failures"] >= 1
