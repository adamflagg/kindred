"""Test NetworkX friend group detection integration"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock

import pytest

# Import the modules we're testing
from bunking.graph.social_graph_builder import SocialGraphBuilder


class TestSocialGraphBuilder:
    """Test the NetworkX social graph builder"""

    @pytest.fixture
    def mock_pb(self):
        """Create mock PocketBase client"""
        return MagicMock()

    @pytest.fixture
    def builder(self, mock_pb):
        """Create SocialGraphBuilder instance"""
        return SocialGraphBuilder(mock_pb)

    def test_init(self, builder, mock_pb):
        """Test builder initialization"""
        assert builder.pb == mock_pb
        assert builder.graph is not None
        assert builder.graph.number_of_nodes() == 0
        assert builder.current_year == datetime.now().year
        assert isinstance(builder.person_cache, dict)
        assert isinstance(builder.attendee_cache, dict)

    def test_build_graph_from_empty_requests(self, builder):
        """Test building graph with no requests"""
        # Mock empty attendees response
        builder.pb.collection.return_value.get_full_list.return_value = []

        graph = builder.build_session_graph(2025, 12345)

        assert graph.number_of_nodes() == 0
        assert graph.number_of_edges() == 0

    def test_detect_friend_groups_empty_graph(self, builder):
        """Test detection on empty graph"""
        detections = builder.detect_friend_groups()

        assert len(detections) == 0

    def test_detect_via_communities_simple(self, builder):
        """Test Louvain community detection with simple graph"""
        # Build a simple graph with two communities
        builder.graph.add_edge(1, 2, weight=1.0)
        builder.graph.add_edge(2, 3, weight=1.0)
        builder.graph.add_edge(3, 1, weight=1.0)  # Triangle 1-2-3

        builder.graph.add_edge(4, 5, weight=1.0)
        builder.graph.add_edge(5, 6, weight=1.0)
        builder.graph.add_edge(6, 4, weight=1.0)  # Triangle 4-5-6

        # Weak connection between communities
        builder.graph.add_edge(3, 4, weight=0.1)

        groups = builder._detect_via_communities(min_size=3, max_size=8)

        # Should detect two communities
        assert len(groups) >= 1  # At least one community
        assert all(len(g) >= 3 for g in groups)  # All meet min size

    def test_analyze_group_cohesion(self, builder):
        """Test group analysis and cohesion calculation"""
        # Create a complete graph (clique)
        members = {1, 2, 3, 4}
        for i in members:
            for j in members:
                if i < j:
                    builder.graph.add_edge(i, j, weight=1.0)

        detection = builder._analyze_group(members, ignore_threshold=0.5, manual_threshold=0.7, auto_threshold=0.9)

        assert detection is not None
        assert detection.cohesion_score == 1.0  # Complete graph
        assert detection.detection_method == "clique"
        assert detection.recommendation == "natural_group"
        assert len(detection.missing_connections) == 0

    def test_analyze_group_below_threshold(self, builder):
        """Test group that doesn't meet threshold"""
        # Create a sparse group
        members = {1, 2, 3, 4}
        builder.graph.add_edge(1, 2, weight=1.0)
        builder.graph.add_edge(3, 4, weight=1.0)
        # Only 2 edges out of 6 possible = 0.33 cohesion

        detection = builder._analyze_group(
            members,
            ignore_threshold=0.5,  # Will be below this
            manual_threshold=0.7,
            auto_threshold=0.9,
        )

        assert detection is None  # Below ignore threshold


class TestNetworkXIntegration:
    """Integration tests for NetworkX with sync process"""

    def test_networkx_import(self):
        """Test that NetworkX can be imported"""
        import networkx as nx

        assert nx is not None
        assert hasattr(nx, "Graph")
        assert hasattr(nx, "find_cliques")

    def test_louvain_import(self):
        """Test that python-louvain can be imported"""
        import community as community_louvain

        assert community_louvain is not None
        assert hasattr(community_louvain, "best_partition")

    def test_large_graph_performance(self):
        """Test performance with larger graphs"""
        import time

        import networkx as nx

        # Create a graph with 100 nodes and ~500 edges
        graph = nx.erdos_renyi_graph(100, 0.1)

        start_time = time.time()

        # Test that community detection completes quickly
        import community as community_louvain

        partition = community_louvain.best_partition(graph)

        elapsed = time.time() - start_time

        # Should complete in under 1 second for this size
        assert elapsed < 1.0
        assert len(partition) == 100  # All nodes assigned to communities

    def test_reproducibility_with_seed(self):
        """Test that same seed produces same results"""
        import community as community_louvain
        import networkx as nx

        # Create a test graph
        graph = nx.karate_club_graph()

        # Run with same seed multiple times
        seed = 42
        results = []
        for _ in range(3):
            partition = community_louvain.best_partition(graph, random_state=seed)
            results.append(partition)

        # All results should be identical
        for i in range(1, len(results)):
            assert results[i] == results[0], "Same seed should produce same results"

        # Test Kernighan-Lin reproducibility
        part1_results = []
        part2_results = []
        for _ in range(3):
            part1, part2 = nx.algorithms.community.kernighan_lin_bisection(graph, seed=seed)
            part1_results.append(sorted(list(part1)))
            part2_results.append(sorted(list(part2)))

        # All results should be identical
        for i in range(1, len(part1_results)):
            assert part1_results[i] == part1_results[0], "Same seed should produce same partition"
            assert part2_results[i] == part2_results[0], "Same seed should produce same partition"
