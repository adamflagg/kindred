"""Tests for Phase1ParseService retry rounds.

Verifies that Phase 1 collects transient failures from BatchProcessor,
waits, re-submits them, and logs reconciliation.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import ParseRequest, ParseResult
from bunking.sync.bunk_request_processor.integration.batch_processor import BatchProcessor
from bunking.sync.bunk_request_processor.services.phase1_parse_service import Phase1ParseService


def _make_parse_request(text: str = "Emma Smith", cm_id: int = 12345) -> ParseRequest:
    return ParseRequest(
        requester_name="Test Parent",
        requester_cm_id=cm_id,
        requester_grade="5",
        session_cm_id=100,
        session_name="Session 2",
        year=2026,
        field_name="bunk_with",
        request_text=text,
        row_data={},
    )


def _make_success_result(req: ParseRequest) -> ParseResult:
    return ParseResult(
        parsed_requests=[],
        needs_historical_context=False,
        is_valid=True,
        parse_request=req,
        metadata={},
    )


def _make_failed_result(req: ParseRequest) -> ParseResult:
    return ParseResult(
        parsed_requests=[],
        needs_historical_context=False,
        is_valid=False,
        parse_request=req,
        metadata={"failure_reason": "Batch failed: APITimeoutError", "transient_error": True},
    )


class TestPhaseRetryRounds:
    """Phase1ParseService retries transient failures between rounds."""

    @pytest.mark.asyncio
    async def test_no_retry_when_all_succeed(self):
        """When all items succeed, no retry rounds are needed."""
        mock_provider = MagicMock()
        mock_context_builder = MagicMock()
        mock_context_builder.build_parse_only_context.return_value = MagicMock()

        mock_batch_processor = MagicMock(spec=BatchProcessor)
        mock_batch_processor.batch_parse_requests = AsyncMock()
        mock_batch_processor.get_statistics.return_value = {
            "successful_batches": 1,
            "failed_batches": 0,
            "total_retries": 0,
        }

        req = _make_parse_request()
        mock_batch_processor.batch_parse_requests.return_value = [_make_success_result(req)]

        service = Phase1ParseService(
            ai_service=mock_provider,
            context_builder=mock_context_builder,
            batch_processor=mock_batch_processor,
        )
        results = await service.batch_parse([req])

        assert len(results) == 1
        assert results[0].is_valid is True
        # batch_parse_requests called exactly once (no retries)
        assert mock_batch_processor.batch_parse_requests.call_count == 1

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.services.phase1_parse_service.asyncio.sleep", new_callable=AsyncMock)
    async def test_retries_transient_failures(self, mock_sleep):
        """Transient failures are collected and retried in subsequent rounds."""
        mock_provider = MagicMock()
        mock_context_builder = MagicMock()
        mock_context_builder.build_parse_only_context.return_value = MagicMock()

        mock_batch_processor = MagicMock(spec=BatchProcessor)
        mock_batch_processor.get_statistics.return_value = {
            "successful_batches": 1,
            "failed_batches": 0,
            "total_retries": 0,
        }

        req1 = _make_parse_request("Emma Smith", cm_id=1)
        req2 = _make_parse_request("Liam Garcia", cm_id=2)

        # Round 1: req2 fails
        # Round 2: req2 succeeds
        mock_batch_processor.batch_parse_requests = AsyncMock(
            side_effect=[
                [_make_success_result(req1), _make_failed_result(req2)],  # Round 1
                [_make_success_result(req2)],  # Round 2 (retry of req2)
            ]
        )

        service = Phase1ParseService(
            ai_service=mock_provider,
            context_builder=mock_context_builder,
            batch_processor=mock_batch_processor,
        )
        results = await service.batch_parse([req1, req2])

        assert len(results) == 2
        # Both should now be valid (req2 recovered in round 2)
        assert results[0].is_valid is True
        assert results[1].is_valid is True
        # Called twice: initial + 1 retry round
        assert mock_batch_processor.batch_parse_requests.call_count == 2
        # Sleep was called for the retry delay
        mock_sleep.assert_called_once()

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.services.phase1_parse_service.asyncio.sleep", new_callable=AsyncMock)
    async def test_max_retry_rounds_exhausted(self, mock_sleep):
        """After MAX_PHASE_RETRY_ROUNDS, remaining failures are accepted."""
        mock_provider = MagicMock()
        mock_context_builder = MagicMock()
        mock_context_builder.build_parse_only_context.return_value = MagicMock()

        mock_batch_processor = MagicMock(spec=BatchProcessor)
        mock_batch_processor.get_statistics.return_value = {
            "successful_batches": 0,
            "failed_batches": 1,
            "total_retries": 0,
        }

        req = _make_parse_request("Emma Smith")
        failed = _make_failed_result(req)

        # All rounds fail
        mock_batch_processor.batch_parse_requests = AsyncMock(return_value=[failed])

        service = Phase1ParseService(
            ai_service=mock_provider,
            context_builder=mock_context_builder,
            batch_processor=mock_batch_processor,
        )
        results = await service.batch_parse([req])

        assert len(results) == 1
        assert results[0].is_valid is False
        # 1 initial + 3 retry rounds = 4 calls
        assert mock_batch_processor.batch_parse_requests.call_count == 4
        # Stats track permanently failed
        stats = service.get_stats()
        assert stats["permanently_failed"] >= 1


class TestReconciliationLogging:
    """Phase1ParseService logs a clear summary after retry rounds."""

    @pytest.mark.asyncio
    async def test_stats_include_retry_fields(self):
        """get_stats() includes phase_retry_rounds, recovered, permanently_failed."""
        mock_provider = MagicMock()
        mock_context_builder = MagicMock()
        mock_context_builder.build_parse_only_context.return_value = MagicMock()

        mock_batch_processor = MagicMock(spec=BatchProcessor)
        mock_batch_processor.batch_parse_requests = AsyncMock(return_value=[])
        mock_batch_processor.get_statistics.return_value = {
            "successful_batches": 0,
            "failed_batches": 0,
            "total_retries": 0,
        }

        service = Phase1ParseService(
            ai_service=mock_provider,
            context_builder=mock_context_builder,
            batch_processor=mock_batch_processor,
        )
        await service.batch_parse([])

        stats = service.get_stats()
        assert "phase_retry_rounds" in stats
        assert "recovered_in_retry" in stats
        assert "permanently_failed" in stats
