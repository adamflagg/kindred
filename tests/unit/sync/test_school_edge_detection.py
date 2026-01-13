from __future__ import annotations

#!/usr/bin/env python3
"""
Test school edge detection in social graph builder.
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import unittest
from unittest.mock import Mock, patch

import networkx as nx

from bunking.graph.social_graph_builder import SocialGraphBuilder


class TestSchoolEdgeDetection(unittest.TestCase):
    """Test school edge detection functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_pb = Mock()
        self.builder = SocialGraphBuilder(self.mock_pb)

    def test_add_school_edges_all_fields_match(self):
        """Test that campers from same school, city, and state with similar grades get connected."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes with school data
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)
        self.builder.graph.add_node(3, name="Charlie Brown", grade=5)
        self.builder.graph.add_node(4, name="David Lee", grade=8)  # Different grade
        self.builder.graph.add_node(5, name="Eve Wilson", grade=5)  # Same school but different city

        # Set up person cache with addresses and schools
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            3: {"address": {"city": "New York", "state": "NY"}, "grade": 5, "school": "PS 101"},
            4: {"address": {"city": "Boston", "state": "MA"}, "grade": 8, "school": "Lincoln Elementary"},
            5: {"address": {"city": "Cambridge", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify edges were created
        self.assertTrue(self.builder.graph.has_edge(1, 2))  # Same school, city, state, grade
        self.assertFalse(self.builder.graph.has_edge(1, 3))  # Different schools
        self.assertFalse(self.builder.graph.has_edge(1, 4))  # Same school but grade diff > 1
        self.assertFalse(self.builder.graph.has_edge(1, 5))  # Same school but different city

        # Check edge attributes
        edge_data = self.builder.graph.get_edge_data(1, 2)
        self.assertEqual(edge_data["edge_type"], "school")
        self.assertEqual(edge_data["weight"], 0.3)
        self.assertEqual(edge_data["metadata"]["school"], "Lincoln Elementary")
        self.assertEqual(edge_data["metadata"]["city"], "Boston")
        self.assertEqual(edge_data["metadata"]["state"], "MA")

    def test_requires_all_fields(self):
        """Test that school edges require school, city, AND state to match."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)
        self.builder.graph.add_node(3, name="Charlie Brown", grade=5)

        # Set up person cache - various missing fields
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": ""},  # Empty school
            3: {"address": {"city": "Boston", "state": ""}, "grade": 5, "school": "Lincoln Elementary"},  # Empty state
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify no edges were created due to missing data
        self.assertFalse(self.builder.graph.has_edge(1, 2))  # Missing school
        self.assertFalse(self.builder.graph.has_edge(1, 3))  # Missing state

    def test_no_duplicate_edges(self):
        """Test that existing edges are not duplicated."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes and existing edge
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)
        self.builder.graph.add_edge(1, 2, edge_type="request", weight=1.0)

        # Set up person cache
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

    def test_missing_data(self):
        """Test that campers without complete data are skipped."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)
        self.builder.graph.add_node(3, name="Charlie Brown", grade=5)
        self.builder.graph.add_node(4, name="David Lee", grade=5)

        # Set up person cache - missing required data
        self.builder.person_cache = {
            1: {"address": {"city": "Boston", "state": "MA"}, "grade": 5, "school": "Lincoln Elementary"},
            2: {"grade": 5, "school": "Lincoln Elementary"},  # No address
            3: {"address": {}, "grade": 5, "school": "Lincoln Elementary"},  # Empty address
            4: {"address": {"city": "Boston", "state": "MA"}, "grade": 5},  # No school
        }

        # Call the method
        self.builder._add_classmate_edges(2025, 1234)

        # Verify no edges were created for nodes without complete data
        self.assertFalse(self.builder.graph.has_edge(1, 2))  # No address
        self.assertFalse(self.builder.graph.has_edge(1, 3))  # Empty address
        self.assertFalse(self.builder.graph.has_edge(1, 4))  # No school

    def test_case_insensitive_matching(self):
        """Test that school/location matching is case-insensitive."""
        # Set up mock data
        self.builder.graph = nx.Graph()

        # Add nodes
        self.builder.graph.add_node(1, name="Alice Smith", grade=5)
        self.builder.graph.add_node(2, name="Bob Jones", grade=5)

        # Set up person cache with different case
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

        # All from same school and location
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

        # Mix of different schools and locations
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
        mock_logger.info.assert_any_call("Found 4 campers with school data")
        mock_logger.info.assert_any_call("Added 1 school-based classmate edges")


if __name__ == "__main__":
    unittest.main()
