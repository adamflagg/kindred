"""Tests for extended observability stats in RequestOrchestrator.

TDD Red Phase: These tests define the expected behavior for
status/type/declined breakdown tracking that matches monolith observability.
"""

from __future__ import annotations

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
from pocketbase import PocketBase


class TestExtendedStatsInitialization:
    """Tests that extended stats fields are initialized correctly."""

    @pytest.fixture
    def mock_pb(self):
        """Create mock PocketBase client."""
        return Mock(spec=PocketBase)

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

    def test_stats_include_status_breakdown_fields(self, mock_pb, mock_factory, mock_social_graph):
        """Stats dict includes status breakdown counters."""
        orchestrator = RequestOrchestrator(mock_pb, year=2025)

        assert "status_resolved" in orchestrator._stats
        assert "status_pending" in orchestrator._stats
        assert "status_declined" in orchestrator._stats

        # All should start at 0
        assert orchestrator._stats["status_resolved"] == 0
        assert orchestrator._stats["status_pending"] == 0
        assert orchestrator._stats["status_declined"] == 0

    def test_stats_include_type_breakdown_fields(self, mock_pb, mock_factory, mock_social_graph):
        """Stats dict includes request type breakdown counters."""
        orchestrator = RequestOrchestrator(mock_pb, year=2025)

        assert "type_bunk_with" in orchestrator._stats
        assert "type_not_bunk_with" in orchestrator._stats
        assert "type_age_preference" in orchestrator._stats

        # All should start at 0
        assert orchestrator._stats["type_bunk_with"] == 0
        assert orchestrator._stats["type_not_bunk_with"] == 0
        assert orchestrator._stats["type_age_preference"] == 0

    def test_stats_include_declined_reason_fields(self, mock_pb, mock_factory, mock_social_graph):
        """Stats dict includes declined reason breakdown counters."""
        orchestrator = RequestOrchestrator(mock_pb, year=2025)

        assert "declined_cross_session" in orchestrator._stats
        assert "declined_not_attending" in orchestrator._stats
        assert "declined_other" in orchestrator._stats

        # All should start at 0
        assert orchestrator._stats["declined_cross_session"] == 0
        assert orchestrator._stats["declined_not_attending"] == 0
        assert orchestrator._stats["declined_other"] == 0

    def test_stats_include_ai_quality_fields(self, mock_pb, mock_factory, mock_social_graph):
        """Stats dict includes AI quality tracking counters."""
        orchestrator = RequestOrchestrator(mock_pb, year=2025)

        assert "ai_high_confidence" in orchestrator._stats
        assert "ai_manual_review" in orchestrator._stats

        # All should start at 0
        assert orchestrator._stats["ai_high_confidence"] == 0
        assert orchestrator._stats["ai_manual_review"] == 0


class TestStatusBreakdownTracking:
    """Tests that status breakdown is tracked during request creation."""

    @pytest.fixture
    def mock_pb(self):
        """Create mock PocketBase client."""
        return Mock(spec=PocketBase)

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

    @pytest.fixture
    def orchestrator(self, mock_pb, mock_factory, mock_social_graph):
        """Create orchestrator with mocked dependencies."""
        orch = RequestOrchestrator(mock_pb, year=2025)
        # Mock request_repository.create to return True
        orch.request_repository = Mock()
        orch.request_repository.create = Mock(return_value=True)
        return orch

    def test_tracks_resolved_status_count(self, orchestrator):
        """Counts requests saved with RESOLVED status."""
        # Create requests with RESOLVED status
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=201,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.85,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=2,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
        ]

        # Simulate saving (normally happens in _create_bunk_requests)
        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["status_resolved"] == 2

    def test_tracks_pending_status_count(self, orchestrator):
        """Counts requests saved with PENDING status."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=-123456,  # Unresolved
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.6,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.PENDING,
                is_placeholder=True,
                metadata={},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["status_pending"] == 1

    def test_tracks_declined_status_count(self, orchestrator):
        """Counts requests saved with DECLINED status."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.DECLINED,
                is_placeholder=False,
                metadata={"declined_reason": "Session mismatch"},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["status_declined"] == 1


class TestTypeBreakdownTracking:
    """Tests that request type breakdown is tracked during request creation."""

    @pytest.fixture
    def mock_pb(self):
        return Mock(spec=PocketBase)

    @pytest.fixture
    def mock_factory(self):
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory") as factory:
            factory.return_value.create_provider.return_value = Mock()
            yield factory

    @pytest.fixture
    def mock_social_graph(self):
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph") as graph:
            mock_instance = Mock()
            mock_instance.initialize = AsyncMock()
            graph.return_value = mock_instance
            yield graph

    @pytest.fixture
    def orchestrator(self, mock_pb, mock_factory, mock_social_graph):
        orch = RequestOrchestrator(mock_pb, year=2025)
        orch.request_repository = Mock()
        orch.request_repository.create = Mock(return_value=True)
        return orch

    def test_tracks_bunk_with_type_count(self, orchestrator):
        """Counts BUNK_WITH request types."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
            BunkRequest(
                requester_cm_id=101,
                requested_cm_id=201,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=2,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["type_bunk_with"] == 2

    def test_tracks_not_bunk_with_type_count(self, orchestrator):
        """Counts NOT_BUNK_WITH request types."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.NOT_BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="do_not_share_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["type_not_bunk_with"] == 1

    def test_tracks_age_preference_type_count(self, orchestrator):
        """Counts AGE_PREFERENCE request types."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=None,
                request_type=RequestType.AGE_PREFERENCE,
                session_cm_id=1,
                priority=2,
                confidence_score=1.0,
                source=RequestSource.FAMILY,
                source_field="socialize_preference",
                csv_position=1,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["type_age_preference"] == 1

    def test_tracks_mixed_types(self, orchestrator):
        """Counts different request types correctly."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=201,
                request_type=RequestType.NOT_BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="do_not_share_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=None,
                request_type=RequestType.AGE_PREFERENCE,
                session_cm_id=1,
                priority=2,
                confidence_score=1.0,
                source=RequestSource.FAMILY,
                source_field="socialize_preference",
                csv_position=1,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["type_bunk_with"] == 1
        assert orchestrator._stats["type_not_bunk_with"] == 1
        assert orchestrator._stats["type_age_preference"] == 1


class TestDeclinedReasonTracking:
    """Tests that declined reason breakdown is tracked."""

    @pytest.fixture
    def mock_pb(self):
        return Mock(spec=PocketBase)

    @pytest.fixture
    def mock_factory(self):
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory") as factory:
            factory.return_value.create_provider.return_value = Mock()
            yield factory

    @pytest.fixture
    def mock_social_graph(self):
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph") as graph:
            mock_instance = Mock()
            mock_instance.initialize = AsyncMock()
            graph.return_value = mock_instance
            yield graph

    @pytest.fixture
    def orchestrator(self, mock_pb, mock_factory, mock_social_graph):
        orch = RequestOrchestrator(mock_pb, year=2025)
        orch.request_repository = Mock()
        orch.request_repository.create = Mock(return_value=True)
        return orch

    def test_tracks_cross_session_declined(self, orchestrator):
        """Counts requests declined due to cross-session mismatch."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.DECLINED,
                is_placeholder=False,
                metadata={"declined_reason": "Session mismatch conflict"},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["declined_cross_session"] == 1

    def test_tracks_not_attending_declined(self, orchestrator):
        """Counts requests declined because target not attending."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.DECLINED,
                is_placeholder=False,
                metadata={"declined_reason": "Target not attending this session"},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["declined_not_attending"] == 1

    def test_tracks_other_declined(self, orchestrator):
        """Counts requests declined for other reasons."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.9,
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.DECLINED,
                is_placeholder=False,
                metadata={"declined_reason": "Some other reason"},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["declined_other"] == 1


class TestAIQualityTracking:
    """Tests that AI quality metrics are tracked."""

    @pytest.fixture
    def mock_pb(self):
        return Mock(spec=PocketBase)

    @pytest.fixture
    def mock_factory(self):
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory") as factory:
            factory.return_value.create_provider.return_value = Mock()
            yield factory

    @pytest.fixture
    def mock_social_graph(self):
        with patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph") as graph:
            mock_instance = Mock()
            mock_instance.initialize = AsyncMock()
            graph.return_value = mock_instance
            yield graph

    @pytest.fixture
    def orchestrator(self, mock_pb, mock_factory, mock_social_graph):
        orch = RequestOrchestrator(mock_pb, year=2025)
        orch.request_repository = Mock()
        orch.request_repository.create = Mock(return_value=True)
        return orch

    def test_tracks_high_confidence_requests(self, orchestrator):
        """Counts requests with high confidence (>=0.90)."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.95,  # High confidence
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
            BunkRequest(
                requester_cm_id=101,
                requested_cm_id=201,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.90,  # Exactly at threshold
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=2,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["ai_high_confidence"] == 2

    def test_tracks_manual_review_requests(self, orchestrator):
        """Counts requests with low confidence (<0.85) that need manual review."""
        requests = [
            BunkRequest(
                requester_cm_id=100,
                requested_cm_id=200,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1,
                priority=2,
                confidence_score=0.70,  # Needs review
                source=RequestSource.FAMILY,
                source_field="bunk_with",
                csv_position=1,
                year=2025,
                status=RequestStatus.PENDING,  # PENDING status means needs review
                is_placeholder=False,
                metadata={},
            ),
        ]

        for req in requests:
            orchestrator._track_request_stats(req)

        assert orchestrator._stats["ai_manual_review"] == 1
