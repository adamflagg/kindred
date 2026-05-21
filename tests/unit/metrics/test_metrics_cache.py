"""Tests for MetricsCache - server-side response cache for metrics endpoints.

Written FIRST (TDD). These tests define the expected behavior for the cache:
- Get/set with deterministic cache keys
- TTL-based expiry
- LRU eviction when at capacity
- Full invalidation (sync completion)
- Thread safety under concurrent access
- Stats tracking (hit/miss/eviction counts)
"""

import threading
import time

from api.services.metrics_cache import MetricsCache

# ============================================================================
# Basic get/set behavior
# ============================================================================


class TestMetricsCacheBasic:
    """Test basic cache get/set operations."""

    def test_get_returns_none_on_miss(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        result = cache.get("retention", year=2026, session_types="main,embedded")
        assert result is None

    def test_set_then_get_returns_cached_value(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        data = {"total": 150, "retention_rate": 0.85}
        cache.set("retention", data, year=2026, session_types="main,embedded")
        result = cache.get("retention", year=2026, session_types="main,embedded")
        assert result == data

    def test_different_params_are_different_keys(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        data_a = {"year": 2025}
        data_b = {"year": 2026}
        cache.set("retention", data_a, year=2025)
        cache.set("retention", data_b, year=2026)
        assert cache.get("retention", year=2025) == data_a
        assert cache.get("retention", year=2026) == data_b

    def test_different_endpoints_are_different_keys(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        retention_data = {"type": "retention"}
        registration_data = {"type": "registration"}
        cache.set("retention", retention_data, year=2026)
        cache.set("registration", registration_data, year=2026)
        assert cache.get("retention", year=2026) == retention_data
        assert cache.get("registration", year=2026) == registration_data

    def test_none_params_produce_consistent_key(self) -> None:
        """None params should be handled consistently in cache keys."""
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        data = {"test": True}
        cache.set("retention", data, year=2026, session_types=None, session_cm_id=None)
        result = cache.get("retention", year=2026, session_types=None, session_cm_id=None)
        assert result == data

    def test_param_order_does_not_affect_key(self) -> None:
        """Cache key should be deterministic regardless of kwarg order."""
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        data = {"test": True}
        # Set with one param order
        cache.set("retention", data, year=2026, session_types="main")
        # Get with same logical params (Python kwargs are unordered by call convention,
        # but the cache should sort them)
        result = cache.get("retention", session_types="main", year=2026)
        assert result == data


# ============================================================================
# TTL expiry
# ============================================================================


class TestMetricsCacheTTL:
    """Test TTL-based cache expiration."""

    def test_entry_expires_after_ttl(self) -> None:
        cache = MetricsCache(ttl_seconds=1, max_size=100)
        cache.set("retention", {"data": True}, year=2026)
        # Should be available immediately
        assert cache.get("retention", year=2026) is not None
        # Wait for expiry
        time.sleep(1.1)
        assert cache.get("retention", year=2026) is None

    def test_entry_available_before_ttl(self) -> None:
        cache = MetricsCache(ttl_seconds=10, max_size=100)
        cache.set("retention", {"data": True}, year=2026)
        time.sleep(0.1)
        assert cache.get("retention", year=2026) is not None

    def test_cleanup_expired_removes_stale_entries(self) -> None:
        cache = MetricsCache(ttl_seconds=1, max_size=100)
        cache.set("retention", {"a": 1}, year=2025)
        cache.set("registration", {"b": 2}, year=2025)
        time.sleep(1.1)
        # Add one fresh entry
        cache.set("historical", {"c": 3}, year=2025)
        removed = cache.cleanup_expired()
        assert removed == 2
        assert cache.get("historical", year=2025) is not None


# ============================================================================
# LRU eviction
# ============================================================================


class TestMetricsCacheLRU:
    """Test LRU eviction when cache is at capacity."""

    def test_evicts_lru_when_at_capacity(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=3)
        cache.set("a", {"data": "a"}, year=2024)
        cache.set("b", {"data": "b"}, year=2024)
        cache.set("c", {"data": "c"}, year=2024)
        # Access "a" to make it recently used
        cache.get("a", year=2024)
        # Adding "d" should evict "b" (least recently used)
        cache.set("d", {"data": "d"}, year=2024)
        assert cache.get("a", year=2024) is not None  # recently accessed
        assert cache.get("b", year=2024) is None  # evicted (LRU)
        assert cache.get("c", year=2024) is not None  # not evicted
        assert cache.get("d", year=2024) is not None  # just added

    def test_overwrite_existing_key_does_not_evict(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=2)
        cache.set("a", {"v": 1}, year=2024)
        cache.set("b", {"v": 2}, year=2024)
        # Overwriting "a" should not trigger eviction
        cache.set("a", {"v": 3}, year=2024)
        assert cache.get("a", year=2024) == {"v": 3}
        assert cache.get("b", year=2024) == {"v": 2}


# ============================================================================
# Invalidation
# ============================================================================


class TestMetricsCacheInvalidation:
    """Test cache invalidation (sync completion)."""

    def test_invalidate_all_clears_cache(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        cache.set("retention", {"a": 1}, year=2025)
        cache.set("registration", {"b": 2}, year=2026)
        cache.set("historical", {"c": 3}, year=2024)
        count = cache.invalidate_all()
        assert count == 3
        assert cache.get("retention", year=2025) is None
        assert cache.get("registration", year=2026) is None
        assert cache.get("historical", year=2024) is None

    def test_invalidate_all_returns_zero_when_empty(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        assert cache.invalidate_all() == 0

    def test_invalidate_all_clears_entries(self) -> None:
        """After invalidation, previously cached keys should miss."""
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        cache.set("retention", {"a": 1}, year=2025)
        cache.get("retention", year=2025)  # hit
        cache.invalidate_all()
        # After invalidation, same key should miss
        result = cache.get("retention", year=2025)
        assert result is None


# ============================================================================
# Cache key generation
# ============================================================================


class TestMetricsCacheKeyGeneration:
    """Test deterministic cache key generation from endpoint + params."""

    def test_cache_key_includes_endpoint(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        key_a = cache.make_key("retention", year=2026)
        key_b = cache.make_key("registration", year=2026)
        assert key_a != key_b

    def test_cache_key_includes_params(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        key_a = cache.make_key("retention", year=2025)
        key_b = cache.make_key("retention", year=2026)
        assert key_a != key_b

    def test_cache_key_sorted_params(self) -> None:
        """Keys should be deterministic regardless of param insertion order."""
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        key_a = cache.make_key("retention", year=2026, session_types="main")
        key_b = cache.make_key("retention", session_types="main", year=2026)
        assert key_a == key_b

    def test_cache_key_with_none_values(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        key_a = cache.make_key("retention", year=2026, session_cm_id=None)
        key_b = cache.make_key("retention", year=2026)
        # None params should still produce a distinct key (they're explicit)
        # but the key should be deterministic
        assert isinstance(key_a, str)
        assert isinstance(key_b, str)


# ============================================================================
# Stats tracking
# ============================================================================


class TestMetricsCacheStats:
    """Test cache statistics tracking."""

    def test_stats_initial_state(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        stats = cache.get_stats()
        assert stats["cache_size"] == 0
        assert stats["hit_count"] == 0
        assert stats["miss_count"] == 0
        assert stats["hit_rate"] == 0.0

    def test_stats_after_hit_and_miss(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        cache.set("retention", {"a": 1}, year=2026)
        cache.get("retention", year=2026)  # hit
        cache.get("registration", year=2026)  # miss
        stats = cache.get_stats()
        assert stats["hit_count"] == 1
        assert stats["miss_count"] == 1
        assert stats["hit_rate"] == 0.5
        assert stats["cache_size"] == 1

    def test_stats_tracks_total_requests(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=100)
        cache.get("a", year=1)  # miss
        cache.get("b", year=1)  # miss
        cache.get("c", year=1)  # miss
        stats = cache.get_stats()
        assert stats["total_requests"] == 3


# ============================================================================
# Thread safety
# ============================================================================


class TestMetricsCacheThreadSafety:
    """Test thread-safe concurrent access."""

    def test_concurrent_writes_no_corruption(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=1000)
        errors: list[str] = []

        def writer(thread_id: int) -> None:
            try:
                for i in range(50):
                    cache.set(f"endpoint_{thread_id}", {"i": i}, year=2026, idx=i)
            except Exception as e:
                errors.append(f"Thread {thread_id}: {e}")

        threads = [threading.Thread(target=writer, args=(t,)) for t in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == [], f"Errors during concurrent writes: {errors}"
        # All entries should be present (10 threads × 50 entries = 500)
        stats = cache.get_stats()
        assert stats["cache_size"] == 500

    def test_concurrent_reads_and_writes(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=1000)
        cache.set("shared", {"initial": True}, year=2026)
        errors: list[str] = []

        def reader() -> None:
            try:
                for _ in range(100):
                    cache.get("shared", year=2026)
            except Exception as e:
                errors.append(f"Reader: {e}")

        def writer() -> None:
            try:
                for i in range(100):
                    cache.set("shared", {"i": i}, year=2026)
            except Exception as e:
                errors.append(f"Writer: {e}")

        threads = [
            threading.Thread(target=reader),
            threading.Thread(target=reader),
            threading.Thread(target=writer),
            threading.Thread(target=writer),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == [], f"Errors during concurrent access: {errors}"

    def test_concurrent_invalidation(self) -> None:
        cache = MetricsCache(ttl_seconds=300, max_size=1000)
        for i in range(100):
            cache.set(f"ep_{i}", {"i": i}, year=2026)
        errors: list[str] = []

        def invalidator() -> None:
            try:
                cache.invalidate_all()
            except Exception as e:
                errors.append(f"Invalidator: {e}")

        def writer() -> None:
            try:
                for i in range(50):
                    cache.set(f"new_{i}", {"i": i}, year=2026)
            except Exception as e:
                errors.append(f"Writer: {e}")

        threads = [
            threading.Thread(target=invalidator),
            threading.Thread(target=writer),
            threading.Thread(target=writer),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == [], f"Errors during concurrent invalidation: {errors}"
