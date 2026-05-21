"""Server-side response cache for metrics endpoints.

Caches computed JSON responses in memory with TTL and LRU eviction.
Metrics data only changes on sync runs, so responses are stable between syncs.
Thread-safe via RLock, modeled after bunking/graph/graph_cache_manager.py.
"""

import threading
import time
from typing import Any

from bunking.logging_config import get_logger

logger = get_logger(__name__)


class MetricsCache:
    """Thread-safe in-memory cache for metrics endpoint responses."""

    def __init__(self, ttl_seconds: int = 7200, max_size: int = 200):
        self._cache: dict[str, Any] = {}
        self._cache_times: dict[str, float] = {}
        self._access_times: dict[str, float] = {}
        self._ttl = ttl_seconds
        self._max_size = max_size
        self._lock = threading.RLock()
        self._hit_count = 0
        self._miss_count = 0

    def make_key(self, endpoint: str, **params: Any) -> str:
        """Build a deterministic cache key from endpoint name and query params."""
        sorted_params = sorted(params.items())
        return f"{endpoint}:{sorted_params}"

    def get(self, endpoint: str, **params: Any) -> Any | None:
        """Get cached response for an endpoint + params combination.

        Returns cached value or None on miss/expiry.
        """
        key = self.make_key(endpoint, **params)
        with self._lock:
            if key in self._cache:
                if time.time() - self._cache_times[key] > self._ttl:
                    self._evict(key)
                    self._miss_count += 1
                    return None
                self._access_times[key] = time.time()
                self._hit_count += 1
                return self._cache[key]
            self._miss_count += 1
            return None

    def set(self, endpoint: str, value: Any, **params: Any) -> None:
        """Cache a response for an endpoint + params combination."""
        key = self.make_key(endpoint, **params)
        with self._lock:
            if len(self._cache) >= self._max_size and key not in self._cache:
                self._evict_lru()
            self._cache[key] = value
            self._cache_times[key] = time.time()
            self._access_times[key] = time.time()

    def invalidate_all(self) -> int:
        """Clear all cached entries. Called via frontend on sync completion.

        Returns number of entries cleared. Hit/miss counters are preserved
        for cumulative monitoring.
        """
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            self._cache_times.clear()
            self._access_times.clear()
            if count:
                logger.info(f"Metrics cache invalidated: cleared {count} entries")
            return count

    def cleanup_expired(self) -> int:
        """Remove expired entries. Returns number removed."""
        with self._lock:
            now = time.time()
            expired = [k for k, t in self._cache_times.items() if now - t > self._ttl]
            for key in expired:
                self._evict(key)
            return len(expired)

    def get_stats(self) -> dict[str, Any]:
        """Get cache statistics."""
        with self._lock:
            total = self._hit_count + self._miss_count
            return {
                "cache_size": len(self._cache),
                "hit_count": self._hit_count,
                "miss_count": self._miss_count,
                "hit_rate": round(self._hit_count / total, 3) if total else 0.0,
                "total_requests": total,
                "ttl_seconds": self._ttl,
                "max_size": self._max_size,
            }

    def _evict(self, key: str) -> None:
        self._cache.pop(key, None)
        self._cache_times.pop(key, None)
        self._access_times.pop(key, None)

    def _evict_lru(self) -> None:
        if not self._access_times:
            return
        lru_key = min(self._access_times.items(), key=lambda x: x[1])[0]
        self._evict(lru_key)
