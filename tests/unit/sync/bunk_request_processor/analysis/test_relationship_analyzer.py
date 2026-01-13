"""Test-Driven Development for RelationshipAnalyzer

Tests analyzing social connections to disambiguate names during resolution."""

import sys
from pathlib import Path
from unittest.mock import Mock

import networkx as nx
import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.analysis.relationship_analyzer import (
    RelationshipAnalyzer,
    RelationshipContext,
)
from bunking.sync.bunk_request_processor.core.models import Person


class TestRelationshipAnalyzer:
    """Test the RelationshipAnalyzer"""

    @pytest.fixture
    def mock_social_graph(self):
        """Create mock SocialGraph"""
        mock_graph = Mock()
        mock_graph.graphs = {}  # Will be populated by tests
        return mock_graph

    @pytest.fixture
    def analyzer(self, mock_social_graph):
        """Create a RelationshipAnalyzer with mocked dependencies"""
        return RelationshipAnalyzer(social_graph=mock_social_graph)

    def setup_mock_graphs(self, mock_social_graph, session_cm_id, graph):
        """Setup the mock social graph with a test graph for a session.

        Also mocks _get_shortest_path_length to use the actual graph.
        """
        mock_social_graph.graphs[session_cm_id] = graph

        # Mock _get_shortest_path_length to use actual NetworkX path calculation
        def get_path_length(source, target, sess_id):
            g = mock_social_graph.graphs.get(sess_id)
            if g is None or source not in g or target not in g:
                return float("inf")
            try:
                return nx.shortest_path_length(g, source, target)
            except nx.NetworkXNoPath:
                return float("inf")

        mock_social_graph._get_shortest_path_length.side_effect = get_path_length

    @pytest.fixture
    def sample_graph(self):
        """Create a sample social graph for testing"""
        graph = nx.Graph()

        # Add people with names
        graph.add_node(100, name="John Smith")
        graph.add_node(101, name="Jane Smith")  # John's sibling
        graph.add_node(102, name="Mike Johnson")  # John's classmate
        graph.add_node(103, name="Sarah Williams")  # John's bunkmate
        graph.add_node(200, name="John Smith")  # Different John Smith
        graph.add_node(201, name="Tom Brown")  # Second John's classmate

        # Add relationships
        graph.add_edge(100, 101, type="sibling", weight=3.0)
        graph.add_edge(100, 102, type="classmate", weight=1.5)
        graph.add_edge(100, 103, type="bunkmate", weight=2.0)
        graph.add_edge(200, 201, type="classmate", weight=1.5)

        return graph

    def test_analyze_basic_disambiguation(self, analyzer, mock_social_graph, sample_graph):
        """Test basic name disambiguation using relationships"""
        self.setup_mock_graphs(mock_social_graph, 1000002, sample_graph)

        # Requester is Mike Johnson (102), looking for "John Smith"
        requester = Person(cm_id=102, first_name="Mike", last_name="Johnson", session_cm_id=1000002)

        # Two candidates named John Smith
        candidates = [
            Person(cm_id=100, first_name="John", last_name="Smith"),
            Person(cm_id=200, first_name="John", last_name="Smith"),
        ]

        context = analyzer.analyze_relationships(requester=requester, candidates=candidates, session_cm_id=1000002)

        # Should identify that requester knows first John Smith as classmate
        assert context.requester_cm_id == 102
        assert len(context.candidate_relationships) == 2

        # First John should have classmate relationship
        assert context.candidate_relationships[100].is_classmate is True
        assert context.candidate_relationships[100].is_sibling is False
        assert context.candidate_relationships[100].is_bunkmate is False
        # relationship_distance is NetworkX hop count (1 for direct neighbors)
        assert context.candidate_relationships[100].relationship_distance == 1.0

        # Second John should have no direct relationship
        assert context.candidate_relationships[200].is_classmate is False
        assert context.candidate_relationships[200].relationship_distance == float("inf")

    def test_analyze_multiple_relationships(self, analyzer, mock_social_graph):
        """Test when requester has multiple relationship types with candidate"""
        graph = nx.Graph()

        # Siblings who are also bunkmates
        graph.add_node(100, name="Alice Johnson")
        graph.add_node(101, name="Bob Johnson")

        graph.add_edge(100, 101, type="sibling", weight=3.0, is_classmate=True)

        self.setup_mock_graphs(mock_social_graph, 1000002, graph)

        requester = Person(cm_id=100, first_name="Alice", last_name="Johnson")
        candidates = [Person(cm_id=101, first_name="Bob", last_name="Johnson")]

        context = analyzer.analyze_relationships(requester, candidates, 1000002)

        # Should detect both sibling and classmate relationships
        rel = context.candidate_relationships[101]
        assert rel.is_sibling is True
        assert rel.is_classmate is True  # Set via edge attribute
        assert rel.connection_strength == 3.0  # Sibling weight

    def test_analyze_indirect_relationships(self, analyzer, mock_social_graph):
        """Test finding indirect relationships through mutual connections"""
        graph = nx.Graph()

        # A -> B -> C (A and C connected through B)
        graph.add_node(100, name="Person A")
        graph.add_node(101, name="Person B")
        graph.add_node(102, name="Person C")

        graph.add_edge(100, 101, type="classmate", weight=1.5)
        graph.add_edge(101, 102, type="bunkmate", weight=2.0)

        self.setup_mock_graphs(mock_social_graph, 1000002, graph)

        requester = Person(cm_id=100, first_name="Person", last_name="A")
        candidates = [Person(cm_id=102, first_name="Person", last_name="C")]

        context = analyzer.analyze_relationships(requester, candidates, 1000002)

        # Should find indirect path
        rel = context.candidate_relationships[102]
        assert rel.relationship_distance > 0  # Has a path
        assert rel.relationship_distance < float("inf")
        assert rel.mutual_connections == {101}  # B is mutual connection

    def test_analyze_no_relationships(self, analyzer, mock_social_graph):
        """Test when there are no relationships between requester and candidates"""
        graph = nx.Graph()

        # Isolated nodes
        graph.add_node(100, name="Person A")
        graph.add_node(200, name="Person B")

        self.setup_mock_graphs(mock_social_graph, 1000002, graph)

        requester = Person(cm_id=100, first_name="Person", last_name="A")
        candidates = [Person(cm_id=200, first_name="Person", last_name="B")]

        context = analyzer.analyze_relationships(requester, candidates, 1000002)

        rel = context.candidate_relationships[200]
        assert rel.is_sibling is False
        assert rel.is_classmate is False
        assert rel.is_bunkmate is False
        assert rel.relationship_distance == float("inf")
        assert rel.connection_strength == 0.0
        assert len(rel.mutual_connections) == 0

    def test_get_confidence_boost_strong_relationship(self, analyzer):
        """Test confidence boost calculation for strong relationships"""
        context = RelationshipContext(
            requester_cm_id=100,
            candidate_relationships={
                101: Mock(
                    is_sibling=True,
                    is_classmate=False,
                    is_bunkmate=False,
                    connection_strength=3.0,
                    relationship_distance=0.333,
                )
            },
        )

        # Sibling relationship should give high boost
        boost = analyzer.get_confidence_boost(context, 101)
        assert boost > 0.2  # Significant boost
        assert boost <= 0.3  # But not too high

    def test_get_confidence_boost_weak_relationship(self, analyzer):
        """Test confidence boost calculation for weak relationships"""
        context = RelationshipContext(
            requester_cm_id=100,
            candidate_relationships={
                101: Mock(
                    is_sibling=False,
                    is_classmate=True,
                    is_bunkmate=False,
                    connection_strength=1.5,
                    relationship_distance=0.667,
                )
            },
        )

        # Classmate relationship should give moderate boost
        boost = analyzer.get_confidence_boost(context, 101)
        assert boost > 0.05  # Some boost
        assert boost < 0.2  # But not as high as sibling

    def test_get_confidence_boost_no_relationship(self, analyzer):
        """Test confidence boost when no relationship exists"""
        context = RelationshipContext(
            requester_cm_id=100,
            candidate_relationships={
                101: Mock(
                    is_sibling=False,
                    is_classmate=False,
                    is_bunkmate=False,
                    connection_strength=0.0,
                    relationship_distance=float("inf"),
                )
            },
        )

        # No relationship should give no boost
        boost = analyzer.get_confidence_boost(context, 101)
        assert boost == 0.0

    def test_get_confidence_boost_unknown_candidate(self, analyzer):
        """Test confidence boost for candidate not in context"""
        context = RelationshipContext(requester_cm_id=100, candidate_relationships={})

        # Unknown candidate should get no boost
        boost = analyzer.get_confidence_boost(context, 999)
        assert boost == 0.0

    def test_analyze_with_empty_candidates(self, analyzer, mock_social_graph):
        """Test analyzing with no candidates"""
        graph = nx.Graph()
        self.setup_mock_graphs(mock_social_graph, 1000002, graph)

        requester = Person(cm_id=100, first_name="Test", last_name="User")
        candidates: list[Person] = []

        context = analyzer.analyze_relationships(requester, candidates, 1000002)

        assert context.requester_cm_id == 100
        assert len(context.candidate_relationships) == 0

    def test_analyze_requester_not_in_graph(self, analyzer, mock_social_graph):
        """Test when requester is not in the social graph"""
        graph = nx.Graph()
        graph.add_node(200, name="Other Person")

        self.setup_mock_graphs(mock_social_graph, 1000002, graph)

        requester = Person(cm_id=100, first_name="New", last_name="Person")
        candidates = [Person(cm_id=200, first_name="Other", last_name="Person")]

        context = analyzer.analyze_relationships(requester, candidates, 1000002)

        # Should handle gracefully
        assert context.requester_cm_id == 100
        rel = context.candidate_relationships[200]
        assert rel.relationship_distance == float("inf")

    def test_describe_relationship(self, analyzer):
        """Test generating human-readable relationship descriptions"""
        context = RelationshipContext(
            requester_cm_id=100,
            candidate_relationships={
                101: Mock(
                    is_sibling=True,
                    is_classmate=True,
                    is_bunkmate=False,
                    connection_strength=3.0,
                    relationship_distance=0.333,
                    mutual_connections={102, 103},
                ),
                200: Mock(
                    is_sibling=False,
                    is_classmate=False,
                    is_bunkmate=True,
                    connection_strength=2.0,
                    relationship_distance=0.5,
                    mutual_connections=set(),
                ),
                300: Mock(
                    is_sibling=False,
                    is_classmate=False,
                    is_bunkmate=False,
                    connection_strength=0.0,
                    relationship_distance=float("inf"),
                    mutual_connections=set(),
                ),
            },
        )

        # Sibling and classmate
        desc = analyzer.describe_relationship(context, 101)
        assert "sibling" in desc.lower()
        assert "classmate" in desc.lower()
        assert "2 mutual" in desc.lower()

        # Just bunkmate
        desc = analyzer.describe_relationship(context, 200)
        assert "bunkmate" in desc.lower()
        assert "mutual" not in desc.lower()

        # No relationship
        desc = analyzer.describe_relationship(context, 300)
        assert "no known relationship" in desc.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
