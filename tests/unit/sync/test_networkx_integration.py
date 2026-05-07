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


class TestNetworkXIntegration:
    """Integration tests for NetworkX with sync process"""

    def test_networkx_import(self):
        """Test that NetworkX can be imported"""
        import networkx as nx

        assert nx is not None
        assert hasattr(nx, "Graph")
        assert hasattr(nx, "find_cliques")

    def test_reproducibility_with_seed(self):
        """Test that Kernighan-Lin partitioning is reproducible with the same seed."""
        import networkx as nx

        # Create a test graph
        graph = nx.karate_club_graph()

        seed = 42
        part1_results = []
        part2_results = []
        for _ in range(3):
            part1, part2 = nx.algorithms.community.kernighan_lin_bisection(graph, seed=seed)
            part1_results.append(sorted(part1))
            part2_results.append(sorted(part2))

        # All results should be identical
        for i in range(1, len(part1_results)):
            assert part1_results[i] == part1_results[0], "Same seed should produce same partition"
            assert part2_results[i] == part2_results[0], "Same seed should produce same partition"
