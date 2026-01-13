#!/usr/bin/env python3
"""
Test cache monitoring and statistics functionality
"""

from unittest.mock import patch

import pytest

from bunking.sync.bunk_request_processor.data.cache import CacheManager, create_cache_monitor


class TestCacheMonitoring:
    """Test cache monitoring functionality"""

    @pytest.fixture
    def cache_manager(self):
        """Create a cache manager with test configuration"""
        config = {
            "parse_cache_size": 100,
            "resolution_cache_size": 200,
            "disambiguation_cache_size": 50,
            "ttls": {
                "parse": 60,  # 1 minute for testing
                "resolution": 30,  # 30 seconds for testing
            },
        }
        return CacheManager(config)

    @pytest.fixture
    def cache_monitor(self, cache_manager):
        """Create a cache monitor"""
        config = {
            "log_interval": 1,  # 1 second for testing
            "detailed_logs": True,
            "auto_start": False,  # Manual control for tests
        }
        return create_cache_monitor(cache_manager, config)

    def test_cache_operations_tracked(self, cache_manager):
        """Test that cache operations are tracked in statistics"""
        # Initial state
        stats = cache_manager.get_stats()
        assert stats["total_hits"] == 0
        assert stats["total_misses"] == 0

        # Add some data
        cache_manager.set("test1", "value1", "parse")
        cache_manager.set("test2", "value2", "resolution")

        # Cache hits
        assert cache_manager.get("test1", "parse") == "value1"
        assert cache_manager.get("test2", "resolution") == "value2"

        # Cache miss
        assert cache_manager.get("test3", "parse") is None

        # Check updated stats
        stats = cache_manager.get_stats()
        assert stats["total_hits"] == 2
        assert stats["total_misses"] == 1
        assert stats["overall_hit_rate"] == 2 / 3

        # Check individual cache stats
        assert stats["caches"]["parse"]["hits"] == 1
        assert stats["caches"]["parse"]["misses"] == 1
        assert stats["caches"]["resolution"]["hits"] == 1
        assert stats["caches"]["resolution"]["misses"] == 0

    def test_cache_ttl_expiration(self, cache_manager):
        """Test that expired entries are tracked"""
        with patch("bunking.sync.bunk_request_processor.data.cache.cache_manager.time") as mock_time:
            # Initial time when entry is created
            mock_time.time.return_value = 1000.0

            # Set entry with 60 second TTL
            cache_manager.set("expire_me", "value", "parse", ttl=60)

            # Entry should still be valid
            result = cache_manager.get("expire_me", "parse")
            assert result == "value"

            # Advance time past TTL (61 seconds later)
            mock_time.time.return_value = 1061.0

            # Try to get - should be expired
            result = cache_manager.get("expire_me", "parse")
            assert result is None

            # Check expiration was tracked
            stats = cache_manager.get_stats()
            assert stats["caches"]["parse"]["expirations"] == 1

    def test_cache_eviction_tracking(self, cache_manager):
        """Test that evictions are tracked when cache is full"""
        # Use disambiguation cache which has small size (50)
        for i in range(60):
            cache_manager.set(f"key{i}", f"value{i}", "disambiguation")

        # Check evictions occurred
        stats = cache_manager.get_stats()
        assert stats["caches"]["disambiguation"]["evictions"] == 10  # 60 - 50
        assert stats["caches"]["disambiguation"]["size"] == 50

    def test_monitor_performance_summary(self, cache_monitor, cache_manager):
        """Test performance summary generation"""
        # Simulate some cache activity
        for i in range(10):
            cache_manager.set(f"key{i}", f"value{i}", "parse")

        for i in range(5):
            cache_manager.get(f"key{i}", "parse")  # Hits

        for i in range(10, 15):
            cache_manager.get(f"key{i}", "parse")  # Misses

        # Get performance summary
        summary = cache_monitor.get_performance_summary()

        assert "uptime_seconds" in summary
        assert "current_stats" in summary
        assert "cache_efficiency" in summary
        assert summary["total_requests"] == 10  # 5 hits + 5 misses

        # Check efficiency metrics
        parse_efficiency = summary["cache_efficiency"]["parse"]
        assert parse_efficiency["hit_rate"] == 0.5  # 5 hits / 10 requests
        assert parse_efficiency["utilization"] == 0.1  # 10 items / 100 capacity
        assert parse_efficiency["eviction_rate"] == 0.0  # No evictions

    def test_cache_recommendations(self, cache_monitor, cache_manager, caplog):
        """Test cache optimization recommendations"""
        import logging

        # Set logging level to capture INFO messages
        caplog.set_level(logging.INFO)

        # Scenario 1: Underutilized cache with good hit rate
        for i in range(5):
            cache_manager.set(f"key{i}", f"value{i}", "parse")
            cache_manager.get(f"key{i}", "parse")  # All hits

        cache_monitor.log_cache_recommendation()
        assert "Consider reducing cache size" in caplog.text

        # Scenario 2: Cache with poor hit rate
        caplog.clear()
        for i in range(20):
            cache_manager.get(f"miss{i}", "resolution")  # All misses

        cache_monitor.log_cache_recommendation()
        assert "Low hit rate" in caplog.text

        # Scenario 3: Cache with high eviction rate
        caplog.clear()
        # Fill disambiguation cache beyond capacity
        for i in range(100):
            cache_manager.set(f"evict{i}", f"value{i}", "disambiguation")

        cache_monitor.log_cache_recommendation()
        assert "Consider increasing cache size" in caplog.text

    def test_monitor_logging(self, cache_monitor, cache_manager, caplog):
        """Test that monitor logs statistics correctly"""
        import logging

        # Set logging level to capture INFO messages
        caplog.set_level(logging.INFO)

        # Add some cache activity
        cache_manager.set("test1", "value1", "parse")
        cache_manager.get("test1", "parse")
        cache_manager.get("test2", "parse")  # Miss

        # Log statistics
        cache_monitor.log_statistics()

        # Check log output
        assert "Cache Statistics" in caplog.text
        assert "Total Size: 1" in caplog.text
        assert "Hit Rate: 50.00%" in caplog.text
        assert "Hits: 1" in caplog.text
        assert "Misses: 1" in caplog.text

        # Check detailed logs
        assert "parse:" in caplog.text
        assert "Size: 1/100" in caplog.text

    def test_convenience_methods(self, cache_manager):
        """Test cache convenience methods"""
        # Test parse result caching
        cache_manager.cache_parse_result("John, Jane", "share_bunk_with", 12345, "parsed_data")

        result = cache_manager.get_cached_parse("John, Jane", "share_bunk_with", 12345)
        assert result == "parsed_data"

        # Test resolution caching
        cache_manager.cache_resolution("John Doe", 12345, 1234567, 2025, "resolved_person")

        result = cache_manager.get_cached_resolution("John Doe", 12345, 1234567, 2025)
        assert result == "resolved_person"

        # Test person caching
        cache_manager.cache_person(67890, "person_data")
        result = cache_manager.get_cached_person(67890)
        assert result == "person_data"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
