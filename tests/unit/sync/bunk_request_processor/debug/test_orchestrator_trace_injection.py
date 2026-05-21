"""Tests for TraceCollector injection into RequestOrchestrator.

Verifies that:
1. Orchestrator accepts a trace_collector parameter
2. Defaults to NoOpTraceCollector when None is passed
3. Stores the collector as self.trace_collector
"""

from unittest.mock import MagicMock, patch

import pytest

from bunking.sync.bunk_request_processor.debug.trace_collector import (
    NoOpTraceCollector,
    TraceCollector,
)


@pytest.fixture
def mock_data_context():
    """Create a mock DataAccessContext for orchestrator init."""
    ctx = MagicMock()
    ctx.pb_client = MagicMock()
    ctx._year = 2025
    return ctx


@pytest.fixture
def mock_config_loader(mock_config):
    """Ensure ConfigLoader is mocked for orchestrator init."""
    return mock_config


class TestOrchestratorTraceInjection:
    """Test that RequestOrchestrator properly handles trace_collector parameter."""

    def test_accepts_trace_collector(self, mock_data_context, mock_config_loader):
        """Orchestrator should accept and store a provided TraceCollector."""
        from bunking.sync.bunk_request_processor.orchestrator import RequestOrchestrator

        collector = TraceCollector(run_id="test-run-123")

        with patch.object(RequestOrchestrator, "_initialize_components"):
            orch = RequestOrchestrator(
                year=2025,
                session_cm_ids=[1000001],
                data_context=mock_data_context,
                trace_collector=collector,
            )

        assert orch.trace_collector is collector
        assert orch.trace_collector.enabled is True
        assert orch.trace_collector.run_id == "test-run-123"

    def test_defaults_to_noop_when_none(self, mock_data_context, mock_config_loader):
        """Orchestrator should default to NoOpTraceCollector when trace_collector is None."""
        from bunking.sync.bunk_request_processor.orchestrator import RequestOrchestrator

        with patch.object(RequestOrchestrator, "_initialize_components"):
            orch = RequestOrchestrator(
                year=2025,
                session_cm_ids=[1000001],
                data_context=mock_data_context,
                trace_collector=None,
            )

        assert isinstance(orch.trace_collector, NoOpTraceCollector)
        assert orch.trace_collector.enabled is False

    def test_defaults_to_noop_when_not_provided(self, mock_data_context, mock_config_loader):
        """Orchestrator should default to NoOpTraceCollector when param not passed."""
        from bunking.sync.bunk_request_processor.orchestrator import RequestOrchestrator

        with patch.object(RequestOrchestrator, "_initialize_components"):
            orch = RequestOrchestrator(
                year=2025,
                session_cm_ids=[1000001],
                data_context=mock_data_context,
            )

        assert isinstance(orch.trace_collector, NoOpTraceCollector)
        assert orch.trace_collector.enabled is False
