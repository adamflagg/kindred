#!/usr/bin/env python3
"""
Test suite for the graph cache manager.

Tests caching, invalidation, TTL, and thread safety.
"""

import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import networkx as nx

from bunking.graph.graph_cache_manager import GraphCacheManager


class TestGraphCacheManager(unittest.TestCase):
    """Test graph cache manager functionality."""

    def setUp(self):
        """Set up test fixtures."""
        # Create cache with short TTL for testing
        self.cache = GraphCacheManager(ttl_seconds=2, max_cache_size=5)

        # Create test graphs
        self.graph1 = nx.DiGraph()
        self.graph1.add_nodes_from([1, 2, 3])
        self.graph1.add_edges_from([(1, 2), (2, 3)])

        self.graph2 = nx.DiGraph()
        self.graph2.add_nodes_from([4, 5, 6])
        self.graph2.add_edges_from([(4, 5), (5, 6)])

    def test_basic_caching(self):
        """Test basic cache and retrieve operations."""
        # Cache a session graph
        self.cache.cache_session_graph(12345, 2025, self.graph1)

        # Retrieve it
        cached = self.cache.get_session_graph(12345, 2025)
        self.assertIsNotNone(cached)
        assert cached is not None
        self.assertEqual(cached.number_of_nodes(), 3)
        self.assertEqual(cached.number_of_edges(), 2)

        # Miss on different session
        missed = self.cache.get_session_graph(99999, 2025)
        self.assertIsNone(missed)

        # Check stats
        stats = self.cache.get_stats()
        self.assertEqual(stats["hit_count"], 1)
        self.assertEqual(stats["miss_count"], 1)
        self.assertEqual(stats["cache_size"], 1)

    def test_bunk_caching(self):
        """Test bunk-specific caching."""
        # Cache a bunk graph
        self.cache.cache_bunk_graph(101, 12345, 2025, self.graph2)

        # Retrieve it
        cached = self.cache.get_bunk_graph(101, 12345, 2025)
        self.assertIsNotNone(cached)
        assert cached is not None
        self.assertEqual(cached.number_of_nodes(), 3)

        # Miss on different bunk
        missed = self.cache.get_bunk_graph(999, 12345, 2025)
        self.assertIsNone(missed)

    def test_ttl_expiration(self):
        """Test that cached items expire after TTL."""
        with patch("bunking.graph.graph_cache_manager.time") as mock_time:
            # Initial time
            mock_time.time.return_value = 1000.0

            # Cache with 2 second TTL
            self.cache.cache_session_graph(12345, 2025, self.graph1)

            # Should be available immediately
            cached = self.cache.get_session_graph(12345, 2025)
            self.assertIsNotNone(cached)

            # Advance time past TTL (2.5 seconds later)
            mock_time.time.return_value = 1002.5

            # Should be expired
            expired = self.cache.get_session_graph(12345, 2025)
            self.assertIsNone(expired)

            # Stats should show miss
            stats = self.cache.get_stats()
            self.assertEqual(stats["miss_count"], 1)

    def test_invalidation_by_person(self):
        """Test cache invalidation when a person changes."""
        # Create graphs with specific person
        graph_with_person = nx.DiGraph()
        graph_with_person.add_nodes_from([100, 101, 102])
        graph_with_person.add_edges_from([(100, 101), (101, 102)])

        graph_without_person = nx.DiGraph()
        graph_without_person.add_nodes_from([200, 201])
        graph_without_person.add_edge(200, 201)

        # Cache both
        self.cache.cache_session_graph(1, 2025, graph_with_person)
        self.cache.cache_session_graph(2, 2025, graph_without_person)

        # Invalidate for person 101
        invalidated = self.cache.invalidate_for_person(101)
        self.assertEqual(invalidated, 1)

        # First should be gone, second should remain
        self.assertIsNone(self.cache.get_session_graph(1, 2025))
        self.assertIsNotNone(self.cache.get_session_graph(2, 2025))

    def test_invalidation_by_session(self):
        """Test cache invalidation for entire session."""
        # Cache multiple graphs
        self.cache.cache_session_graph(12345, 2025, self.graph1)
        self.cache.cache_bunk_graph(101, 12345, 2025, self.graph2)
        self.cache.cache_bunk_graph(102, 12345, 2025, self.graph2)
        self.cache.cache_session_graph(99999, 2025, self.graph1)

        # Invalidate session 12345
        invalidated = self.cache.invalidate_session(12345, 2025)
        self.assertEqual(invalidated, 3)  # Session graph + 2 bunk graphs

        # Check what remains
        self.assertIsNone(self.cache.get_session_graph(12345, 2025))
        self.assertIsNone(self.cache.get_bunk_graph(101, 12345, 2025))
        self.assertIsNotNone(self.cache.get_session_graph(99999, 2025))

    def test_lru_eviction(self):
        """Test LRU eviction when cache is full."""
        # Fill cache to capacity (5 items)
        for i in range(5):
            graph = nx.DiGraph()
            graph.add_node(i)
            self.cache.cache_session_graph(i, 2025, graph)

        # Access some to update their access times
        self.cache.get_session_graph(0, 2025)  # Most recently accessed
        self.cache.get_session_graph(2, 2025)

        # Add one more (should evict LRU)
        new_graph = nx.DiGraph()
        new_graph.add_node(99)
        self.cache.cache_session_graph(99, 2025, new_graph)

        # Session 1 should be evicted (not accessed)
        self.assertIsNone(self.cache.get_session_graph(1, 2025))

        # Others should still be there
        self.assertIsNotNone(self.cache.get_session_graph(0, 2025))
        self.assertIsNotNone(self.cache.get_session_graph(99, 2025))

    def test_thread_safety(self):
        """Test concurrent access to cache."""
        errors = []

        def cache_and_retrieve(session_id):
            try:
                # Create unique graph
                graph = nx.DiGraph()
                graph.add_nodes_from(range(session_id * 10, session_id * 10 + 5))

                # Cache it
                self.cache.cache_session_graph(session_id, 2025, graph)

                # Retrieve it multiple times
                for _ in range(10):
                    cached = self.cache.get_session_graph(session_id, 2025)
                    if cached is None or cached.number_of_nodes() != 5:
                        errors.append(f"Session {session_id} retrieval failed")

                # Invalidate sometimes
                if session_id % 3 == 0:
                    self.cache.invalidate_session(session_id, 2025)

            except Exception as e:
                errors.append(f"Session {session_id}: {str(e)}")

        # Run concurrent operations
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(cache_and_retrieve, i) for i in range(20)]
            for future in futures:
                future.result()

        # No errors should occur
        self.assertEqual(len(errors), 0, f"Thread safety errors: {errors}")

    def test_graph_immutability(self):
        """Test that cached graphs cannot be mutated externally."""
        # Cache a graph
        self.cache.cache_session_graph(12345, 2025, self.graph1)

        # Retrieve it
        cached = self.cache.get_session_graph(12345, 2025)
        assert cached is not None

        # Mutate the retrieved graph
        cached.add_node(999)
        cached.add_edge(999, 1)

        # Retrieve again - should be unchanged
        cached_again = self.cache.get_session_graph(12345, 2025)
        assert cached_again is not None
        self.assertNotIn(999, cached_again.nodes())
        self.assertEqual(cached_again.number_of_nodes(), 3)
        self.assertEqual(cached_again.number_of_edges(), 2)

    def test_cleanup_expired(self):
        """Test manual cleanup of expired entries."""
        with patch("bunking.graph.graph_cache_manager.time") as mock_time:
            # Initial time
            mock_time.time.return_value = 1000.0

            # Cache multiple items
            for i in range(5):
                graph = nx.DiGraph()
                graph.add_node(i)
                self.cache.cache_session_graph(i, 2025, graph)

            # No expired yet
            removed = self.cache.cleanup_expired()
            self.assertEqual(removed, 0)

            # Advance time past TTL (2.5 seconds later)
            mock_time.time.return_value = 1002.5

            # Clean up
            removed = self.cache.cleanup_expired()
            self.assertEqual(removed, 5)

            # Cache should be empty
            stats = self.cache.get_stats()
            self.assertEqual(stats["cache_size"], 0)

    def test_clear_cache(self):
        """Test clearing entire cache."""
        # Add multiple items
        self.cache.cache_session_graph(1, 2025, self.graph1)
        self.cache.cache_bunk_graph(101, 1, 2025, self.graph2)
        self.cache.cache_session_graph(2, 2025, self.graph1)

        # Clear
        self.cache.clear()

        # Everything should be gone
        self.assertIsNone(self.cache.get_session_graph(1, 2025))
        self.assertIsNone(self.cache.get_bunk_graph(101, 1, 2025))
        self.assertIsNone(self.cache.get_session_graph(2, 2025))

        stats = self.cache.get_stats()
        self.assertEqual(stats["cache_size"], 0)


if __name__ == "__main__":
    unittest.main()
