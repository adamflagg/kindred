#!/usr/bin/env python3
from __future__ import annotations

"""
Test classmate edge detection in social graph builder.
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import unittest
from unittest.mock import Mock, patch

import networkx as nx

from bunking.graph.social_graph_builder import SocialGraphBuilder


class TestClassmateEdgeDetection(unittest.TestCase):
    """Test classmate edge detection functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_pb = Mock()
        self.builder = SocialGraphBuilder(self.mock_pb)

    def test_add_classmate_edges_same_city(self):
        """Test that campers from same city with similar grades get connected."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes with city data
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)
        self.builder.graph.add_node(3, name="Charlie Brown", grade=5)
        self.builder.graph.add_node(4, name="David Lee", grade=8)  # Different grade

        # Set up person cache with addresses and schools (implementation requires school match)
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            3: {"address": {"city": "New York", "state": "NY"}, "grade": 5, "school": "PS 101"},
            4: {"address": {"city": "Boston", "state": "MA"}, "grade": 8, "school": "Lincoln Elementary"},
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify edges were created based on school match
        self.assertTrue(self.builder.graph.has_edge(1, 2))  # Same school, city, state, grade
        self.assertFalse(self.builder.graph.has_edge(1, 3))  # Different schools/cities
        self.assertFalse(self.builder.graph.has_edge(1, 4))  # Same school but grade diff > 1

        # Check edge attributes
        edge_data = self.builder.graph.get_edge_data(1, 2)
        self.assertEqual(edge_data["edge_type"], "school")
        self.assertEqual(edge_data["weight"], 0.3)
        self.assertEqual(edge_data["metadata"]["school"], "Lincoln Elementary")
        self.assertEqual(edge_data["metadata"]["city"], "Boston")
        self.assertEqual(edge_data["metadata"]["state"], "MA")

    def test_add_classmate_edges_same_state(self):
        """Test that same state alone doesn't create edges - need school match."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=6)  # Grade diff = 1

        # Set up person cache - same state, different cities, different schools
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"address": {"city": "Cambridge", "state": "MA"}, "grade": 6, "school": "Cambridge Academy"},
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify NO edge was created (different schools, different cities)
        self.assertFalse(self.builder.graph.has_edge(1, 2))

    def test_no_duplicate_edges(self):
        """Test that existing edges are not duplicated."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes and existing edge
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)
        self.builder.graph.add_edge(1, 2, edge_type="request", weight=1.0)

        # Set up person cache - same school, city, state (would create edge if not already connected)
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify edge still exists but wasn't replaced
        self.assertTrue(self.builder.graph.has_edge(1, 2))
        edge_data = self.builder.graph.get_edge_data(1, 2)
        self.assertEqual(edge_data["edge_type"], "request")  # Original type preserved
        self.assertEqual(edge_data["weight"], 1.0)  # Original weight preserved

    def test_missing_address_data(self):
        """Test that campers without address data are skipped."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)
        self.builder.graph.add_node(3, name="Charlie Brown", grade=5)

        # Set up person cache - missing address data
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"grade": 5, "school": "Lincoln Elementary"},  # No address
            3: {"address": {}, "grade": 5, "school": "Lincoln Elementary"},  # Empty address
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify no edges were created for nodes without addresses
        self.assertFalse(self.builder.graph.has_edge(1, 2))
        self.assertFalse(self.builder.graph.has_edge(1, 3))

    def test_case_insensitive_location_matching(self):
        """Test that location matching is case-insensitive."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)

        # Set up person cache with different case - include school for match
        self.builder.person_cache = {
            1: {"address": {"city": "BOSTON", "state": "MA"}, "grade": 5, "school": "LINCOLN ELEMENTARY"},
            2: {"address": {"city": "boston", "state": "ma"}, "grade": 5, "school": "lincoln elementary"},
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify edge was created despite case differences
        self.assertTrue(self.builder.graph.has_edge(1, 2))

    def test_grade_difference_boundary(self):
        """Test grade difference boundary conditions."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes with various grade differences
        for i in range(1, 5):
            self.builder.graph.add_node(i, name=f"Student {i}", grade=i + 4)

        # All from same school, city, state
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"address": {"city": "Boston", "state": "MA"}, "grade": 6, "school": "Lincoln Elementary"},  # Diff = 1
            3: {"address": {"city": "Boston", "state": "MA"}, "grade": 7, "school": "Lincoln Elementary"},  # Diff = 2
            4: {"address": {"city": "Boston", "state": "MA"}, "grade": 4, "school": "Lincoln Elementary"},  # Diff = 1
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify edges based on grade differences
        self.assertTrue(self.builder.graph.has_edge(1, 2))  # Grade diff = 1 ✓
        self.assertFalse(self.builder.graph.has_edge(1, 3))  # Grade diff = 2 ✗
        self.assertTrue(self.builder.graph.has_edge(1, 4))  # Grade diff = 1 ✓

    @patch("bunking.graph.social_graph_builder.logger")
    def test_logging_output(self, mock_logger):
        """Test that proper logging occurs."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add multiple nodes
        for i in range(1, 5):
            self.builder.graph.add_node(i, name=f"Student {i}", grade=5)

        # Mix of school matches
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            3: {"address": {"city": "Cambridge", "state": "MA"}, "grade": 5, "school": "Cambridge Elementary"},
            4: {"address": {"city": "New York", "state": "NY"}, "grade": 5, "school": "PS 101"},
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify logging
        mock_logger.info.assert_any_call("Checking for school connections among 4 campers")
        # Should log about finding people with school data
        assert any(
            "Found" in str(call) and "campers with school data" in str(call) for call in mock_logger.info.call_args_list
        )
        # Should log the number of school-based edges added (1 edge between students 1 and 2)
        mock_logger.info.assert_any_call("Added 1 school-based classmate edges")


if __name__ == "__main__":
    unittest.main()
