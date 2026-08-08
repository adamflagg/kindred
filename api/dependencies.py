"""
Shared dependencies for the Bunking API.

This module provides:
- PocketBase client management (global instance, background task isolation)
- Authentication helpers
- Caching infrastructure (graph cache, ID translation cache)
- Shared state for solver runs
"""

import asyncio
from datetime import UTC, datetime
from typing import Any

from bunking.graph.graph_cache_manager import GraphCacheManager
from bunking.logging_config import get_logger
from pocketbase import PocketBase

from .constants.collections import SUPERUSERS
from .services.id_cache import IDLookupCache
from .services.lodging_cache import LodgingYearCache
from .services.metrics_cache import MetricsCache
from .settings import get_settings

logger = get_logger(__name__)

# ========================================
# PocketBase Client
# ========================================

# PocketBase client architecture:
# - pb: Global instance used by most endpoints (authenticated as admin on startup)
# - task_pb: Fresh instance created in background tasks for isolation
#
# Thread safety notes (from PocketBase maintainer):
# - The PocketBase API itself is stateless and thread-safe
# - The main concern is the authStore when handling different user contexts
# - Since we only authenticate as admin, a shared client would likely work
# - We use task-specific clients for extra isolation and future-proofing
_settings = get_settings()
pb_url = _settings.pocketbase_url
pb = PocketBase(pb_url)


class AuthState:
    """Shared state object for auth middleware and PocketBase client."""

    pb_client: PocketBase | None = None


auth_state = AuthState()


async def authenticate_pb() -> None:
    """Authenticate with PocketBase as admin."""
    settings = get_settings()
    try:
        await asyncio.to_thread(
            pb.collection(SUPERUSERS).auth_with_password,
            settings.pocketbase_admin_email,
            settings.pocketbase_admin_password,
        )
        logger.info("Successfully authenticated with PocketBase")
    except Exception as e:
        logger.error(f"Failed to authenticate with PocketBase: {e}")
        raise


async def start_pb_token_refresh(interval_seconds: int | float = 3600) -> asyncio.Task[None]:
    """Start background task to periodically refresh PocketBase auth token."""

    async def _refresh_loop() -> None:
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                await authenticate_pb()
                logger.info("Refreshed PocketBase auth token")
            except Exception:
                logger.exception("Failed to refresh PocketBase auth token, will retry")

    return asyncio.create_task(_refresh_loop())


async def get_pb_client() -> PocketBase:
    """FastAPI dependency to get authenticated PocketBase client."""
    return pb


def create_task_pb_client() -> PocketBase:
    """Create a fresh PocketBase client for background tasks."""
    return PocketBase(pb_url)


async def authenticate_task_pb(task_pb: PocketBase) -> None:
    """Authenticate a task-specific PocketBase client."""
    settings = get_settings()
    await asyncio.to_thread(
        task_pb.collection(SUPERUSERS).auth_with_password,
        settings.pocketbase_admin_email,
        settings.pocketbase_admin_password,
    )


# ========================================
# Graph Cache
# ========================================

graph_cache = GraphCacheManager(ttl_seconds=900, max_cache_size=50)


# ========================================
# Metrics Response Cache
# ========================================

# Caches computed metrics endpoint responses in-memory.
# TTL 2 hours (fallback); primary invalidation via frontend sync-completion callback.
metrics_cache = MetricsCache(ttl_seconds=7200, max_size=200)


# ========================================
# Lodging Year-Scoped Read Cache
# ========================================

# Caches four of build_roster/build_summary's six year-scoped reads --
# households, the prior-household set, family-camp adults, and registrations
# (see api/services/lodging_cache.py for why the other two, fetch_units and
# count_open_unresolved_aliases, are deliberately excluded: both are
# admin-panel-writable straight from the browser).
#
# MUST be a module-level singleton, not per-instance state: api/routers/
# lodging.py's `_service`/`_writes` build a fresh LodgingRepository on every
# request, so a cache living on `self` would never be reused across requests.
#
# TTL 15 minutes, matching geo_service's _PERSON_ID_CACHE -- the closer
# sibling here, since it is the other cache built for a fresh-per-request
# service rather than metrics_cache's router-owned 2-hour fallback. Wired to
# POST /api/metrics/cache/invalidate (kindred#2142) -- see lodging_cache.py's
# module docstring for why the TTL is the fallback rather than the plan.
lodging_cache = LodgingYearCache(ttl_seconds=900, max_size=64)


# ========================================
# Solver Runs Storage
# ========================================

# In-memory storage for solver runs (in production, use Redis or a database)
solver_runs: dict[str, dict[str, Any]] = {}

# Completed/failed runs stay readable in-memory for the frontend's status
# polling, but the dict must not grow unboundedly (prod swap incident
# 2026-06-12): each retained run holds full results + diagnostics. 50
# comfortably exceeds any realistic sweep size.
MAX_TERMINAL_SOLVER_RUNS = 50

_TERMINAL_STATUSES = frozenset({"completed", "failed"})
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def prune_solver_runs() -> int:
    """Evict the oldest terminal runs above the cap; returns the eviction count.

    pending/running entries are never touched — the single-flight guards and
    the frontend's status polling depend on them being present.
    """
    terminal = [
        (run_id, run.get("completed_at") or _EPOCH)
        for run_id, run in solver_runs.items()
        if run.get("status") in _TERMINAL_STATUSES
    ]
    excess = len(terminal) - MAX_TERMINAL_SOLVER_RUNS
    if excess <= 0:
        return 0
    terminal.sort(key=lambda item: item[1])
    for run_id, _ in terminal[:excess]:
        solver_runs.pop(run_id, None)
    logger.info(f"Pruned {excess} terminal solver runs from memory (cap {MAX_TERMINAL_SOLVER_RUNS})")
    return excess


# ========================================
# ID Translation Cache
# ========================================

__all__ = [
    "MAX_TERMINAL_SOLVER_RUNS",
    "IDLookupCache",
    "auth_state",
    "authenticate_pb",
    "authenticate_task_pb",
    "create_task_pb_client",
    "get_pb_client",
    "graph_cache",
    "lodging_cache",
    "metrics_cache",
    "pb",
    "pb_url",
    "prune_solver_runs",
    "solver_runs",
    "start_pb_token_refresh",
]
