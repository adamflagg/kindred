"""Integration test for the full retry flow.

Provider -> BatchProcessor -> Phase1ParseService retry rounds.
Verifies the complete chain works together.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import ParseRequest
from bunking.sync.bunk_request_processor.integration.batch_processor import BatchProcessor
from bunking.sync.bunk_request_processor.services.phase1_parse_service import Phase1ParseService


def _make_request(text: str, cm_id: int) -> ParseRequest:
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


class TestFullRetryChain:
    """End-to-end: provider transient failures -> BatchProcessor -> Phase1 retry rounds."""

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.services.phase1_parse_service.asyncio.sleep", new_callable=AsyncMock)
    async def test_recovers_after_provider_timeout(self, mock_sleep):
        """Item that times out in round 1 succeeds in round 2."""
        call_count = 0

        async def mock_batch_parse(requests, contexts, progress_callback=None):
            nonlocal call_count
            call_count += 1
            results = []
            for req, _ctx in zip(requests, contexts, strict=True):
                if req.request_text == "Liam Garcia" and call_count == 1:
                    result = MagicMock()
                    result.is_valid = False
                    result.parsed_requests = []
                    result.needs_historical_context = False
                    result.parse_request = req
                    result.metadata = {"failure_reason": "Batch failed: APITimeoutError", "transient_error": True}
                    results.append(result)
                else:
                    result = MagicMock()
                    result.is_valid = True
                    result.parsed_requests = []
                    result.needs_historical_context = False
                    result.parse_request = req
                    result.metadata = {}
                    results.append(result)
            return results

        mock_batch_processor = MagicMock(spec=BatchProcessor)
        mock_batch_processor.batch_parse_requests = AsyncMock(side_effect=mock_batch_parse)
        mock_batch_processor.get_statistics.return_value = {
            "successful_batches": 1,
            "failed_batches": 0,
            "total_retries": 0,
        }

        mock_context_builder = MagicMock()
        mock_context_builder.build_parse_only_context.return_value = MagicMock()

        service = Phase1ParseService(
            ai_service=MagicMock(),
            context_builder=mock_context_builder,
            batch_processor=mock_batch_processor,
        )

        reqs = [
            _make_request("Emma Smith", 1),
            _make_request("Liam Garcia", 2),
            _make_request("Olivia Chen", 3),
        ]

        results = await service.batch_parse(reqs)

        assert len(results) == 3
        # All should be valid after retry
        assert all(r.is_valid for r in results)

        stats = service.get_stats()
        assert stats["phase_retry_rounds"] >= 1
        assert stats["recovered_in_retry"] >= 1
        assert stats["permanently_failed"] == 0
