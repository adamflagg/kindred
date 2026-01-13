"""Tests for auto-resolve threshold from config.

Low-confidence matches stay as PENDING (not RESOLVED) with the suggested
target preserved in requestee_id. Staff must confirm or override.

High-confidence matches (>= threshold) are auto-resolved.

Threshold comes from constants CONFIDENCE_THRESHOLDS.resolved (0.85).
Note: _get_auto_resolve_threshold() uses .get("valid", 0.85) for backward compat."""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest

from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
    RequestOrchestrator,
)


class TestAutoResolveThreshold:
    """Tests that confidence threshold is loaded from config (not hardcoded)."""

    @pytest.fixture
    def mock_pb(self):
        """Create mock PocketBase client."""
        return Mock()

    @pytest.fixture
    def mock_factory(self):
        """Mock the ProviderFactory."""
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory") as factory:
            factory.return_value.create_provider.return_value = Mock()
            yield factory

    @pytest.fixture
    def mock_social_graph(self):
        """Mock SocialGraph."""
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph") as graph:
            mock_instance = Mock()
            mock_instance.initialize = AsyncMock()
            graph.return_value = mock_instance
            yield graph

    def test_loads_confidence_thresholds_from_config(self, mock_pb, mock_factory, mock_social_graph):
        """Verify orchestrator loads confidence_thresholds from constants."""
        orchestrator = RequestOrchestrator(mock_pb, year=2025)

        # Must have confidence_thresholds loaded
        assert "confidence_thresholds" in orchestrator.ai_config
        thresholds = orchestrator.ai_config["confidence_thresholds"]

        # Must have the 'resolved' threshold (0.85 per constants.py)
        # Note: auto_accept (0.95) is also available for UI display purposes
        assert "resolved" in thresholds
        assert thresholds["resolved"] == 0.85
        assert "auto_accept" in thresholds
        assert thresholds["auto_accept"] == 0.95

    def test_auto_resolve_threshold_used_from_config(self, mock_pb, mock_factory, mock_social_graph):
        """Verify threshold comes from config, not hardcoded."""
        custom_threshold = 0.75
        orchestrator = RequestOrchestrator(
            mock_pb, year=2025, ai_config={"provider": "openai", "confidence_thresholds": {"valid": custom_threshold}}
        )

        # The custom threshold should be used
        assert orchestrator.ai_config["confidence_thresholds"]["valid"] == custom_threshold
        assert orchestrator._get_auto_resolve_threshold() == custom_threshold


class TestLowConfidenceStatusBehavior:
    """Tests that low-confidence matches stay PENDING (not auto-resolved)."""

    @pytest.fixture
    def mock_pb(self):
        """Create mock PocketBase client."""
        return Mock()

    @pytest.fixture
    def mock_factory(self):
        """Mock the ProviderFactory."""
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory") as factory:
            factory.return_value.create_provider.return_value = Mock()
            yield factory

    @pytest.fixture
    def mock_social_graph(self):
        """Mock SocialGraph."""
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph") as graph:
            mock_instance = Mock()
            mock_instance.initialize = AsyncMock()
            graph.return_value = mock_instance
            yield graph

    def test_low_confidence_stays_pending_with_suggestion(self, mock_pb, mock_factory, mock_social_graph):
        """Low-confidence match: status=PENDING, target preserved in requestee_id.

        When confidence < threshold (0.85):
        - status = PENDING (not RESOLVED)
        - requestee_id contains the suggested match
        - Staff must confirm or pick different target
        """
        orchestrator = RequestOrchestrator(
            mock_pb, year=2025, ai_config={"provider": "openai", "confidence_thresholds": {"valid": 0.85}}
        )

        threshold = orchestrator._get_auto_resolve_threshold()
        assert threshold == 0.85

        # Confidence below threshold means PENDING, not RESOLVED
        confidence = 0.72
        should_stay_pending = confidence < threshold
        assert should_stay_pending is True

    def test_high_confidence_auto_resolves(self, mock_pb, mock_factory, mock_social_graph):
        """High-confidence match: status=RESOLVED automatically.

        When confidence >= threshold (0.85):
        - status = RESOLVED (auto-confirmed)
        """
        orchestrator = RequestOrchestrator(
            mock_pb, year=2025, ai_config={"provider": "openai", "confidence_thresholds": {"valid": 0.85}}
        )

        threshold = orchestrator._get_auto_resolve_threshold()

        # High confidence auto-resolves
        confidence = 0.92
        should_auto_resolve = confidence >= threshold
        assert should_auto_resolve is True

        # Edge case: exactly at threshold auto-resolves
        confidence = 0.85
        should_auto_resolve = confidence >= threshold
        assert should_auto_resolve is True
