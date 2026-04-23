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
        assert cached is not None
        assert cached is not None
        assert cached.number_of_nodes() == 3
        assert cached.number_of_edges() == 2

        # Miss on different session
        missed = self.cache.get_session_graph(99999, 2025)
        assert missed is None

        # Check stats
        stats = self.cache.get_stats()
        assert stats["hit_count"] == 1
        assert stats["miss_count"] == 1
        assert stats["cache_size"] == 1

    def test_bunk_caching(self):
        """Test bunk-specific caching."""
        # Cache a bunk graph
        self.cache.cache_bunk_graph(101, 12345, 2025, self.graph2)

        # Retrieve it
        cached = self.cache.get_bunk_graph(101, 12345, 2025)
        assert cached is not None
        assert cached is not None
        assert cached.number_of_nodes() == 3

        # Miss on different bunk
        missed = self.cache.get_bunk_graph(999, 12345, 2025)
        assert missed is None

    def test_ttl_expiration(self):
        """Test that cached items expire after TTL."""
        with patch("bunking.graph.graph_cache_manager.time") as mock_time:
            # Initial time
            mock_time.time.return_value = 1000.0

            # Cache with 2 second TTL
            self.cache.cache_session_graph(12345, 2025, self.graph1)

            # Should be available immediately
            cached = self.cache.get_session_graph(12345, 2025)
            assert cached is not None

            # Advance time past TTL (2.5 seconds later)
            mock_time.time.return_value = 1002.5

            # Should be expired
            expired = self.cache.get_session_graph(12345, 2025)
            assert expired is None

            # Stats should show miss
            stats = self.cache.get_stats()
            assert stats["miss_count"] == 1

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
        assert invalidated == 1

        # First should be gone, second should remain
        assert self.cache.get_session_graph(1, 2025) is None
        assert self.cache.get_session_graph(2, 2025) is not None

    def test_invalidation_by_session(self):
        """Test cache invalidation for entire session."""
        # Cache multiple graphs
        self.cache.cache_session_graph(12345, 2025, self.graph1)
        self.cache.cache_bunk_graph(101, 12345, 2025, self.graph2)
        self.cache.cache_bunk_graph(102, 12345, 2025, self.graph2)
        self.cache.cache_session_graph(99999, 2025, self.graph1)

        # Invalidate session 12345
        invalidated = self.cache.invalidate_session(12345, 2025)
        assert invalidated == 3  # Session graph + 2 bunk graphs

        # Check what remains
        assert self.cache.get_session_graph(12345, 2025) is None
        assert self.cache.get_bunk_graph(101, 12345, 2025) is None
        assert self.cache.get_session_graph(99999, 2025) is not None

    def test_invalidate_session_does_not_match_bunk_when_year_appears_as_session_id(self):
        """Regression: invalidate_session must not falsely match a bunk cache
        key whose real session_cm_id equals the year.

        Bunk cache key format: ``bunk_{bunk_cm_id}_{session_cm_id}_{year}_{slug}``.
        Before the fix, ``invalidate_session`` used the broad substring match
        ``f"_{session_cm_id}_{year}" in key``. For ``invalidate_session(5, 2025)``
        the target substring is ``_5_2025`` — which also appears inside the key
        ``bunk_5_2025_2025_prod`` (bunk cm_id 5, session cm_id 2025, year 2025)
        and caused a false invalidation. After the fix we parse session and
        year positionally so this no longer matches.
        """
        # Session 5, year 2025 – target of invalidation.
        self.cache.cache_session_graph(5, 2025, self.graph1)
        # Bunk cm_id 5 that belongs to session 2025 (rare but legal: a camp
        # could reuse numeric ids across table namespaces). Key has the
        # substring ``_5_2025`` even though the real session is 2025.
        self.cache.cache_bunk_graph(5, 2025, 2025, self.graph2)
        # Bunk that really belongs to session 5 – must be invalidated.
        self.cache.cache_bunk_graph(50, 5, 2025, self.graph2)

        invalidated = self.cache.invalidate_session(5, 2025)

        # Session_5_2025_prod + bunk_50_5_2025_prod = 2
        assert invalidated == 2
        assert self.cache.get_session_graph(5, 2025) is None
        assert self.cache.get_bunk_graph(50, 5, 2025) is None
        # The cross-session bunk must survive
        assert self.cache.get_bunk_graph(5, 2025, 2025) is not None

    def test_invalidate_session_matches_scenario_bunks(self):
        """Scenario-slug bunks for the target session must still be invalidated."""
        # Session 12, year 2025
        self.cache.cache_session_graph(12, 2025, self.graph1)
        # Scenario bunks for session 12 – must be invalidated
        self.cache.cache_bunk_graph(11, 12, 2025, self.graph2, scenario_id="s1")
        self.cache.cache_bunk_graph(12, 12, 2025, self.graph2, scenario_id="s2")
        # Bunk in a different session – must survive
        self.cache.cache_bunk_graph(11, 99, 2025, self.graph2)

        invalidated = self.cache.invalidate_session(12, 2025)

        assert invalidated == 3
        assert self.cache.get_bunk_graph(11, 12, 2025, scenario_id="s1") is None
        assert self.cache.get_bunk_graph(12, 12, 2025, scenario_id="s2") is None
        assert self.cache.get_bunk_graph(11, 99, 2025) is not None

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
        assert self.cache.get_session_graph(1, 2025) is None

        # Others should still be there
        assert self.cache.get_session_graph(0, 2025) is not None
        assert self.cache.get_session_graph(99, 2025) is not None

    def test_thread_safety(self):
        """Test concurrent access to cache."""
        # Use larger cache for thread safety test to avoid LRU eviction interference
        thread_cache = GraphCacheManager(ttl_seconds=10, max_cache_size=30)
        errors = []

        def cache_and_retrieve(session_id):
            try:
                # Create unique graph
                graph = nx.DiGraph()
                graph.add_nodes_from(range(session_id * 10, session_id * 10 + 5))

                # Cache it
                thread_cache.cache_session_graph(session_id, 2025, graph)

                # Retrieve it multiple times
                for _ in range(10):
                    cached = thread_cache.get_session_graph(session_id, 2025)
                    # Only check if not invalidated
                    if session_id % 3 != 0:
                        if cached is None or cached.number_of_nodes() != 5:
                            errors.append(f"Session {session_id} retrieval failed")

                # Invalidate sometimes
                if session_id % 3 == 0:
                    thread_cache.invalidate_session(session_id, 2025)

            except Exception as e:
                errors.append(f"Session {session_id}: {e!s}")

        # Run concurrent operations
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(cache_and_retrieve, i) for i in range(20)]
            for future in futures:
                future.result()

        # No errors should occur
        assert len(errors) == 0, f"Thread safety errors: {errors}"

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
        assert 999 not in cached_again.nodes()
        assert cached_again.number_of_nodes() == 3
        assert cached_again.number_of_edges() == 2

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
            assert removed == 0

            # Advance time past TTL (2.5 seconds later)
            mock_time.time.return_value = 1002.5

            # Clean up
            removed = self.cache.cleanup_expired()
            assert removed == 5

            # Cache should be empty
            stats = self.cache.get_stats()
            assert stats["cache_size"] == 0

    def test_clear_cache(self):
        """Test clearing entire cache."""
        # Add multiple items
        self.cache.cache_session_graph(1, 2025, self.graph1)
        self.cache.cache_bunk_graph(101, 1, 2025, self.graph2)
        self.cache.cache_session_graph(2, 2025, self.graph1)

        # Clear
        self.cache.clear()

        # Everything should be gone
        assert self.cache.get_session_graph(1, 2025) is None
        assert self.cache.get_bunk_graph(101, 1, 2025) is None
        assert self.cache.get_session_graph(2, 2025) is None

        stats = self.cache.get_stats()
        assert stats["cache_size"] == 0


class TestGraphCacheManagerScenario(unittest.TestCase):
    """Test scenario-aware caching — production and scenario graphs must not collide."""

    def setUp(self):
        self.cache = GraphCacheManager(ttl_seconds=60, max_cache_size=10)

        self.prod_graph = nx.DiGraph()
        self.prod_graph.add_nodes_from([1, 2, 3])
        self.prod_graph.add_edges_from([(1, 2), (2, 3)])

        self.scenario_graph = nx.DiGraph()
        self.scenario_graph.add_nodes_from([10, 11, 12])
        self.scenario_graph.add_edges_from([(10, 11), (11, 12)])

        self.other_scenario_graph = nx.DiGraph()
        self.other_scenario_graph.add_nodes_from([20, 21])
        self.other_scenario_graph.add_edge(20, 21)

    def test_prod_and_scenario_are_distinct_keys(self):
        """Caching under a scenario must not overwrite or serve the prod graph."""
        self.cache.cache_session_graph(12345, 2025, self.prod_graph)
        self.cache.cache_session_graph(12345, 2025, self.scenario_graph, scenario_id="scn_abc")

        # Prod lookup returns prod graph
        prod = self.cache.get_session_graph(12345, 2025)
        assert prod is not None
        assert set(prod.nodes()) == {1, 2, 3}

        # Scenario lookup returns scenario graph
        scn = self.cache.get_session_graph(12345, 2025, scenario_id="scn_abc")
        assert scn is not None
        assert set(scn.nodes()) == {10, 11, 12}

        # Should be three distinct-capable entries once we add another scenario
        self.cache.cache_session_graph(12345, 2025, self.other_scenario_graph, scenario_id="scn_xyz")
        other = self.cache.get_session_graph(12345, 2025, scenario_id="scn_xyz")
        assert other is not None
        assert set(other.nodes()) == {20, 21}

        # Previously cached entries still intact
        prod_again = self.cache.get_session_graph(12345, 2025)
        assert prod_again is not None
        assert set(prod_again.nodes()) == {1, 2, 3}
        scn_again = self.cache.get_session_graph(12345, 2025, scenario_id="scn_abc")
        assert scn_again is not None
        assert set(scn_again.nodes()) == {10, 11, 12}

        stats = self.cache.get_stats()
        assert stats["cache_size"] == 3

    def test_scenario_miss_is_distinct_from_prod(self):
        """A scenario lookup with no scenario cache must miss even if prod is cached."""
        self.cache.cache_session_graph(12345, 2025, self.prod_graph)

        # Only prod is cached — scenario lookup misses
        miss = self.cache.get_session_graph(12345, 2025, scenario_id="scn_abc")
        assert miss is None

        # And prod lookup still hits
        hit = self.cache.get_session_graph(12345, 2025)
        assert hit is not None
        assert set(hit.nodes()) == {1, 2, 3}

    def test_none_scenario_id_equals_prod(self):
        """Passing scenario_id=None explicitly must behave the same as omitting it."""
        self.cache.cache_session_graph(12345, 2025, self.prod_graph, scenario_id=None)

        assert self.cache.get_session_graph(12345, 2025) is not None
        assert self.cache.get_session_graph(12345, 2025, scenario_id=None) is not None

    def test_repeated_scenario_lookup_hits_cache(self):
        """Same (cm_id, year, scenario_id) tuple returns cached value on repeat."""
        self.cache.cache_session_graph(42, 2026, self.scenario_graph, scenario_id="scn_xyz")

        first = self.cache.get_session_graph(42, 2026, scenario_id="scn_xyz")
        second = self.cache.get_session_graph(42, 2026, scenario_id="scn_xyz")

        assert first is not None
        assert second is not None
        assert set(first.nodes()) == set(second.nodes()) == {10, 11, 12}

        stats = self.cache.get_stats()
        assert stats["hit_count"] == 2
        assert stats["miss_count"] == 0


class TestGraphCacheManagerBunkScenario(unittest.TestCase):
    """Scenario-aware caching for bunk graphs must not collide with prod."""

    def setUp(self):
        self.cache = GraphCacheManager(ttl_seconds=60, max_cache_size=10)

        self.prod_graph = nx.DiGraph()
        self.prod_graph.add_nodes_from([1, 2, 3])
        self.prod_graph.add_edges_from([(1, 2), (2, 3)])

        self.scenario_graph = nx.DiGraph()
        self.scenario_graph.add_nodes_from([10, 11, 12])
        self.scenario_graph.add_edges_from([(10, 11), (11, 12)])

        self.other_scenario_graph = nx.DiGraph()
        self.other_scenario_graph.add_nodes_from([20, 21])
        self.other_scenario_graph.add_edge(20, 21)

    def test_bunk_prod_and_scenario_are_distinct_keys(self):
        """Caching a bunk graph under a scenario must not overwrite the prod bunk graph."""
        self.cache.cache_bunk_graph(101, 12345, 2025, self.prod_graph)
        self.cache.cache_bunk_graph(101, 12345, 2025, self.scenario_graph, scenario_id="scn_abc")

        # Prod lookup returns prod graph
        prod = self.cache.get_bunk_graph(101, 12345, 2025)
        assert prod is not None
        assert set(prod.nodes()) == {1, 2, 3}

        # Scenario lookup returns scenario graph
        scn = self.cache.get_bunk_graph(101, 12345, 2025, scenario_id="scn_abc")
        assert scn is not None
        assert set(scn.nodes()) == {10, 11, 12}

        # A second scenario must be independent
        self.cache.cache_bunk_graph(101, 12345, 2025, self.other_scenario_graph, scenario_id="scn_xyz")
        other = self.cache.get_bunk_graph(101, 12345, 2025, scenario_id="scn_xyz")
        assert other is not None
        assert set(other.nodes()) == {20, 21}

        # Previously cached entries still intact
        prod_again = self.cache.get_bunk_graph(101, 12345, 2025)
        assert prod_again is not None
        assert set(prod_again.nodes()) == {1, 2, 3}

        scn_again = self.cache.get_bunk_graph(101, 12345, 2025, scenario_id="scn_abc")
        assert scn_again is not None
        assert set(scn_again.nodes()) == {10, 11, 12}

    def test_bunk_scenario_miss_is_distinct_from_prod(self):
        """A scenario bunk lookup with no scenario cache must miss even if prod is cached."""
        self.cache.cache_bunk_graph(101, 12345, 2025, self.prod_graph)

        miss = self.cache.get_bunk_graph(101, 12345, 2025, scenario_id="scn_abc")
        assert miss is None

        hit = self.cache.get_bunk_graph(101, 12345, 2025)
        assert hit is not None
        assert set(hit.nodes()) == {1, 2, 3}

    def test_bunk_none_scenario_id_equals_prod(self):
        """Passing scenario_id=None explicitly must match the default (prod) key."""
        self.cache.cache_bunk_graph(101, 12345, 2025, self.prod_graph, scenario_id=None)

        assert self.cache.get_bunk_graph(101, 12345, 2025) is not None
        assert self.cache.get_bunk_graph(101, 12345, 2025, scenario_id=None) is not None


if __name__ == "__main__":
    unittest.main()
