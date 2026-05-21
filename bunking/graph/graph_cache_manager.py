"""
Backend caching system for social graphs.

Provides server-side caching of NetworkX graphs with TTL and invalidation.
Thread-safe implementation for concurrent access.
"""

import threading
import time
from typing import Any

import networkx as nx

from bunking.logging_config import get_logger

logger = get_logger(__name__)


class GraphCacheManager:
    """Thread-safe cache manager for social graphs."""

    def __init__(self, ttl_seconds: int = 900, max_cache_size: int = 100):
        """Initialize cache manager.

        Args:
            ttl_seconds: Time to live for cached graphs (default: 15 minutes)
            max_cache_size: Maximum number of graphs to cache
        """
        self._cache: dict[str, nx.DiGraph] = {}
        self._cache_times: dict[str, float] = {}
        self._access_times: dict[str, float] = {}
        self._ttl = ttl_seconds
        self._max_size = max_cache_size
        self._lock = threading.RLock()
        self._hit_count = 0
        self._miss_count = 0

        logger.info(f"GraphCacheManager initialized with TTL={ttl_seconds}s, max_size={max_cache_size}")

    @staticmethod
    def _scenario_slug(scenario_id: str | None) -> str:
        """Normalize scenario_id into a cache-key segment.

        The production path is stored under the literal ``"prod"`` slug so
        that ``None`` and any scenario id land in distinct keyspaces and the
        prefix match in ``invalidate_session`` is unambiguous.
        """
        return scenario_id or "prod"

    def get_session_graph(self, session_cm_id: int, year: int, scenario_id: str | None = None) -> nx.DiGraph | None:
        """Get cached session graph if available and not expired.

        Args:
            session_cm_id: Session ID
            year: Year
            scenario_id: Optional scenario id; ``None`` selects the production cache.

        Returns:
            Cached graph copy or None if not found/expired
        """
        cache_key = f"session_{session_cm_id}_{year}_{self._scenario_slug(scenario_id)}"

        with self._lock:
            if cache_key in self._cache:
                # Check if expired
                if time.time() - self._cache_times[cache_key] > self._ttl:
                    logger.debug(f"Cache expired for {cache_key}")
                    self._evict(cache_key)
                    self._miss_count += 1
                    return None

                # Update access time
                self._access_times[cache_key] = time.time()
                self._hit_count += 1
                logger.debug(f"Cache hit for {cache_key}")

                # Return a copy to prevent mutations
                return self._cache[cache_key].copy()

            self._miss_count += 1
            logger.debug(f"Cache miss for {cache_key}")
            return None

    def get_bunk_graph(
        self,
        bunk_cm_id: int,
        session_cm_id: int,
        year: int,
        scenario_id: str | None = None,
    ) -> nx.DiGraph | None:
        """Get cached bunk graph if available and not expired.

        Args:
            bunk_cm_id: Bunk ID
            session_cm_id: Session ID
            year: Year
            scenario_id: Optional scenario id; ``None`` selects the production cache.

        Returns:
            Cached graph copy or None if not found/expired
        """
        cache_key = f"bunk_{bunk_cm_id}_{session_cm_id}_{year}_{self._scenario_slug(scenario_id)}"

        with self._lock:
            if cache_key in self._cache:
                # Check if expired
                if time.time() - self._cache_times[cache_key] > self._ttl:
                    logger.debug(f"Cache expired for {cache_key}")
                    self._evict(cache_key)
                    self._miss_count += 1
                    return None

                # Update access time
                self._access_times[cache_key] = time.time()
                self._hit_count += 1
                logger.debug(f"Cache hit for {cache_key}")

                # Return a copy to prevent mutations
                return self._cache[cache_key].copy()

            self._miss_count += 1
            logger.debug(f"Cache miss for {cache_key}")
            return None

    def cache_session_graph(
        self,
        session_cm_id: int,
        year: int,
        graph: nx.DiGraph,
        scenario_id: str | None = None,
    ) -> None:
        """Cache a session graph.

        Args:
            session_cm_id: Session ID
            year: Year
            graph: NetworkX graph to cache
            scenario_id: Optional scenario id; ``None`` stores under the production cache.
        """
        cache_key = f"session_{session_cm_id}_{year}_{self._scenario_slug(scenario_id)}"

        with self._lock:
            # Evict LRU if at capacity
            if len(self._cache) >= self._max_size and cache_key not in self._cache:
                self._evict_lru()

            # Store a copy to prevent external mutations
            self._cache[cache_key] = graph.copy()
            self._cache_times[cache_key] = time.time()
            self._access_times[cache_key] = time.time()

            logger.debug(f"Cached session graph {cache_key} with {graph.number_of_nodes()} nodes")

    def cache_bunk_graph(
        self,
        bunk_cm_id: int,
        session_cm_id: int,
        year: int,
        graph: nx.DiGraph,
        scenario_id: str | None = None,
    ) -> None:
        """Cache a bunk graph.

        Args:
            bunk_cm_id: Bunk ID
            session_cm_id: Session ID
            year: Year
            graph: NetworkX graph to cache
            scenario_id: Optional scenario id; ``None`` stores under the production cache.
        """
        cache_key = f"bunk_{bunk_cm_id}_{session_cm_id}_{year}_{self._scenario_slug(scenario_id)}"

        with self._lock:
            # Evict LRU if at capacity
            if len(self._cache) >= self._max_size and cache_key not in self._cache:
                self._evict_lru()

            # Store a copy to prevent external mutations
            self._cache[cache_key] = graph.copy()
            self._cache_times[cache_key] = time.time()
            self._access_times[cache_key] = time.time()

            logger.debug(f"Cached bunk graph {cache_key} with {graph.number_of_nodes()} nodes")

    def invalidate_for_person(self, person_cm_id: int) -> int:
        """Invalidate all cached graphs containing a specific person.

        This is called when a person is moved or their data changes.

        Returns:
            Number of graphs invalidated
        """
        with self._lock:
            keys_to_remove = []

            for key, graph in self._cache.items():
                if person_cm_id in graph.nodes:
                    keys_to_remove.append(key)

            for key in keys_to_remove:
                self._evict(key)

            if keys_to_remove:
                logger.info(f"Invalidated {len(keys_to_remove)} graphs containing person {person_cm_id}")

            return len(keys_to_remove)

    def invalidate_session(self, session_cm_id: int, year: int) -> int:
        """Invalidate all cached graphs for a session.

        Returns:
            Number of graphs invalidated
        """
        with self._lock:
            session_prefix = f"session_{session_cm_id}_{year}"
            session_str = str(session_cm_id)
            year_str = str(year)
            keys_to_remove: list[str] = []
            for key in self._cache:
                if key.startswith(session_prefix):
                    keys_to_remove.append(key)
                    continue
                # Bunk keys are ``bunk_{bunk_id}_{session_id}_{year}_{slug}``.
                # Parse positionally so we don't false-match a bunk whose
                # bunk_cm_id coincidentally equals the session_cm_id (e.g. key
                # ``bunk_5_2025_2025_prod`` should NOT match session 5 in
                # year 2025 – the real session there is 2025).
                if key.startswith("bunk_"):
                    parts = key.split("_")
                    if len(parts) >= 5 and parts[2] == session_str and parts[3] == year_str:
                        keys_to_remove.append(key)

            for key in keys_to_remove:
                self._evict(key)

            if keys_to_remove:
                logger.info(f"Invalidated {len(keys_to_remove)} graphs for session {session_cm_id}")

            return len(keys_to_remove)

    def invalidate_scenario(self, session_cm_id: int, year: int, scenario_id: str) -> int:
        """Invalidate cached graphs for a single scenario+session+year.

        Drops both the session graph and every bunk graph cached under the
        scenario slot, leaving production cache (``slug == "prod"``) and other
        scenarios for the same session+year untouched.

        Slug comparison is exact (positional, not substring) so a scenario id
        that is a prefix of another (``"abc"`` vs ``"abcd"``) cannot
        false-match — same guarantee as ``invalidate_session``'s bunk match.

        Returns:
            Number of graphs invalidated
        """
        if not scenario_id:
            return 0

        slug = self._scenario_slug(scenario_id)
        session_str = str(session_cm_id)
        year_str = str(year)
        session_key = f"session_{session_str}_{year_str}_{slug}"

        with self._lock:
            keys_to_remove: list[str] = []
            for key in self._cache:
                if key == session_key:
                    keys_to_remove.append(key)
                    continue
                if key.startswith("bunk_"):
                    # Slug is the trailing segment; PocketBase ids are
                    # alphanumeric in production but the slug field is a
                    # free-form string, so rejoin parts[4:] to compare
                    # exactly even when it contains underscores.
                    parts = key.split("_")
                    if (
                        len(parts) >= 5
                        and parts[2] == session_str
                        and parts[3] == year_str
                        and "_".join(parts[4:]) == slug
                    ):
                        keys_to_remove.append(key)

            for key in keys_to_remove:
                self._evict(key)

            if keys_to_remove:
                logger.info(
                    f"Invalidated {len(keys_to_remove)} graphs for scenario {scenario_id} "
                    f"(session {session_cm_id}, year {year})"
                )

            return len(keys_to_remove)

    def invalidate_bunk(self, bunk_cm_id: int) -> int:
        """Invalidate all cached graphs for a bunk.

        Returns:
            Number of graphs invalidated
        """
        with self._lock:
            keys_to_remove = [key for key in self._cache if f"bunk_{bunk_cm_id}_" in key]

            for key in keys_to_remove:
                self._evict(key)

            if keys_to_remove:
                logger.info(f"Invalidated {len(keys_to_remove)} graphs for bunk {bunk_cm_id}")

            return len(keys_to_remove)

    def clear(self) -> None:
        """Clear all cached graphs."""
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            self._cache_times.clear()
            self._access_times.clear()
            logger.info(f"Cleared {count} cached graphs")

    def cleanup_expired(self) -> int:
        """Remove expired entries from cache.

        Returns:
            Number of entries removed
        """
        with self._lock:
            current_time = time.time()
            keys_to_remove = []

            for key, cache_time in self._cache_times.items():
                if current_time - cache_time > self._ttl:
                    keys_to_remove.append(key)

            for key in keys_to_remove:
                self._evict(key)

            if keys_to_remove:
                logger.debug(f"Cleaned up {len(keys_to_remove)} expired entries")

            return len(keys_to_remove)

    def get_stats(self) -> dict[str, Any]:
        """Get cache statistics.

        Returns:
            Dictionary with cache stats
        """
        with self._lock:
            total_requests = self._hit_count + self._miss_count
            hit_rate = self._hit_count / total_requests if total_requests > 0 else 0.0

            return {
                "cache_size": len(self._cache),
                "hit_count": self._hit_count,
                "miss_count": self._miss_count,
                "hit_rate": round(hit_rate, 3),
                "total_requests": total_requests,
                "ttl_seconds": self._ttl,
                "max_size": self._max_size,
            }

    def _evict(self, key: str) -> None:
        """Evict a specific key from cache."""
        if key in self._cache:
            del self._cache[key]
            del self._cache_times[key]
            self._access_times.pop(key, None)

    def _evict_lru(self) -> None:
        """Evict least recently used entry."""
        if not self._access_times:
            return

        # Find LRU key
        lru_key = min(self._access_times.items(), key=lambda x: x[1])[0]
        logger.debug(f"Evicting LRU entry: {lru_key}")
        self._evict(lru_key)
