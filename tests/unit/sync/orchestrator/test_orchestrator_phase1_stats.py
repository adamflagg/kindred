"""Tests for orchestrator Phase1 failure stats propagation.

Verifies that phase1_failed and phase1_first_error keys are present in
orchestrator _stats, initialized correctly, and joined from phase1 service
stats after batch_parse.
"""

from unittest.mock import MagicMock, patch


class TestOrchestratorPhase1FailureStats:
    """Test that orchestrator propagates Phase1 failure stats."""

    def _make_orchestrator(self):
        """Create a RequestOrchestrator with mocked internals."""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_pb = MagicMock()
        with patch.object(RequestOrchestrator, "_initialize_components"):
            import warnings

            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                orchestrator = RequestOrchestrator(
                    pb=mock_pb,
                    year=2025,
                )
        return orchestrator

    def test_phase1_failed_initialized_in_stats(self):
        """phase1_failed should exist in _stats with initial value 0."""
        orchestrator = self._make_orchestrator()
        assert "phase1_failed" in orchestrator._stats
        assert orchestrator._stats["phase1_failed"] == 0

    def test_phase1_first_error_initialized(self):
        """_phase1_first_error should be initialized to None."""
        orchestrator = self._make_orchestrator()
        assert orchestrator._phase1_first_error is None
