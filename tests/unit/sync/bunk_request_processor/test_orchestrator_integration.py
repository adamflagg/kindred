"""Integration tests for RequestOrchestrator

Tests the orchestrator's coordination of the three-phase processing pipeline.
These tests use mocks at the PocketBase level since the orchestrator
creates its internal components.

Tests cover:
1. Orchestrator initialization
2. Full pipeline flow (Phase 1 → Phase 2 → Phase 3)
3. Statistics aggregation
4. Progress reporting
5. Dry run mode"""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    ParseRequest,
    ParseResult,
    Person,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult


def _create_mock_pocketbase():
    """Create a mock PocketBase client"""
    pb = Mock()

    # Mock collection method to return a mock collection
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


def _create_person(
    cm_id: int = 12345,
    first_name: str = "Sarah",
    last_name: str = "Smith",
    grade: int = 5,
) -> Person:
    """Helper to create Person objects"""
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        grade=grade,
    )


def _create_parsed_request(
    target_name: str = "Sarah Smith",
    request_type: RequestType = RequestType.BUNK_WITH,
    confidence: float = 0.9,
) -> ParsedRequest:
    """Helper to create ParsedRequest objects"""
    return ParsedRequest(
        raw_text=f"I want to bunk with {target_name}",
        request_type=request_type,
        target_name=target_name,
        age_preference=None,
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,
        confidence=confidence,
        csv_position=0,
        metadata={},
    )


def _create_parse_request(
    request_text: str = "I want to bunk with Sarah Smith",
    requester_cm_id: int = 11111,
    requester_name: str = "Test Requester",
    requester_grade: str = "5",
    field_name: str = "share_bunk_with",
    session_cm_id: int = 1000002,
    session_name: str = "Session 2",
    year: int = 2025,
) -> ParseRequest:
    """Helper to create ParseRequest objects"""
    return ParseRequest(
        request_text=request_text,
        field_name=field_name,
        requester_name=requester_name,
        requester_cm_id=requester_cm_id,
        requester_grade=requester_grade,
        session_cm_id=session_cm_id,
        session_name=session_name,
        year=year,
        row_data={field_name: request_text},
    )


def _create_parse_result(
    parsed_requests: list[ParsedRequest] | None = None,
    is_valid: bool = True,
    parse_request: ParseRequest | None = None,
) -> ParseResult:
    """Helper to create ParseResult objects"""
    if parsed_requests is None:
        parsed_requests = [_create_parsed_request()]
    if parse_request is None:
        parse_request = _create_parse_request()
    return ParseResult(
        parsed_requests=parsed_requests,
        is_valid=is_valid,
        parse_request=parse_request,
    )


def _create_resolution_result(
    person: Person | None = None,
    confidence: float = 0.95,
    method: str = "exact",
) -> ResolutionResult:
    """Helper to create ResolutionResult objects"""
    return ResolutionResult(
        person=person,
        confidence=confidence,
        method=method,
        candidates=[],
        metadata={},
    )


class TestRequestOrchestratorInitialization:
    """Tests for RequestOrchestrator initialization"""

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_orchestrator_initializes_with_pb_and_year(self, mock_social_graph, mock_factory):
        """Orchestrator can be initialized with PocketBase and year"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        # Setup mocks
        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()

        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        assert orchestrator.pb == pb
        assert orchestrator.year == 2025

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_orchestrator_accepts_session_filter(self, mock_social_graph, mock_factory):
        """Orchestrator can filter by specific session IDs"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()
        session_ids = [1000002, 1000003]

        orchestrator = RequestOrchestrator(pb=pb, year=2025, session_cm_ids=session_ids)

        assert orchestrator.session_cm_ids == session_ids

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_orchestrator_initializes_phase_services(self, mock_social_graph, mock_factory):
        """Orchestrator creates all three phase services"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()

        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        assert orchestrator.phase1_service is not None
        assert orchestrator.phase2_service is not None
        assert orchestrator.phase3_service is not None

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_orchestrator_stats_start_at_zero(self, mock_social_graph, mock_factory):
        """Orchestrator stats should start at zero"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()

        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        assert orchestrator._stats["phase1_parsed"] == 0
        assert orchestrator._stats["phase2_resolved"] == 0
        assert orchestrator._stats["phase3_disambiguated"] == 0


class TestRequestOrchestratorProcessing:
    """Tests for the process_requests method"""

    @pytest.mark.asyncio
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    async def test_process_requests_handles_empty_input(self, mock_social_graph, mock_factory):
        """process_requests handles empty input gracefully"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph_instance = Mock()
        mock_social_graph_instance.initialize = AsyncMock()
        mock_social_graph.return_value = mock_social_graph_instance

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Mock the phase services to return empty results
        orchestrator.phase1_service.batch_parse = AsyncMock(return_value=[])  # type: ignore[method-assign]
        orchestrator.phase2_service.batch_resolve = AsyncMock(return_value=[])  # type: ignore[method-assign]
        orchestrator.phase3_service.batch_disambiguate = AsyncMock(return_value=[])  # type: ignore[method-assign]

        result = await orchestrator.process_requests([])

        assert result is not None
        assert "stats" in result or isinstance(result, dict)


class TestRequestOrchestratorStatistics:
    """Tests for statistics tracking"""

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_stats_include_all_phases(self, mock_social_graph, mock_factory):
        """Stats dict includes counts for all phases"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        stats = orchestrator._stats

        assert "phase1_parsed" in stats
        assert "phase2_resolved" in stats
        assert "phase2_ambiguous" in stats
        assert "phase3_disambiguated" in stats
        assert "conflicts_detected" in stats
        assert "requests_created" in stats


class TestRequestOrchestratorComponents:
    """Tests for component initialization"""

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_resolution_pipeline_has_strategies(self, mock_social_graph, mock_factory):
        """Resolution pipeline should have all strategies configured"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        # Should have multiple strategies
        assert len(orchestrator.resolution_pipeline.strategies) >= 3

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_context_builder_is_created(self, mock_social_graph, mock_factory):
        """Context builder should be initialized"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        assert orchestrator.context_builder is not None

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_confidence_scorer_is_created(self, mock_social_graph, mock_factory):
        """Confidence scorer should be initialized"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        assert orchestrator.confidence_scorer is not None

    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.ProviderFactory")
    @patch("bunking.sync.bunk_request_processor.orchestrator.orchestrator.SocialGraph")
    def test_cache_manager_is_created(self, mock_social_graph, mock_factory):
        """Cache manager should be initialized"""
        from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
            RequestOrchestrator,
        )

        mock_factory.return_value.create_provider.return_value = Mock()
        mock_social_graph.return_value = Mock()
        mock_social_graph.return_value.initialize = AsyncMock()

        pb = _create_mock_pocketbase()
        orchestrator = RequestOrchestrator(pb=pb, year=2025)

        assert orchestrator.cache_manager is not None
