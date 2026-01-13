"""Cache monitoring and statistics reporting for bunk request processing.

Provides periodic logging of cache statistics and performance metrics."""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

from .cache_manager import CacheManager

logger = logging.getLogger(__name__)


class CacheMonitor:
    """Monitor cache performance and log statistics"""

    def __init__(
        self,
        cache_manager: CacheManager,
        log_interval: int = 300,  # 5 minutes
        enable_detailed_logs: bool = False,
    ):
        """Initialize cache monitor.

        Args:
            cache_manager: The cache manager to monitor
            log_interval: Seconds between statistics logs
            enable_detailed_logs: Whether to log detailed per-cache stats
        """
        self.cache_manager = cache_manager
        self.log_interval = log_interval
        self.enable_detailed_logs = enable_detailed_logs
        self._monitoring = False
        self._monitor_thread: threading.Thread | None = None
        self._start_time = time.time()
        self._last_stats: dict[str, Any] | None = None

    def start_monitoring(self) -> None:
        """Start background monitoring thread"""
        if self._monitoring:
            logger.warning("Cache monitoring already started")
            return

        self._monitoring = True
        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True, name="CacheMonitor")
        self._monitor_thread.start()
        logger.info("Cache monitoring started")

    def stop_monitoring(self) -> None:
        """Stop monitoring thread"""
        self._monitoring = False
        if self._monitor_thread:
            self._monitor_thread.join(timeout=1.0)
        logger.info("Cache monitoring stopped")

    def _monitor_loop(self) -> None:
        """Main monitoring loop"""
        while self._monitoring:
            try:
                self.log_statistics()
                time.sleep(self.log_interval)
            except Exception as e:
                logger.error(f"Error in cache monitor: {e}")

    def log_statistics(self) -> None:
        """Log current cache statistics"""
        stats = self.cache_manager.get_stats()

        # Calculate rates if we have previous stats
        if self._last_stats:
            time_delta = self.log_interval
            stats["rates"] = self._calculate_rates(self._last_stats, stats, time_delta)

        # Log summary
        logger.info(
            f"Cache Statistics - "
            f"Total Size: {stats['total_size']:,} | "
            f"Hit Rate: {stats['overall_hit_rate']:.2%} | "
            f"Hits: {stats['total_hits']:,} | "
            f"Misses: {stats['total_misses']:,}"
        )

        # Log detailed stats if enabled
        if self.enable_detailed_logs:
            for cache_type, cache_stats in stats["caches"].items():
                logger.info(
                    f"  {cache_type}: "
                    f"Size: {cache_stats['size']}/{cache_stats['max_size']} | "
                    f"Hit Rate: {cache_stats['hit_rate']:.2%} | "
                    f"Evictions: {cache_stats['evictions']} | "
                    f"Expirations: {cache_stats['expirations']}"
                )

        # Log rates if available
        if "rates" in stats:
            rates = stats["rates"]
            logger.info(
                f"Cache Rates - "
                f"Hits/min: {rates['hits_per_minute']:.1f} | "
                f"Misses/min: {rates['misses_per_minute']:.1f} | "
                f"Evictions/min: {rates['evictions_per_minute']:.1f}"
            )

        # Update last stats
        self._last_stats = stats

    def _calculate_rates(
        self, old_stats: dict[str, Any], new_stats: dict[str, Any], time_delta: float
    ) -> dict[str, float]:
        """Calculate rate metrics between two stat snapshots"""
        minutes = time_delta / 60.0

        rates = {
            "hits_per_minute": (new_stats["total_hits"] - old_stats["total_hits"]) / minutes,
            "misses_per_minute": (new_stats["total_misses"] - old_stats["total_misses"]) / minutes,
        }

        # Calculate eviction rate
        total_evictions_old = sum(cache["evictions"] for cache in old_stats["caches"].values())
        total_evictions_new = sum(cache["evictions"] for cache in new_stats["caches"].values())
        rates["evictions_per_minute"] = (total_evictions_new - total_evictions_old) / minutes

        return rates

    def get_performance_summary(self) -> dict[str, Any]:
        """Get a performance summary since monitoring started"""
        stats = self.cache_manager.get_stats()
        uptime = time.time() - self._start_time

        summary = {
            "uptime_seconds": uptime,
            "uptime_minutes": uptime / 60,
            "current_stats": stats,
            "average_hit_rate": stats["overall_hit_rate"],
            "total_requests": stats["total_hits"] + stats["total_misses"],
            "requests_per_minute": (stats["total_hits"] + stats["total_misses"]) / (uptime / 60),
        }

        # Add cache efficiency metrics
        summary["cache_efficiency"] = {}
        for cache_type, cache_stats in stats["caches"].items():
            efficiency = {
                "hit_rate": cache_stats["hit_rate"],
                "utilization": cache_stats["size"] / cache_stats["max_size"],
                "eviction_rate": cache_stats["evictions"] / max(1, cache_stats["hits"] + cache_stats["misses"]),
            }
            summary["cache_efficiency"][cache_type] = efficiency

        return summary

    def export_stats_json(self, filepath: str) -> None:
        """Export current statistics to JSON file"""
        summary = self.get_performance_summary()

        with open(filepath, "w") as f:
            json.dump(summary, f, indent=2, default=str)

        logger.info(f"Cache statistics exported to {filepath}")

    def log_cache_recommendation(self) -> None:
        """Log recommendations based on cache performance"""
        summary = self.get_performance_summary()

        recommendations = []

        for cache_type, efficiency in summary["cache_efficiency"].items():
            # Check if cache is underutilized
            if efficiency["utilization"] < 0.1 and efficiency["hit_rate"] > 0.8:
                recommendations.append(
                    f"{cache_type}: Consider reducing cache size (only {efficiency['utilization']:.1%} used)"
                )

            # Check if cache is thrashing
            elif efficiency["eviction_rate"] > 0.1:
                recommendations.append(
                    f"{cache_type}: Consider increasing cache size (high eviction rate: {efficiency['eviction_rate']:.1%})"
                )

            # Check for poor hit rate
            elif efficiency["hit_rate"] < 0.5:
                recommendations.append(
                    f"{cache_type}: Low hit rate ({efficiency['hit_rate']:.1%}) - review caching strategy"
                )

        if recommendations:
            logger.info("Cache optimization recommendations:")
            for rec in recommendations:
                logger.info(f"  - {rec}")
        else:
            logger.info("Cache performance is optimal - no recommendations")


def create_cache_monitor(cache_manager: CacheManager, config: dict[str, Any] | None = None) -> CacheMonitor:
    """Create and configure a cache monitor.

    Args:
        cache_manager: The cache manager to monitor
        config: Optional configuration dict

    Returns:
        Configured CacheMonitor instance
    """
    config = config or {}

    monitor = CacheMonitor(
        cache_manager=cache_manager,
        log_interval=config.get("log_interval", 300),
        enable_detailed_logs=config.get("detailed_logs", False),
    )

    # Auto-start if configured
    if config.get("auto_start", True):
        monitor.start_monitoring()

    return monitor
