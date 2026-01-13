"""Tests for CacheMonitor.

Tests cover:
- Initialization
- Start/stop monitoring
- Statistics logging
- Rate calculations
- Performance summaries
- Cache recommendations
- JSON export
- Factory function
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from unittest.mock import Mock

from bunking.sync.bunk_request_processor.data.cache.cache_monitor import (
    CacheMonitor,
    create_cache_monitor,
)


def _create_mock_cache_manager(stats: dict[str, object] | None = None) -> Mock:
    """Create a mock CacheManager with configurable stats."""
    mock = Mock()
    default_stats = {
        "total_size": 100,
        "overall_hit_rate": 0.75,
        "total_hits": 75,
        "total_misses": 25,
        "caches": {
            "person": {
                "size": 50,
                "max_size": 100,
                "hit_rate": 0.8,
                "hits": 40,
                "misses": 10,
                "evictions": 5,
                "expirations": 2,
            },
            "session": {
                "size": 50,
                "max_size": 100,
                "hit_rate": 0.7,
                "hits": 35,
                "misses": 15,
                "evictions": 3,
                "expirations": 1,
            },
        },
    }
    mock.get_stats.return_value = stats or default_stats
    return mock


class TestCacheMonitorInit:
    """Tests for CacheMonitor initialization."""

    def test_init_with_required_params(self):
        """CacheMonitor initializes with cache manager."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        assert monitor.cache_manager == mock_cm
        assert monitor.log_interval == 300  # default 5 minutes
        assert monitor.enable_detailed_logs is False
        assert monitor._monitoring is False
        assert monitor._monitor_thread is None

    def test_init_with_custom_interval(self):
        """CacheMonitor accepts custom log interval."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm, log_interval=60)

        assert monitor.log_interval == 60

    def test_init_with_detailed_logs(self):
        """CacheMonitor accepts detailed logs flag."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm, enable_detailed_logs=True)

        assert monitor.enable_detailed_logs is True

    def test_init_sets_start_time(self):
        """CacheMonitor records start time."""
        mock_cm = _create_mock_cache_manager()
        before = time.time()
        monitor = CacheMonitor(cache_manager=mock_cm)
        after = time.time()

        assert before <= monitor._start_time <= after


class TestStartStopMonitoring:
    """Tests for starting and stopping monitoring."""

    def test_start_monitoring_creates_thread(self):
        """Starting monitoring creates daemon thread."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm, log_interval=1)

        try:
            monitor.start_monitoring()

            assert monitor._monitoring is True
            assert monitor._monitor_thread is not None
            assert monitor._monitor_thread.daemon is True
            assert monitor._monitor_thread.name == "CacheMonitor"
        finally:
            monitor.stop_monitoring()

    def test_start_monitoring_twice_warns(self):
        """Starting monitoring twice logs warning."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm, log_interval=1)

        try:
            monitor.start_monitoring()
            # Second call should be ignored
            monitor.start_monitoring()

            assert monitor._monitoring is True
        finally:
            monitor.stop_monitoring()

    def test_stop_monitoring_stops_thread(self):
        """Stopping monitoring stops the thread."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm, log_interval=1)

        monitor.start_monitoring()
        monitor.stop_monitoring()

        assert monitor._monitoring is False


class TestLogStatistics:
    """Tests for log_statistics method."""

    def test_log_statistics_fetches_stats(self):
        """log_statistics calls cache manager get_stats."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        monitor.log_statistics()

        mock_cm.get_stats.assert_called_once()

    def test_log_statistics_saves_last_stats(self):
        """log_statistics saves stats for rate calculation."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        assert monitor._last_stats is None
        monitor.log_statistics()

        assert monitor._last_stats is not None
        assert monitor._last_stats["total_hits"] == 75


class TestCalculateRates:
    """Tests for rate calculation."""

    def test_calculate_rates_hits_per_minute(self):
        """Calculates hits per minute correctly."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        old_stats = {
            "total_hits": 100,
            "total_misses": 50,
            "caches": {"test": {"evictions": 10}},
        }
        new_stats = {
            "total_hits": 160,
            "total_misses": 80,
            "caches": {"test": {"evictions": 15}},
        }

        rates = monitor._calculate_rates(old_stats, new_stats, time_delta=60)

        assert rates["hits_per_minute"] == 60.0  # 60 hits in 60s = 60/min
        assert rates["misses_per_minute"] == 30.0  # 30 misses in 60s

    def test_calculate_rates_evictions(self):
        """Calculates evictions per minute correctly."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        old_stats = {
            "total_hits": 0,
            "total_misses": 0,
            "caches": {"a": {"evictions": 10}, "b": {"evictions": 5}},
        }
        new_stats = {
            "total_hits": 0,
            "total_misses": 0,
            "caches": {"a": {"evictions": 20}, "b": {"evictions": 10}},
        }

        rates = monitor._calculate_rates(old_stats, new_stats, time_delta=300)

        # 15 evictions in 5 minutes = 3/min
        assert rates["evictions_per_minute"] == 3.0


class TestPerformanceSummary:
    """Tests for get_performance_summary method."""

    def test_performance_summary_structure(self):
        """Performance summary has expected structure."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        summary = monitor.get_performance_summary()

        assert "uptime_seconds" in summary
        assert "uptime_minutes" in summary
        assert "current_stats" in summary
        assert "average_hit_rate" in summary
        assert "total_requests" in summary
        assert "requests_per_minute" in summary
        assert "cache_efficiency" in summary

    def test_performance_summary_total_requests(self):
        """Total requests is hits + misses."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        summary = monitor.get_performance_summary()

        assert summary["total_requests"] == 75 + 25  # hits + misses

    def test_performance_summary_cache_efficiency(self):
        """Cache efficiency metrics are calculated per cache."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        summary = monitor.get_performance_summary()

        assert "person" in summary["cache_efficiency"]
        assert "session" in summary["cache_efficiency"]

        person_eff = summary["cache_efficiency"]["person"]
        assert "hit_rate" in person_eff
        assert "utilization" in person_eff
        assert "eviction_rate" in person_eff

    def test_performance_summary_utilization(self):
        """Utilization is size / max_size."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        summary = monitor.get_performance_summary()

        # 50/100 = 0.5
        assert summary["cache_efficiency"]["person"]["utilization"] == 0.5


class TestExportStatsJson:
    """Tests for export_stats_json method."""

    def test_export_creates_file(self):
        """Export creates JSON file at specified path."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            filepath = f.name

        try:
            monitor.export_stats_json(filepath)

            assert os.path.exists(filepath)
            with open(filepath) as f:
                data = json.load(f)

            assert "uptime_seconds" in data
            assert "current_stats" in data
        finally:
            os.unlink(filepath)

    def test_export_valid_json(self):
        """Exported file is valid JSON."""
        mock_cm = _create_mock_cache_manager()
        monitor = CacheMonitor(cache_manager=mock_cm)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            filepath = f.name

        try:
            monitor.export_stats_json(filepath)

            # Should not raise
            with open(filepath) as f:
                json.load(f)
        finally:
            os.unlink(filepath)


class TestCacheRecommendations:
    """Tests for log_cache_recommendation method."""

    def test_recommendation_underutilized(self):
        """Recommends reducing size for underutilized cache."""
        stats = {
            "total_size": 10,
            "overall_hit_rate": 0.9,
            "total_hits": 90,
            "total_misses": 10,
            "caches": {
                "underused": {
                    "size": 5,
                    "max_size": 100,  # 5% utilization
                    "hit_rate": 0.9,  # Good hit rate
                    "hits": 90,
                    "misses": 10,
                    "evictions": 1,
                    "expirations": 0,
                },
            },
        }
        mock_cm = _create_mock_cache_manager(stats)
        monitor = CacheMonitor(cache_manager=mock_cm)

        # Should not raise, should log recommendation
        monitor.log_cache_recommendation()

    def test_recommendation_high_eviction(self):
        """Recommends increasing size for high eviction cache."""
        stats = {
            "total_size": 100,
            "overall_hit_rate": 0.5,
            "total_hits": 50,
            "total_misses": 50,
            "caches": {
                "thrashing": {
                    "size": 90,
                    "max_size": 100,
                    "hit_rate": 0.5,
                    "hits": 50,
                    "misses": 50,
                    "evictions": 20,  # 20% eviction rate
                    "expirations": 0,
                },
            },
        }
        mock_cm = _create_mock_cache_manager(stats)
        monitor = CacheMonitor(cache_manager=mock_cm)

        # Should not raise
        monitor.log_cache_recommendation()

    def test_recommendation_low_hit_rate(self):
        """Flags cache with low hit rate."""
        stats = {
            "total_size": 50,
            "overall_hit_rate": 0.3,
            "total_hits": 30,
            "total_misses": 70,
            "caches": {
                "ineffective": {
                    "size": 50,
                    "max_size": 100,
                    "hit_rate": 0.3,  # Poor hit rate
                    "hits": 30,
                    "misses": 70,
                    "evictions": 2,
                    "expirations": 0,
                },
            },
        }
        mock_cm = _create_mock_cache_manager(stats)
        monitor = CacheMonitor(cache_manager=mock_cm)

        # Should not raise
        monitor.log_cache_recommendation()

    def test_recommendation_optimal(self):
        """No recommendations when performance is optimal."""
        stats = {
            "total_size": 80,
            "overall_hit_rate": 0.85,
            "total_hits": 85,
            "total_misses": 15,
            "caches": {
                "good": {
                    "size": 80,
                    "max_size": 100,  # 80% utilization - good
                    "hit_rate": 0.85,  # Good hit rate
                    "hits": 85,
                    "misses": 15,
                    "evictions": 2,  # Low eviction rate
                    "expirations": 0,
                },
            },
        }
        mock_cm = _create_mock_cache_manager(stats)
        monitor = CacheMonitor(cache_manager=mock_cm)

        # Should not raise
        monitor.log_cache_recommendation()


class TestCreateCacheMonitor:
    """Tests for create_cache_monitor factory function."""

    def test_create_with_defaults(self):
        """Factory creates monitor with default config."""
        mock_cm = _create_mock_cache_manager()

        monitor = create_cache_monitor(mock_cm)

        try:
            assert monitor.cache_manager == mock_cm
            assert monitor.log_interval == 300
            assert monitor.enable_detailed_logs is False
            # Auto-starts by default
            assert monitor._monitoring is True
        finally:
            monitor.stop_monitoring()

    def test_create_with_custom_config(self):
        """Factory accepts custom configuration."""
        mock_cm = _create_mock_cache_manager()
        config = {
            "log_interval": 120,
            "detailed_logs": True,
            "auto_start": False,
        }

        monitor = create_cache_monitor(mock_cm, config)

        assert monitor.log_interval == 120
        assert monitor.enable_detailed_logs is True
        assert monitor._monitoring is False

    def test_create_no_auto_start(self):
        """Factory respects auto_start=False."""
        mock_cm = _create_mock_cache_manager()
        config = {"auto_start": False}

        monitor = create_cache_monitor(mock_cm, config)

        assert monitor._monitoring is False


class TestMonitorLoopErrorHandling:
    """Tests for error handling in monitor loop."""

    def test_monitor_loop_handles_exceptions(self):
        """Monitor loop catches and logs exceptions."""
        mock_cm = Mock()
        mock_cm.get_stats.side_effect = Exception("Test error")

        monitor = CacheMonitor(cache_manager=mock_cm, log_interval=1)  # Use int, not float

        try:
            monitor.start_monitoring()
            # Give it time to run and hit the error
            time.sleep(0.05)
        finally:
            monitor.stop_monitoring()

        # Should have called get_stats (and failed)
        assert mock_cm.get_stats.called
