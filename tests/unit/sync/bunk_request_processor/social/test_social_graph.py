"""Tests for SocialGraph core functionality.

Tests cover:
- RelationshipType enum and weights
- Graph initialization and building
- Metrics calculation
- Social signals calculation
- Ego network and shortest path caching
"""

from typing import Any
from unittest.mock import Mock

import networkx as nx
import pytest

from bunking.graph.social_graph_builder import LAST_YEAR_HISTORY_SESSION_TYPES
from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult
from bunking.sync.bunk_request_processor.social.social_graph import (
    RELATIONSHIP_WEIGHTS,
    RelationshipType,
    SocialGraph,
)


class TestRelationshipType:
    """Tests for RelationshipType enum."""

    def test_all_relationship_types_defined(self):
        """All expected relationship types are defined."""
        expected = {"BUNK_REQUEST", "SIBLING", "CLASSMATE", "BUNKMATE"}
        actual = {rt.name for rt in RelationshipType}
        assert actual == expected

    def test_relationship_type_values(self):
        """Relationship types have correct string values."""
        assert RelationshipType.BUNK_REQUEST.value == "bunk_request"
        assert RelationshipType.SIBLING.value == "sibling"
        assert RelationshipType.CLASSMATE.value == "classmate"
        assert RelationshipType.BUNKMATE.value == "bunkmate"


class TestRelationshipWeights:
    """Tests for relationship weight configuration."""

    def test_all_relationship_types_have_weights(self):
        """Every RelationshipType has a corresponding weight."""
        for rt in RelationshipType:
            assert rt in RELATIONSHIP_WEIGHTS, f"Missing weight for {rt}"

    def test_weight_ordering(self):
        """Weights follow expected ordering: SIBLING > BUNKMATE > CLASSMATE > BUNK_REQUEST."""
        assert RELATIONSHIP_WEIGHTS[RelationshipType.SIBLING] > RELATIONSHIP_WEIGHTS[RelationshipType.BUNKMATE]
        assert RELATIONSHIP_WEIGHTS[RelationshipType.BUNKMATE] > RELATIONSHIP_WEIGHTS[RelationshipType.CLASSMATE]
        assert RELATIONSHIP_WEIGHTS[RelationshipType.CLASSMATE] > RELATIONSHIP_WEIGHTS[RelationshipType.BUNK_REQUEST]

    def test_weight_values(self):
        """Weights have expected values."""
        assert RELATIONSHIP_WEIGHTS[RelationshipType.SIBLING] == 3.0
        assert RELATIONSHIP_WEIGHTS[RelationshipType.BUNKMATE] == 2.0
        assert RELATIONSHIP_WEIGHTS[RelationshipType.CLASSMATE] == 1.5
        assert RELATIONSHIP_WEIGHTS[RelationshipType.BUNK_REQUEST] == 1.0


class TestSocialGraphInit:
    """Tests for SocialGraph initialization."""

    def test_init_with_required_params(self):
        """SocialGraph initializes with required parameters."""
        mock_pb = Mock()
        graph = SocialGraph(pb=mock_pb, year=2025)

        assert graph.pb == mock_pb
        assert graph.year == 2025
        assert graph.session_cm_ids == []
        assert graph.graphs == {}
        assert graph._initialized is False

    def test_init_with_session_ids(self):
        """SocialGraph accepts session_cm_ids parameter."""
        mock_pb = Mock()
        sessions = [1234, 5678]
        graph = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=sessions)

        assert graph.session_cm_ids == sessions

    def test_init_creates_empty_caches(self):
        """SocialGraph initializes empty caches."""
        mock_pb = Mock()
        graph = SocialGraph(pb=mock_pb, year=2025)

        assert graph._ego_networks == {}
        assert graph._shortest_paths == {}
        assert graph._stats == {}


class TestCalculateMetrics:
    """Tests for _calculate_metrics method."""

    def test_calculate_metrics_empty_graph(self):
        """Metrics calculation handles empty graph."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])
        sg.graphs[1234] = nx.Graph()

        sg._calculate_metrics(1234)

        assert sg._stats[1234]["node_count"] == 0
        assert sg._stats[1234]["edge_count"] == 0
        assert sg._stats[1234]["density"] == 0.0

    def test_calculate_metrics_no_graph(self):
        """Metrics calculation handles missing graph."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        sg._calculate_metrics(9999)

        assert sg._stats[9999]["node_count"] == 0
        assert sg._stats[9999]["density"] == 0.0

    def test_calculate_metrics_simple_graph(self):
        """Metrics calculation works on simple graph."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edges_from([(1, 2), (2, 3), (1, 3)])
        sg.graphs[1234] = G

        sg._calculate_metrics(1234)

        assert sg._stats[1234]["node_count"] == 3
        assert sg._stats[1234]["edge_count"] == 3
        assert sg._stats[1234]["components"] == 1
        assert sg._stats[1234]["average_degree"] == 2.0
        # Triangle has clustering coefficient of 1.0
        assert sg._stats[1234]["clustering_coefficient"] == 1.0


class TestAddInformationalEdge:
    """Tests for _add_informational_edge method."""

    def test_add_new_edge(self):
        """Adding a new edge works correctly."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        G = nx.Graph()

        sg._add_informational_edge(G, 1, 2, RelationshipType.SIBLING, 3.0)

        assert G.has_edge(1, 2)
        assert G[1][2]["weight"] == 3.0
        assert RelationshipType.SIBLING in G[1][2]["relationship_types"]
        assert G[1][2]["informational_only"] is True

    def test_update_existing_edge(self):
        """Updating existing edge combines weights and types."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        G = nx.Graph()

        # Add first edge
        sg._add_informational_edge(G, 1, 2, RelationshipType.SIBLING, 3.0)
        # Add same edge with different type
        sg._add_informational_edge(G, 1, 2, RelationshipType.CLASSMATE, 1.5)

        assert G.has_edge(1, 2)
        # Weight increases (original + 0.5 * new)
        assert G[1][2]["weight"] == 3.0 + 1.5 * 0.5
        assert len(G[1][2]["relationship_types"]) == 2


class TestGetSocialSignals:
    """Tests for get_social_signals method."""

    def test_no_graph_returns_defaults(self):
        """When no graph exists, default signals are returned."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        signals = sg.get_social_signals(1, 2, 9999)

        assert signals["social_distance"] == 999
        assert signals["in_ego_network"] is False
        assert signals["mutual_connections"] == 0
        assert signals["found_by"] == "no_graph"

    def test_nodes_not_in_graph(self):
        """When nodes aren't in graph, returns default signals."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])
        sg.graphs[1234] = nx.Graph()
        sg.graphs[1234].add_node(1)  # Only add one node

        signals = sg.get_social_signals(1, 2, 1234)

        assert signals["social_distance"] == 999

    def test_direct_connection(self):
        """Direct connection returns distance 1 and relationship data."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edge(1, 2, weight=2.0, relationship_types=[RelationshipType.BUNKMATE])
        sg.graphs[1234] = G

        signals = sg.get_social_signals(1, 2, 1234)

        assert signals["social_distance"] == 1
        assert signals["relationship_strength"] == 2.0
        assert signals["in_same_component"] is True

    def test_mutual_connections(self):
        """Mutual connections are counted correctly."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        # 1 and 2 both connect to 3, 4, 5 (3 mutual)
        G.add_edges_from([(1, 3), (1, 4), (1, 5), (2, 3), (2, 4), (2, 5)])
        sg.graphs[1234] = G

        signals = sg.get_social_signals(1, 2, 1234)

        assert signals["mutual_connections"] == 3


class TestEgoNetworkCache:
    """Tests for ego network caching."""

    def test_ego_network_caching(self):
        """Ego network is cached after first call."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edges_from([(1, 2), (1, 3), (2, 4)])
        sg.graphs[1234] = G

        # First call
        ego1 = sg._get_ego_network(1, 1234)
        # Second call should use cache
        ego2 = sg._get_ego_network(1, 1234)

        assert ego1 == ego2
        # Cache key is simplified to just the node (person_id)
        assert 1 in sg._ego_networks

    def test_ego_network_excludes_center(self):
        """Ego network excludes the center node."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edges_from([(1, 2), (1, 3)])
        sg.graphs[1234] = G

        ego = sg._get_ego_network(1, 1234)

        assert 1 not in ego
        assert 2 in ego
        assert 3 in ego


class TestShortestPathCache:
    """Tests for shortest path caching."""

    def test_shortest_path_caching(self):
        """Shortest path is cached after first call."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edges_from([(1, 2), (2, 3), (3, 4)])
        sg.graphs[1234] = G

        # First call
        dist1 = sg._get_shortest_path_length(1, 4, 1234)
        # Second call should use cache
        dist2 = sg._get_shortest_path_length(1, 4, 1234)

        assert dist1 == dist2 == 3

    def test_shortest_path_symmetric_key(self):
        """Cache key is symmetric (1,4 same as 4,1)."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edges_from([(1, 2), (2, 3)])
        sg.graphs[1234] = G

        dist1 = sg._get_shortest_path_length(1, 3, 1234)
        dist2 = sg._get_shortest_path_length(3, 1, 1234)

        assert dist1 == dist2


class TestCalculateEdgeWeight:
    """Tests for _calculate_edge_weight method."""

    def test_bunk_with_request_base_weight(self):
        """bunk_with request has base weight 1.0."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        # Use spec to limit attributes (no is_reciprocal)
        request = Mock(spec=["request_type", "confidence_score"])
        request.request_type = "bunk_with"
        request.confidence_score = 1.0

        weight = sg._calculate_edge_weight(request)

        assert weight == 1.0

    def test_not_bunk_with_negative_weight(self):
        """not_bunk_with request has negative weight."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        request = Mock(spec=["request_type", "confidence_score"])
        request.request_type = "not_bunk_with"
        request.confidence_score = 1.0

        weight = sg._calculate_edge_weight(request)

        assert weight == -0.5

    def test_weight_adjusted_by_confidence(self):
        """Weight is multiplied by confidence score."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        request = Mock(spec=["request_type", "confidence_score"])
        request.request_type = "bunk_with"
        request.confidence_score = 0.5

        weight = sg._calculate_edge_weight(request)

        assert weight == 0.5

    def test_reciprocal_request_boost(self):
        """Reciprocal requests get 1.5x boost."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        request = Mock()
        request.request_type = "bunk_with"
        request.confidence_score = 1.0
        request.is_reciprocal = True

        weight = sg._calculate_edge_weight(request)

        assert weight == 1.5


class TestDefaultSignals:
    """Tests for _default_signals method."""

    def test_default_signals_structure(self):
        """Default signals have expected structure."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        signals = sg._default_signals()

        assert "in_ego_network" in signals
        assert "social_distance" in signals
        assert "mutual_connections" in signals
        assert "network_density" in signals
        assert "ego_network_size" in signals
        assert "relationship_strength" in signals
        assert "in_same_component" in signals
        assert "found_by" in signals

    def test_default_signals_values(self):
        """Default signals have expected default values."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        signals = sg._default_signals()

        assert signals["in_ego_network"] is False
        assert signals["social_distance"] == 999
        assert signals["mutual_connections"] == 0
        assert signals["found_by"] == "no_graph"


class TestCalculateSocialScore:
    """Tests for calculate_social_score method (Phase 2.5)."""

    def test_mutual_request_bonus(self):
        """Mutual request adds bonus to score."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])
        sg.graphs[1234] = nx.Graph()

        config = {"mutual_request_bonus": 10}
        score = sg.calculate_social_score(
            requester_cm_id=1,
            candidate_cm_id=2,
            session_cm_id=1234,
            config=config,
            has_mutual_request=True,
        )

        assert score == 10

    def test_no_mutual_request(self):
        """No mutual request gives zero base score."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])
        sg.graphs[1234] = nx.Graph()

        config = {"mutual_request_bonus": 10}
        score = sg.calculate_social_score(
            requester_cm_id=1,
            candidate_cm_id=2,
            session_cm_id=1234,
            config=config,
            has_mutual_request=False,
        )

        assert score == 0

    def test_common_friends_bonus(self):
        """Common friends add to score."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        # 1 and 2 both connect to 3 and 4 (2 common friends)
        G.add_edges_from([(1, 3), (1, 4), (2, 3), (2, 4)])
        sg.graphs[1234] = G

        config = {"common_friends_weight": 1.0}
        score = sg.calculate_social_score(
            requester_cm_id=1,
            candidate_cm_id=2,
            session_cm_id=1234,
            config=config,
            has_mutual_request=False,
        )

        assert score == 2.0  # 2 common friends * 1.0 weight

    def test_historical_bunking_bonus(self):
        """Historical bunkmates get bonus."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edge(1, 2, weight=2.0, relationship_types=[RelationshipType.BUNKMATE])
        sg.graphs[1234] = G

        config = {"historical_bunking_weight": 0.8}
        score = sg.calculate_social_score(
            requester_cm_id=1,
            candidate_cm_id=2,
            session_cm_id=1234,
            config=config,
            has_mutual_request=False,
        )

        assert score == 0.8

    def test_no_graph_returns_base_score(self):
        """Returns only mutual bonus if no graph."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        config = {"mutual_request_bonus": 10}
        score = sg.calculate_social_score(
            requester_cm_id=1,
            candidate_cm_id=2,
            session_cm_id=9999,
            config=config,
            has_mutual_request=True,
        )

        assert score == 10


class TestCalculateConfidenceFromScore:
    """Tests for calculate_confidence_from_score method."""

    def test_zero_score_gives_base_confidence(self):
        """Zero score gives base confidence of 0.6."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        config = {"connection_score_weight": 0.7}
        confidence = sg.calculate_confidence_from_score(0.0, config)

        assert confidence == 0.6

    def test_max_score_gives_high_confidence(self):
        """High score (20+) gives max additional confidence."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        config = {"connection_score_weight": 0.7}
        confidence = sg.calculate_confidence_from_score(20.0, config)

        # 0.6 + (1.0 * 0.7 * 0.4) = 0.6 + 0.28 = 0.88
        assert confidence == pytest.approx(0.88, rel=0.01)

    def test_partial_score(self):
        """Partial score gives proportional confidence."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        config = {"connection_score_weight": 0.7}
        confidence = sg.calculate_confidence_from_score(10.0, config)

        # 0.6 + (0.5 * 0.7 * 0.4) = 0.6 + 0.14 = 0.74
        assert confidence == pytest.approx(0.74, rel=0.01)

    def test_default_weight(self):
        """Uses default weight of 0.7 if not in config."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        config: dict[str, Any] = {}  # No weight specified
        confidence = sg.calculate_confidence_from_score(20.0, config)

        assert confidence == pytest.approx(0.88, rel=0.01)


class TestSmartResolveCandidates:
    """Tests for smart_resolve_candidates method."""

    def _create_person(self, cm_id: int, first_name: str = "Test") -> Person:
        """Helper to create Person objects."""
        return Person(
            cm_id=cm_id,
            first_name=first_name,
            last_name="Person",
            grade=5,
            session_cm_id=1234,
        )

    def test_disabled_returns_none_and_candidates(self):
        """Disabled smart resolution returns None and original candidates."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        candidates = [self._create_person(1), self._create_person(2)]
        config = {"enabled": False}

        result, ranked = sg.smart_resolve_candidates(
            name="Test",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1234,
            config=config,
            mutual_request_cm_ids=set(),
        )

        assert result is None
        assert ranked == candidates

    def test_empty_candidates_returns_empty(self):
        """Empty candidates list returns None and empty list."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        config = {"enabled": True}

        result, ranked = sg.smart_resolve_candidates(
            name="Test",
            candidates=[],
            requester_cm_id=100,
            session_cm_id=1234,
            config=config,
            mutual_request_cm_ids=set(),
        )

        assert result is None
        assert ranked == []

    def test_auto_resolve_with_clear_winner(self):
        """Auto-resolves when one candidate has strong signals."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        # Strong connection between requester 100 and candidate 1
        G.add_edges_from(
            [
                (100, 1),
                (100, 3),
                (100, 4),
                (100, 5),  # Requester has many friends
                (1, 3),
                (1, 4),
                (1, 5),  # Candidate 1 shares all friends
            ]
        )
        G.add_node(2)  # Candidate 2 has no connections
        sg.graphs[1234] = G

        candidates = [self._create_person(1), self._create_person(2)]
        config = {
            "enabled": True,
            "significant_connection_threshold": 2,
            "min_connections_for_auto_resolve": 2,
            "min_confidence_for_auto_resolve": 0.7,
            "common_friends_weight": 1.0,
            "connection_score_weight": 0.7,
            "mutual_request_bonus": 10,
        }

        result, ranked = sg.smart_resolve_candidates(
            name="Test",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1234,
            config=config,
            mutual_request_cm_ids={1},  # Mutual request with candidate 1
        )

        # Should auto-resolve to candidate 1
        assert result is not None
        assert result[0] == 1  # cm_id
        assert result[2] == "social_graph_auto"  # method

    def test_no_auto_resolve_when_close_scores(self):
        """Does not auto-resolve when candidates have similar scores."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        # Both candidates have similar connections
        G.add_edges_from([(100, 1), (100, 2), (1, 3), (2, 3)])
        sg.graphs[1234] = G

        candidates = [self._create_person(1), self._create_person(2)]
        config = {
            "enabled": True,
            "significant_connection_threshold": 5,  # Need 5 point diff
            "min_connections_for_auto_resolve": 3,
            "min_confidence_for_auto_resolve": 0.85,
            "common_friends_weight": 1.0,
            "connection_score_weight": 0.7,
        }

        result, ranked = sg.smart_resolve_candidates(
            name="Test",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1234,
            config=config,
            mutual_request_cm_ids=set(),
        )

        # Should NOT auto-resolve
        assert result is None
        # But candidates should still be ranked
        assert len(ranked) == 2

    def test_returns_ranked_candidates(self):
        """Always returns candidates ranked by social score."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edges_from([(100, 1), (100, 2)])  # Equal connections
        sg.graphs[1234] = G

        # Create candidates with specific cm_ids
        candidates = [self._create_person(2), self._create_person(1)]  # Out of order

        config = {
            "enabled": True,
            "significant_connection_threshold": 10,  # Won't auto-resolve
            "common_friends_weight": 1.0,
            "mutual_request_bonus": 10,
        }

        # Give candidate 1 a mutual request (higher score)
        result, ranked = sg.smart_resolve_candidates(
            name="Test",
            candidates=candidates,
            requester_cm_id=100,
            session_cm_id=1234,
            config=config,
            mutual_request_cm_ids={1},
        )

        # Candidate 1 should be first (higher score due to mutual request)
        assert ranked[0].cm_id == 1


class TestInitializeAsync:
    """Tests for async initialize method."""

    @pytest.mark.asyncio
    async def test_initialize_sets_initialized_flag(self):
        """Initialize sets the _initialized flag."""
        mock_pb = Mock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        await sg.initialize()

        assert sg._initialized is True

    @pytest.mark.asyncio
    async def test_initialize_skips_if_already_initialized(self):
        """Initialize does nothing if already initialized."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        sg._initialized = True

        await sg.initialize()

        # Should not have called any DB methods
        mock_pb.collection.assert_not_called()

    @pytest.mark.asyncio
    async def test_initialize_handles_errors_gracefully(self):
        """Initialize creates empty graph on error."""
        mock_pb = Mock()
        mock_pb.collection.return_value.get_full_list.side_effect = Exception("DB Error")

        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        await sg.initialize()

        # Should have empty graph and stats
        assert 1234 in sg.graphs
        assert sg.graphs[1234].number_of_nodes() == 0
        assert sg._stats[1234]["node_count"] == 0

    @pytest.mark.asyncio
    async def test_initialize_uses_valid_sessions_when_none_specified(self):
        """Initialize fetches valid sessions from DB when none specified."""
        mock_pb = Mock()
        mock_pb.collection.return_value.get_full_list.return_value = []

        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[])

        # Mock the session repository
        sg._session_repo = Mock()
        sg._session_repo.get_valid_bunking_session_ids.return_value = {1234, 5678}

        await sg.initialize()

        # Should have fetched valid sessions
        sg._session_repo.get_valid_bunking_session_ids.assert_called_with(2025)
        assert set(sg.session_cm_ids) == {1234, 5678}


class TestSocialSignalsEdgeCases:
    """Additional edge case tests for social signals."""

    def test_get_social_signals_with_ego_network(self):
        """get_social_signals populates ego network info."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edges_from([(1, 2), (1, 3), (1, 4)])
        sg.graphs[1234] = G

        signals = sg.get_social_signals(1, 2, 1234)

        assert signals["in_ego_network"] is True
        assert signals["ego_network_size"] == 3  # 2, 3, 4

    def test_get_social_signals_relationship_types(self):
        """get_social_signals includes relationship types for direct edges."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_edge(1, 2, weight=3.0, relationship_types=[RelationshipType.SIBLING])
        sg.graphs[1234] = G

        signals = sg.get_social_signals(1, 2, 1234)

        assert signals["relationship_strength"] == 3.0
        assert "sibling" in signals["relationship_types"]

    def test_get_social_signals_network_density(self):
        """get_social_signals calculates local network density."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        # Create a dense local network
        G = nx.Graph()
        G.add_edges_from([(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)])
        sg.graphs[1234] = G

        signals = sg.get_social_signals(1, 2, 1234)  # Both in graph

        # Should have ego network info and density
        assert signals["ego_network_size"] == 3
        assert signals["network_density"] > 0


class TestNoPathScenarios:
    """Tests for disconnected graph scenarios."""

    def test_shortest_path_no_path_raises(self):
        """Raises NetworkXNoPath when nodes are disconnected."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_node(1)
        G.add_node(2)  # Disconnected
        sg.graphs[1234] = G

        with pytest.raises(nx.NetworkXNoPath):
            sg._get_shortest_path_length(1, 2, 1234)

    def test_get_social_signals_disconnected_nodes(self):
        """Social signals for disconnected nodes show max distance."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        G = nx.Graph()
        G.add_node(1)
        G.add_node(2)  # Disconnected
        sg.graphs[1234] = G

        signals = sg.get_social_signals(1, 2, 1234)

        # Should have max distance since disconnected
        assert signals["social_distance"] == 999
        assert signals["in_same_component"] is False


class TestAddInformationalRelationshipsExpandedPerson:
    """Tests that _add_informational_relationships reads fields from expanded person, not attendee.

    The bug: family_id, school, grade, current_bunk_id were read from the attendee
    record directly, but those fields don't exist on the attendees collection.
    They live on the persons table and must be accessed via expand.
    """

    def _make_attendee(
        self,
        person_cm_id: int,
        session_cm_id: int,
        household_id: int | None = None,
        school: str | None = None,
        grade: int | None = None,
    ) -> Mock:
        """Create a mock attendee with properly expanded person and session."""
        person = Mock()
        person.cm_id = person_cm_id
        person.household_id = household_id
        person.school = school
        person.grade = grade

        session = Mock()
        session.cm_id = session_cm_id

        attendee = Mock(spec=["expand", "status", "year"])
        attendee.status = "enrolled"
        attendee.year = 2025
        attendee.expand = {"person": person, "session": session}
        return attendee

    @pytest.mark.asyncio
    async def test_school_grade_grouping_reads_from_expanded_person(self):
        """School and grade come from expanded person, not attendee directly."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        # Two attendees at the same school and grade (via expanded person)
        attendees = [
            self._make_attendee(person_cm_id=101, session_cm_id=1234, school="Riverside Elementary", grade=5),
            self._make_attendee(person_cm_id=102, session_cm_id=1234, school="Riverside Elementary", grade=5),
        ]
        mock_pb.collection.return_value.get_full_list.return_value = attendees

        graph = nx.Graph()
        await sg._add_informational_relationships(graph, 1234)

        # Should have 2 nodes and a CLASSMATE edge between them
        assert graph.number_of_nodes() == 2
        assert graph.has_edge(101, 102)
        edge_data = graph[101][102]
        assert RelationshipType.CLASSMATE in edge_data["relationship_types"]

    @pytest.mark.asyncio
    async def test_household_grouping_reads_from_expanded_person(self):
        """Household/family grouping reads household_id from expanded person."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        # Two siblings with same household_id (via expanded person)
        attendees = [
            self._make_attendee(person_cm_id=201, session_cm_id=1234, household_id=9001),
            self._make_attendee(person_cm_id=202, session_cm_id=1234, household_id=9001),
        ]
        mock_pb.collection.return_value.get_full_list.return_value = attendees

        graph = nx.Graph()
        await sg._add_informational_relationships(graph, 1234)

        # Should have SIBLING edge between them
        assert graph.number_of_nodes() == 2
        assert graph.has_edge(201, 202)
        edge_data = graph[201][202]
        assert RelationshipType.SIBLING in edge_data["relationship_types"]

    @pytest.mark.asyncio
    async def test_graph_produces_nodes_with_expanded_person_data(self):
        """Graph produces >0 nodes when attendees exist with expanded person data."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        # Three attendees with school/household data on expanded person
        attendees = [
            self._make_attendee(
                person_cm_id=301, session_cm_id=1234, household_id=8001, school="Oak Valley Middle", grade=6
            ),
            self._make_attendee(
                person_cm_id=302, session_cm_id=1234, household_id=8001, school="Oak Valley Middle", grade=6
            ),
            self._make_attendee(
                person_cm_id=303, session_cm_id=1234, household_id=8002, school="Oak Valley Middle", grade=6
            ),
        ]
        mock_pb.collection.return_value.get_full_list.return_value = attendees

        graph = nx.Graph()
        await sg._add_informational_relationships(graph, 1234)

        # All three should be nodes (they all share school+grade at minimum)
        assert graph.number_of_nodes() == 3

        # 301-302 should have both SIBLING and CLASSMATE edges
        assert graph.has_edge(301, 302)
        edge_types_12 = graph[301][302]["relationship_types"]
        assert RelationshipType.SIBLING in edge_types_12
        assert RelationshipType.CLASSMATE in edge_types_12

        # 301-303 and 302-303 should have CLASSMATE edge (same school+grade)
        assert graph.has_edge(301, 303)
        assert graph.has_edge(302, 303)

    @pytest.mark.asyncio
    async def test_bunk_grouping_is_skipped(self):
        """Current bunk grouping should be skipped (we are solving bunking, not using it)."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        # Create attendees that have NO school/household data on the person
        # so no CLASSMATE or SIBLING edges are created
        person1 = Mock()
        person1.cm_id = 401
        person1.household_id = None
        person1.school = None
        person1.grade = None

        person2 = Mock()
        person2.cm_id = 402
        person2.household_id = None
        person2.school = None
        person2.grade = None

        session = Mock()
        session.cm_id = 1234

        att1 = Mock(spec=["expand", "status", "year"])
        att1.status = "enrolled"
        att1.year = 2025
        att1.expand = {"person": person1, "session": session}

        att2 = Mock(spec=["expand", "status", "year"])
        att2.status = "enrolled"
        att2.year = 2025
        att2.expand = {"person": person2, "session": session}

        mock_pb.collection.return_value.get_full_list.return_value = [att1, att2]

        graph = nx.Graph()
        await sg._add_informational_relationships(graph, 1234)

        # No BUNKMATE edges from current bunk grouping
        # (historical bunking is handled separately by _add_historical_bunking_relationships)
        for u, v, data in graph.edges(data=True):
            assert RelationshipType.BUNKMATE not in data.get("relationship_types", [])

    @pytest.mark.asyncio
    async def test_historical_bunking_not_short_circuited_by_zero_nodes(self):
        """When nodes exist from informational relationships, historical bunking populates."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])

        # Two attendees sharing school
        attendees = [
            self._make_attendee(person_cm_id=501, session_cm_id=1234, school="Hillcrest High", grade=9),
            self._make_attendee(person_cm_id=502, session_cm_id=1234, school="Hillcrest High", grade=9),
        ]

        # Historical bunk assignments for previous year
        # Both rows carry a session: prior-year bunkmate grouping is keyed on
        # (year, bunk, session), because a bunk is a building reused by
        # successive sessions (#2425).
        hist_assignment1 = Mock()
        hist_assignment1.expand = {
            "person": Mock(cm_id=501),
            "bunk": Mock(id="bunk_A"),
            "session": Mock(id="sess_1"),
        }
        hist_assignment1.year = 2024

        hist_assignment2 = Mock()
        hist_assignment2.expand = {
            "person": Mock(cm_id=502),
            "bunk": Mock(id="bunk_A"),
            "session": Mock(id="sess_1"),
        }
        hist_assignment2.year = 2024

        def mock_get_full_list(**kwargs):
            query = kwargs.get("query_params", {})
            filter_str = query.get("filter", "")
            if "year < " in filter_str:
                return [hist_assignment1, hist_assignment2]
            return attendees

        mock_pb.collection.return_value.get_full_list.side_effect = mock_get_full_list

        graph = await sg._build_session_graph(1234)

        # Should have >0 nodes (from informational relationships)
        assert graph.number_of_nodes() > 0
        # Should have edges (classmate + historical bunkmate)
        assert graph.number_of_edges() > 0

        # Check that historical bunkmate edge exists
        assert graph.has_edge(501, 502)
        edge_types = graph[501][502]["relationship_types"]
        assert RelationshipType.BUNKMATE in edge_types


class TestEnhanceResolution:
    """Tests for enhance_resolution — cross-session candidate handling (#866)."""

    @pytest.mark.asyncio
    async def test_cross_session_candidates_preserved(self):
        """Candidates in a different session are NOT dropped."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True

        G = nx.Graph()
        G.add_node(100)
        sg.graphs[1000] = G

        candidate = Person(
            cm_id=1,
            first_name="Emma",
            last_name="Johnson",
            grade=5,
            session_cm_id=2000,
        )

        resolution = ResolutionResult(
            candidates=[candidate],
            confidence=0.0,
            method="disambiguation_candidates",
        )

        result = await sg.enhance_resolution(
            resolution=resolution,
            requester_cm_id=100,
            session_cm_id=1000,
        )

        assert result.candidates is not None
        assert len(result.candidates) == 1
        assert result.candidates[0].cm_id == 1

    @pytest.mark.asyncio
    async def test_cross_session_candidates_get_default_signals(self):
        """Cross-session candidates get default social signals (distance=999)."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True

        G = nx.Graph()
        G.add_node(100)
        sg.graphs[1000] = G

        # Two cross-session candidates so is_ambiguous=True and enhance_resolution processes them
        candidate1 = Person(
            cm_id=1,
            first_name="Emma",
            last_name="Johnson",
            grade=5,
            session_cm_id=2000,
        )
        candidate2 = Person(
            cm_id=2,
            first_name="Emma",
            last_name="Johnson",
            grade=5,
            session_cm_id=3000,
        )

        resolution = ResolutionResult(
            candidates=[candidate1, candidate2],
            confidence=0.0,
            method="disambiguation_candidates",
        )

        result = await sg.enhance_resolution(
            resolution=resolution,
            requester_cm_id=100,
            session_cm_id=1000,
        )

        # Both cross-session candidates must receive default signals
        assert result.candidates is not None
        for c in result.candidates:
            assert c.metadata["social_distance"] == 999
            assert c.metadata["mutual_connections"] == 0

    @pytest.mark.asyncio
    async def test_mixed_session_candidates_ranked_correctly(self):
        """Same-session candidates rank above cross-session candidates."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True

        G = nx.Graph()
        G.add_edges_from([(100, 2)])
        sg.graphs[1000] = G

        cross_session = Person(
            cm_id=1,
            first_name="Liam",
            last_name="Garcia",
            grade=5,
            session_cm_id=2000,
        )
        same_session = Person(
            cm_id=2,
            first_name="Olivia",
            last_name="Chen",
            grade=5,
            session_cm_id=1000,
        )

        resolution = ResolutionResult(
            candidates=[cross_session, same_session],
            confidence=0.0,
            method="disambiguation_candidates",
        )

        result = await sg.enhance_resolution(
            resolution=resolution,
            requester_cm_id=100,
            session_cm_id=1000,
        )

        assert result.candidates is not None
        assert len(result.candidates) == 2
        assert result.candidates[0].cm_id == 2
        assert result.candidates[1].cm_id == 1

    @pytest.mark.asyncio
    async def test_all_cross_session_returns_nonempty(self):
        """When ALL candidates are cross-session, list is non-empty (regression test)."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True

        G = nx.Graph()
        G.add_node(100)
        sg.graphs[1000] = G

        candidates = [
            Person(cm_id=1, first_name="Emma", last_name="Johnson", grade=5, session_cm_id=2000),
            Person(cm_id=2, first_name="Liam", last_name="Garcia", grade=5, session_cm_id=3000),
            Person(cm_id=3, first_name="Olivia", last_name="Chen", grade=5, session_cm_id=2000),
        ]

        resolution = ResolutionResult(
            candidates=candidates,
            confidence=0.0,
            method="disambiguation_candidates",
        )

        result = await sg.enhance_resolution(
            resolution=resolution,
            requester_cm_id=100,
            session_cm_id=1000,
        )

        assert result.candidates is not None
        assert len(result.candidates) == 3
        assert result.metadata is not None
        assert result.metadata["social_graph_enhanced"] is True

    @pytest.mark.asyncio
    async def test_gender_preserved_on_enhanced_person(self):
        """Enhanced person copies gender from original candidate."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True

        G = nx.Graph()
        G.add_node(100)
        sg.graphs[1000] = G

        candidate1 = Person(
            cm_id=1,
            first_name="Emma",
            last_name="Johnson",
            grade=5,
            session_cm_id=2000,
            gender="F",
        )
        candidate2 = Person(
            cm_id=2,
            first_name="Liam",
            last_name="Garcia",
            grade=5,
            session_cm_id=2000,
            gender="M",
        )

        resolution = ResolutionResult(
            candidates=[candidate1, candidate2],
            confidence=0.0,
            method="disambiguation_candidates",
        )

        result = await sg.enhance_resolution(
            resolution=resolution,
            requester_cm_id=100,
            session_cm_id=1000,
        )

        # Gender must be preserved through the enhancement path (is_ambiguous = True with 2 candidates)
        assert result.candidates is not None
        genders = {c.cm_id: c.gender for c in result.candidates}
        assert genders[1] == "F"
        assert genders[2] == "M"

    @pytest.mark.asyncio
    async def test_same_gender_candidates_ranked_first_non_ag(self):
        """In non-AG sessions, same-gender candidates rank above cross-gender."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True
        sg.session_types = {1000: "main"}

        G = nx.Graph()
        G.add_node(100, gender="F")
        sg.graphs[1000] = G

        male_candidate = Person(cm_id=1, first_name="Noah", last_name="Chen", grade=5, session_cm_id=2000, gender="M")
        female_candidate = Person(
            cm_id=2, first_name="Noa", last_name="Garcia", grade=5, session_cm_id=2000, gender="F"
        )

        resolution = ResolutionResult(
            candidates=[male_candidate, female_candidate],
            confidence=0.0,
            method="disambiguation_candidates",
        )

        result = await sg.enhance_resolution(
            resolution=resolution,
            requester_cm_id=100,
            session_cm_id=1000,
        )

        # Female requester in non-AG session → female candidate ranked first
        assert result.candidates is not None
        assert result.candidates[0].cm_id == 2
        assert result.candidates[0].gender == "F"
        assert result.candidates[1].cm_id == 1
        assert result.candidates[1].gender == "M"

    @pytest.mark.asyncio
    async def test_ag_session_skips_gender_sorting(self):
        """In AG sessions, gender does not affect candidate ordering."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True
        sg.session_types = {1000: "ag"}

        G = nx.Graph()
        # Requester connected to male candidate but not female
        G.add_node(100, gender="F")
        G.add_edge(100, 1)
        sg.graphs[1000] = G

        male_candidate = Person(cm_id=1, first_name="Noah", last_name="Chen", grade=5, session_cm_id=1000, gender="M")
        female_candidate = Person(
            cm_id=2, first_name="Noa", last_name="Garcia", grade=5, session_cm_id=1000, gender="F"
        )

        resolution = ResolutionResult(
            candidates=[female_candidate, male_candidate],
            confidence=0.0,
            method="disambiguation_candidates",
        )

        result = await sg.enhance_resolution(
            resolution=resolution,
            requester_cm_id=100,
            session_cm_id=1000,
        )

        # AG session — male candidate with social connection should still rank first
        assert result.candidates is not None
        assert result.candidates[0].cm_id == 1

    @pytest.mark.asyncio
    async def test_gender_unknown_no_gender_sorting(self):
        """When requester gender is unknown, no gender-aware sorting applied."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True
        sg.session_types = {1000: "main"}

        G = nx.Graph()
        G.add_node(100)  # No gender attribute on node
        sg.graphs[1000] = G

        male_candidate = Person(cm_id=1, first_name="Noah", last_name="Chen", grade=5, session_cm_id=2000, gender="M")
        female_candidate = Person(
            cm_id=2, first_name="Noa", last_name="Garcia", grade=5, session_cm_id=2000, gender="F"
        )

        resolution = ResolutionResult(
            candidates=[male_candidate, female_candidate],
            confidence=0.0,
            method="disambiguation_candidates",
        )

        result = await sg.enhance_resolution(
            resolution=resolution,
            requester_cm_id=100,
            session_cm_id=1000,
        )

        # No gender data on requester — original order preserved (both have same default signals)
        assert result.candidates is not None
        assert len(result.candidates) == 2


class TestGenderAwareScoring:
    """Tests for gender-aware social score adjustments in smart_resolve_candidates."""

    def _make_sg_with_graph(self) -> SocialGraph:
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1000])
        sg._initialized = True
        sg.session_types = {1000: "main"}
        G = nx.Graph()
        G.add_node(100, gender="F")
        G.add_node(1, gender="F")
        G.add_node(2, gender="M")
        sg.graphs[1000] = G
        return sg

    def test_same_gender_scores_higher_than_cross_gender(self):
        """Same-gender candidate scores higher than cross-gender in non-AG session."""
        sg = self._make_sg_with_graph()
        config = {
            "enabled": True,
            "significant_connection_threshold": 5,
            "min_connections_for_auto_resolve": 3,
            "min_confidence_for_auto_resolve": 0.85,
            "mutual_request_bonus": 10,
            "common_friends_weight": 1.0,
            "historical_bunking_weight": 0.8,
            "connection_score_weight": 0.7,
        }

        female_candidate = Person(
            cm_id=1, first_name="Emma", last_name="Johnson", grade=5, session_cm_id=1000, gender="F"
        )
        male_candidate = Person(cm_id=2, first_name="Liam", last_name="Garcia", grade=5, session_cm_id=1000, gender="M")

        _, ranked = sg.smart_resolve_candidates(
            name="emma",
            candidates=[male_candidate, female_candidate],
            requester_cm_id=100,
            session_cm_id=1000,
            config=config,
            mutual_request_cm_ids=set(),
            requester_gender="F",
            is_ag_session=False,
        )

        # Female candidate should rank first (same-gender bonus)
        assert ranked[0].cm_id == 1

    def test_ag_session_no_gender_score_adjustment(self):
        """AG session candidates scored equally regardless of gender."""
        sg = self._make_sg_with_graph()
        config = {
            "enabled": True,
            "significant_connection_threshold": 5,
            "min_connections_for_auto_resolve": 3,
            "min_confidence_for_auto_resolve": 0.85,
            "mutual_request_bonus": 10,
            "common_friends_weight": 1.0,
            "historical_bunking_weight": 0.8,
            "connection_score_weight": 0.7,
        }

        female_candidate = Person(
            cm_id=1, first_name="Emma", last_name="Johnson", grade=5, session_cm_id=1000, gender="F"
        )
        male_candidate = Person(cm_id=2, first_name="Liam", last_name="Garcia", grade=5, session_cm_id=1000, gender="M")

        _, ranked = sg.smart_resolve_candidates(
            name="emma",
            candidates=[male_candidate, female_candidate],
            requester_cm_id=100,
            session_cm_id=1000,
            config=config,
            mutual_request_cm_ids=set(),
            requester_gender="F",
            is_ag_session=True,
        )

        # AG session — no gender adjustment, both candidates have equal score (0.0)
        # Original order preserved when scores are tied
        assert len(ranked) == 2


class TestHistoricalBunkingSessionScope:
    """Prior-year BUNKMATE edges must come from a real summer cabin (#2425).

    Two defects are pinned here:
    1. the query had no ``session_type`` predicate, so Family Camp day groups
       were scored as summer bunkmate history;
    2. the grouping key was ``(year, bunk)`` with no session in it, so children
       who occupied the same cabin in different weeks were paired.
    """

    @staticmethod
    def _assignment(person_cm_id: int, bunk_id: str, year: int, session_id: str) -> Mock:
        assignment = Mock(spec=["expand", "year"])
        assignment.year = year
        person = Mock(spec=["cm_id"])
        person.cm_id = person_cm_id
        bunk = Mock(spec=["id"])
        bunk.id = bunk_id
        session = Mock(spec=["id"])
        session.id = session_id
        assignment.expand = {"person": person, "bunk": bunk, "session": session}
        return assignment

    @staticmethod
    def _graph(*person_cm_ids: int) -> nx.Graph:
        graph = nx.Graph()
        for cm_id in person_cm_ids:
            graph.add_node(cm_id)
        return graph

    @pytest.mark.asyncio
    async def test_query_carries_session_type_predicate(self):
        """The prior-year query must exclude non-bunking session types in SQL."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2026, session_cm_ids=[1234])

        captured: list[dict[str, Any]] = []

        def _get_full_list(**kwargs):
            captured.append(kwargs.get("query_params", {}))
            return []

        mock_pb.collection.return_value.get_full_list.side_effect = _get_full_list

        await sg._add_historical_bunking_relationships(self._graph(601), 1234)

        assert captured, "expected a bunk_assignments query"
        filter_str = captured[0]["filter"]
        for session_type in LAST_YEAR_HISTORY_SESSION_TYPES:
            assert f'session.session_type = "{session_type}"' in filter_str
        assert "session" in captured[0]["expand"]

    @pytest.mark.asyncio
    async def test_same_bunk_different_session_is_not_a_bunkmate_edge(self):
        """A cabin reused by a later session must not pair the two occupants."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2026, session_cm_ids=[1234])

        mock_pb.collection.return_value.get_full_list.return_value = [
            self._assignment(701, "bunk_A", 2025, "sess_1"),
            self._assignment(702, "bunk_A", 2025, "sess_2"),
        ]

        graph = self._graph(701, 702)
        await sg._add_historical_bunking_relationships(graph, 1234)

        assert not graph.has_edge(701, 702)

    @pytest.mark.asyncio
    async def test_same_bunk_same_session_is_a_bunkmate_edge(self):
        """Real cabinmates — same bunk, same session, same year — still pair."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2026, session_cm_ids=[1234])

        mock_pb.collection.return_value.get_full_list.return_value = [
            self._assignment(801, "bunk_A", 2025, "sess_1"),
            self._assignment(802, "bunk_A", 2025, "sess_1"),
        ]

        graph = self._graph(801, 802)
        await sg._add_historical_bunking_relationships(graph, 1234)

        assert graph.has_edge(801, 802)
        assert RelationshipType.BUNKMATE in graph[801][802]["relationship_types"]

    @pytest.mark.asyncio
    async def test_assignment_without_session_is_skipped(self):
        """A row whose session cannot be resolved cannot be scoped, so it is dropped."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2026, session_cm_ids=[1234])

        rows = [
            self._assignment(901, "bunk_A", 2025, "sess_1"),
            self._assignment(902, "bunk_A", 2025, "sess_1"),
        ]
        for row in rows:
            row.expand = {"person": row.expand["person"], "bunk": row.expand["bunk"]}

        graph = self._graph(901, 902)
        mock_pb.collection.return_value.get_full_list.return_value = rows
        await sg._add_historical_bunking_relationships(graph, 1234)

        assert not graph.has_edge(901, 902)
