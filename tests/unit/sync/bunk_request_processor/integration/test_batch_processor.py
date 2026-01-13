"""Tests for BatchProcessor.

Tests cover:
- BatchStatus enum
- BatchResult dataclass
- Batch creation (fixed and dynamic sizing)
- Token estimation
- Retry logic with exponential backoff
- Rate limit handling
- Statistics tracking
- Progress callbacks
- Result conversion
"""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from bunking.sync.bunk_request_processor.integration.batch_processor import (
    BatchProcessor,
    BatchResult,
    BatchStatus,
    _call_callback,
)


class TestBatchStatus:
    """Tests for BatchStatus enum."""

    def test_all_statuses_defined(self):
        """All expected batch statuses are defined."""
        expected = {"PENDING", "PROCESSING", "COMPLETED", "FAILED", "RATE_LIMITED"}
        actual = {s.name for s in BatchStatus}
        assert actual == expected

    def test_status_values(self):
        """Status enum values are lowercase strings."""
        assert BatchStatus.PENDING.value == "pending"
        assert BatchStatus.COMPLETED.value == "completed"
        assert BatchStatus.FAILED.value == "failed"


class TestBatchResult:
    """Tests for BatchResult dataclass."""

    def test_batch_result_creation(self):
        """BatchResult can be created with required fields."""
        result = BatchResult(batch_id=1, status=BatchStatus.COMPLETED)

        assert result.batch_id == 1
        assert result.status == BatchStatus.COMPLETED
        assert result.results is None
        assert result.error is None
        assert result.retry_count == 0
        assert result.processing_time == 0.0

    def test_batch_result_with_all_fields(self):
        """BatchResult accepts all optional fields."""
        result = BatchResult(
            batch_id=2,
            status=BatchStatus.FAILED,
            results=["data"],
            error="Something went wrong",
            retry_count=3,
            processing_time=1.5,
        )

        assert result.results == ["data"]
        assert result.error == "Something went wrong"
        assert result.retry_count == 3
        assert result.processing_time == 1.5


class TestCallCallback:
    """Tests for _call_callback helper."""

    @pytest.mark.asyncio
    async def test_call_sync_callback(self):
        """Sync callbacks are called correctly."""
        called_with = []

        def sync_cb(*args):
            called_with.append(args)

        await _call_callback(sync_cb, 1, 2, 3)

        assert called_with == [(1, 2, 3)]

    @pytest.mark.asyncio
    async def test_call_async_callback(self):
        """Async callbacks are awaited correctly."""
        called_with = []

        async def async_cb(*args):
            called_with.append(args)

        await _call_callback(async_cb, "a", "b")

        assert called_with == [("a", "b")]

    @pytest.mark.asyncio
    async def test_call_none_callback(self):
        """None callback is safely ignored."""
        # Should not raise
        await _call_callback(None, 1, 2, 3)


class TestBatchProcessorInit:
    """Tests for BatchProcessor initialization."""

    def test_init_with_provider(self):
        """Processor initializes with AI provider."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        assert processor.ai_provider == mock_provider
        assert processor.config == {}

    def test_init_with_config(self):
        """Processor accepts configuration dict (only 'enabled' is read)."""
        mock_provider = Mock()
        config = {"batch_processing": {"enabled": False, "batch_size": 20}}
        processor = BatchProcessor(ai_provider=mock_provider, config=config)

        assert processor.config == config
        # Only 'enabled' is read from config; batch_size is hardcoded
        assert processor.enabled is False

    def test_init_default_config(self):
        """Default config enables batch processing."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        # BatchProcessor uses hardcoded constants, only 'enabled' from config
        assert processor.enabled is True
        # These are module-level constants, not instance attributes
        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            BATCH_SIZE,
            MAX_CONCURRENT_BATCHES,
        )

        assert BATCH_SIZE == 30
        assert MAX_CONCURRENT_BATCHES == 3

    def test_init_stats_zeroed(self):
        """Statistics are initialized to zero."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        assert processor.stats["total_batches"] == 0
        assert processor.stats["successful_batches"] == 0
        assert processor.stats["failed_batches"] == 0
        assert processor.stats["total_items"] == 0


class TestCreateBatches:
    """Tests for batch creation.

    Note: BatchProcessor uses hardcoded constants for batch sizing.
    - DYNAMIC_BATCH_SIZING_ENABLED = True (default)
    - BATCH_SIZE = 30 (fallback when dynamic is disabled)
    - MAX_TOKENS_PER_BATCH = 8000
    - MIN_BATCH_SIZE = 5, MAX_BATCH_SIZE = 50
    """

    def test_dynamic_batching_default(self):
        """Default batching uses dynamic sizing based on tokens."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        # Create simple items - each is a tuple like (request, context)
        items: list[tuple[Mock, dict[str, object]]] = [(Mock(request_text="short text"), {}) for _ in range(10)]
        batches = processor._create_batches(items)

        # With dynamic batching enabled (default), batches are created based on token estimation
        # For short items, they'll likely all fit in one batch
        assert len(batches) >= 1
        total_items = sum(len(b) for b in batches)
        assert total_items == 10

    def test_all_items_are_batched(self):
        """All items end up in some batch."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        items: list[tuple[Mock, dict[str, object]]] = [(Mock(request_text="test"), {}) for _ in range(100)]
        batches = processor._create_batches(items)

        total_items = sum(len(b) for b in batches)
        assert total_items == 100


class TestDynamicBatching:
    """Tests for dynamic batch sizing.

    Note: Uses hardcoded constants MAX_BATCH_SIZE=50, MIN_BATCH_SIZE=5.
    """

    def test_dynamic_batching_by_tokens(self):
        """Dynamic batching respects token limits (hardcoded)."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        # Create items of known "token size" (via JSON length / 4)
        # Each item tuple has ~50 chars = ~12 tokens
        items = [(Mock(request_text="short text"), {"data": "x"}) for _ in range(10)]

        batches = processor._create_dynamic_batches(items)

        # Should create batches - actual count depends on hardcoded token limits
        assert len(batches) >= 1
        from bunking.sync.bunk_request_processor.integration.batch_processor import MAX_BATCH_SIZE

        for batch in batches:
            assert len(batch) <= MAX_BATCH_SIZE

    def test_dynamic_batching_respects_max_size(self):
        """Dynamic batching doesn't exceed MAX_BATCH_SIZE (hardcoded to 50)."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        # Create many items with small token footprint
        items: list[tuple[Mock, dict[str, object]]] = [(Mock(request_text="x"), {}) for _ in range(200)]
        batches = processor._create_dynamic_batches(items)

        from bunking.sync.bunk_request_processor.integration.batch_processor import MAX_BATCH_SIZE

        for batch in batches:
            assert len(batch) <= MAX_BATCH_SIZE


class TestEstimateTokens:
    """Tests for token estimation."""

    def test_estimate_tokens_from_request_text(self):
        """Token estimation uses request_text when available."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        request = Mock()
        request.request_text = "This is a test request text"
        item: tuple[Mock, dict[str, object]] = (request, {})

        tokens = processor._estimate_tokens(item)

        # ~28 chars / 4 = ~7 tokens
        assert tokens > 0
        assert tokens < 20

    def test_estimate_tokens_from_raw_text(self):
        """Token estimation falls back to raw_text."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        request = Mock(spec=["raw_text"])
        request.raw_text = "Raw text content"
        item: tuple[Mock, dict[str, object]] = (request, {})

        tokens = processor._estimate_tokens(item)

        assert tokens > 0

    def test_estimate_tokens_includes_context(self):
        """Token estimation includes context dict."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        request = Mock()
        request.request_text = "short"
        context = {"key1": "value1", "key2": "value2"}
        item = (request, context)

        tokens = processor._estimate_tokens(item)

        # Should include both request and context
        assert tokens > 1


class TestRetryDelay:
    """Tests for retry delay calculation.

    Note: Uses hardcoded constants:
    - RATE_LIMIT_INITIAL_DELAY_MS = 1000
    - RATE_LIMIT_MAX_DELAY_MS = 60000
    - RATE_LIMIT_EXPONENTIAL_BASE = 2
    """

    def test_exponential_backoff(self):
        """Delay increases exponentially with retries."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        delay1 = processor._calculate_retry_delay(1)
        delay2 = processor._calculate_retry_delay(2)
        delay3 = processor._calculate_retry_delay(3)

        # Hardcoded: initial=1s, base=2, so doubling each retry
        assert 0.9 <= delay1 <= 1.1  # ~1s with jitter
        assert 1.8 <= delay2 <= 2.2  # ~2s with jitter
        assert 3.6 <= delay3 <= 4.4  # ~4s with jitter

    def test_delay_capped_at_max(self):
        """Delay doesn't exceed max_delay_ms (hardcoded to 60s)."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            RATE_LIMIT_MAX_DELAY_MS,
        )

        # At retry 10, would be 1024s without cap
        delay = processor._calculate_retry_delay(10)

        # Should be capped at max (60s) + jitter (10%)
        max_with_jitter = (RATE_LIMIT_MAX_DELAY_MS / 1000) * 1.1
        assert delay <= max_with_jitter


class TestEstimateBatchSize:
    """Tests for _estimate_batch_size method.

    Note: Uses dynamic batch sizing by default (DYNAMIC_BATCH_SIZING_ENABLED=True).
    With dynamic sizing, batch sizes are estimated based on avg(MIN, MAX) = (5+50)/2 = 27.
    """

    def test_dynamic_batch_size_estimation(self):
        """Estimates batch size for dynamic batching (default)."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        from bunking.sync.bunk_request_processor.integration.batch_processor import (
            MAX_BATCH_SIZE,
            MIN_BATCH_SIZE,
        )

        avg_batch_size = (MIN_BATCH_SIZE + MAX_BATCH_SIZE) // 2  # = 27

        # Total 100 items with dynamic sizing
        # Estimated size should be based on average batch size
        size_0 = processor._estimate_batch_size(0, 100)
        size_1 = processor._estimate_batch_size(1, 100)

        assert size_0 == avg_batch_size
        assert size_1 == avg_batch_size


class TestStatistics:
    """Tests for statistics tracking."""

    def test_get_statistics_returns_copy(self):
        """get_statistics returns a copy of stats."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)
        processor.stats["total_batches"] = 5

        stats = processor.get_statistics()

        assert stats["total_batches"] == 5
        assert stats is not processor.stats

    def test_statistics_structure(self):
        """Statistics have expected keys."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        stats = processor.get_statistics()

        assert "total_batches" in stats
        assert "successful_batches" in stats
        assert "failed_batches" in stats
        assert "rate_limited_batches" in stats
        assert "total_items" in stats
        assert "total_retries" in stats
        assert "total_time" in stats


class TestConvertToParseResult:
    """Tests for _convert_to_parse_result method."""

    def test_convert_successful_response(self):
        """Successful response is converted to ParseResult."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        parse_request = Mock()
        parse_request.field_name = "bunk_with"

        parsed_request = Mock()
        parsed_request.source_field = None
        parsed_request.confidence = 0.9

        parsed_response = Mock()
        parsed_response.requests = [parsed_request]
        parsed_response.metadata = {
            "needs_historical_context": False,
            "provider": "openai",
            "model": "gpt-4",
        }

        result = processor._convert_to_parse_result(parse_request, parsed_response)

        assert result.is_valid is True
        assert len(result.parsed_requests) == 1
        assert result.parsed_requests[0].source_field == "bunk_with"
        assert result.metadata["ai_provider"] == "openai"

    def test_convert_empty_response(self):
        """Empty response creates failed result."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        parse_request = Mock()
        parsed_response = Mock()
        parsed_response.requests = []
        parsed_response.metadata = {}

        result = processor._convert_to_parse_result(parse_request, parsed_response)

        assert result.is_valid is False
        assert "failure_reason" in result.metadata

    def test_convert_multiple_requests(self):
        """Multiple requests in response are all included."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        parse_request = Mock()
        parse_request.field_name = "bunk_with"

        req1 = Mock()
        req1.source_field = None
        req1.confidence = 0.9

        req2 = Mock()
        req2.source_field = None
        req2.confidence = 0.8

        parsed_response = Mock()
        parsed_response.requests = [req1, req2]
        parsed_response.metadata = {}

        result = processor._convert_to_parse_result(parse_request, parsed_response)

        assert len(result.parsed_requests) == 2
        assert result.metadata["request_count"] == 2


class TestCreateFailedResult:
    """Tests for _create_failed_result method."""

    def test_create_failed_result(self):
        """Failed result has correct structure."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        parse_request = Mock()
        reason = "Test failure reason"

        result = processor._create_failed_result(parse_request, reason)

        assert result.is_valid is False
        assert result.parsed_requests == []
        assert result.needs_historical_context is False
        assert result.metadata["failure_reason"] == reason


class TestBatchParseRequests:
    """Tests for batch_parse_requests method."""

    @pytest.mark.asyncio
    async def test_empty_requests_returns_empty(self):
        """Empty request list returns empty results."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        results = await processor.batch_parse_requests([], [])

        assert results == []

    @pytest.mark.asyncio
    async def test_batch_processing_calls_provider(self):
        """Batch processing calls AI provider correctly."""
        mock_provider = AsyncMock()

        parsed_req = Mock()
        parsed_req.source_field = None
        parsed_req.confidence = 0.9

        mock_provider.batch_parse_requests.return_value = [Mock(requests=[parsed_req], metadata={})]

        # Disable dynamic batching to simplify test
        config = {
            "batch_processing": {
                "batch_size": 10,
                "dynamic_batch_sizing": {"enabled": False},
            }
        }
        processor = BatchProcessor(ai_provider=mock_provider, config=config)

        request = Mock()
        request.request_text = "test"
        request.field_name = "bunk_with"

        # Use a real dict context, not Mock
        context = Mock()
        context.requester_name = "Test Person"

        results = await processor.batch_parse_requests([request], [context])

        assert len(results) == 1
        mock_provider.batch_parse_requests.assert_called()


class TestBatchDisambiguate:
    """Tests for batch_disambiguate method."""

    @pytest.mark.asyncio
    async def test_empty_requests_returns_empty(self):
        """Empty request list returns empty results."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        results = await processor.batch_disambiguate([])

        assert results == []


class TestRateLimitHandling:
    """Tests for rate limit handling."""

    @pytest.mark.asyncio
    async def test_rate_limit_counter_reset(self):
        """Rate limit counter resets after a minute."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        # Simulate old request time
        processor.last_request_time = 0
        processor.requests_this_minute = 100

        await processor._check_rate_limits()

        # Counter should reset
        assert processor.requests_this_minute == 1

    @pytest.mark.asyncio
    async def test_rate_limit_adds_delay_when_high(self):
        """Adds delay when request count is high."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        # Set high request count
        import time

        processor.last_request_time = time.time()
        processor.requests_this_minute = 60

        # Should not raise, just add small delay
        await processor._check_rate_limits()

        assert processor.requests_this_minute == 61


class TestLogStatistics:
    """Tests for _log_statistics method."""

    def test_log_statistics_no_batches(self):
        """Log statistics handles zero batches gracefully."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)

        # Should not raise
        processor._log_statistics()

    def test_log_statistics_with_data(self):
        """Log statistics works with data."""
        mock_provider = Mock()
        processor = BatchProcessor(ai_provider=mock_provider)
        processor.stats = {
            "total_batches": 10,
            "successful_batches": 8,
            "failed_batches": 2,
            "rate_limited_batches": 1,
            "total_items": 100,
            "total_retries": 3,
            "total_time": 15.5,
        }

        # Should not raise
        processor._log_statistics()
