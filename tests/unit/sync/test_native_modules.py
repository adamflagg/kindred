#!/usr/bin/env python3
"""
Test native V2 modules to ensure they work correctly without adapters
"""

from unittest.mock import Mock

import pytest

from bunking.sync.bunk_request_processor.confidence.confidence_scorer import (
    ConfidenceScorer,
)
from bunking.sync.bunk_request_processor.conflict.conflict_detector import (
    ConflictDetector,
)
from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestSource,
    RequestType,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.social.social_graph import (
    SocialGraph,
)


class TestNativeV2Modules:
    """Test suite for native V2 implementations"""

    @pytest.fixture
    def sample_parsed_request(self):
        """Create a sample parsed request"""
        return ParsedRequest(
            raw_text="John Doe",
            request_type=RequestType.BUNK_WITH,
            target_name="John Doe",
            age_preference=None,
            source=RequestSource.FAMILY,
            confidence=0.85,
            csv_position=1,
            source_field="share_bunk_with",
            metadata={"ai_parsed": True},
        )

    @pytest.fixture
    def sample_resolution_info(self):
        """Create sample resolution info"""
        return {
            "requester_cm_id": 10001,
            "requester_name": "Jane Smith",
            "person_cm_id": 10002,
            "person_name": "John Doe",
            "session_cm_id": 1234567,
            "confidence": 0.8,
            "resolution_method": "fuzzy_match",
        }

    @pytest.mark.skip(
        reason="ConflictDetector was simplified - only detects session mismatches, not these config options"
    )
    def test_conflict_detector_initialization(self):
        """Test ConflictDetector can be initialized"""
        config = {"max_requests_per_person": 3, "reciprocal_weight": 1.5, "age_preference_strict": False}

        detector = ConflictDetector(config)

        assert detector.max_requests_per_person == 3  # type: ignore[attr-defined]
        assert detector.reciprocal_weight == 1.5  # type: ignore[attr-defined]
        assert detector.age_preference_strict is False  # type: ignore[attr-defined]

    def test_confidence_scorer_bunk_with(self):
        """Test ConfidenceScorer for bunk_with requests"""
        mock_attendee_repo = Mock()
        mock_attendee_repo.get_by_person_and_year.return_value = Mock(person_cm_id=10002, year=2025)

        scorer = ConfidenceScorer(config={"confidence_scoring": {}}, attendee_repo=mock_attendee_repo)

        # Create test request and resolution
        parsed_req = ParsedRequest(
            raw_text="John Doe",
            request_type=RequestType.BUNK_WITH,
            target_name="John Doe",
            age_preference=None,
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=1,
            source_field="share_bunk_with",
            metadata={"ai_parsed": True},
        )

        resolution = ResolutionResult(
            person=Mock(cm_id=10002, full_name="John Doe"), confidence=0.85, method="exact_match"
        )

        # Score the resolution
        score = scorer.score_resolution(
            parsed_request=parsed_req, resolution_result=resolution, requester_cm_id=10001, year=2025
        )

        # Should get good score for exact match with found attendee
        assert score > 0.7
        assert score <= 1.0

    def test_confidence_scorer_age_preference(self):
        """Test ConfidenceScorer for age preference requests"""
        scorer = ConfidenceScorer()

        # Create age preference request
        from bunking.sync.bunk_request_processor.core.models import AgePreference

        parsed_req = ParsedRequest(
            raw_text="Kids their own grade and one grade above",
            request_type=RequestType.AGE_PREFERENCE,
            target_name=None,
            age_preference=AgePreference.OLDER,
            source=RequestSource.FAMILY,
            confidence=1.0,
            csv_position=1,
            source_field="ret_parent_socialize_with_best",
            metadata={"ai_parsed": False, "pre_parsed": True},
        )

        # Score should equal AI confidence for age preferences
        score = scorer.score_parsed_request(parsed_req)
        assert score == 1.0

    @pytest.mark.asyncio
    async def test_social_graph_initialization(self):
        """Test SocialGraph initialization"""
        mock_pb = Mock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        session_cm_id = 1234567
        graph = SocialGraph(mock_pb, year=2025, session_cm_ids=[session_cm_id])

        assert not graph._initialized
        assert graph.year == 2025
        assert graph.session_cm_ids == [session_cm_id]

        # Initialize the graph
        await graph.initialize()

        assert graph._initialized
        # Session-specific graph (not single graph attribute)
        assert session_cm_id in graph.graphs
        assert graph.graphs[session_cm_id] is not None

        # Check metrics were calculated (returns dict keyed by session_cm_id)
        all_metrics = graph.get_graph_metrics()
        assert session_cm_id in all_metrics
        metrics = all_metrics[session_cm_id]
        assert "node_count" in metrics
        assert "edge_count" in metrics
        assert "density" in metrics

    @pytest.mark.asyncio
    async def test_social_graph_signals(self):
        """Test SocialGraph social signal calculation"""
        mock_pb = Mock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        session_cm_id = 1234567
        graph = SocialGraph(mock_pb, year=2025, session_cm_ids=[session_cm_id])
        await graph.initialize()

        # Manually add some test data to the session-specific graph
        session_graph = graph.graphs[session_cm_id]
        session_graph.add_edge(10001, 10002, weight=1.0)  # Direct connection
        session_graph.add_edge(10002, 10003, weight=1.0)  # B-C connection
        session_graph.add_edge(10001, 10004, weight=0.5)  # A-D weak connection

        # Test direct connection (now requires session_cm_id)
        signals = graph.get_social_signals(10001, 10002, session_cm_id)
        assert signals["in_ego_network"] is True
        assert signals["social_distance"] == 1
        assert signals["relationship_strength"] == 1.0

        # Test 2-hop connection
        signals = graph.get_social_signals(10001, 10003, session_cm_id)
        assert signals["social_distance"] == 2
        assert signals["mutual_connections"] == 1  # Both know 10002

        # Test no connection
        signals = graph.get_social_signals(10001, 99999, session_cm_id)
        assert signals["social_distance"] == 999
        assert signals["in_ego_network"] is False

    @pytest.mark.asyncio
    async def test_social_graph_enhance_resolution(self):
        """Test SocialGraph resolution enhancement"""
        mock_pb = Mock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        session_cm_id = 1234567
        graph = SocialGraph(mock_pb, year=2025, session_cm_ids=[session_cm_id])
        await graph.initialize()

        # Add test graph data to session-specific graph
        session_graph = graph.graphs[session_cm_id]
        session_graph.add_edge(10001, 10002, weight=2.0)  # Strong connection
        session_graph.add_edge(10001, 10003, weight=0.5)  # Weak connection

        # Create mock candidates with required attributes including session_cm_id
        def make_candidate(cm_id, first_name, last_name, session_id):
            candidate = Mock()
            candidate.cm_id = cm_id
            candidate.first_name = first_name
            candidate.last_name = last_name
            candidate.preferred_name = None
            candidate.birth_date = None
            candidate.grade = None
            candidate.school = None
            candidate.session_cm_id = session_id
            return candidate

        # Create ambiguous resolution with candidates (all in same session)
        resolution = ResolutionResult(
            person=None,
            candidates=[
                make_candidate(10003, "John", "C", session_cm_id),  # Weak connection
                make_candidate(10002, "John", "B", session_cm_id),  # Strong connection
                make_candidate(10004, "John", "D", session_cm_id),  # No connection
            ],
        )

        # Enhance the resolution
        enhanced = await graph.enhance_resolution(
            resolution=resolution, requester_cm_id=10001, session_cm_id=session_cm_id
        )

        # Should reorder by social signals (distance ascending, then by connection strength)
        assert enhanced.candidates is not None
        assert enhanced.candidates[0].cm_id == 10002  # Strongest connection first (distance=1)
        assert enhanced.candidates[1].cm_id == 10003  # Weak connection second (distance=1)
        # 10004 has no connection so it gets filtered or sorted last
        assert enhanced.metadata is not None
        assert enhanced.metadata["social_graph_enhanced"] is True


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
