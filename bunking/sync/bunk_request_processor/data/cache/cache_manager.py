"""Comprehensive cache manager for bunk request processing.

Provides multi-level caching with TTL support, statistics tracking,
and separate caches for different phases of processing."""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from typing import Any

logger = logging.getLogger(__name__)


class CacheEntry:
    """A single cache entry with TTL support"""

    def __init__(self, value: Any, ttl: int | None = None):
        self.value = value
        self.created_at = time.time()
        self.ttl = ttl
        self.hits = 0
        self.last_accessed = self.created_at

    def is_expired(self) -> bool:
        """Check if this entry has expired"""
        if self.ttl is None:
            return False
        return time.time() - self.created_at > self.ttl

    def access(self) -> Any:
        """Access the value and update statistics"""
        self.hits += 1
        self.last_accessed = time.time()
        return self.value


class LRUCache:
    """LRU cache with TTL and statistics support"""

    def __init__(self, max_size: int = 10000, name: str = "unnamed"):
        self.name = name
        self.max_size = max_size
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self._stats = {"hits": 0, "misses": 0, "evictions": 0, "expirations": 0}

    def get(self, key: str) -> Any | None:
        """Get value from cache"""
        if key not in self._cache:
            self._stats["misses"] += 1
            return None

        entry = self._cache[key]

        # Check expiration
        if entry.is_expired():
            del self._cache[key]
            self._stats["expirations"] += 1
            self._stats["misses"] += 1
            return None

        # Move to end (most recently used)
        self._cache.move_to_end(key)
        self._stats["hits"] += 1

        return entry.access()

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """Set value in cache with optional TTL"""
        # Remove if exists to update position
        if key in self._cache:
            del self._cache[key]

        # Check size limit
        if len(self._cache) >= self.max_size:
            # Remove oldest entry
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]
            self._stats["evictions"] += 1

        # Add new entry
        self._cache[key] = CacheEntry(value, ttl)

    def clear(self) -> None:
        """Clear all entries"""
        self._cache.clear()

    def get_stats(self) -> dict[str, Any]:
        """Get cache statistics"""
        total_requests = self._stats["hits"] + self._stats["misses"]
        hit_rate = self._stats["hits"] / total_requests if total_requests > 0 else 0

        return {
            "name": self.name,
            "size": len(self._cache),
            "max_size": self.max_size,
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "hit_rate": hit_rate,
            "evictions": self._stats["evictions"],
            "expirations": self._stats["expirations"],
        }

    def cleanup_expired(self) -> int:
        """Remove expired entries and return count"""
        expired_keys = [key for key, entry in self._cache.items() if entry.is_expired()]

        for key in expired_keys:
            del self._cache[key]
            self._stats["expirations"] += 1

        return len(expired_keys)


class CacheManager:
    """Comprehensive cache manager with multi-level caching"""

    def __init__(self, config: dict[str, Any] | None = None):
        config = config or {}

        # Initialize different cache levels
        self.caches = {
            # Phase 1: Parse results cache
            "parse": LRUCache(max_size=config.get("parse_cache_size", 5000), name="parse"),
            # Phase 2: Name resolution cache
            "resolution": LRUCache(max_size=config.get("resolution_cache_size", 10000), name="resolution"),
            # Phase 3: Disambiguation cache
            "disambiguation": LRUCache(max_size=config.get("disambiguation_cache_size", 2000), name="disambiguation"),
            # Person data cache
            "person": LRUCache(max_size=config.get("person_cache_size", 20000), name="person"),
            # Attendee data cache
            "attendee": LRUCache(max_size=config.get("attendee_cache_size", 20000), name="attendee"),
            # Social graph cache
            "social": LRUCache(max_size=config.get("social_cache_size", 5000), name="social"),
        }

        # Default TTLs (in seconds)
        self.default_ttls = {
            "parse": 3600,  # 1 hour
            "resolution": 1800,  # 30 minutes
            "disambiguation": 900,  # 15 minutes
            "person": 3600,  # 1 hour
            "attendee": 3600,  # 1 hour
            "social": 600,  # 10 minutes
        }

        # Update with config
        for cache_type, ttl in config.get("ttls", {}).items():
            if cache_type in self.default_ttls:
                self.default_ttls[cache_type] = ttl

        self._last_cleanup = time.time()
        self._cleanup_interval = config.get("cleanup_interval", 300)  # 5 minutes

        logger.info(f"CacheManager initialized with {len(self.caches)} cache levels")

    def get(self, key: str, cache_type: str = "resolution") -> Any | None:
        """Get value from specified cache"""
        if cache_type not in self.caches:
            logger.warning(f"Unknown cache type: {cache_type}")
            return None

        # Periodic cleanup
        self._maybe_cleanup()

        return self.caches[cache_type].get(key)

    def set(self, key: str, value: Any, cache_type: str = "resolution", ttl: int | None = None) -> None:
        """Set value in specified cache"""
        if cache_type not in self.caches:
            logger.warning(f"Unknown cache type: {cache_type}")
            return

        # Use default TTL if not specified
        if ttl is None:
            ttl = self.default_ttls.get(cache_type)

        self.caches[cache_type].set(key, value, ttl)

    def clear(self, cache_type: str | None = None) -> None:
        """Clear specified cache or all caches"""
        if cache_type:
            if cache_type in self.caches:
                self.caches[cache_type].clear()
                logger.info(f"Cleared {cache_type} cache")
        else:
            for cache in self.caches.values():
                cache.clear()
            logger.info("Cleared all caches")

    def get_stats(self) -> dict[str, Any]:
        """Get statistics for all caches"""
        caches_dict: dict[str, dict[str, Any]] = {}
        total_size = 0
        total_hits = 0
        total_misses = 0

        for cache_type, cache in self.caches.items():
            cache_stats = cache.get_stats()
            caches_dict[cache_type] = cache_stats
            total_size += cache_stats["size"]
            total_hits += cache_stats["hits"]
            total_misses += cache_stats["misses"]

        # Calculate overall hit rate
        total_requests = total_hits + total_misses
        overall_hit_rate = total_hits / total_requests if total_requests > 0 else 0.0

        return {
            "caches": caches_dict,
            "total_size": total_size,
            "total_hits": total_hits,
            "total_misses": total_misses,
            "overall_hit_rate": overall_hit_rate,
        }

    def _maybe_cleanup(self) -> None:
        """Periodically cleanup expired entries"""
        current_time = time.time()
        if current_time - self._last_cleanup > self._cleanup_interval:
            self.cleanup_expired()
            self._last_cleanup = current_time

    def cleanup_expired(self) -> int:
        """Cleanup expired entries from all caches"""
        total_cleaned = 0

        for cache_type, cache in self.caches.items():
            cleaned = cache.cleanup_expired()
            if cleaned > 0:
                logger.debug(f"Cleaned {cleaned} expired entries from {cache_type} cache")
            total_cleaned += cleaned

        if total_cleaned > 0:
            logger.info(f"Total expired entries cleaned: {total_cleaned}")

        return total_cleaned

    def cleanup(self) -> None:
        """Cleanup all resources"""
        self.clear()
        logger.info("CacheManager cleaned up")

    # Convenience methods for common cache operations

    def cache_parse_result(self, request_text: str, field_name: str, requester_cm_id: int, result: Any) -> None:
        """Cache a parse result"""
        key = f"parse:{requester_cm_id}:{field_name}:{hash(request_text)}"
        self.set(key, result, "parse")

    def get_cached_parse(self, request_text: str, field_name: str, requester_cm_id: int) -> Any | None:
        """Get cached parse result"""
        key = f"parse:{requester_cm_id}:{field_name}:{hash(request_text)}"
        return self.get(key, "parse")

    def cache_resolution(self, name: str, requester_cm_id: int, session_cm_id: int, year: int, result: Any) -> None:
        """Cache a name resolution result"""
        key = f"res:{name.lower()}:{requester_cm_id}:{session_cm_id}:{year}"
        self.set(key, result, "resolution")

    def get_cached_resolution(self, name: str, requester_cm_id: int, session_cm_id: int, year: int) -> Any | None:
        """Get cached resolution result"""
        key = f"res:{name.lower()}:{requester_cm_id}:{session_cm_id}:{year}"
        return self.get(key, "resolution")

    def cache_person(self, person_cm_id: int, person_data: Any) -> None:
        """Cache person data"""
        key = f"person:{person_cm_id}"
        self.set(key, person_data, "person")

    def get_cached_person(self, person_cm_id: int) -> Any | None:
        """Get cached person data"""
        key = f"person:{person_cm_id}"
        return self.get(key, "person")
