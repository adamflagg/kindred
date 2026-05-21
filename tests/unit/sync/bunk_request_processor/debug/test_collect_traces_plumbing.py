"""Tests for collect_traces plumbing through API → process_bunk_requests → orchestrator.

Verifies that:
1. process_bunk_requests creates a real TraceCollector when collect_traces=True
2. process_bunk_requests creates a NoOpTraceCollector when collect_traces=False (default)
3. The collector is passed to RequestOrchestrator
4. flush() is called after processing when collect_traces=True
5. flush() failure does not fail the overall request
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bunking.sync.bunk_request_processor.debug.trace_collector import (
    NoOpTraceCollector,
    TraceCollector,
)


@pytest.fixture
def mock_data_context():
    """Create a mock DataAccessContext."""
    ctx = MagicMock()
    ctx.pb_client = MagicMock()
    ctx._year = 2025
    ctx.initialize_sync = MagicMock()
    ctx.close = MagicMock()
    return ctx


@pytest.fixture
def mock_orchestrator():
    """Create a mock RequestOrchestrator."""
    orch = MagicMock()
    orch.process_requests = AsyncMock(
        return_value={
            "success": True,
            "statistics": {"requests_created": 0},
            "requests_created": [],
            "conflicts": [],
        }
    )
    orch.close = AsyncMock()
    orch.ai_config = {"provider": "openai", "model": "test", "api_key": "test-key-1234567890"}
    return orch


class TestCollectTracesPlumbing:
    """Test that collect_traces flag flows through the call chain."""

    @pytest.mark.asyncio
    async def test_collect_traces_false_creates_noop_collector(self, mock_data_context, mock_orchestrator):
        """When collect_traces=False (default), NoOpTraceCollector should be used."""
        from bunking.sync.bunk_request_processor.process_requests import process_bunk_requests

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_data_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ) as mock_orch_cls,
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[],
            ),
        ):
            await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1000001],
                collect_traces=False,
            )

            # Verify orchestrator was constructed with a NoOpTraceCollector
            call_kwargs = mock_orch_cls.call_args
            trace_collector = call_kwargs.kwargs.get("trace_collector")
            assert trace_collector is not None
            assert isinstance(trace_collector, NoOpTraceCollector)

    @pytest.mark.asyncio
    async def test_collect_traces_true_creates_real_collector(self, mock_data_context, mock_orchestrator):
        """When collect_traces=True, a real TraceCollector should be created."""
        from bunking.sync.bunk_request_processor.process_requests import process_bunk_requests

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_data_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ) as mock_orch_cls,
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[],
            ),
        ):
            await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1000001],
                collect_traces=True,
            )

            # Verify orchestrator was constructed with a real TraceCollector
            call_kwargs = mock_orch_cls.call_args
            trace_collector = call_kwargs.kwargs.get("trace_collector")
            assert trace_collector is not None
            assert isinstance(trace_collector, TraceCollector)
            assert not isinstance(trace_collector, NoOpTraceCollector)
            assert trace_collector.enabled is True
            assert trace_collector.run_id != ""

    @pytest.mark.asyncio
    async def test_flush_called_when_traces_enabled(self, mock_data_context, mock_orchestrator):
        """flush() should be called after successful processing when collect_traces=True."""
        from bunking.sync.bunk_request_processor.process_requests import process_bunk_requests

        mock_collector = MagicMock(spec=TraceCollector)
        mock_collector.enabled = True
        mock_collector.flush = AsyncMock(return_value="run-record-id")

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_data_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[],  # Empty list triggers normal processing path (not _empty sentinel)
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.TraceCollector",
                return_value=mock_collector,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.NoOpTraceCollector",
            ),
        ):
            await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1000001],
                collect_traces=True,
            )

            mock_collector.flush.assert_called_once()

    @pytest.mark.asyncio
    async def test_flush_failure_does_not_fail_request(self, mock_data_context, mock_orchestrator):
        """flush() failure should log a warning but not fail the overall request."""
        from bunking.sync.bunk_request_processor.process_requests import process_bunk_requests

        mock_collector = MagicMock(spec=TraceCollector)
        mock_collector.enabled = True
        mock_collector.flush = AsyncMock(side_effect=Exception("PB connection failed"))

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_data_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[{"_already_processed_count": 0, "_empty": True}],
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.TraceCollector",
                return_value=mock_collector,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.NoOpTraceCollector",
            ),
        ):
            # Should NOT raise despite flush() failure
            result = await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1000001],
                collect_traces=True,
            )

            assert result["success"] is True

    @pytest.mark.asyncio
    async def test_flush_not_called_when_traces_disabled(self, mock_data_context, mock_orchestrator):
        """flush() should NOT be called when collect_traces=False."""
        from bunking.sync.bunk_request_processor.process_requests import process_bunk_requests

        mock_collector = MagicMock(spec=NoOpTraceCollector)
        mock_collector.enabled = False
        mock_collector.flush = AsyncMock()

        with (
            patch(
                "bunking.sync.bunk_request_processor.process_requests.DataAccessContext",
                return_value=mock_data_context,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.RequestOrchestrator",
                return_value=mock_orchestrator,
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.load_from_database",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch(
                "bunking.sync.bunk_request_processor.process_requests.NoOpTraceCollector",
                return_value=mock_collector,
            ),
        ):
            await process_bunk_requests(
                data_source="database",
                year=2025,
                session_cm_ids=[1000001],
                collect_traces=False,
            )

            mock_collector.flush.assert_not_called()
