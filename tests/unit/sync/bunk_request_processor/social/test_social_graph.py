"""Tests for SocialGraph core functionality.

Tests cover:
- RelationshipType enum and weights
- FriendGroup dataclass
- Graph initialization and building
- Metrics calculation
- Social signals calculation
- Ego network and shortest path caching
- Friend group detection
- Isolated camper detection
"""

from __future__ import annotations

from typing import Any
from unittest.mock import Mock

import networkx as nx
import pytest

from bunking.sync.bunk_request_processor.core.models import Person
from bunking.sync.bunk_request_processor.social.social_graph import (
    RELATIONSHIP_WEIGHTS,
    FriendGroup,
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


class TestFriendGroup:
    """Tests for FriendGroup dataclass."""

    def test_friend_group_creation(self):
        """FriendGroup can be created with required fields."""
        members = {1, 2, 3, 4}
        group = FriendGroup(members=members, density=0.8, cohesion=0.6)

        assert group.members == members
        assert group.density == 0.8
        assert group.cohesion == 0.6
        assert group.size == 4

    def test_friend_group_id_generation(self):
        """FriendGroup ID is based on min member ID and size."""
        members = {5, 10, 15}
        group = FriendGroup(members=members, density=0.5, cohesion=0.5)

        assert group.id == "group_5_3"

    def test_friend_group_repr(self):
        """FriendGroup repr shows size and density."""
        group = FriendGroup(members={1, 2, 3}, density=0.75, cohesion=0.5)
        assert "size=3" in repr(group)
        assert "density=0.75" in repr(group)

    def test_friend_group_single_member(self):
        """FriendGroup handles single member set."""
        group = FriendGroup(members={1}, density=0.0, cohesion=0.0)
        assert group.size == 1
        assert group.id == "group_1_1"


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
        assert graph._friend_groups == {}
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


class TestFriendGroupDetection:
    """Tests for friend group detection."""

    def test_detect_groups_not_initialized(self):
        """Raises error if graph not initialized."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        with pytest.raises(RuntimeError, match="not initialized"):
            sg.detect_friend_groups(1234)

    def test_detect_groups_no_graph(self):
        """Returns empty list if no graph for session."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        sg._initialized = True

        groups = sg.detect_friend_groups(9999)

        assert groups == []

    def test_detect_groups_by_cliques_fallback(self):
        """Clique-based detection works as fallback."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])
        sg._initialized = True

        # Create a graph with a clear clique
        G = nx.Graph()
        G.add_edges_from([(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)])  # Clique of 4
        sg.graphs[1234] = G

        groups = sg._detect_groups_by_cliques(G, min_size=3, max_size=5)

        assert len(groups) >= 1
        # Should find the 4-node clique
        sizes = [g.size for g in groups]
        assert 4 in sizes

    def test_detect_groups_caches_result(self):
        """Friend groups are cached per session."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])
        sg._initialized = True

        # Create a graph with a clique so there's something to cache
        G = nx.Graph()
        G.add_edges_from([(1, 2), (1, 3), (2, 3)])
        sg.graphs[1234] = G

        # First call
        sg.detect_friend_groups(1234, min_size=3, max_size=5)
        # Check cache
        assert 1234 in sg._friend_groups


class TestIsolatedCamperDetection:
    """Tests for finding isolated campers."""

    def test_find_isolated_not_initialized(self):
        """Raises error if graph not initialized."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)

        with pytest.raises(RuntimeError, match="not initialized"):
            sg.find_isolated_campers(1234)

    def test_find_isolated_no_graph(self):
        """Returns empty list if no graph for session."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        sg._initialized = True

        isolated = sg.find_isolated_campers(9999)

        assert isolated == []

    def test_find_isolated_with_threshold(self):
        """Finds campers with connections <= threshold."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])
        sg._initialized = True

        G = nx.Graph()
        G.add_node(1)  # No connections
        G.add_edge(2, 3)  # 2 and 3 have 1 connection each
        G.add_edges_from([(4, 5), (4, 6), (4, 7)])  # 4 has 3 connections
        sg.graphs[1234] = G

        # threshold=0: only truly isolated
        isolated_0 = sg.find_isolated_campers(1234, threshold=0)
        assert 1 in isolated_0
        assert 2 not in isolated_0

        # threshold=1: nodes with 0 or 1 connection
        isolated_1 = sg.find_isolated_campers(1234, threshold=1)
        assert 1 in isolated_1
        assert 2 in isolated_1
        assert 3 in isolated_1
        assert 4 not in isolated_1


class TestCalculateCohesion:
    """Tests for group cohesion calculation."""

    def test_cohesion_empty_graph(self):
        """Empty graph has zero cohesion."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        G = nx.Graph()

        cohesion = sg._calculate_cohesion(G)

        assert cohesion == 0.0

    def test_cohesion_single_node(self):
        """Single node graph has zero cohesion."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        G = nx.Graph()
        G.add_node(1)

        cohesion = sg._calculate_cohesion(G)

        assert cohesion == 0.0

    def test_cohesion_complete_graph(self):
        """Complete graph with weight 1.0 has high cohesion."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        G = nx.complete_graph(4)
        # Add weights
        for u, v in G.edges():
            G[u][v]["weight"] = 1.0

        cohesion = sg._calculate_cohesion(G)

        assert cohesion == 1.0


class TestGetGraphMetrics:
    """Tests for get_graph_metrics method."""

    def test_returns_copy_of_stats(self):
        """Returns a copy, not the original dict."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025)
        sg._stats = {"test": 123}  # type: ignore[dict-item]

        metrics = sg.get_graph_metrics()

        assert metrics == {"test": 123}  # type: ignore[comparison-overlap]
        assert metrics is not sg._stats


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


class TestDetectGroupsWithLouvain:
    """Tests for friend group detection with Louvain fallback."""

    def test_detect_groups_uses_cliques_on_import_error(self):
        """Falls back to cliques when community module unavailable."""
        mock_pb = Mock()
        sg = SocialGraph(pb=mock_pb, year=2025, session_cm_ids=[1234])
        sg._initialized = True

        G = nx.Graph()
        G.add_edges_from(
            [
                (1, 2),
                (1, 3),
                (2, 3),  # Triangle
                (4, 5),
                (4, 6),
                (5, 6),  # Another triangle
            ]
        )
        sg.graphs[1234] = G

        # This will use clique detection (either Louvain or fallback)
        groups = sg.detect_friend_groups(1234, min_size=3, max_size=5)

        # Should find triangles
        assert len(groups) >= 1


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
