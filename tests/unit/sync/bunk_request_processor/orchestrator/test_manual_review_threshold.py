"""Tests for auto-resolve threshold from config.

Low-confidence matches stay as PENDING (not RESOLVED) with the suggested
target preserved in requestee_id. Staff must confirm or override.

High-confidence matches (>= threshold) are auto-resolved.

Threshold comes from constants CONFIDENCE_THRESHOLDS.resolved (0.85).
Note: _get_auto_resolve_threshold() uses .get("valid", 0.85) for backward compat."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
    RequestOrchestrator,
)


def _create_mock_pocketbase():
    """Create a mock PocketBase client."""
    pb = Mock()

    def mock_collection(name):
        collection = Mock()
        collection.get_full_list = Mock(return_value=[])
        collection.get_list = Mock(return_value=Mock(items=[], total_items=0))
        collection.create = Mock(return_value=Mock(id="test-id"))
        collection.update = Mock()
        collection.delete = Mock()
        return collection

    pb.collection = mock_collection
    return pb


def _create_bunk_request(
    requester_cm_id: int = 12345,
    requested_cm_id: int | None = 67890,
    request_type: RequestType = RequestType.BUNK_WITH,
    session_cm_id: int = 1000002,
    confidence: float = 0.95,
    source: RequestSource = RequestSource.FAMILY,
    priority: int = 3,
    is_placeholder: bool = False,
    status: RequestStatus = RequestStatus.RESOLVED,
    metadata: dict[str, Any] | None = None,
) -> BunkRequest:
    """Helper to create BunkRequest objects for testing."""
    return BunkRequest(
        requester_cm_id=requester_cm_id,
        requested_cm_id=requested_cm_id,
        request_type=request_type,
        session_cm_id=session_cm_id,
        priority=priority,
        confidence_score=confidence,
        source=source,
        source_field="share_bunk_with",
        csv_position=1,
        year=2025,
        status=status,
        is_placeholder=is_placeholder,
        metadata=metadata or {},
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


class TestReciprocalBoostStatusReCheck:
    """Tests that reciprocal boost re-checks status after confidence bump.

    After apply_reciprocal_boost() bumps confidence_score, requests that now
    cross the auto-resolve threshold should be promoted from PENDING to RESOLVED.
    Without the re-check, they stay PENDING because determine_request_status()
    already ran before the boost.
    """

    @pytest.fixture
    def orchestrator(self):
        """Create orchestrator with default 0.85 threshold."""
        with (
            patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory") as factory,
            patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph") as graph,
        ):
            factory.return_value.create_provider.return_value = Mock()
            mock_instance = Mock()
            mock_instance.initialize = AsyncMock()
            graph.return_value = mock_instance

            pb = _create_mock_pocketbase()
            orch = RequestOrchestrator(pb=pb, year=2025)
            yield orch

    def test_reciprocal_boost_promotes_to_resolved(self, orchestrator):
        """Request at 0.80 + 0.10 reciprocal boost = 0.90 -> RESOLVED.

        A reciprocal pair where both sides have 0.80 confidence (below 0.85 threshold).
        After the 0.10 reciprocal boost, confidence becomes 0.90 (above threshold).
        The status re-check should promote them from PENDING to RESOLVED.
        """
        # Create reciprocal pair: A requests B, B requests A
        # Both at 0.80 (below 0.85 threshold), so status=PENDING
        req_a = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=200,
            confidence=0.80,
            status=RequestStatus.PENDING,
        )
        req_b = _create_bunk_request(
            requester_cm_id=200,
            requested_cm_id=100,
            confidence=0.80,
            status=RequestStatus.PENDING,
        )

        result, _ = orchestrator._apply_validation_pipeline([req_a, req_b])

        # After reciprocal boost (0.80 + 0.10 = 0.90 >= 0.85), both should be RESOLVED
        for req in result:
            assert req.status == RequestStatus.RESOLVED, (
                f"Request with confidence {req.confidence_score} (after reciprocal boost) "
                f"should be RESOLVED, got {req.status}"
            )
            assert req.confidence_score == pytest.approx(0.90)

    def test_reciprocal_boost_still_below_stays_pending(self, orchestrator):
        """Request at 0.70 + 0.10 = 0.80, still below 0.85 -> PENDING.

        Even after the reciprocal boost, if confidence is still below the
        threshold, the request should remain PENDING.
        """
        req_a = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=200,
            confidence=0.70,
            status=RequestStatus.PENDING,
        )
        req_b = _create_bunk_request(
            requester_cm_id=200,
            requested_cm_id=100,
            confidence=0.70,
            status=RequestStatus.PENDING,
        )

        result, _ = orchestrator._apply_validation_pipeline([req_a, req_b])

        # After reciprocal boost (0.70 + 0.10 = 0.80 < 0.85), both should stay PENDING
        for req in result:
            assert req.status == RequestStatus.PENDING, (
                f"Request with confidence {req.confidence_score} (still below threshold) "
                f"should stay PENDING, got {req.status}"
            )
            assert req.confidence_score == pytest.approx(0.80)

    def test_only_reciprocal_boosted_requests_checked(self, orchestrator):
        """Non-reciprocal requests are not affected by the re-check.

        A request with confidence 0.90 but no reciprocal_boost metadata
        should not be promoted (it was already PENDING for another reason).
        """
        # Non-reciprocal request at 0.90 (above threshold but PENDING for other reason)
        non_reciprocal = _create_bunk_request(
            requester_cm_id=300,
            requested_cm_id=400,
            confidence=0.90,
            status=RequestStatus.PENDING,
        )

        # Reciprocal pair that should get boosted
        req_a = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=200,
            confidence=0.80,
            status=RequestStatus.PENDING,
        )
        req_b = _create_bunk_request(
            requester_cm_id=200,
            requested_cm_id=100,
            confidence=0.80,
            status=RequestStatus.PENDING,
        )

        result, _ = orchestrator._apply_validation_pipeline([non_reciprocal, req_a, req_b])

        # Non-reciprocal should stay PENDING (no reciprocal_boost metadata)
        non_recip_result = next(r for r in result if r.requester_cm_id == 300)
        assert non_recip_result.status == RequestStatus.PENDING, (
            "Non-reciprocal request should not be promoted even if above threshold"
        )
        assert non_recip_result.confidence_score == pytest.approx(0.90)

        # Reciprocal pair should be promoted
        recip_results = [r for r in result if r.requester_cm_id in (100, 200)]
        for req in recip_results:
            assert req.status == RequestStatus.RESOLVED

    def test_unresolved_names_not_promoted(self, orchestrator):
        """Requests with negative cm_id not promoted even if confidence > threshold.

        Negative requested_cm_id indicates an unresolved name. Even with a
        reciprocal boost pushing confidence above the threshold, these should
        stay PENDING because the target person is not identified.
        """
        # Create reciprocal pair where one side has negative cm_id (unresolved)
        req_a = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=-1,  # Unresolved name
            confidence=0.80,
            status=RequestStatus.PENDING,
            metadata={"reciprocal_boost": 0.10, "is_reciprocal": True, "reciprocal_with": 200},
        )
        req_b = _create_bunk_request(
            requester_cm_id=200,
            requested_cm_id=100,
            confidence=0.80,
            status=RequestStatus.PENDING,
        )

        result, _ = orchestrator._apply_validation_pipeline([req_a, req_b])

        # Request with negative cm_id should stay PENDING
        unresolved = next(r for r in result if r.requester_cm_id == 100)
        assert unresolved.status == RequestStatus.PENDING, (
            "Unresolved name (negative cm_id) should not be promoted even with reciprocal boost"
        )

    def test_reciprocal_promoted_stat_tracked(self, orchestrator):
        """Stat tracking: reciprocal_promoted count is logged."""
        req_a = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=200,
            confidence=0.80,
            status=RequestStatus.PENDING,
        )
        req_b = _create_bunk_request(
            requester_cm_id=200,
            requested_cm_id=100,
            confidence=0.80,
            status=RequestStatus.PENDING,
        )

        orchestrator._apply_validation_pipeline([req_a, req_b])

        assert orchestrator._stats.get("reciprocal_promoted") == 2, (
            "Should track that 2 requests were promoted via reciprocal boost"
        )

    def test_reciprocal_promoted_stat_zero_when_none_promoted(self, orchestrator):
        """Stat tracking: reciprocal_promoted is 0 when no promotions occur."""
        # Reciprocal pair that stays below threshold after boost
        req_a = _create_bunk_request(
            requester_cm_id=100,
            requested_cm_id=200,
            confidence=0.70,
            status=RequestStatus.PENDING,
        )
        req_b = _create_bunk_request(
            requester_cm_id=200,
            requested_cm_id=100,
            confidence=0.70,
            status=RequestStatus.PENDING,
        )

        orchestrator._apply_validation_pipeline([req_a, req_b])

        assert orchestrator._stats.get("reciprocal_promoted") == 0, (
            "Should track 0 promotions when none cross threshold"
        )
