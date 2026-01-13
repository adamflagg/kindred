"""Tests for Smart Resolution (Phase 2.5 Auto-Resolution)

These tests define the expected behavior for smart resolution that
can skip AI disambiguation when social signals are strong enough.

Architecture Decision: Option 2 (Hybrid)
- In-batch mutual detection via ReciprocalDetector
- DB query for cross-run mutual requests
- Graph stays pure (informational relationships only)"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from bunking.sync.bunk_request_processor.core.models import (
    Person,
    RequestSource,
    RequestStatus,
    RequestType,
)


# Helper functions for creating test data
def _create_person(
    cm_id: int,
    first_name: str = "Test",
    last_name: str = "Person",
    grade: int = 5,
    session_cm_id: int = 1000002,
) -> Person:
    """Helper to create Person objects for testing."""
    return Person(
        cm_id=cm_id,
        first_name=first_name,
        last_name=last_name,
        grade=grade,
        session_cm_id=session_cm_id,
    )


def _create_config() -> dict[str, Any]:
    """Create default smart resolution config matching ai_config.json."""
    return {
        "enabled": True,
        "significant_connection_threshold": 5,
        "min_connections_for_auto_resolve": 3,
        "min_confidence_for_auto_resolve": 0.85,
        "mutual_request_bonus": 10,
        "common_friends_weight": 1.0,
        "historical_bunking_weight": 0.8,
        "connection_score_weight": 0.7,
    }


class TestCalculateSocialScore:
    """Tests for _calculate_social_score method.

    Scoring formula (matching monolith):
    - mutual_request_bonus: +10 if has mutual request
    - common_friends_weight: +1.0 per common friend
    - historical_bunking_weight: +0.8 if bunked together before
    """

    def test_mutual_request_gives_bonus(self):
        """Mutual request should give significant bonus (+10).

        both A->B and B->A requests exist in the graph.
        """
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        config = _create_config()

        # Setup: requester_cm_id=100 has mutual request with candidate_cm_id=200
        requester_cm_id = 100
        candidate_cm_id = 200
        session_cm_id = 1000002

        score = graph.calculate_social_score(
            requester_cm_id=requester_cm_id,
            candidate_cm_id=candidate_cm_id,
            session_cm_id=session_cm_id,
            config=config,
            has_mutual_request=True,  # Hybrid: provided by caller
        )

        assert score >= config["mutual_request_bonus"]

    def test_common_friends_add_score(self):
        """Each common friend should add +1.0 to score."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        # Create mock graph with 3 common friends between 100 and 200
        import networkx as nx

        G = nx.Graph()
        G.add_edges_from(
            [
                (100, 300),  # Requester knows 300
                (100, 400),  # Requester knows 400
                (100, 500),  # Requester knows 500
                (200, 300),  # Candidate knows 300 (common friend)
                (200, 400),  # Candidate knows 400 (common friend)
                (200, 500),  # Candidate knows 500 (common friend)
            ]
        )
        graph.graphs[1000002] = G

        config = _create_config()

        score = graph.calculate_social_score(
            requester_cm_id=100,
            candidate_cm_id=200,
            session_cm_id=1000002,
            config=config,
            has_mutual_request=False,
        )

        # Should be 3 common friends * 1.0 weight = 3.0
        expected_from_friends = 3 * config["common_friends_weight"]
        assert score >= expected_from_friends

    def test_historical_bunking_adds_score(self):
        """Historical bunking (bunked together in prior year) adds +0.8.

        historical bunking data. Note: monolith implementation is
        currently a stub returning False, but we implement it properly.
        """
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        # Create mock graph with historical bunking edge
        import networkx as nx

        from bunking.sync.bunk_request_processor.social.social_graph import RelationshipType

        G = nx.Graph()
        G.add_edge(100, 200, relationship_types=[RelationshipType.BUNKMATE], weight=2.0, informational_only=True)
        graph.graphs[1000002] = G

        config = _create_config()

        score = graph.calculate_social_score(
            requester_cm_id=100,
            candidate_cm_id=200,
            session_cm_id=1000002,
            config=config,
            has_mutual_request=False,
        )

        # Should include historical bunking weight
        assert score >= config["historical_bunking_weight"]

    def test_no_connection_returns_zero(self):
        """No connections should return score of 0."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        # Create graph with no connections
        import networkx as nx

        G = nx.Graph()
        G.add_node(100)
        G.add_node(200)
        # No edges between them
        graph.graphs[1000002] = G

        config = _create_config()

        score = graph.calculate_social_score(
            requester_cm_id=100,
            candidate_cm_id=200,
            session_cm_id=1000002,
            config=config,
            has_mutual_request=False,
        )

        assert score == 0.0


class TestCalculateConfidenceFromScore:
    """Tests for _calculate_confidence_from_score method.

    Formula: 0.6 + (min(score/20, 1.0) * connection_score_weight * 0.4)
    - Base: 0.6
    - Max additional: 0.4 * 0.7 = 0.28
    - Max total: 0.88
    """

    def test_score_zero_gives_base_confidence(self):
        """Score of 0 should give base confidence of 0.6."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025)
        config = _create_config()

        confidence = graph.calculate_confidence_from_score(score=0, config=config)

        assert confidence == 0.6

    def test_score_10_gives_intermediate_confidence(self):
        """Score of 10 should give confidence of ~0.74."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025)
        config = _create_config()

        confidence = graph.calculate_confidence_from_score(score=10, config=config)

        # 0.6 + (10/20 * 0.7 * 0.4) = 0.6 + (0.5 * 0.28) = 0.6 + 0.14 = 0.74
        assert 0.73 <= confidence <= 0.75

    def test_score_20_plus_gives_max_confidence(self):
        """Score of 20+ should cap at max confidence of 0.88."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025)
        config = _create_config()

        confidence = graph.calculate_confidence_from_score(score=20, config=config)

        # 0.6 + (1.0 * 0.7 * 0.4) = 0.6 + 0.28 = 0.88
        assert 0.87 <= confidence <= 0.89

    def test_higher_score_also_gives_max(self):
        """Score > 20 should still cap at 0.88."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025)
        config = _create_config()

        confidence = graph.calculate_confidence_from_score(score=100, config=config)

        # Should cap at max
        assert 0.87 <= confidence <= 0.89


class TestSmartResolveCandidates:
    """Tests for smart_resolve_candidates method (Phase 2.5 Auto-Resolution).

    Auto-resolves ambiguous names when:
    1. Best candidate has score_diff >= significant_connection_threshold (5)
    2. Best score >= min_connections_for_auto_resolve (3)
    3. Confidence >= min_confidence_for_auto_resolve (0.85)
    """

    def test_clear_winner_auto_resolves(self):
        """When one candidate has significantly higher score, auto-resolve.

        To meet all thresholds with config:
        - significant_connection_threshold: 5 (score_diff >= 5)
        - min_connections_for_auto_resolve: 3 (best_score >= 3)
        - min_confidence_for_auto_resolve: 0.85 (confidence >= 0.85)

        Confidence formula: 0.6 + (score/20 * 0.7 * 0.4)
        For conf=0.85: score >= 17.86, so we need ~18 points.
        Using mutual request (+10) + 8 common friends (+8) = 18 points.
        """
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        # Create mock graph with enough connections for high confidence
        import networkx as nx

        G = nx.Graph()
        # Candidate 200 has many connections to requester 100 (8 common friends)
        # Plus we'll use mutual request for +10 bonus = 18 total points
        common_friend_ids = [300, 400, 500, 600, 700, 800, 900, 1000]  # 8 friends
        for friend_id in common_friend_ids:
            G.add_edge(100, friend_id)  # Requester knows these friends
            G.add_edge(200, friend_id)  # Candidate also knows them
        # Candidate 250 has no connections
        G.add_node(250)
        graph.graphs[1000002] = G

        config = _create_config()

        candidates = [
            _create_person(cm_id=200, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=250, first_name="Sara", last_name="Smyth"),
        ]

        # Use mutual request to reach required confidence threshold
        result = graph.smart_resolve_candidates(
            name="Sarah Smith",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1000002,
            config=config,
            mutual_request_cm_ids={200},  # 200 has mutual request (+10 bonus)
        )

        # Should auto-resolve to candidate 200
        # Score: 10 (mutual) + 8 (friends) = 18 → confidence ~0.85
        assert result is not None
        auto_result, ranked_candidates = result
        assert auto_result is not None
        resolved_cm_id, confidence, method = auto_result
        assert resolved_cm_id == 200
        assert confidence >= 0.85
        assert method == "social_graph_auto"

    def test_no_clear_winner_returns_none(self):
        """When candidates have similar scores, don't auto-resolve.

        when no candidate has clear advantage.
        """
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        # Create mock graph where both candidates have equal connections
        import networkx as nx

        G = nx.Graph()
        G.add_edges_from(
            [
                (100, 300),
                (100, 400),
                (200, 300),
                (200, 400),  # Same common friends as 250
                (250, 300),
                (250, 400),
            ]
        )
        graph.graphs[1000002] = G

        config = _create_config()

        candidates = [
            _create_person(cm_id=200, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=250, first_name="Sara", last_name="Smyth"),
        ]

        result = graph.smart_resolve_candidates(
            name="Sarah Smith",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1000002,
            config=config,
            mutual_request_cm_ids=set(),
        )

        # Should NOT auto-resolve - needs AI disambiguation
        assert result is None or result[0] is None

    def test_mutual_request_provides_clear_winner(self):
        """Mutual request bonus (+10) combined with common friends should auto-resolve.

        bunk_request edges in the graph. Our hybrid approach provides
        this information via mutual_request_cm_ids parameter.

        Note: Mutual request alone gives score 10 → confidence 0.74.
        We need score ~18 for confidence 0.85. So we add 8 common friends
        to reach the threshold.
        """
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        # Create mock graph with some common friends
        import networkx as nx

        G = nx.Graph()
        # Add 8 common friends to combine with mutual request for score ~18
        common_friend_ids = [300, 400, 500, 600, 700, 800, 900, 1000]
        for friend_id in common_friend_ids:
            G.add_edge(100, friend_id)
            G.add_edge(200, friend_id)
        G.add_node(250)  # Other candidate has no connections
        graph.graphs[1000002] = G

        config = _create_config()

        candidates = [
            _create_person(cm_id=200, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=250, first_name="Sara", last_name="Smyth"),
        ]

        # Candidate 200 has mutual request with requester
        # Score: 10 (mutual) + 8 (friends) = 18 → confidence ~0.85
        result = graph.smart_resolve_candidates(
            name="Sarah Smith",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1000002,
            config=config,
            mutual_request_cm_ids={200},  # 200 has mutual request
        )

        # Should auto-resolve to 200 due to mutual request bonus + common friends
        assert result is not None
        auto_result, ranked_candidates = result
        assert auto_result is not None
        resolved_cm_id, confidence, method = auto_result
        assert resolved_cm_id == 200
        assert method == "social_graph_auto"

    def test_low_score_doesnt_auto_resolve(self):
        """Even with clear winner, don't auto-resolve if score too low."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        # Create mock graph with very weak connections
        import networkx as nx

        G = nx.Graph()
        G.add_edge(100, 300)
        G.add_edge(200, 300)  # Only 1 common friend with 200
        G.add_node(250)  # No connections for 250
        graph.graphs[1000002] = G

        config = _create_config()

        candidates = [
            _create_person(cm_id=200, first_name="Sarah", last_name="Smith"),
            _create_person(cm_id=250, first_name="Sara", last_name="Smyth"),
        ]

        result = graph.smart_resolve_candidates(
            name="Sarah Smith",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1000002,
            config=config,
            mutual_request_cm_ids=set(),
        )

        # Should NOT auto-resolve - score too low
        assert result is None or result[0] is None

    def test_empty_candidates_returns_none(self):
        """No candidates should return None."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        import networkx as nx

        graph.graphs[1000002] = nx.Graph()

        config = _create_config()

        result = graph.smart_resolve_candidates(
            name="Sarah Smith",
            candidates=[],
            requester_cm_id=100,
            session_cm_id=1000002,
            config=config,
            mutual_request_cm_ids=set(),
        )

        assert result is None or result[0] is None

    def test_disabled_config_returns_none(self):
        """When smart resolution disabled, always return None."""
        from bunking.sync.bunk_request_processor.social.social_graph import SocialGraph

        pb = Mock()
        graph = SocialGraph(pb, year=2025, session_cm_ids=[1000002])
        graph._initialized = True

        import networkx as nx

        G = nx.Graph()
        G.add_edges_from(
            [
                (100, 300),
                (100, 400),
                (100, 500),
                (200, 300),
                (200, 400),
                (200, 500),  # Strong connection
            ]
        )
        graph.graphs[1000002] = G

        config = _create_config()
        config["enabled"] = False  # Disabled

        candidates = [
            _create_person(cm_id=200, first_name="Sarah", last_name="Smith"),
        ]

        result = graph.smart_resolve_candidates(
            name="Sarah Smith",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1000002,
            config=config,
            mutual_request_cm_ids=set(),
        )

        # When disabled, auto_result is None but still returns candidates
        assert result is not None
        auto_result, ranked_candidates = result
        assert auto_result is None


class TestMutualRequestDetection:
    """Tests for mutual request detection (hybrid approach).

    Option 2 (Hybrid) architecture:
    - In-batch mutual requests: detected by ReciprocalDetector
    - Cross-run mutual requests: detected by DB query via bunk_requests table

    This differs from monolith which includes request edges in the graph.
    """

    def test_check_reciprocal_for_pair_in_batch(self):
        """ReciprocalDetector should detect mutual requests in current batch."""
        from bunking.sync.bunk_request_processor.core.models import BunkRequest
        from bunking.sync.bunk_request_processor.processing.reciprocal_detector import (
            ReciprocalDetector,
        )

        detector = ReciprocalDetector()

        # Create mutual requests: 100 wants 200, 200 wants 100
        request_a = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            year=2025,
            priority=5,
            confidence_score=0.9,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            status=RequestStatus.PENDING,
            is_placeholder=False,
            metadata={},
        )
        request_b = BunkRequest(
            requester_cm_id=200,
            requested_cm_id=100,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            year=2025,
            priority=5,
            confidence_score=0.9,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            status=RequestStatus.PENDING,
            is_placeholder=False,
            metadata={},
        )

        pairs = detector.detect_reciprocals([request_a, request_b])

        assert len(pairs) == 1
        assert pairs[0].is_mutual

    def test_no_mutual_request_detection(self):
        """Should not detect mutual request when only one-way."""
        from bunking.sync.bunk_request_processor.core.models import BunkRequest
        from bunking.sync.bunk_request_processor.processing.reciprocal_detector import (
            ReciprocalDetector,
        )

        detector = ReciprocalDetector()

        # Only 100 wants 200, not vice versa
        request_a = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            year=2025,
            priority=5,
            confidence_score=0.9,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            status=RequestStatus.PENDING,
            is_placeholder=False,
            metadata={},
        )

        pairs = detector.detect_reciprocals([request_a])

        assert len(pairs) == 0


class TestPhase2SmartResolutionIntegration:
    """Tests for integrating smart resolution into Phase2ResolutionService.

    Smart resolution (Phase 2.5) should be attempted after Phase 2's
    resolution pipeline but before Phase 3 AI disambiguation.
    """

    @pytest.mark.asyncio
    async def test_ambiguous_with_clear_social_winner_auto_resolves(self):
        """Ambiguous result with clear social winner should auto-resolve,
        skipping Phase 3 AI disambiguation.
        """
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseRequest,
            ParseResult,
            RequestSource,
            RequestType,
        )
        from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        pipeline = Mock()
        candidate1 = _create_person(cm_id=200, first_name="Sarah", last_name="Smith")
        candidate2 = _create_person(cm_id=250, first_name="Sara", last_name="Smyth")

        # Pipeline returns ambiguous result
        pipeline.batch_resolve = Mock(
            return_value=[
                ResolutionResult(
                    person=None,
                    confidence=0.5,
                    method="ambiguous",
                    candidates=[candidate1, candidate2],
                )
            ]
        )

        # Create mock social graph with smart resolution support
        networkx_analyzer = Mock()
        # Mock smart_resolve_candidates to return clear winner
        networkx_analyzer.smart_resolve_candidates = Mock(return_value=(200, 0.86, "social_graph_auto"))
        networkx_analyzer.enhance_resolution = AsyncMock(
            return_value=ResolutionResult(
                person=candidate1,
                confidence=0.86,
                method="social_graph_auto",
                candidates=[candidate1, candidate2],
            )
        )

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=networkx_analyzer,
        )

        parse_request = ParseRequest(
            request_text="Sarah Smith",
            field_name="share_bunk_with",
            requester_name="Test Requester",
            requester_cm_id=100,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            row_data={},
        )
        parsed_request = ParsedRequest(
            raw_text="Sarah Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Sarah Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        parse_result = ParseResult(
            parsed_requests=[parsed_request],
            is_valid=True,
            parse_request=parse_request,
        )

        results = await service.batch_resolve([parse_result])

        # Should have auto-resolved
        _, resolutions = results[0]
        assert len(resolutions) == 1
        # Enhancement should have been called
        networkx_analyzer.enhance_resolution.assert_called()

    @pytest.mark.asyncio
    async def test_stats_track_smart_resolution(self):
        """Stats should track how many were auto-resolved via smart resolution."""
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseRequest,
            ParseResult,
        )
        from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        pipeline = Mock()
        candidate1 = _create_person(cm_id=200)
        candidate2 = _create_person(cm_id=250)

        pipeline.batch_resolve = Mock(
            return_value=[
                ResolutionResult(
                    person=None,
                    confidence=0.5,
                    candidates=[candidate1, candidate2],
                )
            ]
        )

        networkx_analyzer = Mock()
        networkx_analyzer.enhance_resolution = AsyncMock(
            return_value=ResolutionResult(
                person=candidate1,
                confidence=0.86,
                method="social_graph_auto",
            )
        )

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=networkx_analyzer,
        )

        parse_request = ParseRequest(
            request_text="Sarah Smith",
            field_name="share_bunk_with",
            requester_name="Test",
            requester_cm_id=100,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            row_data={},
        )
        parsed_request = ParsedRequest(
            raw_text="Sarah Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Sarah Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        parse_result = ParseResult(
            parsed_requests=[parsed_request],
            is_valid=True,
            parse_request=parse_request,
        )

        await service.batch_resolve([parse_result])

        # Stats should include networkx_enhanced count
        stats = service.get_stats()
        assert "networkx_enhanced" in stats


class TestSmartResolutionWiring:
    """Tests that verify smart_resolve_candidates is actually CALLED during
    the Phase 2 resolution flow, not just that it exists.

    These tests define the expected behavior: when ambiguous results have
    candidates, smart_resolve_candidates should be attempted to auto-resolve
    before deferring to Phase 3 AI disambiguation.
    """

    @pytest.mark.asyncio
    async def test_smart_resolve_candidates_is_called_for_ambiguous_results(self):
        """Verify smart_resolve_candidates is actually invoked during enhancement.

        This test will FAIL if smart_resolve_candidates is not wired into
        the _enhance_with_networkx flow.
        """
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseRequest,
            ParseResult,
            RequestSource,
            RequestType,
        )
        from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        pipeline = Mock()
        candidate1 = _create_person(cm_id=200, first_name="Sarah", last_name="Smith")
        candidate2 = _create_person(cm_id=250, first_name="Sara", last_name="Smyth")

        # Pipeline returns ambiguous result with candidates
        ambiguous_result = ResolutionResult(
            person=None,
            confidence=0.5,
            method="ambiguous",
            candidates=[candidate1, candidate2],
        )
        pipeline.batch_resolve = Mock(return_value=[ambiguous_result])

        # Create mock social graph - smart_resolve_candidates should be called
        networkx_analyzer = AsyncMock()
        networkx_analyzer.smart_resolve_candidates = Mock(return_value=None)  # Returns None = needs AI
        # enhance_resolution just sorts candidates, doesn't auto-resolve
        networkx_analyzer.enhance_resolution = AsyncMock(
            return_value=ResolutionResult(
                person=None,
                confidence=0.5,
                method="ambiguous",
                candidates=[candidate1, candidate2],
                metadata={"social_graph_enhanced": True},
            )
        )

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=networkx_analyzer,
        )

        parse_request = ParseRequest(
            request_text="Sarah Smith",
            field_name="share_bunk_with",
            requester_name="Test Requester",
            requester_cm_id=100,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            row_data={},
        )
        parsed_request = ParsedRequest(
            raw_text="Sarah Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Sarah Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        parse_result = ParseResult(
            parsed_requests=[parsed_request],
            is_valid=True,
            parse_request=parse_request,
        )

        await service.batch_resolve([parse_result])

        # CRITICAL: smart_resolve_candidates must have been called
        networkx_analyzer.smart_resolve_candidates.assert_called_once()

    @pytest.mark.asyncio
    async def test_smart_resolution_success_marks_result_as_resolved(self):
        """When smart_resolve_candidates returns a result, the resolution
        should be updated to resolved (not ambiguous).

        This test will FAIL if smart_resolve_candidates result is not
        used to update the resolution.
        """
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseRequest,
            ParseResult,
            RequestSource,
            RequestType,
        )
        from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        pipeline = Mock()
        candidate1 = _create_person(cm_id=200, first_name="Sarah", last_name="Smith")
        candidate2 = _create_person(cm_id=250, first_name="Sara", last_name="Smyth")

        # Pipeline returns ambiguous result
        ambiguous_result = ResolutionResult(
            person=None,
            confidence=0.5,
            method="ambiguous",
            candidates=[candidate1, candidate2],
        )
        pipeline.batch_resolve = Mock(return_value=[ambiguous_result])

        # Create mock social graph that will auto-resolve
        networkx_analyzer = AsyncMock()
        # smart_resolve_candidates returns (auto_result, ranked_candidates)
        # New format: tuple of (resolution_tuple, sorted_candidates)
        networkx_analyzer.smart_resolve_candidates = Mock(
            return_value=((200, 0.87, "social_graph_auto"), [candidate1, candidate2])
        )
        # enhance_resolution still returns ambiguous (before smart resolution)
        networkx_analyzer.enhance_resolution = AsyncMock(
            return_value=ResolutionResult(
                person=None,
                confidence=0.5,
                method="ambiguous",
                candidates=[candidate1, candidate2],
                metadata={"social_graph_enhanced": True},
            )
        )

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=networkx_analyzer,
        )

        parse_request = ParseRequest(
            request_text="Sarah Smith",
            field_name="share_bunk_with",
            requester_name="Test Requester",
            requester_cm_id=100,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            row_data={},
        )
        parsed_request = ParsedRequest(
            raw_text="Sarah Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Sarah Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        parse_result = ParseResult(
            parsed_requests=[parsed_request],
            is_valid=True,
            parse_request=parse_request,
        )

        results = await service.batch_resolve([parse_result])

        # Get the resolution result
        _, resolutions = results[0]
        resolution = resolutions[0]

        # CRITICAL: Resolution should be RESOLVED, not ambiguous
        assert resolution.is_resolved, "Resolution should be marked as resolved after smart resolution"
        assert resolution.person is not None, "Resolution should have a resolved person"
        assert resolution.person.cm_id == 200, "Should resolve to the smart-resolved candidate"
        assert resolution.confidence >= 0.85, "Confidence should be from smart resolution"
        assert resolution.method == "social_graph_auto", "Method should indicate social graph auto-resolution"

    @pytest.mark.asyncio
    async def test_smart_resolution_stats_tracked(self):
        """Stats should track smart resolutions separately from regular
        networkx enhancements.

        This test will FAIL if smart resolution stats are not tracked.
        """
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseRequest,
            ParseResult,
            RequestSource,
            RequestType,
        )
        from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        pipeline = Mock()
        candidate1 = _create_person(cm_id=200, first_name="Sarah", last_name="Smith")
        candidate2 = _create_person(cm_id=250, first_name="Sara", last_name="Smyth")

        # Pipeline returns ambiguous result
        ambiguous_result = ResolutionResult(
            person=None,
            confidence=0.5,
            method="ambiguous",
            candidates=[candidate1, candidate2],
        )
        pipeline.batch_resolve = Mock(return_value=[ambiguous_result])

        # Create mock social graph that will auto-resolve
        networkx_analyzer = AsyncMock()
        # New format: tuple of (resolution_tuple, sorted_candidates)
        networkx_analyzer.smart_resolve_candidates = Mock(
            return_value=((200, 0.87, "social_graph_auto"), [candidate1, candidate2])
        )
        networkx_analyzer.enhance_resolution = AsyncMock(
            return_value=ResolutionResult(
                person=None,
                confidence=0.5,
                method="ambiguous",
                candidates=[candidate1, candidate2],
                metadata={"social_graph_enhanced": True},
            )
        )

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=networkx_analyzer,
        )

        parse_request = ParseRequest(
            request_text="Sarah Smith",
            field_name="share_bunk_with",
            requester_name="Test Requester",
            requester_cm_id=100,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            row_data={},
        )
        parsed_request = ParsedRequest(
            raw_text="Sarah Smith",
            request_type=RequestType.BUNK_WITH,
            target_name="Sarah Smith",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        parse_result = ParseResult(
            parsed_requests=[parsed_request],
            is_valid=True,
            parse_request=parse_request,
        )

        await service.batch_resolve([parse_result])

        # CRITICAL: Stats should track smart resolutions
        stats = service.get_stats()
        assert "smart_resolved" in stats, "Stats should include smart_resolved count"
        assert stats["smart_resolved"] == 1, "Should have 1 smart resolution"

    @pytest.mark.asyncio
    async def test_smart_resolution_not_called_when_no_candidates(self):
        """smart_resolve_candidates should not be called when there are
        no candidates to resolve.
        """
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            ParseRequest,
            ParseResult,
            RequestSource,
            RequestType,
        )
        from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
        from bunking.sync.bunk_request_processor.services.phase2_resolution_service import (
            Phase2ResolutionService,
        )

        pipeline = Mock()

        # Pipeline returns result with no candidates
        no_match_result = ResolutionResult(
            person=None,
            confidence=0.0,
            method="no_match",
            candidates=[],
        )
        pipeline.batch_resolve = Mock(return_value=[no_match_result])

        networkx_analyzer = AsyncMock()
        networkx_analyzer.smart_resolve_candidates = Mock(return_value=None)
        networkx_analyzer.enhance_resolution = AsyncMock(return_value=no_match_result)

        service = Phase2ResolutionService(
            resolution_pipeline=pipeline,
            networkx_analyzer=networkx_analyzer,
        )

        parse_request = ParseRequest(
            request_text="Unknown Person",
            field_name="share_bunk_with",
            requester_name="Test Requester",
            requester_cm_id=100,
            requester_grade="5",
            session_cm_id=1000002,
            session_name="Session 2",
            year=2025,
            row_data={},
        )
        parsed_request = ParsedRequest(
            raw_text="Unknown Person",
            request_type=RequestType.BUNK_WITH,
            target_name="Unknown Person",
            age_preference=None,
            source_field="share_bunk_with",
            source=RequestSource.FAMILY,
            confidence=0.9,
            csv_position=0,
            metadata={},
        )
        parse_result = ParseResult(
            parsed_requests=[parsed_request],
            is_valid=True,
            parse_request=parse_request,
        )

        await service.batch_resolve([parse_result])

        # smart_resolve_candidates should NOT be called (no candidates)
        networkx_analyzer.smart_resolve_candidates.assert_not_called()
